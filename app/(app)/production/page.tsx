import { redirect } from "next/navigation";
import { can, getAuthContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import {
  ProductionListClient,
  type ProductionOrderRow,
  type ProductionRecipeOption,
  type ProductionTemplateRow,
} from "@/components/production/production-list-client";

type RawTemplate = {
  id: string;
  name: string;
  recipe_id: string;
  default_batch_multiplier: string | number;
  default_expiry_days: number | null;
  recipe: {
    name: string;
    output_item: { name: string; sku: string } | null;
  } | null;
};

type RawOrder = {
  id: string;
  reference: string;
  status: ProductionOrderRow["status"];
  planned_output_qty: string | number;
  actual_output_qty: string | number | null;
  created_at: string;
  template: { name: string } | null;
  output_item: { name: string; sku: string } | null;
  output_unit: { code: string } | null;
};

export default async function ProductionPage() {
  const ctx = await getAuthContext();
  const canCreate = can("production.create", ctx.permissions);
  const canView =
    canCreate ||
    can("production.record", ctx.permissions) ||
    can("production.confirm", ctx.permissions);
  if (!canView) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: templatesData }, { data: ordersData }, { data: recipesData }, { data: versionsData }] =
    await Promise.all([
      supabase
        .from("production_templates")
        .select(
          "id, name, recipe_id, default_batch_multiplier, default_expiry_days, recipe:recipes(name, output_item:inventory_items(name, sku))",
        )
        .eq("active", true)
        .is("deleted_at", null)
        .order("name"),
      supabase
        .from("production_orders")
        .select(
          "id, reference, status, planned_output_qty, actual_output_qty, created_at, template:production_templates(name), output_item:inventory_items!production_orders_output_item_id_fkey(name, sku), output_unit:units!production_orders_output_unit_id_fkey(code)",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("recipes")
        .select("id, name, output_item:inventory_items(name, sku)")
        .eq("kind", "production")
        .eq("active", true)
        .is("deleted_at", null)
        .order("name"),
      supabase.from("recipe_versions").select("recipe_id").eq("is_active", true),
    ]);

  const templates: ProductionTemplateRow[] = (
    (templatesData as unknown as RawTemplate[] | null) ?? []
  ).map((template) => ({
    id: template.id,
    name: template.name,
    recipeName: template.recipe?.name ?? "Unknown recipe",
    outputName: template.recipe?.output_item?.name ?? "Unknown output",
    outputSku: template.recipe?.output_item?.sku ?? "—",
    defaultBatchMultiplier: Number(template.default_batch_multiplier),
    defaultExpiryDays: template.default_expiry_days,
  }));
  const orders: ProductionOrderRow[] = ((ordersData as unknown as RawOrder[] | null) ?? []).map(
    (order) => ({
      id: order.id,
      reference: order.reference,
      status: order.status,
      templateName: order.template?.name ?? "Unknown template",
      outputName: order.output_item?.name ?? "Unknown output",
      outputSku: order.output_item?.sku ?? "—",
      unitCode: order.output_unit?.code ?? "unit",
      plannedOutputQty: Number(order.planned_output_qty),
      actualOutputQty:
        order.actual_output_qty === null ? null : Number(order.actual_output_qty),
      createdAt: order.created_at,
    }),
  );

  const activeRecipeIds = new Set(
    ((versionsData as { recipe_id: string }[] | null) ?? []).map((version) => version.recipe_id),
  );
  const templatedRecipeIds = new Set(
    ((templatesData as unknown as RawTemplate[] | null) ?? []).map((template) => template.recipe_id),
  );
  type RawRecipe = { id: string; name: string; output_item: { name: string; sku: string } | null };
  const recipeOptions: ProductionRecipeOption[] = (
    (recipesData as unknown as RawRecipe[] | null) ?? []
  )
    .filter((recipe) => activeRecipeIds.has(recipe.id) && !templatedRecipeIds.has(recipe.id))
    .map((recipe) => ({
      id: recipe.id,
      label: `${recipe.name} · ${recipe.output_item?.name ?? "Unknown output"} (${recipe.output_item?.sku ?? "—"})`,
    }));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Main commissary</p>
        <h1 className="font-display mt-1 text-3xl">Production</h1>
        <p className="text-muted-foreground mt-1">
          Plan from active recipe versions, record actual yield and waste, then confirm one atomic
          FEFO inventory posting.
        </p>
      </div>
      <ProductionListClient
        orders={orders}
        templates={templates}
        recipeOptions={recipeOptions}
        canCreate={canCreate}
      />
    </div>
  );
}
