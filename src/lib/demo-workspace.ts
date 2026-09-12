import "server-only";

import { DomainError } from "@/lib/domain/errors";

export const DEFAULT_BUYER_COMPANY_ID =
  "00000000-0000-4000-8000-000000000001";

export const DEMO_SUPPLIER_COMPANY_IDS = [
  "00000000-0000-4000-8000-000000000101",
  "00000000-0000-4000-8000-000000000102",
  "00000000-0000-4000-8000-000000000103",
] as const;

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
