"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { flowInputFromForm, launchPurchaseFlowSchema, type LaunchPurchaseFlowInput, type TenderProgressEvent, type TenderSnapshot } from "@/modules/protocol/domain/purchase-flow";
import { mergeProgress, readProgressStream } from "@/modules/protocol/domain/tender-progress";
import { ENTRY_DURATION_MS, PRESENTATION_DEADLINE_MS, presentationBatchSize, presentationCadence } from "@/modules/protocol/domain/tender-presentation";
import { NegotiationStage } from "./negotiation-stage";

type FlowContextValue = {
  launch: (input: LaunchPurchaseFlowInput) => Promise<void>;
  launchForm: (kind: "new" | "approve", companyId: string, data: FormData, requestId?: string) => Promise<void>;
  automaticPayments: boolean; pending: boolean; error: string | null;
};
type ApprovalNotice = {
  tone: "success" | "error";
  title: string;
  message: string;
};
type ApprovalResponse = {
  ok?: boolean;
  outcome?: "order_created" | "payment_confirmed" | "payment_failed" | "order_failed";
  orderCreated?: boolean;
  orderCount?: number;
  message?: string;
};
const FlowContext = createContext<FlowContextValue | null>(null);
export function usePurchaseFlow() {
  const context = useContext(FlowContext);
  if (!context) throw new Error("PurchaseFlowProvider is required");
  return context;
}

export function PurchaseFlowProvider({ automaticPayments, paymentsAvailable, children }: { automaticPayments: boolean; paymentsAvailable: boolean; children: ReactNode }) {
  const router = useRouter();
  const [events, setEvents] = useState<TenderProgressEvent[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [buyerCompanyId, setBuyerCompanyId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvalMode, setApprovalMode] = useState<"order" | "payment" | null>(null);
  const [approvalNotice, setApprovalNotice] = useState<ApprovalNotice | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [watching, setWatching] = useState(false);
  const [animateEntrance, setAnimateEntrance] = useState(false);
  const [destination, setDestination] = useState<"pedidos" | "negociaciones" | null>(null);
  const [navigating, startNavigation] = useTransition();
  const busy = useRef(false);
  const activeId = useRef<string | null>(null);
  const mounted = useRef(true);
  const queue = useRef<TenderProgressEvent[]>([]);
  const seen = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamDone = useRef(false);
  const begun = useRef(0);
  const nextEventAt = useRef(0);
  const lastInput = useRef<LaunchPurchaseFlowInput | null>(null);
  const idempotentNew = useRef<{ fingerprint: string; id: string; operation: string } | null>(null);

  const drain = useCallback(function tick() {
    if (!mounted.current) return;
    const elapsed = Date.now() - begun.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const count = presentationBatchSize(queue.current.length, elapsed, reduced);
    const batch = queue.current.splice(0, count);
    if (batch.length) setEvents((current) => mergeProgress(current, batch));
    const cadence = presentationCadence(queue.current.length);
    nextEventAt.current = Date.now() + cadence;
    if (queue.current.length) timer.current = setTimeout(tick, cadence);
    else { timer.current = null; if (streamDone.current) setPending(false); }
  }, []);

  const enqueue = useCallback((event: TenderProgressEvent) => {
    if (event.requestId !== activeId.current || !mounted.current || seen.current.has(event.id)) return;
    seen.current.add(event.id);
    queue.current.push(event);
    if (!timer.current) timer.current = setTimeout(drain, Math.max(0, nextEventAt.current - Date.now()));
  }, [drain]);

  const recover = useCallback(async (id: string, replace = false) => {
    setRecovering(true);
    try {
      const response = await fetch(`/api/purchase-flow/${id}`, { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 404 ? "Todavía no se confirmó la creación. Podés volver a enviar el mismo pedido." : "No se pudo actualizar. Volvé a consultar en unos instantes.");
      const snapshot = await response.json() as TenderSnapshot;
      if (!mounted.current || activeId.current !== id) return;
      if (replace) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        queue.current = [];
        seen.current = new Set(snapshot.events.map((event) => event.id));
        setEvents(snapshot.events);
      } else snapshot.events.forEach(enqueue);
      setError(null);
      setWatching(snapshot.running);
      busy.current = snapshot.running;
      if (!snapshot.running) { streamDone.current = true; if (replace || !queue.current.length) setPending(false); }
      else if (Date.now() - begun.current >= PRESENTATION_DEADLINE_MS) setSlow(true);
    } catch (cause) {
      if (mounted.current && activeId.current === id) setError(cause instanceof Error ? cause.message : "No se pudo recuperar el pedido.");
    } finally { if (mounted.current && activeId.current === id) setRecovering(false); }
  }, [enqueue]);

  useEffect(() => {
    // React Strict Mode mounts, cleans up and mounts effects again in dev.
    // Restore the guard on every setup or the live stream gets discarded.
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const completed = events.some((event) => event.phase === "complete");
  useEffect(() => {
    if (!requestId || !startedAt || completed) return;
    const deadline = setTimeout(() => { setSlow(true); setPending(false); if (timer.current) clearTimeout(timer.current); timer.current = null; drain(); }, Math.max(0, PRESENTATION_DEADLINE_MS - (Date.now() - startedAt)));
    return () => clearTimeout(deadline);
  }, [requestId, startedAt, drain, completed]);

  useEffect(() => {
    if (!watching || streaming || !requestId || completed) return;
    const poll = setInterval(() => { void recover(requestId); }, 3000);
    return () => clearInterval(poll);
  }, [watching, streaming, requestId, completed, recover]);

  const launch = useCallback(async (input: LaunchPurchaseFlowInput) => {
    if (busy.current) { setError("El pedido actual sigue en curso. Podés consultar su estado."); return; }
    const parsed = launchPurchaseFlowSchema.safeParse(input);
    if (!parsed.success) { setError("Revisá las líneas, el presupuesto y los vencimientos del pedido."); return; }
    busy.current = true; streamDone.current = false; activeId.current = input.requestId;
    lastInput.current = input; begun.current = Date.now(); nextEventAt.current = begun.current + ENTRY_DURATION_MS; queue.current = []; seen.current.clear();
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setEvents([]); setError(null); setSlow(false); setPending(true); setStreaming(true); setWatching(false); setAnimateEntrance(true);
    setRequestId(input.requestId); setStartedAt(begun.current);
    setBuyerCompanyId(input.buyerCompanyId);
    try {
      const response = await fetch("/api/purchase-flow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      if (!response.ok || !response.body) {
        const result = await response.json();
        throw new Error(result.message ?? "No se pudo iniciar el pedido.");
      }
      await readProgressStream(response.body, enqueue);
      await recover(input.requestId);
    } catch (cause) {
      busy.current = false;
      if (mounted.current) { setError(cause instanceof Error ? cause.message : "Se interrumpió la conexión. Consultá el último estado confirmado."); setSlow(true); }
      await recover(input.requestId);
    } finally {
      streamDone.current = true;
      if (activeId.current !== input.requestId) busy.current = false;
      if (mounted.current) { setStreaming(false); if (!queue.current.length) setPending(false); }
    }
  }, [enqueue, recover]);

  const launchForm = useCallback(async (kind: "new" | "approve", companyId: string, data: FormData, existingId?: string) => {
    if (busy.current) return;
    try {
      const fingerprint = JSON.stringify([...data.entries()]);
      if (!idempotentNew.current || idempotentNew.current.fingerprint !== fingerprint || kind !== "new") {
        idempotentNew.current = { fingerprint, id: existingId ?? crypto.randomUUID(), operation: crypto.randomUUID() };
      }
      const identity = idempotentNew.current;
      await launch(flowInputFromForm(kind, companyId, data, existingId ?? identity.id, identity.operation));
    } catch { setError("Revisá los datos del pedido."); }
  }, [launch]);

  function navigateTo(section: "pedidos" | "negociaciones") {
    setDestination(section);
    startNavigation(() => {
      router.push(`/cliente-demo#${section}`, { scroll: false });
      router.refresh();
    });
  }
  async function approveRecommendation(payNow: boolean) {
    if (!requestId || approving) return;
    setApproving(true);
    setApprovalMode(payNow ? "payment" : "order");
    setApprovalNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/purchase-flow/${requestId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payNow }),
      });
      const result = await response.json() as ApprovalResponse;
      if (!response.ok) {
        const message = result.message ?? "No se pudo crear el pedido.";
        setError(message);
        setApprovalNotice({ tone: "error", title: "No se creó el pedido", message });
        return;
      }
      await recover(requestId, true);
      if (result.outcome === "payment_failed") {
        const message = result.message ?? "El pedido fue creado, pero el pago no pudo confirmarse.";
        setError(message);
        setApprovalNotice({ tone: "error", title: "Pedido creado · pago no confirmado", message });
      } else {
        setApprovalNotice({
          tone: "success",
          title: result.outcome === "payment_confirmed" ? "Pago aprobado" : "Pedido creado",
          message: result.message ?? (payNow
            ? "El pedido fue creado y el pago quedó confirmado."
            : "El pedido fue creado correctamente."),
        });
      }
      if (
        result.outcome === "payment_confirmed" &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1400));
      }
      navigateTo("pedidos");
    } catch (cause) {
      console.error("Could not read the approval result", cause);
      const message = "No pudimos confirmar si el pedido se creó. Revisá la sección Pedidos antes de reintentar.";
      setError(message);
      setApprovalNotice({ tone: "error", title: "No pudimos confirmar la operación", message });
    } finally {
      setApproving(false);
      setApprovalMode(null);
    }
  }
  useEffect(() => {
    if (!destination || navigating) return;
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(destination);
      if (element) {
        element.tabIndex = -1;
        element.focus({ preventScroll: true });
        element.scrollIntoView({ block: "start", behavior: "instant" });
        setDestination(null);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [destination, navigating]);
  function dismiss() {
    setRequestId(null); setBuyerCompanyId(null); activeId.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null; queue.current = []; setPending(false);
  }

  const context = useMemo(
    () => ({ launch, launchForm, automaticPayments, pending, error }),
    [launch, launchForm, automaticPayments, pending, error],
  );
  return <FlowContext.Provider value={context}>
    {approvalNotice ? <aside
      aria-atomic="true"
      aria-live={approvalNotice.tone === "error" ? "assertive" : "polite"}
      className={`approval-notice ${approvalNotice.tone}`}
      role={approvalNotice.tone === "error" ? "alert" : "status"}
    >
      <span aria-hidden="true" className="approval-notice-icon">{approvalNotice.tone === "success" ? "✓" : "!"}</span>
      <div><strong>{approvalNotice.title}</strong><p>{approvalNotice.message}</p></div>
      <button aria-label="Cerrar aviso" onClick={() => setApprovalNotice(null)} type="button">×</button>
    </aside> : null}
    {requestId ? <NegotiationStage key={`${requestId}:${startedAt}`} requestId={requestId} buyerCompanyId={buyerCompanyId} paymentsAvailable={paymentsAvailable} events={events} pending={pending} streaming={streaming || watching} slow={slow} error={error} recovering={recovering} approving={approving} approvalMode={approvalMode} animateEntrance={animateEntrance}
      onApprove={(payNow) => { void approveRecommendation(payNow); }}
      onReview={() => { void recover(requestId, true); }} onOrders={() => navigateTo("pedidos")}
      onConversations={() => navigateTo("negociaciones")}
      onRetry={() => { if (lastInput.current) {
        const input = lastInput.current;
        const startedConversation = events.some((event) => event.phase === "rfq");
        void launch(startedConversation ? { kind: "retry", buyerCompanyId: input.buyerCompanyId, requestId, operationId: crypto.randomUUID() } : { ...input, operationId: crypto.randomUUID() });
      } else { router.push("/cliente-demo#negociaciones"); router.refresh(); } }}
      onDismiss={dismiss} /> : null}
    {children}
  </FlowContext.Provider>;
}
