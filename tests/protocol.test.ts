import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { protocolMessageSchema } from "@/modules/protocol/domain/message";

function validOfferMessage() {
  return {
    messageId: randomUUID(),
    protocolVersion: "1.0",
    type: "offer",
    senderCompanyId: randomUUID(),
    recipientCompanyId: randomUUID(),
    purchaseRequestId: randomUUID(),
    negotiationId: randomUUID(),
    correlationId: null,
    sentAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    idempotencyKey: `offer:${randomUUID()}`,
    payload: {
      offerId: randomUUID(),
      currency: "ARS",
      quotedAt: new Date().toISOString(),
      validUntil: new Date(Date.now() + 60_000).toISOString(),
      lines: [
        {
          productId: "SKU-1",
          description: "Producto",
          unit: "unit",
          quantity: "10.000000",
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
    },
  };
}

describe("protocolMessageSchema", () => {
  it("accepts a valid v1 offer", () => {
    expect(protocolMessageSchema.safeParse(validOfferMessage()).success).toBe(true);
  });

  it("rejects unknown protocol versions", () => {
    const message = validOfferMessage();
    message.protocolVersion = "2.0";
    expect(protocolMessageSchema.safeParse(message).success).toBe(false);
  });

  it("rejects incomplete offer payloads", () => {
    const message = validOfferMessage();
    delete (message.payload as Partial<typeof message.payload>).total;
    expect(protocolMessageSchema.safeParse(message).success).toBe(false);
  });

  it("accepts a final offer that explicitly declares every unavailable line", () => {
    const message = validOfferMessage();
    message.type = "final_offer";
    message.payload.lines = [];
    Object.assign(message.payload, {
      unavailableItems: [
        {
          requestItemId: randomUUID(),
          productId: "SKU-1",
          availableQuantity: "0",
          reason: "Sin stock confirmado para esta ronda.",
        },
      ],
      subtotal: "0.00",
      taxes: "0.00",
      total: "0.00",
      confirmedStock: false,
    });
    expect(protocolMessageSchema.safeParse(message).success).toBe(true);
  });
});
