import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import type { Actor } from "@/lib/demo-workspace";
import { roundDivide, scaledIntegerToDecimal } from "@/lib/decimal";
import { DomainError } from "@/lib/domain/errors";
import { prisma } from "@/lib/prisma";
import {
  getBuyerProductContext,
  getSupplierProductContext,
} from "@/modules/context/analytics";
import {
  generateBuyerCounteroffers,
  generateSupplierOfferDraft,
  type BuyerCounterInput,
  type SupplierTenderInput,
} from "@/modules/protocol/agent/groq";
import {
  createBuyerFallbackCounteroffers,
  createSupplierFallbackDraft,
} from "@/modules/protocol/domain/agent-fallback";
import {
  parseOfferPayload,
  protocolMessageSchema,
} from "@/modules/protocol/domain/message";
import {
  appendProtocolMessage,
  generateOfferRecommendation,
} from "@/modules/protocol/services/negotiations";

function decimalToMicros(value: string) {
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

function moneyToCents(value: string) {
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function centsToMoney(value: bigint) {
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

function deliveryDateFromDays(days: number, requiredBy: string) {
  const proposed = new Date();
  proposed.setUTCDate(proposed.getUTCDate() + days);
  const proposedDate = proposed.toISOString().slice(0, 10);
  return proposedDate > requiredBy ? requiredBy : proposedDate;
}

function percentageFromRatio(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n) return "0.000";
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const thousandthsOfPercent = roundDivide(absolute * 100_000n, denominator);
  return scaledIntegerToDecimal(
    negative ? -thousandthsOfPercent : thousandthsOfPercent,
    3,
  );
}

type RequestItem = {
  product_id: string;
  description: string;
  unit: string;
  minimum_quantity: string | number;
  target_quantity: string | number;
  maximum_quantity: string | number;
};

type Negotiation = {
  id: string;
  supplier_company_id: string;
  status: string;
};

type SupplierContext = Awaited<ReturnType<typeof getSupplierProductContext>>;

type Counter = {
  negotiationId: string;
  supplierCompanyId: string;
  targetUnitPrice: string;
  maximumAcceptableTotal: string;
  message: string;
};

type GeneratedOffer = {
  negotiationId: string;
  supplierCompanyId: string;
  supplierName: string;
  messageId: string;
  offerId: string;
  unitPrice: string;
  total: string;
  deliveryDate: string;
  paymentTerms: string;
  confirmedStock: boolean;
  supplierContext: SupplierContext;
};

type CounterWithMessage = Counter & { messageId: string };

type StoredMessage = {
  id: string;
  negotiation_id: string;
  message_type: string;
  payload: Record<string, unknown>;
};

async function withAgentRetry<T>(operation: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function generateSupplierDraftReliably(input: SupplierTenderInput) {
  if (process.env.DISABLE_EXTERNAL_AGENT_CALLS === "true") {
    return {
      draft: createSupplierFallbackDraft(input),
      model: "deterministic-policy-fallback",
    };
  }
  try {
    return await withAgentRetry(() => generateSupplierOfferDraft(input));
  } catch (error) {
    console.error("Supplier agent unavailable; using policy fallback", error);
    return {
      draft: createSupplierFallbackDraft(input),
      model: "deterministic-policy-fallback",
    };
  }
}

async function generateBuyerCountersReliably(input: BuyerCounterInput) {
  if (process.env.DISABLE_EXTERNAL_AGENT_CALLS === "true") {
    return {
      counters: createBuyerFallbackCounteroffers(input),
      model: "deterministic-policy-fallback",
    };
  }
  try {
    return await withAgentRetry(() => generateBuyerCounteroffers(input));
  } catch (error) {
    console.error("Buyer agent unavailable; using policy fallback", error);
    return {
      counters: createBuyerFallbackCounteroffers(input),
      model: "deterministic-policy-fallback",
    };
  }
}

async function recordSupplierAgentRun(
  supplierCompanyId: string,
  purchaseRequestId: string,
  model: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
) {
  await prisma.agentRun.create({
    data: {
      companyId: supplierCompanyId,
      purchaseRequestId,
      kind: "NEGOTIATION_DRAFT",
      provider: "GROQ",
      model,
      inputSnapshot: input as Prisma.InputJsonValue,
      output: output as Prisma.InputJsonValue,
      status: "SUCCEEDED",
      createdBy: `supplier-agent:${supplierCompanyId}`,
    },
  });
}

async function generateSupplierRound({
  buyer,
  purchaseRequestId,
  requestItem,
  requiredBy,
  mandateMaximumTotal,
  mandateExpiresAt,
  negotiation,
  supplierName,
  phase,
  counter,
  correlationId,
}: {
  buyer: Actor;
  purchaseRequestId: string;
  requestItem: RequestItem;
  requiredBy: string;
  mandateMaximumTotal: string;
  mandateExpiresAt: string;
  negotiation: Negotiation;
  supplierName: string;
  phase: "INITIAL" | "FINAL";
  counter?: Counter;
  correlationId: string;
}): Promise<GeneratedOffer> {
  const supplierCompanyId = negotiation.supplier_company_id;
  const supplierContext = await getSupplierProductContext(
    supplierCompanyId,
    buyer.companyId,
    requestItem.product_id,
  );
  const tenderInput = {
    phase,
    supplierName,
    productId: requestItem.product_id,
    productName: requestItem.description,
    unit: requestItem.unit,
    requestedQuantity: String(requestItem.target_quantity),
    availableQuantity: String(supplierContext.availableStock),
    maximumTenderTotal: mandateMaximumTotal,
    requiredBy,
    unitCost: supplierContext.unitCost,
    targetMarginPercentage: supplierContext.targetMarginPercentage.toFixed(3),
    targetRotationDays: supplierContext.targetRotationDays,
    unitsPreviouslySoldToClient: String(supplierContext.unitsSoldToClient),
    historicalAverageUnitPrice:
      supplierContext.averageHistoricalUnitPrice,
    buyerCounterUnitPrice: counter?.targetUnitPrice,
    buyerCounterMaximumTotal: counter?.maximumAcceptableTotal,
    buyerCounterMessage: counter?.message,
  };
  const { draft, model } = await generateSupplierDraftReliably(tenderInput);

  const quantityMicros = decimalToMicros(String(requestItem.target_quantity));
  const targetMarginBasisPoints = BigInt(
    Math.min(9_500, Math.max(0, Math.round(supplierContext.targetMarginPercentage * 100))),
  );
  // The objective is a gross margin over the selling price, not a markup over cost.
  const minimumUnitPriceCents =
    (moneyToCents(supplierContext.unitCost) * 10_000n +
      (10_000n - targetMarginBasisPoints) -
      1n) /
    (10_000n - targetMarginBasisPoints);
  const proposedUnitPriceCents = moneyToCents(draft.unitPrice);
  const unitPriceCents =
    proposedUnitPriceCents < minimumUnitPriceCents
      ? minimumUnitPriceCents
      : proposedUnitPriceCents;
  const subtotalCents = (quantityMicros * unitPriceCents) / 1_000_000n;
  const taxesCents = (subtotalCents * 21n + 50n) / 100n;
  const shippingCents = moneyToCents(draft.shipping);
  const totalCents = subtotalCents + taxesCents + shippingCents;
  const confirmedStock =
    decimalToMicros(String(supplierContext.availableStock)) >= quantityMicros;
  const offerId = randomUUID();
  const sentAt = new Date().toISOString();
  const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const mandateExpiry = new Date(mandateExpiresAt);
  const validUntil = new Date(
    Math.min(oneDayFromNow.getTime(), mandateExpiry.getTime()),
  ).toISOString();
  const output = {
    offerId,
    currency: "ARS" as const,
    quotedAt: sentAt,
    validUntil,
    lines: [
      {
        productId: requestItem.product_id,
        description: requestItem.description,
        unit: requestItem.unit,
        quantity: String(requestItem.target_quantity),
        unitPrice: centsToMoney(unitPriceCents),
        lineTotal: centsToMoney(subtotalCents),
      },
    ],
    subtotal: centsToMoney(subtotalCents),
    taxes: centsToMoney(taxesCents),
    shipping: centsToMoney(shippingCents),
    discount: "0.00",
    total: centsToMoney(totalCents),
    confirmedStock,
    deliveryDate: deliveryDateFromDays(draft.deliveryDays, requiredBy),
    paymentTerms: draft.paymentTerms,
    notes: draft.notes,
  };
  const message = protocolMessageSchema.parse({
    messageId: randomUUID(),
    protocolVersion: "1.0",
    type: phase === "INITIAL" ? "offer" : "final_offer",
    senderCompanyId: supplierCompanyId,
    recipientCompanyId: buyer.companyId,
    purchaseRequestId,
    negotiationId: negotiation.id,
    correlationId,
    sentAt,
    expiresAt: validUntil,
    idempotencyKey: `supplier-agent:${phase.toLowerCase()}:${negotiation.id}:${offerId}`,
    payload: output,
  });

  const persistedMessage = await appendProtocolMessage(
    {
      actorId: `supplier-agent:${supplierCompanyId}`,
      actorType: "AGENT",
      companyId: supplierCompanyId,
      role: "SUPPLIER",
    },
    message,
  );
  await recordSupplierAgentRun(
    supplierCompanyId,
    purchaseRequestId,
    model,
    tenderInput,
    output,
  );

  return {
    negotiationId: negotiation.id,
    supplierCompanyId,
    supplierName,
    messageId: persistedMessage.messageId,
    offerId,
    unitPrice: centsToMoney(unitPriceCents),
    total: centsToMoney(totalCents),
    deliveryDate: output.deliveryDate,
    paymentTerms: draft.paymentTerms,
    confirmedStock,
    supplierContext,
  };
}

async function appendRequestForQuote({
  buyer,
  purchaseRequestId,
  requestItem,
  negotiation,
  requiredBy,
  paymentTerms,
  mandateExpiresAt,
}: {
  buyer: Actor;
  purchaseRequestId: string;
  requestItem: RequestItem;
  negotiation: Negotiation;
  requiredBy: string;
  paymentTerms: string;
  mandateExpiresAt: string;
}) {
  const message = protocolMessageSchema.parse({
    messageId: randomUUID(),
    protocolVersion: "1.0",
    type: "request_for_quote",
    senderCompanyId: buyer.companyId,
    recipientCompanyId: negotiation.supplier_company_id,
    purchaseRequestId,
    negotiationId: negotiation.id,
    correlationId: null,
    sentAt: new Date().toISOString(),
    expiresAt: mandateExpiresAt,
    idempotencyKey: `buyer-agent:rfq:${purchaseRequestId}:${negotiation.id}`,
    payload: {
      items: [
        {
          productId: requestItem.product_id,
          description: requestItem.description,
          unit: requestItem.unit,
          minimumQuantity: String(requestItem.minimum_quantity),
          targetQuantity: String(requestItem.target_quantity),
          maximumQuantity: String(requestItem.maximum_quantity),
        },
      ],
      requiredBy,
      paymentTerms,
      notes:
        "Licitación automática: responder con precio, stock, entrega y condición de pago.",
    },
  });

  return appendProtocolMessage(
    {
      ...buyer,
      actorId: `buyer-agent:${buyer.companyId}`,
      actorType: "AGENT",
    },
    message,
  );
}

async function appendBuyerCounteroffer({
  buyer,
  purchaseRequestId,
  requestItem,
  negotiation,
  counter,
  mandateMaximumTotal,
  mandateExpiresAt,
  requiredBy,
  correlationId,
}: {
  buyer: Actor;
  purchaseRequestId: string;
  requestItem: RequestItem;
  negotiation: Negotiation;
  counter: Counter;
  mandateMaximumTotal: string;
  mandateExpiresAt: string;
  requiredBy: string;
  correlationId: string;
}): Promise<CounterWithMessage> {
  const quantityMicros = decimalToMicros(String(requestItem.target_quantity));
  const mandateCents = moneyToCents(mandateMaximumTotal);
  const maximumSubtotalCents = (mandateCents * 100n) / 121n;
  const maximumUnitCents =
    quantityMicros > 0n
      ? (maximumSubtotalCents * 1_000_000n) / quantityMicros
      : 0n;
  const proposedUnitCents = moneyToCents(counter.targetUnitPrice);
  const unitPriceCents =
    proposedUnitCents > maximumUnitCents ? maximumUnitCents : proposedUnitCents;
  const subtotalCents = (quantityMicros * unitPriceCents) / 1_000_000n;
  const taxesCents = (subtotalCents * 21n + 50n) / 100n;
  const totalCents = subtotalCents + taxesCents;
  const sentAt = new Date().toISOString();
  const offerId = randomUUID();
  const validUntil = new Date(
    Math.min(
      Date.now() + 24 * 60 * 60 * 1000,
      new Date(mandateExpiresAt).getTime(),
    ),
  ).toISOString();
  const payload = {
    offerId,
    currency: "ARS" as const,
    quotedAt: sentAt,
    validUntil,
    lines: [
      {
        productId: requestItem.product_id,
        description: requestItem.description,
        unit: requestItem.unit,
        quantity: String(requestItem.target_quantity),
        unitPrice: centsToMoney(unitPriceCents),
        lineTotal: centsToMoney(subtotalCents),
      },
    ],
    subtotal: centsToMoney(subtotalCents),
    taxes: centsToMoney(taxesCents),
    shipping: "0.00",
    discount: "0.00",
    total: centsToMoney(totalCents),
    confirmedStock: true,
    deliveryDate: requiredBy,
    paymentTerms: "CONTADO",
    notes: counter.message,
  };
  const message = protocolMessageSchema.parse({
    messageId: randomUUID(),
    protocolVersion: "1.0",
    type: "counteroffer",
    senderCompanyId: buyer.companyId,
    recipientCompanyId: negotiation.supplier_company_id,
    purchaseRequestId,
    negotiationId: negotiation.id,
    correlationId,
    sentAt,
    expiresAt: validUntil,
    idempotencyKey: `buyer-agent:counter:${negotiation.id}:${offerId}`,
    payload,
  });
  const persistedMessage = await appendProtocolMessage(
    {
      ...buyer,
      actorId: `buyer-agent:${buyer.companyId}`,
      actorType: "AGENT",
    },
    message,
  );
  return { ...counter, messageId: persistedMessage.messageId };
}

async function recordMetrics({
  purchaseRequestId,
  initial,
  final,
  mandateMaximumTotal,
  durationMs,
}: {
  purchaseRequestId: string;
  initial: GeneratedOffer;
  final: GeneratedOffer;
  mandateMaximumTotal: string;
  durationMs: number;
}) {
  const initialTotal = moneyToCents(initial.total);
  const finalTotal = moneyToCents(final.total);
  const finalUnitPrice = moneyToCents(final.unitPrice);
  const supplierUnitCost = moneyToCents(final.supplierContext.unitCost);
  const margin = percentageFromRatio(finalUnitPrice - supplierUnitCost, finalUnitPrice);
  const maximumTotal = moneyToCents(mandateMaximumTotal);
  const unspent = maximumTotal > finalTotal ? maximumTotal - finalTotal : 0n;
  const capitalEfficiency = percentageFromRatio(unspent, maximumTotal);
  const messageCount = await prisma.negotiationMessage.count({
    where: { negotiationId: final.negotiationId },
  });
  await prisma.negotiationMetric.upsert({
    where: { negotiationId: final.negotiationId },
    create: {
      negotiationId: final.negotiationId,
      purchaseRequestId,
      supplierCompanyId: final.supplierCompanyId,
      rounds: 2,
      messageCount: messageCount || 4,
      initialTotal: initial.total,
      finalTotal: final.total,
      priceReductionPercentage: percentageFromRatio(initialTotal - finalTotal, initialTotal),
      estimatedMarginPercentage: margin,
      capitalEfficiencyScore: capitalEfficiency,
      stockAvailable: final.supplierContext.availableStock,
      durationMs,
    },
    update: {
      rounds: 2,
      messageCount: messageCount || 4,
      initialTotal: initial.total,
      finalTotal: final.total,
      priceReductionPercentage: percentageFromRatio(initialTotal - finalTotal, initialTotal),
      estimatedMarginPercentage: margin,
      capitalEfficiencyScore: capitalEfficiency,
      stockAvailable: final.supplierContext.availableStock,
      durationMs,
      recordedAt: new Date(),
    },
  });
}

async function restoreStoredOffer({
  message,
  negotiation,
  supplierName,
  buyerCompanyId,
  productId,
}: {
  message: StoredMessage;
  negotiation: Negotiation;
  supplierName: string;
  buyerCompanyId: string;
  productId: string;
}): Promise<GeneratedOffer> {
  const payload = parseOfferPayload(message.payload);
  const line = payload.lines[0];
  const supplierContext = await getSupplierProductContext(
    negotiation.supplier_company_id,
    buyerCompanyId,
    productId,
  );
  return {
    negotiationId: negotiation.id,
    supplierCompanyId: negotiation.supplier_company_id,
    supplierName,
    messageId: message.id,
    offerId: payload.offerId,
    unitPrice: line.unitPrice,
    total: payload.total,
    deliveryDate: payload.deliveryDate,
    paymentTerms: payload.paymentTerms,
    confirmedStock: payload.confirmedStock,
    supplierContext,
  };
}

function restoreStoredCounter(
  message: StoredMessage,
  negotiation: Negotiation,
): CounterWithMessage {
  const payload = parseOfferPayload(message.payload);
  return {
    negotiationId: negotiation.id,
    supplierCompanyId: negotiation.supplier_company_id,
    targetUnitPrice: payload.lines[0].unitPrice,
    maximumAcceptableTotal: payload.total,
    message: payload.notes ?? "Contraoferta registrada por el comercio.",
    messageId: message.id,
  };
}

async function reopenIncompleteRecommendation(
  purchaseRequestId: string,
  buyer: Actor,
  version: number,
) {
  const result = await prisma.purchaseRequest.updateMany({
    where: { id: purchaseRequestId, status: "RECOMMENDED", version },
    data: { status: "NEGOTIATING", version: { increment: 1 } },
  });
  if (result.count !== 1) {
    throw new DomainError(
      "No se pudo reabrir la negociación incompleta",
      "INTERNAL_ERROR",
      500,
    );
  }

  await prisma.$transaction([
    prisma.domainEvent.create({ data: {
      aggregateType: "purchase_request",
      aggregateId: purchaseRequestId,
      eventType: "negotiation.reopened_for_missing_final_offers",
      payload: { purchaseRequestId },
    } }),
    prisma.auditLog.create({ data: {
      companyId: buyer.companyId,
      actorType: buyer.actorType,
      actorId: buyer.actorId,
      action: "negotiation.reopened_for_missing_final_offers",
      aggregateType: "purchase_request",
      aggregateId: purchaseRequestId,
      metadata: { previousStatus: "RECOMMENDED" },
    } }),
  ]);
}

export async function runSupplierTenderAgents(
  buyer: Actor,
  purchaseRequestId: string,
) {
  const startedAt = Date.now();
  if (buyer.role !== "BUYER") {
    throw new DomainError("Sólo el cliente puede lanzar una licitación", "FORBIDDEN", 403);
  }

  const [requestRow, mandateRow, negotiationRows] = await Promise.all([
    prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId }, include: { items: true } }),
    prisma.mandate.findFirst({ where: { purchaseRequestId, status: "ACTIVE" }, orderBy: { version: "desc" } }),
    prisma.negotiation.findMany({ where: { purchaseRequestId } }),
  ]);
  if (!requestRow) {
    throw new DomainError("No se encontró la solicitud", "NOT_FOUND", 404);
  }
  if (!mandateRow) {
    throw new DomainError("La licitación necesita un mandato activo", "CONFLICT", 409);
  }
  const request = {
    id: requestRow.id,
    buyer_company_id: requestRow.buyerCompanyId,
    status: requestRow.status,
    version: requestRow.version,
    required_by: requestRow.requiredBy.toISOString().slice(0, 10),
    purchase_request_items: requestRow.items.map((item) => ({
      product_id: item.productId,
      description: item.description,
      unit: item.unit,
      minimum_quantity: item.minimumQuantity.toString(),
      target_quantity: item.targetQuantity.toString(),
      maximum_quantity: item.maximumQuantity.toString(),
    })),
  };
  const mandate = {
    maximum_total_including_fees: mandateRow.maximumTotalIncludingFees.toString(),
    allowed_suppliers: mandateRow.allowedSuppliers,
    payment_terms: mandateRow.paymentTerms,
    expires_at: mandateRow.expiresAt.toISOString(),
  };
  if (
    request.buyer_company_id !== buyer.companyId ||
    !["NEGOTIATING", "RECOMMENDED"].includes(request.status)
  ) {
    throw new DomainError("La solicitud no está lista para licitar", "CONFLICT", 409);
  }
  const item = (request.purchase_request_items as RequestItem[])[0];
  if (!item) throw new DomainError("La solicitud no tiene productos", "CONFLICT", 409);

  const negotiations: Negotiation[] = negotiationRows.map((negotiation) => ({
    id: negotiation.id,
    supplier_company_id: negotiation.supplierCompanyId,
    status: negotiation.status,
  })).filter((negotiation) =>
    ["OPEN", "FINAL_OFFERED"].includes(negotiation.status),
  );
  if (negotiations.length !== 3) {
    throw new DomainError(
      "La demo necesita exactamente tres distribuidores para comparar",
      "CONFLICT",
      409,
    );
  }
  const suppliers = await prisma.company.findMany({
    where: { id: { in: negotiations.map((negotiation) => negotiation.supplier_company_id) } },
    select: { id: true, legalName: true },
  });
  const supplierNames = new Map(
    suppliers.map((supplier) => [supplier.id, supplier.legalName]),
  );
  const buyerContext = await getBuyerProductContext(
    buyer.companyId,
    item.product_id,
  );

  const storedMessages: StoredMessage[] = (await prisma.negotiationMessage.findMany({
    where: { purchaseRequestId },
    orderBy: { sentAt: "asc" },
    select: { id: true, negotiationId: true, messageType: true, payload: true },
  })).map((message) => ({
    id: message.id,
    negotiation_id: message.negotiationId,
    message_type: message.messageType,
    payload: message.payload as Record<string, unknown>,
  }));
  const messagesFor = (negotiationId: string) =>
    storedMessages.filter((message) => message.negotiation_id === negotiationId);
  const missingFinalCount = negotiations.filter(
    (negotiation) =>
      !messagesFor(negotiation.id).some(
        (message) => message.message_type === "final_offer",
      ),
  ).length;

  if (request.status === "RECOMMENDED" && missingFinalCount === 0) {
    return {
      requested: negotiations.length,
      completed: negotiations.length,
      responses: negotiations.map((negotiation) => ({
        supplierCompanyId: negotiation.supplier_company_id,
        supplierName:
          supplierNames.get(negotiation.supplier_company_id) ?? "Distribuidor",
        ok: true,
      })),
      buyerStrategy: "Las tres ofertas finales ya estaban registradas.",
      recommendation: null,
    };
  }
  if (request.status === "RECOMMENDED") {
    await reopenIncompleteRecommendation(
      purchaseRequestId,
      buyer,
      Number(request.version),
    );
  }

  const rfqResults = await Promise.all(
    negotiations.map((negotiation) =>
      appendRequestForQuote({
        buyer,
        purchaseRequestId,
        requestItem: item,
        negotiation,
        requiredBy: String(request.required_by),
        paymentTerms: String(mandate.payment_terms),
        mandateExpiresAt: String(mandate.expires_at),
      }),
    ),
  );
  const rfqMessageByNegotiation = new Map(
    negotiations.map((negotiation, index) => [
      negotiation.id,
      rfqResults[index].messageId,
    ]),
  );

  const initialOffers: GeneratedOffer[] = [];
  const finalOfferByNegotiation = new Map<string, GeneratedOffer>();
  const counterByNegotiation = new Map<string, CounterWithMessage>();
  for (const negotiation of negotiations) {
    const priorMessages = messagesFor(negotiation.id);
    const supplierName =
      supplierNames.get(negotiation.supplier_company_id) ?? "Distribuidor";
    const initialMessage = priorMessages.find(
      (message) => message.message_type === "offer",
    );
    const finalMessage = priorMessages.find(
      (message) => message.message_type === "final_offer",
    );
    const counterMessage = priorMessages.find(
      (message) => message.message_type === "counteroffer",
    );

    if (initialMessage) {
      initialOffers.push(
        await restoreStoredOffer({
          message: initialMessage,
          negotiation,
          supplierName,
          buyerCompanyId: buyer.companyId,
          productId: item.product_id,
        }),
      );
    } else if (!finalMessage) {
      initialOffers.push(
        await generateSupplierRound({
          buyer,
          purchaseRequestId,
          requestItem: item,
          requiredBy: String(request.required_by),
          mandateMaximumTotal: String(mandate.maximum_total_including_fees),
          mandateExpiresAt: String(mandate.expires_at),
          negotiation,
          supplierName,
          phase: "INITIAL",
          correlationId: rfqMessageByNegotiation.get(negotiation.id)!,
        }),
      );
    }
    if (counterMessage) {
      counterByNegotiation.set(
        negotiation.id,
        restoreStoredCounter(counterMessage, negotiation),
      );
    }
    if (finalMessage) {
      finalOfferByNegotiation.set(
        negotiation.id,
        await restoreStoredOffer({
          message: finalMessage,
          negotiation,
          supplierName,
          buyerCompanyId: buyer.companyId,
          productId: item.product_id,
        }),
      );
    }
  }

  const offersMissingCounter = initialOffers.filter(
    (offer) =>
      !counterByNegotiation.has(offer.negotiationId) &&
      !finalOfferByNegotiation.has(offer.negotiationId),
  );
  const buyerCounterInput: BuyerCounterInput = {
    purchaseRequestId,
    buyerContext: buyerContext as unknown as Record<string, unknown>,
    mandateMaximumTotal: String(mandate.maximum_total_including_fees),
    offers: offersMissingCounter.map((offer) => ({
      negotiationId: offer.negotiationId,
      supplierCompanyId: offer.supplierCompanyId,
      supplierName: offer.supplierName,
      unitPrice: offer.unitPrice,
      total: offer.total,
      deliveryDate: offer.deliveryDate,
      paymentTerms: offer.paymentTerms,
      confirmedStock: offer.confirmedStock,
    })),
  };
  const buyerDecision = offersMissingCounter.length
    ? (await generateBuyerCountersReliably(buyerCounterInput)).counters
    : {
        strategySummary: "Se conservaron las contraofertas ya registradas.",
        counters: [] as Counter[],
      };
  for (const counter of buyerDecision.counters) {
    const offer = initialOffers.find(
      (candidate) => candidate.negotiationId === counter.negotiationId,
    );
    if (!offer) continue;
    const negotiation = negotiations.find(
      (candidate) => candidate.id === offer.negotiationId,
    );
    if (!negotiation) continue;
    const persistedCounter = await appendBuyerCounteroffer({
      buyer,
      purchaseRequestId,
      requestItem: item,
      negotiation,
      counter,
      mandateMaximumTotal: String(mandate.maximum_total_including_fees),
      mandateExpiresAt: String(mandate.expires_at),
      requiredBy: String(request.required_by),
      correlationId: offer.messageId,
    });
    counterByNegotiation.set(persistedCounter.negotiationId, persistedCounter);
  }

  for (const initial of initialOffers) {
    if (finalOfferByNegotiation.has(initial.negotiationId)) continue;
    const negotiation = negotiations.find(
      (candidate) => candidate.id === initial.negotiationId,
    );
    const counter = counterByNegotiation.get(initial.negotiationId);
    if (!negotiation || !counter) {
      throw new DomainError(
        "Falta la contraoferta necesaria para cerrar una negociación",
        "CONFLICT",
        409,
      );
    }
    const finalOffer = await generateSupplierRound({
      buyer,
      purchaseRequestId,
      requestItem: item,
      requiredBy: String(request.required_by),
      mandateMaximumTotal: String(mandate.maximum_total_including_fees),
      mandateExpiresAt: String(mandate.expires_at),
      negotiation,
      supplierName: initial.supplierName,
      phase: "FINAL",
      counter,
      correlationId: counter.messageId,
    });
    finalOfferByNegotiation.set(finalOffer.negotiationId, finalOffer);
  }
  const finalOffers = negotiations.flatMap((negotiation) => {
    const finalOffer = finalOfferByNegotiation.get(negotiation.id);
    return finalOffer ? [finalOffer] : [];
  });
  if (finalOffers.length !== negotiations.length) {
    throw new DomainError(
      "La licitación queda abierta hasta recibir las tres ofertas finales",
      "CONFLICT",
      409,
    );
  }

  const durationMs = Date.now() - startedAt;
  await Promise.all(
    finalOffers.map((final) => {
      const initial = initialOffers.find(
        (candidate) => candidate.negotiationId === final.negotiationId,
      );
      return initial
        ? recordMetrics({
            purchaseRequestId,
            initial,
            final,
            mandateMaximumTotal: String(mandate.maximum_total_including_fees),
            durationMs,
          })
        : Promise.resolve();
    }),
  );

  const recommendation = await generateOfferRecommendation(
    buyer,
    purchaseRequestId,
    buyerContext,
  );

  return {
    requested: negotiations.length,
    completed: finalOffers.length,
    responses: finalOffers.map((offer) => ({
      supplierCompanyId: offer.supplierCompanyId,
      supplierName: offer.supplierName,
      ok: true,
      offerId: offer.offerId,
    })),
    buyerStrategy: buyerDecision.strategySummary,
    recommendation,
  };
}
