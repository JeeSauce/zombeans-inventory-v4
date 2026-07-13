import { describe, it, expect } from "vitest";
import { purchaseCostToBase, weightedAverage } from "@/lib/purchasing/costing";

describe("purchaseCostToBase", () => {
  it("converts a purchase-unit cost to a base-unit cost", () => {
    // ₱1000 per sack, 1 sack = 25 kg → ₱40/kg
    expect(purchaseCostToBase(1000, 25)).toBe(40);
  });
  it("returns the cost unchanged when factor is 1", () => {
    expect(purchaseCostToBase(12.5, 1)).toBe(12.5);
  });
});

describe("weightedAverage — critical scenario 7", () => {
  it("equals the received cost on the first receipt (no prior stock)", () => {
    expect(weightedAverage(0, 0, 100, 40)).toBe(40);
  });
  it("blends prior and received stock", () => {
    // 100 @ 40 + 100 @ 50 = 20000 / 200 = 45
    expect(weightedAverage(100, 40, 100, 50)).toBe(45);
  });
  it("treats negative prior qty as no prior stock", () => {
    expect(weightedAverage(-5, 99, 10, 20)).toBe(20);
  });
  it("rounds to 4 decimal places", () => {
    // (1*3 + 2*4)/3 = 11/3 = 3.6667
    expect(weightedAverage(1, 3, 2, 4)).toBe(3.6667);
  });
});
