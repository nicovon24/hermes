import { describe, expect, it } from "vitest";

import { buildSplitAwardRecommendation } from "@/modules/protocol/domain/split-award";

const baseLine = {
  quantity: "10",
  unitPrice: "10.00",
  subtotal: "100.00",
  taxes: "21.00",
  shipping: "0.00",
  total: "121.00",
  confirmedStock: true,
  deliveryDate: "2030-01-10",
  paymentTerms: "CONTADO",
  validUntil: "2030-01-09T12:00:00.000Z",
  offerStatus: "ACTIVE",
};

describe("buildSplitAwardRecommendation", () => {
  it("splits products between the cheapest eligible suppliers", () => {
    const result = buildSplitAwardRecommendation({
      requestLines: [
        { requestItemId: "i1", productId: "p1", description: "Uno", quantity: "10", urgencyScore: 1 },
        { requestItemId: "i2", productId: "p2", description: "Dos", quantity: "10", urgencyScore: 2 },
      ],
      offerLines: [
        { ...baseLine, offerLineId: "l1", offerId: "o1", requestItemId: "i1", productId: "p1", supplierCompanyId: "s1", supplierName: "Norte" },
        { ...baseLine, offerLineId: "l2", offerId: "o2", requestItemId: "i1", productId: "p1", supplierCompanyId: "s2", supplierName: "Andino", total: "130.00" },
        { ...baseLine, offerLineId: "l3", offerId: "o2", requestItemId: "i2", productId: "p2", supplierCompanyId: "s2", supplierName: "Andino", total: "110.00" },
      ],
      allowedSuppliers: ["s1", "s2"],
      requiredBy: "2030-01-10",
      mandateExpiresAt: "2030-01-09T23:00:00.000Z",
      maximumTotal: "500.00",
      now: new Date("2030-01-01T00:00:00.000Z"),
    });

    expect(result.allocations.map((line) => line.supplierCompanyId)).toEqual(["s1", "s2"]);
    expect(result.supplierOrders).toHaveLength(2);
    expect(result.pendingItems).toEqual([]);
    expect(result.grandTotal).toBe("231.00");
  });

  it("prioritizes the most urgent line when the budget is insufficient", () => {
    const result = buildSplitAwardRecommendation({
      requestLines: [
        { requestItemId: "later", productId: "p2", description: "Menos urgente", quantity: "10", urgencyScore: 8 },
        { requestItemId: "urgent", productId: "p1", description: "Urgente", quantity: "10", urgencyScore: 1 },
      ],
      offerLines: [
        { ...baseLine, offerLineId: "l1", offerId: "o1", requestItemId: "urgent", productId: "p1", supplierCompanyId: "s1", supplierName: "Norte" },
        { ...baseLine, offerLineId: "l2", offerId: "o1", requestItemId: "later", productId: "p2", supplierCompanyId: "s1", supplierName: "Norte" },
      ],
      allowedSuppliers: ["s1"],
      requiredBy: "2030-01-10",
      mandateExpiresAt: "2030-01-09T23:00:00.000Z",
      maximumTotal: "150.00",
      now: new Date("2030-01-01T00:00:00.000Z"),
    });

    expect(result.allocations[0]?.requestItemId).toBe("urgent");
    expect(result.pendingItems).toEqual([
      expect.objectContaining({ requestItemId: "later", reason: "PRESUPUESTO_INSUFICIENTE" }),
    ]);
  });
});
