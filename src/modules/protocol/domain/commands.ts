import { z } from "zod";

import { decimalStringSchema } from "@/modules/protocol/domain/message";

export const createPurchaseRequestSchema = z.object({
  buyerCompanyId: z.uuid(),
  currency: z.literal("ARS").default("ARS"),
  requiredBy: z.iso.date(),
  expiresAt: z.string().datetime({ offset: true }),
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(120),
        description: z.string().min(1).max(500),
        unit: z.string().min(1).max(40),
        minimumQuantity: decimalStringSchema,
        targetQuantity: decimalStringSchema,
        maximumQuantity: decimalStringSchema,
        urgencyScore: z.number().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(100),
});

export const approvePurchaseRequestSchema = z.object({
  purchaseRequestId: z.uuid(),
  buyerCompanyId: z.uuid(),
  maximumTotalIncludingFees: decimalStringSchema,
  allowedSuppliers: z.array(z.uuid()).min(1).max(10),
  paymentTerms: z.string().min(1).max(200),
  settlementAsset: z.string().min(1).max(80),
  autoAccept: z.boolean().default(false),
  autoPay: z.boolean().default(false),
  expiresAt: z.string().datetime({ offset: true }),
});

export type CreatePurchaseRequestInput = z.infer<
  typeof createPurchaseRequestSchema
>;
export type ApprovePurchaseRequestInput = z.infer<
  typeof approvePurchaseRequestSchema
>;
