import { describe, it, expect } from "vitest";
import { buildItemUpdatePayload } from "@/lib/catalog/item-update";
import type { InventoryItemInput } from "@/lib/validation/catalog";

const base: InventoryItemInput = {
  name: "Milo",
  itemType: "raw_ingredient",
  categoryId: "11111111-1111-1111-1111-111111111111",
  baseUnitId: "22222222-2222-2222-2222-222222222222",
  purchaseUnitId: null,
  lowStockThreshold: 5,
  reorderLevel: 10,
  trackable: true,
  batchTracked: false,
  expiryTracked: false,
  isConsumable: true,
  storageNotes: "Dry store",
};

describe("buildItemUpdatePayload", () => {
  it("maps editable fields to DB columns", () => {
    const p = buildItemUpdatePayload(base, { active: true, actorId: "actor-1" });
    expect(p).toEqual({
      name: "Milo",
      category_id: "11111111-1111-1111-1111-111111111111",
      purchase_unit_id: null,
      low_stock_threshold: 5,
      reorder_level: 10,
      trackable: true,
      batch_tracked: false,
      expiry_tracked: false,
      is_consumable: true,
      storage_notes: "Dry store",
      active: true,
      updated_by: "actor-1",
    });
  });

  it("never includes locked columns even though input carries them", () => {
    const p = buildItemUpdatePayload(base, { active: false, actorId: "a" }) as unknown as Record<
      string,
      unknown
    >;
    expect("item_type" in p).toBe(false);
    expect("base_unit_id" in p).toBe(false);
    expect(p.active).toBe(false);
  });

  it("normalizes nullish optionals to null", () => {
    const p = buildItemUpdatePayload(
      {
        ...base,
        categoryId: null,
        purchaseUnitId: null,
        lowStockThreshold: null,
        reorderLevel: null,
        storageNotes: null,
      },
      { active: true, actorId: "a" },
    );
    expect(p.category_id).toBeNull();
    expect(p.low_stock_threshold).toBeNull();
    expect(p.storage_notes).toBeNull();
  });
});
