export const RECOUNT_SCALE = 4;

export function normalizeRecountQty(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Quantity must be finite.");
  return Math.round((value + Number.EPSILON) * 10 ** RECOUNT_SCALE) / 10 ** RECOUNT_SCALE;
}

export interface ExpectedQuantityComponents {
  opening: number;
  received: number;
  productionOutput: number;
  transfersOut: number;
  usage: number;
  stockOuts: number;
  waste: number;
}

export function calculateExpectedQuantity(parts: ExpectedQuantityComponents): number {
  return normalizeRecountQty(
    parts.opening +
      parts.received +
      parts.productionOutput -
      parts.transfersOut -
      parts.usage -
      parts.stockOuts -
      parts.waste,
  );
}

export function calculateVariance(physicalQty: number, expectedQty: number): number {
  return normalizeRecountQty(physicalQty - expectedQty);
}

export function calculateVarianceValue(varianceQty: number, unitCostSnapshot: number): number {
  return normalizeRecountQty(varianceQty * unitCostSnapshot);
}

export type UnusualVarianceSignal =
  | "percent_threshold"
  | "zero_expected"
  | "value_threshold"
  | "missing_cost_snapshot"
  | "negative_result"
  | "after_reopen"
  | "repeated_adjustments";

export interface UnusualVarianceThresholds {
  percent: number;
  pesoValue: number;
  repeatCount: number;
}

export interface UnusualVarianceInput {
  expectedQty: number;
  varianceQty: number;
  varianceValue: number;
  resultingBalance: number;
  missingCostSnapshot: boolean;
  afterReopen: boolean;
  priorAdjustmentCount: number;
}

export function deriveUnusualVarianceSignals(
  input: UnusualVarianceInput,
  thresholds: UnusualVarianceThresholds,
): UnusualVarianceSignal[] {
  if (normalizeRecountQty(input.varianceQty) === 0) return [];

  const signals: UnusualVarianceSignal[] = [];
  const expected = Math.abs(normalizeRecountQty(input.expectedQty));
  const variance = Math.abs(normalizeRecountQty(input.varianceQty));

  if (expected === 0) {
    signals.push("zero_expected");
  } else if ((variance / expected) * 100 >= thresholds.percent) {
    signals.push("percent_threshold");
  }
  if (Math.abs(input.varianceValue) >= thresholds.pesoValue) {
    signals.push("value_threshold");
  }
  if (input.missingCostSnapshot) signals.push("missing_cost_snapshot");
  if (normalizeRecountQty(input.resultingBalance) < 0) signals.push("negative_result");
  if (input.afterReopen) signals.push("after_reopen");
  if (input.priorAdjustmentCount + 1 >= thresholds.repeatCount) {
    signals.push("repeated_adjustments");
  }

  return signals;
}
