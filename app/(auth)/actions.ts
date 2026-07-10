"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { clientEnv, getServerEnv } from "@/lib/env";
import { writeAudit } from "@/lib/audit";
import { issueStepUpChallenge, verifyStepUpChallenge } from "@/lib/auth/stepup-service";
import { STEPUP_COOKIE, signStepUpMarker } from "@/lib/auth/stepup-cookie";
import { loginSchema, stepUpSchema, resetRequestSchema } from "@/lib/validation/auth";

async function requestIp(): Promise<string | undefined> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
}

export type ActionState = { error?: string; info?: string };

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    await writeAudit({
      action: "auth.login_failed",
      entityType: "auth",
      entityId: parsed.data.email,
      requestIp: await requestIp(),
    });
    return { error: "Incorrect email or password." };
  }

  await writeAudit({
    actorId: data.user.id,
    action: "auth.login_password_ok",
    entityType: "auth",
    entityId: data.user.id,
    requestIp: await requestIp(),
  });

  const { data: isSuper } = await supabase.rpc("is_super_admin", { uid: data.user.id });

  if (isSuper) {
    // Password alone does NOT grant a privileged session. Issue a step-up code and gate on /verify.
    await issueStepUpChallenge(
      data.user.id,
      data.user.email ?? parsed.data.email,
      await requestIp(),
    );
    redirect("/verify");
  }

  redirect("/dashboard");
}

export async function verifyStepUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = stepUpSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter the 6-digit code" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const result = await verifyStepUpChallenge(user.id, parsed.data.code, await requestIp());

  if (result === "ok") {
    const cookieStore = await cookies();
    cookieStore.set(STEPUP_COOKIE, signStepUpMarker(user.id, getServerEnv().STEPUP_CODE_PEPPER), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    redirect("/dashboard");
  }

  const messages: Record<string, string> = {
    expired: "That code expired. Request a new one.",
    consumed: "That code was already used. Request a new one.",
    too_many_attempts: "Too many attempts. Request a new code.",
    not_found: "No active code. Request a new one.",
    mismatch: "Incorrect code. Check your email and try again.",
  };
  return { error: messages[result] ?? "Verification failed." };
}

export async function resendStepUpAction(): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const res = await issueStepUpChallenge(user.id, user.email ?? "", await requestIp());
  return res.ok
    ? { info: "A new code is on its way." }
    : { error: "Too many code requests. Wait a while and try again." };
}

export async function resetRequestAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetRequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a valid email" };
  }
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${clientEnv.NEXT_PUBLIC_SITE_URL}/reset-password/update`,
  });
  // Always report success — never reveal whether an address exists.
  return { info: "If that address has an account, a reset link is on its way." };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(STEPUP_COOKIE);
  if (user) {
    await writeAudit({
      actorId: user.id,
      action: "auth.logout",
      entityType: "auth",
      entityId: user.id,
    });
  }
  redirect("/login");
}
