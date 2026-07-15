"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { productSchema, TAX_MODES, type TaxMode } from "@/lib/validation/catalog";

export type ProductActionState = { error?: string; info?: string };

/** Create a sellable product together with its underlying inventory item. catalog.item.write. */
export async function createProductAction(
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const { user } = await requirePermission("catalog.item.write");

  const name = String(formData.get("name") ?? "").trim();
  const baseUnitId = String(formData.get("baseUnitId") ?? "").trim();
  if (name.length < 2) return { error: "Enter a product name." };
  if (!baseUnitId) return { error: "Choose a base unit." };

  const parsed = productSchema.pick({ productKind: true, description: true }).safeParse({
    productKind: formData.get("productKind"),
    description: formData.get("description"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { productKind, description } = parsed.data;

  const supabase = await createClient();

  const { data: sku, error: skuErr } = await supabase.rpc("next_item_sku");
  if (skuErr || !sku) return { error: "Could not generate a SKU. Try again." };

  const { data: item, error: itemErr } = await supabase
    .from("inventory_items")
    .insert({
      name,
      sku: sku as string,
      item_type: productKind, // drink | food
      base_unit_id: baseUnitId,
      is_consumable: true,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();
  if (itemErr) return { error: itemErr.message.replace(/^.*?:\s*/, "") };

  const { data: product, error: prodErr } = await supabase
    .from("products")
    .insert({
      item_id: item.id,
      product_kind: productKind,
      description: description ?? null,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();
  if (prodErr) {
    // Roll back the orphaned item (best effort) so a failed product doesn't leave a stray item.
    await supabase.from("inventory_items").delete().eq("id", item.id);
    return { error: prodErr.message.replace(/^.*?:\s*/, "") };
  }

  await writeAudit({
    actorId: user.id,
    action: "product.created",
    entityType: "product",
    entityId: product.id,
    after: { name, sku, productKind },
  });
  revalidatePath("/catalog/products");
  return { info: `Created ${name} (${sku}).` };
}

/**
 * Save per-branch prices for a product in one submit. price.write.
 * A branch with a blank price clears that branch's price; each price is independent (scenario 19).
 * Form fields: price_<branchId>, tax_<branchId>.
 */
export async function setBranchPricesAction(
  productId: string,
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const { user } = await requirePermission("price.write");

  const supabase = await createClient();
  const { data: branches, error: branchErr } = await supabase
    .from("branches")
    .select("id, name")
    .is("deleted_at", null);
  if (branchErr || !branches) return { error: "Could not load branches." };

  const prices: Array<{ branchId: string; price: number | null; taxMode: TaxMode }> = [];
  for (const branch of branches) {
    const raw = formData.get(`price_${branch.id}`);
    const taxRaw = String(formData.get(`tax_${branch.id}`) ?? "none");
    const taxMode: TaxMode = (TAX_MODES as readonly string[]).includes(taxRaw)
      ? (taxRaw as TaxMode)
      : "none";
    const priceStr = typeof raw === "string" ? raw.trim() : "";

    if (priceStr === "") {
      prices.push({ branchId: branch.id, price: null, taxMode });
      continue;
    }

    const price = Number(priceStr);
    if (!Number.isFinite(price) || price < 0) return { error: `Invalid price for ${branch.name}.` };
    prices.push({ branchId: branch.id, price, taxMode });
  }

  const { data: changed, error: priceErr } = await supabase.rpc("set_product_branch_prices", {
    p_product_id: productId,
    p_prices: prices,
  });
  if (priceErr) return { error: priceErr.message.replace(/^.*?:\s*/, "") };

  await writeAudit({
    actorId: user.id,
    action: "product.prices.updated",
    entityType: "product",
    entityId: productId,
    after: { branchesChanged: Number(changed ?? 0) },
  });
  revalidatePath("/catalog/products");
  return { info: Number(changed ?? 0) > 0 ? "Prices saved." : "No changes." };
}
