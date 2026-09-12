"use client";

import { useActionState } from "react";

import { initialContextActionState } from "@/modules/context/action-state";
import { recordInventorySnapshotAction } from "@/modules/context/actions";

export function InventoryForm({ companyId }: { companyId: string }) {
  const [state, action, pending] = useActionState(
    recordInventorySnapshotAction.bind(null, companyId),
    initialContextActionState,
  );

  return (
    <form action={action} className="stack form-card">
      <div className="form-grid">
        <label>ERP<input name="sourceExternalId" placeholder="ERP-principal" required /></label>
        <label>Versión<input name="sourceVersion" placeholder="inv-0001" required /></label>
        <label>SKU<input name="productExternalId" placeholder="SKU-001" required /></label>
        <label>Producto<input name="productName" required /></label>
        <label>Unidad<input name="unit" defaultValue="unit" required /></label>
        <label>Stock físico<input name="onHand" inputMode="decimal" required /></label>
        <label>Reservado<input name="reserved" inputMode="decimal" defaultValue="0" required /></label>
        <label>En tránsito<input name="inTransit" inputMode="decimal" defaultValue="0" required /></label>
        <label>Observado<input name="observedAt" type="datetime-local" required /></label>
      </div>
      <button disabled={pending} type="submit">{pending ? "Guardando…" : "Guardar inventario"}</button>
      {state.message ? <p className={`feedback ${state.ok ? "success" : "error"}`}>{state.message}</p> : null}
    </form>
  );
}
