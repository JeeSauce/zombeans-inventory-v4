import { redirect } from "next/navigation";
import { getAuthContext, can } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { UsersClient, type UserRow } from "@/components/admin/users-client";

export default async function UsersPage() {
  const ctx = await getAuthContext();
  if (!can("users.manage", ctx.permissions)) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select(
      "id, full_name, email, status, is_protected, user_roles!user_roles_profile_id_fkey(roles(key, name))",
    )
    .order("created_at", { ascending: true });

  type Row = {
    id: string;
    full_name: string;
    email: string;
    status: "active" | "disabled";
    is_protected: boolean;
    user_roles: { roles: { key: string; name: string } | null }[];
  };

  const users: UserRow[] = ((data as Row[] | null) ?? []).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    status: r.status,
    isProtected: r.is_protected,
    roles: r.user_roles
      .map((ur) => ur.roles)
      .filter((x): x is { key: string; name: string } => Boolean(x)),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Administration</p>
        <h1 className="font-display mt-1 text-3xl">Users</h1>
        <p className="text-muted-foreground mt-1">
          Create staff accounts, assign roles, and control access.
        </p>
      </div>
      <UsersClient users={users} currentUserId={ctx.userId} />
    </div>
  );
}
