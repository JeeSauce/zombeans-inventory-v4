import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Super Admin step-up email-code verification — pure, testable core.
 *
 * The plaintext code is NEVER stored. We store only an HMAC-SHA256 hash keyed by a server-side
 * pepper (the service-role key or a dedicated secret). DB orchestration (persisting challenges,
 * incrementing attempts, auditing) lives in the server action layer; this module owns the
 * security-critical logic that must be unit-tested.
 */

export const STEPUP_CODE_LENGTH = 6;

/** Cryptographically secure zero-padded 6-digit code. */
export function generateStepUpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(STEPUP_CODE_LENGTH, "0");
}

/** HMAC-SHA256(code) keyed by the server pepper, hex-encoded. */
export function hashStepUpCode(code: string, pepper: string): string {
  return createHmac("sha256", pepper).update(code).digest("hex");
}

/** Constant-time hex-hash comparison. */
export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

export interface StepUpChallenge {
  codeHash: string;
  expiresAt: Date | string;
  attempts: number;
  maxAttempts: number;
  consumedAt: Date | string | null;
}

export type StepUpResult = "ok" | "expired" | "consumed" | "too_many_attempts" | "mismatch";

/**
 * Evaluate a submitted code against a stored challenge. Pure function — no side effects.
 * Order matters: a consumed or expired or exhausted challenge never reveals whether the code
 * matched. On "mismatch" the caller increments attempts and audits the failure.
 */
export function evaluateStepUp(
  challenge: StepUpChallenge,
  submittedCode: string,
  pepper: string,
  now: Date = new Date(),
): StepUpResult {
  if (challenge.consumedAt !== null) return "consumed";
  if (new Date(challenge.expiresAt).getTime() <= now.getTime()) return "expired";
  if (challenge.attempts >= challenge.maxAttempts) return "too_many_attempts";

  const submittedHash = hashStepUpCode(submittedCode, pepper);
  return hashesEqual(submittedHash, challenge.codeHash) ? "ok" : "mismatch";
}

/** Default expiry timestamp for a new challenge. */
export function stepUpExpiry(ttlSeconds: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + ttlSeconds * 1000);
}
