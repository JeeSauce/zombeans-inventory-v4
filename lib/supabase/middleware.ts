import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env";
import { STEPUP_COOKIE } from "@/lib/auth/stepup-constants";

/** Routes reachable without any session. */
const PUBLIC_PATHS = ["/login", "/reset-password", "/activate", "/auth"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Edge-compatible HMAC-SHA256 (hex) — matches node:crypto's createHmac output. */
async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function stepUpMarkerValid(userId: string, marker: string | undefined): Promise<boolean> {
  if (!marker) return false;
  const pepper = process.env.STEPUP_CODE_PEPPER ?? "local-dev-stepup-pepper-change-me";
  const expected = await hmacHex(pepper, `stepup:${userId}`);
  return marker === expected;
}

function redirectTo(request: NextRequest, pathname: string, params?: Record<string, string>) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

/**
 * Refresh the session, enforce auth, force-logout disabled accounts, and gate the Super Admin on
 * step-up verification: a password-only Super Admin session may reach ONLY /verify until the
 * emailed code is confirmed.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  if (!user) {
    return isPublic(pathname) ? response : redirectTo(request, "/login");
  }

  // Force logout of disabled accounts.
  const { data: profile } = await supabase
    .from("profiles")
    .select("status")
    .eq("id", user.id)
    .single();
  if (profile?.status === "disabled") {
    await supabase.auth.signOut();
    return redirectTo(request, "/login", { reason: "disabled" });
  }

  // Super Admin step-up gate.
  const { data: isSuper } = await supabase.rpc("is_super_admin", { uid: user.id });
  if (isSuper) {
    const verified = await stepUpMarkerValid(user.id, request.cookies.get(STEPUP_COOKIE)?.value);
    if (!verified && pathname !== "/verify") {
      return redirectTo(request, "/verify");
    }
    if (verified && (pathname === "/verify" || pathname === "/login" || pathname === "/")) {
      return redirectTo(request, "/dashboard");
    }
    return response;
  }

  // Non-super users have no reason to see /verify.
  if (pathname === "/verify") return redirectTo(request, "/dashboard");
  if (pathname === "/login" || pathname === "/") return redirectTo(request, "/dashboard");

  return response;
}
