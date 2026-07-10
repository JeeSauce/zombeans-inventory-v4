"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { inventoryItemSchema } from "@/lib/validation/catalog";

export type ItemActionState = { error?: string; info?: string };

function nullableUuid(v: FormDataEntryValue | null): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
}
function nullableNumber(v: FormDataEntryValue | null): number | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? Number(s) : null;
}

/** Create an inventory item with an auto-generated SKU. catalog.item.write. */
export async function createItemAction(
  _prev: ItemActionState,
  formData: FormData,
): Promise<ItemActionState> {
  const { user } = await requirePermission("catalog.item.write");

  const parsed = inventoryItemSchema.safeParse({
    name: formData.get("name"),
    itemType: formData.get("itemType"),
    categoryId: nullableUuid(formData.get("categoryId")),
    baseUnitId: formData.get("baseUnitId"),
    purchaseUnitId: nullableUuid(formData.get("purchaseUnitId")),
    lowStockThreshold: nullableNumber(formData.get("lowStockThreshold")),
    reorderLevel: nullableNumber(formData.get("reorderLevel")),
    trackable: formData.get("trackable") === "on",
    batchTracked: formData.get("batchTracked") === "on",
    expiryTracked: formData.get("expiryTracked") === "on",
    isConsumable: formData.get("isConsumable") === "on",
    storageNotes: formData.get("storageNotes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const it = parsed.data;

  const supabase = await createClient();
  const { data: sku, error: skuErr } = await supabase.rpc("next_item_sku");
  if (skuErr || !sku) return { error: "Could not generate a SKU. Try again." };

  const { data, error } = await supabase
    .from("inventory_items")
    .insert({
      name: it.name,
      sku: sku as string,
      item_type: it.itemType,
      category_id: it.categoryId,
      base_unit_id: it.baseUnitId,
      purchase_unit_id: it.purchaseUnitId,
      low_stock_threshold: it.lowStockThreshold,
      reorder_level: it.reorderLevel,
      trackable: it.trackable,
      batch_tracked: it.batchTracked,
      expiry_tracked: it.expiryTracked,
      is_consumable: it.isConsumable,
      storage_notes: it.storageNotes ?? null,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id, sku")
    .single();
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };

  await writeAudit({
    actorId: user.id,
    action: "item.created",
    entityType: "inventory_item",
    entityId: data.id,
    after: { sku: data.sku, ...it },
  });
  revalidatePath("/catalog/items");
  return { info: `Created ${it.name} (${data.sku}).` };
}
