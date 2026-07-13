import { redirect } from "next/navigation";
import { can, getAuthContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import {
  RecipesClient,
  type RecipeListRow,
  type RecipeOption,
} from "@/components/recipes/recipes-client";

type RawRecipe = {
  id: string;
  name: string;
  kind: RecipeListRow["kind"];
  product_id: string | null;
  variant_id: string | null;
  modifier_option_id: string | null;
  output_item: { name: string; sku: string } | null;
};

type RawVersion = {
  recipe_id: string;
  version_number: number;
  effective_date: string;
};

export default async function RecipesPage() {
  const ctx = await getAuthContext();
  if (!can("recipe.read", ctx.permissions)) redirect("/dashboard");
  const canWrite = can("recipe.write", ctx.permissions);
  const supabase = await createClient();

  const [
    { data: recipesData },
    { data: activeVersionsData },
    { data: productionItemsData },
    { data: productsData },
    { data: variantsData },
    { data: modifierOptionsData },
  ] = await Promise.all([
    supabase
      .from("recipes")
      .select(
        "id, name, kind, product_id, variant_id, modifier_option_id, output_item:inventory_items(name, sku)",
      )
      .eq("active", true)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("recipe_versions")
      .select("recipe_id, version_number, effective_date")
      .eq("is_active", true),
    supabase
      .from("inventory_items")
      .select("id, name, sku")
      .in("item_type", ["sub_product", "portioned_product", "drink", "food"])
      .eq("active", true)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("products")
      .select("id, item:inventory_items(name, sku)")
      .eq("is_active", true)
      .is("deleted_at", null),
    supabase
      .from("product_variants")
      .select("id, name, sku, product:products(item:inventory_items(name))")
      .eq("is_active", true)
      .is("deleted_at", null),
    supabase
      .from("modifier_options")
      .select("id, name, modifier:modifiers(name, product:products(item:inventory_items(name)))")
      .in("affects", ["inventory", "both"])
      .eq("is_active", true),
  ]);

  const versionsByRecipe = new Map(
    ((activeVersionsData as RawVersion[] | null) ?? []).map((version) => [
      version.recipe_id,
      version,
    ]),
  );

  type RawProduct = { id: string; item: { name: string; sku: string } | null };
  const products: RecipeOption[] = ((productsData as RawProduct[] | null) ?? [])
    .map((product) => ({
      id: product.id,
      label: `${product.item?.name ?? "Unknown product"} (${product.item?.sku ?? "—"})`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const productLabels = new Map(products.map((product) => [product.id, product.label]));

  type RawVariant = {
    id: string;
    name: string;
    sku: string;
    product: { item: { name: string } | null } | null;
  };
  const variants: RecipeOption[] = ((variantsData as unknown as RawVariant[] | null) ?? [])
    .map((variant) => ({
      id: variant.id,
      label: `${variant.product?.item?.name ?? "Unknown product"} · ${variant.name} (${variant.sku})`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const variantLabels = new Map(variants.map((variant) => [variant.id, variant.label]));

  type RawModifierOption = {
    id: string;
    name: string;
    modifier: { name: string; product: { item: { name: string } | null } | null } | null;
  };
  const modifierOptions: RecipeOption[] = (
    (modifierOptionsData as unknown as RawModifierOption[] | null) ?? []
  )
    .map((option) => ({
      id: option.id,
      label: `${option.modifier?.product?.item?.name ?? "Unknown product"} · ${option.modifier?.name ?? "Modifier"}: ${option.name}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const modifierLabels = new Map(modifierOptions.map((option) => [option.id, option.label]));

  type RawProductionItem = { id: string; name: string; sku: string };
  const productionItems: RecipeOption[] = (
    (productionItemsData as RawProductionItem[] | null) ?? []
  ).map((item) => ({ id: item.id, label: `${item.name} (${item.sku})` }));

  const recipes: RecipeListRow[] = ((recipesData as unknown as RawRecipe[] | null) ?? []).map(
    (recipe) => {
      const activeVersion = versionsByRecipe.get(recipe.id);
      const targetLabel = recipe.product_id
        ? (productLabels.get(recipe.product_id) ?? "Product")
        : recipe.variant_id
          ? (variantLabels.get(recipe.variant_id) ?? "Product variant")
          : recipe.modifier_option_id
            ? (modifierLabels.get(recipe.modifier_option_id) ?? "Modifier option")
            : "Production output";
      return {
        id: recipe.id,
        name: recipe.name,
        kind: recipe.kind,
        outputName: recipe.output_item?.name ?? "Unknown output",
        outputSku: recipe.output_item?.sku ?? "—",
        targetLabel,
        activeVersion: activeVersion?.version_number ?? null,
        effectiveDate: activeVersion?.effective_date ?? null,
      };
    },
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Recipes &amp; costing</p>
        <h1 className="font-display mt-1 text-3xl">Recipes</h1>
        <p className="text-muted-foreground mt-1">
          Version production, sale, and modifier recipes. Activated versions are immutable and
          become the source for inventory deductions.
        </p>
      </div>
      <RecipesClient
        recipes={recipes}
        canWrite={canWrite}
        productionItems={productionItems}
        products={products}
        variants={variants}
        modifierOptions={modifierOptions}
      />
    </div>
  );
}
