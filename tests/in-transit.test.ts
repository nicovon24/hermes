import { describe, expect, it } from "vitest";
import { arrivedProductIds, inTransitMap, sumInTransit } from "@/modules/protocol/domain/in-transit";

describe("in-transit units", () => {
  it("adds the lines of every paid order per product, in a stable order", () => {
    expect(sumInTransit([
      { productId: "HARINA-1000", quantity: "30" },
      { productId: "ARROZ-1000", quantity: "21" },
      { productId: "HARINA-1000", quantity: "12.5" },
    ])).toEqual([
      { productId: "ARROZ-1000", quantity: 21 },
      { productId: "HARINA-1000", quantity: 42.5 },
    ]);
  });

  it("ignores lines without a usable quantity", () => {
    expect(sumInTransit([
      { productId: "LECHE-1000", quantity: "0" },
      { productId: "LECHE-1000", quantity: "-4" },
      { productId: "LECHE-1000", quantity: "no" },
    ])).toEqual([]);
  });

  it("reports only the products whose travelling quantity grew", () => {
    const before = [{ productId: "HARINA-1000", quantity: 30 }, { productId: "YERBA-1000", quantity: 10 }];
    const after = [{ productId: "ARROZ-1000", quantity: 21 }, { productId: "HARINA-1000", quantity: 42 }, { productId: "YERBA-1000", quantity: 10 }];
    expect(arrivedProductIds(before, after)).toEqual(["ARROZ-1000", "HARINA-1000"]);
    expect(arrivedProductIds(after, after)).toEqual([]);
  });

  it("exposes the totals as a lookup for the storefront rows", () => {
    expect(inTransitMap([{ productId: "AZUCAR-1000", quantity: 27 }]).get("AZUCAR-1000")).toBe(27);
  });
});
