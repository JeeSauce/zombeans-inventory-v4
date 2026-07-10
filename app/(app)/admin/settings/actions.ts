"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { vatSettingSchema } from "@/lib/validation/catalog";

export type SettingsActionState = { error?: string; info?: string };

/** Update the global VAT config. Super Admin only (settings.manage). Critical scenario 20. */
export async function updateVatAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const { user } = await requirePermission("settings.manage");

  const parsed = vatSettingSchema.safeParse({
    enabled: formData.get("enabled") === "on",
    rate: formData.get("rate"),
    registeredName: formData.get("registeredName"),
    tin: formData.get("tin"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const value = {
    enabled: v.enabled,
    rate: v.rate,
    registered_name: v.registeredName ?? null,
    tin: v.tin ?? null,
  };

  const supabase = await createClient();
  const { error } = await supabase
    .from("application_settings")
    .update({ value, updated_by: user.id })
    .eq("key", "vat");
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };

  await writeAudit({
    actorId: user.id,
    action: "settings.vat.updated",
    entityType: "application_setting",
    entityId: "vat",
    after: value,
  });
  revalidatePath("/admin/settings");
  return {
    info: v.enabled
      ? `VAT enabled at ${(v.rate * 100).toFixed(2)}%.`
      : "VAT disabled. Prices are shown without tax.",
  };
}
