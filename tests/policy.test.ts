import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { evaluateOfferAgainstMandate } from "@/modules/protocol/domain/policy";

const supplierId = randomUUID();

function offerPayload(overrides: Record<string, unknown> = {}) {
  return {
    offerId: randomUUID(),
    currency: "ARS",
    quotedAt: "2026-09-11T12:00:00.000Z",
    validUntil: "2026-09-12T12:00:00.000Z",
    lines: [
      {
        productId: "SKU-1",
        description: "Producto",
        unit: "unit",
        quantity: "10",
        unitPrice: "100.00",
        lineTotal: "1000.00",
      },
    ],
    subtotal: "1000.00",
    taxes: "210.00",
    shipping: "0.00",
    discount: "0.00",
    total: "1210.00",
    confirmedStock: true,
    deliveryDate: "2026-09-18",
    paymentTerms: "PREPAID",
    notes: null,
    ...overrides,
  };
}

const mandate = {
  maximumTotalIncludingFees: "1500.00",
  allowedSuppliers: [supplierId],
  expiresAt: "2026-09-12T18:00:00.000Z",
  currency: "ARS" as const,
};

describe("evaluateOfferAgainstMandate", () => {
  it("accepts an eligible offer", () => {
    const result = evaluateOfferAgainstMandate(
      { id: randomUUID(), supplierCompanyId: supplierId, payload: offerPayload() },
      mandate,
      new Date("2026-09-11T14:00:00.000Z"),
    );
    expect(result).toEqual({ eligible: true, reasons: [] });
  });

  it("uses decimal-safe comparisons and rejects totals above the mandate", () => {
    const result = evaluateOfferAgainstMandate(
      {
        id: randomUUID(),
        supplierCompanyId: supplierId,
        payload: offerPayload({ total: "1500.000001" }),
      },
      mandate,
      new Date("2026-09-11T14:00:00.000Z"),
    );
    expect(result.reasons).toContain("MANDATE_TOTAL_EXCEEDED");
  });

  it("rejects expired and unconfirmed offers", () => {
    const result = evaluateOfferAgainstMandate(
      {
        id: randomUUID(),
        supplierCompanyId: supplierId,
        payload: offerPayload({ confirmedStock: false }),
      },
      mandate,
      new Date("2026-09-13T14:00:00.000Z"),
    );
    expect(result.reasons).toEqual(
      expect.arrayContaining(["STOCK_NOT_CONFIRMED", "OFFER_EXPIRED", "MANDATE_EXPIRED"]),
    );
  });
});
