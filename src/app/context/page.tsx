import Link from "next/link";

import { centsToMoney, formatArs, moneyToCents, quantityToMicros } from "@/lib/decimal";
import { InventoryForm } from "@/modules/context/inventory-form";
import { SaleForm } from "@/modules/context/sale-form";
import { prisma } from "@/lib/prisma";
import { getCurrentWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type InventoryRow = {
  id: string;
  on_hand: string | number;
  reserved: string | number;
  in_transit: string | number;
  observed_at: string;
  source_version: string;
  products: { external_id: string; name: string; unit: string; unit_cost: string | number } | null;
  context_sources: { external_id: string; kind: string } | null;
};

type SaleRow = {
  id: string;
  external_event_id: string;
  quantity: string | number;
  unit_price: string | number;
  sold_at: string;
  products: { external_id: string; name: string; unit: string } | null;
};

export default async function ContextPage() {
  const { company } = await getCurrentWorkspace();

  const [inventoryData, salesData, objectiveData] = await Promise.all([
    prisma.inventorySnapshot.findMany({
      where: { companyId: company.id },
      orderBy: { observedAt: "desc" },
      take: 20,
      include: { product: true, source: true },
    }),
    prisma.salesEvent.findMany({
      where: { companyId: company.id },
      orderBy: { soldAt: "desc" },
      take: 20,
      include: { product: true },
    }),
    prisma.companyObjective.findUnique({ where: { companyId: company.id } }),
  ]);
  const inventory: InventoryRow[] = inventoryData.map((row) => ({
    id: row.id,
    on_hand: row.onHand.toString(),
    reserved: row.reserved.toString(),
    in_transit: row.inTransit.toString(),
    observed_at: row.observedAt.toISOString(),
    source_version: row.sourceVersion,
    products: { external_id: row.product.externalId, name: row.product.name, unit: row.product.unit, unit_cost: row.product.unitCost.toString() },
    context_sources: { external_id: row.source.externalId, kind: row.source.kind },
  }));
  const sales: SaleRow[] = salesData.map((row) => ({
    id: row.id,
    external_event_id: row.externalEventId,
    quantity: row.quantity.toString(),
    unit_price: row.unitPrice.toString(),
    sold_at: row.soldAt.toISOString(),
    products: { external_id: row.product.externalId, name: row.product.name, unit: row.product.unit },
  }));
  const objective = objectiveData
    ? { target_stock_capital: objectiveData.targetStockCapital?.toString(), target_days_of_stock: objectiveData.targetDaysOfStock }
    : null;
  const latestInventory = inventory.filter(
    (row, index, rows) =>
      rows.findIndex(
        (candidate) =>
          candidate.products?.external_id === row.products?.external_id,
      ) === index,
  );
  const stockCapitalCents = latestInventory.reduce(
    (total, row) =>
      total +
      ((quantityToMicros(String(row.on_hand)) - quantityToMicros(String(row.reserved))) *
        moneyToCents(String(row.products?.unit_cost ?? "0"))) / 1_000_000n,
    0n,
  );
  const unitsSold = sales.reduce((total, sale) => total + Number(sale.quantity), 0);
  const targetCapital = String(objective?.target_stock_capital ?? "0");

  return (
    <main className="shell">
      <header className="topbar">
        <div><p className="eyebrow">Módulo de contexto</p><h1>{company.legal_name}</h1></div>
        <nav className="nav-links"><Link href="/">Inicio</Link><Link href="/protocol">Protocolo</Link></nav>
      </header>
      <section className="hero-copy">
        <h2>Datos privados que explican qué necesita el negocio.</h2>
        <p className="muted">La demo ya trae productos, stock y ventas del cliente. Estos datos no se comparten completos con los distribuidores.</p>
      </section>

      <section className="analytics-grid">
        <div><span>Capital actual en stock</span><strong>{formatArs(centsToMoney(stockCapitalCents))}</strong></div>
        <div><span>Objetivo de capital</span><strong>{formatArs(targetCapital)}</strong></div>
        <div><span>Unidades vendidas registradas</span><strong>{unitsSold}</strong></div>
        <div><span>Cobertura objetivo</span><strong>{String(objective?.target_days_of_stock ?? 14)} días</strong></div>
      </section>

      <section className="section-block">
        <p className="eyebrow">Inventario</p><h2>Registrar snapshot</h2>
        <InventoryForm companyId={company.id} />
      </section>
      <section className="section-block">
        <p className="eyebrow">Ventas</p><h2>Registrar evento</h2>
        <SaleForm companyId={company.id} />
      </section>

      <section className="section-block">
        <p className="eyebrow">Últimos datos</p><h2>Inventario recibido</h2>
        <div className="request-list">
          {latestInventory.length === 0 ? <p className="muted">Todavía no hay snapshots.</p> : latestInventory.map((row) => (
            <article className="request-card" key={row.id}>
              <h3>{row.products?.name ?? "Producto"}</h3>
              <p className="muted">{row.products?.external_id} · físico {String(row.on_hand)} · reservado {String(row.reserved)} · en tránsito {String(row.in_transit)} {row.products?.unit}</p>
              <code>{row.context_sources?.external_id} · {row.source_version} · {new Date(row.observed_at).toLocaleString("es-AR")}</code>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block">
        <p className="eyebrow">Historial</p><h2>Ventas recibidas</h2>
        <div className="request-list">
          {sales.length === 0 ? <p className="muted">Todavía no hay ventas.</p> : sales.map((row) => (
            <article className="request-card" key={row.id}>
              <h3>{row.products?.name ?? "Producto"}</h3>
              <p className="muted">{String(row.quantity)} {row.products?.unit} · ARS {String(row.unit_price)} por unidad</p>
              <code>{row.external_event_id} · {new Date(row.sold_at).toLocaleString("es-AR")}</code>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
