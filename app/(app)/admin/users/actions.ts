"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { createUserSchema, setUserStatusSchema } from "@/lib/validation/auth";

export type UserActionState = { error?: string; info?: string };

/** Create a staff account and assign roles. Super Admin only (users.manage). */
export async function createUserAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const { user } = await requirePermission("users.manage");

  const parsed = createUserSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    roleKeys: formData.getAll("roleKeys"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { email, fullName, roleKeys } = parsed.data;

  const admin = createAdminClient();

  // Create the auth user (pre-confirmed). A temporary password is set; the person sets their own
  // via "Forgot password". New accounts are never protected.
  const tempPassword = randomBytes(18).toString("base64url");
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName, is_protected: false },
  });
  if (createErr || !created.user) {
    return { error: createErr?.message ?? "Could not create the account." };
  }

  const { data: roles, error: rolesErr } = await admin
    .from("roles")
    .select("id, key")
    .in("key", roleKeys);
  if (rolesErr || !roles?.length) {
    return { error: "Could not resolve the selected roles." };
  }

  const { error: urErr } = await admin
    .from("user_roles")
    .insert(
      roles.map((r) => ({ profile_id: created.user.id, role_id: r.id, assigned_by: user.id })),
    );
  if (urErr)
    return { error: "Account created but role assignment failed. Edit the user to retry." };

  await writeAudit({
    actorId: user.id,
    action: "user.created",
    entityType: "profile",
    entityId: created.user.id,
    after: { email, fullName, roleKeys },
  });

  revalidatePath("/admin/users");
  return { info: `Created ${email}. They can set a password via "Forgot password".` };
}

/** Enable or disable an account. Protected Super Admin cannot be disabled (DB trigger). */
export async function setUserStatusAction(
  profileId: string,
  status: "active" | "disabled",
): Promise<UserActionState> {
  const { user } = await requirePermission("users.manage");

  const parsed = setUserStatusSchema.safeParse({ profileId, status });
  if (!parsed.success) return { error: "Invalid request." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ status, updated_by: user.id })
    .eq("id", profileId);
  if (error) {
    return { error: error.message.replace(/^.*?:\s*/, "") };
  }

  await writeAudit({
    actorId: user.id,
    action: status === "disabled" ? "user.disabled" : "user.enabled",
    entityType: "profile",
    entityId: profileId,
    after: { status },
  });

  revalidatePath("/admin/users");
  return { info: status === "disabled" ? "Account disabled." : "Account enabled." };
}
