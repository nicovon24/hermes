import { describe, expect, it } from "vitest";

import { moneyToCents } from "@/lib/decimal";
import {
  createBuyerFallbackCounteroffers,
  createSupplierFallbackDraft,
  supplierPriceBounds,
} from "@/modules/protocol/domain/agent-fallback";
import type { SupplierTenderInput } from "@/modules/protocol/agent/groq";

const tender: SupplierTenderInput = {
  phase: "INITIAL",
  supplierName: "Distribuidora Norte",
  productId: "YERBA-500",
  productName: "Yerba mate 500 g",
  unit: "paquete",
  requestedQuantity: "30",
  availableQuantity: "100",
  maximumTenderTotal: "150000.00",
  requiredBy: "2026-09-17",
  unitCost: "2000.00",
  targetMarginPercentage: "20.000",
  targetRotationDays: 30,
  unitsPreviouslySoldToClient: "120",
  historicalAverageUnitPrice: "2700.00",
};
// Cost 2000 with a 20% target margin: the distributor defends 2500 per unit.
const floor = moneyToCents("2500.00");

describe("agent continuity fallbacks", () => {
  it("opens above the price it will defend so the haggling has somewhere to go", () => {
    const opening = createSupplierFallbackDraft(tender, "norte:yerba");
    expect(moneyToCents(opening.unitPrice)).toBeGreaterThan(moneyToCents("2700.00"));
    expect(supplierPriceBounds(tender, "norte:yerba").floorCents).toBe(floor);
  });

  it("answers a counteroffer below its opening and never breaks the target gross margin", () => {
    const opening = createSupplierFallbackDraft(tender, "norte:yerba");
    const answer = createSupplierFallbackDraft({
      ...tender,
      phase: "FINAL",
      exchange: 1,
      plannedExchanges: 1,
      previousUnitPrice: opening.unitPrice,
      buyerCounterUnitPrice: "1800.00",
      buyerCounterMaximumTotal: "90000.00",
      buyerCounterMessage: "Mejorar precio.",
    }, "norte:yerba");

    expect(moneyToCents(answer.unitPrice)).toBeGreaterThanOrEqual(floor);
    expect(moneyToCents(answer.unitPrice)).toBeLessThan(moneyToCents(opening.unitPrice));
    expect(answer.notes).toContain("precio");
  });

  it("concedes on every pass and lands on its floor when the buyer keeps pushing", () => {
    const planned = 4;
    let price = createSupplierFallbackDraft(tender, "andino:yerba").unitPrice;
    const prices = [price];
    for (let exchange = 1; exchange <= planned; exchange += 1) {
      price = createSupplierFallbackDraft({
        ...tender,
        phase: exchange === planned ? "FINAL" : "COUNTER",
        exchange,
        plannedExchanges: planned,
        previousUnitPrice: price,
        buyerCounterUnitPrice: "1500.00",
      }, "andino:yerba").unitPrice;
      prices.push(price);
    }
    const cents = prices.map(moneyToCents);
    expect(cents.every((value, index) => index === 0 || value < cents[index - 1])).toBe(true);
    expect(cents.at(-1)).toBe(floor);
  });

  it("repeats the same negotiation for the same seed and varies between distributors", () => {
    expect(createSupplierFallbackDraft(tender, "norte:yerba")).toEqual(createSupplierFallbackDraft(tender, "norte:yerba"));
    const openings = new Set(
      ["norte", "andino", "sur"].map((seed) => createSupplierFallbackDraft(tender, `${seed}:yerba`).unitPrice),
    );
    expect(openings.size).toBeGreaterThan(1);
  });

  it("creates one buyer counter under the price on the table for every supplier", () => {
    const counters = createBuyerFallbackCounteroffers({
      purchaseRequestId: "00000000-0000-4000-8000-000000000001",
      buyerContext: {},
      mandateMaximumTotal: "100000.00",
      offers: [
        {
          negotiationId: "00000000-0000-4000-8000-000000000011",
          supplierCompanyId: "00000000-0000-4000-8000-000000000021",
          supplierName: "Uno",
          unitPrice: "100.00",
          total: "1210.00",
          deliveryDate: "2026-09-17",
          paymentTerms: "CONTADO",
          confirmedStock: true,
        },
        {
          negotiationId: "00000000-0000-4000-8000-000000000012",
          supplierCompanyId: "00000000-0000-4000-8000-000000000022",
          supplierName: "Dos",
          unitPrice: "110.00",
          total: "1331.00",
          deliveryDate: "2026-09-17",
          paymentTerms: "CONTADO",
          confirmedStock: true,
        },
      ],
    });

    expect(counters.counters).toHaveLength(2);
    for (const [index, counter] of counters.counters.entries()) {
      const quoted = moneyToCents(["100.00", "110.00"][index]);
      expect(moneyToCents(counter.targetUnitPrice)).toBeLessThan(quoted);
      expect(moneyToCents(counter.targetUnitPrice)).toBeGreaterThan((quoted * 80n) / 100n);
      expect(moneyToCents(counter.maximumAcceptableTotal)).toBeLessThanOrEqual(moneyToCents("100000.00"));
    }
  });
});
