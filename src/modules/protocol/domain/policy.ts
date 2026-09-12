import { parseOfferPayload } from "@/modules/protocol/domain/message";

type OfferForPolicy = {
  id: string;
  supplierCompanyId: string;
  payload: Record<string, unknown>;
};

type MandateForPolicy = {
  maximumTotalIncludingFees: string;
  allowedSuppliers: string[];
  expiresAt: string;
  currency: "ARS";
};

export type PolicyDecision = {
  eligible: boolean;
  reasons: string[];
};

function decimalToMicros(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

export function evaluateOfferAgainstMandate(
  offer: OfferForPolicy,
  mandate: MandateForPolicy,
  now = new Date(),
): PolicyDecision {
  const payload = parseOfferPayload(offer.payload);
  const reasons: string[] = [];

  if (!mandate.allowedSuppliers.includes(offer.supplierCompanyId)) {
    reasons.push("SUPPLIER_NOT_ALLOWED");
  }
  if (payload.currency !== mandate.currency) reasons.push("CURRENCY_MISMATCH");
  if (!payload.confirmedStock) reasons.push("STOCK_NOT_CONFIRMED");
  if (new Date(payload.validUntil) <= now) reasons.push("OFFER_EXPIRED");
  if (new Date(mandate.expiresAt) <= now) reasons.push("MANDATE_EXPIRED");
  if (
    decimalToMicros(payload.total) >
    decimalToMicros(mandate.maximumTotalIncludingFees)
  ) {
    reasons.push("MANDATE_TOTAL_EXCEEDED");
  }

  return { eligible: reasons.length === 0, reasons };
}
