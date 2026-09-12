"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  requireBuyerActor,
  requireDemoCompanyActor,
} from "@/lib/demo-workspace";
import { toDomainError } from "@/lib/domain/errors";
import { protocolMessageSchema } from "@/modules/protocol/domain/message";
import type { NegotiationActionState } from "@/modules/protocol/actions/action-state";
import {
  appendProtocolMessage,
  generateOfferRecommendation,
} from "@/modules/protocol/services/negotiations";
import { launchPurchaseFlow } from "@/modules/protocol/services/purchase-flow";

export async function sendProtocolMessageAction(
  senderCompanyId: string,
  _previousState: NegotiationActionState,
  formData: FormData,
): Promise<NegotiationActionState> {
  void _previousState;
  try {
    const actor = await requireDemoCompanyActor(senderCompanyId);
    const rawMessage = JSON.parse(String(formData.get("message") ?? "{}"));
    const message = protocolMessageSchema.parse(rawMessage);
    const result = await appendProtocolMessage(actor, message);
    revalidatePath("/protocol");
    return {
      ok: true,
      message: result.duplicate ? "Mensaje ya procesado." : "Mensaje enviado.",
      data: result,
    };
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      return { ok: false, message: "El mensaje no cumple el protocolo v1.0." };
    }
    return { ok: false, message: toDomainError(error).message };
  }
}

export async function runTenderAgentsAction(
  buyerCompanyId: string,
  purchaseRequestId: string,
  _previousState: NegotiationActionState,
  _formData: FormData,
): Promise<NegotiationActionState> {
  void _previousState;
  void _formData;

  try {
    const result = await launchPurchaseFlow({ kind: "retry", buyerCompanyId, requestId: purchaseRequestId, operationId: randomUUID() });
    revalidatePath("/protocol");
    revalidatePath("/cliente-demo");
    revalidatePath("/distribuidora-norte");
    revalidatePath("/mayorista-andino");
    revalidatePath("/abastecimientos-sur");

    return {
      ok: !result.running && !result.events.some((event) => event.phase === "error"),
      message: `${result.summary.orderCount} pedidos creados; ${result.summary.pendingProducts} productos pendientes.`,
      data: result,
    };
  } catch (error) {
    return { ok: false, message: toDomainError(error).message };
  }
}

export async function generateRecommendationAction(
  buyerCompanyId: string,
  purchaseRequestId: string,
  _previousState: NegotiationActionState,
  _formData: FormData,
): Promise<NegotiationActionState> {
  void _previousState;
  void _formData;
  try {
    const actor = await requireBuyerActor(buyerCompanyId);
    const recommendation = await generateOfferRecommendation(actor, purchaseRequestId);
    revalidatePath("/protocol");
    return { ok: true, message: recommendation.summary, data: recommendation };
  } catch (error) {
    return { ok: false, message: toDomainError(error).message };
  }
}
