import "server-only";
import { createClient } from "@supabase/supabase-js";
import { clientEnv, getServerEnv } from "@/lib/env";

/**
 * Service-role Supabase client — BYPASSES RLS. Server-only (`import "server-only"` makes a client
 * import a build error). Use ONLY for privileged operations that legitimately need to bypass RLS
 * (issuing step-up codes, creating accounts, writing audit rows). Every such use must be audited.
 */
export function createAdminClient() {
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();
  return createClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
