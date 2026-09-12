"use client";

import { useState } from "react";

import type { AutomaticPurchaseDraft } from "@/modules/context/replenishment";
import { usePurchaseFlow } from "./purchase-flow-provider";

export function AutomaticPurchaseDraftCard({
  companyId,
  draft,
}: {
  companyId: string;
  draft: AutomaticPurchaseDraft | null;
}) {
  const [editing, setEditing] = useState(false);
  const { launchForm, pending, error } = usePurchaseFlow();
  const action = (data: FormData) => launchForm("new", companyId, data);

  if (!draft) {
    return (
      <div className="automatic-draft empty-draft">
        <p className="eyebrow">Agente comprador al día</p>
        <h3>No hay un nuevo pedido para enviar</h3>
        <p className="muted">
          El stock disponible, lo que está en tránsito y el consumo reciente no
          requieren otra reposición por ahora.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="automatic-draft stack">
      <input name="productId" type="hidden" value={draft.productId} />
      <input name="description" type="hidden" value={draft.description} />
      <input name="unit" type="hidden" value={draft.unit} />

      <div className="request-header">
        <div>
          <p className="eyebrow">Borrador del agente comprador</p>
          <h3>{draft.description}</h3>
          <p className="muted">{draft.reason}</p>
        </div>
        <span className="status">LISTO PARA REVISAR</span>
      </div>

      <div className="draft-metrics">
        <div><span>Stock disponible</span><strong>{draft.availableStock} {draft.unit}</strong></div>
        <div><span>En tránsito</span><strong>{draft.inTransit} {draft.unit}</strong></div>
        <div><span>Ventas últimos 30 días</span><strong>{draft.unitsSoldLast30Days} {draft.unit}</strong></div>
        <div><span>Pedido sugerido</span><strong>{draft.targetQuantity} {draft.unit}</strong></div>
      </div>

      {editing ? (
        <div className="form-grid">
          <label>
            Cantidad mínima
            <input
              defaultValue={draft.minimumQuantity}
              inputMode="decimal"
              name="minimumQuantity"
              required
            />
          </label>
          <label>
            Cantidad objetivo
            <input
              defaultValue={draft.targetQuantity}
              inputMode="decimal"
              name="targetQuantity"
              required
            />
          </label>
          <label>
            Cantidad máxima
            <input
              defaultValue={draft.maximumQuantity}
              inputMode="decimal"
              name="maximumQuantity"
              required
            />
          </label>
          <label>
            Entrega requerida
            <input defaultValue={draft.requiredBy} name="requiredBy" required type="date" />
          </label>
          <label>
            Tope total ARS
            <input
              defaultValue={draft.maximumTotalIncludingFees}
              inputMode="decimal"
              name="maximumTotalIncludingFees"
              required
            />
          </label>
          <label>
            Condición de pago
            <input defaultValue={draft.paymentTerms} name="paymentTerms" required />
          </label>
          <label>
            El pedido vence
            <input defaultValue={draft.expiresAt} name="expiresAt" required type="datetime-local" />
          </label>
          <label>
            El mandato vence
            <input
              defaultValue={draft.mandateExpiresAt}
              name="mandateExpiresAt"
              required
              type="datetime-local"
            />
          </label>
          <input name="settlementAsset" type="hidden" value={draft.settlementAsset} />
        </div>
      ) : (
        <>
          <input name="minimumQuantity" type="hidden" value={draft.minimumQuantity} />
          <input name="targetQuantity" type="hidden" value={draft.targetQuantity} />
          <input name="maximumQuantity" type="hidden" value={draft.maximumQuantity} />
          <input name="requiredBy" type="hidden" value={draft.requiredBy} />
          <input name="expiresAt" type="hidden" value={draft.expiresAt} />
          <input name="mandateExpiresAt" type="hidden" value={draft.mandateExpiresAt} />
          <input
            name="maximumTotalIncludingFees"
            type="hidden"
            value={draft.maximumTotalIncludingFees}
          />
          <input name="paymentTerms" type="hidden" value={draft.paymentTerms} />
          <input name="settlementAsset" type="hidden" value={draft.settlementAsset} />
        </>
      )}

      <p className="muted">
        Enviar abre la licitación con los tres distribuidores. No acepta ofertas
        ni realiza pagos automáticamente.
      </p>
      <div className="action-row">
        <button disabled={pending} type="submit">
          {pending ? "Enviando y negociando…" : "Enviar pedido"}
        </button>
        <button
          className="secondary"
          disabled={pending}
          onClick={() => setEditing((current) => !current)}
          type="button"
        >
          {editing ? "Usar sugerencia original" : "Editar pedido"}
        </button>
      </div>
      {error ? (
        <p className={"feedback error"}>
          {error}
        </p>
      ) : null}
    </form>
  );
}
