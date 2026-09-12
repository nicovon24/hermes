import { notFound } from "next/navigation";

import { BuyerOrderWorkspace } from "@/components/buyer-order-workspace";
import { ContextModal } from "@/components/context-modal";
import { SupplierOrderBook } from "@/components/supplier-order-book";
import { DEMO_BUYER_PRODUCT_CONTEXTS, DEMO_COMPANIES } from "@/lib/demo-workspace";
import { formatArs } from "@/lib/decimal";
import { prisma } from "@/lib/prisma";
import { buildConsolidatedPurchaseDraft } from "@/modules/context/replenishment";
import { listBuyerInTransit } from "@/modules/protocol/services/buyer-inventory";
import { listSupplierOrders } from "@/modules/protocol/services/supplier-orders";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type AccountPageProps = { params: Promise<{ companySlug: string }> };

type InventoryRow = {
  id: string;
  on_hand: string;
  reserved: string;
  in_transit: string;
  observed_at: string;
  products: { external_id: string; name: string; unit: string; unit_cost: string };
};

function money(value: string | number) {
  return formatArs(String(value));
}

const unitPlurals: Record<string, string> = { unidad: "unidades", caja: "cajas", bolsa: "bolsas", pack: "packs", bulto: "bultos", litro: "litros", kilo: "kilos", docena: "docenas" };
const unitPlural = (unit: string) => unitPlurals[unit.toLowerCase()] ?? unit;

export default async function AccountPage({ params }: AccountPageProps) {
  const { companySlug } = await params;
  const companyRow = DEMO_COMPANIES.find((candidate) => candidate.slug === companySlug);
  if (!companyRow) notFound();
  const company = { id: companyRow.id, slug: companyRow.slug, legal_name: companyRow.legalName, kind: companyRow.kind };

  if (company.kind === "BUYER") {
    const storefrontDraft = buildConsolidatedPurchaseDraft(DEMO_BUYER_PRODUCT_CONTEXTS);
    // The catalog is static on purpose, so a database outage only costs the
    // travelling units: the storefront still paints and the stream retries.
    const inTransit = await listBuyerInTransit(company.id).catch(() => []);
    return (
      <main className="shell company-workspace">
        <BuyerOrderWorkspace companyId={company.id} directOrder draft={storefrontDraft} initialInTransit={inTransit} />
      </main>
    );
  }

  // The distributor's desk starts at the order: what the shop bought, when it
  // has to leave, and whether it was paid. The negotiation itself stays with
  // the buyer; here only its outcome matters.
  const buyer = DEMO_COMPANIES.find((candidate) => candidate.kind === "BUYER");
  const [profileRow, inventoryRows, objectiveRow, ownRunRows, orders] = await Promise.all([
    prisma.companyProfile.findUnique({ where: { companyId: company.id } }),
    prisma.inventorySnapshot.findMany({ where: { companyId: company.id }, orderBy: { observedAt: "desc" }, distinct: ["productId"], include: { product: true } }),
    prisma.companyObjective.findUnique({ where: { companyId: company.id } }),
    prisma.agentRun.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    listSupplierOrders(company.id),
  ]);

  const inventory: InventoryRow[] = inventoryRows.map((row) => ({
    id: row.id,
    on_hand: row.onHand.toString(),
    reserved: row.reserved.toString(),
    in_transit: row.inTransit.toString(),
    observed_at: row.observedAt.toISOString(),
    products: { external_id: row.product.externalId, name: row.product.name, unit: row.product.unit, unit_cost: row.product.unitCost.toString() },
  }));
  const profile = profileRow
    ? { tax_id: profileRow.taxId, address_line: profileRow.addressLine, city: profileRow.city, province: profileRow.province, contact_name: profileRow.contactName, contact_email: profileRow.contactEmail, contact_phone: profileRow.contactPhone, delivery_area: profileRow.deliveryArea }
    : null;
  const availableUnits = inventory.reduce((sum, row) => sum + Number(row.on_hand) - Number(row.reserved), 0);
  const privateRuns = ownRunRows.map((run) => ({ id: run.id, kind: run.kind, model: run.model, input_snapshot: run.inputSnapshot, output: run.output, created_at: run.createdAt.toISOString() }));

  const contextSections = [
    {
      title: "Perfil comercial",
      description: "Datos propios de esta empresa y su operación.",
      metrics: [
        { label: "CUIT", value: profile?.tax_id ?? "—" },
        { label: "Dirección", value: profile ? `${profile.address_line}, ${profile.city}` : "—" },
        { label: "Contacto", value: profile ? `${profile.contact_name} · ${profile.contact_email}` : "—" },
        { label: "Teléfono", value: profile?.contact_phone ?? "—" },
        { label: "Zona de entrega", value: profile?.delivery_area ?? "—" },
        { label: "Provincia", value: profile?.province ?? "—" },
      ],
    },
    {
      title: "Objetivos comerciales",
      description: "Parámetros privados que usa el agente de esta empresa.",
      metrics: [
        { label: "Margen objetivo", value: `${String(objectiveRow?.targetMarginPercentage ?? 0)}%` },
        { label: "Rotación objetivo", value: `${String(objectiveRow?.targetRotationDays ?? 30)} días` },
        { label: "Stock disponible", value: `${availableUnits} unidades` },
      ],
    },
  ];

  return (
    <main className="shell company-workspace supplier-desk">
      <header className="supplier-head">
        <div>
          <h1>{company.legal_name}</h1>
          <p className="company-address">{profile ? `${profile.address_line}, ${profile.city}` : `/${company.slug}`}{profile?.delivery_area ? `. Entrega en ${profile.delivery_area}.` : ""}</p>
        </div>
        <ContextModal
          eyebrow="Datos de la empresa"
          sections={contextSections}
          snapshots={[
            { label: "Inventario y costos propios", data: inventory },
            { label: "Ejecuciones del agente de esta empresa", data: privateRuns },
          ]}
          subtitle="Lo que el agente de esta empresa sabe al negociar. No incluye datos de las otras empresas."
          title={company.legal_name}
          triggerLabel="Datos de mi empresa"
        />
      </header>

      <div className="workspace-section order-book-section" id="pedidos">
        <SupplierOrderBook
          buyerName={buyer?.legalName ?? "el comercio"}
          colorClass="party-buyer"
          companyId={company.id}
          initialOrders={orders}
        />
      </div>

      <section aria-labelledby="products-title" className="workspace-section" id="productos">
        <div className="section-heading">
          <div><h2 id="products-title">Stock y costos</h2></div>
        </div>
        <div className="offer-table-wrap">
          <table className="offer-table stock-table">
            <thead>
              <tr>
                <th scope="col">Producto</th>
                <th scope="col">Disponible</th>
                <th scope="col">Reservado</th>
                <th scope="col">En tránsito</th>
                <th scope="col">Costo unitario</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((row) => {
                const available = Number(row.on_hand) - Number(row.reserved);
                return (
                  <tr className={available <= 0 ? "is-empty" : ""} key={row.id}>
                    <th scope="row">{row.products.name}</th>
                    <td data-label="Disponible"><strong>{available.toLocaleString("es-AR")}</strong> {available === 1 ? row.products.unit : unitPlural(row.products.unit)}</td>
                    <td data-label="Reservado">{Number(row.reserved).toLocaleString("es-AR")}</td>
                    <td data-label="En tránsito">{Number(row.in_transit).toLocaleString("es-AR")}</td>
                    <td data-label="Costo unitario">{money(row.products.unit_cost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
