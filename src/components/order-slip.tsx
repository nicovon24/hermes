import type { ReactNode } from "react";
import { formatArs } from "@/lib/decimal";
import { argtBaseUnitsToDisplay } from "@/modules/payments/domain";
import { orderStatusLabels, paymentRouteLabels, paymentStatusLabels, paymentTermsLabel, paymentTone, type OrderSlipData } from "@/modules/protocol/domain/order-slip";
import { formatDayMonth, formatQuantity, formatShortDate } from "./request-ledger";

const money = (value: string) => formatArs(value);

/**
 * A purchase order drawn as the slip a distributor would print: counterpart
 * on top, lines with dotted leaders to their amounts, a ruled total, the
 * terms, and the payment state underneath. Server-safe; no hooks.
 */
export function OrderSlip({ order, counterpartName, colorClass = "supplier-neutral", fresh = false, changed = false, children }: {
  order: OrderSlipData;
  counterpartName: string;
  colorClass?: string;
  /** Just arrived over the live stream: plays the arrival animation and shows a tag. */
  fresh?: boolean;
  /** Status or payment changed over the live stream. */
  changed?: boolean;
  children?: ReactNode;
}) {
  const payment = order.payment;
  const tone = payment ? paymentTone(payment.status) : null;
  return (
    <article className={`order-slip ${colorClass} ${fresh ? "is-fresh" : ""} ${changed ? "is-changed" : ""}`} aria-label={`Pedido ${order.externalReference}`}>
      <header className="slip-head">
        <div className="slip-party">
          <span className="supplier-key" aria-hidden="true" />
          <strong>{counterpartName}</strong>
          <span className="slip-status">{orderStatusLabels[order.status] ?? order.status.toLowerCase()}</span>
          {fresh ? <span className="slip-tag">Nuevo</span> : null}
        </div>
        <code className="slip-ref">{order.externalReference}</code>
      </header>
      <ol className="slip-lines">
        {order.items.map((item) => (
          <li key={item.id}>
            <span className="slip-desc">
              {item.description}
              <small>{formatQuantity(item.quantity, item.unit)} × {money(item.unitPrice)}</small>
            </span>
            <span className="slip-leader" aria-hidden="true" />
            <span className="slip-amount">{money(item.total)}</span>
          </li>
        ))}
      </ol>
      <div className="slip-total"><span>Total</span><strong>{money(order.total)}</strong></div>
      <dl className="slip-terms">
        <div><dt>Entrega</dt><dd>{formatDayMonth(order.deliveryDate)}</dd></div>
        <div><dt>Pago</dt><dd>{paymentTermsLabel(order.paymentTerms)}</dd></div>
        <div><dt>Emitida</dt><dd><time dateTime={order.createdAt}>{formatShortDate(order.createdAt)}</time></dd></div>
      </dl>
      {payment && tone ? (
        <div className={`slip-payment tone-${tone}`}>
          <span className="slip-payment-dot" aria-hidden="true" />
          <span className="slip-payment-state">{paymentStatusLabels[payment.status] ?? payment.status}</span>
          <span className="slip-payment-amount">{Number(argtBaseUnitsToDisplay(payment.amountBaseUnits)).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ARGt{payment.route === "ARBITRUM_DIRECT" ? "" : ` vía ${paymentRouteLabels[payment.route] ?? payment.route}`}</span>
          {payment.txHash ? <a href={`https://arbiscan.io/tx/${payment.txHash}`} rel="noreferrer" target="_blank">Ver en Arbiscan <span aria-hidden="true">↗</span></a> : null}
          {payment.lastError ? <details className="slip-payment-error"><summary>Ver motivo</summary><p>{payment.lastError}</p></details> : null}
        </div>
      ) : null}
      {children}
    </article>
  );
}
