"use client";

import { useMemo, useState } from "react";

import type {
  ConsolidatedDraftProduct,
  ConsolidatedPurchaseDraft,
} from "@/modules/context/replenishment";
import { usePurchaseFlow } from "./purchase-flow-provider";

type EditableLine = Pick<
  ConsolidatedDraftProduct,
  | "productId"
  | "description"
  | "unit"
  | "minimumQuantity"
  | "targetQuantity"
  | "maximumQuantity"
  | "urgencyScore"
>;

export function BuyerOrderWorkspace({
  companyId,
  draft,
  compact = false,
}: {
  companyId: string;
  draft: ConsolidatedPurchaseDraft;
  compact?: boolean;
}) {
  const [lines, setLines] = useState<EditableLine[]>(() =>
    draft.products
      .filter((product) => product.automaticallySelected)
      .map((product) => ({
        productId: product.productId,
        description: product.description,
        unit: product.unit,
        minimumQuantity: product.minimumQuantity,
        targetQuantity: product.targetQuantity,
        maximumQuantity: product.maximumQuantity,
        urgencyScore: product.urgencyScore,
      })),
  );
  const [autoPay, setAutoPay] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "replenish" | "selected">("all");
  const { launchForm, pending, error } = usePurchaseFlow();
  const action = (data: FormData) => launchForm("new", companyId, data);
  const selectedIds = useMemo(
    () => new Set(lines.map((line) => line.productId)),
    [lines],
  );
  const visibleProducts = draft.products.filter((product) => {
    const matchesSearch = `${product.description} ${product.productId}`.toLocaleLowerCase("es-AR").includes(search.trim().toLocaleLowerCase("es-AR"));
    return matchesSearch && (filter === "all" || (filter === "selected" ? selectedIds.has(product.productId) : product.automaticallySelected));
  });

  function addProduct(product: ConsolidatedDraftProduct) {
    if (selectedIds.has(product.productId)) return;
    setLines((current) => [
      ...current,
      {
        productId: product.productId,
        description: product.description,
        unit: product.unit,
        minimumQuantity: product.automaticallySelected
          ? product.minimumQuantity
          : "1",
        targetQuantity: product.automaticallySelected
          ? product.targetQuantity
          : "1",
        maximumQuantity: product.automaticallySelected
          ? product.maximumQuantity
          : "1",
        urgencyScore: product.urgencyScore,
      },
    ]);
  }

  function updateLine(
    productId: string,
    field: "minimumQuantity" | "targetQuantity" | "maximumQuantity",
    value: string,
  ) {
    setLines((current) =>
      current.map((line) =>
        line.productId === productId ? { ...line, [field]: value } : line,
      ),
    );
  }

  return (
    <div className={`buyer-order-workspace ${compact ? "compact" : ""}`}>
      {!compact ? (
        <section aria-labelledby="products-title" className="workspace-section" id="productos">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Catálogo y reposición</p>
              <h2 id="products-title">Productos del comercio</h2>
            </div>
            <p className="muted">Agregá cualquier artículo al borrador; los sugeridos ya vienen seleccionados.</p>
          </div>
          <div className="inventory-toolbar">
            <div className="inventory-filters" role="group" aria-label="Filtrar productos">
              <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Todos <span>{draft.products.length}</span></button>
              <button type="button" aria-pressed={filter === "replenish"} onClick={() => setFilter("replenish")}>A reponer <span>{draft.products.filter((product) => product.automaticallySelected).length}</span></button>
              <button type="button" aria-pressed={filter === "selected"} onClick={() => setFilter("selected")}>En borrador <span>{lines.length}</span></button>
            </div>
            <label className="inventory-search"><span aria-hidden="true">⌕</span><span className="sr-only">Buscar producto o código</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto o código…" /></label>
          </div>
          <div className="table-wrap inventory-table-wrap" role="region" aria-label="Stock de productos" tabIndex={0}>
            <table className="inventory-table"><thead><tr><th scope="col">Producto</th><th scope="col">Estado</th><th scope="col">Disponible</th><th scope="col">En tránsito</th><th scope="col">Ventas · 30 días</th><th scope="col"><span className="sr-only">Acción</span></th></tr></thead><tbody>
            {visibleProducts.map((product) => {
              const selected = selectedIds.has(product.productId);
              return (
                <tr key={product.productId}>
                  <th scope="row"><strong>{product.description}</strong><small>{product.productId} · {product.unit}</small></th>
                  <td><span className={`stock-state ${product.automaticallySelected ? "warning" : ""}`} title={product.reason}><span aria-hidden="true">●</span> {product.automaticallySelected ? "A reponer" : "Disponible"}</span></td>
                  <td>{product.availableStock} <small>{product.unit}</small></td>
                  <td>{product.inTransit} <small>{product.unit}</small></td>
                  <td>{product.unitsSoldLast30Days} <small>{product.unit}</small></td>
                  <td><button
                    className="secondary"
                    disabled={selected || pending}
                    onClick={() => addProduct(product)}
                    type="button"
                    aria-label={selected ? `${product.description} incluido en borrador` : `Agregar ${product.description} al pedido`}
                  >
                    {selected ? "✓ Incluido" : "+ Agregar"}
                  </button></td>
                </tr>
              );
            })}
            {!visibleProducts.length ? <tr><td colSpan={6} className="empty-state">No hay productos que coincidan con este filtro.</td></tr> : null}
            </tbody></table>
          </div>
          <p className="inventory-footnote" aria-live="polite">{visibleProducts.length} de {draft.products.length} productos · Stock y ventas del contexto actual</p>
        </section>
      ) : null}

      <section aria-labelledby="draft-title" className="workspace-section order-builder" id="borrador">
        <form action={action} className="stack">
          <input name="items" type="hidden" value={JSON.stringify(lines)} />
          <div className="section-heading">
            <div>
              <p className="eyebrow">Borrador automático consolidado</p>
              <h2 id="draft-title">Pedido multiproducto</h2>
              <p className="muted">
                Revisá cantidades y condiciones. Enviar inicia las tres negociaciones y crea los pedidos ganadores automáticamente.
              </p>
            </div>
            <span className="status">{lines.length} LÍNEAS</span>
          </div>

          {lines.length > 0 ? (
            <div className="draft-lines" role="region" aria-label="Líneas editables del pedido" tabIndex={0}>
              <div className="draft-line draft-line-head" aria-hidden="true">
                <span>Producto</span><span>Mínimo</span><span>Objetivo</span><span>Máximo</span><span>Acción</span>
              </div>
              {lines.map((line) => (
                <div className="draft-line" key={line.productId}>
                  <div>
                    <strong>{line.description}</strong>
                    <small>{line.productId} · {line.unit}</small>
                  </div>
                  <label><span className="sr-only">Cantidad mínima de {line.description}</span><input min="0.000001" onChange={(event) => updateLine(line.productId, "minimumQuantity", event.target.value)} required step="any" type="number" value={line.minimumQuantity} /></label>
                  <label><span className="sr-only">Cantidad objetivo de {line.description}</span><input min="0.000001" onChange={(event) => updateLine(line.productId, "targetQuantity", event.target.value)} required step="any" type="number" value={line.targetQuantity} /></label>
                  <label><span className="sr-only">Cantidad máxima de {line.description}</span><input min="0.000001" onChange={(event) => updateLine(line.productId, "maximumQuantity", event.target.value)} required step="any" type="number" value={line.maximumQuantity} /></label>
                  <button className="text-button danger" disabled={pending} onClick={() => setLines((current) => current.filter((candidate) => candidate.productId !== line.productId))} type="button">Quitar</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-inline">
              <strong>El borrador está vacío.</strong>
              <span>Agregá al menos un producto desde el catálogo.</span>
            </div>
          )}

          <details className="order-conditions" open>
            <summary>Entrega, pago y presupuesto</summary>
            <div className="form-grid">
              <label>Entrega requerida<input defaultValue={draft.requiredBy} name="requiredBy" required type="date" /></label>
              <label>Tope total ARS<input defaultValue={draft.maximumTotalIncludingFees} inputMode="decimal" min="0.01" name="maximumTotalIncludingFees" required step="0.01" type="number" /></label>
              <label>Condición de pago<select defaultValue={autoPay ? "CONTADO" : draft.paymentTerms} disabled={autoPay} name="paymentTerms"><option value="CONTADO">Contado</option><option value="7_DIAS">7 días</option><option value="15_DIAS">15 días</option><option value="30_DIAS">30 días</option></select></label>
              <label>Vence la solicitud<input defaultValue={draft.expiresAt} name="expiresAt" required type="datetime-local" /></label>
              <label>Vence el mandato<input defaultValue={draft.mandateExpiresAt} name="mandateExpiresAt" required type="datetime-local" /></label>
              <label>Activo de liquidación<input disabled={autoPay} name="settlementAsset" readOnly={autoPay} value={autoPay ? "ARGt" : draft.settlementAsset} /></label>
            </div>
          </details>

          <div className="automatic-order-note">
            <label>
              <input checked={autoPay} name="autoPay" onChange={(event) => setAutoPay(event.target.checked)} type="checkbox" />
              <strong>Automatic payments</strong>
            </label>
            <span>
              {autoPay
                ? "CONTADO · ARGt · la recomendación ejecutará transferencias reales en Arbitrum One"
                : "Sin pagos automáticos; las órdenes se crearán pendientes de liquidación"}
            </span>
          </div>
          <div className="action-row">
            <button disabled={pending || lines.length === 0} type="submit">
              {pending ? "Negociando con 3 distribuidores…" : "Enviar y generar pedidos"}
            </button>
          </div>
          {error ? (
            <p aria-live="polite" className={"feedback error"}>{error}</p>
          ) : null}
        </form>
      </section>
    </div>
  );
}
