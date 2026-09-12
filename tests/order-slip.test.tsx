import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OrderSlip } from "@/components/order-slip";
import { SupplierOrderBook } from "@/components/supplier-order-book";
import { changedOrderIds, collectionState, dispatchGroups, newOrderIds, owedTotal, productSummary, summarizeQuantity, type OrderSlipData } from "@/modules/protocol/domain/order-slip";

function order(overrides: Partial<OrderSlipData> = {}): OrderSlipData {
  return {
    id: "order-1",
    externalReference: "PO-12046864-000103",
    status: "CREATED",
    purchaseRequestId: "request-1",
    buyerCompanyId: "buyer",
    supplierCompanyId: "supplier",
    total: "22738.32",
    deliveryDate: "2026-09-17",
    paymentTerms: "CONTADO",
    createdAt: "2026-09-12T12:31:00.000Z",
    items: [{ id: "line-1", productId: "HARINA-1000", description: "Harina 000 1 kg", quantity: "30", unit: "unidad", unitPrice: "757.94", total: "22738.32" }],
    payment: null,
    ...overrides,
  };
}

describe("order slip", () => {
  it("renders the reference, the lines with their quantities and the ruled total", () => {
    const html = renderToStaticMarkup(<OrderSlip counterpartName="Almacén Punto Centro" order={order()} />);
    expect(html).toContain("PO-12046864-000103");
    expect(html).toContain("Harina 000 1 kg");
    expect(html).toContain("30 unidades");
    expect(html).toContain("17/09");
    expect(html).toContain("contado");
    expect(html).not.toContain("slip-payment");
  });

  it("shows the payment state and the arrival tag", () => {
    const html = renderToStaticMarkup(
      <OrderSlip
        counterpartName="Almacén Punto Centro"
        fresh
        order={order({ payment: { id: "pay-1", status: "PAYMENT_CONFIRMED", route: "ARBITRUM_DIRECT", amountBaseUnits: "22738320000", txHash: "0xabc", lastError: null } })}
      />,
    );
    expect(html).toContain("Pago confirmado");
    expect(html).toContain("tone-confirmed");
    expect(html).toContain("arbiscan.io/tx/0xabc");
    expect(html).toContain("Nuevo");
  });
});

describe("order book snapshots", () => {
  it("tells arrivals apart from payment changes", () => {
    const previous = [order({ id: "a" }), order({ id: "b" })];
    const next = [
      order({ id: "c" }),
      order({ id: "a", payment: { id: "pay", status: "PAYMENT_SUBMITTED", route: "ARBITRUM_DIRECT", amountBaseUnits: "1", txHash: null, lastError: null } }),
      order({ id: "b" }),
    ];
    expect(newOrderIds(previous, next)).toEqual(["c"]);
    expect(changedOrderIds(previous, next)).toEqual(["a"]);
  });
});

describe("dispatch sheet", () => {
  const line = (id: string, description: string, quantity: string, unit = "unidad") => ({ id, productId: id, description, quantity, unit, unitPrice: "100.00", total: "100.00" });
  const collected = { id: "pay", status: "PAYMENT_CONFIRMED", route: "ARBITRUM_DIRECT", amountBaseUnits: "1", txHash: "0xabc", lastError: null };

  it("files orders under the day they have to be delivered, soonest first", () => {
    const groups = dispatchGroups([
      order({ id: "late", deliveryDate: "2026-09-20", total: "10.00" }),
      order({ id: "soon-b", deliveryDate: "2026-09-17", total: "30.00", items: [line("l1", "Yerba mate 1 kg", "4")] }),
      order({ id: "soon-a", deliveryDate: "2026-09-17", total: "25.00", items: [line("l2", "Azúcar 1 kg", "6")], payment: collected }),
    ]);
    expect(groups.map((group) => group.date)).toEqual(["2026-09-17", "2026-09-20"]);
    // Equal products sit together: sorted by name, so the pick follows the sheet.
    expect(groups[0].orders.map((entry) => entry.id)).toEqual(["soon-a", "soon-b"]);
    expect(groups[0]).toMatchObject({ total: "55.00", pending: 1, quantity: { amount: 10, unit: "unidad" } });
    expect(owedTotal(groups[0].orders)).toBe("30.00");
  });

  it("counts lines instead of units when a basket mixes units", () => {
    expect(summarizeQuantity([line("a", "Harina", "10", "bolsa"), line("b", "Aceite", "4", "litro")])).toEqual({ amount: 2, unit: null });
    expect(productSummary([line("a", "Harina 000 1 kg", "10"), line("b", "Aceite", "4")])).toBe("Harina 000 1 kg y 1 más");
  });

  it("reads the payment as the money question it answers", () => {
    expect(collectionState(order())).toEqual({ label: "Por cobrar", tone: "pending" });
    expect(collectionState(order({ payment: collected }))).toEqual({ label: "Cobrado", tone: "confirmed" });
    expect(collectionState(order({ payment: { ...collected, status: "PAYMENT_SUBMITTED" } }))).toEqual({ label: "En camino", tone: "sent" });
    expect(collectionState(order({ payment: { ...collected, status: "PAYMENT_REVIEW_REQUIRED" } }))).toEqual({ label: "Revisar", tone: "failed" });
  });

  it("keeps the header to its title and the rows to what changes", () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const html = renderToStaticMarkup(
      <SupplierOrderBook
        buyerName="Almacén Punto Centro"
        colorClass="party-buyer"
        companyId="supplier"
        initialOrders={[
          order({ id: "a", deliveryDate: tomorrow, total: "1000.00", items: [line("l1", "Azúcar 1 kg", "32")] }),
          order({ id: "b", deliveryDate: tomorrow, total: "500.00", items: [line("l2", "Leche larga vida 1 L", "45")], payment: collected }),
        ]}
      />,
    );
    expect(html).toContain(">Pedidos</h2>");
    expect(html).not.toContain("Te deben");
    expect(html).toContain("Entrega mañana");
    expect(html).toContain("2 pedidos");
    expect(html).toContain("77 unidades");
    // Money keeps a non-breaking space after the sign, as formatArs writes it.
    expect(html).toContain("$\u00a01.500,00");
    expect(html).toContain("Sólo lo que falta cobrar");
    // The counterpart never varies between rows: it belongs to the order's detail, not the sheet.
    expect(html).not.toContain("Almacén Punto Centro");
    expect(html).toContain("tone-confirmed");
    expect(html).toContain("tone-pending");
    // The detail stays closed until asked for.
    expect(html).not.toContain("dispatch-detail");
  });
});
