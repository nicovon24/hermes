"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatArs } from "@/lib/decimal";
import { argtBaseUnitsToDisplay } from "@/modules/payments/domain";
import {
  changedOrderIds,
  collectionState,
  dispatchGroups,
  isCollected,
  newOrderIds,
  paymentRouteLabels,
  paymentStatusLabels,
  paymentTermsLabel,
  productSummary,
  summarizeQuantity,
  type OrderSlipData,
} from "@/modules/protocol/domain/order-slip";
import { formatDayMonth, formatQuantity, formatShortDate, pluralize } from "./request-ledger";

type Connection = "connecting" | "live" | "reconnecting";
const HIGHLIGHT_MS = 9000;
const CORDOBA = "America/Argentina/Cordoba";

const money = (value: string) => formatArs(value);
const clock = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: CORDOBA });
const isoDay = new Intl.DateTimeFormat("en-CA", { timeZone: CORDOBA, year: "numeric", month: "2-digit", day: "2-digit" });
const weekday = new Intl.DateTimeFormat("es-AR", { weekday: "long", timeZone: CORDOBA });

/** Córdoba never changes offset, so a fixed anchor keeps server and browser on the same weekday. */
function weekdayOf(date: string) {
  return weekday.format(new Date(`${date}T12:00:00-03:00`));
}

/**
 * The delivery day as the warehouse says it: what is late, what leaves today,
 * what leaves tomorrow, and then plain dates.
 */
function dispatchDay(date: string, today: string) {
  const tomorrow = isoDay.format(new Date(new Date(`${today}T12:00:00-03:00`).getTime() + 86_400_000));
  if (date < today) return { label: `Debía salir el ${weekdayOf(date)} ${formatDayMonth(date)}`, late: true };
  if (date === today) return { label: `Entrega hoy, ${weekdayOf(date)} ${formatDayMonth(date)}`, late: false };
  if (date === tomorrow) return { label: `Entrega mañana, ${weekdayOf(date)} ${formatDayMonth(date)}`, late: false };
  return { label: `Entrega el ${weekdayOf(date)} ${formatDayMonth(date)}`, late: false };
}

function quantityLabel(quantity: { amount: number; unit: string | null }) {
  return quantity.unit ? formatQuantity(quantity.amount, quantity.unit) : pluralize(quantity.amount, "línea");
}

/**
 * The distributor's dispatch sheet. Orders the server already loaded, then the
 * SSE stream: a new order or a payment update lands within seconds, tagged and
 * highlighted in place. Rows sit under the day they have to be delivered —
 * what leaves first is on top — and open to the full order when asked.
 */
export function SupplierOrderBook({ companyId, initialOrders, buyerName, colorClass }: {
  companyId: string;
  initialOrders: OrderSlipData[];
  buyerName: string;
  colorClass: string;
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [changed, setChanged] = useState<Set<string>>(() => new Set());
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [onlyOwed, setOnlyOwed] = useState(false);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const latest = useRef(initialOrders);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/companies/${companyId}/orders/stream`);
    source.onopen = () => setConnection("live");
    source.onerror = () => setConnection("reconnecting");
    source.addEventListener("orders", (event) => {
      let next: OrderSlipData[];
      try { next = JSON.parse((event as MessageEvent<string>).data) as OrderSlipData[]; } catch { return; }
      const arrivals = newOrderIds(latest.current, next);
      const updates = changedOrderIds(latest.current, next);
      latest.current = next;
      setOrders(next);
      setConnection("live");
      setSyncedAt(new Date());
      if (arrivals.length) {
        setFresh((current) => new Set([...current, ...arrivals]));
        timers.current.push(setTimeout(() => setFresh((current) => { const copy = new Set(current); arrivals.forEach((id) => copy.delete(id)); return copy; }), HIGHLIGHT_MS));
      }
      if (updates.length) {
        setChanged((current) => new Set([...current, ...updates]));
        timers.current.push(setTimeout(() => setChanged((current) => { const copy = new Set(current); updates.forEach((id) => copy.delete(id)); return copy; }), HIGHLIGHT_MS));
      }
    });
    return () => {
      source.close();
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [companyId]);

  const owed = orders.filter((order) => !isCollected(order));
  const groups = useMemo(() => dispatchGroups(onlyOwed ? orders.filter((order) => !isCollected(order)) : orders), [orders, onlyOwed]);
  const today = isoDay.format(new Date());

  function toggle(id: string) {
    setOpened((current) => {
      const copy = new Set(current);
      if (!copy.delete(id)) copy.add(id);
      return copy;
    });
  }

  return (
    <section className="order-book" aria-labelledby="order-book-title">
      <header className="order-book-head">
        <h2 id="order-book-title">Pedidos</h2>
        <div className="order-book-tools">
          <p className={`live-state is-${connection}`} role="status" aria-live="polite">
            <span className="live-dot" aria-hidden="true" />
            {connection === "live" ? (syncedAt ? `En vivo, actualizado ${clock.format(syncedAt)}` : "En vivo") : connection === "connecting" ? "Conectando…" : "Reconectando…"}
          </p>
          {owed.length > 0 ? (
            <button aria-pressed={onlyOwed} className={`filter-toggle ${onlyOwed ? "is-on" : ""}`} onClick={() => setOnlyOwed((value) => !value)} type="button">
              Sólo lo que falta cobrar
              <span>{owed.length}</span>
            </button>
          ) : null}
        </div>
      </header>

      {orders.length === 0 ? (
        <div className="ledger-empty">
          <strong>Todavía no recibiste pedidos.</strong>
          <p>Cuando {buyerName} adjudique una de tus ofertas, el pedido aparece acá al instante, sin recargar.</p>
        </div>
      ) : (
        <>
          <div className="dispatch-wrap">
            <table className={`dispatch-sheet ${colorClass}`}>
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col">Cantidad</th>
                  <th scope="col">Importe</th>
                  <th scope="col">Cobro</th>
                </tr>
              </thead>
              {groups.map((group) => {
                const day = dispatchDay(group.date, today);
                return (
                  <tbody className={`dispatch-day ${day.late ? "is-late" : ""}`} key={group.date}>
                    <tr className="dispatch-band">
                      <th colSpan={2} scope="colgroup">{day.label}</th>
                      <td colSpan={2}>
                        <span>{pluralize(group.orders.length, "pedido")}</span>
                        <span>{quantityLabel(group.quantity)}</span>
                        <span className="dispatch-band-money">{money(group.total)}</span>
                        {group.pending > 0 && !onlyOwed ? <span className="dispatch-band-owed">{group.pending} por cobrar</span> : null}
                      </td>
                    </tr>
                    {group.orders.map((order) => {
                      const collection = collectionState(order);
                      const open = opened.has(order.id);
                      const detailId = `pedido-${order.id}`;
                      const payment = order.payment;
                      return [
                        <tr
                          className={`dispatch-row ${fresh.has(order.id) ? "is-fresh" : ""} ${changed.has(order.id) ? "is-changed" : ""} ${open ? "is-open" : ""}`}
                          key={order.id}
                          onClick={(event) => { if (!(event.target as HTMLElement).closest("a, button")) toggle(order.id); }}
                        >
                          <th scope="row">
                            <button aria-controls={detailId} aria-expanded={open} onClick={() => toggle(order.id)} type="button">
                              <span className="dispatch-caret" aria-hidden="true" />
                              <span>
                                <span className="dispatch-product">{productSummary(order.items)}</span>
                                <code className="dispatch-ref">{order.externalReference}</code>
                              </span>
                            </button>
                            {fresh.has(order.id) ? <span className="slip-tag">Nuevo</span> : null}
                          </th>
                          <td data-label="Cantidad">{quantityLabel(summarizeQuantity(order.items))}</td>
                          <td className="dispatch-amount" data-label="Importe">{money(order.total)}</td>
                          <td data-label="Cobro">
                            <span className={`collection tone-${collection.tone}`}><span className="collection-dot" aria-hidden="true" />{collection.label}</span>
                          </td>
                        </tr>,
                        open ? (
                          <tr className="dispatch-detail" id={detailId} key={`${order.id}:detalle`}>
                            <td colSpan={4}>
                              <ol className="slip-lines">
                                {order.items.map((item) => (
                                  <li key={item.id}>
                                    <span className="slip-desc">{item.description}<small>{formatQuantity(item.quantity, item.unit)} × {money(item.unitPrice)}</small></span>
                                    <span className="slip-leader" aria-hidden="true" />
                                    <span className="slip-amount">{money(item.total)}</span>
                                  </li>
                                ))}
                              </ol>
                              <dl className="slip-terms">
                                <div><dt>Pago</dt><dd>{paymentTermsLabel(order.paymentTerms)}</dd></div>
                                <div><dt>Emitida</dt><dd><time dateTime={order.createdAt}>{formatShortDate(order.createdAt)}</time></dd></div>
                                <div><dt>Pedido de</dt><dd>{buyerName}</dd></div>
                              </dl>
                              {payment ? (
                                <div className={`slip-payment tone-${collection.tone === "sent" ? "pending" : collection.tone}`}>
                                  <span className="slip-payment-dot" aria-hidden="true" />
                                  <span className="slip-payment-state">{paymentStatusLabels[payment.status] ?? payment.status}</span>
                                  <span className="slip-payment-amount">
                                    {Number(argtBaseUnitsToDisplay(payment.amountBaseUnits)).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ARGt
                                    {payment.route === "ARBITRUM_DIRECT" ? "" : ` vía ${paymentRouteLabels[payment.route] ?? payment.route}`}
                                  </span>
                                  {payment.txHash ? <a href={`https://arbiscan.io/tx/${payment.txHash}`} rel="noreferrer" target="_blank">Ver en Arbiscan <span aria-hidden="true">↗</span></a> : null}
                                  {payment.lastError ? <details className="slip-payment-error"><summary>Ver motivo</summary><p>{payment.lastError}</p></details> : null}
                                </div>
                              ) : <p className="dispatch-uncollected">Todavía no hay transferencia para este pedido.</p>}
                            </td>
                          </tr>
                        ) : null,
                      ];
                    })}
                  </tbody>
                );
              })}
            </table>
          </div>
        </>
      )}
    </section>
  );
}
