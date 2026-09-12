import "server-only";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { DEMO_SUPPLIER_COMPANY_IDS, requireBuyerActor } from "@/lib/demo-workspace";
import { DomainError } from "@/lib/domain/errors";
import { prisma } from "@/lib/prisma";
import { runAutomaticPaymentsForPurchaseRequest } from "@/modules/payments/service";
import { launchPurchaseFlowSchema, type LaunchPurchaseFlowInput, type TenderProgressEvent } from "../domain/purchase-flow";
import { createPurchaseRequest, approvePurchaseRequest } from "./purchase-requests";
import { runMultiProductTenderAgents } from "./multi-product-tender";
import { getTenderSnapshot } from "./tender-snapshot";

async function persistFlowEvent(data: Prisma.DomainEventCreateArgs["data"]) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await prisma.domainEvent.create({ data });
      return;
    } catch (error) {
      if (attempt === 2) {
        console.error("Could not persist purchase-flow event", error);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

export async function launchPurchaseFlow(unsafeInput: LaunchPurchaseFlowInput, onEvent: (event: TenderProgressEvent) => void = () => {}) {
  const input = launchPurchaseFlowSchema.parse(unsafeInput);
  const actor = await requireBuyerActor(input.buyerCompanyId);
  if (input.kind === "new") await createPurchaseRequest(actor, { ...input.request, buyerCompanyId: actor.companyId, currency: "ARS" }, input.requestId);

  // The request row serializes claims across tabs/processes. Domain events keep
  // operation identity durable without a new table or an in-memory job queue.
  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`select id from public.purchase_requests where id = ${input.requestId}::uuid for update`;
    const request = await tx.purchaseRequest.findUnique({ where: { id: input.requestId } });
    if (!request || request.buyerCompanyId !== actor.companyId) throw new DomainError("No se encontró el pedido.", "NOT_FOUND", 404);
    const duplicate = await tx.domainEvent.findUnique({ where: { id: input.operationId } });
    if (duplicate) {
      if (duplicate.aggregateId !== input.requestId || duplicate.eventType !== "tender.flow.started") throw new DomainError("La operación corresponde a otro pedido.", "CONFLICT", 409);
      return false;
    }
    const active = await tx.domainEvent.findMany({ where: { aggregateId: input.requestId, eventType: { in: ["tender.flow.started", "tender.flow.finished"] } }, orderBy: { occurredAt: "desc" } });
    const openRun = active.find((event) => event.eventType === "tender.flow.started" && !active.some((end) => end.eventType === "tender.flow.finished" && (end.payload as Record<string, unknown>).operationId === event.id));
    if (openRun) throw new DomainError("Este pedido ya está en curso. Revisá su último estado antes de reintentar.", "CONFLICT", 409);
    await tx.domainEvent.create({ data: { id: input.operationId, aggregateId: input.requestId, aggregateType: "purchase_request", eventType: "tender.flow.started", payload: { operationId: input.operationId } } });
    return true;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10_000,
    timeout: 30_000,
  });

  const seen = new Set<string>();
  let sequence = 0;
  let publication = Promise.resolve();
  const publish = () => {
    // Snapshot reads are serialized, but supplier work stays parallel.
    publication = publication.then(async () => {
      const snapshot = await getTenderSnapshot(input.requestId, actor.companyId);
      for (const event of snapshot.events) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        onEvent({ ...event, sequence: ++sequence });
      }
    }).catch((error) => { console.error("Could not publish progress; snapshot can recover it", error); });
    return publication;
  };
  if (!claimed) { await publish(); return getTenderSnapshot(input.requestId, actor.companyId); }

  let failed = false;
  try {
    if (input.kind !== "retry") {
      const request = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: input.requestId } });
      if (request.status === "AWAITING_APPROVAL") await approvePurchaseRequest(actor, {
        purchaseRequestId: input.requestId, buyerCompanyId: actor.companyId,
        ...input.conditions, expiresAt: input.conditions.mandateExpiresAt,
        allowedSuppliers: [...DEMO_SUPPLIER_COMPANY_IDS], autoAccept: true,
      });
    }
    // A retry of uncovered products starts a new round. Do not replay the
    // previous round's order summary as if it belonged to the new launch.
    if (input.kind !== "retry") await publish();
    // With auto pay on, the mandate authorizes creating the orders and paying
    // them as soon as the round closes. Otherwise the buyer confirms from the
    // recommendation ("Generar pedido") and the flow stops at RECOMMENDED.
    const mandate = await prisma.mandate.findFirst({ where: { purchaseRequestId: input.requestId, status: "ACTIVE" }, orderBy: { version: "desc" }, select: { autoPay: true } });
    const autoPay = mandate?.autoPay ?? false;
    await runMultiProductTenderAgents(actor, input.requestId, { onProgress: publish, operationId: input.operationId, createOrders: autoPay });
    await publish();
    const createdOrders = autoPay ? await prisma.purchaseOrder.count({ where: { purchaseRequestId: input.requestId } }) : 0;
    if (createdOrders > 0) {
      // Orders have already reached the browser before waiting for payment receipts.
      await runAutomaticPaymentsForPurchaseRequest(actor, input.requestId, undefined, publish, input.kind === "retry" ? "ARBITRUM_DIRECT" : input.conditions.route ?? "ARBITRUM_DIRECT");
      await publish();
    }
    const settled = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: input.requestId } });
    if (settled.status === "PAYMENT_REVIEW_REQUIRED") throw new DomainError("Los pedidos ya están disponibles. Revisá los pagos que no pudieron confirmarse antes de volver a ejecutarlos.", "CONFLICT", 409);
  } catch (error) {
    failed = true;
    const message = error instanceof DomainError ? error.message : "No se pudo completar el proceso. Podés revisar lo confirmado y reintentar.";
    console.error("Purchase flow failed", error);
    await persistFlowEvent({ aggregateId: input.requestId, aggregateType: "purchase_request", eventType: "tender.flow.error", payload: { operationId: input.operationId, message } });
  } finally {
    await persistFlowEvent({ aggregateId: input.requestId, aggregateType: "purchase_request", eventType: "tender.flow.finished", payload: { operationId: input.operationId, status: failed ? "FAILED" : "SUCCEEDED" } });
    // A failed observer must never roll back or repeat a committed business action.
    publication = publication.catch(() => {});
    await publish();
    for (const path of ["/", "/context", "/protocol", "/cliente-demo", "/distribuidora-norte", "/mayorista-andino", "/abastecimientos-sur"]) revalidatePath(path);
  }
  return getTenderSnapshot(input.requestId, actor.companyId);
}
