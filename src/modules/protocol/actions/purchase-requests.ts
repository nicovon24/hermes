"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { randomUUID } from "node:crypto";
import { requireBuyerActor } from "@/lib/demo-workspace";
import { toDomainError } from "@/lib/domain/errors";
import type { PurchaseActionState } from "@/modules/protocol/actions/action-state";
import {
  createPurchaseRequest,
} from "@/modules/protocol/services/purchase-requests";
import { launchPurchaseFlow } from "@/modules/protocol/services/purchase-flow";
import { approveAvailableTenderRecommendation } from "@/modules/protocol/services/multi-product-tender";
import { flowInputFromForm, type LaunchPurchaseFlowInput } from "@/modules/protocol/domain/purchase-flow";
import {
  payPurchaseOrder,
  reviewAutomaticPayments,
} from "@/modules/payments/service";


function revalidateCompanyWorkspaces() {
  revalidatePath("/protocol");
  revalidatePath("/cliente-demo");
  revalidatePath("/distribuidora-norte");
  revalidatePath("/mayorista-andino");
  revalidatePath("/abastecimientos-sur");
}

function formDateTimeToIso(value: FormDataEntryValue | null) {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? "invalid" : date.toISOString();
}

export async function createPurchaseRequestAction(
  buyerCompanyId: string,
  _previousState: PurchaseActionState,
  formData: FormData,
): Promise<PurchaseActionState> {
  void _previousState;
  try {
    const actor = await requireBuyerActor(buyerCompanyId);
    const requestId = await createPurchaseRequest(actor, {
      buyerCompanyId,
      currency: "ARS",
      requiredBy: String(formData.get("requiredBy") ?? ""),
      expiresAt: formDateTimeToIso(formData.get("expiresAt")),
      items: [
        {
          productId: String(formData.get("productId") ?? "").trim(),
          description: String(formData.get("description") ?? "").trim(),
          unit: String(formData.get("unit") ?? "unit").trim(),
          minimumQuantity: String(formData.get("minimumQuantity") ?? ""),
          targetQuantity: String(formData.get("targetQuantity") ?? ""),
          maximumQuantity: String(formData.get("maximumQuantity") ?? ""),
        },
      ],
    });
    revalidatePath("/protocol");
    return { ok: true, message: `Solicitud ${requestId} creada.` };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        ok: false,
        message: "Revisá los campos de la solicitud.",
        fieldErrors: z.flattenError(error).fieldErrors,
      };
    }
    const domainError = toDomainError(error);
    return { ok: false, message: domainError.message };
  }
}


async function executeFlow(input: LaunchPurchaseFlowInput): Promise<PurchaseActionState> {
  try {
    const snapshot = await launchPurchaseFlow(input);
    const failed = snapshot.events.some((event) => event.phase === "error");
    return { ok: !failed && !snapshot.running, message: failed ? snapshot.events.find((event) => event.phase === "error")?.message ?? "El pedido necesita revisión." : snapshot.running ? "El pedido sigue en curso." : `Se crearon ${snapshot.summary.orderCount} pedidos; ${snapshot.summary.pendingProducts} productos pendientes.` };
  } catch (error) {
    return { ok: false, message: error instanceof z.ZodError ? "Revisá los datos y vencimientos del pedido." : toDomainError(error).message };
  }
}

export async function sendAutomaticPurchaseRequestAction(
  buyerCompanyId: string,
  _previousState: PurchaseActionState,
  formData: FormData,
): Promise<PurchaseActionState> {
  try {
    return await executeFlow(flowInputFromForm("new", buyerCompanyId, formData, String(formData.get("requestId") ?? randomUUID()), String(formData.get("operationId") ?? randomUUID())));
  } catch {
    return { ok: false, message: "Revisá las líneas del pedido." };
  }
}

export async function approvePurchaseRequestAction(
  buyerCompanyId: string, purchaseRequestId: string,
  _previousState: PurchaseActionState, formData: FormData,
): Promise<PurchaseActionState> {
  return executeFlow(flowInputFromForm("approve", buyerCompanyId, formData, purchaseRequestId, String(formData.get("operationId") ?? randomUUID())));
}

export async function reviewAutomaticPaymentsAction(
  buyerCompanyId: string,
  purchaseRequestId: string,
  _previousState: PurchaseActionState,
  formData: FormData,
): Promise<PurchaseActionState> {
  void _previousState;
  try {
    const actor = await requireBuyerActor(buyerCompanyId);
    const retryPaymentId = formData.get("confirmRetry") === "yes"
      ? String(formData.get("paymentId") ?? "") || null
      : null;
    await reviewAutomaticPayments(actor, purchaseRequestId, retryPaymentId);
    revalidateCompanyWorkspaces();
    return { ok: true, message: "Conciliación completada. Los pagos confirmados no fueron reenviados." };
  } catch (error) {
    return { ok: false, message: toDomainError(error).message };
  }
}

export async function payPurchaseOrderAction(
  buyerCompanyId: string,
  purchaseOrderId: string,
  _previousState: PurchaseActionState,
): Promise<PurchaseActionState> {
  void _previousState;
  try {
    const actor = await requireBuyerActor(buyerCompanyId);
    await payPurchaseOrder(actor, purchaseOrderId);
    revalidateCompanyWorkspaces();
    return { ok: true, message: "Pago confirmado." };
  } catch (error) {
    return { ok: false, message: toDomainError(error).message };
  }
}

export async function approveTenderRecommendationAction(
  buyerCompanyId: string,
  purchaseRequestId: string,
  _previousState: PurchaseActionState,
): Promise<PurchaseActionState> {
  void _previousState;
  try {
    const actor = await requireBuyerActor(buyerCompanyId);
    const result = await approveAvailableTenderRecommendation(actor, purchaseRequestId);
    revalidateCompanyWorkspaces();
    return {
      ok: true,
      message: `${result.orders.length} ${result.orders.length === 1 ? "pedido aprobado" : "pedidos aprobados"}.`,
    };
  } catch (error) {
    return { ok: false, message: toDomainError(error).message };
  }
}

export async function retryPendingItemsAction(
  buyerCompanyId: string, purchaseRequestId: string,
  _previousState: PurchaseActionState,
): Promise<PurchaseActionState> {
  void _previousState;
  return executeFlow({ kind: "retry", buyerCompanyId, requestId: purchaseRequestId, operationId: randomUUID() });
}
