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

export function createSupplierFallbackDraft(input: SupplierTenderInput) {
  const costCents = moneyToCents(input.unitCost);
  const rawMargin = decimalToScaledInteger(input.targetMarginPercentage, 3);
  const margin = rawMargin < 0n ? 0n : rawMargin > 95_000n ? 95_000n : rawMargin;
  const minimumCents = ceilDivide(costCents * 100_000n, 100_000n - margin);
  const historicalCents = moneyToCents(input.historicalAverageUnitPrice);
  const historicalAnchor = historicalCents > 0n
    ? roundDivide(historicalCents * 98n, 100n)
    : minimumCents;
  const initialAnchor = historicalAnchor > minimumCents ? historicalAnchor : minimumCents;
  const counterCents = input.buyerCounterUnitPrice
    ? moneyToCents(input.buyerCounterUnitPrice)
    : initialAnchor;
  const adjustedCounter = roundDivide(counterCents * 101n, 100n);
  const cappedCounter = adjustedCounter < initialAnchor ? adjustedCounter : initialAnchor;
  const finalCents = cappedCounter > minimumCents ? cappedCounter : minimumCents;
  const isFinal = input.phase === "FINAL";

  return {
    unitPrice: centsToMoney(isFinal ? finalCents : initialAnchor),
    shipping: "0.00",
    deliveryDays: 3,
    paymentTerms: "CONTADO" as const,
    notes: isFinal
      ? "Oferta final del distribuidor calculada con su costo, margen mínimo, stock y la contraoferta del comercio."
      : "Oferta inicial del distribuidor calculada con su costo, margen objetivo, stock e historial con el comercio.",
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
      const targetUnitCents = roundDivide(currentUnitCents * 95n, 100n);
      const targetTotalCents = roundDivide(currentTotalCents * 95n, 100n);
      return {
        negotiationId: offer.negotiationId,
        supplierCompanyId: offer.supplierCompanyId,
        targetUnitPrice: centsToMoney(targetUnitCents),
        maximumAcceptableTotal: centsToMoney(
          targetTotalCents < mandateCents ? targetTotalCents : mandateCents,
        ),
        message:
          "El comercio propone una mejora del 5% manteniendo cantidad, stock confirmado y fecha de entrega.",
      };
    }),
  };
}
