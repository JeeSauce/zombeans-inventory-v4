import { getAuthContext, can } from "@/lib/auth/context";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ItemsClient, type ItemRow, type OptionRow } from "@/components/catalog/items-client";

export default async function ItemsPage() {
  const ctx = await getAuthContext();
  if (!can("catalog.item.read", ctx.permissions)) redirect("/dashboard");
  const canWrite = can("catalog.item.write", ctx.permissions);

  const supabase = await createClient();
  const [{ data: itemsData }, { data: cats }, { data: units }] = await Promise.all([
    supabase
      .from("inventory_items")
      .select(
        "id, name, sku, item_type, active, category:categories(name), base_unit:units!inventory_items_base_unit_id_fkey(code)",
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("categories").select("id, name, item_type").is("deleted_at", null).order("name"),
    supabase.from("units").select("id, code, name").eq("active", true).order("code"),
  ]);

  type Raw = {
    id: string;
    name: string;
    sku: string;
    item_type: ItemRow["itemType"];
    active: boolean;
    category: { name: string } | null;
    base_unit: { code: string } | null;
  };

  const items: ItemRow[] = ((itemsData as Raw[] | null) ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    sku: r.sku,
    itemType: r.item_type,
    active: r.active,
    categoryName: r.category?.name ?? null,
    baseUnit: r.base_unit?.code ?? "—",
  }));

  const categories: (OptionRow & { itemType: string })[] = (
    (cats as { id: string; name: string; item_type: string }[] | null) ?? []
  ).map((c) => ({ id: c.id, label: c.name, itemType: c.item_type }));
  const unitOptions: OptionRow[] = (
    (units as { id: string; code: string; name: string }[] | null) ?? []
  ).map((u) => ({ id: u.id, label: `${u.code} — ${u.name}` }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Catalog</p>
        <h1 className="font-display mt-1 text-3xl">Inventory items</h1>
        <p className="text-muted-foreground mt-1">
          Every stock-keeping item — ingredients, sub-products, packaging, and sellable goods. SKUs
          are generated automatically.
        </p>
      </div>
      <ItemsClient items={items} categories={categories} units={unitOptions} canWrite={canWrite} />
    </div>
  );
}
