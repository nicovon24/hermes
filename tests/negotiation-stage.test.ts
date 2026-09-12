import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NegotiationStage } from "@/components/negotiation-stage";
import type { TenderProgressEvent, TenderSummary } from "@/modules/protocol/domain/purchase-flow";

const summary: TenderSummary = { orderCount: 1, total: "100.00", saving: { amount: "0.00", percentage: 0, comparable: true }, requestedProducts: 1, coveredProducts: 1, pendingProducts: 0, orders: [] };
const props = { requestId: "request", events: [] as TenderProgressEvent[], pending: false, streaming: false, slow: false, error: null, recovering: false, animateEntrance: false, onOrders: vi.fn(), onRetry: vi.fn(), onDismiss: vi.fn() };
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
    expect(html).not.toContain("Ver conversaciones");
    expect(html).not.toContain("Actualizar estado");
  });
  it("offers the order action only inside the winning card, never in the footer", () => {
    const award = { id: "award", requestId: "request", tenderRoundId: "round", sequence: 1, phase: "award", timestamp: "2026-09-12T10:00:00.000Z", recommendation: { supplierNames: ["Mayorista Andino"], total: "100.00", coveredProducts: 1, pendingProducts: 0 } } as TenderProgressEvent;
    const metrics = { id: "final", requestId: "request", tenderRoundId: "round", sequence: 2, phase: "final_offer", supplierId: "00000000-0000-4000-8000-000000000102", timestamp: "2026-09-12T10:00:01.000Z", direction: "inbound", metrics: { offer: { total: "100.00", deliveryDate: "2026-09-17", coveredProducts: 1, requestedProducts: 1, lines: [] }, saving: null, previousChange: null, targetGap: null, coverageChange: 0, deliveryDaysEarlier: null, proposed: false } } as TenderProgressEvent;
    const html = renderToStaticMarkup(createElement(NegotiationStage, { ...props, buyerCompanyId: "buyer", onApprove: vi.fn(), events: [metrics, award] }));
    expect(html.match(/Generar pedido/g)).toHaveLength(1);
    expect(html).toMatch(/winner-supplier[\s\S]*winner-cta[\s\S]*Generar pedido/);
    expect(html).not.toMatch(/stage-actions[\s\S]*Generar pedido/);
  });
  it("turns the awarded distributor's branch green once a recommendation names it", () => {
    const award = { id: "award", requestId: "request", tenderRoundId: "round", sequence: 1, phase: "award", timestamp: "2026-09-12T10:00:00.000Z", recommendation: { supplierNames: ["Mayorista Andino"], total: "100.00", coveredProducts: 1, pendingProducts: 0 } } as TenderProgressEvent;
    const html = renderToStaticMarkup(createElement(NegotiationStage, { ...props, events: [award] }));
    expect(html.match(/is-winner/g)).toHaveLength(1);
    expect(html).toContain('class="network-branch supplier-amber is-winner"');
    expect(html).not.toContain("winner-check");
    expect(renderToStaticMarkup(createElement(NegotiationStage, props))).not.toContain("is-winner");
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
    // Resetting the transform here would drop the attribute that positions these marks.
    expect(media).toContain(".payment-confirmed-check, .route-cut, .route-cut > line { opacity: 1; }");
    expect(media).not.toContain(".payment-confirmed-check { opacity: 1; transform: none; }");
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
    expect(processing).toContain("Pagando en ARGt");
    const autoPaying = renderToStaticMarkup(createElement(NegotiationStage, { ...props, automaticPayments: true, streaming: true, events: [result(summary)[0]] }));
    expect(autoPaying).toContain("Pagando en ARGt");
    expect(autoPaying).toContain('<dialog class="payment-receipt-modal"');
    expect(renderToStaticMarkup(createElement(NegotiationStage, { ...props, automaticPayments: true, events: result(summary) }))).not.toContain("Pagando en ARGt");

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
    expect(confirmed).toContain("Pago confirmado");
    expect(confirmed).toContain("Ver mis pedidos");
    expect(confirmed).not.toContain("payment-complete-mark");
    expect(confirmed).not.toContain("Pagando en ARGt");
    expect(confirmed).toContain("La transferencia a Distribuidora Norte quedó confirmada");
    expect(confirmed).toContain('class="payment-confirmed-route"');
    expect(confirmed).toContain('class="payment-confirmed-check"');
  });
  it("calls an empty offer sin stock and paints only that distributor red", () => {
    const offer = (supplierId: string, coveredProducts: number, total: string): TenderProgressEvent => ({
      id: `final:${supplierId}`, requestId: "request", tenderRoundId: "round", sequence: 1, phase: "final_offer",
      supplierId, timestamp: "2026-09-12T10:00:01.000Z", direction: "inbound",
      metrics: {
        offer: { total, deliveryDate: coveredProducts ? "2026-09-17" : null, coveredProducts, requestedProducts: 2, lines: [] },
        saving: null, previousChange: null, targetGap: null, coverageChange: 0, deliveryDaysEarlier: null, proposed: false,
      },
    });
    const html = renderToStaticMarkup(createElement(NegotiationStage, {
      ...props,
      events: [offer("00000000-0000-4000-8000-000000000101", 0, "0.00"), offer("00000000-0000-4000-8000-000000000102", 2, "100.00")],
    }));
    expect(html).toContain("Sin stock");
    expect(html).not.toContain("Sin cobertura");
    expect(html.match(/stage-supplier[^"]*is-out-of-stock/g)).toHaveLength(1);
    expect(html.match(/no-stock-headline/g)).toHaveLength(1);
    expect(html).toMatch(/is-out-of-stock[\s\S]*?no-stock-headline[\s\S]*?Sin stock/);
    const css = readFileSync(new URL("../src/app/hermes.css", import.meta.url), "utf8");
    expect(css).toContain(".no-stock-headline { margin: 2px 0 0; color: var(--danger)");
    expect(css).toContain(".stage-supplier.is-out-of-stock .supplier-phase { color: color-mix(in srgb, var(--danger) 65%, var(--faint)); }");
  });
  it("cuts the branch of a distributor without stock and leaves no award check", () => {
    const offer = (supplierId: string, coveredProducts: number, total: string): TenderProgressEvent => ({
      id: `final:${supplierId}`, requestId: "request", tenderRoundId: "round", sequence: 1, phase: "final_offer",
      supplierId, timestamp: "2026-09-12T10:00:01.000Z", direction: "inbound",
      metrics: {
        offer: { total, deliveryDate: coveredProducts ? "2026-09-17" : null, coveredProducts, requestedProducts: 2, lines: [] },
        saving: null, previousChange: null, targetGap: null, coverageChange: 0, deliveryDaysEarlier: null, proposed: false,
      },
    });
    const html = renderToStaticMarkup(createElement(NegotiationStage, {
      ...props,
      events: [offer("00000000-0000-4000-8000-000000000101", 0, "0.00"), offer("00000000-0000-4000-8000-000000000102", 2, "100.00")],
    }));
    expect(html.match(/network-branch[^"]*is-out-of-stock/g)).toHaveLength(1);
    expect(html.match(/class="route-cut"/g)).toHaveLength(1);
    // The severed branch never reaches its terminal: two suppliers keep the connector, the third does not.
    expect(html.match(/<line x1="718"/g)).toHaveLength(2);
    expect(html).toContain("Distribuidora Norte y quedaron sin stock".replace(" y quedaron", " quedó"));
    expect(html).not.toContain("winner-check");
    const css = readFileSync(new URL("../src/app/hermes.css", import.meta.url), "utf8");
    expect(css).toContain(".network-branch.is-out-of-stock { --supplier: var(--danger); }");
  });
  it("opens the agent-to-agent chat from every distributor that already spoke", () => {
    const turn = (id: string, supplierId: string, phase: "rfq" | "final_offer"): TenderProgressEvent => ({
      id, requestId: "request", tenderRoundId: "round", sequence: 1, phase,
      supplierId, timestamp: "2026-09-12T10:00:01.000Z",
      chat: {
        role: phase === "rfq" ? "buyer" : "supplier",
        label: phase === "rfq" ? "Licitación enviada" : "Oferta final",
        notes: phase === "rfq" ? "Cotizar todas las líneas." : "Oferta final automática.",
        facts: [{ label: "Productos cotizados", value: "2 de 2" }],
      },
    });
    const supplierId = "00000000-0000-4000-8000-000000000101";
    const html = renderToStaticMarkup(createElement(NegotiationStage, {
      ...props,
      events: [turn("rfq", supplierId, "rfq"), turn("final", supplierId, "final_offer")],
    }));
    expect(html.match(/Ver chat de los agentes/g)).toHaveLength(1);
    expect(html).toContain("2 mensajes");
    expect(html).toContain("Agente comprador · Hermes");
    expect(html).toContain("Agente vendedor · Distribuidora Norte");
    expect(html).toContain("Oferta final automática.");
    expect(html).toContain("Productos cotizados");
    expect(renderToStaticMarkup(createElement(NegotiationStage, props))).not.toContain("Ver chat de los agentes");
  });
});
