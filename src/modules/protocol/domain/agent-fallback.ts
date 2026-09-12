import type {
  BuyerCounterInput,
  SupplierTenderInput,
} from "@/modules/protocol/agent/groq";
import {
  ceilDivide,
  centsToMoney,
  decimalToScaledInteger,
  moneyToCents,
  roundDivide,
} from "@/lib/decimal";
import {
  buyerTargetUnitPriceCents,
  concededUnitPriceCents,
  openingUnitPriceCents,
  reductionPercentage,
  seededUnit,
} from "@/modules/protocol/domain/negotiation-rounds";

/** Cost plus the margin the distributor defends: it never quotes below this. */
export function supplierFloorCents(unitCost: string, targetMarginPercentage: string) {
  const costCents = moneyToCents(unitCost);
  const rawMargin = decimalToScaledInteger(targetMarginPercentage, 3);
  const margin = rawMargin < 0n ? 0n : rawMargin > 95_000n ? 95_000n : rawMargin;
  return ceilDivide(costCents * 100_000n, 100_000n - margin);
}

/** The two prices that frame the haggling: where it opens and where it stops. */
export function supplierPriceBounds(input: SupplierTenderInput, seed = "") {
  const floorCents = supplierFloorCents(input.unitCost, input.targetMarginPercentage);
  const historicalCents = moneyToCents(input.historicalAverageUnitPrice);
  const anchorCents = historicalCents > floorCents ? historicalCents : floorCents;
  return {
    floorCents,
    openingCents: openingUnitPriceCents({ anchorCents, floorCents, seed }),
  };
}

/** 2 to 5 days on the opening, one day less when the distributor closes. */
export function supplierDeliveryDays(input: SupplierTenderInput, seed = "") {
  const days = 2 + Math.floor(seededUnit(`entrega:${seed}`) * 4);
  return input.phase === "FINAL" ? Math.max(1, days - 1) : days;
}

export function createSupplierFallbackDraft(input: SupplierTenderInput, seed = "") {
  const { floorCents, openingCents } = supplierPriceBounds(input, seed);
  const deliveryDays = supplierDeliveryDays(input, seed);
  if (input.phase === "INITIAL") {
    return {
      unitPrice: centsToMoney(openingCents),
      shipping: "0.00",
      deliveryDays,
      paymentTerms: "CONTADO" as const,
      notes: "Precio de lista del distribuidor para este volumen, con stock reservado.",
    };
  }

  const currentCents = input.previousUnitPrice ? moneyToCents(input.previousUnitPrice) : openingCents;
  const targetCents = input.buyerCounterUnitPrice ? moneyToCents(input.buyerCounterUnitPrice) : currentCents;
  const unitPriceCents = concededUnitPriceCents({
    currentCents,
    targetCents,
    floorCents,
    exchange: input.exchange ?? 1,
    plannedExchanges: input.plannedExchanges ?? 1,
    seed,
  });
  const atFloor = unitPriceCents <= floorCents;
  const reduction = reductionPercentage(currentCents, unitPriceCents);

  return {
    unitPrice: centsToMoney(unitPriceCents),
    shipping: "0.00",
    deliveryDays,
    paymentTerms: "CONTADO" as const,
    notes: atFloor
      ? "Es el piso que sostiene el costo de reposición de este producto."
      : reduction > 0
        ? `El distribuidor cede ${reduction.toLocaleString("es-AR", { maximumFractionDigits: 1 })}% sobre su precio anterior manteniendo cantidad y fecha.`
        : "El distribuidor sostiene el precio: ya está sobre su costo de reposición.",
  };
}

export function createBuyerFallbackCounteroffers(input: BuyerCounterInput) {
  const mandateCents = moneyToCents(input.mandateMaximumTotal);

  return {
    strategySummary:
      "Contraofertas de continuidad calculadas para completar las tres negociaciones sin superar el mandato del comercio.",
    counters: input.offers.map((offer) => {
      const currentUnitCents = moneyToCents(offer.unitPrice);
      const currentTotalCents = moneyToCents(offer.total);
      const targetUnitCents = buyerTargetUnitPriceCents({
        supplierUnitCents: currentUnitCents,
        exchange: 1,
        seed: offer.negotiationId,
      });
      const targetTotalCents = currentUnitCents > 0n
        ? roundDivide(currentTotalCents * targetUnitCents, currentUnitCents)
        : currentTotalCents;
      return {
        negotiationId: offer.negotiationId,
        supplierCompanyId: offer.supplierCompanyId,
        targetUnitPrice: centsToMoney(targetUnitCents),
        maximumAcceptableTotal: centsToMoney(
          targetTotalCents < mandateCents ? targetTotalCents : mandateCents,
        ),
        message:
          "El comercio pide una mejora de precio manteniendo cantidad, stock confirmado y fecha de entrega.",
      };
    }),
  };
}
