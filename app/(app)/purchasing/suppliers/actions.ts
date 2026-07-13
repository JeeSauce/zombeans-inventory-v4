"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { supplierSchema } from "@/lib/validation/purchasing";

export type SupplierActionState = { error?: string; info?: string };

function parse(formData: FormData) {
  return supplierSchema.safeParse({
    name: formData.get("name"),
    contactName: formData.get("contactName") || null,
    contactEmail: formData.get("contactEmail") || null,
    contactPhone: formData.get("contactPhone") || null,
    leadTimeDays: formData.get("leadTimeDays") || 0,
    paymentTerms: formData.get("paymentTerms") || null,
    active: formData.get("active") === "on",
  });
}
function fields(s: ReturnType<typeof supplierSchema.parse>) {
  return {
    name: s.name,
    contact_name: s.contactName ?? null,
    contact_email: s.contactEmail ? s.contactEmail : null,
    contact_phone: s.contactPhone ?? null,
    lead_time_days: s.leadTimeDays,
    payment_terms: s.paymentTerms ?? null,
    active: s.active,
  };
}

export async function createSupplierAction(
  _p: SupplierActionState,
  fd: FormData,
): Promise<SupplierActionState> {
  const { user } = await requirePermission("supplier.write");
  const parsed = parse(fd);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .insert({ ...fields(parsed.data), created_by: user.id, updated_by: user.id })
    .select("id")
    .single();
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  await writeAudit({
    actorId: user.id,
    action: "supplier.created",
    entityType: "supplier",
    entityId: data.id,
    after: parsed.data,
  });
  revalidatePath("/purchasing/suppliers");
  return { info: `Created ${parsed.data.name}.` };
}

export async function updateSupplierAction(
  id: string,
  _p: SupplierActionState,
  fd: FormData,
): Promise<SupplierActionState> {
  const { user } = await requirePermission("supplier.write");
  const parsed = parse(fd);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("suppliers")
    .update({ ...fields(parsed.data), updated_by: user.id })
    .eq("id", id);
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  await writeAudit({
    actorId: user.id,
    action: "supplier.updated",
    entityType: "supplier",
    entityId: id,
    after: parsed.data,
  });
  revalidatePath("/purchasing/suppliers");
  return { info: `Updated ${parsed.data.name}.` };
}
