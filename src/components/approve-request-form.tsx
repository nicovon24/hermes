"use client";

import { useState } from "react";

import { usePurchaseFlow } from "./purchase-flow-provider";

export function ApproveRequestForm({
  companyId,
  purchaseRequestId,
  suppliers,
}: {
  companyId: string;
  purchaseRequestId: string;
  suppliers: Array<{ id: string; legal_name: string }>;
}) {
  const { launchForm, pending, error } = usePurchaseFlow();
  const action = (data: FormData) => launchForm("approve", companyId, data, purchaseRequestId);
  const [autoPay, setAutoPay] = useState(true);

  return (
    <form action={action} className="stack compact-form">
      <div className="form-grid">
        <label>
          Máximo total ARS
          <input name="maximumTotalIncludingFees" inputMode="decimal" required />
        </label>
        <label>
          Condición de pago
          <input disabled={autoPay} name="paymentTerms" defaultValue={autoPay ? "CONTADO" : "PREPAID"} required={!autoPay} />
        </label>
        <label>
          Activo de liquidación
          <input disabled={autoPay} name="settlementAsset" defaultValue={autoPay ? "ARGt" : "ARS_TOKEN"} required={!autoPay} />
        </label>
        <label>
          Ruta de pago
          <select defaultValue="ARBITRUM_DIRECT" name="route">
            <option value="ARBITRUM_DIRECT">ARGt directo en Arbitrum</option>
            <option value="SOLANA_TO_ARBITRUM">USDC-DEV en Solana → ARGt</option>
          </select>
        </label>
        <label>
          El mandato vence
          <input name="mandateExpiresAt" type="datetime-local" required />
        </label>
      </div>
      <fieldset className="supplier-picker">
        <legend>Las 3 negociaciones se abren en paralelo</legend>
        {suppliers.map((supplier) => (
          <label key={supplier.id}>
            <input checked disabled readOnly type="checkbox" />
            {supplier.legal_name}
          </label>
        ))}
      </fieldset>
      <label className="automatic-order-note">
        <span>
          <input checked={autoPay} name="autoPay" onChange={(event) => setAutoPay(event.target.checked)} type="checkbox" />
          <strong> Automatic payments</strong>
        </span>
        <span>{autoPay ? "CONTADO / ARGt. La recomendación ejecutará transferencias reales." : "Las órdenes no se pagarán automáticamente."}</span>
      </label>
      <p className="muted">
        Los vendedores responden sin confirmación. La adjudicación respeta el mandato activo.
      </p>
      <button disabled={pending} type="submit">
        {pending ? "Lanzando licitación…" : "Lanzar licitación"}
      </button>
      {error ? (
        <p className={"feedback error"}>
          {error}
        </p>
      ) : null}
    </form>
  );
}
