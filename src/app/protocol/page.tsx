import Link from "next/link";

import { ApproveRequestForm } from "@/components/approve-request-form";
import { BuyerOrderWorkspace } from "@/components/buyer-order-workspace";
import { ConversationModal } from "@/components/conversation-modal";
import {
  ContextModal,
  type ContextSection,
  type ContextSnapshot,
} from "@/components/context-modal";
import { RecommendationButton } from "@/components/recommendation-button";
import { TenderAgentsButton } from "@/components/tender-agents-button";
import { PaymentReviewForm } from "@/components/payment-review-form";
import {
  DEMO_SUPPLIER_COMPANY_IDS,
  getBuyerCompanyId,
} from "@/lib/demo-workspace";
import { centsToMoney, formatArs, moneyToCents } from "@/lib/decimal";
import { prisma } from "@/lib/prisma";
import { argtBaseUnitsToDisplay } from "@/modules/payments/domain";
import {
  getBuyerProductContexts,
  getSupplierProductContexts,
} from "@/modules/context/analytics";
import { buildConsolidatedPurchaseDraft } from "@/modules/context/replenishment";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Supplier = {
  id: string;
  slug: string;
  legal_name: string;
};

type SupplierInventoryRow = {
  company_id: string;
  on_hand: string | number;
  reserved: string | number;
  in_transit: string | number;
  observed_at: string;
  products: {
    external_id: string;
    name: string;
    unit: string;
  } | null;
};

type RequestRow = {
  id: string;
  status: string;
  required_by: string;
  expires_at: string;
  created_at: string;
  mandates: Array<{
    id: string;
    maximum_total_including_fees: string | number;
    payment_terms: string;
    settlement_asset: string;
    auto_accept: boolean;
    auto_pay: boolean;
    status: string;
    expires_at: string;
  }>;
  purchase_request_items: Array<{
    id: string;
    product_id: string;
    description: string;
    minimum_quantity: string | number;
    target_quantity: string | number;
    maximum_quantity: string | number;
    unit: string;
    status?: "PENDING" | "AWARDED";
    pending_reason?: string | null;
  }>;
  purchase_orders: Array<{
    id: string;
    supplier_company_id: string;
    external_reference: string;
    total: string | number;
    delivery_date: string;
    status: string;
    payment: {
      id: string;
      status: string;
      amount_base_units: string;
      tx_hash: string | null;
      last_error: string | null;
    } | null;
    purchase_order_items: Array<{
      id: string;
      description: string;
      quantity: string | number;
      unit: string;
      total: string | number;
    }>;
  }>;
  negotiations: Array<{
    id: string;
    supplier_company_id: string;
    status: string;
    offers: Array<{
      id: string;
      total: string | number;
      valid_until: string;
      confirmed_stock: boolean;
      status: string;
      payload: Record<string, unknown>;
    }>;
    negotiation_messages: Array<{
      id: string;
      message_type: string;
      sender_company_id: string;
      sent_at: string;
      payload: Record<string, unknown>;
      raw_message: Record<string, unknown>;
    }>;
    negotiation_metrics:
      | {
          rounds: number;
          message_count: number;
          initial_total: string | number;
          final_total: string | number;
          price_reduction_percentage: string | number;
          estimated_margin_percentage: string | number;
          capital_efficiency_score: string | number;
          duration_ms: number;
        }
      | Array<{
      rounds: number;
      message_count: number;
      initial_total: string | number;
      final_total: string | number;
      price_reduction_percentage: string | number;
      estimated_margin_percentage: string | number;
      capital_efficiency_score: string | number;
      duration_ms: number;
        }>
      | null;
  }>;
  agent_runs: Array<{
    id: string;
    company_id: string;
    kind: string;
    model: string;
    status: string;
    input_snapshot: Record<string, unknown>;
    output: Record<string, unknown>;
    created_at: string;
  }>;
};

type RequestItem = RequestRow["purchase_request_items"][number];
type Mandate = RequestRow["mandates"][number];
type BuyerContext = Awaited<ReturnType<typeof getBuyerProductContexts>>[number];
type SupplierContext = Awaited<ReturnType<typeof getSupplierProductContexts>>[number];

type NegotiationMetric = NonNullable<
  Exclude<
    RequestRow["negotiations"][number]["negotiation_metrics"],
    Array<unknown>
  >
>;

function getNegotiationMetric(
  negotiation: RequestRow["negotiations"][number],
): NegotiationMetric | undefined {
  const metric = negotiation.negotiation_metrics;
  if (Array.isArray(metric)) return metric[0];
  return metric ?? undefined;
}

const messageLabels: Record<string, string> = {
  request_for_quote: "Licitación enviada por el comprador",
  offer: "Oferta inicial del vendedor",
  counteroffer: "Contraoferta del comprador",
  final_offer: "Oferta final del vendedor",
};

const numberFormatter = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 2,
});
const dateTimeFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Cordoba",
});

function formatNumber(value: string | number) {
  return numberFormatter.format(Number(value));
}

function formatMoney(value: string | number) {
  return formatArs(String(value));
}

function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function displayValue(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

function getMessageFacts(payload: Record<string, unknown>) {
  const facts: Array<{ label: string; value: string }> = [];
  const items = Array.isArray(payload.items)
    ? payload.items
        .map(recordValue)
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  const lines = Array.isArray(payload.lines)
    ? payload.lines
        .map(recordValue)
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  const unavailableItems = Array.isArray(payload.unavailableItems)
    ? payload.unavailableItems
    : [];
  const item = items[0] ?? null;
  const line = lines[0] ?? null;
  const product = line ?? item;

  if (items.length > 1) facts.push({ label: "Productos solicitados", value: String(items.length) });
  if (lines.length > 0) facts.push({ label: "Productos cotizados", value: String(lines.length) });
  if (unavailableItems.length > 0) {
    facts.push({ label: "Productos sin cobertura", value: String(unavailableItems.length) });
  }
  if (product) {
    const productName = displayValue(product.description);
    const productId = displayValue(product.productId);
    if (productName || productId) {
      facts.push({ label: lines.length + items.length > 1 ? "Primera línea" : "Producto", value: productName ?? productId! });
    }
  }
  if (line) {
    const quantity = displayValue(line.quantity);
    const unitPrice = displayValue(line.unitPrice);
    const lineTotal = displayValue(line.lineTotal);
    if (quantity) facts.push({ label: "Cantidad", value: quantity });
    if (unitPrice) facts.push({ label: "Precio unitario", value: formatMoney(unitPrice) });
    if (lineTotal) facts.push({ label: "Total de línea", value: formatMoney(lineTotal) });
  } else if (item) {
    const minimum = displayValue(item.minimumQuantity);
    const target = displayValue(item.targetQuantity);
    const maximum = displayValue(item.maximumQuantity);
    if (minimum) facts.push({ label: "Cantidad mínima", value: minimum });
    if (target) facts.push({ label: "Cantidad objetivo", value: target });
    if (maximum) facts.push({ label: "Cantidad máxima", value: maximum });
  }

  for (const [key, label] of [
    ["subtotal", "Subtotal"],
    ["taxes", "Impuestos"],
    ["shipping", "Envío"],
    ["discount", "Descuento"],
    ["total", "Total"],
  ] as const) {
    const value = displayValue(payload[key]);
    if (value) facts.push({ label, value: formatMoney(value) });
  }

  const deliveryDate = displayValue(payload.deliveryDate ?? payload.requiredBy);
  const paymentTerms = displayValue(payload.paymentTerms);
  const validUntil = displayValue(payload.validUntil);
  if (deliveryDate) facts.push({ label: "Entrega", value: deliveryDate });
  if (paymentTerms) facts.push({ label: "Pago", value: paymentTerms });
  if (typeof payload.confirmedStock === "boolean") {
    facts.push({
      label: "Stock confirmado",
      value: payload.confirmedStock ? "Sí" : "No",
    });
  }
  if (validUntil) facts.push({ label: "Oferta válida hasta", value: formatDateTime(validUntil) });
  return facts;
}

function buyerContextSections(
  entries: Array<{ context: BuyerContext; item: RequestItem }>,
  mandate?: Mandate,
): ContextSection[] {
  return [
    {
      title: "Pedido y mandato",
      description: "Límites humanos que el agente no puede superar.",
      metrics: [
        { label: "Productos", value: String(entries.length) },
        { label: "Presupuesto máximo", value: mandate ? formatMoney(mandate.maximum_total_including_fees) : "Sin mandato" },
        { label: "Condición de pago", value: mandate?.payment_terms ?? "Sin mandato" },
      ],
    },
    ...entries.map(({ context, item }) => ({
      title: item.description,
      description: "Contexto privado utilizado para medir cobertura y capital inmovilizado.",
      metrics: [
        { label: "Cantidad objetivo", value: `${formatNumber(item.target_quantity)} ${item.unit}` },
        { label: "Stock disponible", value: `${formatNumber(context.availableStock)} ${context.unit}` },
        { label: "En tránsito", value: `${formatNumber(context.inTransit)} ${context.unit}` },
        { label: "Días objetivo", value: `${formatNumber(context.targetDaysOfStock)} días` },
        { label: "Compra sugerida", value: `${formatNumber(context.suggestedPurchaseQuantity)} ${context.unit}` },
        { label: "Ventas últimos 30 días", value: `${formatNumber(context.unitsSoldLast30Days)} ${context.unit}` },
        { label: "Tendencia", value: `${formatNumber(context.salesTrendPercentage)}%` },
      ],
    })),
  ];
}

function supplierContextSections(contexts: SupplierContext[]): ContextSection[] {
  return contexts.flatMap((context) => [
    {
      title: `${context.productName} · inventario y costo`,
      description: "Datos privados del distribuidor; no se comparten con sus competidores.",
      metrics: [
        { label: "Stock disponible", value: `${formatNumber(context.availableStock)} ${context.unit}` },
        { label: "En tránsito", value: `${formatNumber(context.inTransit)} ${context.unit}` },
        { label: "Costo unitario", value: formatMoney(context.unitCost) },
        { label: "Margen objetivo", value: `${formatNumber(context.targetMarginPercentage)}%` },
        { label: "Rotación objetivo", value: `${formatNumber(context.targetRotationDays)} días` },
      ],
    },
    {
      title: `${context.productName} · relación con el comercio`,
      description: "Historial exclusivo de este distribuidor con el cliente comprador.",
      metrics: [
        { label: "Unidades históricas", value: `${formatNumber(context.unitsSoldToClient)} ${context.unit}` },
        { label: "Precio histórico promedio", value: formatMoney(context.averageHistoricalUnitPrice) },
        { label: "Últimos 45 días", value: `${formatNumber(context.recentUnitsSoldToClient)} ${context.unit}` },
        { label: "45 días anteriores", value: `${formatNumber(context.previousUnitsSoldToClient)} ${context.unit}` },
        { label: "Tendencia", value: `${formatNumber(context.salesTrendPercentage)}%` },
      ],
    },
  ]);
}

export default async function ProtocolPage() {
  const buyerCompanyId = getBuyerCompanyId();
  const [companyRow, supplierRows, requestRows, inventoryRows] = await Promise.all([
    prisma.company.findUniqueOrThrow({
      where: { id: buyerCompanyId },
      select: { id: true, legalName: true, kind: true },
    }),
    prisma.company.findMany({ where: { kind: "SUPPLIER" }, orderBy: { legalName: "asc" } }),
    prisma.purchaseRequest.findMany({
      where: { buyerCompanyId },
      orderBy: { createdAt: "desc" },
      include: {
        mandates: true,
        items: true,
        purchaseOrders: { include: { items: true, payment: true } },
        negotiations: { include: { offers: true, messages: true, metric: true } },
        agentRuns: true,
      },
    }),
    prisma.inventorySnapshot.findMany({
      where: { companyId: { in: [...DEMO_SUPPLIER_COMPANY_IDS] } },
      orderBy: { observedAt: "desc" },
      include: { product: true },
    }),
  ]);
  const company = {
    id: companyRow.id,
    legal_name: companyRow.legalName,
    kind: companyRow.kind as "BUYER",
  };
  const suppliers: Supplier[] = supplierRows.map((supplier) => ({ id: supplier.id, slug: supplier.slug, legal_name: supplier.legalName }));
  const supplierInventory: SupplierInventoryRow[] = inventoryRows.map((row) => ({
    company_id: row.companyId,
    on_hand: row.onHand.toString(),
    reserved: row.reserved.toString(),
    in_transit: row.inTransit.toString(),
    observed_at: row.observedAt.toISOString(),
    products: { external_id: row.product.externalId, name: row.product.name, unit: row.product.unit },
  }));
  const latestInventory = supplierInventory.filter(
    (row, index, rows) =>
      rows.findIndex(
        (candidate) =>
          candidate.company_id === row.company_id &&
          candidate.products?.external_id === row.products?.external_id,
      ) === index,
  );
  const productOptions = Array.from(
    new Map(
      latestInventory
        .filter((row) => row.products)
        .map((row) => [
          row.products!.external_id,
          {
            externalId: row.products!.external_id,
            name: row.products!.name,
            unit: row.products!.unit,
          },
        ]),
    ).values(),
  );

  const requests: RequestRow[] = requestRows.map((request) => ({
    id: request.id,
    status: request.status,
    required_by: request.requiredBy.toISOString().slice(0, 10),
    expires_at: request.expiresAt.toISOString(),
    created_at: request.createdAt.toISOString(),
    mandates: request.mandates.map((mandate) => ({ id: mandate.id, maximum_total_including_fees: mandate.maximumTotalIncludingFees.toString(), payment_terms: mandate.paymentTerms, settlement_asset: mandate.settlementAsset, auto_accept: mandate.autoAccept, auto_pay: mandate.autoPay, status: mandate.status, expires_at: mandate.expiresAt.toISOString() })),
    purchase_request_items: request.items.map((item) => ({ id: item.id, product_id: item.productId, description: item.description, minimum_quantity: item.minimumQuantity.toString(), target_quantity: item.targetQuantity.toString(), maximum_quantity: item.maximumQuantity.toString(), unit: item.unit, status: item.status as "PENDING" | "AWARDED", pending_reason: item.pendingReason })),
    purchase_orders: request.purchaseOrders.map((order) => ({
      id: order.id, supplier_company_id: order.supplierCompanyId, external_reference: order.externalReference, total: order.total.toString(), delivery_date: order.deliveryDate.toISOString().slice(0, 10), status: order.status,
      payment: order.payment ? { id: order.payment.id, status: order.payment.status, amount_base_units: order.payment.amountBaseUnits, tx_hash: order.payment.txHash, last_error: order.payment.lastError } : null,
      purchase_order_items: order.items.map((item) => ({ id: item.id, description: item.description, quantity: item.quantity.toString(), unit: item.unit, total: item.total.toString() })),
    })),
    negotiations: request.negotiations.map((negotiation) => ({
      id: negotiation.id, supplier_company_id: negotiation.supplierCompanyId, status: negotiation.status,
      offers: negotiation.offers.map((offer) => ({ id: offer.id, total: offer.total.toString(), valid_until: offer.validUntil.toISOString(), confirmed_stock: offer.confirmedStock, status: offer.status, payload: offer.payload as Record<string, unknown> })),
      negotiation_messages: negotiation.messages.map((message) => ({ id: message.id, message_type: message.messageType, sender_company_id: message.senderCompanyId, sent_at: message.sentAt.toISOString(), payload: message.payload as Record<string, unknown>, raw_message: message.rawMessage as Record<string, unknown> })),
      negotiation_metrics: negotiation.metric ? { rounds: negotiation.metric.rounds, message_count: negotiation.metric.messageCount, initial_total: negotiation.metric.initialTotal.toString(), final_total: negotiation.metric.finalTotal.toString(), price_reduction_percentage: negotiation.metric.priceReductionPercentage.toString(), estimated_margin_percentage: negotiation.metric.estimatedMarginPercentage.toString(), capital_efficiency_score: negotiation.metric.capitalEfficiencyScore.toString(), duration_ms: negotiation.metric.durationMs } : null,
    })),
    agent_runs: request.agentRuns.map((run) => ({ id: run.id, company_id: run.companyId, kind: run.kind, model: run.model, status: run.status, input_snapshot: run.inputSnapshot as Record<string, unknown>, output: run.output as Record<string, unknown>, created_at: run.createdAt.toISOString() })),
  }));
  const openStatuses = new Set([
    "DRAFT",
    "AWAITING_APPROVAL",
    "APPROVED",
    "NEGOTIATING",
    "POLICY_VALIDATED",
    "FUNDS_RESERVED",
    "OFFER_ACCEPTED",
    "ORDER_CREATED",
    "PAYMENT_PENDING",
    "PAYMENT_CONFIRMED",
    "PAYMENT_REVIEW_REQUIRED",
  ]);
  const productsWithOpenOrders = new Set(
    requests
      .filter((request) => openStatuses.has(request.status))
      .flatMap((request) =>
        request.purchase_request_items.map((item) => item.product_id),
      ),
  );
  const requestProductIds = Array.from(
    new Set(
      requests.flatMap((request) =>
        request.purchase_request_items.map((item) => item.product_id),
      ),
    ),
  );
  const [allBuyerContexts, supplierContextEntries] = await Promise.all([
    getBuyerProductContexts(
      company.id,
      productOptions.map((product) => product.externalId),
    ),
    getSupplierProductContexts(
      suppliers.map((supplier) => supplier.id),
      company.id,
      requestProductIds,
    ),
  ]);
  const buyerContextByProduct = new Map(
    allBuyerContexts.map((context) => [context.productId, context]),
  );
  const supplierContextByCompanyAndProduct = new Map(
    supplierContextEntries.map((context) => [
      `${context.companyId}:${context.productId}`,
      context,
    ]),
  );
  const consolidatedDraft = buildConsolidatedPurchaseDraft(
    allBuyerContexts,
    productsWithOpenOrders,
  );
  const automaticDraftCount = consolidatedDraft.products.filter(
    (product) => product.automaticallySelected,
  ).length;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Cliente activo · demo sin login</p>
          <h1>{company.legal_name}</h1>
        </div>
        <nav className="nav-links"><Link href="/">Inicio</Link><Link href="/context">Contexto</Link></nav>
      </header>

      <section className="hero-grid">
        <div>
          <p className="eyebrow">Control operativo</p>
          <h2>Compras con mandato, trazabilidad e idempotencia.</h2>
          <p className="muted">
            El agente comprador detecta la necesidad y deja un pedido listo. El
            comercio sólo lo envía o lo edita; Prisma conserva cada transición.
          </p>
        </div>
        <div className="metric-card">
          <span>Pedidos pendientes</span>
          <strong>{automaticDraftCount}</strong>
          <small>{requests.filter((request) => request.status === "NEGOTIATING").length} negociando</small>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Contrapartes mock</p>
            <h2>3 distribuidores con stock</h2>
          </div>
        </div>
        <div className="supplier-grid">
          {suppliers.map((supplier) => (
            <Link className="supplier-card" href={`/${supplier.slug}`} key={supplier.id}>
              <h3>{supplier.legal_name}</h3>
              <div className="catalog-list">
                {latestInventory
                  .filter((row) => row.company_id === supplier.id)
                  .map((row) => {
                    const available = Number(row.on_hand) - Number(row.reserved);
                    return (
                      <p key={`${supplier.id}-${row.products?.external_id}`}>
                        <strong>{row.products?.name}</strong>
                        <span>{available} {row.products?.unit} disponibles</span>
                      </p>
                    );
                  })}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <BuyerOrderWorkspace companyId={company.id} draft={consolidatedDraft} />

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Actividad</p>
            <h2>Solicitudes</h2>
          </div>
        </div>
        <div className="request-list">
          {requests.length === 0 ? <p className="muted">Todavía no hay solicitudes.</p> : null}
          {requests.map((request) => {
            const requestItem = request.purchase_request_items[0];
            const activeMandate =
              request.mandates.find((mandate) => mandate.status === "ACTIVE") ??
              request.mandates[0];
            const buyerContextEntries = request.purchase_request_items.flatMap((item) => {
              const context = buyerContextByProduct.get(item.product_id);
              return context ? [{ context, item }] : [];
            });
            const activeOffers = request.negotiations.flatMap((negotiation) =>
              negotiation.offers.filter((offer) => offer.status === "ACTIVE"),
            );
            const finalOfferCount = request.negotiations.filter((negotiation) =>
              negotiation.negotiation_messages.some(
                (message) => message.message_type === "final_offer",
              ),
            ).length;
            const missingFinalOffers = Math.max(
              0,
              request.negotiations.length - finalOfferCount,
            );
            const hasAllFinalOffers =
              request.negotiations.length === 3 && missingFinalOffers === 0;
            const recommendationRun = request.agent_runs
              .filter(
                (run) =>
                  run.kind === "OFFER_RECOMMENDATION" && hasAllFinalOffers,
              )
              .sort(
                (left, right) =>
                  new Date(right.created_at).getTime() -
                  new Date(left.created_at).getTime(),
              )[0];
            const buyerSnapshots: ContextSnapshot[] = buyerContextEntries.length > 0
              ? [
                  {
                    label: "Contexto calculado por producto",
                    data: buyerContextEntries.map(({ context, item }) => ({
                      requestItem: item,
                      context,
                    })),
                  },
                  {
                    label: "Pedido que originó la negociación",
                    data: {
                      purchaseRequestId: request.id,
                      status: request.status,
                      requiredBy: request.required_by,
                      expiresAt: request.expires_at,
                      items: request.purchase_request_items,
                    },
                  },
                  ...(activeMandate
                    ? [{ label: "Mandato autorizado", data: activeMandate }]
                    : []),
                  ...request.agent_runs
                    .filter((run) => run.company_id === company.id)
                    .map((run) => ({
                      label: `${run.kind} · ${run.model}`,
                      data: {
                        status: run.status,
                        createdAt: run.created_at,
                        input: run.input_snapshot,
                        output: run.output,
                      },
                    })),
                ]
              : [];
            const metrics = request.negotiations
              .map(getNegotiationMetric)
              .filter((metric): metric is NegotiationMetric => Boolean(metric));
            const totals = activeOffers.map((offer) => moneyToCents(String(offer.total)));
            const minimumTotal = totals.reduce(
              (minimum, total) => total < minimum ? total : minimum,
              totals[0] ?? 0n,
            );
            const maximumTotal = totals.reduce(
              (maximum, total) => total > maximum ? total : maximum,
              totals[0] ?? 0n,
            );
            const totalMessages = metrics.reduce(
              (total, metric) => total + metric.message_count,
              0,
            );
            const averageReduction = metrics.length
              ? metrics.reduce(
                  (total, metric) =>
                    total + Number(metric.price_reduction_percentage),
                  0,
                ) / metrics.length
              : 0;
            return (
              <article className="request-card" key={request.id}>
                <div className="request-header">
                  <div>
                    <span className="status">{request.status}</span>
                    <h3>{request.purchase_request_items[0]?.description ?? "Solicitud"}</h3>
                    <code>{request.id}</code>
                  </div>
                  <div className="request-summary">
                    <span>{request.negotiations.length} negociaciones</span>
                    <span>{finalOfferCount} / 3 ofertas finales</span>
                    {buyerContextEntries.length > 0 ? (
                      <ContextModal
                        eyebrow="Contexto privado del comprador"
                        sections={buyerContextSections(buyerContextEntries, activeMandate)}
                        snapshots={buyerSnapshots}
                        subtitle="Datos del comercio usados para calcular cobertura, formular contraofertas y evaluar las propuestas. Los distribuidores no ven este contexto."
                        title={`${company.legal_name} · ${request.purchase_request_items.length} productos`}
                        triggerLabel="Contexto del comercio"
                      />
                    ) : null}
                  </div>
                </div>
                {request.purchase_request_items.map((item) => (
                  <p className="muted" key={item.id}>
                    {item.product_id} · {String(item.target_quantity)} {item.unit} · entrega {request.required_by}
                    {item.status ? ` · ${item.status}${item.pending_reason ? ` (${item.pending_reason})` : ""}` : ""}
                  </p>
                ))}
                {request.purchase_orders.length > 0 ? (
                  <div className="order-grid">
                    {request.purchase_orders.map((order) => {
                      const supplier = suppliers.find((candidate) => candidate.id === order.supplier_company_id);
                      return (
                        <article className="purchase-order-card" key={order.id}>
                          <div className="request-header">
                            <div><span className="product-code">{order.external_reference}</span><h3>{supplier?.legal_name ?? "Distribuidor"}</h3></div>
                            <span className="status success">{order.status}</span>
                          </div>
                          <div className="order-lines">
                            {order.purchase_order_items.map((item) => <div key={item.id}><span>{item.description}</span><strong>{String(item.quantity)} {item.unit}</strong><small>{formatMoney(item.total)}</small></div>)}
                          </div>
                          <footer><span>Entrega {order.delivery_date}</span><strong>{formatMoney(order.total)}</strong></footer>
                          {order.payment ? (
                            <div className="payment-summary">
                              <strong>{order.payment.status}</strong>
                              <span>{argtBaseUnitsToDisplay(order.payment.amount_base_units)} ARGt</span>
                              {order.payment.tx_hash ? (
                                <a href={`https://arbiscan.io/tx/${order.payment.tx_hash}`} rel="noreferrer" target="_blank">Ver en Arbiscan</a>
                              ) : null}
                              {order.payment.last_error ? <small className="feedback error">{order.payment.last_error}</small> : null}
                            </div>
                          ) : activeMandate?.auto_pay ? <p className="muted">Pago ARGt pendiente de creación</p> : null}
                        </article>
                      );
                    })}
                  </div>
                ) : null}
                {request.status === "PAYMENT_REVIEW_REQUIRED" ? (
                  <PaymentReviewForm
                    companyId={company.id}
                    failedPayments={request.purchase_orders.flatMap((order) =>
                      order.payment?.status === "PAYMENT_FAILED"
                        ? [{ id: order.payment.id, label: order.external_reference }]
                        : [],
                    )}
                    purchaseRequestId={request.id}
                  />
                ) : null}
                {request.negotiations.length > 0 ? (
                  <div className="negotiation-grid">
                    {request.negotiations.map((negotiation) => {
                      const supplier = suppliers.find(
                        (candidate) => candidate.id === negotiation.supplier_company_id,
                      );
                      const metric = getNegotiationMetric(negotiation);
                      const messages = [...negotiation.negotiation_messages].sort(
                        (left, right) =>
                          new Date(left.sent_at).getTime() -
                          new Date(right.sent_at).getTime(),
                      );
                      const activeOffer = negotiation.offers.find(
                        (offer) => offer.status === "ACTIVE",
                      );
                      const finalOfferMessage = messages.find(
                        (message) => message.message_type === "final_offer",
                      );
                      const finalOfferTotal = finalOfferMessage
                        ? displayValue(finalOfferMessage.payload.total)
                        : null;
                      const supplierContexts = supplier
                        ? request.purchase_request_items.flatMap((item) => {
                            const context = supplierContextByCompanyAndProduct.get(
                              `${supplier.id}:${item.product_id}`,
                            );
                            return context ? [context] : [];
                          })
                        : [];
                      const supplierContext = supplierContexts[0];
                      const supplierRuns = supplier
                        ? request.agent_runs.filter(
                            (run) =>
                              run.company_id === supplier.id &&
                              run.kind === "NEGOTIATION_DRAFT",
                          )
                        : [];
                      const preparedSupplierInput =
                        supplierContext && supplier && requestItem
                          ? {
                              phase: "INITIAL",
                              supplierName: supplier.legal_name,
                              productId: requestItem.product_id,
                              productName: requestItem.description,
                              unit: requestItem.unit,
                              requestedQuantity: String(requestItem.target_quantity),
                              availableQuantity: String(supplierContext.availableStock),
                              maximumTenderTotal: activeMandate
                                ? String(activeMandate.maximum_total_including_fees)
                                : null,
                              requiredBy: request.required_by,
                              unitCost: supplierContext.unitCost,
                              targetMarginPercentage:
                                supplierContext.targetMarginPercentage.toFixed(3),
                              targetRotationDays: supplierContext.targetRotationDays,
                              unitsPreviouslySoldToClient: String(
                                supplierContext.unitsSoldToClient,
                              ),
                              historicalAverageUnitPrice:
                                supplierContext.averageHistoricalUnitPrice,
                            }
                          : null;
                      const supplierSnapshots: ContextSnapshot[] = supplierContexts.length > 0
                        ? [
                            {
                              label: "Contexto privado completo por producto",
                              data: supplierContexts,
                            },
                            ...(supplierRuns.length > 0
                              ? supplierRuns.map((run) => ({
                                  label: `${String(run.input_snapshot.phase ?? "RONDA")} · ${run.model}`,
                                  data: {
                                    status: run.status,
                                    createdAt: run.created_at,
                                    input: run.input_snapshot,
                                    output: run.output,
                                  },
                                }))
                              : preparedSupplierInput
                                ? [
                                    {
                                      label: "Entrada inicial preparada · sin respuesta registrada",
                                      data: preparedSupplierInput,
                                    },
                                  ]
                                : []),
                          ]
                        : [];
                      return (
                        <section className="negotiation-card" key={negotiation.id}>
                          <div className="request-header">
                            <div>
                              <p className="eyebrow">Negociación paralela</p>
                              <h3>{supplier?.legal_name ?? "Distribuidor"}</h3>
                            </div>
                            <div className="negotiation-actions">
                              {finalOfferTotal ? (
                                <>
                                  <span className="final-offer-label">Oferta final</span>
                                  <strong>{formatMoney(finalOfferTotal)}</strong>
                                </>
                              ) : activeOffer ? (
                                <>
                                  <span className="pending-offer-label">Oferta inicial</span>
                                  <strong>{formatMoney(activeOffer.total)}</strong>
                                </>
                              ) : (
                                <span className="status">Oferta final pendiente</span>
                              )}
                              {supplierContexts.length > 0 && supplier ? (
                                <ContextModal
                                  eyebrow="Contexto privado del distribuidor"
                                  sections={supplierContextSections(supplierContexts)}
                                  snapshots={supplierSnapshots}
                                  subtitle="Stock, costos, objetivos e historial propios usados para preparar esta negociación. No incluye los datos privados de los otros distribuidores."
                                  title={`${supplier.legal_name} · ${request.purchase_request_items.length} productos`}
                                  triggerLabel="Ver contexto"
                                />
                              ) : null}
                            </div>
                          </div>
                          <ConversationModal
                            finalOfferTotal={
                              finalOfferTotal ? formatMoney(finalOfferTotal) : undefined
                            }
                            messageCount={messages.length}
                            productName={requestItem?.description ?? "Pedido"}
                            supplierName={supplier?.legal_name ?? "Distribuidor"}
                          >
                            <div className="conversation-thread">
                              {messages.length === 0 ? (
                                <p className="muted">La discusión todavía no empezó.</p>
                              ) : null}
                              {messages.map((message) => {
                                const buyerSentMessage =
                                  message.sender_company_id === company.id;
                                const facts = getMessageFacts(message.payload);
                                return (
                                  <article
                                    className={
                                      buyerSentMessage
                                        ? "debate-message buyer-message"
                                        : "debate-message supplier-message"
                                    }
                                    key={message.id}
                                  >
                                    <div className="message-heading">
                                      <strong>
                                        {messageLabels[message.message_type] ??
                                          message.message_type}
                                      </strong>
                                      <time dateTime={message.sent_at}>
                                        {formatDateTime(message.sent_at)}
                                      </time>
                                    </div>
                                    <p className="message-sender">
                                      {buyerSentMessage
                                        ? `Agente comprador · ${company.legal_name}`
                                        : `Agente vendedor · ${supplier?.legal_name ?? "Distribuidor"}`}
                                    </p>
                                    {facts.length > 0 ? (
                                      <dl className="message-facts">
                                        {facts.map((fact) => (
                                          <div key={`${message.id}-${fact.label}`}>
                                            <dt>{fact.label}</dt>
                                            <dd>{fact.value}</dd>
                                          </div>
                                        ))}
                                      </dl>
                                    ) : null}
                                    {typeof message.payload.notes === "string" ? (
                                      <p className="message-notes">
                                        {message.payload.notes}
                                      </p>
                                    ) : null}
                                    <details className="message-raw">
                                      <summary>Ver mensaje completo</summary>
                                      <pre>
                                        {JSON.stringify(message.raw_message, null, 2)}
                                      </pre>
                                    </details>
                                  </article>
                                );
                              })}
                            </div>
                          </ConversationModal>
                          {metric ? (
                            <div className="analytics-grid compact-analytics">
                              <div><span>Baja lograda</span><strong>{String(metric.price_reduction_percentage)}%</strong></div>
                              <div><span>Margen estimado</span><strong>{String(metric.estimated_margin_percentage)}%</strong></div>
                              <div><span>Eficiencia capital</span><strong>{String(metric.capital_efficiency_score)}%</strong></div>
                              <div><span>Rondas / mensajes</span><strong>{metric.rounds} / {metric.message_count}</strong></div>
                            </div>
                          ) : null}
                        </section>
                      );
                    })}
                  </div>
                ) : null}
                {metrics.length > 0 ? (
                  <div className="analytics-grid account-analytics">
                    <div><span>Respuestas finales</span><strong>{metrics.length} / 3</strong></div>
                    <div><span>Mejor total</span><strong>{formatArs(centsToMoney(minimumTotal))}</strong></div>
                    <div><span>Brecha entre opciones</span><strong>{formatArs(centsToMoney(maximumTotal - minimumTotal))}</strong></div>
                    <div><span>Baja promedio</span><strong>{averageReduction.toFixed(2)}%</strong></div>
                    <div><span>Mensajes trazados</span><strong>{totalMessages}</strong></div>
                  </div>
                ) : null}
                {recommendationRun ? (
                  <div className="recommendation-card">
                    <p className="eyebrow">Recomendación del agente comprador</p>
                    <h3>
                      {typeof recommendationRun.output.summary === "string"
                        ? recommendationRun.output.summary
                        : "Comparación terminada"}
                    </h3>
                    {Array.isArray(recommendationRun.output.ranking) ? (
                      <div className="ranking-list">
                        {(recommendationRun.output.ranking as Array<Record<string, unknown>>)
                          .sort((left, right) => Number(left.position) - Number(right.position))
                          .map((entry) => {
                            const offerId = String(entry.offerId ?? "");
                            const negotiation = request.negotiations.find((candidate) =>
                              candidate.offers.some((offer) => offer.id === offerId),
                            );
                            const supplier = suppliers.find(
                              (candidate) => candidate.id === negotiation?.supplier_company_id,
                            );
                            return (
                              <article className="ranking-item" key={offerId}>
                                <strong>#{String(entry.position)} · {supplier?.legal_name ?? "Distribuidor"}</strong>
                                <span>{String(entry.reason ?? "")}</span>
                              </article>
                            );
                          })}
                      </div>
                    ) : null}
                    {Array.isArray(recommendationRun.output.allocations) ? (
                      <div className="ranking-list">
                        {(recommendationRun.output.allocations as Array<Record<string, unknown>>).map((entry) => (
                          <article className="ranking-item" key={String(entry.requestItemId)}>
                            <strong>
                              {String(entry.productId)} · {String(entry.supplierName ?? "Distribuidor")}
                            </strong>
                            <span>
                              {String(entry.quantity)} unidades · {formatMoney(String(entry.total ?? 0))} · {String(entry.reason ?? "Adjudicación elegible")}
                            </span>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {request.status === "AWAITING_APPROVAL" ? (
                  <ApproveRequestForm
                    companyId={company.id}
                    purchaseRequestId={request.id}
                    suppliers={suppliers}
                  />
                ) : null}
                {(["NEGOTIATING", "RECOMMENDED"].includes(request.status) &&
                  missingFinalOffers > 0) ||
                (request.status === "NEGOTIATING" && hasAllFinalOffers) ? (
                  <div className="action-row">
                    <TenderAgentsButton
                      companyId={company.id}
                      hasOffers={activeOffers.length > 0}
                      missingFinalOffers={missingFinalOffers}
                      purchaseRequestId={request.id}
                    />
                    {hasAllFinalOffers && request.status === "NEGOTIATING" ? (
                      <RecommendationButton companyId={company.id} purchaseRequestId={request.id} />
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
