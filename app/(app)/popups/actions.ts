"use server";

import { revalidatePath } from "next/cache";
import { manilaLocalToUtc } from "@/lib/calendar/time";
import { requirePermission } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  popupCancelSchema,
  popupCommandSchema,
  popupCountSchema,
  popupCreateSchema,
  popupStockMovementLinkSchema,
  popupTransferLinkSchema,
} from "@/lib/validation/phase8";

export type PopupActionState = { error?: string; info?: string; entityId?: string };

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Popup command failed.";
  return message
    .replace(/^.*?:\s*/, "")
    .replace(/Permission denied: /i, "You do not have permission: ");
}

function revalidatePopup(id?: string) {
  revalidatePath("/popups");
  if (id) revalidatePath(`/popups/${id}`);
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}

export async function createPopupEventAction(
  _previous: PopupActionState,
  formData: FormData,
): Promise<PopupActionState> {
  try {
    await requirePermission("calendar.manage");
    const parsed = popupCreateSchema.safeParse({
      title: formData.get("title"),
      description: formData.get("description"),
      location: formData.get("location"),
      startsAtLocal: formData.get("startsAtLocal"),
      endsAtLocal: formData.get("endsAtLocal"),
      popupBranchId: formData.get("popupBranchId"),
      returnBranchId: formData.get("returnBranchId"),
      notes: formData.get("notes"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    if (!parsed.success)
      return { error: parsed.error.issues[0]?.message ?? "Invalid popup event." };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_popup_event", {
      p_title: parsed.data.title,
      p_description: parsed.data.description ?? null,
      p_location: parsed.data.location ?? null,
      p_starts_at: manilaLocalToUtc(parsed.data.startsAtLocal),
      p_ends_at: manilaLocalToUtc(parsed.data.endsAtLocal),
      p_popup_branch_id: parsed.data.popupBranchId,
      p_return_branch_id: parsed.data.returnBranchId,
      p_notes: parsed.data.notes ?? null,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (error) return { error: cleanError(error) };
    const result = data as { popup_event_id: string; reference: string; replayed: boolean };
    revalidatePopup(result.popup_event_id);
    return {
      info: result.replayed
        ? `${result.reference} already exists.`
        : `Created ${result.reference}.`,
      entityId: result.popup_event_id,
    };
  } catch (error) {
    return { error: cleanError(error) };
  }
}

async function runPopupCommand(
  rpc: "start_popup_event" | "complete_popup_event",
  formData: FormData,
  success: string,
): Promise<PopupActionState> {
  try {
    await requirePermission("calendar.manage");
    const parsed = popupCommandSchema.safeParse({
      popupEventId: formData.get("popupEventId"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    if (!parsed.success)
      return { error: parsed.error.issues[0]?.message ?? "Invalid popup command." };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(rpc, {
      p_popup_event_id: parsed.data.popupEventId,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (error) return { error: cleanError(error) };
    const result = data as { reference: string; replayed: boolean };
    revalidatePopup(parsed.data.popupEventId);
    return {
      info: result.replayed ? `${result.reference} already processed this command.` : success,
      entityId: parsed.data.popupEventId,
    };
  } catch (error) {
    return { error: cleanError(error) };
  }
}

export async function startPopupEventAction(
  _previous: PopupActionState,
  formData: FormData,
): Promise<PopupActionState> {
  return runPopupCommand("start_popup_event", formData, "Popup event started.");
}

export async function completePopupEventAction(
  _previous: PopupActionState,
  formData: FormData,
): Promise<PopupActionState> {
  return runPopupCommand("complete_popup_event", formData, "Popup summary frozen and completed.");
}

export async function cancelPopupEventAction(
  _previous: PopupActionState,
  formData: FormData,
): Promise<PopupActionState> {
  try {
    await requirePermission("calendar.manage");
    const parsed = popupCancelSchema.safeParse({
      popupEventId: formData.get("popupEventId"),
      reason: formData.get("reason"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    if (!parsed.success)
      return { error: parsed.error.issues[0]?.message ?? "Invalid cancellation." };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("cancel_popup_event", {
      p_popup_event_id: parsed.data.popupEventId,
      p_reason: parsed.data.reason,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (error) return { error: cleanError(error) };
    const result = data as { reference: string; replayed: boolean };
    revalidatePopup(parsed.data.popupEventId);
    return {
      info: result.replayed
        ? `${result.reference} was already cancelled.`
        : "Popup event cancelled.",
    };
  } catch (error) {
    return { error: cleanError(error) };
  }
}

export async function recordPopupCountAction(
  _previous: PopupActionState,
  formData: FormData,
): Promise<PopupActionState> {
  try {
    await requirePermission("calendar.manage");
    let lines: unknown = [];
    try {
      lines = JSON.parse(String(formData.get("lines") ?? "[]"));
    } catch {
      return { error: "Popup count lines are invalid." };
    }
    const parsed = popupCountSchema.safeParse({
      popupEventId: formData.get("popupEventId"),
      idempotencyKey: formData.get("idempotencyKey"),
      lines,
    });
    if (!parsed.success)
      return { error: parsed.error.issues[0]?.message ?? "Invalid popup count." };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("record_popup_event_count", {
      p_popup_event_id: parsed.data.popupEventId,
      p_idempotency_key: parsed.data.idempotencyKey,
      p_lines: parsed.data.lines.map((line) => ({
        item_id: line.itemId,
        unit_id: line.unitId,
        transferred_in_qty: line.transferredInQty,
        remaining_qty: line.remainingQty,
        returned_qty: line.returnedQty,
        consumed_qty: line.consumedQty,
        waste_qty: line.wasteQty,
        loss_qty: line.lossQty,
        gain_qty: line.gainQty,
        ending_qty: line.endingQty,
        notes: line.notes ?? null,
      })),
    });
    if (error) return { error: cleanError(error) };
    const result = data as { reference: string; replayed: boolean };
    revalidatePopup(parsed.data.popupEventId);
    return {
      info: result.replayed
        ? `${result.reference} count was already saved.`
        : "Popup count saved for reconciliation.",
    };
  } catch (error) {
    return { error: cleanError(error) };
  }
}

export async function linkPopupTransferAction(
  _previous: PopupActionState,
  formData: FormData,
): Promise<PopupActionState> {
  try {
    await requirePermission("calendar.manage");
    const parsed = popupTransferLinkSchema.safeParse({
      popupEventId: formData.get("popupEventId"),
      transferId: formData.get("transferId"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    if (!parsed.success)
      return { error: parsed.error.issues[0]?.message ?? "Invalid transfer link." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("link_popup_transfer", {
      p_popup_event_id: parsed.data.popupEventId,
      p_transfer_id: parsed.data.transferId,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (error) return { error: cleanError(error) };
    revalidatePopup(parsed.data.popupEventId);
    return { info: "Transfer linked to this popup event." };
  } catch (error) {
    return { error: cleanError(error) };
  }
}

export async function linkPopupStockMovementAction(
  _previous: PopupActionState,
  formData: FormData,
): Promise<PopupActionState> {
  try {
    await requirePermission("calendar.manage");
    const parsed = popupStockMovementLinkSchema.safeParse({
      popupEventId: formData.get("popupEventId"),
      stockTxnId: formData.get("stockTxnId"),
      movementType: formData.get("movementType"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid stock link." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("link_popup_stock_movement", {
      p_popup_event_id: parsed.data.popupEventId,
      p_stock_txn_id: parsed.data.stockTxnId,
      p_movement_type: parsed.data.movementType,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (error) return { error: cleanError(error) };
    revalidatePopup(parsed.data.popupEventId);
    return { info: "Posted ledger movement linked to this popup summary." };
  } catch (error) {
    return { error: cleanError(error) };
  }
}
