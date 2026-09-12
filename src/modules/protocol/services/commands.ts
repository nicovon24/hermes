import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { DomainError } from "@/lib/domain/errors";
import { serializableTransaction } from "@/lib/prisma";
import type { SplitAwardRecommendation } from "@/modules/protocol/domain/split-award";

function externalOrderReference(roundId: string, supplierId: string) {
  return `PO-${roundId.replaceAll("-", "").slice(0, 8).toUpperCase()}-${supplierId.replaceAll("-", "").slice(-6).toUpperCase()}`;
}

export async function startTenderRound(
  purchaseRequestId: string,
  buyerCompanyId: string,
  actorId: string,
) {
  return serializableTransaction(
    async (tx) => {
      await tx.$queryRaw`select id from public.purchase_requests where id = ${purchaseRequestId}::uuid for update`;
      const request = await tx.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
      if (!request || request.buyerCompanyId !== buyerCompanyId) {
        throw new DomainError("Purchase request not found", "NOT_FOUND", 404);
      }
      if (!["NEGOTIATING", "PARTIALLY_ORDERED"].includes(request.status)) {
        throw new DomainError(`Tender round cannot start from ${request.status}`, "CONFLICT", 409);
      }
      const existing = await tx.tenderRound.findFirst({
        where: { purchaseRequestId, status: "OPEN" },
      });
      if (existing) return existing.id;
      const pending = await tx.purchaseRequestItem.findMany({
        where: { purchaseRequestId, status: "PENDING" },
        orderBy: [{ urgencyScore: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      if (!pending.length) throw new DomainError("No pending request items", "CONFLICT", 409);
      const lastRound = await tx.tenderRound.findFirst({
        where: { purchaseRequestId },
        orderBy: { roundNumber: "desc" },
        select: { roundNumber: true },
      });
      const round = await tx.tenderRound.create({
        data: {
          purchaseRequestId,
          roundNumber: (lastRound?.roundNumber ?? 0) + 1,
          requestItemIds: pending.map(({ id }) => id),
        },
      });
      await Promise.all([
        tx.purchaseRequest.update({
          where: { id: purchaseRequestId },
          data: { status: "NEGOTIATING", version: { increment: 1 } },
        }),
        tx.negotiation.updateMany({ where: { purchaseRequestId }, data: { status: "OPEN" } }),
        tx.auditLog.create({
          data: {
            companyId: buyerCompanyId,
            actorType: "USER",
            actorId,
            action: "tender.round_started",
            aggregateType: "purchase_request",
            aggregateId: purchaseRequestId,
            metadata: { tenderRoundId: round.id, roundNumber: round.roundNumber },
          },
        }),
      ]);
      return round.id;
    },
  );
}

export async function recordSplitAwardAndOrders(input: {
  purchaseRequestId: string;
  buyerCompanyId: string;
  tenderRoundId: string;
  actorId: string;
  recommendation: SplitAwardRecommendation & Record<string, unknown>;
}) {
  return serializableTransaction(
    async (tx) => {
      await tx.$queryRaw`select id from public.purchase_requests where id = ${input.purchaseRequestId}::uuid for update`;
      await tx.$queryRaw`select id from public.mandates where purchase_request_id = ${input.purchaseRequestId}::uuid and status = 'ACTIVE' for update`;
      const request = await tx.purchaseRequest.findUnique({ where: { id: input.purchaseRequestId } });
      if (!request || request.buyerCompanyId !== input.buyerCompanyId) {
        throw new DomainError("Purchase request not found", "NOT_FOUND", 404);
      }
      if (request.status === "ORDER_CREATED" || request.status === "PAYMENT_CONFIRMED") {
        const orders = await tx.purchaseOrder.findMany({ where: { tenderRoundId: input.tenderRoundId } });
        return { status: request.status, pendingItems: 0, orders };
      }
      const mandate = await tx.mandate.findFirst({
        where: { purchaseRequestId: input.purchaseRequestId, status: "ACTIVE" },
        orderBy: { version: "desc" },
      });
      if (!mandate?.autoAccept || mandate.expiresAt <= new Date()) {
        throw new DomainError("Active automatic-order mandate not found", "CONFLICT", 409);
      }
      const previousRun = await tx.agentRun.findFirst({
        where: { purchaseRequestId: input.purchaseRequestId, kind: "OFFER_RECOMMENDATION" },
        select: { output: true },
      });
      const priorRound = previousRun?.output && typeof previousRun.output === "object"
        ? (previousRun.output as Record<string, unknown>).tenderRoundId
        : null;
      if (priorRound !== input.tenderRoundId) {
        await tx.agentRun.create({
          data: {
            companyId: input.buyerCompanyId,
            purchaseRequestId: input.purchaseRequestId,
            kind: "OFFER_RECOMMENDATION",
            provider: "POLICY",
            model: "deterministic-split-award-v2",
            inputSnapshot: { tenderRoundId: input.tenderRoundId },
            output: JSON.parse(JSON.stringify(input.recommendation)) as Prisma.InputJsonValue,
            status: "SUCCEEDED",
            createdBy: input.actorId,
          },
        });
      }

      let spent = (await tx.purchaseOrder.findMany({
        where: { purchaseRequestId: input.purchaseRequestId, status: "CREATED" },
        select: { total: true },
      })).reduce((sum, order) => sum.plus(order.total), new Prisma.Decimal(0));

      for (const allocation of input.recommendation.allocations) {
        await tx.$queryRaw`select id from public.purchase_request_items where id = ${allocation.requestItemId}::uuid for update`;
        const line = await tx.offerLine.findUnique({
          where: { id: allocation.offerLineId },
          include: { offer: true, requestItem: true },
        });
        if (
          !line ||
          line.requestItemId !== allocation.requestItemId ||
          line.purchaseRequestId !== input.purchaseRequestId ||
          line.offer.supplierCompanyId !== allocation.supplierCompanyId ||
          line.offer.status !== "ACTIVE" ||
          line.offer.validUntil <= new Date() ||
          !line.confirmedStock ||
          line.deliveryDate > request.requiredBy ||
          !mandate.allowedSuppliers.includes(line.offer.supplierCompanyId)
        ) {
          throw new DomainError("Allocation failed policy validation", "CONFLICT", 409);
        }
        if (line.requestItem.status !== "PENDING") continue;
        if (spent.plus(line.total).greaterThan(mandate.maximumTotalIncludingFees)) {
          await tx.purchaseRequestItem.update({
            where: { id: line.requestItemId },
            data: { pendingReason: "PRESUPUESTO_INSUFICIENTE" },
          });
          continue;
        }
        const uniqueOrder = {
          tenderRoundId_supplierCompanyId: {
            tenderRoundId: input.tenderRoundId,
            supplierCompanyId: line.offer.supplierCompanyId,
          },
        };
        const currentOrder = await tx.purchaseOrder.findUnique({ where: uniqueOrder });
        const order = currentOrder
          ? await tx.purchaseOrder.update({
              where: uniqueOrder,
              data: { deliveryDate: currentOrder.deliveryDate > line.deliveryDate ? currentOrder.deliveryDate : line.deliveryDate },
            })
          : await tx.purchaseOrder.create({
              data: {
                purchaseRequestId: input.purchaseRequestId,
                tenderRoundId: input.tenderRoundId,
                buyerCompanyId: input.buyerCompanyId,
                supplierCompanyId: line.offer.supplierCompanyId,
                offerId: line.offerId,
                deliveryDate: line.deliveryDate,
                paymentTerms: line.offer.paymentTerms,
                externalReference: externalOrderReference(input.tenderRoundId, line.offer.supplierCompanyId),
              },
            });
        const existingItem = await tx.purchaseOrderItem.findUnique({ where: { requestItemId: line.requestItemId } });
        if (existingItem) continue;
        await tx.purchaseOrderItem.create({
          data: {
            purchaseOrderId: order.id,
            requestItemId: line.requestItemId,
            offerLineId: line.id,
            productId: line.productId,
            description: line.description,
            unit: line.unit,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            subtotal: line.subtotal,
            taxes: line.taxes,
            shipping: line.shipping,
            total: line.total,
          },
        });
        spent = spent.plus(line.total);
        await tx.purchaseRequestItem.update({
          where: { id: line.requestItemId },
          data: { status: "AWARDED", pendingReason: null, awardedAt: new Date() },
        });
      }

      for (const pending of input.recommendation.pendingItems) {
        await tx.purchaseRequestItem.updateMany({
          where: { id: pending.requestItemId, status: "PENDING" },
          data: { pendingReason: pending.reason || "SIN_COBERTURA_CONFIRMADA" },
        });
      }
      const orders = await tx.purchaseOrder.findMany({
        where: { purchaseRequestId: input.purchaseRequestId },
        include: { items: { include: { offerLine: true } } },
      });
      for (const order of orders) {
        const totals = order.items.reduce(
          (value, item) => ({
            subtotal: value.subtotal.plus(item.subtotal),
            taxes: value.taxes.plus(item.taxes),
            shipping: value.shipping.plus(item.shipping),
            total: value.total.plus(item.total),
            deliveryDate: value.deliveryDate > item.offerLine.deliveryDate ? value.deliveryDate : item.offerLine.deliveryDate,
          }),
          { subtotal: new Prisma.Decimal(0), taxes: new Prisma.Decimal(0), shipping: new Prisma.Decimal(0), total: new Prisma.Decimal(0), deliveryDate: order.deliveryDate },
        );
        await tx.purchaseOrder.update({ where: { id: order.id }, data: totals });
      }

      const pendingItems = await tx.purchaseRequestItem.count({
        where: { purchaseRequestId: input.purchaseRequestId, status: "PENDING" },
      });
      const status = pendingItems === 0 ? "ORDER_CREATED" : "PARTIALLY_ORDERED";
      await Promise.all([
        tx.tenderRound.update({
          where: { id: input.tenderRoundId },
          data: { status: pendingItems === 0 ? "COMPLETED" : "PARTIAL", completedAt: new Date() },
        }),
        tx.purchaseRequest.update({
          where: { id: input.purchaseRequestId },
          data: { status, version: { increment: 1 } },
        }),
      ]);
      const roundOrders = await tx.purchaseOrder.findMany({ where: { tenderRoundId: input.tenderRoundId } });
      const winners = new Set(roundOrders.map(({ supplierCompanyId }) => supplierCompanyId));
      for (const negotiation of await tx.negotiation.findMany({ where: { purchaseRequestId: input.purchaseRequestId } })) {
        await tx.negotiation.update({
          where: { id: negotiation.id },
          data: {
            status: winners.has(negotiation.supplierCompanyId)
              ? pendingItems === 0 ? "ACCEPTED" : "PARTIALLY_AWARDED"
              : pendingItems === 0 ? "REJECTED" : "FINAL_OFFERED",
          },
        });
      }
      if (pendingItems === 0) {
        await tx.mandate.update({ where: { id: mandate.id }, data: { status: "CONSUMED" } });
      }
      for (const order of roundOrders) {
        const negotiation = await tx.negotiation.findUniqueOrThrow({
          where: { purchaseRequestId_supplierCompanyId: { purchaseRequestId: input.purchaseRequestId, supplierCompanyId: order.supplierCompanyId } },
        });
        const idempotencyKey = `purchase-order:${order.id}`;
        const existing = await tx.negotiationMessage.findUnique({
          where: { senderCompanyId_idempotencyKey: { senderCompanyId: input.buyerCompanyId, idempotencyKey } },
        });
        if (!existing) {
          const payload = { purchaseOrderId: order.id, offerId: order.offerId, externalReference: order.externalReference };
          const messageId = randomUUID();
          await tx.negotiationMessage.create({ data: {
            id: messageId,
            negotiationId: negotiation.id,
            purchaseRequestId: input.purchaseRequestId,
            protocolVersion: "1.0",
            messageType: "purchase_order",
            senderCompanyId: input.buyerCompanyId,
            recipientCompanyId: order.supplierCompanyId,
            tenderRoundId: input.tenderRoundId,
            sentAt: new Date(),
            idempotencyKey,
            payload,
            rawMessage: { messageId, protocolVersion: "1.0", type: "purchase_order", purchaseRequestId: input.purchaseRequestId, negotiationId: negotiation.id, senderCompanyId: input.buyerCompanyId, recipientCompanyId: order.supplierCompanyId, tenderRoundId: input.tenderRoundId, payload },
          } });
        }
      }
      await Promise.all([
        tx.domainEvent.create({ data: {
          aggregateType: "purchase_request",
          aggregateId: input.purchaseRequestId,
          eventType: pendingItems === 0 ? "purchase_request.orders_created" : "purchase_request.partially_ordered",
          payload: { purchaseRequestId: input.purchaseRequestId, tenderRoundId: input.tenderRoundId, pendingItems },
        } }),
        tx.auditLog.create({ data: {
          companyId: input.buyerCompanyId,
          actorType: "AGENT",
          actorId: input.actorId,
          action: "purchase_request.split_awarded",
          aggregateType: "purchase_request",
          aggregateId: input.purchaseRequestId,
          metadata: { tenderRoundId: input.tenderRoundId, pendingItems },
        } }),
      ]);
      return { status, pendingItems, orders: roundOrders };
    },
  );
}
