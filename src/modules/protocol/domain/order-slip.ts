// Serializable purchase-order shape shared by server pages, the supplier
// realtime stream and client components. Money and quantities travel as
// decimal strings, dates as ISO strings.

import { centsToMoney, moneyToCents } from "@/lib/decimal";

export type OrderSlipPayment = {
  id: string;
  status: string;
  route: string;
  amountBaseUnits: string;
  txHash: string | null;
  lastError: string | null;
};

export type OrderSlipItem = {
  id: string;
  productId: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  total: string;
};

export type OrderSlipData = {
  id: string;
  externalReference: string;
  status: string;
  purchaseRequestId: string;
  buyerCompanyId: string;
  supplierCompanyId: string;
  total: string;
  /** `YYYY-MM-DD` */
  deliveryDate: string;
  paymentTerms: string;
  createdAt: string;
  items: OrderSlipItem[];
  payment: OrderSlipPayment | null;
};

export const orderStatusLabels: Record<string, string> = {
  CREATED: "Emitida",
  CONFIRMED: "Confirmada",
  PAID: "Pagada",
  DELIVERED: "Entregada",
  CANCELLED: "Cancelada",
};

export const paymentStatusLabels: Record<string, string> = {
  PAYMENT_PENDING: "Pago pendiente",
  PAYMENT_REQUESTED: "Pago solicitado",
  PAYMENT_AUTHORIZED: "Pago autorizado",
  PAYMENT_SUBMITTED: "Pago enviado, esperando confirmación",
  PAYMENT_CONFIRMED: "Pago confirmado",
  PAYMENT_FAILED: "Pago fallido, requiere revisión",
  PAYMENT_REVIEW_REQUIRED: "Pago para revisar",
};

export type PaymentTone = "confirmed" | "failed" | "pending";

export function paymentTone(status: string): PaymentTone {
  if (status === "PAYMENT_CONFIRMED") return "confirmed";
  if (status === "PAYMENT_FAILED" || status === "PAYMENT_REVIEW_REQUIRED") return "failed";
  return "pending";
}

export const paymentRouteLabels: Record<string, string> = {
  ARBITRUM_DIRECT: "ARGt en Arbitrum",
  SOLANA_TO_ARBITRUM: "Solana → Arbitrum",
};

export function paymentTermsLabel(terms: string) {
  const known: Record<string, string> = { CONTADO: "contado", CASH: "contado", NET_7: "7 días", NET_15: "15 días", NET_30: "30 días", NET_60: "60 días" };
  return known[terms.toUpperCase()] ?? terms.replaceAll("_", " ").toLowerCase();
}

/** Orders present in `next` that were not in `previous`: what just arrived. */
export function newOrderIds(previous: OrderSlipData[], next: OrderSlipData[]) {
  const seen = new Set(previous.map((order) => order.id));
  return next.filter((order) => !seen.has(order.id)).map((order) => order.id);
}

/** Orders whose status or payment changed between snapshots. */
export function changedOrderIds(previous: OrderSlipData[], next: OrderSlipData[]) {
  const before = new Map(previous.map((order) => [order.id, `${order.status}:${order.payment?.status ?? ""}:${order.payment?.txHash ?? ""}`]));
  return next
    .filter((order) => {
      const signature = before.get(order.id);
      return signature !== undefined && signature !== `${order.status}:${order.payment?.status ?? ""}:${order.payment?.txHash ?? ""}`;
    })
    .map((order) => order.id);
}

export type CollectionTone = "confirmed" | "sent" | "pending" | "failed";

/**
 * What the distributor needs to read in one glance: not the payment's internal
 * status but whether the money is in, on its way, still owed, or stuck.
 */
export function collectionState(order: OrderSlipData): { label: string; tone: CollectionTone } {
  const status = order.payment?.status;
  if (status === "PAYMENT_CONFIRMED") return { label: "Cobrado", tone: "confirmed" };
  if (status === "PAYMENT_FAILED" || status === "PAYMENT_REVIEW_REQUIRED") return { label: "Revisar", tone: "failed" };
  if (status === "PAYMENT_SUBMITTED") return { label: "En camino", tone: "sent" };
  return { label: "Por cobrar", tone: "pending" };
}

export function isCollected(order: OrderSlipData) {
  return order.payment?.status === "PAYMENT_CONFIRMED";
}

/** Lines add up only when they share a unit; mixed baskets are counted as lines. */
export function summarizeQuantity(items: OrderSlipItem[]): { amount: number; unit: string | null } {
  const unit = items.length && items.every((item) => item.unit === items[0].unit) ? items[0].unit : null;
  if (!unit) return { amount: items.length, unit: null };
  return { amount: items.reduce((sum, item) => sum + Number(item.quantity), 0), unit };
}

/** The thing to pick: one product by name, several as the first plus a count. */
export function productSummary(items: OrderSlipItem[]) {
  if (items.length === 0) return "Pedido sin líneas";
  return items.length === 1 ? items[0].description : `${items[0].description} y ${items.length - 1} más`;
}

export type DispatchGroup = {
  /** `YYYY-MM-DD`, the day the order has to be delivered. */
  date: string;
  orders: OrderSlipData[];
  total: string;
  quantity: { amount: number; unit: string | null };
  pending: number;
};

/**
 * The order book as a dispatch sheet: orders fall under the day they have to
 * leave, soonest first, and equal products sit together inside a day so a
 * single pick covers them.
 */
export function dispatchGroups(orders: OrderSlipData[]): DispatchGroup[] {
  const byDate = new Map<string, OrderSlipData[]>();
  for (const order of orders) {
    const day = order.deliveryDate.slice(0, 10);
    byDate.set(day, [...(byDate.get(day) ?? []), order]);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, group]) => {
      const sorted = [...group].sort((left, right) => {
        const byProduct = productSummary(left.items).localeCompare(productSummary(right.items), "es-AR");
        if (byProduct !== 0) return byProduct;
        const difference = moneyToCents(right.total) - moneyToCents(left.total);
        return difference < 0n ? -1 : difference > 0n ? 1 : 0;
      });
      return {
        date,
        orders: sorted,
        total: centsToMoney(sorted.reduce((sum, order) => sum + moneyToCents(order.total), 0n)),
        quantity: summarizeQuantity(sorted.flatMap((order) => order.items)),
        pending: sorted.filter((order) => !isCollected(order)).length,
      };
    });
}

export function ordersTotal(orders: OrderSlipData[]) {
  return centsToMoney(orders.reduce((sum, order) => sum + moneyToCents(order.total), 0n));
}

/** What is still owed, as a decimal string. */
export function owedTotal(orders: OrderSlipData[]) {
  return ordersTotal(orders.filter((order) => !isCollected(order)));
}
