import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ launch: vi.fn(), after: vi.fn(), snapshot: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mock.after }));
vi.mock("@/modules/protocol/services/purchase-flow", () => ({ launchPurchaseFlow: mock.launch }));
vi.mock("@/modules/protocol/services/tender-snapshot", () => ({ getTenderSnapshot: mock.snapshot }));
import { POST } from "@/app/api/purchase-flow/route";
import { GET } from "@/app/api/purchase-flow/[requestId]/route";
import type { TenderProgressEvent } from "@/modules/protocol/domain/purchase-flow";

const buyer = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000201";
const operationId = "00000000-0000-4000-8000-000000000202";
const body = { kind: "retry", requestId, operationId, buyerCompanyId: buyer };
const event: TenderProgressEvent = { id: "persisted-id", sequence: 1, requestId, tenderRoundId: null, phase: "creation", timestamp: "2026-09-12T10:00:00.000Z" };
const request = (headers: Record<string, string> = {}, data: unknown = body) => new Request("http://localhost:3001/api/purchase-flow", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3001", ...headers }, body: JSON.stringify(data) });

describe("internal purchase-flow endpoint", () => {
  beforeEach(() => { vi.clearAllMocks(); mock.launch.mockImplementation(async (_input, emit) => { emit(event); }); });
  it("rejects cross-origin, malformed origins and invalid JSON contracts", async () => {
    expect((await POST(request({ Origin: "https://other.example" }))).status).toBe(403);
    expect((await POST(request({ Origin: "null" }))).status).toBe(403);
    expect((await POST(request({ "Content-Type": "text/plain" }))).status).toBe(403);
    expect((await POST(request({}, {}))).status).toBe(400);
    expect(mock.launch).not.toHaveBeenCalled();
  });
  it("accepts the actual Host when Next internally normalizes the request URL", async () => {
    const response = await POST(request({ Host: "127.0.0.1:3001", Origin: "http://127.0.0.1:3001" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(await response.text()).toBe(`${JSON.stringify(event)}\n`);
    expect(mock.after).toHaveBeenCalledOnce();
  });
  it("enforces the fixed demo buyer", async () => {
    expect((await POST(request({}, { ...body, buyerCompanyId: "00000000-0000-4000-8000-000000000101" }))).status).toBe(403);
    expect(mock.launch).not.toHaveBeenCalled();
  });
  it("does not cancel authorized work when the reader disconnects", async () => {
    let finish!: () => void;
    mock.launch.mockImplementation((_input, emit) => new Promise<void>((resolve) => { finish = () => { emit(event); resolve(); }; }));
    const response = await POST(request());
    await response.body!.cancel();
    finish();
    await expect(mock.after.mock.calls[0][0]()).resolves.toBeUndefined();
    expect(mock.launch).toHaveBeenCalledOnce();
  });
  it("reports transport failures without fabricating a persisted progress event", async () => {
    mock.launch.mockRejectedValue(new Error("connection failed"));
    const response = await POST(request());
    const result = JSON.parse((await response.text()).trim());
    expect(result.type).toBe("transport_error");
    expect(result).not.toHaveProperty("phase");
    expect(result).not.toHaveProperty("sequence");
  });
  it("scopes recovery to the demo buyer and returns uncached snapshots", async () => {
    mock.snapshot.mockResolvedValue({ requestId, events: [event] });
    const response = await GET(new Request(`http://localhost/api/purchase-flow/${requestId}`), { params: Promise.resolve({ requestId }) });
    expect(mock.snapshot).toHaveBeenCalledWith(requestId, buyer);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.json()).events).toEqual([event]);
  });
});
