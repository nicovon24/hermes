import { describe, expect, it } from "vitest";

import {
  buildAutomaticPurchaseDraft,
  buildAutomaticPurchaseDrafts,
  buildConsolidatedPurchaseDraft,
} from "@/modules/context/replenishment";

describe("automatic purchase drafts", () => {
  it("chooses the product with the lowest projected coverage", () => {
    const draft = buildAutomaticPurchaseDraft(
      [
        {
          productId: "A",
          productName: "Producto A",
          unit: "unidad",
          unitCost: "100.00",
          availableStock: 4,
          inTransit: 0,
          unitsSoldLast30Days: 30,
          averageDailyDemand: 1,
          targetDaysOfStock: 14,
          suggestedPurchaseQuantity: 10,
        },
        {
          productId: "B",
          productName: "Producto B",
          unit: "unidad",
          unitCost: "200.00",
          availableStock: 10,
          inTransit: 0,
          unitsSoldLast30Days: 30,
          averageDailyDemand: 1,
          targetDaysOfStock: 14,
          suggestedPurchaseQuantity: 4,
        },
      ],
      new Date("2026-09-12T12:00:00.000Z"),
    );

    expect(draft).toMatchObject({
      productId: "A",
      minimumQuantity: "8",
      targetQuantity: "10",
      maximumQuantity: "13",
      requiredBy: "2026-09-17",
      maximumTotalIncludingFees: "2100.00",
    });
  });

  it("does not invent an order when projected stock covers the objective", () => {
    expect(
      buildAutomaticPurchaseDraft([
        {
          productId: "A",
          productName: "Producto A",
          unit: "unidad",
          unitCost: "100.00",
          availableStock: 20,
          inTransit: 10,
          unitsSoldLast30Days: 10,
          averageDailyDemand: 1 / 3,
          targetDaysOfStock: 14,
          suggestedPurchaseQuantity: 0,
        },
      ]),
    ).toBeNull();
  });

  it("creates one pending draft per product that needs replenishment", () => {
    const contexts = [
      {
        productId: "YERBA",
        productName: "Yerba",
        unit: "unidad",
        unitCost: "200.00",
        availableStock: 4,
        inTransit: 0,
        unitsSoldLast30Days: 72,
        averageDailyDemand: 2.4,
        targetDaysOfStock: 14,
        suggestedPurchaseQuantity: 30,
      },
      {
        productId: "ARROZ",
        productName: "Arroz",
        unit: "unidad",
        unitCost: "100.00",
        availableStock: 5,
        inTransit: 0,
        unitsSoldLast30Days: 54,
        averageDailyDemand: 1.8,
        targetDaysOfStock: 14,
        suggestedPurchaseQuantity: 21,
      },
    ];

    expect(buildAutomaticPurchaseDrafts(contexts)).toHaveLength(2);
    expect(buildAutomaticPurchaseDrafts(contexts).map((draft) => draft.productId))
      .toEqual(["YERBA", "ARROZ"]);
  });

  it("consolidates automatic lines and leaves every product available for manual add", () => {
    const draft = buildConsolidatedPurchaseDraft(
      [
        {
          productId: "YERBA",
          productName: "Yerba",
          unit: "unidad",
          unitCost: "200.00",
          availableStock: 4,
          inTransit: 0,
          unitsSoldLast30Days: 72,
          averageDailyDemand: 2.4,
          targetDaysOfStock: 14,
          suggestedPurchaseQuantity: 30,
        },
        {
          productId: "ACEITE",
          productName: "Aceite",
          unit: "unidad",
          unitCost: "300.00",
          availableStock: 20,
          inTransit: 10,
          unitsSoldLast30Days: 10,
          averageDailyDemand: 1 / 3,
          targetDaysOfStock: 14,
          suggestedPurchaseQuantity: 0,
        },
      ],
      ["YERBA"],
      new Date("2026-09-12T12:00:00.000Z"),
    );

    expect(draft.products).toHaveLength(2);
    expect(draft.products.every((product) => !product.automaticallySelected)).toBe(true);
    expect(draft.products.find((product) => product.productId === "ACEITE")).toMatchObject({
      minimumQuantity: "1",
      targetQuantity: "1",
      maximumQuantity: "1",
    });
  });
});
