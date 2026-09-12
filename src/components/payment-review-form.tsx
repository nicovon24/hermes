"use client";

import { useActionState } from "react";

import { initialPurchaseActionState } from "@/modules/protocol/actions/action-state";
import { reviewAutomaticPaymentsAction } from "@/modules/protocol/actions/purchase-requests";

export function PaymentReviewForm({
  companyId,
  purchaseRequestId,
  failedPayments,
}: {
  companyId: string;
  purchaseRequestId: string;
  failedPayments: Array<{ id: string; label: string }>;
}) {
  const bound = reviewAutomaticPaymentsAction.bind(null, companyId, purchaseRequestId);
  const [state, action, pending] = useActionState(bound, initialPurchaseActionState);
  return (
    <div className="payment-review stack">
      <strong>Revisión manual de pagos</strong>
      <p className="muted">Primero se concilian los hashes enviados. Ningún pago confirmado se reenvía.</p>
      <form action={action}>
        <button disabled={pending} type="submit">{pending ? "Conciliando…" : "Conciliar pagos enviados"}</button>
      </form>
      {failedPayments.map((payment) => (
        <form action={action} key={payment.id}>
          <input name="confirmRetry" type="hidden" value="yes" />
          <input name="paymentId" type="hidden" value={payment.id} />
          <button className="danger" disabled={pending} type="submit">Confirmar reintento real de {payment.label}</button>
        </form>
      ))}
      {state.message ? <p className={`feedback ${state.ok ? "success" : "error"}`}>{state.message}</p> : null}
    </div>
  );
}
