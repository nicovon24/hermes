import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";

vi.mock("server-only", () => ({}));

import type { PaymentGateway } from "@/modules/payments/gateway";
import {
  preflightPayments,
  type PaymentOrder,
} from "@/modules/payments/service";

const BUYER = "0x0000000000000000000000000000000000000001" as Address;
const SUPPLIER_A = "0x0000000000000000000000000000000000000002" as Address;
const SUPPLIER_B = "0x0000000000000000000000000000000000000003" as Address;
const BUYER_ID = "00000000-0000-4000-8000-000000000001";
const SUPPLIER_A_ID = "00000000-0000-4000-8000-000000000101";
const SUPPLIER_B_ID = "00000000-0000-4000-8000-000000000102";

class FakeGateway implements PaymentGateway {
  simulations: Array<{ from: Address; to: Address; amount: bigint }> = [];
  submissions: Array<{ to: Address; amount: bigint }> = [];

  constructor(
    private readonly account: Address = BUYER,
    private readonly balance = 1_000_000n * 10n ** 18n,
    private readonly failSimulationAt: number | null = null,
  ) {}

  accountAddress() { return this.account; }
  async balanceOf() { return this.balance; }
  async simulateTransfer(from: Address, to: Address, amount: bigint) {
    this.simulations.push({ from, to, amount });
    if (this.failSimulationAt === this.simulations.length - 1) {
      throw new Error("simulation reverted");
    }
  }
  async submitTransfer(to: Address, amount: bigint) {
    this.submissions.push({ to, amount });
    return `0x${"1".repeat(64)}` as Hash;
  }
  async waitForTransfer(): Promise<never> { throw new Error("not used by preflight"); }
}

function order(
  id: string,
  supplierCompanyId: string,
  externalReference: string,
  total: string,
): PaymentOrder {
  return {
    id,
    purchaseRequestId: "00000000-0000-4000-8000-000000000201",
    buyerCompanyId: BUYER_ID,
    supplierCompanyId,
    externalReference,
    total: new Prisma.Decimal(total),
    buyer: { legalName: "Comprador" },
    supplier: { legalName: "Proveedor" },
  };
}

const originalEnvironment = { ...process.env };

describe("automatic payment preflight", () => {
  beforeEach(() => {
    process.env.ARBITRUM_RPC_URL = "https://example.invalid";
    process.env.AGENT_PRIVATE_KEY = `0x${"1".repeat(64)}`;
    process.env.PAYMENT_WALLETS_JSON = JSON.stringify({
      [BUYER_ID]: BUYER,
      [SUPPLIER_A_ID]: SUPPLIER_A,
      [SUPPLIER_B_ID]: SUPPLIER_B,
    });
    process.env.MAX_PAYMENT_BASE_UNITS = (100_000n * 10n ** 18n).toString();
    process.env.REQUIRED_CONFIRMATIONS = "1";
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it("validates the whole batch and simulates every transfer before submission", async () => {
    const gateway = new FakeGateway();
    const result = await preflightPayments([
      order("order-a", SUPPLIER_A_ID, "PO-A", "100.25"),
      order("order-b", SUPPLIER_B_ID, "PO-B", "200.50"),
    ], gateway);

    expect(result.map(({ amount }) => amount)).toEqual([
      100_250_000_000_000_000_000n,
      200_500_000_000_000_000_000n,
    ]);
    expect(gateway.simulations).toHaveLength(2);
    expect(gateway.submissions).toHaveLength(0);
  });

  it("rejects an invalid wallet without attempting a transfer", async () => {
    process.env.PAYMENT_WALLETS_JSON = JSON.stringify({
      [BUYER_ID]: BUYER,
      [SUPPLIER_A_ID]: "not-a-wallet",
    });
    const gateway = new FakeGateway();
    await expect(preflightPayments([
      order("order-a", SUPPLIER_A_ID, "PO-A", "100.00"),
    ], gateway)).rejects.toThrow("Invalid payment wallet");
    expect(gateway.simulations).toHaveLength(0);
    expect(gateway.submissions).toHaveLength(0);
  });

  it("rejects a buyer-key mismatch before checking balance", async () => {
    const gateway = new FakeGateway(SUPPLIER_A);
    await expect(preflightPayments([
      order("order-a", SUPPLIER_A_ID, "PO-A", "100.00"),
    ], gateway)).rejects.toThrow("does not match");
    expect(gateway.simulations).toHaveLength(0);
  });

  it("rejects insufficient aggregate balance and the per-payment limit", async () => {
    const lowBalance = new FakeGateway(BUYER, 299n * 10n ** 18n);
    await expect(preflightPayments([
      order("order-a", SUPPLIER_A_ID, "PO-A", "100.00"),
      order("order-b", SUPPLIER_B_ID, "PO-B", "200.00"),
    ], lowBalance)).rejects.toThrow("Insufficient aggregate ARGt balance");
    expect(lowBalance.simulations).toHaveLength(0);

    process.env.MAX_PAYMENT_BASE_UNITS = (99n * 10n ** 18n).toString();
    const overLimit = new FakeGateway();
    await expect(preflightPayments([
      order("order-a", SUPPLIER_A_ID, "PO-A", "100.00"),
    ], overLimit)).rejects.toThrow("Payment limit exceeded");
    expect(overLimit.simulations).toHaveLength(0);
  });

  it("stops on a reverted simulation without submitting anything", async () => {
    const gateway = new FakeGateway(BUYER, 1_000_000n * 10n ** 18n, 1);
    await expect(preflightPayments([
      order("order-a", SUPPLIER_A_ID, "PO-A", "100.00"),
      order("order-b", SUPPLIER_B_ID, "PO-B", "200.00"),
    ], gateway)).rejects.toThrow("simulation reverted");
    expect(gateway.simulations).toHaveLength(2);
    expect(gateway.submissions).toHaveLength(0);
  });
});
