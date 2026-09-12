import { prisma } from "@/lib/prisma";
import { IN_TRANSIT_ORDER_STATUSES, PAID_PAYMENT_STATUSES, sumInTransit, type InTransitLine } from "@/modules/protocol/domain/in-transit";

/**
 * Units the shop already paid for and is still waiting on, per product. Used
 * by the storefront for the first paint and by the SSE stream afterwards, so
 * a confirmed payment shows up in "En tránsito" without a reload.
 */
export async function listBuyerInTransit(buyerCompanyId: string): Promise<InTransitLine[]> {
  const items = await prisma.purchaseOrderItem.findMany({
    where: {
      purchaseOrder: {
        buyerCompanyId,
        status: { in: [...IN_TRANSIT_ORDER_STATUSES] },
        payment: { is: { status: { in: [...PAID_PAYMENT_STATUSES] } } },
      },
    },
    select: { productId: true, quantity: true },
  });
  return sumInTransit(items.map((item) => ({ productId: item.productId, quantity: item.quantity.toString() })));
}
