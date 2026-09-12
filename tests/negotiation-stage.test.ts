import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NegotiationStage } from "@/components/negotiation-stage";
import type { TenderProgressEvent, TenderSummary } from "@/modules/protocol/domain/purchase-flow";

const summary: TenderSummary = { orderCount: 1, total: "100.00", saving: { amount: "0.00", percentage: 0, comparable: true }, requestedProducts: 1, coveredProducts: 1, pendingProducts: 0, orders: [] };
const props = { requestId: "request", events: [] as TenderProgressEvent[], pending: false, streaming: false, slow: false, error: null, recovering: false, animateEntrance: false, onReview: vi.fn(), onOrders: vi.fn(), onConversations: vi.fn(), onRetry: vi.fn(), onDismiss: vi.fn() };
const result = (data: TenderSummary) => [{ id: "order", requestId: "request", tenderRoundId: "round", sequence: 1, phase: "orders", timestamp: "2026-09-12T10:00:00.000Z", summary: data }, { id: "end", requestId: "request", tenderRoundId: "round", sequence: 2, phase: "complete", timestamp: "2026-09-12T10:00:01.000Z", summary: data }] as TenderProgressEvent[];

describe("negotiation stage semantics", () => {
  it("shows the brand entrance only for an explicit launch, not snapshot restoration", () => {
    expect(renderToStaticMarkup(createElement(NegotiationStage, props))).not.toContain('class="stage-intro"');
    expect(renderToStaticMarkup(createElement(NegotiationStage, { ...props, animateEntrance: true }))).toContain('class="stage-intro"');
  });
  it("keeps no improvement neutral and makes orders available independently of payment", () => {
    const html = renderToStaticMarkup(createElement(NegotiationStage, { ...props, streaming: true, events: result(summary) }));
    expect(html).toContain('class="">Sin reducción');
    expect(html).toContain("Ver mis pedidos");
    expect(html).toContain("Ver conversaciones");
  });
  it("hides empty totals and recovery actions if no result exists", () => {
    const html = renderToStaticMarkup(createElement(NegotiationStage, { ...props, events: result({ ...summary, total: "0", orderCount: 0, coveredProducts: 0, pendingProducts: 1, saving: null }) }));
    expect(html).not.toContain("Total adjudicado");
    expect(html).not.toContain("No comparable");
    expect(html).not.toContain("Revisar condiciones");
    expect(html).not.toContain("Reintentar pendientes");
  });
  it("retains three color identities and a keyboard-accessible provider region", () => {
    const html = renderToStaticMarkup(createElement(NegotiationStage, props));
    for (const color of ["cyan", "amber", "violet"]) expect(html).toContain(`supplier-${color}`);
    expect(html).toContain('aria-label="Condiciones por proveedor" tabindex="0"');
  });
  it("introduces the three animated dashed connection lines sequentially while the first durable event is pending", () => {
    const html = renderToStaticMarkup(createElement(NegotiationStage, { ...props, pending: true, streaming: true, animateEntrance: true }));
    expect(html).toContain("Conectando con 3 distribuidores");
    expect(html.match(/is-connecting/g)).toHaveLength(3);
    expect(html.match(/route-connecting/g)).toHaveLength(3);
    for (const delay of [650, 1100, 1550]) expect(html).toContain(`animation-delay:${delay}ms`);
    const css = readFileSync(new URL("../src/app/hermes.css", import.meta.url), "utf8");
    expect(css).toContain("stroke-dasharray: 16 10");
    expect(css).toContain("animation: route-loading-flow .9s linear infinite both");
    expect(css).not.toContain("connection-pulse");
  });
  it("disables animation and packets in the reduced-motion media query", () => {
    const css = readFileSync(new URL("../src/app/hermes.css", import.meta.url), "utf8");
    const media = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(media).toContain("animation: none !important");
    expect(media).toContain("transition: none !important");
    expect(media).toContain(".message-packet { display: none; }");
    expect(media).toContain(".payment-confirmed-route { stroke-dashoffset: 0; }");
  });
  it("shows payment processing and draws a green confirmed route to the paid supplier", () => {
    const processing = renderToStaticMarkup(createElement(NegotiationStage, {
      ...props,
      approving: true,
      approvalMode: "payment",
      buyerCompanyId: "buyer",
      onApprove: vi.fn(),
      events: result(summary),
    }));
    expect(processing).toContain("Procesando el pago…");

    const confirmedSummary: TenderSummary = {
      ...summary,
      orders: [{ id: "order", reference: "PO-1", supplierId: "00000000-0000-4000-8000-000000000101", total: "100.00", paymentStatus: "PAYMENT_CONFIRMED" }],
    };
    const payment: TenderProgressEvent = {
      id: "payment",
      requestId: "request",
      tenderRoundId: "round",
      sequence: 2,
      supplierId: "00000000-0000-4000-8000-000000000101",
      phase: "payment",
      timestamp: "2026-09-12T10:00:00.500Z",
      status: "CONFIRMED",
    };
    const confirmedEvents = [result(confirmedSummary)[0], payment, result(confirmedSummary)[1]];
    const confirmed = renderToStaticMarkup(createElement(NegotiationStage, { ...props, events: confirmedEvents }));
    expect(confirmed).toContain("Pago aprobado");
    expect(confirmed).toContain("La transferencia a Distribuidora Norte quedó confirmada");
    expect(confirmed).toContain('class="payment-confirmed-route"');
    expect(confirmed).toContain('class="payment-confirmed-check"');
  });
});
