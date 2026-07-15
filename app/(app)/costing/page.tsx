import { redirect } from "next/navigation";
import { can, getAuthContext } from "@/lib/auth/context";
import {
  calculateSellingMetrics,
  normalizeRecipeCost,
  type RecipeCostResult,
} from "@/lib/recipes/costing";
import { createClient } from "@/lib/supabase/server";
import { CostingDashboard, type CostingRow } from "@/components/recipes/costing-dashboard";

type RawRecipe = {
  id: string;
  name: string;
  kind: "production" | "sale" | "modifier";
  product_id: string | null;
  variant_id: string | null;
  modifier_option_id: string | null;
  output_item: { name: string } | null;
};

type RawPrice = {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  price: string | number;
  branch: { name: string } | null;
};

type RawBatchCost = {
  recipe_version_id: string;
  cost: unknown | null;
  error: string | null;
};

export default async function CostingPage() {
  const ctx = await getAuthContext();
  if (!ctx.isSuperAdmin || !can("cost.read", ctx.permissions)) redirect("/dashboard");
  const supabase = await createClient();

  const [
    { data: recipesData },
    { data: versionsData },
    { data: pricesData },
    { data: variantsData },
    { data: modifierOptionsData },
  ] = await Promise.all([
    supabase
      .from("recipes")
      .select(
        "id, name, kind, product_id, variant_id, modifier_option_id, output_item:inventory_items(name)",
      )
      .eq("active", true)
      .is("deleted_at", null)
      .order("name"),
    supabase.from("recipe_versions").select("id, recipe_id").eq("is_active", true),
    supabase
      .from("branch_prices")
      .select("id, product_id, variant_id, price, branch:branches(name)")
      .eq("active", true),
    supabase.from("product_variants").select("id, name"),
    supabase.from("modifier_options").select("id, name, price_delta, modifier:modifiers(name)"),
  ]);

  const recipes = (recipesData as unknown as RawRecipe[] | null) ?? [];
  const activeVersions = (versionsData as { id: string; recipe_id: string }[] | null) ?? [];
  const prices = (pricesData as unknown as RawPrice[] | null) ?? [];
  const variantLabels = new Map(
    ((variantsData as { id: string; name: string }[] | null) ?? []).map((variant) => [
      variant.id,
      variant.name,
    ]),
  );
  type RawModifierOption = {
    id: string;
    name: string;
    price_delta: string | number;
    modifier: { name: string } | null;
  };
  const modifierOptions = (modifierOptionsData as unknown as RawModifierOption[] | null) ?? [];
  const modifierById = new Map(modifierOptions.map((option) => [option.id, option]));

  const costs = new Map<string, RecipeCostResult>();
  const costErrors: string[] = [];

  if (activeVersions.length > 0) {
    const recipeByVersion = new Map(
      activeVersions.map((version) => [version.id, version.recipe_id]),
    );
    const { data, error } = await supabase.rpc("calculate_recipe_cost_batch", {
      p_recipe_version_ids: activeVersions.map((version) => version.id),
    });

    if (error) {
      costErrors.push(`Cost calculation unavailable (${error.message.replace(/^.*?:\s*/, "")})`);
    } else {
      for (const entry of (data as RawBatchCost[] | null) ?? []) {
        const recipeId = recipeByVersion.get(entry.recipe_version_id);
        const recipeName = recipes.find((recipe) => recipe.id === recipeId)?.name;
        if (!recipeId) {
          costErrors.push("Unknown recipe (batch result did not match an active version)");
          continue;
        }
        if (entry.error) {
          costErrors.push(
            `${recipeName ?? "Unknown recipe"} (${entry.error.replace(/^.*?:\s*/, "")})`,
          );
          continue;
        }
        try {
          costs.set(recipeId, normalizeRecipeCost(entry.cost));
        } catch (error) {
          costErrors.push(
            `${recipeName ?? "Unknown recipe"} (${error instanceof Error ? error.message : "Malformed cost result"})`,
          );
        }
      }
    }
  }

  const rows: CostingRow[] = [];
  for (const recipe of recipes) {
    const cost = costs.get(recipe.id);
    if (!cost) continue;
    const outputName = recipe.output_item?.name ?? "Unknown output";
    const targetLabel = recipe.variant_id
      ? `${outputName} · ${variantLabels.get(recipe.variant_id) ?? "Variant"}`
      : recipe.modifier_option_id
        ? `${outputName} · ${modifierById.get(recipe.modifier_option_id)?.modifier?.name ?? "Modifier"}: ${modifierById.get(recipe.modifier_option_id)?.name ?? "Option"}`
        : outputName;

    if (recipe.kind === "sale") {
      const matchingPrices = prices.filter((price) =>
        recipe.product_id
          ? price.product_id === recipe.product_id
          : price.variant_id === recipe.variant_id,
      );
      if (matchingPrices.length === 0) {
        rows.push({
          id: `${recipe.id}-unpriced`,
          recipeId: recipe.id,
          recipeName: recipe.name,
          kind: recipe.kind,
          targetLabel,
          branchName: "No active branch price",
          ingredientCost: cost.ingredientCost,
          packagingCost: cost.packagingCost,
          wasteCost: cost.wasteCost,
          unitCost: cost.unitCost,
          sellingPrice: null,
          metrics: null,
        });
      } else {
        for (const price of matchingPrices) {
          const sellingPrice = Number(price.price);
          rows.push({
            id: `${recipe.id}-${price.id}`,
            recipeId: recipe.id,
            recipeName: recipe.name,
            kind: recipe.kind,
            targetLabel,
            branchName: price.branch?.name ?? "Unknown branch",
            ingredientCost: cost.ingredientCost,
            packagingCost: cost.packagingCost,
            wasteCost: cost.wasteCost,
            unitCost: cost.unitCost,
            sellingPrice,
            metrics: calculateSellingMetrics(sellingPrice, cost.unitCost),
          });
        }
      }
      continue;
    }

    const modifier = recipe.modifier_option_id
      ? modifierById.get(recipe.modifier_option_id)
      : undefined;
    const sellingPrice = modifier ? Number(modifier.price_delta) : null;
    rows.push({
      id: recipe.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
      kind: recipe.kind,
      targetLabel,
      branchName: recipe.kind === "modifier" ? "Global modifier delta" : "Production",
      ingredientCost: cost.ingredientCost,
      packagingCost: cost.packagingCost,
      wasteCost: cost.wasteCost,
      unitCost: cost.unitCost,
      sellingPrice,
      metrics: sellingPrice === null ? null : calculateSellingMetrics(sellingPrice, cost.unitCost),
    });
  }

  return (
    <div className="mx-auto max-w-[90rem] space-y-6">
      <div>
        <p className="eyebrow text-xs">Recipes &amp; costing</p>
        <h1 className="font-display mt-1 text-3xl">Costing dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Live recipe costs and branch-level selling metrics. Activation snapshots remain unchanged
          when supplier prices or weighted-average costs move later.
        </p>
      </div>
      <CostingDashboard rows={rows} errors={costErrors} />
    </div>
  );
}
