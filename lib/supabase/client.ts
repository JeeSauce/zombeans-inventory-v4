import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env";

/** Browser Supabase client (anon key, RLS applies). Safe for client components. */
export function createClient() {
  return createBrowserClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
