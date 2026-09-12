"use client";

import { useEffect, useId, useRef, useState } from "react";
import { centsToMoney, formatArs, moneyToCents } from "@/lib/decimal";
import { phaseLabels, phaseProgress, suppliers, type OfferChange, type TenderMetrics, type TenderProgressEvent, type TenderSummary } from "@/modules/protocol/domain/purchase-flow";
import { CloseGlyph } from "./close-glyph";
import { ConversationModal } from "./conversation-modal";
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
  // A round with no quoted line is not a cheap offer: the distributor has no
  // stock, so the card says so in red instead of showing a $ 0,00 price.
  if (metrics.offer.coveredProducts === 0) return <>
    <p className="no-stock-headline">Sin stock</p>
    <div className="supplier-facts is-no-stock"><span>0/{metrics.offer.requestedProducts} productos</span><span>No cotizó ninguna línea</span></div>
  </>;
  const saving = metrics.saving?.comparable ? moneyToCents(metrics.saving.amount) : null;
  const hasSaving = saving !== null && saving > 0n;
  const initialPrice = hasSaving
    ? centsToMoney(moneyToCents(metrics.offer.total) + saving)
    : null;

  return <>
    <div className="supplier-price">
      {initialPrice ? <p className="original-price"><span>Precio inicial</span><del>{money(initialPrice)}</del></p> : null}
      <div className="supplier-current-price"><strong>{money(metrics.offer.total)}</strong><ChangeBadge change={metrics.saving} proposed={metrics.proposed} /></div>
    </div>
    <div className="supplier-facts"><span>{metrics.offer.coveredProducts}/{metrics.offer.requestedProducts} productos</span><span>{metrics.offer.deliveryDate ? `Entrega ${metrics.offer.deliveryDate.slice(5).split("-").reverse().join("/")}` : "Entrega a confirmar"}</span></div>
    {hasSaving ? <p className={metrics.proposed ? "target-note" : "saving-note"}><span>{metrics.proposed ? "Mejora buscada" : "Ahorro conseguido"}</span><strong>{money(metrics.saving!.amount)}</strong></p> : null}
    {metrics.targetGap?.comparable ? (() => {
      const gap = moneyToCents(metrics.targetGap.amount);
      return <p className="target-note">{gap === 0n ? "Objetivo de precio alcanzado" : `${money(centsToMoney(gap < 0n ? -gap : gap))} ${gap > 0n ? "por debajo" : "por encima"} del objetivo`}</p>;
    })() : null}
    {metrics.coverageChange ? <span className={`delta-badge ${metrics.coverageChange > 0 ? "positive" : "negative"}`}>{metrics.coverageChange > 0 ? "+" : ""}{metrics.coverageChange} productos cubiertos</span> : null}
    {metrics.deliveryDaysEarlier ? <span className={`delta-badge ${metrics.deliveryDaysEarlier > 0 ? "positive" : "negative"}`}>{Math.abs(metrics.deliveryDaysEarlier)} días {metrics.deliveryDaysEarlier > 0 ? "antes" : "después"}</span> : null}
  </>;
}

/**
 * A branch that came back without stock never reaches its distributor: the same
 * cubic is split with de Casteljau at 55%, so the track, the red route and the
 * barrier drawn across the break all end on exactly the same point.
 */
function cutRoute(y: number) {
  const end = { x: 501.56, y: 63.7875 + 0.57475 * y };
  const control = { x: 432.21, y: 104.625 + 0.3025 * y };
  return {
    d: `M280 150 C373.5 150 ${control.x} ${control.y.toFixed(2)} ${end.x} ${end.y.toFixed(2)}`,
    end,
    angle: (Math.atan2(end.y - control.y, end.x - control.x) * 180) / Math.PI,
  };
}

const chatMoment = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Cordoba" });

/** The round as the two agents wrote it: buyer turns to the left, supplier to the right. */
function AgentThread({ supplierName, events }: { supplierName: string; events: TenderProgressEvent[] }) {
  return <div className="conversation-thread">
    {events.map((event) => {
      const chat = event.chat!;
      return <article className={`debate-message ${chat.role === "buyer" ? "buyer-message" : "supplier-message"}`} key={event.id}>
        <div className="message-heading"><strong>{chat.label}</strong><time dateTime={event.timestamp}>{chatMoment.format(new Date(event.timestamp))}</time></div>
        <p className="message-sender">{chat.role === "buyer" ? "Agente comprador · Hermes" : `Agente vendedor · ${supplierName}`}</p>
        {chat.facts.length > 0 ? <dl className="message-facts">{chat.facts.map((fact) => <div key={`${event.id}:${fact.label}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl> : null}
        {chat.notes ? <p className="message-notes">{chat.notes}</p> : null}
      </article>;
    })}
  </div>;
}

const receiptStates: Record<string, { label: string; state: "confirmed" | "sent" | "failed" | "waiting" }> = {
  PAYMENT_CONFIRMED: { label: "Confirmada", state: "confirmed" },
  PAYMENT_SUBMITTED: { label: "Enviada, esperando confirmación", state: "sent" },
  PAYMENT_FAILED: { label: "Falló, hay que revisarla", state: "failed" },
  PAYMENT_REVIEW_REQUIRED: { label: "Para revisar", state: "failed" },
};

/**
 * The payment moment, drawn as the receipt it produces: one line per transfer
 * with a dotted leader to its amount, a ruled total, and the leader turning
 * solid green as each transfer confirms. The same sheet serves the wait and
 * the confirmation, so nothing jumps when the last transfer lands.
 */
/**
 * Opened in the top layer, never as a plain fixed div: the stage keeps a filling
 * transform animation, which makes it the containing block of any fixed child —
 * the receipt used to be centred inside the stage and clipped by its overflow.
 * `showModal` also traps focus and leaves the page behind inert; the body lock
 * stops it from scrolling underneath.
 */
function useModalDialog(open: boolean) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !open || element.open) return;
    element.showModal();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  return dialog;
}

function PaymentReceipt({ open, confirmed, orders, copy, onClose, onOrders }: {
  open: boolean; confirmed: boolean; orders: TenderSummary["orders"]; copy: string; onClose: () => void; onOrders: () => void;
}) {
  const titleId = useId();
  const dialog = useModalDialog(open);
  if (!open) return null;
  const confirmedCount = orders.filter(({ paymentStatus }) => paymentStatus === "PAYMENT_CONFIRMED").length;
  const total = centsToMoney(orders.reduce((sum, order) => sum + moneyToCents(order.total), 0n));
  const subtitle = orders.length === 0
    ? "Creando los pedidos con las ofertas ganadoras"
    : confirmed
      ? `${orders.length === 1 ? "1 transferencia" : `${orders.length} transferencias`} en Arbitrum`
      : `${confirmedCount} de ${orders.length} ${orders.length === 1 ? "transferencia confirmada" : "transferencias confirmadas"}`;
  return <dialog ref={dialog} className="payment-receipt-modal" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`payment-receipt ${confirmed ? "is-confirmed" : "is-processing"}`} aria-live="polite">
      <span className="receipt-progress" aria-hidden="true" style={{ width: orders.length ? `${Math.round((confirmedCount / orders.length) * 100)}%` : "0%" }} />
      <header className="receipt-head">
        <div><h3 id={titleId}>{confirmed ? "Pago confirmado" : "Pagando en ARGt"}</h3><p>{subtitle}</p></div>
        <button aria-label="Cerrar" autoFocus className="icon-button" onClick={onClose} type="button"><CloseGlyph /></button>
      </header>
      <ol className="receipt-lines">
        {orders.length === 0 ? <li className="receipt-waiting"><span className="receipt-pulse" aria-hidden="true" />Hermes está emitiendo las órdenes de compra</li> : null}
        {orders.map((order) => {
          const supplier = suppliers.find((candidate) => candidate.id === order.supplierId);
          const meta = receiptStates[order.paymentStatus ?? ""] ?? { label: "En espera", state: "waiting" as const };
          return <li className={`supplier-${supplier?.color ?? "neutral"} state-${meta.state}`} key={order.id}>
            <span className="supplier-key" aria-hidden="true" />
            <span className="receipt-party"><strong>{supplier?.name ?? "Distribuidor"}</strong><small>{meta.label}</small></span>
            <span className="receipt-leader" aria-hidden="true" />
            <span className="receipt-amount">{money(order.total)}</span>
          </li>;
        })}
      </ol>
      {orders.length > 0 ? <div className="receipt-total"><span>Total</span><strong>{money(total)}</strong></div> : null}
      <footer className="receipt-foot">
        <p>{copy}</p>
        <div className="receipt-actions">
          {confirmed ? <button onClick={onOrders} type="button">Ver mis pedidos</button> : null}
          <button className="secondary" onClick={onClose} type="button">{confirmed ? "Seguir acá" : "Cerrar"}</button>
        </div>
      </footer>
    </section>
  </dialog>;
}

/** The last confirmation before money moves, in the top layer for the same reasons as the receipt. */
function PaymentChoice({ open, approving, paymentsAvailable, onClose, onApprove }: {
  open: boolean; approving: boolean; paymentsAvailable: boolean; onClose: () => void; onApprove: (payNow: boolean) => void;
}) {
  const titleId = useId();
  const dialog = useModalDialog(open);
  if (!open) return null;
  return <dialog ref={dialog} className="payment-choice-modal" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div>
      <button aria-label="Cerrar" className="icon-button" onClick={onClose} type="button"><CloseGlyph /></button>
      <p className="eyebrow">Último paso</p>
      <h3 id={titleId}>¿Querés pagar el pedido ahora?</h3>
      <p>Podés generar la orden solamente o ejecutar también el pago automático.</p>
      <div className="payment-choice-actions">
        <button className="secondary" disabled={approving} onClick={() => { onClose(); onApprove(false); }} type="button">Generar sin pagar</button>
        <button disabled={approving || !paymentsAvailable} onClick={() => { onClose(); onApprove(true); }} title={paymentsAvailable ? "Generar y pagar con ARGt" : "La configuración de pagos no está disponible"} type="button">Generar y pagar</button>
      </div>
    </div>
  </dialog>;
}

type StageProps = {
  requestId: string; buyerCompanyId?: string | null; paymentsAvailable?: boolean; events: TenderProgressEvent[]; pending: boolean; streaming: boolean; slow: boolean;
  error: string | null; recovering: boolean; approving?: boolean; approvalMode?: "order" | "payment" | null;
  automaticPayments?: boolean; animateEntrance: boolean;
  onApprove?: (payNow: boolean) => void; onOrders: () => void; onNegotiations?: () => void; onRetry: () => void; onDismiss: () => void;
};

export function NegotiationStage({ requestId, buyerCompanyId, paymentsAvailable = false, events, streaming, slow, error, approving = false, approvalMode = null, automaticPayments = false, animateEntrance, onApprove, onOrders, onNegotiations, onRetry, onDismiss }: StageProps) {
  const section = useRef<HTMLElement>(null);
  const titleId = useId();
  const svgId = useId().replaceAll(":", "");
  const [showPaymentChoice, setShowPaymentChoice] = useState(false);
  // The receipt closes on request, but reopens once when every transfer lands.
  const [receiptDismissed, setReceiptDismissed] = useState<"processing" | "confirmed" | null>(null);
  const orderEvent = [...events].reverse().find((event) => event.phase === "orders");
  const recommendationEvent = [...events].reverse().find((event) => event.phase === "award" && event.recommendation);
  const recommendation = recommendationEvent?.recommendation;
  const requestedItems = events.find((event) => event.phase === "rfq" && event.requestItems?.length)?.requestItems ?? [];
  const completeEvent = [...events].reverse().find((event) => event.phase === "complete");
  const summary = completeEvent?.summary ?? orderEvent?.summary;
  const savings = summary?.saving?.comparable ? moneyToCents(summary.saving.amount) : null;
  const errors = events.filter((event) => event.phase === "error");
  const finished = !!completeEvent;
  const hasOrders = !!orderEvent && !!summary?.orderCount;
  const hasRecommendation = !!recommendation && !hasOrders;
  const hasResult = hasOrders || hasRecommendation;
  const branches = suppliers.map((supplier) => {
    const conversation = events.filter((event) => event.supplierId === supplier.id);
    const step = [...conversation].reverse().find((event) => event.phase in phaseProgress);
    const metrics = [...conversation].reverse().find((event) => event.metrics)?.metrics;
    const failure = conversation.find((event) => event.phase === "error");
    const payment = [...conversation].reverse().find((event) => event.phase === "payment");
    // How many passes of haggling this branch went through, to tell a one-shot
    // quote apart from a distributor that had to be pushed four times.
    const exchanges = conversation.reduce((rounds, event) => Math.max(rounds, event.exchange ?? 0), 0);
    return { supplier, step, metrics, failure, payment, exchanges, chat: conversation.filter((event) => event.chat) };
  });
  const winner = hasResult ? [...branches]
    .filter(({ metrics }) => metrics && metrics.offer.coveredProducts > 0 && moneyToCents(metrics.offer.total) > 0n)
    .sort((left, right) => {
      const difference = moneyToCents(left.metrics!.offer.total) - moneyToCents(right.metrics!.offer.total);
      return difference < 0n ? -1 : difference > 0n ? 1 : 0;
    })[0] : undefined;
  const secondaryBranches = winner
    ? branches.filter(({ supplier }) => supplier.id !== winner.supplier.id)
    : branches;
  // The awarded option turns green: the recommendation names each awarded
  // distributor, created orders name them by id, otherwise the best price wins.
  const winningSupplierIds = new Set<string>(
    recommendation?.supplierNames.length
      ? suppliers.filter(({ name }) => recommendation.supplierNames.includes(name)).map(({ id }) => id)
      : summary?.orders.length
        ? summary.orders.map(({ supplierId }) => supplierId)
        : winner ? [winner.supplier.id] : [],
  );
  const requestedUnitCount = requestedItems.reduce((total, item) => total + Number(item.quantity), 0);
  const conversationSubject = requestedItems.length === 1
    ? requestedItems[0].description
    : requestedItems.length > 1 ? `${requestedItems.length} productos solicitados` : "Negociación del pedido";
  const connecting = streaming && branches.every(({ step }) => !step);
  const confirmedPaymentBranches = branches.filter(({ payment }) => payment?.status === "CONFIRMED");
  const outOfStockNames = branches.filter(({ metrics }) => metrics && metrics.offer.coveredProducts === 0).map(({ supplier }) => supplier.name);
  const allPaymentsConfirmed = !!summary?.orders.length && summary.orders.every(({ paymentStatus }) => paymentStatus === "PAYMENT_CONFIRMED");
  // With auto pay, orders and transfers follow the award without a click, so
  // the same processing notice covers the wait until the flow reports back.
  const autoPaying = automaticPayments && hasResult && !finished && !error && !errors.length;
  const processingPayment = ((approving && approvalMode === "payment") || autoPaying) && !allPaymentsConfirmed;
  const receiptOpen = (processingPayment || allPaymentsConfirmed) && receiptDismissed !== (allPaymentsConfirmed ? "confirmed" : "processing");
  useEffect(() => {
    if (allPaymentsConfirmed) setReceiptDismissed((current) => current === "processing" ? null : current);
  }, [allPaymentsConfirmed]);
  const confirmedSupplierNames = confirmedPaymentBranches.map(({ supplier }) => supplier.name);
  const paymentConfirmationCopy = confirmedSupplierNames.length === 1
    ? `La transferencia a ${confirmedSupplierNames[0]} quedó confirmada y el pedido fue creado.`
    : confirmedSupplierNames.length > 1
      ? `Las transferencias a ${confirmedSupplierNames.slice(0, -1).join(", ")} y ${confirmedSupplierNames.at(-1)} quedaron confirmadas y los pedidos fueron creados.`
      : "El pago quedó confirmado y el pedido fue creado.";

  function supplierCard(branch: (typeof branches)[number], featured = false) {
    const { supplier, step, metrics, failure, payment, exchanges, chat } = branch;
    const noStock = !!metrics && metrics.offer.coveredProducts === 0;
    const profitability = metrics?.saving?.comparable && metrics.saving.percentage !== null
      ? Math.max(0, metrics.saving.percentage)
      : 0;
    return <article className={["stage-supplier", `supplier-${supplier.color}`, featured && "winner-supplier", noStock && "is-out-of-stock"].filter(Boolean).join(" ")} key={supplier.id}>
      <div className="supplier-stage-heading"><span className="supplier-key" /><strong>{supplier.name}</strong><span>{featured ? "MEJOR OFERTA" : step ? `${step.progress ?? phaseProgress[step.phase] ?? 0}%` : "—"}</span></div>
      <p className={`supplier-phase ${failure ? "negative-text" : ""}`}>{failure ? "Respuesta pendiente · revisar" : step ? `${phaseLabels[step.phase]}${exchanges > 1 ? ` · ${exchanges} rondas de regateo` : ""}` : streaming ? "Abriendo conexión segura…" : "Preparando conversación"}</p>
      {metrics ? <Metrics metrics={metrics} /> : <p className="waiting-offer">{step ? "Esperando la primera propuesta…" : streaming ? "Conectando al agente del proveedor…" : "Las condiciones aparecerán acá."}</p>}
      {featured && metrics ? <div className="winner-insights"><div><span>Cantidad</span><strong>{requestedUnitCount.toLocaleString("es-AR")} {requestedItems.length === 1 ? requestedItems[0].unit : "unidades"}</strong></div><div><span>Rentabilidad ganada</span><strong>+{percent(profitability)}%</strong></div><div><span>Ahorro conseguido</span><strong>{metrics.saving?.comparable && moneyToCents(metrics.saving.amount) > 0n ? money(metrics.saving.amount) : "$ 0,00"}</strong></div><div><span>Entrega</span><strong>{metrics.offer.deliveryDate ? metrics.offer.deliveryDate.slice(5).split("-").reverse().join("/") : "A confirmar"}</strong></div></div> : null}
      {featured && hasRecommendation && buyerCompanyId && onApprove ? <button className="winner-cta" disabled={approving} onClick={() => setShowPaymentChoice(true)} type="button">{approving ? approvalMode === "payment" ? "Procesando pago…" : "Creando pedido…" : "Generar pedido"} <span aria-hidden="true">→</span></button> : null}
      {payment ? <p className={`payment-state ${payment.status === "CONFIRMED" ? "positive-text" : payment.status === "FAILED" ? "negative-text" : ""}`}>{payment.status === "CONFIRMED" ? "✓ Pago confirmado" : payment.status === "FAILED" ? "Pago pendiente de revisión" : payment.status === "SUBMITTED" ? "Pago enviado · esperando confirmación" : "Pago pendiente de envío"}</p> : null}
      {chat.length > 0 ? <div className="supplier-conversation"><ConversationModal
        finalOfferTotal={metrics && !noStock ? money(metrics.offer.total) : undefined}
        messageCount={chat.length}
        offerStatus={noStock ? { label: "Sin stock", tone: "empty" } : undefined}
        productName={conversationSubject}
        supplierName={supplier.name}
        triggerLabel="Ver chat de los agentes"
      >
        <AgentThread events={chat} supplierName={supplier.name} />
      </ConversationModal></div> : null}
    </article>;
  }
  useEffect(() => {
    if (!animateEntrance) return;
    const element = section.current;
    const frame = requestAnimationFrame(() => {
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ behavior: "instant", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [animateEntrance]);

  return <section ref={section} className={`negotiation-stage ${hasResult ? "has-result" : ""} ${slow || finished ? "is-settled" : ""} ${processingPayment ? "is-paying" : ""} ${allPaymentsConfirmed ? "has-confirmed-payment" : ""}`} aria-labelledby={titleId} tabIndex={-1}>
    {animateEntrance ? <div className="stage-intro" aria-hidden="true"><HermesMark /><span>hermes</span></div> : null}
    <header className="stage-heading">
      <p className="eyebrow" id={titleId} aria-live="polite"><span className={`live-dot ${finished && hasResult && !summary?.pendingProducts && !errors.length ? "settled" : ""}`} />{hasResult ? "El resultado de tus conversaciones" : finished ? "Ronda finalizada · revisá los pendientes" : connecting ? "Conectando con 3 distribuidores" : "Hermes está trabajando para vos"}</p>
      {hasResult || slow || finished ? <button type="button" className="icon-button" aria-label="Ocultar seguimiento" onClick={onDismiss}><CloseGlyph /></button> : <span className="stage-reference">#{requestId.slice(0, 6).toUpperCase()}</span>}
    </header>

    <div className="stage-canvas">
      <svg className="negotiation-network" viewBox="0 0 1000 300" role="img" aria-label={`Hermes conecta tu pedido con tres proveedores. El color de cada línea identifica una conversación.${outOfStockNames.length ? ` ${outOfStockNames.join(" y ")} ${outOfStockNames.length === 1 ? "quedó sin stock" : "quedaron sin stock"}: su camino se corta en rojo.` : ""}${confirmedPaymentBranches.length ? " Las líneas verdes indican los pagos confirmados." : ""}`}>
        <defs>
          <linearGradient id={`${svgId}-tile`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--surface-3)" /><stop offset="1" stopColor="var(--surface)" /></linearGradient>
          <radialGradient id={`${svgId}-halo`}><stop stopColor="var(--text)" stopOpacity=".09" /><stop offset="1" stopColor="var(--text)" stopOpacity="0" /></radialGradient>
        </defs>
        <ellipse cx="220" cy="150" rx="160" ry="140" fill={`url(#${svgId}-halo)`} />
        <g className="network-source"><rect x="100" y="118" width="140" height="64" rx="16" fill={`url(#${svgId}-tile)`} stroke="var(--line)" /><g transform="translate(116 136) scale(.8)"><path fill="var(--text)" d="M3 29C7 14 18 7 38 3C29 11 20 19 3 29ZM4 30C14 23 22 18 34 13C29 23 18 29 4 30Z" /></g><text x="157" y="155" fill="var(--text)" fontSize="17">Tu pedido</text><text x="170" y="207" textAnchor="middle" fill="var(--faint)" fontSize="10" letterSpacing="2">HERMES</text></g>
        <path d="M240 150H280" stroke="var(--muted)" fill="none" /><circle cx="280" cy="150" r="4" fill="var(--text)" />
        {branches.map(({ supplier, step, failure, payment, metrics }, index) => {
          const y = 55 + index * 95;
          const full = `M280 150 C450 150 505 ${y} 718 ${y}`;
          const paymentPath = `M240 150 H280 C450 150 505 ${y} 718 ${y} H752`;
          const noStock = !!metrics && metrics.offer.coveredProducts === 0;
          const cut = noStock ? cutRoute(y) : null;
          const path = cut ? cut.d : full;
          const progress = noStock ? 100 : step ? step.progress ?? phaseProgress[step.phase] ?? 0 : 0;
          const isConnecting = streaming && !step && !failure;
          const paymentConfirmed = payment?.status === "CONFIRMED";
          const isWinner = hasResult && winningSupplierIds.has(supplier.id);
          const connectionDelay = animateEntrance ? 650 + index * 450 : 0;
          return <g key={supplier.id} className={["network-branch", `supplier-${supplier.color}`, isConnecting && "is-connecting", isWinner && "is-winner", noStock && "is-out-of-stock"].filter(Boolean).join(" ")} style={{ animationDelay: `${connectionDelay}ms`, animationName: animateEntrance ? undefined : "none" }}>
            <path d={path} fill="none" stroke="var(--line)" strokeWidth="2" />
            <path className="route-connecting" d={path} fill="none" stroke="var(--supplier)" strokeWidth="2" pathLength="100" style={{ animationDelay: `${connectionDelay}ms` }} />
            <path className="route-glow" d={path} fill="none" stroke="var(--supplier)" strokeWidth="9" pathLength="100" strokeDasharray={`${progress} 100`} opacity=".08" />
            <path className="route-progress" d={path} fill="none" stroke="var(--supplier)" strokeWidth="2" pathLength="100" strokeDasharray={`${progress} 100`} strokeLinecap={cut ? "round" : undefined} />
            {cut ? <g className="route-cut" transform={`translate(${cut.end.x} ${cut.end.y.toFixed(2)}) rotate(${cut.angle.toFixed(2)})`}><line x1="0" y1="-10" x2="0" y2="10" stroke="var(--danger)" strokeLinecap="round" strokeWidth="3" /></g> : null}
            {paymentConfirmed ? <path className="payment-confirmed-route" d={paymentPath} fill="none" pathLength="100" stroke="var(--success)" strokeLinecap="round" strokeWidth="5" /> : null}
            {cut ? null : <line x1="718" y1={y} x2="752" y2={y} stroke={progress === 100 ? "var(--supplier)" : "var(--line)"} />}
            <rect x="752" y={y - 23} width="172" height="46" rx="11" fill={`url(#${svgId}-tile)`} stroke={paymentConfirmed || isWinner ? "var(--success)" : failure || noStock ? "var(--danger)" : "var(--line)"} strokeDasharray={noStock ? "6 5" : undefined} strokeWidth={paymentConfirmed || isWinner ? "2" : "1"} />
            <circle className="terminal-dot" key={`dot:${step?.id ?? index}`} cx="770" cy={y} r="3" fill={noStock ? "var(--danger)" : step ? "var(--supplier)" : "var(--faint)"} />
            {noStock
              ? <><text x="783" y={y - 1} fill="var(--text)" fontSize="12">{supplier.name}</text><text x="783" y={y + 13} fill="var(--danger)" fontSize="9.5">Sin stock</text></>
              : <text x="783" y={y + 4} fill="var(--text)" fontSize="12">{supplier.name}</text>}
            {paymentConfirmed ? <g className="payment-confirmed-check" transform={`translate(905 ${y})`}><circle fill="var(--success)" r="13" /><path d="M-6 0 -2 5 7 -6" fill="none" stroke="var(--bg)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" /></g> : null}
            {step && !slow && !finished && !noStock ? <g key={step.id} className="message-packet" style={{ offsetPath: `path('${path}')`, animationDirection: step.direction === "inbound" ? "reverse" : "normal" }}><rect x="-12" y="-6" width="24" height="12" rx="6" fill="var(--supplier)" /><circle cx="-4" r="1" fill="var(--bg)" /><circle r="1" fill="var(--bg)" /><circle cx="4" r="1" fill="var(--bg)" /></g> : null}
          </g>;
        })}
      </svg>
    </div>

    <PaymentReceipt
      open={receiptOpen}
      confirmed={allPaymentsConfirmed}
      orders={summary?.orders ?? []}
      copy={allPaymentsConfirmed ? paymentConfirmationCopy : "El pedido queda creado aunque cierres esta ventana. El pago sigue solo y te avisamos cuando se confirme."}
      onClose={() => setReceiptDismissed(allPaymentsConfirmed ? "confirmed" : "processing")}
      onOrders={() => { setReceiptDismissed("confirmed"); (onNegotiations ?? onOrders)(); }}
    />

    {requestedItems.length > 0 ? (
      <div className="requested-order-detail">
        <span className="eyebrow">Detalle de lo solicitado</span>
        <div>
          {requestedItems.map((item) => (
            <p key={`${item.productId}:${item.quantity}`}><strong>{item.description}</strong><span>{item.quantity} {item.unit}</span></p>
          ))}
        </div>
      </div>
    ) : null}

    {winner ? <div className="winner-offer" role="region" aria-label="Mejor oferta disponible">{supplierCard(winner, true)}</div> : null}
    <div className={`stage-suppliers ${winner ? "secondary-offers" : ""}`} role="region" aria-label={winner ? "Otras ofertas" : "Condiciones por proveedor"} tabIndex={0}>
      {secondaryBranches.map((branch) => supplierCard(branch))}
    </div>
    <p className="supplier-swipe-hint">Deslizá para ver las condiciones de cada proveedor ↔</p>
    <p className="sr-only" aria-live="polite">{events.at(-1)?.supplierId ? `${suppliers.find((supplier) => supplier.id === events.at(-1)?.supplierId)?.name}: ${phaseLabels[events.at(-1)!.phase]}` : ""}</p>

    {hasResult ? <footer className="stage-footer" aria-live="polite" aria-atomic="true">
      {hasRecommendation && recommendation && summary ? <div className="recommendation-result"><span className="eyebrow">Recomendación de Hermes</span><strong>{recommendation.supplierNames.join(" + ")}</strong><div><span>Total recomendado</span><b>{money(recommendation.total)}</b></div><p>{recommendation.coveredProducts}/{summary.requestedProducts} productos cubiertos con las mejores ofertas recibidas.</p></div> : summary ? <div className="stage-result"><div><span>Total adjudicado</span><strong>{money(summary.total)}</strong></div><div><span>Ahorro en tus pedidos</span><strong className={savings !== null && savings > 0n ? "positive-text" : savings !== null && savings < 0n ? "negative-text" : ""}>{savings === null ? "No comparable" : savings > 0n ? money(summary.saving!.amount) : savings < 0n ? `${money(centsToMoney(-savings))} más` : "Sin reducción"}</strong></div><div><span>Cobertura</span><strong>{summary.coveredProducts}/{summary.requestedProducts} productos</strong></div><div><span>Pedidos generados</span><strong>{summary.orderCount}</strong></div></div> : null}
      <div className="stage-actions">
        {hasOrders ? <button onClick={onOrders} type="button">Ver mis pedidos <span aria-hidden="true">↗</span></button> : null}
        {!streaming && !!summary?.pendingProducts ? <button type="button" className="secondary" onClick={onRetry}>Reintentar pendientes</button> : null}
        {hasOrders && (errors.length > 0 || error) ? <span className="stage-alert">Los pedidos creados se conservaron. Hay estados que requieren revisión.</span> : null}
      </div>
    </footer> : null}
    {onApprove ? <PaymentChoice
      approving={approving}
      onApprove={onApprove}
      onClose={() => setShowPaymentChoice(false)}
      open={showPaymentChoice}
      paymentsAvailable={paymentsAvailable}
    /> : null}
  </section>;
}
