"use client";

import { useActionState } from "react";

import { initialContextActionState } from "@/modules/context/action-state";
import { recordSaleAction } from "@/modules/context/actions";

export function SaleForm({ companyId }: { companyId: string }) {
  const [state, action, pending] = useActionState(
    recordSaleAction.bind(null, companyId),
    initialContextActionState,
  );

  return (
    <form action={action} className="stack form-card">
      <div className="form-grid">
        <label>ERP<input name="sourceExternalId" placeholder="ERP-principal" required /></label>
        <label>Versión<input name="sourceVersion" placeholder="sale-v1" required /></label>
        <label>ID de venta<input name="externalEventId" placeholder="ticket-001" required /></label>
        <label>SKU<input name="productExternalId" placeholder="SKU-001" required /></label>
        <label>Producto<input name="productName" required /></label>
        <label>Unidad<input name="unit" defaultValue="unit" required /></label>
        <label>Cantidad<input name="quantity" inputMode="decimal" required /></label>
        <label>Precio unitario<input name="unitPrice" inputMode="decimal" required /></label>
        <label>Fecha de venta<input name="soldAt" type="datetime-local" required /></label>
      </div>
      <button disabled={pending} type="submit">{pending ? "Guardando…" : "Registrar venta"}</button>
      {state.message ? <p className={`feedback ${state.ok ? "success" : "error"}`}>{state.message}</p> : null}
    </form>
  );
}
