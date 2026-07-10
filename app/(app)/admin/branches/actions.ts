"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { branchSchema } from "@/lib/validation/catalog";

export type BranchActionState = { error?: string; info?: string };

function parseBranchForm(formData: FormData) {
  return branchSchema.safeParse({
    key: formData.get("key"),
    name: formData.get("name"),
    isMain: formData.get("isMain") === "on",
    holdsRawIngredients: formData.get("holdsRawIngredients") === "on",
    active: formData.get("active") === "on",
  });
}

/** Create a branch. Super Admin only (settings.manage). RLS is the backstop. */
export async function createBranchAction(
  _prev: BranchActionState,
  formData: FormData,
): Promise<BranchActionState> {
  const { user } = await requirePermission("settings.manage");
  const parsed = parseBranchForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const b = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("branches")
    .insert({
      key: b.key,
      name: b.name,
      is_main: b.isMain,
      holds_raw_ingredients: b.holdsRawIngredients,
      active: b.active,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { error: friendly(error.message) };

  await writeAudit({
    actorId: user.id,
    action: "branch.created",
    entityType: "branch",
    entityId: data.id,
    after: b,
  });
  revalidatePath("/admin/branches");
  return { info: `Created branch ${b.name}.` };
}

/** Update a branch's editable fields. */
export async function updateBranchAction(
  branchId: string,
  _prev: BranchActionState,
  formData: FormData,
): Promise<BranchActionState> {
  const { user } = await requirePermission("settings.manage");
  const parsed = parseBranchForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const b = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("branches")
    .update({
      key: b.key,
      name: b.name,
      is_main: b.isMain,
      holds_raw_ingredients: b.holdsRawIngredients,
      active: b.active,
      updated_by: user.id,
    })
    .eq("id", branchId);
  if (error) return { error: friendly(error.message) };

  await writeAudit({
    actorId: user.id,
    action: "branch.updated",
    entityType: "branch",
    entityId: branchId,
    after: b,
  });
  revalidatePath("/admin/branches");
  return { info: `Updated ${b.name}.` };
}

function friendly(message: string): string {
  if (/branches_key_key|duplicate key/i.test(message)) return "That branch key is already in use.";
  if (/branches_one_main/i.test(message)) return "Another branch is already set as the main branch.";
  return message.replace(/^.*?:\s*/, "");
}
