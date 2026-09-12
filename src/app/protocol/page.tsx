import { ApproveRequestForm } from "@/components/approve-request-form";
import { ConversationModal } from "@/components/conversation-modal";
import {
  ContextModal,
  type ContextSection,
  type ContextSnapshot,
} from "@/components/context-modal";
import { RecommendationButton } from "@/components/recommendation-button";
import { TenderAgentsButton } from "@/components/tender-agents-button";
import { OrderSlip } from "@/components/order-slip";
import { PaymentReviewForm } from "@/components/payment-review-form";
import {
  bestTotal,
  formatDayMonth,
  formatQuantity,
  formatShortDate,
  ledgerGroups,
  pluralize,
  requestStatus,
  supplierColor,
  supplierOrder,
  type SupplierOffer,
} from "@/components/request-ledger";
import {
  DEMO_SUPPLIER_COMPANY_IDS,
  getBuyerCompanyId,
} from "@/lib/demo-workspace";
import { centsToMoney, formatArs, moneyToCents } from "@/lib/decimal";
import { prisma } from "@/lib/prisma";
import type { OrderSlipData } from "@/modules/protocol/domain/order-slip";
import { suppliers as demoSuppliers } from "@/modules/protocol/domain/purchase-flow";
import { serializePurchaseOrder } from "@/modules/protocol/services/supplier-orders";
import {
  getBuyerProductContexts,
  getSupplierProductContexts,
} from "@/modules/context/analytics";

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
  purchase_orders: OrderSlipData[];
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

/**
 * Each distributor haggles as many passes as it is willing to: from the second
 * one on, the thread names the round so a long negotiation stays readable.
 */
function threadLabels(messages: Array<{ id: string; message_type: string }>) {
  const labels = new Map<string, string>();
  let exchange = 0;
  let answered = false;
  for (const message of messages) {
    if (message.message_type === "counteroffer") exchange += 1;
    const improved = message.message_type === "offer" && answered;
    if (message.message_type === "offer") answered = true;
    const base = improved ? "Mejora del vendedor" : messageLabels[message.message_type] ?? message.message_type;
    const rounded = exchange > 1 && (improved || message.message_type === "counteroffer");
    labels.set(message.id, rounded ? `${base} · ronda ${exchange}` : base);
  }
  return labels;
}

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
    purchase_orders: request.purchaseOrders.map(serializePurchaseOrder),
    negotiations: request.negotiations.map((negotiation) => ({
      id: negotiation.id, supplier_company_id: negotiation.supplierCompanyId, status: negotiation.status,
      offers: negotiation.offers.map((offer) => ({ id: offer.id, total: offer.total.toString(), valid_until: offer.validUntil.toISOString(), confirmed_stock: offer.confirmedStock, status: offer.status, payload: offer.payload as Record<string, unknown> })),
      negotiation_messages: negotiation.messages.map((message) => ({ id: message.id, message_type: message.messageType, sender_company_id: message.senderCompanyId, sent_at: message.sentAt.toISOString(), payload: message.payload as Record<string, unknown>, raw_message: message.rawMessage as Record<string, unknown> })),
      negotiation_metrics: negotiation.metric ? { rounds: negotiation.metric.rounds, message_count: negotiation.metric.messageCount, initial_total: negotiation.metric.initialTotal.toString(), final_total: negotiation.metric.finalTotal.toString(), price_reduction_percentage: negotiation.metric.priceReductionPercentage.toString(), estimated_margin_percentage: negotiation.metric.estimatedMarginPercentage.toString(), capital_efficiency_score: negotiation.metric.capitalEfficiencyScore.toString(), duration_ms: negotiation.metric.durationMs } : null,
    })),
    agent_runs: request.agentRuns.map((run) => ({ id: run.id, company_id: run.companyId, kind: run.kind, model: run.model, status: run.status, input_snapshot: run.inputSnapshot as Record<string, unknown>, output: run.output as Record<string, unknown>, created_at: run.createdAt.toISOString() })),
  }));
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

  const pendingReasonLabels: Record<string, string> = { PRESUPUESTO_INSUFICIENTE: "presupuesto insuficiente", SIN_OFERTA_CONFIRMADA: "sin oferta confirmada", SIN_COBERTURA_CONFIRMADA: "sin cobertura confirmada" };
  const supplierName = (supplierId: string) =>
    suppliers.find((candidate) => candidate.id === supplierId)?.legal_name
    ?? demoSuppliers.find((candidate) => candidate.id === supplierId)?.name
    ?? "Distribuidor";

  const groups = ledgerGroups
    .map((group) => ({ ...group, requests: requests.filter((request) => requestStatus(request.status).tone === group.tone) }))
    .filter((group) => group.requests.length > 0);
  const firstOpenId = groups[0]?.requests[0]?.id;

  function renderRequest(request: RequestRow, open: boolean) {
    const status = requestStatus(request.status);
    const items = request.purchase_request_items;
    const requestItem = items[0];
    const activeMandate =
      request.mandates.find((mandate) => mandate.status === "ACTIVE") ??
      request.mandates[0];
    const buyerContextEntries = items.flatMap((item) => {
      const context = buyerContextByProduct.get(item.product_id);
      return context ? [{ context, item }] : [];
    });
    const negotiations = [...request.negotiations].sort(
      (left, right) => supplierOrder(left.supplier_company_id) - supplierOrder(right.supplier_company_id),
    );
    const activeOffers = negotiations.flatMap((negotiation) =>
      negotiation.offers.filter((offer) => offer.status === "ACTIVE"),
    );
    const finalOfferCount = negotiations.filter((negotiation) =>
      negotiation.negotiation_messages.some((message) => message.message_type === "final_offer"),
    ).length;
    const missingFinalOffers = Math.max(0, negotiations.length - finalOfferCount);
    const hasAllFinalOffers = negotiations.length === 3 && missingFinalOffers === 0;
    const recommendationRun = request.agent_runs
      .filter((run) => run.kind === "OFFER_RECOMMENDATION" && hasAllFinalOffers)
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0];
    const buyerSnapshots: ContextSnapshot[] = buyerContextEntries.length > 0
      ? [
          { label: "Contexto calculado por producto", data: buyerContextEntries.map(({ context, item }) => ({ requestItem: item, context })) },
          { label: "Pedido que originó la negociación", data: { purchaseRequestId: request.id, status: request.status, requiredBy: request.required_by, expiresAt: request.expires_at, items } },
          ...(activeMandate ? [{ label: "Mandato autorizado", data: activeMandate }] : []),
          ...request.agent_runs
            .filter((run) => run.company_id === company.id)
            .map((run) => ({ label: `${run.kind} · ${run.model}`, data: { status: run.status, createdAt: run.created_at, input: run.input_snapshot, output: run.output } })),
        ]
      : [];
    // Latest total per demo distributor, in the stage's fixed order: the final
    // offer when it arrived, otherwise whatever is on the table.
    const supplierOffers: SupplierOffer[] = demoSuppliers.map((supplier) => {
      const negotiation = negotiations.find((candidate) => candidate.supplier_company_id === supplier.id);
      const finalMessage = negotiation?.negotiation_messages.find((message) => message.message_type === "final_offer");
      const finalTotal = finalMessage ? displayValue(finalMessage.payload.total) : null;
      const activeOffer = negotiation?.offers.find((offer) => offer.status === "ACTIVE");
      return { supplierId: supplier.id, total: finalTotal ?? (activeOffer ? String(activeOffer.total) : null) };
    });
    const bestFinalSupplierId = hasAllFinalOffers
      ? [...supplierOffers].filter((offer) => offer.total && moneyToCents(offer.total) > 0n).sort((left, right) => {
          const difference = moneyToCents(left.total!) - moneyToCents(right.total!);
          return difference < 0n ? -1 : difference > 0n ? 1 : 0;
        })[0]?.supplierId
      : undefined;
    const recommendedNames = Array.isArray(recommendationRun?.output.allocations)
      ? new Set((recommendationRun.output.allocations as Array<Record<string, unknown>>).map((entry) => String(entry.supplierName ?? "")))
      : null;
    // Awarded rows: a real order names the distributor; before that, the
    // recommendation does; before that, the best final price stands in.
    const awardedSupplierIds = new Set<string>(
      request.purchase_orders.length
        ? request.purchase_orders.map((order) => order.supplierCompanyId)
        : recommendedNames
          ? suppliers.filter((supplier) => recommendedNames.has(supplier.legal_name)).map((supplier) => supplier.id)
          : bestFinalSupplierId ? [bestFinalSupplierId] : [],
    );
    const awardedLabel = request.purchase_orders.length ? "Pedido emitido" : recommendedNames ? "Recomendado" : "Mejor precio";
    const awardedTotal = request.purchase_orders.length
      ? centsToMoney(request.purchase_orders.reduce((total, order) => total + moneyToCents(order.total), 0n))
      : null;
    const headlineTotal = awardedTotal ?? bestTotal(supplierOffers);
    const headlineLabel = awardedTotal ? "Adjudicado" : headlineTotal ? (hasAllFinalOffers ? "Mejor oferta final" : "Mejor oferta hasta ahora") : "Sin ofertas todavía";
    const totalUnits = items.reduce((total, item) => total + Number(item.target_quantity), 0);
    const quantitySummary = items.length === 1
      ? formatQuantity(requestItem.target_quantity, requestItem.unit)
      : `${pluralize(items.length, "producto")} · ${formatNumber(totalUnits)} unidades`;
    const title = requestItem?.description ?? "Solicitud";
    const showTenderActions =
      (["NEGOTIATING", "RECOMMENDED"].includes(request.status) && missingFinalOffers > 0) ||
      (request.status === "NEGOTIATING" && hasAllFinalOffers);

    return (
      <details className={`ledger-entry tone-${status.tone}`} key={request.id} open={open || undefined}>
        <summary className="ledger-row">
          <span className="ledger-title">
            <strong>{title}{items.length > 1 ? <em> + {items.length - 1} más</em> : null}</strong>
            <span>{quantitySummary} · entrega {formatDayMonth(request.required_by)}</span>
          </span>
          <span className="ledger-status"><span className="ledger-dot" aria-hidden="true" />{status.label}</span>
          <span className="ledger-total">
            <strong>{headlineTotal ? formatMoney(headlineTotal) : "—"}</strong>
            <span>{headlineLabel}</span>
          </span>
          <time className="ledger-date" dateTime={request.created_at}>{formatShortDate(request.created_at)}</time>
          <span className="ledger-chevron" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 6 4 4 4-4" /></svg>
          </span>
        </summary>

        <div className="ledger-body">
          <div className="entry-meta">
            <span>Creada el {formatDateTime(request.created_at)}</span>
            {buyerContextEntries.length > 0 ? (
              <ContextModal
                eyebrow="Contexto privado del comprador"
                sections={buyerContextSections(buyerContextEntries, activeMandate)}
                snapshots={buyerSnapshots}
                subtitle="Lo que Hermes sabe de tu comercio para negociar. Los distribuidores no lo ven."
                title={company.legal_name}
                triggerLabel="Datos de tu comercio"
              />
            ) : null}
          </div>

          <section className="entry-section">
            <h4 className="entry-label">Lo que pediste</h4>
            <ul className="entry-items">
              {items.map((item) => (
                <li key={item.id}>
                  <span className="entry-item-name"><strong>{item.description}</strong></span>
                  <span className="entry-item-qty">{formatQuantity(item.target_quantity, item.unit)}</span>
                  {item.status === "AWARDED" ? <span className="line-state awarded">Adjudicado</span>
                    : item.status === "PENDING" ? <span className="line-state pending">Pendiente{item.pending_reason ? ` · ${pendingReasonLabels[item.pending_reason] ?? item.pending_reason.replaceAll("_", " ").toLowerCase()}` : ""}</span>
                    : null}
                </li>
              ))}
            </ul>
          </section>

          {request.purchase_orders.length > 0 ? (
            <section className="entry-section">
              <h4 className="entry-label">{pluralize(request.purchase_orders.length, "pedido emitido", "pedidos emitidos")}</h4>
              <div className="slip-grid">
                {request.purchase_orders.map((order) => (
                  <OrderSlip colorClass={`supplier-${supplierColor(order.supplierCompanyId)}`} counterpartName={supplierName(order.supplierCompanyId)} key={order.id} order={order} />
                ))}
              </div>
            </section>
          ) : null}

          {request.status === "PAYMENT_REVIEW_REQUIRED" ? (
            <section className="entry-section entry-action">
              <h4 className="entry-label">Revisión de pago</h4>
              <PaymentReviewForm
                companyId={company.id}
                failedPayments={request.purchase_orders.flatMap((order) =>
                  order.payment?.status === "PAYMENT_FAILED" ? [{ id: order.payment.id, label: order.externalReference }] : [],
                )}
                purchaseRequestId={request.id}
                compact
              />
            </section>
          ) : null}

          {negotiations.length > 0 ? (
            <section className="entry-section">
              <h4 className="entry-label">Ofertas de los distribuidores</h4>
              <div className="offer-table-wrap">
                <table className="offer-table">
                  <thead>
                    <tr>
                      <th scope="col">Distribuidor</th>
                      <th scope="col">Oferta inicial</th>
                      <th scope="col">Oferta final</th>
                      <th scope="col">Baja</th>
                      <th scope="col">Entrega</th>
                      {items.length > 1 ? <th scope="col">Productos</th> : null}
                      <th scope="col"><span className="sr-only">Detalle</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {negotiations.map((negotiation) => {
                      const supplier = suppliers.find((candidate) => candidate.id === negotiation.supplier_company_id);
                      const name = supplierName(negotiation.supplier_company_id);
                      const metric = getNegotiationMetric(negotiation);
                      const messages = [...negotiation.negotiation_messages].sort(
                        (left, right) => new Date(left.sent_at).getTime() - new Date(right.sent_at).getTime(),
                      );
                      const threadMessageLabels = threadLabels(messages);
                      const activeOffer = negotiation.offers.find((offer) => offer.status === "ACTIVE");
                      const offerMessage = messages.find((message) => message.message_type === "offer");
                      const finalOfferMessage = messages.find((message) => message.message_type === "final_offer");
                      const finalOfferTotal = finalOfferMessage ? displayValue(finalOfferMessage.payload.total) : null;
                      const initialTotal = (offerMessage ? displayValue(offerMessage.payload.total) : null) ?? (metric ? String(metric.initial_total) : null) ?? (activeOffer ? String(activeOffer.total) : null);
                      const latestPayload = finalOfferMessage?.payload ?? offerMessage?.payload ?? activeOffer?.payload ?? null;
                      const noCoverage = finalOfferTotal !== null && moneyToCents(finalOfferTotal) <= 0n;
                      const reduction = metric
                        ? Number(metric.price_reduction_percentage)
                        : initialTotal && finalOfferTotal && moneyToCents(initialTotal) > 0n && !noCoverage
                          ? Number(moneyToCents(initialTotal) - moneyToCents(finalOfferTotal)) / Number(moneyToCents(initialTotal)) * 100
                          : null;
                      const deliveryDate = latestPayload ? displayValue(latestPayload.deliveryDate) : null;
                      const coveredLines = latestPayload && Array.isArray(latestPayload.lines) ? latestPayload.lines.length : null;
                      const awarded = awardedSupplierIds.has(negotiation.supplier_company_id);
                      const supplierContexts = supplier
                        ? items.flatMap((item) => {
                            const context = supplierContextByCompanyAndProduct.get(`${supplier.id}:${item.product_id}`);
                            return context ? [context] : [];
                          })
                        : [];
                      const supplierContext = supplierContexts[0];
                      const supplierRuns = supplier
                        ? request.agent_runs.filter((run) => run.company_id === supplier.id && run.kind === "NEGOTIATION_DRAFT")
                        : [];
                      const preparedSupplierInput = supplierContext && supplier && requestItem
                        ? {
                            phase: "INITIAL",
                            supplierName: supplier.legal_name,
                            productId: requestItem.product_id,
                            productName: requestItem.description,
                            unit: requestItem.unit,
                            requestedQuantity: String(requestItem.target_quantity),
                            availableQuantity: String(supplierContext.availableStock),
                            maximumTenderTotal: activeMandate ? String(activeMandate.maximum_total_including_fees) : null,
                            requiredBy: request.required_by,
                            unitCost: supplierContext.unitCost,
                            targetMarginPercentage: supplierContext.targetMarginPercentage.toFixed(3),
                            targetRotationDays: supplierContext.targetRotationDays,
                            unitsPreviouslySoldToClient: String(supplierContext.unitsSoldToClient),
                            historicalAverageUnitPrice: supplierContext.averageHistoricalUnitPrice,
                          }
                        : null;
                      const supplierSnapshots: ContextSnapshot[] = supplierContexts.length > 0
                        ? [
                            { label: "Contexto privado completo por producto", data: supplierContexts },
                            ...(supplierRuns.length > 0
                              ? supplierRuns.map((run) => ({ label: `${String(run.input_snapshot.phase ?? "RONDA")} · ${run.model}`, data: { status: run.status, createdAt: run.created_at, input: run.input_snapshot, output: run.output } }))
                              : preparedSupplierInput
                                ? [{ label: "Entrada inicial preparada · sin respuesta registrada", data: preparedSupplierInput }]
                                : []),
                          ]
                        : [];
                      return (
                        <tr className={`supplier-${supplierColor(negotiation.supplier_company_id)} ${awarded ? "is-awarded" : ""}`} key={negotiation.id}>
                          <th scope="row" data-label="Distribuidor">
                            <span className="supplier-key" aria-hidden="true" />
                            <span className="offer-name"><span>{name}</span>{awarded ? <em>{awardedLabel}</em> : null}</span>
                          </th>
                          <td data-label="Oferta inicial">{initialTotal && moneyToCents(initialTotal) > 0n ? formatMoney(initialTotal) : <span className="offer-empty">—</span>}</td>
                          <td className="offer-final" data-label="Oferta final">
                            {finalOfferTotal === null ? <span className="offer-pending">Pendiente</span> : noCoverage ? <span className="offer-nostock">Sin stock</span> : <strong>{formatMoney(finalOfferTotal)}</strong>}
                          </td>
                          <td className={reduction !== null && reduction > 0 ? "positive-text" : ""} data-label="Baja">{reduction !== null && !noCoverage ? `${formatNumber(reduction)} %` : <span className="offer-empty">—</span>}</td>
                          <td data-label="Entrega">{deliveryDate ? formatDayMonth(deliveryDate) : <span className="offer-empty">—</span>}</td>
                          {items.length > 1 ? <td data-label="Productos">{noCoverage ? <span className="offer-empty">0 de {items.length}</span> : coveredLines !== null ? `${coveredLines} de ${items.length}` : <span className="offer-empty">—</span>}</td> : null}
                          <td className="offer-actions">
                            <ConversationModal
                              finalOfferTotal={finalOfferTotal && !noCoverage ? formatMoney(finalOfferTotal) : undefined}
                              messageCount={messages.length}
                              productName={requestItem?.description ?? "Pedido"}
                              supplierName={name}
                              variant="inline"
                            >
                              <div className="conversation-thread">
                                {messages.length === 0 ? <p className="muted">La conversación todavía no empezó.</p> : null}
                                {messages.map((message) => {
                                  const buyerSentMessage = message.sender_company_id === company.id;
                                  const facts = getMessageFacts(message.payload);
                                  return (
                                    <article className={buyerSentMessage ? "debate-message buyer-message" : "debate-message supplier-message"} key={message.id}>
                                      <div className="message-heading">
                                        <strong>{threadMessageLabels.get(message.id) ?? message.message_type}</strong>
                                        <time dateTime={message.sent_at}>{formatDateTime(message.sent_at)}</time>
                                      </div>
                                      <p className="message-sender">{buyerSentMessage ? `Agente comprador · ${company.legal_name}` : `Agente vendedor · ${name}`}</p>
                                      {facts.length > 0 ? (
                                        <dl className="message-facts">
                                          {facts.map((fact) => <div key={`${message.id}-${fact.label}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
                                        </dl>
                                      ) : null}
                                      {typeof message.payload.notes === "string" ? <p className="message-notes">{message.payload.notes}</p> : null}
                                      <details className="message-raw">
                                        <summary>Ver mensaje completo</summary>
                                        <pre>{JSON.stringify(message.raw_message, null, 2)}</pre>
                                      </details>
                                    </article>
                                  );
                                })}
                              </div>
                            </ConversationModal>
                            {supplierContexts.length > 0 && supplier ? (
                              <ContextModal
                                eyebrow="Contexto privado del distribuidor"
                                sections={supplierContextSections(supplierContexts)}
                                snapshots={supplierSnapshots}
                                subtitle="Stock, costos e historial que usó este distribuidor para negociar."
                                title={supplier.legal_name}
                                triggerLabel="Datos"
                              />
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}


          {recommendationRun && request.purchase_orders.length === 0 && Array.isArray(recommendationRun.output.allocations) ? (
            <section className="entry-section">
              <h4 className="entry-label">Qué recomienda Hermes</h4>
              <ul className="rank-list allocations">
                {(recommendationRun.output.allocations as Array<Record<string, unknown>>).map((entry) => {
                  const supplier = suppliers.find((candidate) => candidate.legal_name === String(entry.supplierName ?? ""));
                  const item = items.find((candidate) => candidate.product_id === String(entry.productId));
                  return (
                    <li className={`supplier-${supplierColor(supplier?.id)}`} key={String(entry.requestItemId)}>
                      <span className="supplier-key" aria-hidden="true" />
                      <div>
                        <strong>{item?.description ?? String(entry.productId)} <span aria-hidden="true">→</span> {String(entry.supplierName ?? "Distribuidor")}</strong>
                        <span>{formatQuantity(String(entry.quantity ?? 0), item?.unit ?? "unidad")} por {formatMoney(String(entry.total ?? 0))}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {request.status === "AWAITING_APPROVAL" ? (
            <section className="entry-section entry-action">
              <h4 className="entry-label">Aprobación</h4>
              <ApproveRequestForm companyId={company.id} purchaseRequestId={request.id} suppliers={suppliers} />
            </section>
          ) : null}
          {showTenderActions ? (
            <section className="entry-section entry-action">
              <h4 className="entry-label">Siguiente paso</h4>
              <div className="action-row">
                <TenderAgentsButton companyId={company.id} hasOffers={activeOffers.length > 0} missingFinalOffers={missingFinalOffers} purchaseRequestId={request.id} />
                {hasAllFinalOffers && request.status === "NEGOTIATING" ? <RecommendationButton companyId={company.id} purchaseRequestId={request.id} /> : null}
              </div>
            </section>
          ) : null}
        </div>
      </details>
    );
  }

  return (
    <main className="shell ledger-shell">
      <header className="ledger-heading" id="negociaciones">
        <div>
          <h2>Negociaciones</h2>
        </div>
      </header>

      {requests.length === 0 ? (
        <div className="ledger-empty">
          <strong>Todavía no hay pedidos en negociación.</strong>
          <p>Cuando envíes un pedido desde Inicio, Hermes lo va a listar acá con el estado de cada conversación.</p>
        </div>
      ) : null}

      {groups.map((group) => (
        <section className={`ledger-group tone-${group.tone}`} key={group.tone} aria-labelledby={`ledger-${group.tone}`}>
          <header className="ledger-group-head">
            <h3 id={`ledger-${group.tone}`}><span className="ledger-dot" aria-hidden="true" />{group.title}<span className="ledger-count">{group.requests.length}</span></h3>
            <p>{group.hint}</p>
          </header>
          <div className="ledger-list">
            {group.requests.map((request) => renderRequest(request, request.id === firstOpenId))}
          </div>
        </section>
      ))}
    </main>
  );
}
