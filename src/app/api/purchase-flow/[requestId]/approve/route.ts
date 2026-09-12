import { revalidatePath } from "next/cache";

import { getBuyerCompanyId, requireBuyerActor } from "@/lib/demo-workspace";
import { toDomainError } from "@/lib/domain/errors";
import { runAutomaticPaymentsForPurchaseRequest } from "@/modules/payments/service";
import { approveAvailableTenderRecommendation } from "@/modules/protocol/services/multi-product-tender";

export const runtime = "nodejs";
export const maxDuration = 300;

const orderCreatedMessage = (orderCount: number) => orderCount === 1
  ? "El pedido fue creado correctamente."
  : `Los ${orderCount} pedidos fueron creados correctamente.`;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    const target = new URL(request.url);
    if (origin.host !== (request.headers.get("host") ?? target.host) || origin.protocol !== target.protocol) {
      return Response.json({ message: "Origen de solicitud inválido." }, { status: 403 });
    }
  } catch {
    return Response.json({ message: "Origen de solicitud inválido." }, { status: 403 });
  }

  try {
    const { requestId } = await params;
    const body = await request.json().catch(() => ({})) as { payNow?: unknown };
    const payNow = body.payNow === true;
    const actor = await requireBuyerActor(getBuyerCompanyId());
    const result = await approveAvailableTenderRecommendation(actor, requestId, payNow);

    let responseBody: Record<string, unknown> = {
      ok: true,
      outcome: "order_created",
      orderCreated: true,
      orderCount: result.orders.length,
      message: `${orderCreatedMessage(result.orders.length)} No se realizó ningún pago.`,
    };
    if (payNow) {
      try {
        const payment = await runAutomaticPaymentsForPurchaseRequest(actor, requestId);
        responseBody = payment.error
          ? {
              ok: false,
              outcome: "payment_failed",
              orderCreated: true,
              orderCount: result.orders.length,
              message: `${orderCreatedMessage(result.orders.length)} El pago no pudo confirmarse: ${payment.error}`,
            }
          : {
              ok: true,
              outcome: "payment_confirmed",
              orderCreated: true,
              orderCount: result.orders.length,
              message: result.orders.length === 1
                ? "Pago aprobado. El pedido fue creado y el pago quedó confirmado."
                : `Pago aprobado. Los ${result.orders.length} pedidos fueron creados y sus pagos quedaron confirmados.`,
            };
      } catch (error) {
        console.error("Automatic payment after approval failed", error);
        const paymentError = toDomainError(error);
        responseBody = {
          ok: false,
          outcome: "payment_failed",
          orderCreated: true,
          orderCount: result.orders.length,
          message: `${orderCreatedMessage(result.orders.length)} El pago no pudo confirmarse: ${paymentError.message}`,
        };
      }
    }
    for (const path of ["/protocol", "/cliente-demo", "/distribuidora-norte", "/mayorista-andino", "/abastecimientos-sur"]) {
      revalidatePath(path);
    }
    return Response.json(responseBody);
  } catch (error) {
    const domainError = toDomainError(error);
    return Response.json({
      ok: false,
      outcome: "order_failed",
      orderCreated: false,
      message: `No se pudo crear el pedido. ${domainError.message}`,
    }, { status: domainError.status });
  }
}
