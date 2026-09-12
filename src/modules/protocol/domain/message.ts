import { z } from "zod";

export const PROTOCOL_VERSION = "1.0" as const;

export const messageTypes = [
  "request_for_quote",
  "offer",
  "counteroffer",
  "availability_update",
  "best_and_final_request",
  "final_offer",
  "acceptance",
  "rejection",
  "purchase_order",
  "payment_status",
  "receipt_confirmation",
] as const;

export const purchaseRequestStates = [
  "DRAFT",
  "AWAITING_APPROVAL",
  "APPROVED",
  "NEGOTIATING",
  "RECOMMENDED",
  "POLICY_VALIDATED",
  "FUNDS_RESERVED",
  "OFFER_ACCEPTED",
  "PARTIALLY_ORDERED",
  "ORDER_CREATED",
  "PAYMENT_PENDING",
  "PAYMENT_CONFIRMED",
  "PAYMENT_REVIEW_REQUIRED",
  "RECONCILED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
  "REAPPROVAL_REQUIRED",
] as const;

export const decimalStringSchema = z
  .string()
  .regex(/^\d{1,18}(?:\.\d{1,6})?$/, "Use a positive decimal string");

const lineSchema = z.object({
  requestItemId: z.uuid().optional(),
  productId: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  unit: z.string().min(1).max(40),
  quantity: decimalStringSchema,
  unitPrice: decimalStringSchema,
  lineTotal: decimalStringSchema,
  taxes: decimalStringSchema.optional(),
  shipping: decimalStringSchema.optional(),
  total: decimalStringSchema.optional(),
  confirmedStock: z.boolean().optional(),
  deliveryDate: z.iso.date().optional(),
});

const unavailableItemSchema = z.object({
  requestItemId: z.uuid().optional(),
  productId: z.string().min(1).max(120),
  reason: z.string().min(1).max(500),
  availableQuantity: decimalStringSchema.optional(),
});

const offerPayloadSchema = z.object({
  offerId: z.uuid(),
  tenderRoundId: z.uuid().optional(),
  currency: z.literal("ARS"),
  quotedAt: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }),
  lines: z.array(lineSchema).max(100),
  unavailableItems: z.array(unavailableItemSchema).max(100).default([]),
  subtotal: decimalStringSchema,
  taxes: decimalStringSchema,
  shipping: decimalStringSchema,
  discount: decimalStringSchema,
  total: decimalStringSchema,
  confirmedStock: z.boolean(),
  deliveryDate: z.iso.date(),
  paymentTerms: z.string().min(1).max(200),
  notes: z.string().max(2_000).nullable().default(null),
});

const requestForQuotePayloadSchema = z.object({
  items: z
    .array(
      z.object({
        requestItemId: z.uuid().optional(),
        productId: z.string().min(1).max(120),
        description: z.string().min(1).max(500),
        unit: z.string().min(1).max(40),
        minimumQuantity: decimalStringSchema,
        targetQuantity: decimalStringSchema,
        maximumQuantity: decimalStringSchema,
      }),
    )
    .min(1)
    .max(100),
  requiredBy: z.iso.date(),
  paymentTerms: z.string().min(1).max(200),
  notes: z.string().max(2_000).nullable().default(null),
});

const payloadSchemas: Record<(typeof messageTypes)[number], z.ZodType> = {
  request_for_quote: requestForQuotePayloadSchema,
  offer: offerPayloadSchema,
  counteroffer: offerPayloadSchema,
  availability_update: z.object({
    productId: z.string().min(1),
    availableQuantity: decimalStringSchema,
    observedAt: z.string().datetime({ offset: true }),
  }),
  best_and_final_request: z.object({
    responseRequiredBy: z.string().datetime({ offset: true }),
    notes: z.string().max(2_000).nullable().default(null),
  }),
  final_offer: offerPayloadSchema,
  acceptance: z.object({
    offerId: z.uuid(),
    mandateId: z.uuid(),
    acceptedTotal: decimalStringSchema,
    currency: z.literal("ARS"),
  }),
  rejection: z.object({
    reasonCode: z.string().min(1).max(80),
    explanation: z.string().max(2_000).nullable().default(null),
  }),
  purchase_order: z.object({
    purchaseOrderId: z.uuid(),
    offerId: z.uuid(),
    externalReference: z.string().min(1).max(160),
  }),
  payment_status: z.object({
    paymentId: z.string().min(1).max(191),
    status: z.enum([
      "RESERVED",
      "SUBMITTED",
      "PENDING_CONFIRMATION",
      "CONFIRMED",
      "FAILED",
      "REFUNDED",
    ]),
    transactionReference: z.string().max(240).nullable().default(null),
  }),
  receipt_confirmation: z.object({
    purchaseOrderId: z.uuid(),
    receivedAt: z.string().datetime({ offset: true }),
    discrepancies: z.array(z.string().max(500)).max(100),
  }),
};

export const protocolMessageSchema = z
  .object({
    messageId: z.uuid(),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.enum(messageTypes),
    senderCompanyId: z.uuid(),
    recipientCompanyId: z.uuid(),
    purchaseRequestId: z.uuid(),
    negotiationId: z.uuid(),
    tenderRoundId: z.uuid().nullable().optional(),
    correlationId: z.uuid().nullable().default(null),
    sentAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).nullable().default(null),
    idempotencyKey: z.string().min(8).max(160),
    payload: z.record(z.string(), z.unknown()),
  })
  .superRefine((message, context) => {
    const result = payloadSchemas[message.type].safeParse(message.payload);
    if (result.success) return;

    result.error.issues.forEach((issue) => {
      context.addIssue({
        ...issue,
        path: ["payload", ...issue.path],
      });
    });
  });

export type ProtocolMessage = z.infer<typeof protocolMessageSchema>;

export function parseOfferPayload(payload: Record<string, unknown>) {
  return offerPayloadSchema.parse(payload);
}
