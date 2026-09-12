import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";
import type { PaymentGateway } from "@/modules/payments/gateway";
import type { LaunchPurchaseFlowInput, TenderProgressEvent } from "@/modules/protocol/domain/purchase-flow";

// Explicitly opt in. Never connect this mutation suite to the workspace database.
const probe = vi.hoisted(() => {
  const url = process.env.HERMES_INTEGRATION_DATABASE_URL;
  if (url && (!url.startsWith("postgresql://hermes_test@127.0.0.1:") || !url.endsWith("/postgres"))) throw new Error("Integration tests require the isolated hermes_test localhost database");
  process.env.DATABASE_URL = url ?? "postgresql://disabled@127.0.0.1:1/disabled";
  return { enabled: !!url, failure: null as string | null, active: 0, peak: 0, starts: [] as Array<{ supplier: string; type: string }>, gateway: null as unknown };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/modules/protocol/services/negotiations", async (original) => {
  const actual = await original<typeof import("@/modules/protocol/services/negotiations")>();
  return { ...actual, appendProtocolMessage: async (...args: Parameters<typeof actual.appendProtocolMessage>) => {
    const [actor, message] = args;
    const supplier = actor.role === "SUPPLIER" ? actor.companyId : message.recipientCompanyId;
    probe.starts.push({ supplier, type: message.type }); probe.active++; probe.peak = Math.max(probe.peak, probe.active);
    try {
      if (probe.failure === supplier && message.type === "final_offer") throw new Error("Injected supplier failure");
      return await actual.appendProtocolMessage(...args);
    } finally { probe.active--; }
  } };
});
vi.mock("@/modules/payments/service", async (original) => {
  const actual = await original<typeof import("@/modules/payments/service")>();
  return { ...actual, runAutomaticPaymentsForPurchaseRequest: (actor: Parameters<typeof actual.runAutomaticPaymentsForPurchaseRequest>[0], id: string, _gateway?: PaymentGateway, observer?: () => Promise<void>) => actual.runAutomaticPaymentsForPurchaseRequest(actor, id, probe.gateway as PaymentGateway, observer) };
});

import { prisma } from "@/lib/prisma";
import { launchPurchaseFlow } from "@/modules/protocol/services/purchase-flow";
import { getTenderSnapshot } from "@/modules/protocol/services/tender-snapshot";
import { createPurchaseRequest } from "@/modules/protocol/services/purchase-requests";
import { requireBuyerActor } from "@/lib/demo-workspace";
import { suppliers } from "@/modules/protocol/domain/purchase-flow";

const buyer = "00000000-0000-4000-8000-000000000001";
const buyerWallet = "0x0000000000000000000000000000000000000001" as Address;
class FakeGateway implements PaymentGateway {
  submissions = 0;
  failAt = 0;
  gate: Promise<void> = Promise.resolve();
  accountAddress() { return buyerWallet; }
  async balanceOf() { return 10n ** 30n; }
  async simulateTransfer() {}
  async submitTransfer() {
    this.submissions++;
    if (this.submissions === this.failAt) throw new Error("Injected transfer failure");
    return `0x${randomUUID().replaceAll("-", "").padEnd(64, "0")}` as Hash;
  }
  async waitForTransfer(hash: Hash) { await this.gate; return { hash, gasUsedWei: "1", effectiveGasPriceWei: "1", gasFeeWei: "1", gasFeeEth: "0.000000000000000001" }; }
}

function input(): Extract<LaunchPurchaseFlowInput, { kind: "new" }> {
  const expiry = new Date(Date.now() + 2 * 86_400_000).toISOString();
  return { kind: "new", buyerCompanyId: buyer, requestId: randomUUID(), operationId: randomUUID(), conditions: { maximumTotalIncludingFees: "159100.00", paymentTerms: "CONTADO", settlementAsset: "ARS", autoPay: false, mandateExpiresAt: expiry }, request: {
    requiredBy: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10), expiresAt: expiry,
    items: [{ productId: "LECHE-1000", description: "Leche larga vida 1 L", unit: "unidad", minimumQuantity: "32", targetQuantity: "40", maximumQuantity: "50" }, { productId: "FIDEOS-500", description: "Fideos secos 500 g", unit: "unidad", minimumQuantity: "14", targetQuantity: "18", maximumQuantity: "23" }, { productId: "HARINA-1000", description: "Harina 000 1 kg", unit: "unidad", minimumQuantity: "19", targetQuantity: "24", maximumQuantity: "30" }],
  } };
}

describe.skipIf(!probe.enabled)("purchase flow · isolated Postgres", () => {
  beforeEach(() => {
    probe.active = 0; probe.peak = 0; probe.starts = []; probe.failure = null; probe.gateway = new FakeGateway();
    process.env.ARBITRUM_RPC_URL = "https://example.invalid";
    process.env.AGENT_PRIVATE_KEY = `0x${"1".repeat(64)}`;
    process.env.MAX_PAYMENT_BASE_UNITS = (10n ** 30n).toString();
    process.env.PAYMENT_WALLETS_JSON = JSON.stringify({ [buyer]: buyerWallet, ...Object.fromEntries(suppliers.map((supplier, index) => [supplier.id, `0x${String(index + 2).padStart(40, "0")}`])) });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("runs suppliers in parallel, keeps each serial, and only publishes committed messages", async () => {
    const request = input(); const events: TenderProgressEvent[] = []; const checks: Promise<unknown>[] = [];
    const result = await launchPurchaseFlow(request, (event) => {
      events.push(event);
      if (event.messageId) checks.push(prisma.negotiationMessage.findUnique({ where: { id: event.messageId } }).then((row) => expect(row).not.toBeNull()));
      if (event.phase === "orders") checks.push(prisma.purchaseOrder.count({ where: { purchaseRequestId: request.requestId } }).then((count) => expect(count).toBe(event.summary?.orderCount)));
    });
    await Promise.all(checks);
    expect(result.events.filter((event) => event.phase === "error")).toHaveLength(0);
    expect(result.summary).toMatchObject({ orderCount: 3, coveredProducts: 3, pendingProducts: 0 });
    expect(probe.peak).toBe(3);
    for (const supplier of suppliers) expect(probe.starts.filter((call) => call.supplier === supplier.id).map((call) => call.type)).toEqual(["request_for_quote", "offer", "counteroffer", "final_offer"]);
    const award = events.findIndex((event) => event.phase === "award");
    expect(events.slice(0, award).filter((event) => event.phase === "final_offer")).toHaveLength(3);
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, i) => i + 1));
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
    expect((await getTenderSnapshot(request.requestId, buyer)).summary).toEqual(result.summary);
    expect((probe.gateway as FakeGateway).submissions).toBe(0);
  });

  it("does not create two requests or rounds on concurrent duplicate submissions", async () => {
    const request = input();
    await Promise.all([launchPurchaseFlow(request), launchPurchaseFlow(request)]);
    expect(await prisma.purchaseRequest.count({ where: { id: request.requestId } })).toBe(1);
    expect(await prisma.tenderRound.count({ where: { purchaseRequestId: request.requestId } })).toBe(1);
    expect(await prisma.purchaseOrder.count({ where: { purchaseRequestId: request.requestId } })).toBe(3);
  });

  it("approves an existing request through the same orchestrator without creating another", async () => {
    const request = input();
    await createPurchaseRequest(await requireBuyerActor(buyer), { ...request.request, buyerCompanyId: buyer, currency: "ARS" }, request.requestId);
    const result = await launchPurchaseFlow({ kind: "approve", requestId: request.requestId, operationId: request.operationId, buyerCompanyId: buyer, conditions: request.conditions });
    expect(result.summary.orderCount).toBe(3);
    expect(await prisma.purchaseRequest.count({ where: { id: request.requestId } })).toBe(1);
    expect(await prisma.mandate.count({ where: { purchaseRequestId: request.requestId } })).toBe(1);
  });

  it("keeps two final offers after one supplier fails and resumes without duplicating messages", async () => {
    const request = input(); probe.failure = suppliers[1].id;
    const failed = await launchPurchaseFlow(request);
    expect(failed.summary.orderCount).toBe(0);
    expect(failed.events.filter((event) => event.phase === "final_offer")).toHaveLength(2);
    expect(failed.events.some((event) => event.phase === "error" && event.supplierId === suppliers[1].id)).toBe(true);
    const initialIds = failed.events.filter((event) => event.messageId).map((event) => event.id);
    probe.failure = null;
    const retried = await launchPurchaseFlow({ kind: "retry", buyerCompanyId: buyer, requestId: request.requestId, operationId: randomUUID() });
    expect(retried.summary.orderCount).toBe(3);
    expect(retried.tenderRoundId).toBe(failed.tenderRoundId);
    expect(retried.events.filter((event) => event.messageId)).toHaveLength(12);
    expect(retried.events.map((event) => event.id)).toEqual(expect.arrayContaining(initialIds));
    expect(retried.events.filter((event) => event.phase === "error")).toHaveLength(0);
  });

  it("creates a partial award and retries only the uncovered products in a new round", async () => {
    const request = input(); request.request.items[2] = { ...request.request.items[2], minimumQuantity: "9999", targetQuantity: "9999", maximumQuantity: "9999" };
    const result = await launchPurchaseFlow(request);
    expect(result.summary).toMatchObject({ coveredProducts: 2, pendingProducts: 1, requestedProducts: 3 });
    const count = result.summary.orderCount;
    const retry = await launchPurchaseFlow({ kind: "retry", buyerCompanyId: buyer, requestId: request.requestId, operationId: randomUUID() });
    expect(retry.tenderRoundId).not.toBe(result.tenderRoundId);
    expect(retry.summary).toMatchObject({ requestedProducts: 1, pendingProducts: 1, coveredProducts: 0 });
    expect(await prisma.purchaseOrder.count({ where: { purchaseRequestId: request.requestId } })).toBe(count);
  });

  it("finishes committed business work when a disconnected observer throws", async () => {
    const request = input(); const result = await launchPurchaseFlow(request, () => { throw new Error("Disconnected browser"); });
    expect(result.summary.orderCount).toBe(3);
    const recovered = await getTenderSnapshot(request.requestId, buyer);
    expect(recovered.running).toBe(false);
    expect(recovered.summary).toEqual(result.summary);
  });

  it("publishes orders before payment confirmations and reconstructs pending payments", async () => {
    const request = input(); request.conditions.autoPay = true; request.conditions.settlementAsset = "ARGt";
    const gateway = probe.gateway as FakeGateway;
    let release!: () => void;
    gateway.gate = new Promise<void>((resolve) => { release = resolve; });
    const events: TenderProgressEvent[] = []; let finished = false;
    const work = launchPurchaseFlow(request, (event) => events.push(event)).then((result) => { finished = true; return result; });
    try {
      await vi.waitFor(() => expect(gateway.submissions).toBe(1), { timeout: 10_000, interval: 50 });
      expect(events.some((event) => event.phase === "orders" && event.summary?.orderCount === 3)).toBe(true);
      expect(finished).toBe(false);
      const pending = await getTenderSnapshot(request.requestId, buyer);
      expect(pending.running).toBe(true);
      expect(pending.events.some((event) => event.phase === "payment" && event.status === "SUBMITTED")).toBe(true);
    } finally { release(); }
    const result = await work;
    expect(result.status).toBe("PAYMENT_CONFIRMED");
    expect(result.summary.orders.every((order) => order.paymentStatus === "PAYMENT_CONFIRMED")).toBe(true);
  });

  it("identifies a failed payment supplier, preserves orders and stops subsequent transfers", async () => {
    const request = input(); request.conditions.autoPay = true; request.conditions.settlementAsset = "ARGt";
    const gateway = probe.gateway as FakeGateway; gateway.failAt = 2;
    const result = await launchPurchaseFlow(request);
    expect(result.status).toBe("PAYMENT_REVIEW_REQUIRED");
    expect(result.summary.orderCount).toBe(3);
    expect(gateway.submissions).toBe(2);
    const failedOrder = result.summary.orders.find((order) => order.paymentStatus === "PAYMENT_FAILED");
    expect(failedOrder).toBeDefined();
    expect(result.events.some((event) => event.phase === "payment" && event.status === "FAILED" && event.supplierId === failedOrder?.supplierId)).toBe(true);
    expect(result.events.find((event) => event.phase === "complete")?.status).toBe("FAILED");
  });
});
