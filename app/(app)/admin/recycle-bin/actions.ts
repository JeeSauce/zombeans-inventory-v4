"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  purgeCommandSchema,
  recycleCommandSchema,
  type RecycleEntityType,
} from "@/lib/validation/phase9";

export type RecycleActionState = { error?: string; info?: string };

const ENTITY_PERMISSIONS: Record<RecycleEntityType, string> = {
  category: "catalog.item.write",
  inventory_item: "catalog.item.write",
  supplier: "supplier.write",
  purchase_order: "purchase.create",
  recipe: "recipe.write",
  production_template: "production.create",
};

function cleanError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : "";
  if (/permission denied/i.test(message)) return "You do not have permission for this command.";
  if (/authentication required/i.test(message)) return "Your session expired. Sign in again.";
  if (/business record not found/i.test(message)) return "The selected record no longer exists.";
  if (/already in the recycle bin/i.test(message))
    return "That record is already in the recycle bin.";
  if (/not in the recycle bin/i.test(message))
    return "That record is no longer in the recycle bin.";
  if (/only draft or cancelled purchase orders/i.test(message)) {
    return "Only draft or cancelled purchase orders can be recycled.";
  }
  if (/idempotency key already belongs/i.test(message)) {
    return "This command token was already used for another operation. Refresh and try again.";
  }
  return "The recycle-bin command could not be completed safely.";
}

function revalidateLifecycle() {
  [
    "/admin/recycle-bin",
    "/catalog/items",
    "/catalog/products",
    "/purchasing/suppliers",
    "/purchasing/orders",
    "/recipes",
    "/production",
    "/reports",
  ].forEach((path) => revalidatePath(path));
}

export async function softDeleteRecordAction(
  _previous: RecycleActionState,
  formData: FormData,
): Promise<RecycleActionState> {
  try {
    const [entityType, entityId] = String(formData.get("record") ?? "").split("|");
    const parsed = recycleCommandSchema.safeParse({
      entityType,
      entityId,
      reason: formData.get("reason"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid record." };

    await requirePermission(ENTITY_PERMISSIONS[parsed.data.entityType]);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("soft_delete_record", {
      p_entity_type: parsed.data.entityType,
      p_entity_id: parsed.data.entityId,
      p_reason: parsed.data.reason,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (error) return { error: cleanError(error) };
    const result = data as { label: string; replayed: boolean };
    revalidateLifecycle();
    return {
      info: result.replayed
        ? `${result.label} was already moved to the recycle bin.`
        : `${result.label} moved to the recycle bin for 30 days.`,
    };
  } catch (error) {
    return { error: cleanError(error) };
  }
}

export async function restoreRecycleRecordAction(
  _previous: RecycleActionState,
  formData: FormData,
): Promise<RecycleActionState> {
  try {
    const parsed = recycleCommandSchema.safeParse({
      entityType: formData.get("entityType"),
      entityId: formData.get("entityId"),
      reason: formData.get("reason"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid restore." };

    await requirePermission("recyclebin.restore");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("restore_recycle_record", {
      p_entity_type: parsed.data.entityType,
      p_entity_id: parsed.data.entityId,
      p_reason: parsed.data.reason,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (error) return { error: cleanError(error) };
    const result = data as { label: string; replayed: boolean };
    revalidateLifecycle();
    return {
      info: result.replayed ? `${result.label} was already restored.` : `${result.label} restored.`,
    };
  } catch (error) {
    return { error: cleanError(error) };
  }
}

export async function purgeRecycleBinAction(
  _previous: RecycleActionState,
  formData: FormData,
): Promise<RecycleActionState> {
  try {
    const parsed = purgeCommandSchema.safeParse({
      runKey: formData.get("runKey"),
      limit: formData.get("limit") ?? 100,
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid purge run." };

    await requirePermission("recyclebin.restore");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("purge_recycle_bin", {
      p_run_key: parsed.data.runKey,
      p_limit: parsed.data.limit,
    });
    if (error) return { error: cleanError(error) };
    const result = data as { purgedCount: number; skippedCount: number; replayed: boolean };
    revalidateLifecycle();
    return {
      info: `${result.replayed ? "Replayed" : "Completed"} purge: ${result.purgedCount} purged, ${result.skippedCount} protected.`,
    };
  } catch (error) {
    return { error: cleanError(error) };
  }
}
