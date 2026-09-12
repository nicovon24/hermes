import { z } from "zod";

import { moneyToCents } from "@/lib/decimal";
import { createPurchaseRequestSchema } from "./commands";

const conditions = z.object({
  maximumTotalIncludingFees: z.string().regex(/^\d+(?:\.\d{1,2})?$/).refine((v) => moneyToCents(v) > 0n),
  paymentTerms: z.string().min(1).max(200),
  settlementAsset: z.string().min(1).max(80),
  route: z.enum(["ARBITRUM_DIRECT", "SOLANA_TO_ARBITRUM"]).optional(),
  autoPay: z.boolean(),
  mandateExpiresAt: z.iso.datetime({ offset: true }).refine((v) => new Date(v).getTime() > Date.now(), "El mandato debe vencer en el futuro."),
});
const identity = { operationId: z.uuid(), requestId: z.uuid(), buyerCompanyId: z.uuid() };

export const launchPurchaseFlowSchema = z.discriminatedUnion("kind", [
  z.object({ ...identity, kind: z.literal("new"), request: createPurchaseRequestSchema.omit({ buyerCompanyId: true, currency: true }), conditions }),
  z.object({ ...identity, kind: z.literal("approve"), conditions }),
  z.object({ ...identity, kind: z.literal("retry") }),
]);
export type LaunchPurchaseFlowInput = z.infer<typeof launchPurchaseFlowSchema>;

export const suppliers = [
  { id: "00000000-0000-4000-8000-000000000101", name: "Distribuidora Norte", color: "cyan", shortName: "Norte" },
  { id: "00000000-0000-4000-8000-000000000102", name: "Mayorista Andino", color: "amber", shortName: "Andino" },
  { id: "00000000-0000-4000-8000-000000000103", name: "Abastecimientos Sur", color: "violet", shortName: "Sur" },
] as const;

export type TenderPhase = "creation" | "rfq" | "initial_offer" | "counteroffer" | "final_offer" | "award" | "orders" | "payment" | "complete" | "error";
export type PublicOfferLine = { itemId: string; quantity: string; unit: string; total: string };
export type PublicOffer = { total: string; deliveryDate: string | null; coveredProducts: number; requestedProducts: number; lines: PublicOfferLine[] };
export type OfferChange = { amount: string; percentage: number | null; comparable: boolean };
export type TenderMetrics = {
  offer: PublicOffer;
  saving: OfferChange | null;
  previousChange: OfferChange | null;
  targetGap: OfferChange | null;
  coverageChange: number;
  deliveryDaysEarlier: number | null;
  proposed: boolean;
};
export type TenderSummary = {
  orderCount: number; total: string; saving: OfferChange | null;
  coveredProducts: number; requestedProducts: number; pendingProducts: number;
  orders: Array<{ id: string; reference: string; supplierId: string; total: string; paymentStatus: string | null }>;
};
export type TenderProgressEvent = {
  id: string; sequence: number; requestId: string; tenderRoundId: string | null;
  supplierId?: string; phase: TenderPhase; timestamp: string; messageId?: string;
  direction?: "outbound" | "inbound"; metrics?: TenderMetrics;
  summary?: TenderSummary; message?: string; status?: string;
  recommendation?: { supplierNames: string[]; total: string; coveredProducts: number; pendingProducts: number };
  requestItems?: Array<{ productId: string; description: string; quantity: string; unit: string }>;
};
export type TenderSnapshot = {
  requestId: string; tenderRoundId: string | null; status: string;
  running: boolean; events: TenderProgressEvent[]; summary: TenderSummary;
};

export const phaseLabels: Record<TenderPhase, string> = {
  creation: "Preparando tu pedido", rfq: "Solicitud enviada", initial_offer: "Primera propuesta",
  counteroffer: "Buscando una mejora", final_offer: "Oferta final recibida", award: "Eligiendo por producto",
  orders: "Tus pedidos están listos", payment: "Estado del pago", complete: "Negociación completa", error: "Necesita revisión",
};
export const phaseProgress: Partial<Record<TenderPhase, number>> = { rfq: 25, initial_offer: 50, counteroffer: 75, final_offer: 100 };

export function flowInputFromForm(kind: "new" | "approve", buyerCompanyId: string, form: FormData, requestId: string, operationId: string): LaunchPurchaseFlowInput {
  const iso = (key: string) => {
    const date = new Date(String(form.get(key) ?? ""));
    return Number.isNaN(date.getTime()) ? "invalid" : date.toISOString();
  };
  const autoPay = form.get("autoPay") === "on";
  const common = {
    kind, buyerCompanyId, requestId, operationId,
    conditions: {
      maximumTotalIncludingFees: String(form.get("maximumTotalIncludingFees") ?? ""),
      paymentTerms: autoPay ? "CONTADO" : String(form.get("paymentTerms") ?? "CONTADO"),
      settlementAsset: autoPay ? "ARGt" : String(form.get("settlementAsset") ?? "ARS"),
      autoPay, mandateExpiresAt: iso("mandateExpiresAt"),
    },
  };
  if (kind === "approve") return { ...common, kind };
  const items = form.has("items") ? JSON.parse(String(form.get("items"))) : [{
    productId: String(form.get("productId") ?? ""), description: String(form.get("description") ?? ""), unit: String(form.get("unit") ?? "unidad"),
    minimumQuantity: String(form.get("minimumQuantity") ?? ""), targetQuantity: String(form.get("targetQuantity") ?? ""), maximumQuantity: String(form.get("maximumQuantity") ?? ""),
  }];
  return { ...common, kind, request: { requiredBy: String(form.get("requiredBy") ?? ""), expiresAt: iso("expiresAt"), items } };
}
