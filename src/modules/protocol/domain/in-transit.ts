// What the shop already bought and has not received yet: the units of every
// paid purchase order, added per catalog product. Pure, so both the server
// page and the live stream can share it.

export type InTransitLine = { productId: string; quantity: number };

/**
 * An order travels once its payment confirmed and until the distributor marks
 * it delivered; a cancelled order never travels.
 */
export const IN_TRANSIT_ORDER_STATUSES = ["CREATED", "CONFIRMED", "PAID"] as const;

/**
 * The money is in: directly on Arbitrum, or on the destination leg when the
 * payment came from Solana. Anything earlier is still an intent to pay.
 */
export const PAID_PAYMENT_STATUSES = ["PAYMENT_CONFIRMED", "DESTINATION_PAYMENT_CONFIRMED", "SETTLED"] as const;

/** Adds the lines of every travelling order, one entry per product. */
export function sumInTransit(items: Array<{ productId: string; quantity: string | number }>): InTransitLine[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    totals.set(item.productId, (totals.get(item.productId) ?? 0) + quantity);
  }
  return [...totals]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((left, right) => left.productId.localeCompare(right.productId));
}

export function inTransitMap(lines: InTransitLine[]) {
  return new Map(lines.map((line) => [line.productId, line.quantity]));
}

/** Products whose travelling quantity grew between two snapshots. */
export function arrivedProductIds(previous: InTransitLine[], next: InTransitLine[]) {
  const before = inTransitMap(previous);
  return next.filter((line) => line.quantity > (before.get(line.productId) ?? 0)).map((line) => line.productId);
}
