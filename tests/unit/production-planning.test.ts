import { describe, expect, it } from "vitest";
import {
  deriveProductionWarnings,
  roundProductionQty,
  scaleProductionPlan,
} from "@/lib/production/planning";

describe("production planning", () => {
  it("scales output and normalized input quantities to four decimals", () => {
    expect(
      scaleProductionPlan(
        10,
        [{ itemId: "coffee", unitId: "g", qty: 1 / 3 }],
        2,
      ),
    ).toEqual({
      plannedOutputQty: 20,
      lines: [{ itemId: "coffee", unitId: "g", qty: 1 / 3, plannedQty: 0.6667 }],
    });
    expect(roundProductionQty(2 / 3)).toBe(0.6667);
  });

  it("rejects invalid plans", () => {
    expect(() => scaleProductionPlan(0, [{ itemId: "a", unitId: "u", qty: 1 }], 1)).toThrow(
      /output quantity/i,
    );
    expect(() => scaleProductionPlan(1, [{ itemId: "a", unitId: "u", qty: 1 }], 0)).toThrow(
      /batch multiplier/i,
    );
    expect(() => scaleProductionPlan(1, [], 1)).toThrow(/at least one input/i);
  });

  it("reports low yield, input over-usage, and excessive waste", () => {
    expect(
      deriveProductionWarnings(
        100,
        80,
        [{ plannedQty: 10, actualConsumedQty: 10, wasteQty: 2 }],
        90,
        5,
      ).map((warning) => warning.code),
    ).toEqual(["low_yield", "over_usage", "excess_waste"]);
  });

  it("returns no warnings when actuals are within expectations", () => {
    expect(
      deriveProductionWarnings(
        100,
        95,
        [{ plannedQty: 10, actualConsumedQty: 9.5, wasteQty: 0.2 }],
        90,
        5,
      ),
    ).toEqual([]);
  });
});
