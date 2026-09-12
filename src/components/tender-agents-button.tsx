"use client";


import { usePurchaseFlow } from "./purchase-flow-provider";

export function TenderAgentsButton({
  companyId,
  purchaseRequestId,
  hasOffers,
  missingFinalOffers,
}: {
  companyId: string;
  purchaseRequestId: string;
  hasOffers: boolean;
  missingFinalOffers: number;
}) {
  const { launch, pending, error } = usePurchaseFlow();
  const action = async () => { await launch({ kind: "retry", buyerCompanyId: companyId, requestId: purchaseRequestId, operationId: crypto.randomUUID() }); };

  return (
    <form action={action} className="stack">
      <button disabled={pending} type="submit">
        {pending
          ? "Completando las ofertas finales…"
          : missingFinalOffers > 0 && hasOffers
            ? `Completar ${missingFinalOffers} oferta${missingFinalOffers === 1 ? "" : "s"} final${missingFinalOffers === 1 ? "" : "es"}`
            : hasOffers
            ? "Volver a consultar agentes"
            : "Lanzar agentes proveedores"}
      </button>
      {error ? (
        <p className={"feedback error"}>
          {error}
        </p>
      ) : null}
    </form>
  );
}
