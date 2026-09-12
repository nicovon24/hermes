import { ceilDivide, centsToMoney, moneyToCents } from "@/lib/decimal";

export type ReplenishmentContext = {
  productId: string;
  productName: string;
  unit: string;
  unitCost: string;
  availableStock: number;
  inTransit: number;
  unitsSoldLast30Days: number;
  averageDailyDemand: number;
  targetDaysOfStock: number;
  suggestedPurchaseQuantity: number;
};

export type AutomaticPurchaseDraft = {
  productId: string;
  description: string;
  unit: string;
  minimumQuantity: string;
  targetQuantity: string;
  maximumQuantity: string;
  requiredBy: string;
  expiresAt: string;
  mandateExpiresAt: string;
  maximumTotalIncludingFees: string;
  paymentTerms: string;
  settlementAsset: string;
  reason: string;
  availableStock: number;
  inTransit: number;
  unitsSoldLast30Days: number;
  targetDaysOfStock: number;
};

export type ConsolidatedDraftProduct = AutomaticPurchaseDraft & {
  unitCost: string;
  urgencyScore: number;
  automaticallySelected: boolean;
};

export type ConsolidatedPurchaseDraft = {
  products: ConsolidatedDraftProduct[];
  requiredBy: string;
  expiresAt: string;
  mandateExpiresAt: string;
  maximumTotalIncludingFees: string;
  paymentTerms: string;
  settlementAsset: string;
};

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 16);
}

function addDays(now: Date, days: number) {
  const result = new Date(now);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function projectedDaysOfStock(context: ReplenishmentContext) {
  if (context.averageDailyDemand <= 0) return Number.POSITIVE_INFINITY;
  return (context.availableStock + context.inTransit) / context.averageDailyDemand;
}

function budgetForMaximumQuantity(maximumQuantity: string, unitCost: string) {
  const baseCost = BigInt(maximumQuantity) * moneyToCents(unitCost);
  const loadedCost = ceilDivide(baseCost * 160n, 100n);
  const minimumBudget = 10_000n;
  const rounded = ceilDivide(
    loadedCost > minimumBudget ? loadedCost : minimumBudget,
    10_000n,
  ) * 10_000n;
  return centsToMoney(rounded);
}

function buildDraft(
  candidate: ReplenishmentContext,
  now: Date,
): AutomaticPurchaseDraft {
  const targetQuantity = Math.max(1, Math.ceil(candidate.suggestedPurchaseQuantity));
  const minimumQuantity = Math.max(1, Math.floor(targetQuantity * 0.8));
  const maximumQuantity = Math.max(targetQuantity, Math.ceil(targetQuantity * 1.25));
  const requiredBy = addDays(now, 5);
  const expiresAt = addDays(now, 2);

  return {
    productId: candidate.productId,
    description: candidate.productName,
    unit: candidate.unit,
    minimumQuantity: String(minimumQuantity),
    targetQuantity: String(targetQuantity),
    maximumQuantity: String(maximumQuantity),
    requiredBy: requiredBy.toISOString().slice(0, 10),
    expiresAt: dateInputValue(expiresAt),
    mandateExpiresAt: dateInputValue(expiresAt),
    maximumTotalIncludingFees: budgetForMaximumQuantity(
      String(maximumQuantity),
      candidate.unitCost,
    ),
    paymentTerms: "CONTADO",
    settlementAsset: "ARS",
    reason: `Stock proyectado por debajo del objetivo de ${candidate.targetDaysOfStock} días.`,
    availableStock: candidate.availableStock,
    inTransit: candidate.inTransit,
    unitsSoldLast30Days: candidate.unitsSoldLast30Days,
    targetDaysOfStock: candidate.targetDaysOfStock,
  };
}

export function buildAutomaticPurchaseDrafts(
  contexts: ReplenishmentContext[],
  now = new Date(),
): AutomaticPurchaseDraft[] {
  return contexts
    .filter((context) => context.suggestedPurchaseQuantity > 0)
    .sort(
      (left, right) =>
        projectedDaysOfStock(left) - projectedDaysOfStock(right) ||
        right.suggestedPurchaseQuantity - left.suggestedPurchaseQuantity,
    )
    .map((context) => buildDraft(context, now));
}

export function buildAutomaticPurchaseDraft(
  contexts: ReplenishmentContext[],
  now = new Date(),
): AutomaticPurchaseDraft | null {
  return buildAutomaticPurchaseDrafts(contexts, now)[0] ?? null;
}

export function buildConsolidatedPurchaseDraft(
  contexts: ReplenishmentContext[],
  openProductIds: Iterable<string> = [],
  now = new Date(),
): ConsolidatedPurchaseDraft {
  const excluded = new Set(openProductIds);
  const defaultRequiredBy = addDays(now, 5).toISOString().slice(0, 10);
  const defaultExpiry = dateInputValue(addDays(now, 2));
  const products = contexts
    .map((context) => {
      const automatic =
        context.suggestedPurchaseQuantity > 0 && !excluded.has(context.productId);
      const quantity = automatic
        ? Math.max(1, Math.ceil(context.suggestedPurchaseQuantity))
        : 1;
      const minimum = automatic ? Math.max(1, Math.floor(quantity * 0.8)) : 1;
      const maximum = automatic ? Math.max(quantity, Math.ceil(quantity * 1.25)) : 1;
      const coverage = projectedDaysOfStock(context);
      return {
        ...buildDraft(
          { ...context, suggestedPurchaseQuantity: quantity },
          now,
        ),
        minimumQuantity: String(minimum),
        targetQuantity: String(quantity),
        maximumQuantity: String(maximum),
        requiredBy: defaultRequiredBy,
        expiresAt: defaultExpiry,
        mandateExpiresAt: defaultExpiry,
        unitCost: context.unitCost,
        urgencyScore: Number.isFinite(coverage) ? coverage : 999999,
        automaticallySelected: automatic,
        reason: automatic
          ? `Cobertura proyectada de ${coverage.toFixed(1)} días, por debajo del objetivo de ${context.targetDaysOfStock}.`
          : excluded.has(context.productId)
            ? "Ya está incluido en otro pedido abierto."
            : "Disponible para agregar manualmente al pedido.",
      };
    })
    .sort(
      (left, right) =>
        Number(right.automaticallySelected) - Number(left.automaticallySelected) ||
        left.urgencyScore - right.urgencyScore ||
        left.description.localeCompare(right.description),
    );
  const initialMaximumCents = products
    .filter((product) => product.automaticallySelected)
    .reduce(
      (total, product) =>
        total + ceilDivide(
          BigInt(product.maximumQuantity) * moneyToCents(product.unitCost) * 160n,
          100n,
        ),
      0n,
    );

  const roundedMaximumCents = ceilDivide(
    initialMaximumCents > 10_000n ? initialMaximumCents : 10_000n,
    10_000n,
  ) * 10_000n;

  return {
    products,
    requiredBy: defaultRequiredBy,
    expiresAt: defaultExpiry,
    mandateExpiresAt: defaultExpiry,
    maximumTotalIncludingFees: centsToMoney(roundedMaximumCents),
    paymentTerms: "CONTADO",
    settlementAsset: "ARS",
  };
}
