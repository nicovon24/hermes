export type RequestLineForAward = {
  requestItemId: string;
  productId: string;
  description: string;
  quantity: string;
  urgencyScore: number;
};

export type OfferLineForAward = {
  offerLineId: string;
  offerId: string;
  requestItemId: string;
  productId: string;
  supplierCompanyId: string;
  supplierName: string;
  quantity: string;
  unitPrice: string;
  subtotal: string;
  taxes: string;
  shipping: string;
  total: string;
  confirmedStock: boolean;
  deliveryDate: string;
  paymentTerms: string;
  validUntil: string;
  offerStatus: string;
};

export type SplitAllocation = {
  requestItemId: string;
  productId: string;
  offerLineId: string;
  offerId: string;
  supplierCompanyId: string;
  supplierName: string;
  quantity: string;
  unitPrice: string;
  subtotal: string;
  taxes: string;
  shipping: string;
  total: string;
  deliveryDate: string;
  paymentTerms: string;
  reason: string;
  warnings: string[];
};

export type PendingAwardItem = {
  requestItemId: string;
  productId: string;
  description: string;
  reason: "SIN_OFERTA_CONFIRMADA" | "FUERA_DE_FECHA" | "PRESUPUESTO_INSUFICIENTE";
};

export type SplitAwardRecommendation = {
  allocations: SplitAllocation[];
  supplierOrders: Array<{
    supplierCompanyId: string;
    supplierName: string;
    lineCount: number;
    total: string;
  }>;
  pendingItems: PendingAwardItem[];
  grandTotal: string;
  summary: string;
};

function moneyToCents(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

function centsToMoney(value: bigint) {
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

export function buildSplitAwardRecommendation({
  requestLines,
  offerLines,
  allowedSuppliers,
  requiredBy,
  mandateExpiresAt,
  maximumTotal,
  alreadyCommittedTotal = "0.00",
  now = new Date(),
}: {
  requestLines: RequestLineForAward[];
  offerLines: OfferLineForAward[];
  allowedSuppliers: string[];
  requiredBy: string;
  mandateExpiresAt: string;
  maximumTotal: string;
  alreadyCommittedTotal?: string;
  now?: Date;
}): SplitAwardRecommendation {
  const budget = moneyToCents(maximumTotal);
  let committed = moneyToCents(alreadyCommittedTotal);
  const allocations: SplitAllocation[] = [];
  const pendingItems: PendingAwardItem[] = [];

  const prioritized = [...requestLines].sort(
    (left, right) =>
      left.urgencyScore - right.urgencyScore ||
      left.requestItemId.localeCompare(right.requestItemId),
  );

  for (const item of prioritized) {
    const itemOffers = offerLines.filter(
      (line) =>
        line.requestItemId === item.requestItemId &&
        line.productId === item.productId &&
        allowedSuppliers.includes(line.supplierCompanyId) &&
        line.offerStatus === "ACTIVE" &&
        line.confirmedStock &&
        new Date(line.validUntil) > now &&
        new Date(mandateExpiresAt) > now,
    );
    const datedOffers = itemOffers.filter(
      (line) => line.deliveryDate <= requiredBy,
    );
    const sorted = [...datedOffers].sort((left, right) => {
      const priceDifference = moneyToCents(left.total) - moneyToCents(right.total);
      if (priceDifference !== 0n) return priceDifference < 0n ? -1 : 1;
      const deliveryDifference = left.deliveryDate.localeCompare(right.deliveryDate);
      return deliveryDifference || left.supplierCompanyId.localeCompare(right.supplierCompanyId);
    });
    const winner = sorted[0];

    if (!winner) {
      pendingItems.push({
        requestItemId: item.requestItemId,
        productId: item.productId,
        description: item.description,
        reason: itemOffers.length > 0 ? "FUERA_DE_FECHA" : "SIN_OFERTA_CONFIRMADA",
      });
      continue;
    }

    const lineTotal = moneyToCents(winner.total);
    if (committed + lineTotal > budget) {
      pendingItems.push({
        requestItemId: item.requestItemId,
        productId: item.productId,
        description: item.description,
        reason: "PRESUPUESTO_INSUFICIENTE",
      });
      continue;
    }

    committed += lineTotal;
    allocations.push({
      requestItemId: item.requestItemId,
      productId: item.productId,
      offerLineId: winner.offerLineId,
      offerId: winner.offerId,
      supplierCompanyId: winner.supplierCompanyId,
      supplierName: winner.supplierName,
      quantity: winner.quantity,
      unitPrice: winner.unitPrice,
      subtotal: winner.subtotal,
      taxes: winner.taxes,
      shipping: winner.shipping,
      total: winner.total,
      deliveryDate: winner.deliveryDate,
      paymentTerms: winner.paymentTerms,
      reason: `Menor costo elegible para ${item.description}, con stock y entrega confirmados.`,
      warnings: [],
    });
  }

  const grouped = new Map<string, { name: string; count: number; total: bigint }>();
  for (const allocation of allocations) {
    const current = grouped.get(allocation.supplierCompanyId) ?? {
      name: allocation.supplierName,
      count: 0,
      total: 0n,
    };
    current.count += 1;
    current.total += moneyToCents(allocation.total);
    grouped.set(allocation.supplierCompanyId, current);
  }

  const supplierOrders = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([supplierCompanyId, value]) => ({
      supplierCompanyId,
      supplierName: value.name,
      lineCount: value.count,
      total: centsToMoney(value.total),
    }));
  const newTotal = allocations.reduce(
    (sum, allocation) => sum + moneyToCents(allocation.total),
    0n,
  );

  return {
    allocations,
    supplierOrders,
    pendingItems,
    grandTotal: centsToMoney(newTotal),
    summary:
      pendingItems.length === 0
        ? `Se adjudicaron ${allocations.length} productos en ${supplierOrders.length} pedidos.`
        : `Se adjudicaron ${allocations.length} productos; ${pendingItems.length} quedaron pendientes para otra ronda.`,
  };
}
