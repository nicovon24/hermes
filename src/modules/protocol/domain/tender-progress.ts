import type { OfferChange, PublicOffer, TenderChatMessage, TenderMetrics, TenderPhase, TenderProgressEvent } from "./purchase-flow";
import { formatArs, moneyToCents, centsToMoney, quantityToMicros } from "@/lib/decimal";

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

/**
 * The conversation as the two agents held it: every negotiation message becomes
 * one readable turn — who spoke, the figures that moved, and the note the agent
 * wrote — so the stage can show the thread without shipping the raw payloads.
 */
const chatTurns: Partial<Record<TenderPhase, { role: TenderChatMessage["role"]; label: string }>> = {
  rfq: { role: "buyer", label: "Licitación enviada" },
  initial_offer: { role: "supplier", label: "Oferta inicial" },
  counteroffer: { role: "buyer", label: "Contraoferta del comprador" },
  improved_offer: { role: "supplier", label: "Mejora del proveedor" },
  final_offer: { role: "supplier", label: "Oferta final" },
};
function dayMonth(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(5, 10).split("-").reverse().join("/") : null;
}
export function chatMessage(phase: TenderPhase, payload: unknown, requestedProducts: number, exchange = 0): TenderChatMessage | undefined {
  const turn = chatTurns[phase];
  if (!turn) return undefined;
  // From the second pass on, the thread says which round of the haggling it is.
  const label = exchange > 1 && (phase === "counteroffer" || phase === "improved_offer")
    ? `${turn.label} · ronda ${exchange}`
    : turn.label;
  const data = record(payload);
  const facts: TenderChatMessage["facts"] = [];
  const items = Array.isArray(data.items) ? data.items : [];
  const lines = Array.isArray(data.lines) ? data.lines : [];
  const unavailable = Array.isArray(data.unavailableItems) ? data.unavailableItems : [];
  const delivery = dayMonth(data.deliveryDate);
  if (phase === "rfq") {
    if (items.length) facts.push({ label: "Productos solicitados", value: String(items.length) });
    const requiredBy = dayMonth(data.requiredBy);
    if (requiredBy) facts.push({ label: "Necesario para", value: requiredBy });
  } else {
    facts.push({ label: "Productos cotizados", value: requestedProducts > 0 ? `${lines.length} de ${requestedProducts}` : String(lines.length) });
    if (unavailable.length) facts.push({ label: "Sin stock", value: String(unavailable.length) });
    if (lines.length) facts.push({ label: "Total", value: formatArs(String(data.total ?? "0")) });
    if (lines.length && delivery) facts.push({ label: "Entrega", value: delivery });
  }
  if (typeof data.paymentTerms === "string" && data.paymentTerms) facts.push({ label: "Condiciones", value: data.paymentTerms });
  return { role: turn.role, label, notes: typeof data.notes === "string" && data.notes ? data.notes : null, facts };
}

export type ProgressMessage = { id: string; supplierId: string; messageType: string; timestamp: string; payload: unknown; tenderRoundId: string | null };
/** Each pass adds a step; the branch fills up as its own negotiation advances. */
function exchangeProgress(phase: TenderPhase, exchange: number) {
  if (phase === "rfq") return 15;
  if (phase === "initial_offer") return 40;
  if (phase === "final_offer") return 100;
  const reached = 40 + exchange * 15;
  return Math.min(90, phase === "counteroffer" ? reached - 5 : reached);
}

export function messageProgress(requestId: string, messages: ProgressMessage[], requestedProducts: number): TenderProgressEvent[] {
  const history = new Map<string, { initial: PublicOffer | null; previous: PublicOffer | null; target: PublicOffer | null; exchange: number }>();
  const phases: Record<string, TenderPhase> = { request_for_quote: "rfq", offer: "initial_offer", counteroffer: "counteroffer", final_offer: "final_offer", payment_status: "payment" };
  const seen = new Set<string>();
  return messages.flatMap((message) => {
    if (seen.has(message.id) || !phases[message.messageType]) return [];
    seen.add(message.id);
    const prior = history.get(message.supplierId) ?? { initial: null, previous: null, target: null, exchange: 0 };
    // A distributor answers as many times as it is willing to haggle: the first
    // answer is its opening offer, the following ones are improvements.
    if (message.messageType === "counteroffer") prior.exchange += 1;
    const phase = message.messageType === "offer" && prior.initial ? "improved_offer" : phases[message.messageType];
    const event: TenderProgressEvent = {
      id: message.id, messageId: message.id, requestId, tenderRoundId: message.tenderRoundId,
      supplierId: message.supplierId, timestamp: message.timestamp, phase, sequence: seen.size,
      direction: ["initial_offer", "improved_offer", "final_offer"].includes(phase) ? "inbound" : "outbound",
      ...(prior.exchange > 0 ? { exchange: prior.exchange } : {}),
      ...(phase === "payment" ? {} : { progress: exchangeProgress(phase, prior.exchange) }),
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
    if (["initial_offer", "improved_offer", "counteroffer", "final_offer"].includes(phase)) {
      const offer = publicOffer(message.payload, requestedProducts);
      event.metrics = offerMetrics(offer, prior.initial, prior.previous, phase === "counteroffer" ? null : prior.target, phase === "counteroffer");
      if (phase === "initial_offer") prior.initial = offer;
      if (phase === "counteroffer") prior.target = offer;
      prior.previous = offer;
    }
    const chat = chatMessage(phase, message.payload, requestedProducts, prior.exchange);
    if (chat) event.chat = chat;
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
