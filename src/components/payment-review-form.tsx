"use client";

import { useActionState } from "react";

import { initialPurchaseActionState } from "@/modules/protocol/actions/action-state";
import { reviewAutomaticPaymentsAction } from "@/modules/protocol/actions/purchase-requests";

export function PaymentReviewForm({
  companyId,
  purchaseRequestId,
  failedPayments,
  compact = false,
}: {
  companyId: string;
  purchaseRequestId: string;
  failedPayments: Array<{ id: string; label: string }>;
  /** Hides the title when the surrounding section already labels it. */
  compact?: boolean;
}) {
  const bound = reviewAutomaticPaymentsAction.bind(null, companyId, purchaseRequestId);
  const [state, action, pending] = useActionState(bound, initialPurchaseActionState);
  return (
    <div className={`payment-review stack ${compact ? "is-compact" : ""}`}>
      {compact ? null : <strong>Revisión manual de pagos</strong>}
      <p className="muted">Revisamos las transferencias ya enviadas antes de reintentar. Nada que esté confirmado se vuelve a pagar.</p>
      <form action={action}>
        <button disabled={pending} type="submit">{pending ? "Revisando…" : "Revisar pagos enviados"}</button>
      </form>
      {failedPayments.map((payment) => (
        <form action={action} key={payment.id}>
          <input name="confirmRetry" type="hidden" value="yes" />
          <input name="paymentId" type="hidden" value={payment.id} />
          <button className="danger" disabled={pending} type="submit">Reintentar el pago de {payment.label}</button>
        </form>
      ))}
      {state.message ? <p className={`feedback ${state.ok ? "success" : "error"}`}>{state.message}</p> : null}
    </div>
  );
}
