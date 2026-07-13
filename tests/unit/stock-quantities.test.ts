import { describe, expect, it } from "vitest";
import {
  accountedReceivingQty,
  hasReceivingDiscrepancy,
  isCriticalBalance,
  isReceivingBalanced,
  normalizeQty,
} from "@/lib/stock/quantities";

describe("stock quantities", () => {
  it("normalizes quantities to four decimal places", () => {
    expect(normalizeQty(1.23456)).toBe(1.2346);
    expect(normalizeQty(1.00004)).toBe(1);
  });

  it("requires receiving counts to account for the shipped quantity", () => {
    const counts = { shipped: 10, received: 8, rejected: 1, damaged: 0.5, missing: 0.5 };
    expect(accountedReceivingQty(counts)).toBe(10);
    expect(isReceivingBalanced(counts)).toBe(true);
    expect(isReceivingBalanced({ ...counts, missing: 0 })).toBe(false);
  });

  it("detects receiving discrepancies", () => {
    expect(
      hasReceivingDiscrepancy({
        shipped: 2,
        received: 2,
        rejected: 0,
        damaged: 0,
        missing: 0,
      }),
    ).toBe(false);
    expect(
      hasReceivingDiscrepancy({
        shipped: 2,
        received: 1,
        rejected: 0,
        damaged: 0,
        missing: 1,
      }),
    ).toBe(true);
  });

  it("marks only exact negative balances Critical", () => {
    expect(isCriticalBalance(-0.0001)).toBe(true);
    expect(isCriticalBalance(-0.00001)).toBe(false);
    expect(isCriticalBalance(0)).toBe(false);
  });
});
