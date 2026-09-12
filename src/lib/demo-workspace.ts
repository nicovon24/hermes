import "server-only";

import { DomainError } from "@/lib/domain/errors";
import type { ReplenishmentContext } from "@/modules/context/replenishment";

export const DEFAULT_BUYER_COMPANY_ID =
  "00000000-0000-4000-8000-000000000001";

export const DEMO_SUPPLIER_COMPANY_IDS = [
  "00000000-0000-4000-8000-000000000101",
  "00000000-0000-4000-8000-000000000102",
  "00000000-0000-4000-8000-000000000103",
] as const;

export const DEMO_COMPANIES = [
  { id: DEFAULT_BUYER_COMPANY_ID, slug: "cliente-demo", legalName: "Almacén Punto Centro", kind: "BUYER" },
  { id: DEMO_SUPPLIER_COMPANY_IDS[0], slug: "distribuidora-norte", legalName: "Distribuidora Norte", kind: "SUPPLIER" },
  { id: DEMO_SUPPLIER_COMPANY_IDS[1], slug: "mayorista-andino", legalName: "Mayorista Andino", kind: "SUPPLIER" },
  { id: DEMO_SUPPLIER_COMPANY_IDS[2], slug: "abastecimientos-sur", legalName: "Abastecimientos Sur", kind: "SUPPLIER" },
] as const;

// The buyer storefront is intentionally static: this is the fixed demo catalog
// and lets /cliente-demo render without waiting for the database or old orders.
export const DEMO_BUYER_PRODUCT_CONTEXTS: ReplenishmentContext[] = [
  {
    productId: "ACEITE-1500",
    productName: "Aceite de girasol 1,5 L",
    unit: "unidad",
    unitCost: "2180.00",
    availableStock: 5,
    inTransit: 12,
    unitsSoldLast30Days: 0,
    averageDailyDemand: 0,
    targetDaysOfStock: 14,
    suggestedPurchaseQuantity: 0,
  },
  {
    productId: "YERBA-1000",
    productName: "Yerba mate 1 kg",
    unit: "unidad",
    unitCost: "2940.00",
    availableStock: 4,
    inTransit: 0,
    unitsSoldLast30Days: 66,
    averageDailyDemand: 2.2,
    targetDaysOfStock: 14,
    suggestedPurchaseQuantity: 27,
  },
  {
    productId: "ARROZ-1000",
    productName: "Arroz largo fino 1 kg",
    unit: "unidad",
    unitCost: "980.00",
    availableStock: 5,
    inTransit: 0,
    unitsSoldLast30Days: 54,
    averageDailyDemand: 1.8,
    targetDaysOfStock: 14,
    suggestedPurchaseQuantity: 21,
  },
  {
    productId: "AZUCAR-1000",
    productName: "Azúcar 1 kg",
    unit: "unidad",
    unitCost: "870.00",
    availableStock: 6,
    inTransit: 0,
    unitsSoldLast30Days: 70,
    averageDailyDemand: 70 / 30,
    targetDaysOfStock: 14,
    suggestedPurchaseQuantity: 27,
  },
  {
    productId: "FIDEOS-500",
    productName: "Fideos secos 500 g",
    unit: "unidad",
    unitCost: "800.00",
    availableStock: 3,
    inTransit: 0,
    unitsSoldLast30Days: 45,
    averageDailyDemand: 1.5,
    targetDaysOfStock: 14,
    suggestedPurchaseQuantity: 18,
  },
  {
    productId: "HARINA-1000",
    productName: "Harina 000 1 kg",
    unit: "unidad",
    unitCost: "700.00",
    availableStock: 4,
    inTransit: 0,
    unitsSoldLast30Days: 60,
    averageDailyDemand: 2,
    targetDaysOfStock: 14,
    suggestedPurchaseQuantity: 24,
  },
  {
    productId: "LECHE-1000",
    productName: "Leche larga vida 1 L",
    unit: "unidad",
    unitCost: "1200.00",
    availableStock: 2,
    inTransit: 0,
    unitsSoldLast30Days: 90,
    averageDailyDemand: 3,
    targetDaysOfStock: 14,
    suggestedPurchaseQuantity: 40,
  },
];

export type Actor = {
  actorId: string;
  actorType: "USER" | "AGENT";
  companyId: string;
  role: "BUYER" | "SUPPLIER";
};

export function getBuyerCompanyId() {
  return process.env.BUYER_COMPANY_ID ?? DEFAULT_BUYER_COMPANY_ID;
}

export async function requireBuyerActor(companyId: string): Promise<Actor> {
  const buyerCompanyId = getBuyerCompanyId();

  if (companyId !== buyerCompanyId) {
    throw new DomainError("Esta demo opera con un único cliente", "FORBIDDEN", 403);
  }

  return {
    actorId: "demo-buyer",
    actorType: "USER",
    companyId: buyerCompanyId,
    role: "BUYER",
  };
}

export async function requireDemoCompanyActor(companyId: string): Promise<Actor> {
  const buyerCompanyId = getBuyerCompanyId();
  const isSupplier = DEMO_SUPPLIER_COMPANY_IDS.includes(
    companyId as (typeof DEMO_SUPPLIER_COMPANY_IDS)[number],
  );

  if (companyId !== buyerCompanyId && !isSupplier) {
    throw new DomainError("La empresa no pertenece a esta demo", "FORBIDDEN", 403);
  }

  return {
    actorId: `demo-company:${companyId}`,
    actorType: "USER",
    companyId,
    role: companyId === buyerCompanyId ? "BUYER" : "SUPPLIER",
  };
}
