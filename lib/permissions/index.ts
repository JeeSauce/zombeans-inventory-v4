import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

/**
 * Server-side permission enforcement. Mirrors the RLS policies so the UI gets clean errors, but
 * RLS remains the real backstop. Never the sole line of defense.
 */

export class PermissionError extends Error {
  constructor(public readonly permission: string) {
    super(`Missing required permission: ${permission}`);
    this.name = "PermissionError";
  }
}

export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthRequiredError";
  }
}

/** The authenticated user, or null. Uses getUser() which verifies the JWT with Supabase. */
export async function getSessionUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** The current user's permission slugs (via the current_permissions() SECURITY DEFINER function). */
export async function getMyPermissions(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("current_permissions");
  if (error) throw error;
  return (data as string[] | null) ?? [];
}

export function can(permission: string, permissions: string[]): boolean {
  return permissions.includes(permission);
}

/** Throw unless the signed-in user holds `permission`. Returns the user + their permissions. */
export async function requirePermission(
  permission: string,
): Promise<{ user: User; permissions: string[] }> {
  const user = await getSessionUser();
  if (!user) throw new AuthRequiredError();
  const permissions = await getMyPermissions();
  if (!can(permission, permissions)) throw new PermissionError(permission);
  return { user, permissions };
}
