export interface ProductionPlanLine {
  itemId: string;
  unitId: string;
  qty: number;
}

export interface ScaledProductionLine extends ProductionPlanLine {
  plannedQty: number;
}

export interface ProductionActualLine {
  plannedQty: number;
  actualConsumedQty: number;
  wasteQty: number;
}

export type ProductionWarningCode = "low_yield" | "over_usage" | "excess_waste";

export interface ProductionWarning {
  code: ProductionWarningCode;
  message: string;
}

export function roundProductionQty(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e4) / 1e4;
}

export function scaleProductionPlan(
  outputQty: number,
  lines: ProductionPlanLine[],
  batchMultiplier: number,
): { plannedOutputQty: number; lines: ScaledProductionLine[] } {
  if (!Number.isFinite(outputQty) || outputQty <= 0) {
    throw new Error("Recipe output quantity must be positive.");
  }
  if (!Number.isFinite(batchMultiplier) || batchMultiplier <= 0) {
    throw new Error("Batch multiplier must be positive.");
  }
  if (lines.length === 0) throw new Error("Production requires at least one input.");

  return {
    plannedOutputQty: roundProductionQty(outputQty * batchMultiplier),
    lines: lines.map((line) => {
      if (!Number.isFinite(line.qty) || line.qty <= 0) {
        throw new Error("Production input quantities must be positive.");
      }
      return { ...line, plannedQty: roundProductionQty(line.qty * batchMultiplier) };
    }),
  };
}

export function deriveProductionWarnings(
  plannedOutputQty: number,
  actualOutputQty: number,
  lines: ProductionActualLine[],
  expectedYieldPct: number,
  expectedWastePct: number,
): ProductionWarning[] {
  if (plannedOutputQty <= 0 || actualOutputQty <= 0) return [];

  const warnings: ProductionWarning[] = [];
  const actualYieldPct = (actualOutputQty / plannedOutputQty) * 100;
  if (actualYieldPct + 0.0001 < expectedYieldPct) {
    warnings.push({
      code: "low_yield",
      message: `Actual yield ${roundProductionQty(actualYieldPct)}% is below the expected ${expectedYieldPct}%.`,
    });
  }

  if (lines.some((line) => line.actualConsumedQty + line.wasteQty > line.plannedQty + 0.0001)) {
    warnings.push({
      code: "over_usage",
      message: "Actual input usage exceeds the plan.",
    });
  }

  const plannedInput = lines.reduce((sum, line) => sum + line.plannedQty, 0);
  const waste = lines.reduce((sum, line) => sum + line.wasteQty, 0);
  const wastePct = plannedInput > 0 ? (waste / plannedInput) * 100 : 0;
  if (wastePct > expectedWastePct + 0.0001) {
    warnings.push({
      code: "excess_waste",
      message: `Recorded waste ${roundProductionQty(wastePct)}% exceeds the expected ${expectedWastePct}%.`,
    });
  }
  return warnings;
}
