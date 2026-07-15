import type { InventoryItemInput } from "@/lib/validation/catalog";

/**
 * Columns an edit is allowed to change. `item_type` and `base_unit_id` are intentionally
 * excluded: changing base unit silently invalidates recorded quantities, and changing item
 * type can violate recipe-composition rules. This exclusion is the real control — the UI only
 * hides those inputs for convenience.
 */
export interface ItemUpdatePayload {
  name: string;
  category_id: string | null;
  purchase_unit_id: string | null;
  low_stock_threshold: number | null;
  reorder_level: number | null;
  trackable: boolean;
  batch_tracked: boolean;
  expiry_tracked: boolean;
  is_consumable: boolean;
  storage_notes: string | null;
  active: boolean;
  updated_by: string;
}

export function buildItemUpdatePayload(
  input: InventoryItemInput,
  opts: { active: boolean; actorId: string },
): ItemUpdatePayload {
  return {
    name: input.name,
    category_id: input.categoryId ?? null,
    purchase_unit_id: input.purchaseUnitId ?? null,
    low_stock_threshold: input.lowStockThreshold ?? null,
    reorder_level: input.reorderLevel ?? null,
    trackable: input.trackable,
    batch_tracked: input.batchTracked,
    expiry_tracked: input.expiryTracked,
    is_consumable: input.isConsumable,
    storage_notes: input.storageNotes ?? null,
    active: opts.active,
    updated_by: opts.actorId,
  };
}
