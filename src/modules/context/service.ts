import "server-only";

import type { Actor } from "@/lib/demo-workspace";
import { DomainError } from "@/lib/domain/errors";
import { serializableTransaction } from "@/lib/prisma";
import {
  recordInventorySnapshotSchema,
  recordSaleSchema,
  type RecordInventorySnapshotInput,
  type RecordSaleInput,
} from "@/modules/context/schema";

function ensureSameCompany(actor: Actor, companyId: string) {
  if (actor.companyId !== companyId) {
    throw new DomainError("Company mismatch", "FORBIDDEN", 403);
  }
}

export async function recordInventorySnapshot(
  actor: Actor,
  unsafeInput: RecordInventorySnapshotInput,
) {
  const input = recordInventorySnapshotSchema.parse(unsafeInput);
  ensureSameCompany(actor, input.companyId);
  return serializableTransaction(
    async (tx) => {
      const observedAt = new Date(input.observedAt);
      const previousSource = await tx.contextSource.findUnique({
        where: {
          companyId_externalId: {
            companyId: input.companyId,
            externalId: input.sourceExternalId,
          },
        },
      });
      const source = await tx.contextSource.upsert({
        where: {
          companyId_externalId: {
            companyId: input.companyId,
            externalId: input.sourceExternalId,
          },
        },
        create: {
          companyId: input.companyId,
          kind: input.sourceKind,
          externalId: input.sourceExternalId,
          lastVersion: input.sourceVersion,
          lastObservedAt: observedAt,
        },
        update: {
          kind: input.sourceKind,
          lastVersion: input.sourceVersion,
          lastObservedAt:
            previousSource && previousSource.lastObservedAt > observedAt
              ? previousSource.lastObservedAt
              : observedAt,
        },
      });
      const product = await tx.product.upsert({
        where: {
          companyId_externalId: {
            companyId: input.companyId,
            externalId: input.productExternalId,
          },
        },
        create: {
          companyId: input.companyId,
          externalId: input.productExternalId,
          name: input.productName,
          unit: input.unit,
        },
        update: { name: input.productName, unit: input.unit },
      });
      const existing = await tx.inventorySnapshot.findUnique({
        where: {
          sourceId_productId_sourceVersion: {
            sourceId: source.id,
            productId: product.id,
            sourceVersion: input.sourceVersion,
          },
        },
      });
      if (existing) return existing.id;

      const snapshot = await tx.inventorySnapshot.create({
        data: {
          companyId: input.companyId,
          sourceId: source.id,
          productId: product.id,
          sourceVersion: input.sourceVersion,
          onHand: input.onHand,
          reserved: input.reserved,
          inTransit: input.inTransit,
          observedAt,
        },
      });
      await tx.contextEvent.create({
        data: {
          companyId: input.companyId,
          eventType: "inventory.updated",
          aggregateId: snapshot.id,
          sourceId: source.id,
          payload: {
            snapshotId: snapshot.id,
            productId: product.id,
            sourceVersion: input.sourceVersion,
            actorId: actor.actorId,
          },
        },
      });
      return snapshot.id;
    },
  );
}

export async function recordSale(actor: Actor, unsafeInput: RecordSaleInput) {
  const input = recordSaleSchema.parse(unsafeInput);
  ensureSameCompany(actor, input.companyId);
  return serializableTransaction(
    async (tx) => {
      const soldAt = new Date(input.soldAt);
      const previousSource = await tx.contextSource.findUnique({
        where: {
          companyId_externalId: {
            companyId: input.companyId,
            externalId: input.sourceExternalId,
          },
        },
      });
      const source = await tx.contextSource.upsert({
        where: {
          companyId_externalId: {
            companyId: input.companyId,
            externalId: input.sourceExternalId,
          },
        },
        create: {
          companyId: input.companyId,
          kind: input.sourceKind,
          externalId: input.sourceExternalId,
          lastVersion: input.sourceVersion,
          lastObservedAt: soldAt,
        },
        update: {
          kind: input.sourceKind,
          lastVersion: input.sourceVersion,
          lastObservedAt:
            previousSource && previousSource.lastObservedAt > soldAt
              ? previousSource.lastObservedAt
              : soldAt,
        },
      });
      const product = await tx.product.upsert({
        where: {
          companyId_externalId: {
            companyId: input.companyId,
            externalId: input.productExternalId,
          },
        },
        create: {
          companyId: input.companyId,
          externalId: input.productExternalId,
          name: input.productName,
          unit: input.unit,
        },
        update: { name: input.productName, unit: input.unit },
      });
      const existing = await tx.salesEvent.findUnique({
        where: {
          sourceId_externalEventId: {
            sourceId: source.id,
            externalEventId: input.externalEventId,
          },
        },
      });
      if (existing) return existing.id;

      const sale = await tx.salesEvent.create({
        data: {
          companyId: input.companyId,
          sourceId: source.id,
          productId: product.id,
          externalEventId: input.externalEventId,
          sourceVersion: input.sourceVersion,
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          soldAt,
          observedAt: new Date(),
        },
      });
      await tx.contextEvent.create({
        data: {
          companyId: input.companyId,
          eventType: "sale.completed",
          aggregateId: sale.id,
          sourceId: source.id,
          payload: {
            saleId: sale.id,
            productId: product.id,
            sourceVersion: input.sourceVersion,
            actorId: actor.actorId,
          },
        },
      });
      return sale.id;
    },
  );
}
