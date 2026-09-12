"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireBuyerActor } from "@/lib/demo-workspace";
import { toDomainError } from "@/lib/domain/errors";
import type { ContextActionState } from "@/modules/context/action-state";
import { recordInventorySnapshot, recordSale } from "@/modules/context/service";

function toIso(value: FormDataEntryValue | null) {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? "invalid" : date.toISOString();
}

export async function recordInventorySnapshotAction(
  companyId: string,
  _previousState: ContextActionState,
  formData: FormData,
): Promise<ContextActionState> {
  void _previousState;
  try {
    const actor = await requireBuyerActor(companyId);
    await recordInventorySnapshot(actor, {
      companyId,
      sourceKind: "ERP",
      sourceExternalId: String(formData.get("sourceExternalId") ?? ""),
      sourceVersion: String(formData.get("sourceVersion") ?? ""),
      observedAt: toIso(formData.get("observedAt")),
      productExternalId: String(formData.get("productExternalId") ?? ""),
      productName: String(formData.get("productName") ?? ""),
      unit: String(formData.get("unit") ?? "unit"),
      onHand: String(formData.get("onHand") ?? ""),
      reserved: String(formData.get("reserved") ?? "0"),
      inTransit: String(formData.get("inTransit") ?? "0"),
    });
    revalidatePath("/context");
    return { ok: true, message: "Inventario actualizado." };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, message: "Revisá los datos de inventario." };
    }
    return { ok: false, message: toDomainError(error).message };
  }
}

export async function recordSaleAction(
  companyId: string,
  _previousState: ContextActionState,
  formData: FormData,
): Promise<ContextActionState> {
  void _previousState;
  try {
    const actor = await requireBuyerActor(companyId);
    await recordSale(actor, {
      companyId,
      sourceKind: "ERP",
      sourceExternalId: String(formData.get("sourceExternalId") ?? ""),
      sourceVersion: String(formData.get("sourceVersion") ?? ""),
      observedAt: toIso(formData.get("soldAt")),
      externalEventId: String(formData.get("externalEventId") ?? ""),
      productExternalId: String(formData.get("productExternalId") ?? ""),
      productName: String(formData.get("productName") ?? ""),
      unit: String(formData.get("unit") ?? "unit"),
      quantity: String(formData.get("quantity") ?? ""),
      unitPrice: String(formData.get("unitPrice") ?? ""),
      soldAt: toIso(formData.get("soldAt")),
    });
    revalidatePath("/context");
    return { ok: true, message: "Venta registrada." };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, message: "Revisá los datos de la venta." };
    }
    return { ok: false, message: toDomainError(error).message };
  }
}
