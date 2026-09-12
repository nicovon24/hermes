import { describe, expect, it } from "vitest";
import { launchPurchaseFlowSchema, type TenderProgressEvent } from "@/modules/protocol/domain/purchase-flow";
import { messageProgress, mergeProgress, offerMetrics, priceChange, publicOffer, readProgressStream, type ProgressMessage } from "@/modules/protocol/domain/tender-progress";

const payload = (total: string, deliveryDate = "2026-09-17", lines = [{ requestItemId: "milk", quantity: "10", unit: "litro", total }]) => ({ total, deliveryDate, lines, privateSupplierContext: { cost: "50" } });
const offer = (total: string) => publicOffer(payload(total), 2);
const message = (id: string, messageType: string, total: string, supplierId = "north"): ProgressMessage => ({ id, messageType, supplierId, payload: payload(total), timestamp: `2026-09-12T10:00:0${id.replace(/\D/g, "") || "0"}.000Z`, tenderRoundId: "round" });

describe("public tender metrics", () => {
  it("calculates exact ARS savings and percentages without floating-point money", () => {
    expect(priceChange("100.20", "95.19")).toEqual({ amount: "5.01", percentage: 5, comparable: true });
    expect(priceChange("100", "105")).toEqual({ amount: "-5.00", percentage: -5, comparable: true });
  });
  it("keeps zero baselines and unchanged prices neutral", () => {
    expect(priceChange("0", "0")).toEqual({ amount: "0.00", percentage: null, comparable: true });
    expect(priceChange("0", "20").percentage).toBeNull();
    expect(priceChange("100", "100").amount).toBe("0.00");
  });
  it("never treats a smaller basket as a saving or mixes quantity units", () => {
    const initial = publicOffer(payload("200", undefined, [{ requestItemId: "a", quantity: "10", unit: "litro", total: "100" }, { requestItemId: "b", quantity: "20", unit: "kg", total: "100" }]), 2);
    const current = publicOffer(payload("100", undefined, [{ requestItemId: "a", quantity: "10", unit: "litro", total: "100" }]), 2);
    const result = offerMetrics(current, initial, initial, null, false);
    expect(result.saving).toEqual({ amount: "100.00", percentage: null, comparable: false });
    expect(result.coverageChange).toBe(-1);
    expect(result.offer.coveredProducts).toBe(1);
    expect(result).not.toHaveProperty("quantityPercentage");
    expect(offerMetrics({ ...current, lines: [{ ...current.lines[0], unit: "kg" }] }, current, current, null, false).saving?.comparable).toBe(false);
  });
  it("counts covered products and measures delivery independently", () => {
    const initial = offer("100");
    const earlier = publicOffer(payload("100", "2026-09-15"), 2);
    expect(offerMetrics(earlier, initial, initial, null, false).deliveryDaysEarlier).toBe(2);
    const empty = publicOffer({ total: "0", deliveryDate: "2026-09-15", lines: [] }, 2);
    expect(empty.deliveryDate).toBeNull();
    expect(offerMetrics(empty, initial, initial, null, false).deliveryDaysEarlier).toBeNull();
  });
  it("separates the proposed reduction from the final saving and target gap", () => {
    const events = messageProgress("request", [message("1", "offer", "100"), message("2", "counteroffer", "95"), message("3", "final_offer", "97")], 2);
    expect(events[0].metrics?.saving).toBeNull();
    expect(events[1].metrics).toMatchObject({ proposed: true, saving: { amount: "5.00", percentage: 5 } });
    expect(events[2].metrics).toMatchObject({ proposed: false, saving: { amount: "3.00", percentage: 3 }, targetGap: { amount: "-2.00" } });
    expect(events.map((event) => event.direction)).toEqual(["inbound", "outbound", "inbound"]);
  });
  it("does not expose private context in a public event", () => {
    expect(JSON.stringify(messageProgress("request", [message("1", "offer", "100")], 2))).not.toContain("privateSupplierContext");
  });
});

describe("progress replay", () => {
  const events = messageProgress("request", [message("1", "request_for_quote", "0"), message("2", "offer", "100"), message("3", "offer", "200", "south"), message("4", "counteroffer", "95"), message("5", "final_offer", "97")], 2);
  it("deduplicates by persisted message id and keeps each supplier's baseline", () => {
    expect(messageProgress("request", [message("1", "offer", "100"), message("1", "offer", "100")], 2)).toHaveLength(1);
    expect(events.at(-1)?.metrics?.saving?.amount).toBe("3.00");
    expect(mergeProgress(events.slice(0, 3), events).map((event) => event.id)).toEqual(events.map((event) => event.id));
  });
  it("reads NDJSON across every UTF-8 byte boundary and missing final newline", async () => {
    const input = events.map((event) => ({ ...event, message: "Cotización recibida · Córdoba" }));
    const bytes = new TextEncoder().encode(input.map((event) => JSON.stringify(event)).join("\n"));
    const received: TenderProgressEvent[] = [];
    await readProgressStream(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), (event) => received.push(event));
    expect(received).toEqual(input);
  });
  it("retains committed events when a stream is interrupted", async () => {
    const received: TenderProgressEvent[] = [];
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(`${JSON.stringify(events[0])}\n{`)); controller.close(); } });
    await expect(readProgressStream(body, (event) => received.push(event))).rejects.toThrow();
    expect(mergeProgress(received, events)).toEqual(events);
  });
  it("keeps transport errors separate from committed progress", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"type":"transport_error","message":"Sin conexión"}\n')); controller.close(); } });
    const received: TenderProgressEvent[] = [];
    await expect(readProgressStream(body, (event) => received.push(event))).rejects.toThrow("Sin conexión");
    expect(received).toHaveLength(0);
  });
});

it("requires an explicit discriminant and durable UUIDs for every launch", () => {
  expect(launchPurchaseFlowSchema.safeParse({ kind: "retry", requestId: "not-a-uuid" }).success).toBe(false);
  expect(launchPurchaseFlowSchema.safeParse({ kind: "retry", requestId: "00000000-0000-4000-8000-000000000201", operationId: "00000000-0000-4000-8000-000000000202", buyerCompanyId: "00000000-0000-4000-8000-000000000001" }).success).toBe(true);
});
