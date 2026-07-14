import { redirect } from "next/navigation";
import { RecycleBinClient, type RecycleCandidate } from "@/components/admin/recycle-bin-client";
import { can, getAuthContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { recycleBinEntrySchema, type RecycleEntityType } from "@/lib/validation/phase9";
import { z } from "zod";

export default async function RecycleBinPage() {
  const auth = await getAuthContext();
  if (!can("recyclebin.restore", auth.permissions)) redirect("/dashboard");

  const supabase = await createClient();
  const [recycleResult, categories, items, suppliers, orders, recipes, templates] =
    await Promise.all([
      supabase.rpc("list_recycle_bin"),
      supabase.from("categories").select("id, name").is("deleted_at", null).order("name"),
      supabase.from("inventory_items").select("id, name, sku").is("deleted_at", null).order("name"),
      supabase.from("suppliers").select("id, name").is("deleted_at", null).order("name"),
      supabase
        .from("purchase_orders")
        .select("id, reference, status")
        .is("deleted_at", null)
        .in("status", ["draft", "cancelled"])
        .order("reference"),
      supabase.from("recipes").select("id, name").is("deleted_at", null).order("name"),
      supabase.from("production_templates").select("id, name").is("deleted_at", null).order("name"),
    ]);
  const results = [recycleResult, categories, items, suppliers, orders, recipes, templates];
  const failure = results.find((result) => result.error)?.error;
  if (failure) throw new Error(failure.message);

  const parsedEntries = z.array(recycleBinEntrySchema).safeParse(recycleResult.data ?? []);
  if (!parsedEntries.success) throw new Error("Recycle-bin data did not match its safe contract.");

  const candidates: RecycleCandidate[] = [];
  const add = (
    type: RecycleEntityType,
    records: { id: string; name?: string; sku?: string; reference?: string }[] | null,
  ) => {
    for (const record of records ?? []) {
      candidates.push({
        entityType: type,
        entityId: record.id,
        label:
          record.reference ??
          (record.sku ? `${record.sku} — ${record.name}` : (record.name ?? "Record")),
      });
    }
  };
  add("category", categories.data);
  add("inventory_item", items.data);
  add("supplier", suppliers.data);
  add("purchase_order", orders.data);
  add("recipe", recipes.data);
  add("production_template", templates.data);
  candidates.sort((left, right) => left.label.localeCompare(right.label));

  return (
    <main className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <p className="text-muted-foreground text-sm">Super Admin</p>
        <h1 className="font-heading text-2xl font-semibold sm:text-3xl">Recycle bin</h1>
        <p className="text-muted-foreground mt-2 max-w-3xl text-sm">
          Reversible business-record deletion, dependency-aware retention, and audited recovery.
        </p>
      </div>
      <RecycleBinClient entries={parsedEntries.data} candidates={candidates} />
    </main>
  );
}
