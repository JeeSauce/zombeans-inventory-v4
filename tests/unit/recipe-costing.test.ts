import { describe, expect, it } from "vitest";
import {
  calculatePlannedRecipeCost,
  calculateSellingMetrics,
  roundRecipeMoney,
} from "@/lib/recipes/costing";

describe("recipe costing", () => {
  it("combines ingredients, packaging, waste, and expected yield", () => {
    expect(
      calculatePlannedRecipeCost(
        [
          { qty: 2, unitCost: 10, isPackaging: false },
          { qty: 1, unitCost: 3, isPackaging: true },
        ],
        10,
        80,
        5,
      ),
    ).toEqual({
      ingredientCost: 20,
      packagingCost: 3,
      wasteCost: 1,
      totalCost: 24,
      effectiveOutputQty: 8,
      unitCost: 3,
    });
  });

  it("does not cost a reusable container", () => {
    const result = calculatePlannedRecipeCost(
      [
        {
          qty: 1,
          unitCost: 250,
          isPackaging: true,
          isContainer: true,
          isConsumable: false,
        },
      ],
      1,
    );
    expect(result.packagingCost).toBe(0);
    expect(result.unitCost).toBe(0);
  });

  it("costs a consumable container", () => {
    const result = calculatePlannedRecipeCost(
      [
        {
          qty: 2,
          unitCost: 1.25,
          isPackaging: true,
          isContainer: true,
          isConsumable: true,
        },
      ],
      2,
    );
    expect(result.packagingCost).toBe(2.5);
    expect(result.unitCost).toBe(1.25);
  });

  it("rounds money to four decimal places", () => {
    expect(roundRecipeMoney(2 / 3)).toBe(0.6667);
  });

  it("derives food-cost, gross-margin, and markup percentages", () => {
    expect(calculateSellingMetrics(100, 40)).toEqual({
      grossProfit: 60,
      grossMarginPct: 60,
      foodCostPct: 40,
      markupPct: 150,
    });
  });

  it("returns null percentages when their denominator is zero", () => {
    expect(calculateSellingMetrics(0, 0)).toEqual({
      grossProfit: 0,
      grossMarginPct: null,
      foodCostPct: null,
      markupPct: null,
    });
  });

  it("rejects invalid yield, waste, output, and line quantities", () => {
    expect(() => calculatePlannedRecipeCost([], 0)).toThrow(/output quantity/i);
    expect(() => calculatePlannedRecipeCost([], 1, 0)).toThrow(/yield/i);
    expect(() => calculatePlannedRecipeCost([], 1, 100, 100)).toThrow(/waste/i);
    expect(() =>
      calculatePlannedRecipeCost([{ qty: 0, unitCost: 1, isPackaging: false }], 1),
    ).toThrow(/recipe lines/i);
  });
});
