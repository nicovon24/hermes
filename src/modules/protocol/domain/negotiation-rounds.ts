import { roundDivide } from "@/lib/decimal";

/**
 * How a distributor haggles: how many times it answers, how far above its floor
 * it opens, and how much of the remaining gap it gives up on each answer.
 *
 * Every choice comes from a seed (tender round + negotiation + product) instead
 * of `Math.random`, so a retry, a reconnected stream or a replayed snapshot
 * reproduces the same negotiation rather than inventing a different one.
 */

/** FNV-1a over the seed, normalized to [0,1). */
export function seededUnit(seed: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return ((hash >>> 0) % 1_000_000) / 1_000_000;
}

/** Spreads a seeded draw over an inclusive per-mille range. */
function seededPerMille(seed: string, from: number, to: number) {
  return BigInt(from + Math.round(seededUnit(seed) * (to - from)));
}

// Most distributors close in one or two answers; a minority stretches the
// haggling to four. Cumulative weights, so the draw picks the first bucket.
const EXCHANGE_WEIGHTS = [0.3, 0.65, 0.87, 1] as const;
export const MAX_SUPPLIER_EXCHANGES = EXCHANGE_WEIGHTS.length;

/** Answers this distributor is willing to give after its opening offer. */
export function plannedExchanges(seed: string) {
  const draw = seededUnit(`rondas:${seed}`);
  const bucket = EXCHANGE_WEIGHTS.findIndex((limit) => draw < limit);
  return bucket === -1 ? MAX_SUPPLIER_EXCHANGES : bucket + 1;
}

/**
 * The opening price. A seller that opens at its floor has nothing to concede,
 * which is exactly what made every round end at the first number: the opening
 * carries 6%–14% of negotiating room over the price it would defend.
 */
export function openingUnitPriceCents({ anchorCents, floorCents, seed }: {
  anchorCents: bigint;
  floorCents: bigint;
  seed: string;
}) {
  const base = anchorCents > floorCents ? anchorCents : floorCents;
  return roundDivide(base * (1_000n + seededPerMille(`apertura:${seed}`, 60, 140)), 1_000n);
}

// What the buyer asks off the price on the table, per exchange: a firm first
// ask, then smaller ones as both sides converge.
const BUYER_ASK_PER_MILLE = [120, 70, 45, 30] as const;

/**
 * The buyer's target for one line. A cheaper quote already on the table is the
 * strongest argument it has, so it asks the expensive distributor to match it.
 */
export function buyerTargetUnitPriceCents({ supplierUnitCents, rivalUnitCents, exchange, seed }: {
  supplierUnitCents: bigint;
  rivalUnitCents?: bigint | null;
  exchange: number;
  seed: string;
}) {
  const ask = BUYER_ASK_PER_MILLE[Math.min(Math.max(exchange, 1), BUYER_ASK_PER_MILLE.length) - 1];
  const jitter = seededPerMille(`pedido:${exchange}:${seed}`, 0, 20) - 10n;
  const asked = roundDivide(supplierUnitCents * (1_000n - BigInt(ask) - jitter), 1_000n);
  const rival = rivalUnitCents && rivalUnitCents > 0n && rivalUnitCents < asked ? rivalUnitCents : asked;
  return rival > 0n ? rival : supplierUnitCents;
}

/**
 * The seller's answer: it gives up part of the distance to the buyer's target
 * and keeps the rest, conceding more on the exchange it means to close with.
 * It never crosses the floor, which is its cost plus the margin it defends.
 */
export function concededUnitPriceCents({ currentCents, targetCents, floorCents, exchange, plannedExchanges: planned, seed }: {
  currentCents: bigint;
  targetCents: bigint;
  floorCents: bigint;
  exchange: number;
  plannedExchanges: number;
  seed: string;
}) {
  const limit = targetCents > floorCents ? targetCents : floorCents;
  if (currentCents <= limit) return currentCents;
  const share = exchange >= planned
    ? seededPerMille(`cierre:${exchange}:${seed}`, 650, 850)
    : seededPerMille(`cesion:${exchange}:${seed}`, 340, 560);
  const conceded = currentCents - roundDivide((currentCents - limit) * share, 1_000n);
  if (conceded <= limit) return limit;
  // Closing over a rounding-sized difference reads as haggling for the sake of
  // it: the distributor gives the last percent and calls it its final price.
  return exchange >= planned && (conceded - limit) * 100n <= limit ? limit : conceded;
}

/**
 * A model answer is welcome while it helps the buyer: never above the price the
 * distributor already quoted, never below its floor, and never worse than the
 * concession the deterministic curve had already committed to.
 */
export function guardedSupplierPriceCents(candidateCents: bigint, { floorCents, concededCents }: {
  floorCents: bigint;
  concededCents: bigint;
}) {
  if (candidateCents < floorCents) return floorCents;
  return candidateCents > concededCents ? concededCents : candidateCents;
}

/** Under half a percent there is nothing left to squeeze: the agent closes. */
export function worthAnotherExchange(previousCents: bigint, nextCents: bigint) {
  if (previousCents <= 0n) return false;
  return (previousCents - nextCents) * 1_000n >= previousCents * 5n;
}

/** Reduction between two prices, in per-mille, for the agents' own wording. */
export function reductionPercentage(fromCents: bigint, toCents: bigint) {
  if (fromCents <= 0n || toCents >= fromCents) return 0;
  return Number((fromCents - toCents) * 1_000n / fromCents) / 10;
}
