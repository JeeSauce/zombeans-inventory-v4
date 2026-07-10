import { describe, it, expect } from "vitest";
import {
  generateStepUpCode,
  hashStepUpCode,
  hashesEqual,
  evaluateStepUp,
  stepUpExpiry,
  type StepUpChallenge,
} from "@/lib/auth/stepup";

const PEPPER = "test-pepper-value";

function challenge(overrides: Partial<StepUpChallenge> = {}): StepUpChallenge {
  return {
    codeHash: hashStepUpCode("123456", PEPPER),
    expiresAt: new Date(Date.now() + 5 * 60_000),
    attempts: 0,
    maxAttempts: 5,
    consumedAt: null,
    ...overrides,
  };
}

describe("step-up code generation", () => {
  it("always produces a zero-padded 6-digit code", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateStepUpCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it("does not store plaintext — hash differs from code and is stable", () => {
    const h = hashStepUpCode("123456", PEPPER);
    expect(h).not.toContain("123456");
    expect(h).toBe(hashStepUpCode("123456", PEPPER));
  });

  it("hash depends on the pepper", () => {
    expect(hashStepUpCode("123456", "a")).not.toBe(hashStepUpCode("123456", "b"));
  });

  it("hashesEqual is true only for identical hashes", () => {
    expect(hashesEqual(hashStepUpCode("1", PEPPER), hashStepUpCode("1", PEPPER))).toBe(true);
    expect(hashesEqual(hashStepUpCode("1", PEPPER), hashStepUpCode("2", PEPPER))).toBe(false);
  });
});

describe("evaluateStepUp — critical scenario 21 (expiry & single-use)", () => {
  it("accepts the correct code within TTL", () => {
    expect(evaluateStepUp(challenge(), "123456", PEPPER)).toBe("ok");
  });

  it("rejects an expired code", () => {
    const c = challenge({ expiresAt: new Date(Date.now() - 1000) });
    expect(evaluateStepUp(c, "123456", PEPPER)).toBe("expired");
  });

  it("rejects a consumed (already-used) code — no reuse", () => {
    const c = challenge({ consumedAt: new Date() });
    expect(evaluateStepUp(c, "123456", PEPPER)).toBe("consumed");
  });

  it("expiry helper computes now + ttl", () => {
    const base = new Date("2026-07-10T00:00:00Z");
    expect(stepUpExpiry(300, base).toISOString()).toBe("2026-07-10T00:05:00.000Z");
  });
});

describe("evaluateStepUp — critical scenario 22 (attempt limiting)", () => {
  it("blocks once attempts reach the max, even with the right code", () => {
    const c = challenge({ attempts: 5, maxAttempts: 5 });
    expect(evaluateStepUp(c, "123456", PEPPER)).toBe("too_many_attempts");
  });

  it("returns mismatch for a wrong code while attempts remain", () => {
    expect(evaluateStepUp(challenge({ attempts: 2 }), "000000", PEPPER)).toBe("mismatch");
  });
});
