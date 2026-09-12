import type { OfferChange, PublicOffer, TenderMetrics, TenderPhase, TenderProgressEvent } from "./purchase-flow";
import { moneyToCents, centsToMoney, quantityToMicros } from "@/lib/decimal";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function cents(value: string): bigint {
  return moneyToCents(value);
}
export function moneyString(value: bigint): string {
  return centsToMoney(value);
}
export function priceChange(before: string, after: string, comparable = true): OfferChange {
  const baseline = cents(before), delta = baseline - cents(after);
  return { amount: moneyString(delta), percentage: baseline > 0n && comparable ? Number(delta * 10_000n / baseline) / 100 : null, comparable };
}
export function publicOffer(payload: unknown, requestedProducts: number): PublicOffer {
  const data = record(payload);
  const lines = (Array.isArray(data.lines) ? data.lines : []).map(record).map((line) => ({
    itemId: String(line.requestItemId ?? line.productId ?? ""), quantity: String(line.quantity ?? "0"), unit: String(line.unit ?? ""),
    total: String(line.total ?? line.lineTotal ?? "0"),
  }));
  return { total: String(data.total ?? "0"), deliveryDate: lines.length && typeof data.deliveryDate === "string" ? data.deliveryDate : null, coveredProducts: lines.length, requestedProducts, lines };
}
function comparable(a: PublicOffer, b: PublicOffer) {
  return a.lines.length > 0 && a.lines.length === b.lines.length && a.lines.every((line) => b.lines.some((next) => next.itemId === line.itemId && quantityToMicros(next.quantity) === quantityToMicros(line.quantity) && next.unit === line.unit));
}
export function offerMetrics(current: PublicOffer, initial: PublicOffer | null, previous: PublicOffer | null, target: PublicOffer | null, proposed: boolean): TenderMetrics {
  const compare = (before: PublicOffer | null) => before ? priceChange(before.total, current.total, comparable(before, current)) : null;
  const days = previous?.deliveryDate && current.deliveryDate ? Math.round((Date.parse(previous.deliveryDate) - Date.parse(current.deliveryDate)) / 86_400_000) : null;
  return { offer: current, saving: compare(initial), previousChange: compare(previous), targetGap: compare(target), coverageChange: previous ? current.coveredProducts - previous.coveredProducts : 0, deliveryDaysEarlier: days !== null && Number.isFinite(days) ? days : null, proposed };
}

export type ProgressMessage = { id: string; supplierId: string; messageType: string; timestamp: string; payload: unknown; tenderRoundId: string | null };
export function messageProgress(requestId: string, messages: ProgressMessage[], requestedProducts: number): TenderProgressEvent[] {
  const history = new Map<string, { initial: PublicOffer | null; previous: PublicOffer | null; target: PublicOffer | null }>();
  const phases: Record<string, TenderPhase> = { request_for_quote: "rfq", offer: "initial_offer", counteroffer: "counteroffer", final_offer: "final_offer", payment_status: "payment" };
  const seen = new Set<string>();
  return messages.flatMap((message) => {
    if (seen.has(message.id) || !phases[message.messageType]) return [];
    seen.add(message.id);
    const phase = phases[message.messageType];
    const prior = history.get(message.supplierId) ?? { initial: null, previous: null, target: null };
    const event: TenderProgressEvent = {
      id: message.id, messageId: message.id, requestId, tenderRoundId: message.tenderRoundId,
      supplierId: message.supplierId, timestamp: message.timestamp, phase, sequence: seen.size,
      direction: phase === "initial_offer" || phase === "final_offer" ? "inbound" : "outbound",
    };
    if (phase === "rfq") {
      const payload = record(message.payload);
      event.requestItems = (Array.isArray(payload.items) ? payload.items : []).map(record).map((item) => ({
        productId: String(item.productId ?? ""),
        description: String(item.description ?? item.productId ?? "Producto"),
        quantity: String(item.targetQuantity ?? item.quantity ?? "0"),
        unit: String(item.unit ?? "unidades"),
      }));
    }
    if (["initial_offer", "counteroffer", "final_offer"].includes(phase)) {
      const offer = publicOffer(message.payload, requestedProducts);
      event.metrics = offerMetrics(offer, prior.initial, prior.previous, phase === "final_offer" ? prior.target : null, phase === "counteroffer");
      if (phase === "initial_offer") prior.initial = offer;
      if (phase === "counteroffer") prior.target = offer;
      prior.previous = offer;
    }
    if (phase === "payment") event.status = String(record(message.payload).status ?? "PENDING");
    history.set(message.supplierId, prior);
    return [event];
  });
}

export function mergeProgress(current: TenderProgressEvent[], incoming: TenderProgressEvent[]): TenderProgressEvent[] {
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()];
}

/** Incremental NDJSON parsing handles UTF-8/chunk boundaries and a final line without LF. */
export async function readProgressStream(body: ReadableStream<Uint8Array>, onEvent: (event: TenderProgressEvent) => void) {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  const consume = (line: string) => {
    if (!line.trim()) return;
    const value = JSON.parse(line);
    if (value.type === "connected") return;
    if (value.type === "transport_error") throw new Error(value.message);
    onEvent(value as TenderProgressEvent);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) { consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
      if (done) { consume(buffer); break; }
    }
  } finally { reader.releaseLock(); }
}
