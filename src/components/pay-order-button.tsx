"use client";

import { useActionState } from "react";

import { initialPurchaseActionState } from "@/modules/protocol/actions/action-state";
import { payPurchaseOrderAction } from "@/modules/protocol/actions/purchase-requests";

export function PayOrderButton({
  buyerCompanyId,
  paymentAvailable,
  purchaseOrderId,
}: {
  buyerCompanyId: string;
  paymentAvailable: boolean;
  purchaseOrderId: string;
}) {
  const bound = payPurchaseOrderAction.bind(null, buyerCompanyId, purchaseOrderId);
  const [state, action, pending] = useActionState(bound, initialPurchaseActionState);

  return (
    <div className="pay-order-action">
      <form action={action}>
        <button
          disabled={pending || !paymentAvailable}
          title={paymentAvailable ? "Pagar este pedido con ARGt" : "Configurá las credenciales de pago para habilitarlo"}
          type="submit"
        >
          {pending ? "Pagando…" : "Pagar"}
        </button>
      </form>
      {state.message ? (
        <p aria-live="polite" className={`feedback ${state.ok ? "success" : "error"}`}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
