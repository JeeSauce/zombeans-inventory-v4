import { notFound, redirect } from "next/navigation";
import { can, getAuthContext } from "@/lib/auth/context";
import { normalizeRecipeCost, type RecipeCostResult } from "@/lib/recipes/costing";
import { createClient } from "@/lib/supabase/server";
import {
  RecipeDetailClient,
  type RecipeInputOption,
  type RecipeVersionRow,
} from "@/components/recipes/recipe-detail-client";

type RawRecipe = {
  id: string;
  name: string;
  kind: "production" | "sale" | "modifier";
  product_id: string | null;
  variant_id: string | null;
  modifier_option_id: string | null;
  output_item: {
    name: string;
    sku: string;
    base_unit_id: string;
    base_unit: { code: string } | null;
  } | null;
};

type RawVersion = {
  id: string;
  version_number: number;
  effective_date: string;
  output_qty: string | number;
  expected_yield_pct: string | number;
  expected_waste_pct: string | number;
  is_active: boolean;
  activated_at: string | null;
  prep_notes: string | null;
};

type RawLine = {
  id: string;
  recipe_version_id: string;
  qty: string | number;
  is_packaging: boolean;
  item: {
    name: string;
    sku: string;
    item_type: string;
    base_unit: { code: string } | null;
  } | null;
};

export default async function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (!can("recipe.read", ctx.permissions)) redirect("/dashboard");
  const canWrite = can("recipe.write", ctx.permissions);
  const canReadCost = can("cost.read", ctx.permissions);
  const supabase = await createClient();

  const { data: recipeData } = await supabase
    .from("recipes")
    .select(
      "id, name, kind, product_id, variant_id, modifier_option_id, output_item:inventory_items(name, sku, base_unit_id, base_unit:units!inventory_items_base_unit_id_fkey(code))",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!recipeData) notFound();
  const recipe = recipeData as unknown as RawRecipe;
  if (!recipe.output_item) notFound();

  const [{ data: versionsData }, { data: inputItemsData }] = await Promise.all([
    supabase
      .from("recipe_versions")
      .select(
        "id, version_number, effective_date, output_qty, expected_yield_pct, expected_waste_pct, is_active, activated_at, prep_notes",
      )
      .eq("recipe_id", id)
      .order("version_number", { ascending: false }),
    supabase
      .from("inventory_items")
      .select("id, name, sku, item_type, base_unit:units!inventory_items_base_unit_id_fkey(code)")
      .eq("active", true)
      .is("deleted_at", null)
      .order("name"),
  ]);

  const rawVersions = (versionsData as RawVersion[] | null) ?? [];
  const versionIds = rawVersions.map((version) => version.id);
  let rawLines: RawLine[] = [];
  if (versionIds.length > 0) {
    const { data: linesData } = await supabase
      .from("recipe_lines")
      .select(
        "id, recipe_version_id, qty, is_packaging, item:inventory_items(name, sku, item_type, base_unit:units!inventory_items_base_unit_id_fkey(code))",
      )
      .in("recipe_version_id", versionIds)
      .order("created_at");
    rawLines = (linesData as unknown as RawLine[] | null) ?? [];
  }
  const linesByVersion = new Map<string, RawLine[]>();
  for (const line of rawLines) {
    const existing = linesByVersion.get(line.recipe_version_id) ?? [];
    existing.push(line);
    linesByVersion.set(line.recipe_version_id, existing);
  }

  const outputUnitCode = recipe.output_item.base_unit?.code ?? "base unit";
  const versions: RecipeVersionRow[] = rawVersions.map((version) => ({
    id: version.id,
    versionNumber: version.version_number,
    effectiveDate: version.effective_date,
    outputQty: Number(version.output_qty),
    outputUnitCode,
    expectedYieldPct: Number(version.expected_yield_pct),
    expectedWastePct: Number(version.expected_waste_pct),
    isActive: version.is_active,
    activatedAt: version.activated_at,
    prepNotes: version.prep_notes,
    lines: (linesByVersion.get(version.id) ?? []).map((line) => ({
      id: line.id,
      itemName: line.item?.name ?? "Unknown item",
      itemSku: line.item?.sku ?? "—",
      itemType: line.item?.item_type ?? "unknown",
      qty: Number(line.qty),
      unitCode: line.item?.base_unit?.code ?? "",
      isPackaging: line.is_packaging,
    })),
  }));

  type RawInput = {
    id: string;
    name: string;
    sku: string;
    item_type: string;
    base_unit: { code: string } | null;
  };
  const inputs: RecipeInputOption[] = ((inputItemsData as unknown as RawInput[] | null) ?? []).map(
    (item) => ({
      id: item.id,
      label: `${item.name} (${item.sku})`,
      itemType: item.item_type,
      unitCode: item.base_unit?.code ?? "",
    }),
  );

  let currentCost: RecipeCostResult | null = null;
  let costError: string | null = null;
  const activeVersion = rawVersions.find((version) => version.is_active);
  if (canReadCost && activeVersion) {
    const { data, error } = await supabase.rpc("calculate_recipe_cost", {
      p_recipe_version_id: activeVersion.id,
    });
    if (error) costError = error.message.replace(/^.*?:\s*/, "");
    else {
      try {
        currentCost = normalizeRecipeCost(data);
      } catch (error) {
        costError = error instanceof Error ? error.message : "Recipe cost could not be loaded.";
      }
    }
  }

  let targetLabel = recipe.output_item.name;
  if (recipe.variant_id) {
    const { data } = await supabase
      .from("product_variants")
      .select("name")
      .eq("id", recipe.variant_id)
      .single();
    if (data?.name) targetLabel = `${recipe.output_item.name} · ${data.name}`;
  } else if (recipe.modifier_option_id) {
    const { data } = await supabase
      .from("modifier_options")
      .select("name, modifier:modifiers(name)")
      .eq("id", recipe.modifier_option_id)
      .single();
    const modifier = data?.modifier as { name?: string } | null;
    if (data?.name)
      targetLabel = `${recipe.output_item.name} · ${modifier?.name ?? "Modifier"}: ${data.name}`;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Recipes · {recipe.kind}</p>
        <h1 className="font-display mt-1 text-3xl">{recipe.name}</h1>
        <p className="text-muted-foreground mt-1">
          {targetLabel} · Output {recipe.output_item.sku} in {outputUnitCode}
        </p>
      </div>
      <RecipeDetailClient
        recipeId={recipe.id}
        kind={recipe.kind}
        outputUnitId={recipe.output_item.base_unit_id}
        outputUnitCode={outputUnitCode}
        versions={versions}
        inputs={inputs}
        canWrite={canWrite}
        canReadCost={canReadCost}
        currentCost={currentCost}
        costError={costError}
      />
    </div>
  );
}
