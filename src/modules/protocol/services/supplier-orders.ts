import { prisma } from "@/lib/prisma";
import type { OrderSlipData } from "@/modules/protocol/domain/order-slip";

type DecimalLike = { toString(): string };

export type PurchaseOrderRow = {
  id: string;
  externalReference: string;
  status: string;
  purchaseRequestId: string;
  buyerCompanyId: string;
  supplierCompanyId: string;
  total: DecimalLike;
  deliveryDate: Date;
  paymentTerms: string;
  createdAt: Date;
  items: Array<{ id: string; productId: string; description: string; quantity: DecimalLike; unit: string; unitPrice: DecimalLike; total: DecimalLike }>;
  payment: { id: string; status: string; route: string; amountBaseUnits: string; txHash: string | null; lastError: string | null } | null;
};

export function serializePurchaseOrder(row: PurchaseOrderRow): OrderSlipData {
  return {
    id: row.id,
    externalReference: row.externalReference,
    status: row.status,
    purchaseRequestId: row.purchaseRequestId,
    buyerCompanyId: row.buyerCompanyId,
    supplierCompanyId: row.supplierCompanyId,
    total: row.total.toString(),
    deliveryDate: row.deliveryDate.toISOString().slice(0, 10),
    paymentTerms: row.paymentTerms,
    createdAt: row.createdAt.toISOString(),
    items: row.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      description: item.description,
      quantity: item.quantity.toString(),
      unit: item.unit,
      unitPrice: item.unitPrice.toString(),
      total: item.total.toString(),
    })),
    payment: row.payment
      ? { id: row.payment.id, status: row.payment.status, route: row.payment.route, amountBaseUnits: row.payment.amountBaseUnits, txHash: row.payment.txHash, lastError: row.payment.lastError }
      : null,
  };
}

/** Newest first. Used by the supplier page for the first paint and by the SSE stream afterwards. */
export async function listSupplierOrders(supplierCompanyId: string, take = 60): Promise<OrderSlipData[]> {
  const rows = await prisma.purchaseOrder.findMany({
    where: { supplierCompanyId },
    orderBy: { createdAt: "desc" },
    take,
    include: { items: true, payment: true },
  });
  return rows.map(serializePurchaseOrder);
}
