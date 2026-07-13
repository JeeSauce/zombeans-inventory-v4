import { describe, expect, it } from "vitest";
import {
  calculateExpectedQuantity,
  calculateVariance,
  calculateVarianceValue,
  deriveUnusualVarianceSignals,
  normalizeRecountQty,
} from "@/lib/recounts/calculations";
import { recountOpenSchema, recountSubmitSchema } from "@/lib/validation/recounts";

describe("recount calculations", () => {
  it("computes opening + received + production output − transfers out − usage − stock-outs − waste", () => {
    expect(
      calculateExpectedQuantity({
        opening: 100,
        received: 25.1255,
        productionOutput: 10,
        transfersOut: 8,
        usage: 20.25,
        stockOuts: 3,
        waste: 1.5,
      }),
    ).toBe(102.3755);
  });

  it("freezes four-decimal variance and cost-snapshot value boundaries", () => {
    expect(normalizeRecountQty(1.23456)).toBe(1.2346);
    expect(calculateVariance(9.9999, 10)).toBe(-0.0001);
    expect(calculateVarianceValue(-0.0001, 12.3456)).toBe(-0.0012);
    expect(
      recountSubmitSchema.safeParse({
        sessionId: "11111111-1111-4111-8111-111111111111",
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
        lines: [{ lineId: "33333333-3333-4333-8333-333333333333", physicalQty: 1.00001 }],
      }).success,
    ).toBe(false);
  });

  it("escalates at exact percentage and peso thresholds", () => {
    const signals = deriveUnusualVarianceSignals(
      {
        expectedQty: 100,
        varianceQty: -10,
        varianceValue: -5000,
        resultingBalance: 90,
        missingCostSnapshot: false,
        afterReopen: false,
        priorAdjustmentCount: 0,
      },
      { percent: 10, pesoValue: 5000, repeatCount: 3 },
    );
    expect(signals).toEqual(["percent_threshold", "value_threshold"]);
  });

  it("captures zero-expected, missing-cost, negative, post-reopen, and repeat signals", () => {
    expect(
      deriveUnusualVarianceSignals(
        {
          expectedQty: 0,
          varianceQty: -0.0001,
          varianceValue: 0,
          resultingBalance: -0.0001,
          missingCostSnapshot: true,
          afterReopen: true,
          priorAdjustmentCount: 2,
        },
        { percent: 10, pesoValue: 5000, repeatCount: 3 },
      ),
    ).toEqual([
      "zero_expected",
      "missing_cost_snapshot",
      "negative_result",
      "after_reopen",
      "repeated_adjustments",
    ]);
  });

  it("validates full versus cycle item selection", () => {
    const base = {
      branchId: "11111111-1111-4111-8111-111111111111",
      businessDate: "2026-07-13",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    };
    expect(
      recountOpenSchema.safeParse({ ...base, type: "start_of_day", itemIds: [] }).success,
    ).toBe(true);
    expect(recountOpenSchema.safeParse({ ...base, type: "cycle", itemIds: [] }).success).toBe(
      false,
    );
    expect(
      recountOpenSchema.safeParse({
        ...base,
        type: "cycle",
        itemIds: ["33333333-3333-4333-8333-333333333333"],
      }).success,
    ).toBe(true);
  });
});
