import { createHmac, timingSafeEqual } from "node:crypto";
export { STEPUP_COOKIE } from "@/lib/auth/stepup-constants";

/**
 * Signed marker proving a Super Admin completed step-up verification for the current session.
 * Stored as an httpOnly cookie; validated in middleware. A password-only Super Admin session is
 * NOT privileged until this marker is present and valid.
 */

/** Bind the marker to the user id so it can't be replayed for another account. */
export function signStepUpMarker(userId: string, pepper: string): string {
  return createHmac("sha256", pepper).update(`stepup:${userId}`).digest("hex");
}

export function verifyStepUpMarker(
  userId: string,
  marker: string | undefined,
  pepper: string,
): boolean {
  if (!marker) return false;
  const expected = signStepUpMarker(userId, pepper);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(marker, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
