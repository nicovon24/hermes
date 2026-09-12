import "server-only";

import { Prisma } from "@prisma/client";

import type { Actor } from "@/lib/demo-workspace";
import { DomainError } from "@/lib/domain/errors";
import { serializableTransaction } from "@/lib/prisma";
import {
  approvePurchaseRequestSchema,
  createPurchaseRequestSchema,
  type ApprovePurchaseRequestInput,
  type CreatePurchaseRequestInput,
} from "@/modules/protocol/domain/commands";

function translatePrismaError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002" || error.code === "P2034") {
      throw new DomainError("The operation conflicts with another change", "CONFLICT", 409);
    }
  }
  throw error;
}

export async function createPurchaseRequest(
  actor: Actor,
  unsafeInput: CreatePurchaseRequestInput,
  requestId?: string,
) {
  const input = createPurchaseRequestSchema.parse(unsafeInput);
  if (actor.companyId !== input.buyerCompanyId) {
    throw new DomainError("Buyer company mismatch", "FORBIDDEN", 403);
  }

  try {
    return await serializableTransaction(
      async (tx) => {
        // A client-generated UUID survives double clicks and uncertain responses.
        if (requestId) {
          await tx.$queryRaw`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))::text`;
          const existing = await tx.purchaseRequest.findUnique({ where: { id: requestId } });
          if (existing) {
            if (existing.buyerCompanyId !== actor.companyId) {
              throw new DomainError("Purchase request not found", "NOT_FOUND", 404);
            }
            return existing.id;
          }
        }
        const request = await tx.purchaseRequest.create({
          data: {
            ...(requestId ? { id: requestId } : {}),
            buyerCompanyId: input.buyerCompanyId,
            status: "AWAITING_APPROVAL",
            currency: input.currency,
            requiredBy: new Date(`${input.requiredBy}T00:00:00.000Z`),
            expiresAt: new Date(input.expiresAt),
            createdBy: actor.actorId,
            items: {
              create: input.items.map((item) => ({
                productId: item.productId,
                description: item.description,
                unit: item.unit,
                minimumQuantity: item.minimumQuantity,
                targetQuantity: item.targetQuantity,
                maximumQuantity: item.maximumQuantity,
                urgencyScore: item.urgencyScore ?? 999999,
              })),
            },
          },
        });
        await Promise.all([
          tx.domainEvent.create({
            data: {
              aggregateType: "purchase_request",
              aggregateId: request.id,
              eventType: "purchase_request.approval_required",
              payload: {
                purchaseRequestId: request.id,
                buyerCompanyId: input.buyerCompanyId,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              companyId: input.buyerCompanyId,
              actorType: actor.actorType,
              actorId: actor.actorId,
              action: "purchase_request.created",
              aggregateType: "purchase_request",
              aggregateId: request.id,
            },
          }),
        ]);
        return request.id;
      },
    );
  } catch (error) {
    translatePrismaError(error);
  }
}

export async function approvePurchaseRequest(
  actor: Actor,
  unsafeInput: ApprovePurchaseRequestInput,
) {
  const parsed = approvePurchaseRequestSchema.parse(unsafeInput);
  if (actor.companyId !== parsed.buyerCompanyId) {
    throw new DomainError("Buyer company mismatch", "FORBIDDEN", 403);
  }
  const input = parsed.autoPay
    ? { ...parsed, paymentTerms: "CONTADO", settlementAsset: "ARGt" }
    : parsed;
  if (new Date(input.expiresAt) <= new Date()) {
    throw new DomainError("Mandate must expire in the future", "VALIDATION_ERROR", 400);
  }

  try {
    return await serializableTransaction(
      async (tx) => {
        await tx.$queryRaw`select id from public.purchase_requests where id = ${input.purchaseRequestId}::uuid for update`;
        const request = await tx.purchaseRequest.findUnique({
          where: { id: input.purchaseRequestId },
          include: { mandates: { select: { version: true } } },
        });
        if (!request || request.buyerCompanyId !== input.buyerCompanyId) {
          throw new DomainError("Purchase request not found", "NOT_FOUND", 404);
        }
        if (request.status !== "AWAITING_APPROVAL") {
          throw new DomainError(
            `Purchase request cannot be approved from state ${request.status}`,
            "CONFLICT",
            409,
          );
        }
        const mandate = await tx.mandate.create({
          data: {
            purchaseRequestId: request.id,
            buyerCompanyId: input.buyerCompanyId,
            approvedBy: actor.actorId,
            version: Math.max(0, ...request.mandates.map(({ version }) => version)) + 1,
            currency: request.currency,
            maximumTotalIncludingFees: input.maximumTotalIncludingFees,
            allowedSuppliers: input.allowedSuppliers,
            paymentTerms: input.paymentTerms,
            settlementAsset: input.settlementAsset,
            autoAccept: input.autoAccept,
            autoPay: input.autoPay,
            expiresAt: new Date(input.expiresAt),
          },
        });
        await tx.negotiation.createMany({
          data: input.allowedSuppliers.map((supplierCompanyId) => ({
            purchaseRequestId: request.id,
            buyerCompanyId: input.buyerCompanyId,
            supplierCompanyId,
          })),
          skipDuplicates: true,
        });
        await tx.purchaseRequest.update({
          where: { id: request.id },
          data: { status: "NEGOTIATING", version: { increment: 1 } },
        });
        await Promise.all([
          tx.domainEvent.create({
            data: {
              aggregateType: "purchase_request",
              aggregateId: request.id,
              eventType: "purchase_request.approved",
              payload: {
                purchaseRequestId: request.id,
                mandateId: mandate.id,
                allowedSuppliers: input.allowedSuppliers,
                autoPay: input.autoPay,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              companyId: input.buyerCompanyId,
              actorType: actor.actorType,
              actorId: actor.actorId,
              action: "purchase_request.approved",
              aggregateType: "purchase_request",
              aggregateId: request.id,
              metadata: { mandateId: mandate.id, autoPay: input.autoPay },
            },
          }),
        ]);
        return mandate.id;
      },
    );
  } catch (error) {
    if (error instanceof DomainError) throw error;
    translatePrismaError(error);
  }
}
