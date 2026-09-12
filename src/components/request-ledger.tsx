import { centsToMoney, moneyToCents } from "@/lib/decimal";
import { suppliers as demoSuppliers } from "@/modules/protocol/domain/purchase-flow";

// Presentational pieces for the negotiations ledger (/protocol). Server-safe:
// no hooks, no browser APIs, so the page can stay a server component.

export type RequestTone = "attention" | "active" | "ready" | "done" | "closed";

const statusMeta: Record<string, { label: string; tone: RequestTone }> = {
  AWAITING_APPROVAL: { label: "Esperando tu aprobación", tone: "attention" },
  REAPPROVAL_REQUIRED: { label: "Necesita nueva aprobación", tone: "attention" },
  PAYMENT_REVIEW_REQUIRED: { label: "Pago para revisar", tone: "attention" },
  DRAFT: { label: "Borrador", tone: "active" },
  APPROVED: { label: "Aprobada", tone: "active" },
  NEGOTIATING: { label: "Negociando", tone: "active" },
  POLICY_VALIDATED: { label: "Política validada", tone: "active" },
  FUNDS_RESERVED: { label: "Fondos reservados", tone: "active" },
  RECOMMENDED: { label: "Recomendación lista", tone: "ready" },
  OFFER_ACCEPTED: { label: "Oferta aceptada", tone: "ready" },
  PARTIALLY_ORDERED: { label: "Pedido parcial", tone: "done" },
  ORDER_CREATED: { label: "Pedido generado", tone: "done" },
  PAYMENT_PENDING: { label: "Pago en curso", tone: "done" },
  PAYMENT_CONFIRMED: { label: "Pago confirmado", tone: "done" },
  RECONCILED: { label: "Conciliada", tone: "done" },
  REJECTED: { label: "Rechazada", tone: "closed" },
  EXPIRED: { label: "Vencida", tone: "closed" },
  CANCELLED: { label: "Cancelada", tone: "closed" },
};

export function requestStatus(status: string) {
  return statusMeta[status] ?? { label: status.replaceAll("_", " ").toLowerCase(), tone: "closed" as RequestTone };
}

export const ledgerGroups: Array<{ tone: RequestTone; title: string; hint: string }> = [
  { tone: "attention", title: "Necesitan tu decisión", hint: "Hermes espera tu respuesta para seguir." },
  { tone: "active", title: "En negociación", hint: "Todavía hay ofertas en curso." },
  { tone: "ready", title: "Con recomendación", hint: "Llegaron las ofertas finales. Falta que generes el pedido." },
  { tone: "done", title: "Pedidos generados", hint: "Órdenes emitidas, con su pago." },
  { tone: "closed", title: "Cerradas", hint: "No siguieron adelante." },
];

export function supplierColor(supplierId: string | null | undefined) {
  return demoSuppliers.find((supplier) => supplier.id === supplierId)?.color ?? "neutral";
}

export function supplierOrder(supplierId: string) {
  const index = demoSuppliers.findIndex((supplier) => supplier.id === supplierId);
  return index === -1 ? demoSuppliers.length : index;
}

const shortDate = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "America/Argentina/Cordoba" });

export function formatShortDate(value: string) {
  return shortDate.format(new Date(value)).replace(".", "");
}

/** `2026-09-17` (a DATE column) → `17/09`, without a timezone shift. */
export function formatDayMonth(isoDate: string) {
  const [, month, day] = isoDate.slice(0, 10).split("-");
  return day && month ? `${day}/${month}` : isoDate;
}

const quantityFormatter = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const unitPlurals: Record<string, string> = { unidad: "unidades", caja: "cajas", bolsa: "bolsas", pack: "packs", bulto: "bultos", litro: "litros", kilo: "kilos", docena: "docenas" };

/** `30` + `unidad` → `30 unidades`; units without a known plural stay as stored. */
export function formatQuantity(quantity: string | number, unit: string) {
  const amount = Number(quantity);
  const label = amount === 1 ? unit : unitPlurals[unit.toLowerCase()] ?? unit;
  return `${quantityFormatter.format(amount)} ${label}`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count.toLocaleString("es-AR")} ${count === 1 ? singular : plural}`;
}

export type SupplierOffer = {
  supplierId: string;
  /** Current total as a decimal string; null when the distributor has not answered yet. */
  total: string | null;
};

export function bestTotal(offers: SupplierOffer[]) {
  const totals = offers.flatMap((offer) => {
    if (!offer.total) return [];
    const cents = moneyToCents(offer.total);
    return cents > 0n ? [cents] : [];
  });
  if (!totals.length) return null;
  return centsToMoney(totals.reduce((minimum, total) => total < minimum ? total : minimum));
}
