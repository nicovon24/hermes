import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BUYER = "00000000-0000-4000-8000-000000000001";
const companies = [
  { id: BUYER, slug: "cliente-demo", legalName: "Almacén Punto Centro", kind: "BUYER", sourceId: "00000000-0000-4000-8000-000000000301", source: "erp-cliente-demo" },
  { id: "00000000-0000-4000-8000-000000000101", slug: "distribuidora-norte", legalName: "Distribuidora Norte", kind: "SUPPLIER", sourceId: "00000000-0000-4000-8000-000000000311", source: "erp-distribuidora-norte" },
  { id: "00000000-0000-4000-8000-000000000102", slug: "mayorista-andino", legalName: "Mayorista Andino", kind: "SUPPLIER", sourceId: "00000000-0000-4000-8000-000000000312", source: "erp-mayorista-andino" },
  { id: "00000000-0000-4000-8000-000000000103", slug: "abastecimientos-sur", legalName: "Abastecimientos Sur", kind: "SUPPLIER", sourceId: "00000000-0000-4000-8000-000000000313", source: "erp-abastecimientos-sur" },
];
const profiles = [
  [BUYER, "30-71824591-6", "Av. Colón 1840", "Córdoba", "Córdoba", "Sofía Benítez", "compras@puntocentro.demo", "+54 351 555-0101", "Córdoba Capital"],
  [companies[1].id, "30-70918234-2", "Ruta 9 km 695", "Jesús María", "Córdoba", "Martín Quiroga", "ventas@norte.demo", "+54 3525 555-101", "Centro y norte de Córdoba"],
  [companies[2].id, "30-71567342-8", "Colectora Sur 420", "Villa Allende", "Córdoba", "Carla Ferreyra", "cuentas@andino.demo", "+54 3543 555-102", "Gran Córdoba y Sierras Chicas"],
  [companies[3].id, "30-72301987-4", "Camino Interfábricas 2280", "Córdoba", "Córdoba", "Julián Roldán", "pedidos@sur.demo", "+54 351 555-0103", "Centro y sur de Córdoba"],
];
const catalog = [
  ["ACEITE-1500", "Aceite de girasol 1,5 L", [2180, 2050, 1980, 2120], [[14, 9, 12], [180, 25, 80], [140, 15, 40], [230, 50, 110]]],
  ["YERBA-1000", "Yerba mate 1 kg", [2940, 2700, 2700, 2700], [[22, 15, 18], [18, 10, 20], [160, 30, 100], [70, 5, 35]]],
  ["ARROZ-1000", "Arroz largo fino 1 kg", [980, 820, 820, 820], [[40, 12, 30], [320, 40, 120], [12, 8, 25], [410, 65, 150]]],
  ["AZUCAR-1000", "Azúcar 1 kg", [870, 730, 730, 730], [[18, 8, 20], [210, 35, 90], [175, 25, 55], [12, 9, 20]]],
  ["FIDEOS-500", "Fideos secos 500 g", [800, 600, 580, 550], [[5, 2, 0], [130, 20, 40], [15, 8, 25], [160, 30, 70]]],
  ["HARINA-1000", "Harina 000 1 kg", [700, 520, 500, 540], [[7, 3, 0], [15, 8, 20], [125, 15, 60], [150, 20, 65]]],
  ["LECHE-1000", "Leche larga vida 1 L", [1200, 900, 920, 950], [[4, 2, 0], [140, 25, 50], [120, 20, 45], [12, 8, 20]]],
];

async function main() {
  for (const company of companies) {
    await prisma.company.upsert({
      where: { id: company.id },
      create: { id: company.id, slug: company.slug, legalName: company.legalName, kind: company.kind },
      update: { slug: company.slug, legalName: company.legalName, kind: company.kind },
    });
    await prisma.contextSource.upsert({
      where: { companyId_externalId: { companyId: company.id, externalId: company.source } },
      create: { id: company.sourceId, companyId: company.id, kind: "ERP", externalId: company.source, lastVersion: "prisma-seed-v1", lastObservedAt: new Date() },
      update: { kind: "ERP", lastVersion: "prisma-seed-v1", lastObservedAt: new Date() },
    });
  }
  for (const [companyId, taxId, addressLine, city, province, contactName, contactEmail, contactPhone, deliveryArea] of profiles) {
    const data = { taxId, addressLine, city, province, contactName, contactEmail, contactPhone, deliveryArea };
    await prisma.companyProfile.upsert({ where: { companyId }, create: { companyId, ...data }, update: data });
  }
  const objectives = [
    { companyId: BUYER, targetStockCapital: "250000.00", targetDaysOfStock: 14 },
    { companyId: companies[1].id, targetMarginPercentage: "18.000", targetRotationDays: 21 },
    { companyId: companies[2].id, targetMarginPercentage: "22.000", targetRotationDays: 30 },
    { companyId: companies[3].id, targetMarginPercentage: "16.000", targetRotationDays: 18 },
  ];
  for (const objective of objectives) {
    await prisma.companyObjective.upsert({ where: { companyId: objective.companyId }, create: objective, update: objective });
  }

  for (const [externalId, name, costs, stocks] of catalog) {
    for (let companyIndex = 0; companyIndex < companies.length; companyIndex += 1) {
      const company = companies[companyIndex];
      const product = await prisma.product.upsert({
        where: { companyId_externalId: { companyId: company.id, externalId } },
        create: { companyId: company.id, externalId, name, unit: "unidad", unitCost: String(costs[companyIndex]) },
        update: { name, unit: "unidad", unitCost: String(costs[companyIndex]) },
      });
      const [onHand, reserved, inTransit] = stocks[companyIndex];
      const sourceVersion = `prisma-seed-v1:${externalId}`;
      await prisma.inventorySnapshot.upsert({
        where: { sourceId_productId_sourceVersion: { sourceId: company.sourceId, productId: product.id, sourceVersion } },
        create: { companyId: company.id, sourceId: company.sourceId, productId: product.id, sourceVersion, onHand, reserved, inTransit, observedAt: new Date() },
        update: { onHand, reserved, inTransit },
      });
    }
  }

  const buyerSales = [
    ["FIDEOS-500", "seed-fideos-1", 24, 1200, 3], ["FIDEOS-500", "seed-fideos-2", 21, 1200, 14],
    ["HARINA-1000", "seed-harina-1", 32, 1100, 4], ["HARINA-1000", "seed-harina-2", 28, 1100, 17],
    ["LECHE-1000", "seed-leche-1", 48, 1750, 2], ["LECHE-1000", "seed-leche-2", 42, 1750, 13],
  ];
  for (const [externalId, externalEventId, quantity, unitPrice, daysAgo] of buyerSales) {
    const product = await prisma.product.findUniqueOrThrow({ where: { companyId_externalId: { companyId: BUYER, externalId } } });
    const soldAt = new Date(Date.now() - daysAgo * 86400000);
    await prisma.salesEvent.upsert({
      where: { sourceId_externalEventId: { sourceId: companies[0].sourceId, externalEventId } },
      create: { companyId: BUYER, sourceId: companies[0].sourceId, productId: product.id, externalEventId, sourceVersion: `prisma-seed-v1:${externalEventId}`, quantity, unitPrice, soldAt, observedAt: new Date() },
      update: { quantity, unitPrice, soldAt },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
