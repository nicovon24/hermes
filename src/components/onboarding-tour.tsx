"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export const TOUR_STORAGE_KEY = "hermes:tour:v1";

export const tourSteps = [
  { target: "pedido", title: "Elegí qué pedir", text: "Tocá un producto y confirmá la cantidad. Hermes abre tres conversaciones con distribuidores a la vez y te muestra cómo mejora cada oferta." },
  { target: "negociaciones", title: "Seguí cada conversación", text: "En Negociaciones quedan todas tus solicitudes, con los mensajes completos y la recomendación final de Hermes." },
  { target: "contexto", title: "Tu contexto privado", text: "Stock, ventas y objetivos que el agente usa para negociar mejor. Sólo vos lo ves; nunca llega a los distribuidores." },
  { target: "autopay", title: "Pagá sin pasos extra", text: "Con Auto pay activado, el pedido ganador se paga solo en ARGt en cuanto lo aprobás." },
  { target: "empresas", title: "Mirá el otro lado", text: "Entrá a cada distribuidor para ver cómo recibe tu pedido y cómo responde su agente." },
] as const;

type Box = { top: number; left: number; width: number; height: number };
const PADDING = 8;
const GAP = 14;

function readDone() {
  try { return window.localStorage.getItem(TOUR_STORAGE_KEY) === "done"; } catch { return false; }
}
function writeDone() {
  try { window.localStorage.setItem(TOUR_STORAGE_KEY, "done"); } catch { /* Private mode or blocked storage: the tour simply shows again. */ }
}
function visibleBox(element: Element | null): Box | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const style = window.getComputedStyle(element);
  if (style.visibility === "hidden" || style.display === "none") return null;
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/**
 * Skippable first-visit walkthrough. `requestCount` increments each time the
 * sidebar asks for the tour again; the walkthrough always plays on `homePath`
 * because that is where every highlighted element exists.
 */
export function OnboardingTour({ homePath, requestCount }: { homePath: string; requestCount: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const handledRequest = useRef(0);
  const current = tourSteps[step];

  const finish = useCallback(() => { writeDone(); setOpen(false); setStep(0); }, []);

  // First visit: play automatically, but only once the user is on the home page.
  useEffect(() => {
    if (pathname !== homePath || readDone()) return;
    const timer = setTimeout(() => setOpen(true), 900);
    return () => clearTimeout(timer);
  }, [pathname, homePath]);

  // Manual request from the sidebar: go home first when needed, then play.
  useEffect(() => {
    if (requestCount === 0 || handledRequest.current === requestCount) return;
    handledRequest.current = requestCount;
    if (pathname !== homePath) router.push(homePath);
    setStep(0);
    setOpen(true);
  }, [requestCount, pathname, homePath, router]);

  // Find and measure the highlighted element; the page may still be rendering
  // after a navigation, so retry briefly before falling back to a centered card.
  useEffect(() => {
    if (!open) return;
    let attempts = 0;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      const element = document.querySelector(`[data-tour="${current.target}"]`);
      const next = visibleBox(element);
      if (!next && attempts < 25) { attempts += 1; timer = setTimeout(measure, 120); return; }
      if (next && attempts === 0) element?.scrollIntoView({ block: "center", behavior: "instant" });
      frame = requestAnimationFrame(() => setBox(visibleBox(element)));
    };
    measure();
    const refresh = () => setBox(visibleBox(document.querySelector(`[data-tour="${current.target}"]`)));
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => { clearTimeout(timer); cancelAnimationFrame(frame); window.removeEventListener("resize", refresh); window.removeEventListener("scroll", refresh, true); };
  }, [open, current.target]);

  // Place the card once its size is known: below the element when there is room, otherwise above.
  useLayoutEffect(() => {
    if (!open) return;
    const element = card.current;
    if (!element) return;
    const width = element.offsetWidth, height = element.offsetHeight;
    const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
    if (!box) { setPlacement({ top: Math.max(16, (viewportHeight - height) / 2), left: Math.max(16, (viewportWidth - width) / 2) }); return; }
    const below = box.top + box.height + PADDING + GAP;
    const top = below + height <= viewportHeight - 16 ? below : Math.max(16, box.top - PADDING - GAP - height);
    const left = Math.min(Math.max(16, box.left), viewportWidth - width - 16);
    setPlacement({ top, left });
    element.focus({ preventScroll: true });
  }, [open, box, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
      if (event.key === "ArrowRight") setStep((value) => Math.min(tourSteps.length - 1, value + 1));
      if (event.key === "ArrowLeft") setStep((value) => Math.max(0, value - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish]);

  if (!open) return null;
  const hole = box ? { top: box.top - PADDING, left: box.left - PADDING, width: box.width + PADDING * 2, height: box.height + PADDING * 2 } : null;
  const last = step === tourSteps.length - 1;
  return <div className="tour" role="presentation">
    {hole ? <>
      <div className="tour-shade" style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
      <div className="tour-shade" style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
      <div className="tour-shade" style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
      <div className="tour-shade" style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
      <div className="tour-ring" style={hole} />
    </> : <div className="tour-shade" style={{ inset: 0 }} />}
    <div ref={card} className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" tabIndex={-1} style={placement ? { top: placement.top, left: placement.left } : { visibility: "hidden" }}>
      <p className="eyebrow">Paso {step + 1} de {tourSteps.length}</p>
      <h3 id="tour-title">{current.title}</h3>
      <p>{current.text}</p>
      <div className="tour-dots" aria-hidden="true">{tourSteps.map((item, index) => <span key={item.target} className={index === step ? "is-active" : index < step ? "is-done" : ""} />)}</div>
      <div className="tour-actions">
        <button type="button" className="text-button" onClick={finish}>Omitir</button>
        {step > 0 ? <button type="button" className="secondary" onClick={() => setStep(step - 1)}>Anterior</button> : null}
        <button type="button" onClick={() => last ? finish() : setStep(step + 1)}>{last ? "Listo" : "Siguiente"}</button>
      </div>
    </div>
  </div>;
}
