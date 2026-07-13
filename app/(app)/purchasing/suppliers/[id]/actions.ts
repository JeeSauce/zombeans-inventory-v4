"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { supplierItemSchema, supplierPriceSchema } from "@/lib/validation/purchasing";

export type DetailActionState = { error?: string; info?: string };

export async function addSupplierItemAction(
  supplierId: string,
  _p: DetailActionState,
  fd: FormData,
): Promise<DetailActionState> {
  const { user } = await requirePermission("supplier.write");
  const parsed = supplierItemSchema.safeParse({
    supplierId,
    itemId: fd.get("itemId"),
    supplierSku: fd.get("supplierSku") || null,
    packSize: fd.get("packSize") || null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const supabase = await createClient();
  const { error } = await supabase.from("supplier_items").insert({
    supplier_id: supplierId,
    item_id: parsed.data.itemId,
    supplier_sku: parsed.data.supplierSku ?? null,
    pack_size: parsed.data.packSize ?? null,
    created_by: user.id,
    updated_by: user.id,
  });
  if (error)
    return {
      error: /duplicate/i.test(error.message)
        ? "That item is already linked."
        : error.message.replace(/^.*?:\s*/, ""),
    };
  await writeAudit({
    actorId: user.id,
    action: "supplier_item.added",
    entityType: "supplier",
    entityId: supplierId,
    after: parsed.data,
  });
  revalidatePath(`/purchasing/suppliers/${supplierId}`);
  return { info: "Item linked." };
}

export async function addSupplierPriceAction(
  supplierId: string,
  _p: DetailActionState,
  fd: FormData,
): Promise<DetailActionState> {
  const { user } = await requirePermission("supplier_price.write");
  const parsed = supplierPriceSchema.safeParse({
    supplierItemId: fd.get("supplierItemId"),
    price: fd.get("price"),
    currency: fd.get("currency") || "PHP",
    effectiveDate: fd.get("effectiveDate") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const row: Record<string, unknown> = {
    supplier_item_id: parsed.data.supplierItemId,
    price: parsed.data.price,
    currency: parsed.data.currency,
    created_by: user.id,
  };
  if (parsed.data.effectiveDate) row.effective_date = parsed.data.effectiveDate;
  // Sensitive column: `price` is granted-omitted from `authenticated` (migration 0011), so this
  // write must go through the service-role admin client. requirePermission() above is the gate.
  const admin = createAdminClient();
  const { error } = await admin.from("supplier_prices").insert(row);
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  await writeAudit({
    actorId: user.id,
    action: "supplier_price.added",
    entityType: "supplier_item",
    entityId: parsed.data.supplierItemId,
    after: { price: parsed.data.price },
  });
  revalidatePath(`/purchasing/suppliers/${supplierId}`);
  return { info: "Price recorded." };
}
