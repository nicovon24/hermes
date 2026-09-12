import "server-only";

import { Prisma } from "@prisma/client";

import { rankEligibleOffers, type AgentOffer } from "@/modules/protocol/agent/groq";
import type { Actor } from "@/lib/demo-workspace";
import { DomainError } from "@/lib/domain/errors";
import { prisma, serializableTransaction } from "@/lib/prisma";
import { evaluateOfferAgainstMandate } from "@/modules/protocol/domain/policy";
import {
  parseOfferPayload,
  protocolMessageSchema,
  type ProtocolMessage,
} from "@/modules/protocol/domain/message";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function appendProtocolMessage(
  actor: Actor,
  unsafeMessage: ProtocolMessage,
) {
  const message = protocolMessageSchema.parse(unsafeMessage);
  if (["acceptance", "purchase_order", "payment_status"].includes(message.type)) {
    throw new DomainError(
      "This message type requires a dedicated policy-validated command",
      "CONFLICT",
      409,
    );
  }
  if (message.senderCompanyId !== actor.companyId) {
    throw new DomainError("Sender company mismatch", "FORBIDDEN", 403);
  }

  return serializableTransaction(
    async (tx) => {
      const existing = await tx.negotiationMessage.findUnique({
        where: {
          senderCompanyId_idempotencyKey: {
            senderCompanyId: message.senderCompanyId,
            idempotencyKey: message.idempotencyKey,
          },
        },
      });
      if (existing) return { messageId: existing.id, duplicate: true };

      await tx.$queryRaw`select id from public.negotiations where id = ${message.negotiationId}::uuid for update`;
      const negotiation = await tx.negotiation.findUnique({
        where: { id: message.negotiationId },
      });
      if (!negotiation || negotiation.purchaseRequestId !== message.purchaseRequestId) {
        throw new DomainError("Negotiation not found", "NOT_FOUND", 404);
      }
      const participants = [negotiation.buyerCompanyId, negotiation.supplierCompanyId];
      if (
        !participants.includes(message.senderCompanyId) ||
        !participants.includes(message.recipientCompanyId) ||
        message.senderCompanyId === message.recipientCompanyId
      ) {
        throw new DomainError("Invalid negotiation participants", "FORBIDDEN", 403);
      }
      if (
        ["offer", "final_offer", "availability_update"].includes(message.type) &&
        message.senderCompanyId !== negotiation.supplierCompanyId
      ) {
        throw new DomainError("Only the supplier can send this message type", "FORBIDDEN", 403);
      }
      if (
        ["request_for_quote", "best_and_final_request", "receipt_confirmation"].includes(
          message.type,
        ) && message.senderCompanyId !== negotiation.buyerCompanyId
      ) {
        throw new DomainError("Only the buyer can send this message type", "FORBIDDEN", 403);
      }

      await tx.negotiationMessage.create({
        data: {
          id: message.messageId,
          negotiationId: message.negotiationId,
          purchaseRequestId: message.purchaseRequestId,
          protocolVersion: message.protocolVersion,
          messageType: message.type,
          senderCompanyId: message.senderCompanyId,
          recipientCompanyId: message.recipientCompanyId,
          correlationId: message.correlationId,
          tenderRoundId: message.tenderRoundId,
          sentAt: new Date(message.sentAt),
          expiresAt: message.expiresAt ? new Date(message.expiresAt) : null,
          idempotencyKey: message.idempotencyKey,
          payload: json(message.payload),
          rawMessage: json(message),
        },
      });

      if (["offer", "counteroffer", "final_offer"].includes(message.type)) {
        const payload = parseOfferPayload(message.payload);
        await tx.offer.updateMany({
          where: { negotiationId: negotiation.id, status: "ACTIVE" },
          data: { status: "SUPERSEDED" },
        });
        const offer = await tx.offer.create({
          data: {
            id: payload.offerId,
            negotiationId: negotiation.id,
            purchaseRequestId: message.purchaseRequestId,
            supplierCompanyId: negotiation.supplierCompanyId,
            messageId: message.messageId,
            tenderRoundId: message.tenderRoundId ?? payload.tenderRoundId,
            currency: payload.currency,
            validUntil: new Date(payload.validUntil),
            subtotal: payload.subtotal,
            taxes: payload.taxes,
            shipping: payload.shipping,
            discount: payload.discount,
            total: payload.total,
            deliveryDate: new Date(`${payload.deliveryDate}T00:00:00.000Z`),
            paymentTerms: payload.paymentTerms,
            confirmedStock: payload.confirmedStock,
            payload: json(payload),
          },
        });
        const requestItems = await tx.purchaseRequestItem.findMany({
          where: { purchaseRequestId: message.purchaseRequestId },
          orderBy: { createdAt: "asc" },
        });
        const lineCount = Math.max(payload.lines.length, 1);
        const defaultTaxes = new Prisma.Decimal(payload.taxes).div(lineCount);
        const defaultShipping = new Prisma.Decimal(payload.shipping).div(lineCount);
        const normalized = payload.lines.flatMap((line) => {
          const requestItem = line.requestItemId
            ? requestItems.find(({ id }) => id === line.requestItemId)
            : requestItems.find(({ productId }) => productId === line.productId);
          if (!requestItem) return [];
          const subtotal = new Prisma.Decimal(line.lineTotal);
          const taxes = new Prisma.Decimal(line.taxes ?? defaultTaxes);
          const shipping = new Prisma.Decimal(line.shipping ?? defaultShipping);
          return [{
            offerId: offer.id,
            purchaseRequestId: message.purchaseRequestId,
            requestItemId: requestItem.id,
            productId: line.productId,
            description: line.description,
            unit: line.unit,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            subtotal,
            taxes,
            shipping,
            total: line.total ?? subtotal.plus(taxes).plus(shipping),
            confirmedStock: line.confirmedStock ?? payload.confirmedStock,
            deliveryDate: new Date(`${line.deliveryDate ?? payload.deliveryDate}T00:00:00.000Z`),
          }];
        });
        if (normalized.length) await tx.offerLine.createMany({ data: normalized, skipDuplicates: true });
        if (message.type === "final_offer") {
          await tx.negotiation.update({
            where: { id: negotiation.id },
            data: { status: "FINAL_OFFERED" },
          });
        }
      }

      await Promise.all([
        tx.domainEvent.create({
          data: {
            aggregateType: "negotiation",
            aggregateId: negotiation.id,
            eventType: `protocol.${message.type}`,
            payload: {
              messageId: message.messageId,
              negotiationId: negotiation.id,
              purchaseRequestId: message.purchaseRequestId,
              senderCompanyId: message.senderCompanyId,
              recipientCompanyId: message.recipientCompanyId,
            },
          },
        }),
        tx.auditLog.create({
          data: {
            companyId: message.senderCompanyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            action: `protocol.${message.type}`,
            aggregateType: "negotiation",
            aggregateId: negotiation.id,
            metadata: { messageId: message.messageId },
          },
        }),
      ]);
      return { messageId: message.messageId, duplicate: false };
    },
  );
}

async function recordRecommendation(input: {
  actor: Actor;
  purchaseRequestId: string;
  model: string;
  inputSnapshot: unknown;
  output: unknown;
  status: string;
}) {
  await serializableTransaction(
    async (tx) => {
      await tx.$queryRaw`select id from public.purchase_requests where id = ${input.purchaseRequestId}::uuid for update`;
      const run = await tx.agentRun.create({
        data: {
          companyId: input.actor.companyId,
          purchaseRequestId: input.purchaseRequestId,
          kind: "OFFER_RECOMMENDATION",
          provider: "GROQ",
          model: input.model,
          inputSnapshot: json(input.inputSnapshot),
          output: json(input.output),
          status: input.status,
          createdBy: input.actor.actorId,
        },
      });
      if (input.status === "SUCCEEDED") {
        await tx.purchaseRequest.updateMany({
          where: { id: input.purchaseRequestId, status: "NEGOTIATING" },
          data: { status: "RECOMMENDED", version: { increment: 1 } },
        });
      }
      await tx.domainEvent.create({
        data: {
          aggregateType: "purchase_request",
          aggregateId: input.purchaseRequestId,
          eventType: input.status === "SUCCEEDED"
            ? "negotiation.recommendation_ready"
            : "negotiation.recommendation_rejected",
          payload: { purchaseRequestId: input.purchaseRequestId, agentRunId: run.id },
        },
      });
    },
  );
}

export async function generateOfferRecommendation(
  actor: Actor,
  purchaseRequestId: string,
  buyerContext?: Record<string, unknown>,
) {
  const [request, mandate, negotiations, offers] = await Promise.all([
    prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } }),
    prisma.mandate.findFirst({ where: { purchaseRequestId, status: "ACTIVE" }, orderBy: { version: "desc" } }),
    prisma.negotiation.findMany({ where: { purchaseRequestId } }),
    prisma.offer.findMany({ where: { purchaseRequestId, status: "ACTIVE" } }),
  ]);
  if (!request || !mandate) {
    throw new DomainError("Request or active mandate not found", "NOT_FOUND", 404);
  }
  if (request.buyerCompanyId !== actor.companyId) {
    throw new DomainError("Only the buyer can request a recommendation", "FORBIDDEN", 403);
  }
  if (request.status !== "NEGOTIATING") {
    throw new DomainError("Recommendation requires a request in NEGOTIATING state", "CONFLICT", 409);
  }
  const finalSuppliers = new Set(
    negotiations.filter(({ status }) => status === "FINAL_OFFERED").map(({ supplierCompanyId }) => supplierCompanyId),
  );
  if (
    negotiations.length !== mandate.allowedSuppliers.length ||
    mandate.allowedSuppliers.some((supplierId) => !finalSuppliers.has(supplierId))
  ) {
    throw new DomainError("La recomendación necesita una oferta final de cada distribuidor", "CONFLICT", 409);
  }

  const mandateForPolicy = {
    maximumTotalIncludingFees: mandate.maximumTotalIncludingFees.toString(),
    allowedSuppliers: mandate.allowedSuppliers,
    expiresAt: mandate.expiresAt.toISOString(),
    currency: "ARS" as const,
  };
  const evaluated = offers.map((offer) => ({
    offer,
    decision: evaluateOfferAgainstMandate(
      { id: offer.id, supplierCompanyId: offer.supplierCompanyId, payload: offer.payload as Record<string, unknown> },
      mandateForPolicy,
    ),
  }));
  const eligible: AgentOffer[] = evaluated
    .filter(({ decision }) => decision.eligible)
    .map(({ offer }) => {
      const payload = parseOfferPayload(offer.payload as Record<string, unknown>);
      return {
        id: offer.id,
        supplierCompanyId: offer.supplierCompanyId,
        total: payload.total,
        deliveryDate: payload.deliveryDate,
        paymentTerms: payload.paymentTerms,
        confirmedStock: payload.confirmedStock,
      };
    });

  if (!eligible.length) {
    const output = {
      recommendedOfferId: null,
      summary: "No offer satisfies the active mandate.",
      ranking: [],
      rejectedOffers: evaluated.map(({ offer, decision }) => ({ offerId: offer.id, reasons: decision.reasons })),
    };
    await recordRecommendation({ actor, purchaseRequestId, model: "not_called", inputSnapshot: { mandateId: mandate.id, offers: evaluated }, output, status: "REJECTED_BY_POLICY" });
    return output;
  }

  let recommendation: Awaited<ReturnType<typeof rankEligibleOffers>>["recommendation"];
  let model: string;
  try {
    if (process.env.DISABLE_EXTERNAL_AGENT_CALLS === "true") throw new Error("External agent calls are disabled");
    ({ recommendation, model } = await rankEligibleOffers(eligible, buyerContext));
  } catch (error) {
    console.error("Recommendation agent unavailable; using policy ranking", error);
    const sorted = [...eligible].sort((left, right) => {
      const totals = new Prisma.Decimal(left.total).comparedTo(new Prisma.Decimal(right.total));
      return totals || left.deliveryDate.localeCompare(right.deliveryDate);
    });
    recommendation = {
      recommendedOfferId: sorted[0]?.id ?? null,
      summary: "Las ofertas finales elegibles fueron comparadas por costo total y entrega.",
      ranking: sorted.map((offer, index) => ({
        offerId: offer.id,
        position: index + 1,
        reason: `${offer.confirmedStock ? "Stock confirmado" : "Stock sin confirmar"}, total ARS ${offer.total} y entrega ${offer.deliveryDate}.`,
        warnings: offer.confirmedStock ? [] : ["Stock sin confirmar"],
      })),
    };
    model = "deterministic-policy-fallback";
  }
  const inputSnapshot = {
    mandateId: mandate.id,
    buyerContext,
    eligibleOffers: eligible,
    rejectedOffers: evaluated.filter(({ decision }) => !decision.eligible).map(({ offer, decision }) => ({ offerId: offer.id, reasons: decision.reasons })),
  };
  await recordRecommendation({ actor, purchaseRequestId, model, inputSnapshot, output: recommendation, status: "SUCCEEDED" });
  return recommendation;
}
