import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import type { Actor } from "@/lib/demo-workspace";
import { DomainError } from "@/lib/domain/errors";
import { prisma } from "@/lib/prisma";
import {
  getBuyerProductContext,
  getSupplierProductContext,
} from "@/modules/context/analytics";
import { createSupplierFallbackDraft } from "@/modules/protocol/domain/agent-fallback";
import { protocolMessageSchema } from "@/modules/protocol/domain/message";
import {
  buildSplitAwardRecommendation,
  type OfferLineForAward,
} from "@/modules/protocol/domain/split-award";
import { appendProtocolMessage } from "@/modules/protocol/services/negotiations";
import {
  recordSplitAwardAndOrders,
  startTenderRound,
} from "@/modules/protocol/services/commands";

type RequestItem = {
  id: string;
  product_id: string;
  description: string;
  unit: string;
  minimum_quantity: string | number;
  target_quantity: string | number;
  maximum_quantity: string | number;
  urgency_score: string | number;
  status: "PENDING" | "AWARDED";
};

type Negotiation = {
  id: string;
  supplier_company_id: string;
  status: string;
};

type SupplierLine = {
  requestItemId: string;
  productId: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  taxes: string;
  shipping: string;
  total: string;
  confirmedStock: true;
  deliveryDate: string;
};

type SupplierUnavailableLine = {
  requestItemId: string;
  productId: string;
  reason: string;
  availableQuantity: string;
};

type SupplierPayload = {
  offerId: string;
  tenderRoundId: string;
  currency: "ARS";
  quotedAt: string;
  validUntil: string;
  lines: SupplierLine[];
  unavailableItems: SupplierUnavailableLine[];
  subtotal: string;
  taxes: string;
  shipping: string;
  discount: string;
  total: string;
  confirmedStock: boolean;
  deliveryDate: string;
  paymentTerms: string;
  notes: string;
};

function decimalToMicros(value: string) {
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
}

function moneyToCents(value: string) {
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

function centsToMoney(value: bigint) {
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

function deliveryDateFromDays(days: number, requiredBy: string) {
  const proposed = new Date();
  proposed.setUTCDate(proposed.getUTCDate() + days);
  return proposed.toISOString().slice(0, 10) > requiredBy
    ? requiredBy
    : proposed.toISOString().slice(0, 10);
}

function stableValidity(mandateExpiresAt: string) {
  return new Date(
    Math.min(
      Date.now() + 24 * 60 * 60 * 1000,
      new Date(mandateExpiresAt).getTime(),
    ),
  ).toISOString();
}

async function buildSupplierPayload({
  supplierCompanyId,
  supplierName,
  buyerCompanyId,
  items,
  phase,
  counterUnitPrices,
  maximumTenderTotal,
  requiredBy,
  mandateExpiresAt,
  tenderRoundId,
}: {
  supplierCompanyId: string;
  supplierName: string;
  buyerCompanyId: string;
  items: RequestItem[];
  phase: "INITIAL" | "FINAL";
  counterUnitPrices?: Map<string, string>;
  maximumTenderTotal: string;
  requiredBy: string;
  mandateExpiresAt: string;
  tenderRoundId: string;
}) {
  const lines: SupplierLine[] = [];
  const unavailableItems: SupplierUnavailableLine[] = [];
  const contextSnapshot: Record<string, unknown>[] = [];

  for (const item of items) {
    const context = await getSupplierProductContext(
      supplierCompanyId,
      buyerCompanyId,
      item.product_id,
    );
    const requestedMicros = decimalToMicros(String(item.target_quantity));
    const availableMicros = decimalToMicros(String(Math.max(0, context.availableStock)));
    contextSnapshot.push({ requestItemId: item.id, ...context });

    if (availableMicros < requestedMicros) {
      unavailableItems.push({
        requestItemId: item.id,
        productId: item.product_id,
        availableQuantity: String(Math.max(0, context.availableStock)),
        reason: `Stock insuficiente: dispone ${context.availableStock} ${item.unit} y se solicitaron ${item.target_quantity}.`,
      });
      continue;
    }

    const draft = createSupplierFallbackDraft({
      phase,
      supplierName,
      productId: item.product_id,
      productName: item.description,
      unit: item.unit,
      requestedQuantity: String(item.target_quantity),
      availableQuantity: String(context.availableStock),
      maximumTenderTotal,
      requiredBy,
      unitCost: context.unitCost,
      targetMarginPercentage: context.targetMarginPercentage.toFixed(3),
      targetRotationDays: context.targetRotationDays,
      unitsPreviouslySoldToClient: String(context.unitsSoldToClient),
      historicalAverageUnitPrice: context.averageHistoricalUnitPrice,
      buyerCounterUnitPrice: counterUnitPrices?.get(item.id),
      buyerCounterMaximumTotal: maximumTenderTotal,
      buyerCounterMessage:
        phase === "FINAL"
          ? "El comercio solicitó una mejora manteniendo stock y fecha."
          : undefined,
    });
    const quantityMicros = decimalToMicros(String(item.target_quantity));
    const unitPriceCents = moneyToCents(draft.unitPrice);
    const subtotalCents = (quantityMicros * unitPriceCents) / 1_000_000n;
    const taxesCents = (subtotalCents * 21n + 50n) / 100n;
    const shippingCents = moneyToCents(draft.shipping);
    const totalCents = subtotalCents + taxesCents + shippingCents;
    lines.push({
      requestItemId: item.id,
      productId: item.product_id,
      description: item.description,
      unit: item.unit,
      quantity: String(item.target_quantity),
      unitPrice: centsToMoney(unitPriceCents),
      lineTotal: centsToMoney(subtotalCents),
      taxes: centsToMoney(taxesCents),
      shipping: centsToMoney(shippingCents),
      total: centsToMoney(totalCents),
      confirmedStock: true,
      deliveryDate: deliveryDateFromDays(draft.deliveryDays, requiredBy),
    });
  }

  const subtotal = lines.reduce((sum, line) => sum + moneyToCents(line.lineTotal), 0n);
  const taxes = lines.reduce((sum, line) => sum + moneyToCents(line.taxes), 0n);
  const shipping = lines.reduce((sum, line) => sum + moneyToCents(line.shipping), 0n);
  const total = subtotal + taxes + shipping;
  const deliveryDate = lines.reduce(
    (latest, line) => (line.deliveryDate > latest ? line.deliveryDate : latest),
    new Date().toISOString().slice(0, 10),
  );
  const quotedAt = new Date().toISOString();
  const payload: SupplierPayload = {
    offerId: randomUUID(),
    tenderRoundId,
    currency: "ARS",
    quotedAt,
    validUntil: stableValidity(mandateExpiresAt),
    lines,
    unavailableItems,
    subtotal: centsToMoney(subtotal),
    taxes: centsToMoney(taxes),
    shipping: centsToMoney(shipping),
    discount: "0.00",
    total: centsToMoney(total),
    confirmedStock: unavailableItems.length === 0 && lines.length > 0,
    deliveryDate,
    paymentTerms: "CONTADO",
    notes:
      phase === "FINAL"
        ? `Oferta final automática: ${lines.length} líneas confirmadas y ${unavailableItems.length} sin cobertura. Los precios respetan costo, margen objetivo y la contraoferta del comercio.`
        : `Oferta inicial automática: ${lines.length} líneas confirmadas y ${unavailableItems.length} sin cobertura, calculadas con inventario, costos, margen e historial del cliente.`,
  };
  return { payload, contextSnapshot };
}

function buildBuyerCounterPayload(
  initial: SupplierPayload,
  tenderRoundId: string,
  mandateExpiresAt: string,
) {
  const lines = initial.lines.map((line) => {
    const targetUnit = (moneyToCents(line.unitPrice) * 95n) / 100n;
    const quantity = decimalToMicros(line.quantity);
    const subtotal = (quantity * targetUnit) / 1_000_000n;
    const taxes = (subtotal * 21n + 50n) / 100n;
    return {
      ...line,
      unitPrice: centsToMoney(targetUnit),
      lineTotal: centsToMoney(subtotal),
      taxes: centsToMoney(taxes),
      shipping: "0.00",
      total: centsToMoney(subtotal + taxes),
    };
  });
  const subtotal = lines.reduce((sum, line) => sum + moneyToCents(line.lineTotal), 0n);
  const taxes = lines.reduce((sum, line) => sum + moneyToCents(line.taxes), 0n);
  const total = subtotal + taxes;
  return {
    offerId: randomUUID(),
    tenderRoundId,
    currency: "ARS" as const,
    quotedAt: new Date().toISOString(),
    validUntil: stableValidity(mandateExpiresAt),
    lines,
    unavailableItems: initial.unavailableItems,
    subtotal: centsToMoney(subtotal),
    taxes: centsToMoney(taxes),
    shipping: "0.00",
    discount: "0.00",
    total: centsToMoney(total),
    confirmedStock: initial.confirmedStock,
    deliveryDate: initial.deliveryDate,
    paymentTerms: "CONTADO",
    notes:
      "El comercio propone una mejora del 5% por línea, manteniendo cantidades, stock confirmado y fecha de entrega.",
  };
}

async function appendTenderMessage({
  actor,
  type,
  negotiation,
  purchaseRequestId,
  tenderRoundId,
  recipientCompanyId,
  correlationId,
  expiresAt,
  payload,
}: {
  actor: Actor;
  type: "request_for_quote" | "offer" | "counteroffer" | "final_offer";
  negotiation: Negotiation;
  purchaseRequestId: string;
  tenderRoundId: string;
  recipientCompanyId: string;
  correlationId: string | null;
  expiresAt: string;
  payload: Record<string, unknown>;
}) {
  const message = protocolMessageSchema.parse({
    messageId: randomUUID(),
    protocolVersion: "1.0",
    type,
    senderCompanyId: actor.companyId,
    recipientCompanyId,
    purchaseRequestId,
    negotiationId: negotiation.id,
    tenderRoundId,
    correlationId,
    sentAt: new Date().toISOString(),
    expiresAt,
    idempotencyKey: `tender:${tenderRoundId}:${negotiation.id}:${type}`,
    payload,
  });
  return appendProtocolMessage(actor, message);
}

async function recordSupplierRun({
  supplierCompanyId,
  purchaseRequestId,
  input,
  output,
}: {
  supplierCompanyId: string;
  purchaseRequestId: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}) {
  await prisma.agentRun.create({
    data: {
      companyId: supplierCompanyId,
      purchaseRequestId,
      kind: "NEGOTIATION_DRAFT",
      provider: "GROQ",
      model: "deterministic-commercial-agent-v2",
      inputSnapshot: input as Prisma.InputJsonValue,
      output: output as Prisma.InputJsonValue,
      status: "SUCCEEDED",
      createdBy: `supplier-agent:${supplierCompanyId}`,
    },
  });
}

export async function runMultiProductTenderAgents(
  buyer: Actor,
  purchaseRequestId: string,
  options: { onProgress?: () => Promise<void>; operationId?: string } = {},
) {
  if (buyer.role !== "BUYER") {
    throw new DomainError("Sólo el comercio puede lanzar una licitación", "FORBIDDEN", 403);
  }
  const request = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!request) {
    throw new DomainError("No se encontró la solicitud", "NOT_FOUND", 404);
  }
  if (request.buyerCompanyId !== buyer.companyId) {
    throw new DomainError("La solicitud pertenece a otro comercio", "FORBIDDEN", 403);
  }
  if (["ORDER_CREATED", "PAYMENT_CONFIRMED"].includes(request.status)) {
    const existingOrders = await prisma.purchaseOrder.count({ where: { purchaseRequestId } });
    return {
      requested: 3,
      completed: 3,
      status: request.status,
      orderCount: existingOrders,
      recommendation: null,
    };
  }

  const [mandate, negotiationRows] = await Promise.all([
    prisma.mandate.findFirst({ where: { purchaseRequestId, status: "ACTIVE" }, orderBy: { version: "desc" } }),
    prisma.negotiation.findMany({ where: { purchaseRequestId } }),
  ]);
  if (!mandate) {
    throw new DomainError("La licitación necesita un mandato activo", "CONFLICT", 409);
  }
  if (negotiationRows.length !== 3) {
    throw new DomainError("La demo necesita los tres distribuidores", "CONFLICT", 409);
  }
  const negotiations: Negotiation[] = negotiationRows.map((negotiation) => ({
    id: negotiation.id,
    supplier_company_id: negotiation.supplierCompanyId,
    status: negotiation.status,
  }));

  const tenderRoundId = await startTenderRound(purchaseRequestId, buyer.companyId, buyer.actorId);
  await options.onProgress?.();

  const [round, suppliers] = await Promise.all([
    prisma.tenderRound.findUnique({ where: { id: tenderRoundId } }),
    prisma.company.findMany({
      where: { id: { in: negotiations.map((negotiation) => negotiation.supplier_company_id) } },
      select: { id: true, legalName: true },
    }),
  ]);
  if (!round) {
    throw new DomainError("No se pudo cargar la ronda", "INTERNAL_ERROR", 500);
  }
  const requestItemRows = await prisma.purchaseRequestItem.findMany({
    where: { id: { in: round.requestItemIds }, status: "PENDING" },
    orderBy: { urgencyScore: "asc" },
  });
  if (!requestItemRows.length) {
    throw new DomainError("La ronda no tiene líneas pendientes", "CONFLICT", 409);
  }
  const items: RequestItem[] = requestItemRows.map((item) => ({
    id: item.id,
    product_id: item.productId,
    description: item.description,
    unit: item.unit,
    minimum_quantity: item.minimumQuantity.toString(),
    target_quantity: item.targetQuantity.toString(),
    maximum_quantity: item.maximumQuantity.toString(),
    urgency_score: item.urgencyScore.toString(),
    status: item.status as "PENDING" | "AWARDED",
  }));
  const supplierNames = new Map(
    suppliers.map((supplier) => [supplier.id, supplier.legalName]),
  );
  const responses: Array<{ supplierCompanyId: string; supplierName: string; ok: boolean }> = [];

  const results = await Promise.allSettled(negotiations.map(async (negotiation) => {
    const supplierName = supplierNames.get(negotiation.supplier_company_id) ?? "Distribuidor";
    try {
    const existingMessages = await prisma.negotiationMessage.findMany({ where: { negotiationId: negotiation.id, tenderRoundId } });
    const persisted = (type: string) => existingMessages.find((message) => message.messageType === type);
    const rfq = await appendTenderMessage({
      actor: { ...buyer, actorId: `buyer-agent:${buyer.companyId}`, actorType: "AGENT" },
      type: "request_for_quote",
      negotiation,
      purchaseRequestId,
      tenderRoundId: String(tenderRoundId),
      recipientCompanyId: negotiation.supplier_company_id,
      correlationId: null,
      expiresAt: mandate.expiresAt.toISOString(),
      payload: {
        items: items.map((item) => ({
          requestItemId: item.id,
          productId: item.product_id,
          description: item.description,
          unit: item.unit,
          minimumQuantity: String(item.minimum_quantity),
          targetQuantity: String(item.target_quantity),
          maximumQuantity: String(item.maximum_quantity),
        })),
        requiredBy: request.requiredBy.toISOString().slice(0, 10),
        paymentTerms: mandate.paymentTerms,
        notes: `Ronda ${round.roundNumber}: cotizar todas las líneas e indicar expresamente las que no tienen cobertura.`,
      },
    });
    await options.onProgress?.();

    const initial = persisted("offer") ? { payload: persisted("offer")!.payload as unknown as SupplierPayload, contextSnapshot: [] } : await buildSupplierPayload({
      supplierCompanyId: negotiation.supplier_company_id,
      supplierName,
      buyerCompanyId: buyer.companyId,
      items,
      phase: "INITIAL",
      maximumTenderTotal: mandate.maximumTotalIncludingFees.toString(),
      requiredBy: request.requiredBy.toISOString().slice(0, 10),
      mandateExpiresAt: mandate.expiresAt.toISOString(),
      tenderRoundId,
    });
    const supplierActor: Actor = {
      actorId: `supplier-agent:${negotiation.supplier_company_id}`,
      actorType: "AGENT",
      companyId: negotiation.supplier_company_id,
      role: "SUPPLIER",
    };
    const initialMessage = await appendTenderMessage({
      actor: supplierActor,
      type: "offer",
      negotiation,
      purchaseRequestId,
      tenderRoundId: String(tenderRoundId),
      recipientCompanyId: buyer.companyId,
      correlationId: rfq.messageId,
      expiresAt: initial.payload.validUntil,
      payload: initial.payload,
    });
    await options.onProgress?.();

    const counterPayload = persisted("counteroffer") ? persisted("counteroffer")!.payload as unknown as SupplierPayload : buildBuyerCounterPayload(
      initial.payload,
      tenderRoundId,
      mandate.expiresAt.toISOString(),
    );
    const counterMessage = await appendTenderMessage({
      actor: { ...buyer, actorId: `buyer-agent:${buyer.companyId}`, actorType: "AGENT" },
      type: "counteroffer",
      negotiation,
      purchaseRequestId,
      tenderRoundId: String(tenderRoundId),
      recipientCompanyId: negotiation.supplier_company_id,
      correlationId: initialMessage.messageId,
      expiresAt: counterPayload.validUntil,
      payload: counterPayload,
    });
    await options.onProgress?.();
    const counterPrices = new Map(
      counterPayload.lines.map((line) => [line.requestItemId, line.unitPrice]),
    );
    const final = persisted("final_offer") ? { payload: persisted("final_offer")!.payload as unknown as SupplierPayload, contextSnapshot: [] } : await buildSupplierPayload({
      supplierCompanyId: negotiation.supplier_company_id,
      supplierName,
      buyerCompanyId: buyer.companyId,
      items,
      phase: "FINAL",
      counterUnitPrices: counterPrices,
      maximumTenderTotal: mandate.maximumTotalIncludingFees.toString(),
      requiredBy: request.requiredBy.toISOString().slice(0, 10),
      mandateExpiresAt: mandate.expiresAt.toISOString(),
      tenderRoundId,
    });
    const finalMessage = await appendTenderMessage({
      actor: supplierActor,
      type: "final_offer",
      negotiation,
      purchaseRequestId,
      tenderRoundId: String(tenderRoundId),
      recipientCompanyId: buyer.companyId,
      correlationId: counterMessage.messageId,
      expiresAt: final.payload.validUntil,
      payload: final.payload,
    });
    await options.onProgress?.();
    if (!finalMessage.duplicate) {
      await recordSupplierRun({
        supplierCompanyId: negotiation.supplier_company_id,
        purchaseRequestId,
        input: {
          tenderRoundId,
          roundNumber: round.roundNumber,
          buyerCompanyId: buyer.companyId,
          requestItems: items,
          privateSupplierContext: final.contextSnapshot,
        },
        output: final.payload,
      });
    }
    responses.push({ supplierCompanyId: negotiation.supplier_company_id, supplierName, ok: true });
    } catch (error) {
      await prisma.domainEvent.create({ data: {
        aggregateType: "purchase_request", aggregateId: purchaseRequestId, eventType: "tender.flow.error",
        payload: { operationId: options.operationId ?? "", supplierId: negotiation.supplier_company_id, message: `${supplierName} no pudo completar su respuesta. Las demás conversaciones se conservaron.` },
      } });
      await options.onProgress?.();
      throw error;
    }
  }));
  if (results.some((result) => result.status === "rejected")) {
    throw new DomainError("Faltan ofertas finales. Podés reintentar las conversaciones pendientes.", "CONFLICT", 409);
  }

  const activeOffers = await prisma.offer.findMany({
    where: { purchaseRequestId, tenderRoundId, status: "ACTIVE" },
  });
  if (activeOffers.length !== 3) {
    throw new DomainError(
      "La adjudicación necesita una oferta final de cada distribuidor",
      "CONFLICT",
      409,
    );
  }
  const offerIds = activeOffers.map((offer) => offer.id);
  const normalizedLines = await prisma.offerLine.findMany({ where: { offerId: { in: offerIds } } });
  const offerById = new Map(activeOffers.map((offer) => [offer.id, offer]));
  const offerLines: OfferLineForAward[] = normalizedLines.map((line) => {
    const offer = offerById.get(line.offerId)!;
    return {
      offerLineId: line.id,
      offerId: line.offerId,
      requestItemId: line.requestItemId,
      productId: line.productId,
      supplierCompanyId: offer.supplierCompanyId,
      supplierName: supplierNames.get(offer.supplierCompanyId) ?? "Distribuidor",
      quantity: String(line.quantity),
      unitPrice: String(line.unitPrice),
      subtotal: String(line.subtotal),
      taxes: String(line.taxes),
      shipping: String(line.shipping),
      total: String(line.total),
      confirmedStock: line.confirmedStock,
      deliveryDate: line.deliveryDate.toISOString().slice(0, 10),
      paymentTerms: offer.paymentTerms,
      validUntil: offer.validUntil.toISOString(),
      offerStatus: String(offer.status),
    };
  });
  const [priorOrders, buyerContexts] = await Promise.all([
    prisma.purchaseOrder.findMany({ where: { purchaseRequestId, status: "CREATED" }, select: { total: true } }),
    Promise.all(
      items.map((item) => getBuyerProductContext(buyer.companyId, item.product_id)),
    ),
  ]);
  const alreadyCommitted = priorOrders.reduce(
    (sum, order) => sum + moneyToCents(String(order.total)),
    0n,
  );
  const recommendation = buildSplitAwardRecommendation({
    requestLines: items.map((item) => ({
      requestItemId: item.id,
      productId: item.product_id,
      description: item.description,
      quantity: String(item.target_quantity),
      urgencyScore: Number(item.urgency_score),
    })),
    offerLines,
    allowedSuppliers: mandate.allowedSuppliers,
    requiredBy: request.requiredBy.toISOString().slice(0, 10),
    mandateExpiresAt: mandate.expiresAt.toISOString(),
    maximumTotal: mandate.maximumTotalIncludingFees.toString(),
    alreadyCommittedTotal: centsToMoney(alreadyCommitted),
  });
  const recommendationWithContext = {
    ...recommendation,
    tenderRoundId,
    roundNumber: round.roundNumber,
    buyerContext: buyerContexts,
    explanation:
      "El agente evaluó cada producto por separado: proveedor autorizado, oferta vigente, stock confirmado, fecha requerida y presupuesto. Ante empate priorizó menor total y luego entrega más temprana.",
  };
  const orderResult = await recordSplitAwardAndOrders({
    purchaseRequestId,
    buyerCompanyId: buyer.companyId,
    tenderRoundId,
    actorId: `buyer-agent:${buyer.companyId}`,
    recommendation: recommendationWithContext,
  });
  await options.onProgress?.();

  return {
    requested: 3,
    completed: responses.length,
    responses,
    status: orderResult.status,
    orderCount: orderResult.orders.length,
    buyerStrategy: recommendationWithContext.explanation,
    recommendation: recommendationWithContext,
    buyerContexts,
  };
}
