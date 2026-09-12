import { describe, expect, it } from "vitest";

import {
  createBuyerFallbackCounteroffers,
  createSupplierFallbackDraft,
} from "@/modules/protocol/domain/agent-fallback";

describe("agent continuity fallbacks", () => {
  it("returns a final supplier offer without breaking the target gross margin", () => {
    const draft = createSupplierFallbackDraft({
      phase: "FINAL",
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
      buyerCounterUnitPrice: "2400.00",
      buyerCounterMaximumTotal: "90000.00",
      buyerCounterMessage: "Mejorar precio.",
    });

    expect(draft.unitPrice).toBe("2500.00");
    expect(draft.notes).toContain("Oferta final");
  });

  it("creates one buyer counter for every supplier", () => {
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
    expect(counters.counters.map((counter) => counter.targetUnitPrice)).toEqual([
      "95.00",
      "104.50",
    ]);
  });
});
