import { describe, expect, it } from "vitest";

import {
  argtBaseUnitsToDisplay,
  arsToDemoArgtBaseUnits,
  arsToArgtBaseUnits,
  paymentAgentId,
  paymentEventHash,
  runSequentially,
} from "../src/modules/payments/domain";
import { protocolMessageSchema } from "../src/modules/protocol/domain/message";

describe("ARGt payment domain", () => {
  it("converts ARS to 18-decimal ARGt base units without floating point", () => {
    expect(arsToArgtBaseUnits("1.00")).toBe(1_000_000_000_000_000_000n);
    expect(arsToArgtBaseUnits("1234567890123456.78")).toBe(
      1_234_567_890_123_456_780_000_000_000_000_000n,
    );
    expect(argtBaseUnitsToDisplay("1230000000000000000")).toBe("1.23");
  });

  it("scales commercial ARS totals down for proof-of-concept transfers", () => {
    const amount = arsToDemoArgtBaseUnits("22738.00");
    expect(amount).toBe(22_738_000_000_000_000_000n);
    expect(argtBaseUnitsToDisplay(amount.toString())).toBe("22.738");
  });

  it("rejects amounts that cannot be represented as ARS cents", () => {
    expect(() => arsToArgtBaseUnits("1.001")).toThrow();
    expect(() => arsToArgtBaseUnits("1e3")).toThrow();
    expect(() => arsToArgtBaseUnits("-1.00")).toThrow();
  });

  it("builds deterministic company agents and chained event hashes", () => {
    expect(paymentAgentId("company-uuid")).toBe("company:company-uuid");
    const first = paymentEventHash("p1", "PAYMENT_REQUESTED", {}, null);
    expect(first).toHaveLength(64);
    expect(paymentEventHash("p1", "PAYMENT_AUTHORIZED", {}, first)).not.toBe(first);
  });

  it("accepts legacy CUID/text payment ids in protocol payment_status", () => {
    const result = protocolMessageSchema.safeParse({
      messageId: "00000000-0000-4000-8000-000000000001",
      protocolVersion: "1.0",
      type: "payment_status",
      senderCompanyId: "00000000-0000-4000-8000-000000000001",
      recipientCompanyId: "00000000-0000-4000-8000-000000000101",
      purchaseRequestId: "00000000-0000-4000-8000-000000000201",
      negotiationId: "00000000-0000-4000-8000-000000000301",
      correlationId: null,
      sentAt: new Date().toISOString(),
      expiresAt: null,
      idempotencyKey: "payment-status-test",
      payload: {
        paymentId: "cm-payment-cuid",
        status: "CONFIRMED",
        transactionReference: "0xabc",
      },
    });
    expect(result.success).toBe(true);
  });

  it("executes transfers in order and stops after the second one fails", async () => {
    const called: number[] = [];
    const result = await runSequentially([1, 2, 3], async (item) => {
      called.push(item);
      if (item === 2) throw new Error("second transfer reverted");
    });
    expect(called).toEqual([1, 2]);
    expect(result.completed).toBe(1);
    expect(result.failedIndex).toBe(1);
  });

  it("waits for each transfer before starting the next", async () => {
    const trace: string[] = [];
    const result = await runSequentially(["a", "b", "c"], async (item) => {
      trace.push(`start:${item}`);
      await Promise.resolve();
      trace.push(`confirmed:${item}`);
    });
    expect(trace).toEqual(["start:a", "confirmed:a", "start:b", "confirmed:b", "start:c", "confirmed:c"]);
    expect(result.completed).toBe(3);
  });
});
