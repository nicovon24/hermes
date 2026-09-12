import Link from "next/link";
import { notFound } from "next/navigation";

import { BuyerOrderWorkspace } from "@/components/buyer-order-workspace";
import { ContextModal } from "@/components/context-modal";
import { ConversationModal } from "@/components/conversation-modal";
import { RetryPendingButton } from "@/components/retry-pending-button";
import { PaymentReviewForm } from "@/components/payment-review-form";
import { PayOrderButton } from "@/components/pay-order-button";
import {
  DEMO_BUYER_PRODUCT_CONTEXTS,
  DEMO_COMPANIES,
  getBuyerCompanyId,
} from "@/lib/demo-workspace";
import { centsToMoney, formatArs, moneyToCents } from "@/lib/decimal";
import { paymentEnvironmentAvailable } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { argtBaseUnitsToDisplay } from "@/modules/payments/domain";
import { getBuyerProductContexts } from "@/modules/context/analytics";
import { buildConsolidatedPurchaseDraft } from "@/modules/context/replenishment";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type AccountPageProps = { params: Promise<{ companySlug: string }> };
const paymentLabels: Record<string, string> = {
  PAYMENT_REQUESTED: "Pago solicitado", PAYMENT_AUTHORIZED: "Pago autorizado",
  PAYMENT_SUBMITTED: "Esperando confirmación", PAYMENT_CONFIRMED: "Pago confirmado", PAYMENT_FAILED: "Requiere revisión",
};

type InventoryRow = {
  id: string;
  on_hand: string | number;
  reserved: string | number;
  in_transit: string | number;
  observed_at: string;
  products: {
    external_id: string;
    name: string;
    unit: string;
    unit_cost: string | number;
  } | null;
};

type RequestItem = {
  id: string;
  product_id: string;
  description: string;
  unit: string;
  minimum_quantity: string | number;
  target_quantity: string | number;
  maximum_quantity: string | number;
  status: "PENDING" | "AWARDED";
  pending_reason: string | null;
};

type PurchaseRequest = {
  id: string;
  status: string;
  required_by: string;
  created_at: string;
  purchase_request_items: RequestItem[];
};

type Negotiation = {
  id: string;
  status: string;
  purchase_request_id: string;
  buyer_company_id: string;
  supplier_company_id: string;
  created_at: string;
};

type ProtocolMessageRow = {
  id: string;
  negotiation_id: string;
  message_type: string;
  sender_company_id: string;
  recipient_company_id: string;
  sent_at: string;
  payload: Record<string, unknown>;
  raw_message: Record<string, unknown>;
  tender_round_id: string | null;
};

type PurchaseOrder = {
  id: string;
  purchase_request_id: string;
  buyer_company_id: string;
  supplier_company_id: string;
  status: string;
  currency: string;
  total: string | number;
  delivery_date: string;
  payment_terms: string;
  external_reference: string;
  created_at: string;
  payment: {
    id: string;
    status: string;
    route: string;
    amount_base_units: string;
    tx_hash: string | null;
    last_error: string | null;
  } | null;
  purchase_order_items: Array<{
    id: string;
    product_id: string;
    description: string;
    unit: string;
    quantity: string | number;
    unit_price: string | number;
    total: string | number;
  }>;
};

type CompanyProfile = {
  tax_id: string;
  address_line: string;
  city: string;
  province: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  delivery_area: string;
};

const messageLabels: Record<string, string> = {
  request_for_quote: "Solicitud de cotización",
  offer: "Oferta inicial",
  counteroffer: "Contraoferta del comercio",
  final_offer: "Oferta final",
  purchase_order: "Pedido emitido",
  acceptance: "Adjudicación",
  rejection: "No adjudicada",
};

function money(value: string | number) {
  return formatArs(String(value));
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" }).format(new Date(value));
}

function payloadLines(payload: Record<string, unknown>) {
  return Array.isArray(payload.lines)
    ? (payload.lines as Array<Record<string, unknown>>)
    : [];
}

function payloadUnavailable(payload: Record<string, unknown>) {
  return Array.isArray(payload.unavailableItems)
    ? (payload.unavailableItems as Array<Record<string, unknown>>)
    : [];
}

function MessageCard({
  message,
  companyNames,
  buyerCompanyId,
}: {
  message: ProtocolMessageRow;
  companyNames: Map<string, string>;
  buyerCompanyId: string;
}) {
  const lines = payloadLines(message.payload);
  const unavailable = payloadUnavailable(message.payload);
  const items = Array.isArray(message.payload.items)
    ? (message.payload.items as Array<Record<string, unknown>>)
    : [];
  const isBuyer = message.sender_company_id === buyerCompanyId;
  return (
    <article className={`debate-message ${isBuyer ? "buyer-message" : "supplier-message"}`}>
      <div className="message-heading">
        <strong>{messageLabels[message.message_type] ?? message.message_type}</strong>
        <time dateTime={message.sent_at}>{shortDate(message.sent_at)}</time>
      </div>
      <p className="message-sender">{companyNames.get(message.sender_company_id) ?? "Empresa"}</p>
      {items.length > 0 ? <p className="message-notes">Se solicitaron {items.length} productos en esta ronda.</p> : null}
      {lines.length > 0 ? (
        <div className="message-line-list">
          {lines.map((line, index) => (
            <div key={`${String(line.productId)}-${index}`}>
              <span>{String(line.description ?? line.productId)}</span>
              <strong>{String(line.quantity)} × {money(String(line.unitPrice ?? 0))}</strong>
              {line.total ? <small>Total línea {money(String(line.total))}</small> : null}
            </div>
          ))}
        </div>
      ) : null}
      {unavailable.length > 0 ? (
        <div className="unavailable-list">
          {unavailable.map((line, index) => (
            <p key={`${String(line.productId)}-${index}`}><strong>Sin cobertura · {String(line.productId)}</strong><span>{String(line.reason)}</span></p>
          ))}
        </div>
      ) : null}
      {message.payload.total !== undefined ? (
        <dl className="message-facts">
          <div><dt>Total de la propuesta</dt><dd>{money(String(message.payload.total))}</dd></div>
          <div><dt>Entrega</dt><dd>{String(message.payload.deliveryDate ?? "—")}</dd></div>
        </dl>
      ) : null}
      {message.payload.notes ? <p className="message-notes">{String(message.payload.notes)}</p> : null}
      {message.message_type === "purchase_order" ? (
        <p className="feedback success">Orden {String(message.payload.externalReference ?? "creada")}</p>
      ) : null}
      <details className="message-raw">
        <summary>Ver mensaje completo del protocolo</summary>
        <pre>{JSON.stringify(message.raw_message, null, 2)}</pre>
      </details>
    </article>
  );
}

export default async function AccountPage({ params }: AccountPageProps) {
  const { companySlug } = await params;
  const companyRow = DEMO_COMPANIES.find((candidate) => candidate.slug === companySlug);
  if (!companyRow) notFound();
  const company = { id: companyRow.id, slug: companyRow.slug, legal_name: companyRow.legalName, kind: companyRow.kind };

  const isBuyer = company.kind === "BUYER";
  if (isBuyer) {
    const storefrontDraft = buildConsolidatedPurchaseDraft(
      DEMO_BUYER_PRODUCT_CONTEXTS,
    );

    return (
      <main className="shell company-workspace">
        <BuyerOrderWorkspace
          companyId={company.id}
          directOrder
          draft={storefrontDraft}
        />
      </main>
    );
  }

  const paymentAvailable = paymentEnvironmentAvailable();
  const buyerCompanyId = getBuyerCompanyId();
  const [profileRow, inventoryRows, objectiveRow, negotiationRows, orderRows, ownRunRows, requestRows, messageRows, buyerContexts] = await Promise.all([
    prisma.companyProfile.findUnique({ where: { companyId: company.id } }),
    prisma.inventorySnapshot.findMany({ where: { companyId: company.id }, orderBy: { observedAt: "desc" }, distinct: ["productId"], include: { product: true } }),
    prisma.companyObjective.findUnique({ where: { companyId: company.id } }),
    prisma.negotiation.findMany({ where: isBuyer ? { buyerCompanyId: company.id } : { supplierCompanyId: company.id }, orderBy: { createdAt: "desc" }, take: 90 }),
    prisma.purchaseOrder.findMany({ where: isBuyer ? { buyerCompanyId: company.id } : { supplierCompanyId: company.id }, orderBy: { createdAt: "desc" }, take: 30, include: { items: true, payment: true } }),
    prisma.agentRun.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.purchaseRequest.findMany({
      where: isBuyer ? { buyerCompanyId: company.id } : { negotiations: { some: { supplierCompanyId: company.id } } },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { items: true },
    }),
    prisma.negotiationMessage.findMany({
      where: { negotiation: isBuyer ? { buyerCompanyId: company.id } : { supplierCompanyId: company.id } },
      orderBy: { sentAt: "desc" },
      take: 300,
    }),
    isBuyer ? getBuyerProductContexts(company.id) : Promise.resolve([]),
  ]);

  const allInventory: InventoryRow[] = inventoryRows.map((row) => ({
    id: row.id,
    on_hand: row.onHand.toString(),
    reserved: row.reserved.toString(),
    in_transit: row.inTransit.toString(),
    observed_at: row.observedAt.toISOString(),
    products: { external_id: row.product.externalId, name: row.product.name, unit: row.product.unit, unit_cost: row.product.unitCost.toString() },
  }));
  const inventory = allInventory.filter(
    (row, index, rows) =>
      rows.findIndex((candidate) => candidate.products?.external_id === row.products?.external_id) === index,
  );
  const negotiations: Negotiation[] = negotiationRows.map((row) => ({ id: row.id, status: row.status, purchase_request_id: row.purchaseRequestId, buyer_company_id: row.buyerCompanyId, supplier_company_id: row.supplierCompanyId, created_at: row.createdAt.toISOString() }));
  const requests: PurchaseRequest[] = requestRows.map((row) => ({ id: row.id, status: row.status, required_by: row.requiredBy.toISOString().slice(0, 10), created_at: row.createdAt.toISOString(), purchase_request_items: row.items.map((item) => ({ id: item.id, product_id: item.productId, description: item.description, unit: item.unit, minimum_quantity: item.minimumQuantity.toString(), target_quantity: item.targetQuantity.toString(), maximum_quantity: item.maximumQuantity.toString(), status: item.status as "PENDING" | "AWARDED", pending_reason: item.pendingReason })) }));
  const messages: ProtocolMessageRow[] = messageRows.map((row) => ({ id: row.id, negotiation_id: row.negotiationId, message_type: row.messageType, sender_company_id: row.senderCompanyId, recipient_company_id: row.recipientCompanyId, sent_at: row.sentAt.toISOString(), payload: row.payload as Record<string, unknown>, raw_message: row.rawMessage as Record<string, unknown>, tender_round_id: row.tenderRoundId }));
  const orders: PurchaseOrder[] = orderRows.map((row) => ({
    id: row.id, purchase_request_id: row.purchaseRequestId, buyer_company_id: row.buyerCompanyId, supplier_company_id: row.supplierCompanyId, status: row.status, currency: row.currency, total: row.total.toString(), delivery_date: row.deliveryDate.toISOString().slice(0, 10), payment_terms: row.paymentTerms, external_reference: row.externalReference, created_at: row.createdAt.toISOString(),
    payment: row.payment ? { id: row.payment.id, status: row.payment.status, route: row.payment.route, amount_base_units: row.payment.amountBaseUnits, tx_hash: row.payment.txHash, last_error: row.payment.lastError } : null,
    purchase_order_items: row.items.map((item) => ({ id: item.id, product_id: item.productId, description: item.description, unit: item.unit, quantity: item.quantity.toString(), unit_price: item.unitPrice.toString(), total: item.total.toString() })),
  }));
  const profile: CompanyProfile | null = profileRow ? { tax_id: profileRow.taxId, address_line: profileRow.addressLine, city: profileRow.city, province: profileRow.province, contact_name: profileRow.contactName, contact_email: profileRow.contactEmail, contact_phone: profileRow.contactPhone, delivery_area: profileRow.deliveryArea } : null;
  const companyNames = new Map<string, string>(
    DEMO_COMPANIES.map((row) => [row.id, row.legalName]),
  );

  const openRequestStates = new Set([
    "AWAITING_APPROVAL",
    "APPROVED",
    "NEGOTIATING",
    "PARTIALLY_ORDERED",
    "ORDER_CREATED",
    "PAYMENT_PENDING",
    "PAYMENT_REVIEW_REQUIRED",
  ]);
  const openProductIds = requests
    .filter((request) => openRequestStates.has(request.status))
    .flatMap((request) => request.purchase_request_items.map((item) => item.product_id));
  const consolidatedDraft = isBuyer
    ? buildConsolidatedPurchaseDraft(buyerContexts, openProductIds)
    : null;
  const availableUnits = inventory.reduce(
    (sum, row) => sum + Number(row.on_hand) - Number(row.reserved),
    0,
  );
  const pendingLines = requests
    .filter((request) => openRequestStates.has(request.status))
    .flatMap((request) => request.purchase_request_items)
    .filter((item) => item.status === "PENDING").length;
  const objective = objectiveRow ? { target_stock_capital: objectiveRow.targetStockCapital?.toString(), target_days_of_stock: objectiveRow.targetDaysOfStock, target_margin_percentage: objectiveRow.targetMarginPercentage?.toString(), target_rotation_days: objectiveRow.targetRotationDays } : null;
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
      title: isBuyer ? "Objetivos de compra" : "Objetivos comerciales",
      description: "Parámetros privados que usa el agente de esta empresa.",
      metrics: isBuyer
        ? [
            { label: "Días de stock objetivo", value: `${String(objective?.target_days_of_stock ?? 14)} días` },
            { label: "Capital objetivo", value: money(String(objective?.target_stock_capital ?? 0)) },
            { label: "Líneas pendientes", value: String(pendingLines) },
          ]
        : [
            { label: "Margen objetivo", value: `${String(objective?.target_margin_percentage ?? 0)}%` },
            { label: "Rotación objetivo", value: `${String(objective?.target_rotation_days ?? 30)} días` },
            { label: "Stock disponible", value: `${availableUnits} unidades` },
          ],
    },
  ];

  return (
    <main className="shell company-workspace">
      {!isBuyer ? <>
        <header className="topbar workspace-topbar">
          <div>
            <p className="eyebrow">Supervisión del distribuidor</p>
            <h1>{company.legal_name}</h1>
            <p className="company-address">{profile ? `${profile.address_line} · ${profile.city}, ${profile.province}` : `/${company.slug}`}</p>
          </div>
          <nav aria-label="Navegación general" className="nav-links">
            <Link href="/">Empresas</Link>
            <Link href="/protocol">Auditoría global</Link>
          </nav>
        </header>

        <nav aria-label="Secciones de la empresa" className="workspace-tabs">
          <a href="#resumen">Resumen</a>
          <a href="#productos">Productos</a>
          <a href="#pedidos">Pedidos</a>
          <a href="#negociaciones">Negociaciones</a>
        </nav>

        <section className="workspace-hero" id="resumen">
          <div>
            <p className="eyebrow">/{company.slug}</p>
            <h2>Tu próxima venta, más cerca.</h2>
            <p className="muted">Tus condiciones, tus propuestas y cada pedido en un mismo espacio. Vos tenés la última palabra.</p>
            <ContextModal
              eyebrow="Contexto privado del agente"
              sections={contextSections}
              snapshots={[
                { label: "Inventario y costos propios", data: inventory },
                { label: "Ejecuciones del agente de esta empresa", data: privateRuns },
              ]}
              subtitle="Este es exactamente el contexto propio que esta perspectiva puede consultar. No incluye la información privada de las contrapartes."
              title={company.legal_name}
              triggerLabel="Ver contexto privado completo"
            />
          </div>
          <div className="workspace-metrics">
            <div><span>Productos</span><strong>{inventory.length}</strong><small>con stock vigente</small></div>
            <div><span>Licitaciones</span><strong>{requests.length}</strong><small>{pendingLines} líneas pendientes</small></div>
            <div><span>Pedidos</span><strong>{orders.length}</strong><small>{money(centsToMoney(orders.reduce((sum, order) => sum + moneyToCents(String(order.total)), 0n)))}</small></div>
          </div>
        </section>
      </> : null}

      {isBuyer && consolidatedDraft ? (
        <BuyerOrderWorkspace companyId={company.id} directOrder draft={consolidatedDraft} />
      ) : (
        <section aria-labelledby="products-title" className="workspace-section" id="productos">
          <div className="section-heading"><div><p className="eyebrow">Catálogo privado</p><h2 id="products-title">Inventario y costos propios</h2></div><span className="status">SÓLO SUPERVISIÓN</span></div>
          <div className="product-catalog-grid">
            {inventory.map((row) => (
              <article className="product-catalog-card" key={row.id}>
                <span className="product-code">{row.products?.external_id}</span>
                <h3>{row.products?.name}</h3>
                <p className="stock-number">{Number(row.on_hand) - Number(row.reserved)} <small>{row.products?.unit} disponibles</small></p>
                <div className="product-stats"><span>Costo <strong>{money(row.products?.unit_cost ?? 0)}</strong></span><span>Reservado <strong>{String(row.reserved)}</strong></span><span>En tránsito <strong>{String(row.in_transit)}</strong></span></div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="orders-title" className="workspace-section" id="pedidos">
        <div className="section-heading"><div><p className="eyebrow">Órdenes generadas</p><h2 id="orders-title">Pedidos de {company.legal_name}</h2></div><span className="status">{orders.length} PEDIDOS</span></div>
        {orders.length === 0 ? <div className="empty-inline"><strong>Todavía no hay órdenes creadas.</strong><span>Aparecerán aquí después de adjudicar las ofertas finales.</span></div> : null}
        <div className="order-grid">
          {orders.map((order) => (
            <article className="purchase-order-card" key={order.id}>
              <div className="request-header"><div><span className="product-code">{order.external_reference}</span><h3>{isBuyer ? companyNames.get(order.supplier_company_id) : companyNames.get(order.buyer_company_id)}</h3></div><span className="status success">{order.status}</span></div>
              <div className="order-lines">
                {order.purchase_order_items.map((item) => <div key={item.id}><span>{item.description}</span><strong>{String(item.quantity)} {item.unit}</strong><small>{money(item.total)}</small></div>)}
              </div>
              <footer><span>Entrega {order.delivery_date}</span><strong>{money(order.total)}</strong></footer>
              {order.payment ? (
                <div className={`payment-summary ${order.payment.status === "PAYMENT_CONFIRMED" ? "payment-confirmed" : order.payment.status === "PAYMENT_FAILED" ? "payment-failed" : "payment-pending"}`}>
                  <strong>{paymentLabels[order.payment.status] ?? order.payment.status}</strong>
                  <span>{argtBaseUnitsToDisplay(order.payment.amount_base_units)} ARGt</span>
                  <span>{order.payment.route === "SOLANA_TO_ARBITRUM" ? "Solana → Arbitrum" : "Arbitrum directo"}</span>
                  {order.payment.tx_hash ? <a href={`https://arbiscan.io/tx/${order.payment.tx_hash}`} rel="noreferrer" target="_blank">Ver en Arbiscan</a> : null}
                  {order.payment.last_error ? <details><summary>Ver motivo</summary><small>{order.payment.last_error}</small></details> : null}
                </div>
              ) : isBuyer ? (
                <PayOrderButton
                  buyerCompanyId={company.id}
                  paymentAvailable={paymentAvailable}
                  purchaseOrderId={order.id}
                />
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="negotiations-title" className="workspace-section" id="negociaciones">
        <div className="section-heading"><div><p className="eyebrow">Conversación compartida</p><h2 id="negotiations-title">Negociaciones y estado por línea</h2></div><span className="status">{negotiations.length} CONVERSACIONES</span></div>
        {requests.length === 0 ? <div className="empty-inline"><strong>No hay negociaciones todavía.</strong><span>El agente responderá automáticamente cuando se envíe el primer pedido.</span></div> : null}
        <div className="request-list">
          {requests.map((request) => {
            const requestNegotiations = negotiations.filter((negotiation) => negotiation.purchase_request_id === request.id);
            const requestOrders = orders.filter((order) => order.purchase_request_id === request.id);
            return (
              <article className="request-card request-workspace-card" key={request.id}>
                <div className="request-header">
                  <div><span className="product-code">Solicitud {request.id.slice(0, 8)}</span><h3>{request.purchase_request_items.map((item) => item.description).join(" · ")}</h3><p className="muted">Creada {shortDate(request.created_at)} · entrega {request.required_by}</p></div>
                  <span className={`status ${request.status === "PARTIALLY_ORDERED" ? "warning" : ""}`}>{request.status}</span>
                </div>
                <div className="request-line-statuses">
                  {request.purchase_request_items.map((item) => {
                    const resultingOrder = requestOrders.find((order) => order.purchase_order_items.some((orderItem) => orderItem.product_id === item.product_id));
                    const historicalOnly = request.status === "RECOMMENDED" && requestOrders.length === 0;
                    return <div key={item.id}><span><strong>{item.description}</strong><small>{String(item.target_quantity)} {item.unit}</small></span><span className={`line-state ${item.status === "AWARDED" ? "awarded" : "pending"}`}>{item.status === "AWARDED" ? resultingOrder ? `Adjudicado · ${resultingOrder.external_reference}` : isBuyer ? "Adjudicado · pedido creado" : "Adjudicado a otro distribuidor" : historicalOnly ? "Histórico · sin pedido retroactivo" : `Pendiente · ${item.pending_reason ?? "en negociación"}`}</span></div>;
                  })}
                </div>
                {isBuyer && request.status === "PARTIALLY_ORDERED" ? <RetryPendingButton buyerCompanyId={company.id} purchaseRequestId={request.id} /> : null}
                {isBuyer && request.status === "PAYMENT_REVIEW_REQUIRED" ? (
                  <PaymentReviewForm
                    companyId={company.id}
                    failedPayments={requestOrders.flatMap((order) => order.payment?.status === "PAYMENT_FAILED" ? [{ id: order.payment.id, label: order.external_reference }] : [])}
                    purchaseRequestId={request.id}
                  />
                ) : null}
                <div className="negotiation-grid">
                  {requestNegotiations.map((negotiation) => {
                    const conversation = messages.filter((message) => message.negotiation_id === negotiation.id);
                    const finalMessage = [...conversation].reverse().find((message) => message.message_type === "final_offer");
                    const counterpartId = isBuyer ? negotiation.supplier_company_id : negotiation.buyer_company_id;
                    return (
                      <div className="negotiation-card" key={negotiation.id}>
                        <div className="request-header"><div><span className="product-code">{isBuyer ? "Distribuidor" : "Comercio"}</span><h3>{companyNames.get(counterpartId) ?? "Empresa"}</h3></div><span className="status">{negotiation.status}</span></div>
                        <p className={finalMessage ? "final-offer-label" : "pending-offer-label"}>{finalMessage ? `OFERTA FINAL · ${money(String(finalMessage.payload.total ?? 0))}` : "OFERTA FINAL PENDIENTE"}</p>
                        <ConversationModal
                          finalOfferTotal={finalMessage ? money(String(finalMessage.payload.total ?? 0)) : undefined}
                          messageCount={conversation.length}
                          productName={`${request.purchase_request_items.length} productos · solicitud ${request.id.slice(0, 8)}`}
                          supplierName={companyNames.get(negotiation.supplier_company_id) ?? "Distribuidor"}
                        >
                          <div className="conversation-thread">
                            {conversation.map((message) => <MessageCard buyerCompanyId={buyerCompanyId} companyNames={companyNames} key={message.id} message={message} />)}
                          </div>
                        </ConversationModal>
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
