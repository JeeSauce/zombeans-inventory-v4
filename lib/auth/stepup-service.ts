import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailTransport } from "@/lib/email";
import { writeAudit } from "@/lib/audit";
import { getServerEnv } from "@/lib/env";
import {
  generateStepUpCode,
  hashStepUpCode,
  evaluateStepUp,
  stepUpExpiry,
  type StepUpResult,
} from "@/lib/auth/stepup";

const PURPOSE = "super_admin_stepup";

export type IssueResult = { ok: true } | { ok: false; reason: "rate_limited" };

/**
 * Issue a step-up code: rate-limit, generate + hash + persist (hash only), email the code, audit.
 * Runs with the service role because email_code_challenges is not client-accessible.
 */
export async function issueStepUpChallenge(
  profileId: string,
  email: string,
  requestIp?: string,
): Promise<IssueResult> {
  const env = getServerEnv();
  const admin = createAdminClient();

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("email_code_challenges")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .gte("created_at", since);

  if ((count ?? 0) >= env.STEPUP_RATE_LIMIT_PER_HOUR) {
    await writeAudit({
      actorId: profileId,
      action: "stepup.rate_limited",
      entityType: "email_code_challenge",
      entityId: profileId,
      requestIp,
    });
    return { ok: false, reason: "rate_limited" };
  }

  const code = generateStepUpCode();
  const codeHash = hashStepUpCode(code, env.STEPUP_CODE_PEPPER);

  await admin.from("email_code_challenges").insert({
    profile_id: profileId,
    purpose: PURPOSE,
    code_hash: codeHash,
    expires_at: stepUpExpiry(env.STEPUP_CODE_TTL_SECONDS).toISOString(),
    max_attempts: env.STEPUP_MAX_ATTEMPTS,
    request_ip: requestIp ?? null,
  });

  await getEmailTransport().send({
    to: email,
    subject: "Your Zombeans verification code",
    text: `Your Super Admin verification code is ${code}. It expires in ${Math.round(
      env.STEPUP_CODE_TTL_SECONDS / 60,
    )} minutes. If you did not request this, ignore this email.`,
  });

  await writeAudit({
    actorId: profileId,
    action: "stepup.code_issued",
    entityType: "email_code_challenge",
    entityId: profileId,
    requestIp,
  });

  return { ok: true };
}

/**
 * Verify a submitted code against the latest unconsumed challenge. Increments attempts on
 * mismatch, marks the challenge consumed on success, and audits every outcome.
 */
export async function verifyStepUpChallenge(
  profileId: string,
  submittedCode: string,
  requestIp?: string,
): Promise<StepUpResult | "not_found"> {
  const env = getServerEnv();
  const admin = createAdminClient();

  const { data: challenge } = await admin
    .from("email_code_challenges")
    .select("id, code_hash, expires_at, attempts, max_attempts, consumed_at")
    .eq("profile_id", profileId)
    .eq("purpose", PURPOSE)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!challenge) {
    await writeAudit({
      actorId: profileId,
      action: "stepup.verify_not_found",
      entityType: "email_code_challenge",
      entityId: profileId,
      requestIp,
    });
    return "not_found";
  }

  const result = evaluateStepUp(
    {
      codeHash: challenge.code_hash,
      expiresAt: challenge.expires_at,
      attempts: challenge.attempts,
      maxAttempts: challenge.max_attempts,
      consumedAt: challenge.consumed_at,
    },
    submittedCode,
    env.STEPUP_CODE_PEPPER,
  );

  if (result === "ok") {
    await admin
      .from("email_code_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", challenge.id);
  } else if (result === "mismatch") {
    await admin
      .from("email_code_challenges")
      .update({ attempts: challenge.attempts + 1 })
      .eq("id", challenge.id);
  }

  await writeAudit({
    actorId: profileId,
    action: `stepup.verify_${result}`,
    entityType: "email_code_challenge",
    entityId: profileId,
    requestIp,
  });

  return result;
}
