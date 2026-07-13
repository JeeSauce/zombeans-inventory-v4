"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  recipeCreateSchema,
  recipeLineSchema,
  recipeVersionSchema,
  type RecipeScope,
} from "@/lib/validation/recipes";

export type RecipeActionState = { error?: string; info?: string };
function cleanError(message: string): string {
  return message.replace(/^.*?:\s*/, "");
}

async function productItemId(productId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("item_id").eq("id", productId).single();
  return (data?.item_id as string | undefined) ?? null;
}

async function resolveTarget(
  scope: RecipeScope,
  outputItemId: string | undefined,
  targetId: string | undefined,
): Promise<{
  kind: "production" | "sale" | "modifier";
  outputItemId: string;
  productId: string | null;
  variantId: string | null;
  modifierOptionId: string | null;
} | null> {
  if (scope === "production" && outputItemId) {
    return {
      kind: "production",
      outputItemId,
      productId: null,
      variantId: null,
      modifierOptionId: null,
    };
  }
  if (!targetId) return null;

  const supabase = await createClient();
  if (scope === "sale_product") {
    const itemId = await productItemId(targetId);
    return itemId
      ? {
          kind: "sale",
          outputItemId: itemId,
          productId: targetId,
          variantId: null,
          modifierOptionId: null,
        }
      : null;
  }
  if (scope === "sale_variant") {
    const { data: variant } = await supabase
      .from("product_variants")
      .select("product_id")
      .eq("id", targetId)
      .single();
    const itemId = variant?.product_id ? await productItemId(variant.product_id as string) : null;
    return itemId
      ? {
          kind: "sale",
          outputItemId: itemId,
          productId: null,
          variantId: targetId,
          modifierOptionId: null,
        }
      : null;
  }

  const { data: option } = await supabase
    .from("modifier_options")
    .select("modifier_id")
    .eq("id", targetId)
    .single();
  if (!option?.modifier_id) return null;
  const { data: modifier } = await supabase
    .from("modifiers")
    .select("product_id")
    .eq("id", option.modifier_id as string)
    .single();
  const itemId = modifier?.product_id ? await productItemId(modifier.product_id as string) : null;
  return itemId
    ? {
        kind: "modifier",
        outputItemId: itemId,
        productId: null,
        variantId: null,
        modifierOptionId: targetId,
      }
    : null;
}

export async function createRecipeAction(
  _previous: RecipeActionState,
  formData: FormData,
): Promise<RecipeActionState> {
  const { user } = await requirePermission("recipe.write");
  const parsed = recipeCreateSchema.safeParse({
    name: formData.get("name"),
    scope: formData.get("scope"),
    outputItemId: formData.get("outputItemId") || undefined,
    targetId: formData.get("targetId") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid recipe" };

  const target = await resolveTarget(
    parsed.data.scope,
    parsed.data.outputItemId,
    parsed.data.targetId,
  );
  if (!target) return { error: "The selected recipe target could not be resolved." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recipes")
    .insert({
      name: parsed.data.name,
      kind: target.kind,
      output_item_id: target.outputItemId,
      product_id: target.productId,
      variant_id: target.variantId,
      modifier_option_id: target.modifierOptionId,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { error: cleanError(error.message) };

  await writeAudit({
    actorId: user.id,
    action: "recipe.created",
    entityType: "recipe",
    entityId: data.id,
    after: { name: parsed.data.name, scope: parsed.data.scope },
  });
  revalidatePath("/recipes");
  return { info: `Created ${parsed.data.name}.` };
}

export async function createRecipeVersionAction(
  recipeId: string,
  _previous: RecipeActionState,
  formData: FormData,
): Promise<RecipeActionState> {
  const { user } = await requirePermission("recipe.write");
  const parsed = recipeVersionSchema.safeParse({
    recipeId,
    outputQty: formData.get("outputQty"),
    outputUnitId: formData.get("outputUnitId"),
    expectedYieldPct: formData.get("expectedYieldPct") || 100,
    expectedWastePct: formData.get("expectedWastePct") || 0,
    effectiveDate: formData.get("effectiveDate") || undefined,
    prepNotes: formData.get("prepNotes") || null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid version" };

  const supabase = await createClient();
  const { data: latest, error: latestError } = await supabase
    .from("recipe_versions")
    .select("version_number")
    .eq("recipe_id", recipeId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) return { error: cleanError(latestError.message) };
  const versionNumber = Number(latest?.version_number ?? 0) + 1;

  const { data, error } = await supabase
    .from("recipe_versions")
    .insert({
      recipe_id: recipeId,
      version_number: versionNumber,
      output_qty: parsed.data.outputQty,
      output_unit_id: parsed.data.outputUnitId,
      expected_yield_pct: parsed.data.expectedYieldPct,
      expected_waste_pct: parsed.data.expectedWastePct,
      effective_date: parsed.data.effectiveDate,
      prep_notes: parsed.data.prepNotes ?? null,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { error: cleanError(error.message) };

  await writeAudit({
    actorId: user.id,
    action: "recipe.version.created",
    entityType: "recipe_version",
    entityId: data.id,
    after: { recipeId, versionNumber },
  });
  revalidatePath(`/recipes/${recipeId}`);
  return { info: `Created draft version ${versionNumber}.` };
}

export async function addRecipeLineAction(
  recipeId: string,
  recipeVersionId: string,
  _previous: RecipeActionState,
  formData: FormData,
): Promise<RecipeActionState> {
  const { user } = await requirePermission("recipe.write");
  const parsed = recipeLineSchema.safeParse({
    recipeVersionId,
    inputItemId: formData.get("inputItemId"),
    qty: formData.get("qty"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid line" };

  const supabase = await createClient();
  const { data: item, error: itemError } = await supabase
    .from("inventory_items")
    .select("item_type")
    .eq("id", parsed.data.inputItemId)
    .single();
  if (itemError || !item) return { error: "The selected input item could not be loaded." };
  const isPackaging = ["packaging", "container"].includes(item.item_type as string);

  const { error } = await supabase.from("recipe_lines").insert({
    recipe_version_id: recipeVersionId,
    input_item_id: parsed.data.inputItemId,
    qty: parsed.data.qty,
    is_packaging: isPackaging,
    created_by: user.id,
    updated_by: user.id,
  });
  if (error) return { error: cleanError(error.message) };

  await writeAudit({
    actorId: user.id,
    action: "recipe.line.added",
    entityType: "recipe_version",
    entityId: recipeVersionId,
    after: { inputItemId: parsed.data.inputItemId, qty: parsed.data.qty },
  });
  revalidatePath(`/recipes/${recipeId}`);
  return { info: "Recipe line added." };
}

export async function removeRecipeLineAction(
  recipeId: string,
  recipeVersionId: string,
  lineId: string,
): Promise<RecipeActionState> {
  const { user } = await requirePermission("recipe.write");
  const supabase = await createClient();
  const { error } = await supabase
    .from("recipe_lines")
    .delete()
    .eq("id", lineId)
    .eq("recipe_version_id", recipeVersionId);
  if (error) return { error: cleanError(error.message) };
  await writeAudit({
    actorId: user.id,
    action: "recipe.line.removed",
    entityType: "recipe_version",
    entityId: recipeVersionId,
  });
  revalidatePath(`/recipes/${recipeId}`);
  return { info: "Recipe line removed." };
}

export async function activateRecipeVersionAction(
  recipeId: string,
  recipeVersionId: string,
): Promise<RecipeActionState> {
  const { user, permissions } = await requirePermission("recipe.write");
  if (!permissions.includes("cost.read")) {
    return { error: "Activating a recipe requires cost.read." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("activate_recipe_version", {
    p_recipe_version_id: recipeVersionId,
  });
  if (error) return { error: cleanError(error.message) };
  const result = data as { snapshot_id?: string; already_active?: boolean } | null;
  await writeAudit({
    actorId: user.id,
    action: "recipe.version.activated",
    entityType: "recipe_version",
    entityId: recipeVersionId,
    after: { recipeId, snapshotId: result?.snapshot_id ?? null },
  });
  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath("/costing");
  return {
    info: result?.already_active ? "Version is already active." : "Recipe version activated.",
  };
}
