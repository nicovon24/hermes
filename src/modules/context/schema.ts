import { z } from "zod";

const quantitySchema = z
  .string()
  .regex(/^\d{1,18}(?:\.\d{1,6})?$/, "Usá un número decimal positivo");

const moneySchema = z
  .string()
  .regex(/^\d{1,18}(?:\.\d{1,2})?$/, "Usá un importe con hasta dos decimales");

const sourceSchema = z.object({
  companyId: z.uuid(),
  sourceKind: z.enum(["ERP", "MANUAL", "EXTERNAL_API"]),
  sourceExternalId: z.string().min(1).max(160),
  sourceVersion: z.string().min(1).max(160),
  observedAt: z.string().datetime({ offset: true }),
});

const productSchema = z.object({
  productExternalId: z.string().min(1).max(160),
  productName: z.string().min(1).max(300),
  unit: z.string().min(1).max(40),
});

export const recordInventorySnapshotSchema = sourceSchema
  .merge(productSchema)
  .extend({
    onHand: quantitySchema,
    reserved: quantitySchema,
    inTransit: quantitySchema,
  });

export const recordSaleSchema = sourceSchema.merge(productSchema).extend({
  externalEventId: z.string().min(1).max(160),
  quantity: quantitySchema,
  unitPrice: moneySchema,
  soldAt: z.string().datetime({ offset: true }),
});

export type RecordInventorySnapshotInput = z.infer<
  typeof recordInventorySnapshotSchema
>;
export type RecordSaleInput = z.infer<typeof recordSaleSchema>;
