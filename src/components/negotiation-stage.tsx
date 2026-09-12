"use client";

import { useEffect, useId, useRef } from "react";
import { centsToMoney, formatArs, moneyToCents } from "@/lib/decimal";
import { phaseLabels, phaseProgress, suppliers, type OfferChange, type TenderMetrics, type TenderProgressEvent } from "@/modules/protocol/domain/purchase-flow";
import { HermesMark } from "./hermes-mark";

const money = (value: string) => formatArs(value);
const percent = (value: number) => Math.abs(value).toLocaleString("es-AR", { maximumFractionDigits: 1 });

function ChangeBadge({ change, proposed = false, label = "precio" }: { change: OfferChange | null; proposed?: boolean; label?: string }) {
  if (!change || !change.comparable) return change ? <span className="delta-badge neutral">Cambió la cobertura</span> : null;
  const delta = moneyToCents(change.amount);
  if (delta === 0n) return <span className="delta-badge neutral">Sin cambios de {label}</span>;
  return <span className={`delta-badge ${proposed ? "proposed" : delta > 0 ? "positive" : "negative"}`}>
    <span aria-hidden="true">{delta > 0n ? "↘" : "↗"}</span> {change.percentage === null ? money(centsToMoney(delta < 0n ? -delta : delta)) : `${percent(change.percentage)}%`} {proposed ? "solicitado" : delta > 0n ? "menos" : "más"}
  </span>;
}
function Metrics({ metrics }: { metrics: TenderMetrics }) {
  return <>
    <div className="supplier-price"><strong>{money(metrics.offer.total)}</strong><ChangeBadge change={metrics.saving} proposed={metrics.proposed} /></div>
    <div className="supplier-facts"><span>{metrics.offer.coveredProducts}/{metrics.offer.requestedProducts} productos</span><span>{metrics.offer.deliveryDate ? `Entrega ${metrics.offer.deliveryDate.slice(5).split("-").reverse().join("/")}` : "Sin cobertura"}</span></div>
    {metrics.saving?.comparable && moneyToCents(metrics.saving.amount) > 0n ? <p className={metrics.proposed ? "target-note" : "saving-note"}>{metrics.proposed ? "Mejora buscada" : "Ahorro conseguido"} · {money(metrics.saving.amount)}</p> : null}
    {metrics.targetGap?.comparable ? (() => {
      const gap = moneyToCents(metrics.targetGap.amount);
      return <p className="target-note">{gap === 0n ? "Objetivo de precio alcanzado" : `${money(centsToMoney(gap < 0n ? -gap : gap))} ${gap > 0n ? "por debajo" : "por encima"} del objetivo`}</p>;
    })() : null}
    {metrics.coverageChange ? <span className={`delta-badge ${metrics.coverageChange > 0 ? "positive" : "negative"}`}>{metrics.coverageChange > 0 ? "+" : ""}{metrics.coverageChange} productos cubiertos</span> : null}
    {metrics.deliveryDaysEarlier ? <span className={`delta-badge ${metrics.deliveryDaysEarlier > 0 ? "positive" : "negative"}`}>{Math.abs(metrics.deliveryDaysEarlier)} días {metrics.deliveryDaysEarlier > 0 ? "antes" : "después"}</span> : null}
  </>;
}

type StageProps = {
  requestId: string; events: TenderProgressEvent[]; pending: boolean; streaming: boolean; slow: boolean;
  error: string | null; recovering: boolean;
  animateEntrance: boolean;
  onReview: () => void; onOrders: () => void; onConversations: () => void; onRetry: () => void; onDismiss: () => void;
};

export function NegotiationStage({ requestId, events, pending, streaming, slow, error, recovering, animateEntrance, onReview, onOrders, onConversations, onRetry, onDismiss }: StageProps) {
  const section = useRef<HTMLElement>(null);
  const titleId = useId();
  const svgId = useId().replaceAll(":", "");
  const orderEvent = [...events].reverse().find((event) => event.phase === "orders");
  const completeEvent = [...events].reverse().find((event) => event.phase === "complete");
  const summary = completeEvent?.summary ?? orderEvent?.summary;
  const savings = summary?.saving?.comparable ? moneyToCents(summary.saving.amount) : null;
  const errors = events.filter((event) => event.phase === "error");
  const finished = !!completeEvent;
  const hasResult = !!orderEvent && !!summary?.orderCount;
  const branches = suppliers.map((supplier) => {
    const conversation = events.filter((event) => event.supplierId === supplier.id);
    const step = [...conversation].reverse().find((event) => event.phase in phaseProgress);
    const metrics = [...conversation].reverse().find((event) => event.metrics)?.metrics;
    const failure = conversation.find((event) => event.phase === "error");
    const payment = [...conversation].reverse().find((event) => event.phase === "payment");
    return { supplier, step, metrics, failure, payment };
  });
  const title = hasResult ? summary?.pendingProducts ? "Un gran avance. Seguimos." : "Tu próximo pedido, resuelto." : errors.length ? "El pedido necesita una revisión." : finished ? "Todavía hay productos por resolver." : slow ? "Esto está tomando un poco más." : "Tu pedido empieza a tomar forma.";

  useEffect(() => {
    if (!animateEntrance) return;
    const element = section.current;
    const frame = requestAnimationFrame(() => {
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ behavior: "instant", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [animateEntrance]);

  return <section ref={section} className={`negotiation-stage ${hasResult ? "has-result" : ""} ${slow || finished ? "is-settled" : ""}`} aria-labelledby={titleId} tabIndex={-1}>
    {animateEntrance ? <div className="stage-intro" aria-hidden="true"><HermesMark /><span>hermes</span></div> : null}
    <header className="stage-heading">
      <div><p className="eyebrow"><span className={`live-dot ${finished && hasResult && !summary?.pendingProducts && !errors.length ? "settled" : ""}`} />{hasResult ? "El resultado de tus conversaciones" : finished ? "Ronda finalizada · revisá los pendientes" : "Hermes está trabajando para vos"}</p><h2 id={titleId}>{title}</h2><p className="stage-subtitle">{hasResult ? "Cada producto, con el proveedor que mejor responde a lo que necesitás." : "Tres proveedores. Una conversación por cada uno. Mejores condiciones para tu negocio."}</p></div>
      {hasResult || slow || finished ? <button type="button" className="icon-button" aria-label="Ocultar seguimiento" onClick={onDismiss}>×</button> : <span className="stage-reference">#{requestId.slice(0, 6).toUpperCase()}</span>}
    </header>

    <div className="stage-canvas">
      <svg className="negotiation-network" viewBox="0 0 1000 300" role="img" aria-label="Hermes conecta tu pedido con tres proveedores. El color de cada línea identifica una conversación.">
        <defs>
          <linearGradient id={`${svgId}-tile`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--surface-3)" /><stop offset="1" stopColor="var(--surface)" /></linearGradient>
          <radialGradient id={`${svgId}-halo`}><stop stopColor="var(--text)" stopOpacity=".09" /><stop offset="1" stopColor="var(--text)" stopOpacity="0" /></radialGradient>
        </defs>
        <ellipse cx="220" cy="150" rx="160" ry="140" fill={`url(#${svgId}-halo)`} />
        <g className="network-source"><rect x="100" y="118" width="140" height="64" rx="16" fill={`url(#${svgId}-tile)`} stroke="var(--line)" /><g transform="translate(116 136) scale(.8)"><path fill="var(--text)" d="M3 29C7 14 18 7 38 3C29 11 20 19 3 29ZM4 30C14 23 22 18 34 13C29 23 18 29 4 30Z" /></g><text x="157" y="155" fill="var(--text)" fontSize="17">Tu pedido</text><text x="170" y="207" textAnchor="middle" fill="var(--faint)" fontSize="10" letterSpacing="2">HERMES</text></g>
        <path d="M240 150H280" stroke="var(--muted)" fill="none" /><circle cx="280" cy="150" r="4" fill="var(--text)" />
        {branches.map(({ supplier, step, failure }, index) => {
          const y = 55 + index * 95;
          const path = `M280 150 C450 150 505 ${y} 718 ${y}`;
          const progress = step ? phaseProgress[step.phase] ?? 0 : 0;
          return <g key={supplier.id} className={`network-branch supplier-${supplier.color}`} style={{ animationDelay: animateEntrance ? `${900 + index * 180}ms` : "0ms", animationName: animateEntrance ? undefined : "none" }}>
            <path d={path} fill="none" stroke="var(--line)" strokeWidth="2" />
            <path className="route-glow" d={path} fill="none" stroke="var(--supplier)" strokeWidth="9" pathLength="100" strokeDasharray={`${progress} 100`} opacity=".08" />
            <path className="route-progress" d={path} fill="none" stroke="var(--supplier)" strokeWidth="2" pathLength="100" strokeDasharray={`${progress} 100`} />
            <line x1="718" y1={y} x2="752" y2={y} stroke={progress === 100 ? "var(--supplier)" : "var(--line)"} />
            <rect x="752" y={y - 23} width="172" height="46" rx="11" fill={`url(#${svgId}-tile)`} stroke={failure ? "var(--danger)" : "var(--line)"} />
            <circle className="terminal-dot" key={`dot:${step?.id ?? index}`} cx="770" cy={y} r="3" fill={step ? "var(--supplier)" : "var(--faint)"} />
            <text x="783" y={y + 4} fill="var(--text)" fontSize="12">{supplier.name}</text>
            {step && !slow && !finished ? <g key={step.id} className="message-packet" style={{ offsetPath: `path('${path}')`, animationDirection: step.direction === "inbound" ? "reverse" : "normal" }}><rect x="-12" y="-6" width="24" height="12" rx="6" fill="var(--supplier)" /><circle cx="-4" r="1" fill="var(--bg)" /><circle r="1" fill="var(--bg)" /><circle cx="4" r="1" fill="var(--bg)" /></g> : null}
          </g>;
        })}
      </svg>
    </div>

    <div className="stage-suppliers" role="region" aria-label="Condiciones por proveedor" tabIndex={0}>
      {branches.map(({ supplier, step, metrics, failure, payment }) => <article className={`stage-supplier supplier-${supplier.color}`} key={supplier.id}>
        <div className="supplier-stage-heading"><span className="supplier-key" /><strong>{supplier.name}</strong><span>{step ? `${phaseProgress[step.phase]}%` : "—"}</span></div>
        <p className={`supplier-phase ${failure ? "negative-text" : ""}`}>{failure ? "Respuesta pendiente · revisar" : step ? phaseLabels[step.phase] : "Preparando conversación"}</p>
        {metrics ? <Metrics metrics={metrics} /> : <p className="waiting-offer">{step ? "Esperando la primera propuesta…" : "Las condiciones aparecerán acá."}</p>}
        {payment ? <p className={`payment-state ${payment.status === "CONFIRMED" ? "positive-text" : payment.status === "FAILED" ? "negative-text" : ""}`}>{payment.status === "CONFIRMED" ? "✓ Pago confirmado" : payment.status === "FAILED" ? "Pago pendiente de revisión" : payment.status === "SUBMITTED" ? "Pago enviado · esperando confirmación" : "Pago pendiente de envío"}</p> : null}
      </article>)}
    </div>
    <p className="supplier-swipe-hint">Deslizá para ver las condiciones de cada proveedor ↔</p>
    <p className="sr-only" aria-live="polite">{events.at(-1)?.supplierId ? `${suppliers.find((supplier) => supplier.id === events.at(-1)?.supplierId)?.name}: ${phaseLabels[events.at(-1)!.phase]}` : ""}</p>

    <footer className="stage-footer" aria-live="polite" aria-atomic="true">
      {summary ? <div className="stage-result"><div><span>Total adjudicado</span><strong>{money(summary.total)}</strong></div><div><span>Ahorro en tus pedidos</span><strong className={savings !== null && savings > 0n ? "positive-text" : savings !== null && savings < 0n ? "negative-text" : ""}>{savings === null ? "No comparable" : savings > 0n ? money(summary.saving!.amount) : savings < 0n ? `${money(centsToMoney(-savings))} más` : "Sin reducción"}</strong></div><div><span>Cobertura</span><strong>{summary.coveredProducts}/{summary.requestedProducts} productos</strong></div><div><span>Pedidos generados</span><strong>{summary.orderCount}</strong></div></div> : <p className="stage-status">{error ?? errors[0]?.message ?? (slow ? "Podés seguir usando Hermes. Este es el último estado confirmado." : pending ? "Cada avance corresponde a una respuesta recibida." : "Consultá el estado del pedido para continuar.")}</p>}
      {summary && !hasResult ? <p className="stage-alert">No se generaron nuevos pedidos. {errors[0]?.message ?? "Hay productos que siguen pendientes."}</p> : null}
      <div className="stage-actions">
        {hasResult ? <button onClick={onOrders} type="button">Ver mis pedidos <span aria-hidden="true">↗</span></button> : null}
        {hasResult ? <button type="button" onClick={onConversations} className="text-button">Ver conversaciones</button> : null}
        {finished && !hasResult ? <button type="button" onClick={onConversations}>Revisar condiciones</button> : null}
        {slow || error || errors.length ? <button className="secondary" disabled={recovering} type="button" onClick={onReview}>{recovering ? "Actualizando…" : "Actualizar estado"}</button> : null}
        {!streaming && ((!hasResult && (errors.length > 0 || error)) || !!summary?.pendingProducts) ? <button type="button" className="secondary" onClick={onRetry}>Reintentar pendientes</button> : null}
        {hasResult && (errors.length > 0 || error) ? <span className="stage-alert">Los pedidos creados se conservaron. Hay estados que requieren revisión.</span> : null}
      </div>
    </footer>
  </section>;
}
