import { describe, expect, it } from "vitest";

import {
  MAX_SUPPLIER_EXCHANGES,
  buyerTargetUnitPriceCents,
  concededUnitPriceCents,
  guardedSupplierPriceCents,
  openingUnitPriceCents,
  plannedExchanges,
  reductionPercentage,
  worthAnotherExchange,
} from "@/modules/protocol/domain/negotiation-rounds";

const seeds = Array.from({ length: 200 }, (_, index) => `ronda-${index}`);

describe("how long a distributor haggles", () => {
  it("keeps every negotiation between one and four answers", () => {
    const counts = seeds.map((seed) => plannedExchanges(seed));
    expect(Math.min(...counts)).toBe(1);
    expect(Math.max(...counts)).toBe(MAX_SUPPLIER_EXCHANGES);
    expect(counts.every((count) => Number.isInteger(count))).toBe(true);
  });
  it("stretches past two answers for a minority, not for everyone", () => {
    const long = seeds.filter((seed) => plannedExchanges(seed) >= 3).length / seeds.length;
    expect(long).toBeGreaterThan(0.2);
    expect(long).toBeLessThan(0.5);
  });
  it("replays the same plan for the same negotiation", () => {
    expect(seeds.map(plannedExchanges)).toEqual(seeds.map(plannedExchanges));
  });
});

describe("prices on the table", () => {
  const floorCents = 250_000n;
  const anchorCents = 270_000n;

  it("opens above the price it is willing to defend, leaving room to concede", () => {
    for (const seed of seeds.slice(0, 40)) {
      const opening = openingUnitPriceCents({ anchorCents, floorCents, seed });
      expect(opening).toBeGreaterThan(anchorCents);
      expect(opening).toBeLessThanOrEqual((anchorCents * 115n) / 100n);
    }
  });
  it("never opens under the floor even without sales history", () => {
    const opening = openingUnitPriceCents({ anchorCents: 0n, floorCents, seed: "sin-historial" });
    expect(opening).toBeGreaterThan(floorCents);
  });
  it("moves toward the buyer on every answer and stops at the floor", () => {
    let current = openingUnitPriceCents({ anchorCents, floorCents, seed: "curva" });
    const planned = 4;
    const prices = [current];
    for (let exchange = 1; exchange <= planned; exchange += 1) {
      current = concededUnitPriceCents({
        currentCents: current,
        targetCents: 100_000n,
        floorCents,
        exchange,
        plannedExchanges: planned,
        seed: "curva",
      });
      prices.push(current);
    }
    expect(prices.every((price, index) => index === 0 || price < prices[index - 1])).toBe(true);
    expect(prices.at(-1)).toBeGreaterThanOrEqual(floorCents);
    expect(prices.at(-1)).toBeLessThan(prices[0]);
  });
  it("closes at the buyer's number when the buyer asks above the floor", () => {
    const closed = concededUnitPriceCents({
      currentCents: 300_000n,
      targetCents: 290_000n,
      floorCents,
      exchange: 1,
      plannedExchanges: 1,
      seed: "cierre",
    });
    expect(closed).toBeGreaterThanOrEqual(290_000n);
    expect(closed).toBeLessThan(300_000n);
  });
  it("never answers above the price already quoted", () => {
    expect(concededUnitPriceCents({
      currentCents: 200_000n,
      targetCents: 260_000n,
      floorCents,
      exchange: 2,
      plannedExchanges: 3,
      seed: "sin-margen",
    })).toBe(200_000n);
  });
});

describe("what the buyer asks for", () => {
  it("asks least on the first pass and converges afterwards", () => {
    const first = buyerTargetUnitPriceCents({ supplierUnitCents: 100_000n, exchange: 1, seed: "pedido" });
    const second = buyerTargetUnitPriceCents({ supplierUnitCents: 100_000n, exchange: 2, seed: "pedido" });
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(100_000n);
  });
  it("uses a cheaper quote already received as the number to match", () => {
    const target = buyerTargetUnitPriceCents({
      supplierUnitCents: 100_000n,
      rivalUnitCents: 80_000n,
      exchange: 1,
      seed: "competencia",
    });
    expect(target).toBe(80_000n);
  });
  it("ignores a rival that is more expensive than what it would ask anyway", () => {
    const withRival = buyerTargetUnitPriceCents({ supplierUnitCents: 100_000n, rivalUnitCents: 99_000n, exchange: 1, seed: "caro" });
    const alone = buyerTargetUnitPriceCents({ supplierUnitCents: 100_000n, exchange: 1, seed: "caro" });
    expect(withRival).toBe(alone);
  });
});

describe("guards around a model answer", () => {
  it("keeps a model price inside the band the distributor committed to", () => {
    expect(guardedSupplierPriceCents(50_000n, { floorCents: 90_000n, concededCents: 95_000n })).toBe(90_000n);
    expect(guardedSupplierPriceCents(99_000n, { floorCents: 90_000n, concededCents: 95_000n })).toBe(95_000n);
    expect(guardedSupplierPriceCents(92_000n, { floorCents: 90_000n, concededCents: 95_000n })).toBe(92_000n);
  });
  it("closes instead of sending a round that moves nothing", () => {
    expect(worthAnotherExchange(100_000n, 99_000n)).toBe(true);
    expect(worthAnotherExchange(100_000n, 99_600n)).toBe(false);
    expect(worthAnotherExchange(100_000n, 100_000n)).toBe(false);
    expect(worthAnotherExchange(0n, 0n)).toBe(false);
  });
  it("reports the reduction the agents can quote in their messages", () => {
    expect(reductionPercentage(100_000n, 95_000n)).toBe(5);
    expect(reductionPercentage(100_000n, 100_000n)).toBe(0);
    expect(reductionPercentage(100_000n, 110_000n)).toBe(0);
  });
});
