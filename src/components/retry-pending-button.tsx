"use client";


import { usePurchaseFlow } from "./purchase-flow-provider";

export function RetryPendingButton({
  buyerCompanyId,
  purchaseRequestId,
}: {
  buyerCompanyId: string;
  purchaseRequestId: string;
}) {
  const { launch, pending, error } = usePurchaseFlow();
  const action = async () => { await launch({ kind: "retry", buyerCompanyId, requestId: purchaseRequestId, operationId: crypto.randomUUID() }); };
  return (
    <form action={action} className="retry-form">
      <button disabled={pending} type="submit">
        {pending ? "Reintentando…" : "Reintentar pendientes"}
      </button>
      {error ? (
        <p aria-live="polite" className={"feedback error"}>{error}</p>
      ) : null}
    </form>
  );
}
