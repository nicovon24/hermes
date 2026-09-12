import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  approve: vi.fn(),
  payments: vi.fn(),
  requireBuyerActor: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidatePath }));
vi.mock("@/lib/demo-workspace", () => ({
  getBuyerCompanyId: () => "00000000-0000-4000-8000-000000000001",
  requireBuyerActor: mock.requireBuyerActor,
}));
vi.mock("@/modules/payments/service", () => ({
  runAutomaticPaymentsForPurchaseRequest: mock.payments,
}));
vi.mock("@/modules/protocol/services/multi-product-tender", () => ({
  approveAvailableTenderRecommendation: mock.approve,
}));

import { POST } from "@/app/api/purchase-flow/[requestId]/approve/route";
import { DomainError } from "@/lib/domain/errors";

const requestId = "00000000-0000-4000-8000-000000000201";
const actor = {
  actorId: "buyer-agent",
  companyId: "00000000-0000-4000-8000-000000000001",
};
const request = (payNow: boolean) => new Request(
  `http://localhost:3001/api/purchase-flow/${requestId}/approve`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3001" },
    body: JSON.stringify({ payNow }),
  },
);
const post = (payNow: boolean) => POST(request(payNow), {
  params: Promise.resolve({ requestId }),
});

describe("purchase-flow recommendation approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.requireBuyerActor.mockResolvedValue(actor);
    mock.approve.mockResolvedValue({ orders: [{ id: "order-1" }] });
    mock.payments.mockResolvedValue({ attempted: 1, confirmed: 1, skipped: false, error: null });
  });

  it("confirms both the order and payment after the transfer settles", async () => {
    const response = await post(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      outcome: "payment_confirmed",
      orderCreated: true,
      orderCount: 1,
      message: "Pago aprobado. El pedido fue creado y el pago quedó confirmado.",
    });
    expect(mock.payments).toHaveBeenCalledWith(actor, requestId);
  });

  it("reports a created order and the exact payment error as a partial failure", async () => {
    mock.payments.mockResolvedValue({
      attempted: 1,
      confirmed: 0,
      skipped: false,
      error: "La transferencia fue rechazada",
    });
    const response = await post(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: false,
      outcome: "payment_failed",
      orderCreated: true,
      message: expect.stringContaining("La transferencia fue rechazada"),
    });
  });

  it("keeps a payment preflight error separate from order creation", async () => {
    mock.payments.mockRejectedValue(new DomainError("Saldo ARGt insuficiente", "CONFLICT", 409));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await post(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: false,
      outcome: "payment_failed",
      orderCreated: true,
      message: expect.stringContaining("Saldo ARGt insuficiente"),
    });
    consoleError.mockRestore();
  });

  it("reports an order-only approval without starting a payment", async () => {
    const response = await post(false);
    expect(await response.json()).toMatchObject({
      ok: true,
      outcome: "order_created",
      orderCreated: true,
      message: "El pedido fue creado correctamente. No se realizó ningún pago.",
    });
    expect(mock.payments).not.toHaveBeenCalled();
  });

  it("states clearly when the order itself was not created", async () => {
    mock.approve.mockRejectedValue(new DomainError("La recomendación venció.", "CONFLICT", 409));
    const response = await post(true);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      outcome: "order_failed",
      orderCreated: false,
      message: "No se pudo crear el pedido. La recomendación venció.",
    });
    expect(mock.payments).not.toHaveBeenCalled();
  });
});
