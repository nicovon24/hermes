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
  it("does not declare success if no orders could be created", () => {
    const html = renderToStaticMarkup(createElement(NegotiationStage, { ...props, events: result({ ...summary, total: "0", orderCount: 0, coveredProducts: 0, pendingProducts: 1, saving: null }) }));
    expect(html).toContain("Todavía hay productos por resolver.");
    expect(html).not.toContain("Tu próximo pedido, resuelto.");
    expect(html).toContain("Revisar condiciones");
  });
  it("retains three color identities and a keyboard-accessible provider region", () => {
    const html = renderToStaticMarkup(createElement(NegotiationStage, props));
    for (const color of ["cyan", "amber", "violet"]) expect(html).toContain(`supplier-${color}`);
    expect(html).toContain('aria-label="Condiciones por proveedor" tabindex="0"');
  });
  it("disables animation and packets in the reduced-motion media query", () => {
    const css = readFileSync(new URL("../src/app/hermes.css", import.meta.url), "utf8");
    const media = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(media).toContain("animation: none !important");
    expect(media).toContain("transition: none !important");
    expect(media).toContain(".message-packet { display: none; }");
  });
});
