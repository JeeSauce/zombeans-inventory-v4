import { redirect } from "next/navigation";
import { getAuthContext, can } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { BranchesClient, type BranchRow } from "@/components/admin/branches-client";

export default async function BranchesPage() {
  const ctx = await getAuthContext();
  if (!can("settings.manage", ctx.permissions)) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("branches")
    .select("id, key, name, is_main, holds_raw_ingredients, active")
    .is("deleted_at", null)
    .order("is_main", { ascending: false })
    .order("name", { ascending: true });

  const branches: BranchRow[] = ((data as BranchRow[] | null) ?? []).map((b) => ({
    id: b.id,
    key: b.key,
    name: b.name,
    is_main: b.is_main,
    holds_raw_ingredients: b.holds_raw_ingredients,
    active: b.active,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Administration</p>
        <h1 className="font-display mt-1 text-3xl">Branches</h1>
        <p className="text-muted-foreground mt-1">
          Cafés, restaurants, and the central commissary. Prices and stock are tracked per branch.
        </p>
      </div>
      <BranchesClient branches={branches} />
    </div>
  );
}
