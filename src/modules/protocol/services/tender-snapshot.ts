import "server-only";

import { DomainError } from "@/lib/domain/errors";
import { prisma } from "@/lib/prisma";
import { quantityToMicros } from "@/lib/decimal";
import { cents, messageProgress, moneyString, priceChange, publicOffer } from "../domain/tender-progress";
import type { TenderProgressEvent, TenderSnapshot, TenderSummary } from "../domain/purchase-flow";

export async function getTenderSnapshot(requestId: string, buyerCompanyId: string): Promise<TenderSnapshot> {
  const request = await prisma.purchaseRequest.findUnique({
    where: { id: requestId }, include: { items: true, tenderRounds: { orderBy: { roundNumber: "desc" }, take: 1 } },
  });
  if (!request || request.buyerCompanyId !== buyerCompanyId) throw new DomainError("No se encontró el pedido.", "NOT_FOUND", 404);
  const round = request.tenderRounds[0] ?? null;
  const [messages, orders, logs] = await Promise.all([
    prisma.negotiationMessage.findMany({ where: { purchaseRequestId: requestId, ...(round ? { OR: [{ tenderRoundId: round.id }, { messageType: "payment_status" }] } : {}) }, orderBy: [{ sentAt: "asc" }, { id: "asc" }], include: { negotiation: { select: { supplierCompanyId: true } } } }),
    prisma.purchaseOrder.findMany({ where: { purchaseRequestId: requestId, ...(round ? { tenderRoundId: round.id } : {}) }, include: { items: true, payment: true }, orderBy: { externalReference: "asc" } }),
    prisma.domainEvent.findMany({ where: { aggregateId: requestId, eventType: { startsWith: "tender.flow." } }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] }),
  ]);
  const items = round ? request.items.filter((item) => round.requestItemIds.includes(item.id)) : request.items;
  const phases: Record<string, number> = { request_for_quote: 0, offer: 1, counteroffer: 2, final_offer: 3, purchase_order: 4, payment_status: 5 };
  messages.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime() || (phases[a.messageType] ?? 6) - (phases[b.messageType] ?? 6));
  const mapped = messages.filter((m) => m.messageType !== "payment_status" || orders.some((order) => order.payment?.id === (m.payload as Record<string, unknown>).paymentId)).map((message) => ({
    id: message.id, supplierId: message.negotiation.supplierCompanyId, messageType: message.messageType,
    timestamp: message.sentAt.toISOString(), payload: message.payload, tenderRoundId: round?.id ?? null,
  }));
  const total = orders.reduce((sum, order) => sum + cents(order.total.toString()), 0n);
  let baseline = 0n, comparable = orders.length > 0;
  for (const order of orders) {
    const initial = mapped.find((m) => m.supplierId === order.supplierCompanyId && m.messageType === "offer");
    const lines = publicOffer(initial?.payload, items.length).lines;
    for (const item of order.items) {
      const initialLine = lines.find((line) => line.itemId === item.requestItemId && quantityToMicros(line.quantity) === quantityToMicros(item.quantity) && line.unit === item.unit);
      if (!initialLine) comparable = false;
      else baseline += cents(initialLine.total);
    }
  }
  const summary: TenderSummary = {
    orderCount: orders.length, total: moneyString(total), saving: comparable ? priceChange(moneyString(baseline), moneyString(total)) : null,
    coveredProducts: items.filter((item) => item.status === "AWARDED").length, requestedProducts: items.length,
    pendingProducts: items.filter((item) => item.status === "PENDING").length,
    orders: orders.map((o) => ({ id: o.id, reference: o.externalReference, supplierId: o.supplierCompanyId, total: o.total.toString(), paymentStatus: o.payment?.status ?? null })),
  };
  const events: TenderProgressEvent[] = [{
    id: `creation:${round?.id ?? request.id}`, sequence: 0, requestId, tenderRoundId: round?.id ?? null,
    phase: "creation", timestamp: round?.createdAt.toISOString() ?? request.createdAt.toISOString(),
  }, ...messageProgress(requestId, mapped, items.length)];
  if (mapped.filter((m) => m.messageType === "final_offer").length === 3) events.push({
    id: `award:${round?.id}`, sequence: 0, requestId, tenderRoundId: round?.id ?? null,
    phase: "award", timestamp: mapped.filter((m) => m.messageType === "final_offer").at(-1)!.timestamp,
  });
  if (round && round.status !== "OPEN") events.push({
    id: `orders:${round.id}`, sequence: 0, requestId, tenderRoundId: round.id,
    phase: "orders", timestamp: round.completedAt?.toISOString() ?? request.updatedAt.toISOString(), summary, status: request.status,
  });
  for (const order of orders) {
    const payment = order.payment;
    if (!payment) continue;
    const status = payment.status.replace("PAYMENT_", "");
    if (mapped.some((message) => message.messageType === "payment_status" && (message.payload as Record<string, unknown>).paymentId === payment.id && (message.payload as Record<string, unknown>).status === status)) continue;
    events.push({ id: `payment:${payment.id}:${status}`, sequence: 0, requestId, tenderRoundId: round?.id ?? null, supplierId: order.supplierCompanyId, phase: "payment", timestamp: payment.updatedAt.toISOString(), status });
  }
  const starts = logs.filter((log) => log.eventType === "tender.flow.started");
  const latestStart = starts.at(-1);
  const operationId = latestStart?.id;
  const currentLogs = logs.filter((log) => (log.payload as Record<string, unknown>).operationId === operationId);
  const finished = currentLogs.find((log) => log.eventType === "tender.flow.finished");
  for (const log of currentLogs.filter((log) => log.eventType === "tender.flow.error")) {
    const data = log.payload as Record<string, unknown>;
    events.push({ id: log.id, sequence: 0, requestId, tenderRoundId: round?.id ?? null, phase: "error", timestamp: log.occurredAt.toISOString(), message: String(data.message), ...(typeof data.supplierId === "string" ? { supplierId: data.supplierId } : {}) });
  }
  if (finished) events.push({ id: finished.id, sequence: 0, requestId, tenderRoundId: round?.id ?? null, phase: "complete", timestamp: finished.occurredAt.toISOString(), status: String((finished.payload as Record<string, unknown>).status), summary });
  const phaseOrder = ["creation", "rfq", "initial_offer", "counteroffer", "final_offer", "award", "orders", "payment", "error", "complete"];
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || phaseOrder.indexOf(a.phase) - phaseOrder.indexOf(b.phase));
  events.forEach((event, index) => { event.sequence = index + 1; });
  return { requestId, tenderRoundId: round?.id ?? null, status: request.status, running: !!latestStart && !finished, events, summary };
}
