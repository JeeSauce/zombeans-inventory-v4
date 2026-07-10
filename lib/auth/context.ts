import "server-only";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export interface AuthContext {
  userId: string;
  email: string;
  fullName: string;
  isSuperAdmin: boolean;
  permissions: string[];
  roleLabel: string;
}

/** Resolve the signed-in user's profile + permissions. Redirects to /login if unauthenticated. */
export async function getAuthContext(): Promise<AuthContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: permissions }, { data: isSuper }, { data: roleNamesData }] =
    await Promise.all([
      supabase.from("profiles").select("full_name, email").eq("id", user.id).single(),
      supabase.rpc("current_permissions"),
      supabase.rpc("is_super_admin", { uid: user.id }),
      supabase.rpc("current_roles"),
    ]);

  const roleNames = (roleNamesData as string[] | null) ?? [];

  return {
    userId: user.id,
    email: profile?.email ?? user.email ?? "",
    fullName: profile?.full_name ?? "",
    isSuperAdmin: Boolean(isSuper),
    permissions: (permissions as string[] | null) ?? [],
    roleLabel: roleNames.join(", ") || "No role",
  };
}

export function can(permission: string, permissions: string[]): boolean {
  return permissions.includes(permission);
}
