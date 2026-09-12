import "server-only";

import Groq from "groq-sdk";
import { z } from "zod";

import { groqEnv } from "@/lib/env";

const recommendationSchema = z.object({
  recommendedOfferId: z.uuid().nullable(),
  summary: z.string().min(1).max(1_500),
  ranking: z.array(
    z.object({
      offerId: z.uuid(),
      position: z.number().int().positive(),
      reason: z.string().min(1).max(1_000),
      warnings: z.array(z.string().max(300)),
    }),
  ),
});

const recommendationJsonSchema = {
  type: "object",
  properties: {
    recommendedOfferId: { type: ["string", "null"] },
    summary: { type: "string" },
    ranking: {
      type: "array",
      items: {
        type: "object",
        properties: {
          offerId: { type: "string" },
          position: { type: "integer" },
          reason: { type: "string" },
          warnings: { type: "array", items: { type: "string" } },
        },
        required: ["offerId", "position", "reason", "warnings"],
        additionalProperties: false,
      },
    },
  },
  required: ["recommendedOfferId", "summary", "ranking"],
  additionalProperties: false,
} as const;

const supplierOfferDraftSchema = z.object({
  unitPrice: z.string().regex(/^\d{1,18}(?:\.\d{1,2})?$/),
  shipping: z.string().regex(/^\d{1,18}(?:\.\d{1,2})?$/),
  deliveryDays: z.number().int().min(1).max(14),
  paymentTerms: z.enum(["CONTADO", "7_DIAS", "15_DIAS", "30_DIAS"]),
  notes: z.string().min(1).max(500),
});

const supplierOfferDraftJsonSchema = {
  type: "object",
  properties: {
    unitPrice: { type: "string" },
    shipping: { type: "string" },
    deliveryDays: { type: "integer", minimum: 1, maximum: 14 },
    paymentTerms: {
      type: "string",
      enum: ["CONTADO", "7_DIAS", "15_DIAS", "30_DIAS"],
    },
    notes: { type: "string" },
  },
  required: ["unitPrice", "shipping", "deliveryDays", "paymentTerms", "notes"],
  additionalProperties: false,
} as const;

const buyerCounteroffersSchema = z.object({
  strategySummary: z.string().min(1).max(1_000),
  counters: z.array(
    z.object({
      negotiationId: z.uuid(),
      supplierCompanyId: z.uuid(),
      targetUnitPrice: z.string().regex(/^\d{1,18}(?:\.\d{1,2})?$/),
      maximumAcceptableTotal: z.string().regex(/^\d{1,18}(?:\.\d{1,2})?$/),
      message: z.string().min(1).max(500),
    }),
  ),
});

const buyerCounteroffersJsonSchema = {
  type: "object",
  properties: {
    strategySummary: { type: "string" },
    counters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          negotiationId: { type: "string" },
          supplierCompanyId: { type: "string" },
          targetUnitPrice: { type: "string" },
          maximumAcceptableTotal: { type: "string" },
          message: { type: "string" },
        },
        required: [
          "negotiationId",
          "supplierCompanyId",
          "targetUnitPrice",
          "maximumAcceptableTotal",
          "message",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["strategySummary", "counters"],
  additionalProperties: false,
} as const;

export type AgentOffer = {
  id: string;
  supplierCompanyId: string;
  total: string;
  deliveryDate: string;
  paymentTerms: string;
  confirmedStock: boolean;
};

export type SupplierTenderInput = {
  phase: "INITIAL" | "FINAL";
  supplierName: string;
  productId: string;
  productName: string;
  unit: string;
  requestedQuantity: string;
  availableQuantity: string;
  maximumTenderTotal: string;
  requiredBy: string;
  unitCost: string;
  targetMarginPercentage: string;
  targetRotationDays: number;
  unitsPreviouslySoldToClient: string;
  historicalAverageUnitPrice: string;
  buyerCounterUnitPrice?: string;
  buyerCounterMaximumTotal?: string;
  buyerCounterMessage?: string;
};

export type BuyerCounterInput = {
  purchaseRequestId: string;
  buyerContext: Record<string, unknown>;
  mandateMaximumTotal: string;
  offers: Array<{
    negotiationId: string;
    supplierCompanyId: string;
    supplierName: string;
    unitPrice: string;
    total: string;
    deliveryDate: string;
    paymentTerms: string;
    confirmedStock: boolean;
  }>;
};

export async function generateSupplierOfferDraft(input: SupplierTenderInput) {
  const { apiKey, model } = groqEnv();
  const groq = new Groq({ apiKey });
  const completion = await groq.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: [
          "You are the autonomous sales agent of one Argentine B2B distributor.",
          "Respond to the tender with a competitive ARS unit price, shipping, delivery days and payment terms.",
          "In FINAL phase, answer the buyer counteroffer and improve the proposal when compatible with margin and rotation objectives.",
          "All monetary values must be positive decimal strings with exactly two decimals.",
          "Use only the supplied product, stock, quantity, deadline and budget facts.",
          "Do not accept payment, change stock, or invent additional products.",
          "Return a concise Spanish note explaining the commercial proposal.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify(input),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "supplier_offer_draft",
        strict: true,
        schema: supplierOfferDraftJsonSchema,
      },
    },
  });

  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("Groq returned an empty supplier offer");

  return {
    draft: supplierOfferDraftSchema.parse(JSON.parse(content)),
    model,
  };
}

export async function generateBuyerCounteroffers(input: BuyerCounterInput) {
  const { apiKey, model } = groqEnv();
  const groq = new Groq({ apiKey });
  const candidateKeys = new Set(
    input.offers.map(
      (offer) => `${offer.negotiationId}:${offer.supplierCompanyId}`,
    ),
  );
  const completion = await groq.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: [
          "You are the autonomous purchasing agent of an Argentine retail business.",
          "Negotiate separately with every supplier to reduce capital tied in inventory while preserving stock coverage and delivery reliability.",
          "Use sales trend, current stock, incoming stock, target stock days and target stock capital.",
          "Return exactly one counter per supplied negotiation and preserve every supplied ID.",
          "Amounts are ARS decimal strings with exactly two decimals.",
          "Never exceed the mandate maximum and do not accept or pay an offer.",
          "Write concise Spanish negotiation messages.",
        ].join(" "),
      },
      { role: "user", content: JSON.stringify(input) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "buyer_counteroffers",
        strict: true,
        schema: buyerCounteroffersJsonSchema,
      },
    },
  });

  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("Groq returned empty buyer counteroffers");
  const counters = buyerCounteroffersSchema.parse(JSON.parse(content));
  const returnedKeys = new Set(
    counters.counters.map(
      (counter) => `${counter.negotiationId}:${counter.supplierCompanyId}`,
    ),
  );
  if (
    returnedKeys.size !== candidateKeys.size ||
    [...candidateKeys].some((key) => !returnedKeys.has(key))
  ) {
    throw new Error("Groq returned incomplete or unknown negotiation counters");
  }

  return { counters, model };
}

export async function rankEligibleOffers(
  offers: AgentOffer[],
  buyerContext?: Record<string, unknown>,
) {
  const { apiKey, model } = groqEnv();
  const groq = new Groq({ apiKey });
  const candidateIds = new Set(offers.map((offer) => offer.id));

  const completion = await groq.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: [
          "You rank already policy-eligible B2B purchase offers.",
          "Prefer lower total, then earlier delivery, then clearer payment terms.",
          "Use only the supplied facts. Never invent an offer or operational fact.",
          "Write the summary, reasons, and warnings in clear Spanish.",
          "Return a concise business explanation, not hidden reasoning.",
          "You recommend only; you never accept, reserve funds, or pay.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          currency: "ARS",
          buyerContext: buyerContext ?? null,
          eligibleOffers: offers,
        }),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "offer_recommendation",
        strict: true,
        schema: recommendationJsonSchema,
      },
    },
  });

  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("Groq returned an empty recommendation");

  const recommendation = recommendationSchema.parse(JSON.parse(content));
  if (
    recommendation.recommendedOfferId &&
    !candidateIds.has(recommendation.recommendedOfferId)
  ) {
    throw new Error("Groq recommended an offer outside the eligible candidate set");
  }
  if (recommendation.ranking.some((entry) => !candidateIds.has(entry.offerId))) {
    throw new Error("Groq ranked an offer outside the eligible candidate set");
  }
  const rankedIds = new Set(recommendation.ranking.map((entry) => entry.offerId));
  const positions = new Set(recommendation.ranking.map((entry) => entry.position));
  if (
    rankedIds.size !== offers.length ||
    positions.size !== offers.length ||
    offers.some((offer) => !rankedIds.has(offer.id))
  ) {
    throw new Error("Groq returned an incomplete or duplicate ranking");
  }
  const first = recommendation.ranking.find((entry) => entry.position === 1);
  if (recommendation.recommendedOfferId !== first?.offerId) {
    throw new Error("Groq recommendation does not match ranking position 1");
  }

  return { recommendation, model };
}
