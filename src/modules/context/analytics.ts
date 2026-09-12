import "server-only";

import {
  centsToMoney,
  moneyToCents,
  quantityToMicros,
  roundDivide,
} from "@/lib/decimal";
import { DomainError } from "@/lib/domain/errors";
import { prisma } from "@/lib/prisma";

type Sale = {
  quantity: { toString(): string };
  unitPrice: { toString(): string };
  soldAt: Date;
};

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function trendPercentage(recent: number, previous: number) {
  if (previous === 0) return recent > 0 ? 100 : 0;
  return ((recent - previous) / previous) * 100;
}

function salesWindow(sales: Sale[], recentDays: number, previousDays: number) {
  const now = Date.now();
  const recentBoundary = now - recentDays * 24 * 60 * 60 * 1000;
  const previousBoundary = recentBoundary - previousDays * 24 * 60 * 60 * 1000;
  const recent = sum(
    sales
      .filter((sale) => sale.soldAt.getTime() >= recentBoundary)
      .map((sale) => Number(sale.quantity)),
  );
  const previous = sum(
    sales
      .filter((sale) => {
        const soldAt = sale.soldAt.getTime();
        return soldAt >= previousBoundary && soldAt < recentBoundary;
      })
      .map((sale) => Number(sale.quantity)),
  );
  return { recent, previous, trendPercentage: trendPercentage(recent, previous) };
}

export async function getBuyerProductContexts(
  buyerCompanyId: string,
  productExternalIds?: string[],
) {
  const requestedIds = productExternalIds ? [...new Set(productExternalIds)] : null;
  if (requestedIds?.length === 0) return [];
  const salesBoundary = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const [products, objective, allStock, sales] = await Promise.all([
    prisma.product.findMany({
      where: { companyId: buyerCompanyId, ...(requestedIds ? { externalId: { in: requestedIds } } : {}) },
      select: { id: true, externalId: true, name: true, unit: true, unitCost: true },
    }),
    prisma.companyObjective.findUnique({ where: { companyId: buyerCompanyId } }),
    prisma.inventorySnapshot.findMany({
      where: { companyId: buyerCompanyId },
      orderBy: { observedAt: "desc" },
      distinct: ["productId"],
      include: { product: { select: { unitCost: true } } },
    }),
    prisma.salesEvent.findMany({
      where: {
        companyId: buyerCompanyId,
        soldAt: { gte: salesBoundary },
        ...(requestedIds ? { product: { externalId: { in: requestedIds } } } : {}),
      },
      orderBy: { soldAt: "desc" },
      select: { productId: true, quantity: true, unitPrice: true, soldAt: true },
    }),
  ]);
  const productsByExternalId = new Map(products.map((product) => [product.externalId, product]));
  if (requestedIds?.some((externalId) => !productsByExternalId.has(externalId))) {
    throw new DomainError("El cliente no tiene contexto para ese producto", "NOT_FOUND", 404);
  }
  const latestStockByProduct = new Map<string, (typeof allStock)[number]>();
  for (const row of allStock) {
    if (!latestStockByProduct.has(row.productId)) latestStockByProduct.set(row.productId, row);
  }
  const currentStockCapitalCents = [...latestStockByProduct.values()].reduce((total, row) => {
    const availableMicros = quantityToMicros(row.onHand) - quantityToMicros(row.reserved);
    return total + (availableMicros * moneyToCents(row.product.unitCost)) / 1_000_000n;
  }, 0n);
  const salesByProduct = new Map<string, typeof sales>();
  for (const sale of sales) {
    const rows = salesByProduct.get(sale.productId) ?? [];
    rows.push(sale);
    salesByProduct.set(sale.productId, rows);
  }
  return (requestedIds ?? products.map(({ externalId }) => externalId)).map((productExternalId) => {
    const product = productsByExternalId.get(productExternalId)!;
    const stock = latestStockByProduct.get(product.id);
    const window = salesWindow((salesByProduct.get(product.id) ?? []) as Sale[], 30, 30);
    const available = Number(stock?.onHand ?? 0) - Number(stock?.reserved ?? 0);
    const inTransit = Number(stock?.inTransit ?? 0);
    const targetDays = Number(objective?.targetDaysOfStock ?? 14);
    const averageDailyDemand = window.recent / 30;
    return {
      companyId: buyerCompanyId,
      productId: productExternalId,
      productName: product.name,
      unit: product.unit,
      unitCost: product.unitCost.toFixed(2),
      availableStock: available,
      inTransit,
      unitsSoldLast30Days: window.recent,
      previous30DayUnits: window.previous,
      salesTrendPercentage: window.trendPercentage,
      averageDailyDemand,
      targetDaysOfStock: targetDays,
      suggestedPurchaseQuantity: Math.max(0, Math.ceil(averageDailyDemand * targetDays - available - inTransit)),
      currentStockCapital: centsToMoney(currentStockCapitalCents),
      targetStockCapital: objective?.targetStockCapital?.toFixed(2) ?? "0.00",
    };
  });
}

export async function getBuyerProductContext(
  buyerCompanyId: string,
  productExternalId: string,
) {
  const [context] = await getBuyerProductContexts(buyerCompanyId, [productExternalId]);
  return context;
}

export async function getSupplierProductContexts(
  supplierCompanyIds: string[],
  buyerCompanyId: string,
  productExternalIds: string[],
) {
  const supplierIds = [...new Set(supplierCompanyIds)];
  const requestedIds = [...new Set(productExternalIds)];
  if (supplierIds.length === 0 || requestedIds.length === 0) return [];
  const [products, objectives] = await Promise.all([
    prisma.product.findMany({
      where: { companyId: { in: supplierIds }, externalId: { in: requestedIds } },
      select: { id: true, companyId: true, externalId: true, name: true, unit: true, unitCost: true },
    }),
    prisma.companyObjective.findMany({ where: { companyId: { in: supplierIds } } }),
  ]);
  const productIds = products.map((product) => product.id);
  const [stocks, sales] = await Promise.all([
    prisma.inventorySnapshot.findMany({
      where: { companyId: { in: supplierIds }, productId: { in: productIds } },
      orderBy: { observedAt: "desc" },
      distinct: ["companyId", "productId"],
      select: { companyId: true, productId: true, onHand: true, reserved: true, inTransit: true },
    }),
    prisma.salesEvent.findMany({
      where: { companyId: { in: supplierIds }, customerCompanyId: buyerCompanyId, productId: { in: productIds } },
      orderBy: { soldAt: "desc" },
      select: { companyId: true, productId: true, quantity: true, unitPrice: true, soldAt: true },
    }),
  ]);
  const objectivesByCompany = new Map(objectives.map((objective) => [objective.companyId, objective]));
  const stockByCompanyAndProduct = new Map<string, (typeof stocks)[number]>();
  for (const stock of stocks) {
    const key = `${stock.companyId}:${stock.productId}`;
    if (!stockByCompanyAndProduct.has(key)) stockByCompanyAndProduct.set(key, stock);
  }
  const salesByCompanyAndProduct = new Map<string, typeof sales>();
  for (const sale of sales) {
    const key = `${sale.companyId}:${sale.productId}`;
    const rows = salesByCompanyAndProduct.get(key) ?? [];
    if (rows.length < 200) rows.push(sale);
    salesByCompanyAndProduct.set(key, rows);
  }
  return products.map((product) => {
    const objective = objectivesByCompany.get(product.companyId);
    const stock = stockByCompanyAndProduct.get(`${product.companyId}:${product.id}`);
    const productSales = salesByCompanyAndProduct.get(`${product.companyId}:${product.id}`) ?? [];
    const window = salesWindow(productSales as Sale[], 45, 45);
    const quantitySold = sum(productSales.map((sale) => Number(sale.quantity)));
    const quantitySoldMicros = productSales.reduce(
      (total, sale) => total + quantityToMicros(sale.quantity),
      0n,
    );
    const weightedRevenue = productSales.reduce(
      (total, sale) => total + quantityToMicros(sale.quantity) * moneyToCents(sale.unitPrice),
      0n,
    );
    const averageHistoricalUnitPrice = quantitySoldMicros > 0n
      ? centsToMoney(roundDivide(weightedRevenue, quantitySoldMicros))
      : "0.00";
    return {
      companyId: product.companyId,
      customerCompanyId: buyerCompanyId,
      productId: product.externalId,
      productName: product.name,
      unit: product.unit,
      unitCost: product.unitCost.toFixed(2),
      availableStock: Number(stock?.onHand ?? 0) - Number(stock?.reserved ?? 0),
      inTransit: Number(stock?.inTransit ?? 0),
      unitsSoldToClient: quantitySold,
      averageHistoricalUnitPrice,
      recentUnitsSoldToClient: window.recent,
      previousUnitsSoldToClient: window.previous,
      salesTrendPercentage: window.trendPercentage,
      targetMarginPercentage: Number(objective?.targetMarginPercentage ?? 0),
      targetRotationDays: Number(objective?.targetRotationDays ?? 30),
    };
  });
}

export async function getSupplierProductContext(
  supplierCompanyId: string,
  buyerCompanyId: string,
  productExternalId: string,
) {
  const [context] = await getSupplierProductContexts(
    [supplierCompanyId],
    buyerCompanyId,
    [productExternalId],
  );
  if (!context) {
    throw new DomainError("El distribuidor no comercializa el producto", "NOT_FOUND", 404);
  }
  return context;
}
