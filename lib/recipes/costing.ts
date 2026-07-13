/**
 * Pure Phase 4 recipe-costing helpers. Postgres remains authoritative for protected recursive
 * calculation and snapshots; these functions mirror the result-boundary arithmetic for unit tests
 * and safe UI-derived metrics.
 */

export interface RecipeCostLine {
  qty: number;
  unitCost: number;
  isPackaging: boolean;
  isContainer?: boolean;
  isConsumable?: boolean;
}

export interface PlannedRecipeCost {
  ingredientCost: number;
  packagingCost: number;
  wasteCost: number;
  totalCost: number;
  effectiveOutputQty: number;
  unitCost: number;
}

export interface SellingMetrics {
  grossProfit: number;
  grossMarginPct: number | null;
  foodCostPct: number | null;
  markupPct: number | null;
}

export interface RecipeCostBreakdown {
  name: string;
  sku: string;
  qty: number;
  unit: string;
  isPackaging: boolean;
  nestedRecipe: boolean;
  sourceUnitCost: number;
  extendedCost: number;
}

export interface RecipeCostResult extends PlannedRecipeCost {
  breakdown: RecipeCostBreakdown[];
}

function numeric(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Recipe cost result has an invalid ${field}.`);
  return parsed;
}

/** Normalize the snake_case JSON returned by the protected Postgres costing RPC. */
export function normalizeRecipeCost(value: unknown): RecipeCostResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Recipe cost result is malformed.");
  }
  const result = value as Record<string, unknown>;
  const rawBreakdown = Array.isArray(result.breakdown) ? result.breakdown : [];

  return {
    ingredientCost: numeric(result.ingredient_cost, "ingredient cost"),
    packagingCost: numeric(result.packaging_cost, "packaging cost"),
    wasteCost: numeric(result.waste_cost, "waste cost"),
    totalCost: numeric(result.total_cost, "total cost"),
    effectiveOutputQty: numeric(result.effective_output_qty, "effective output quantity"),
    unitCost: numeric(result.unit_cost, "unit cost"),
    breakdown: rawBreakdown.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error("Recipe cost breakdown is malformed.");
      }
      const line = entry as Record<string, unknown>;
      return {
        name: String(line.name ?? "Unknown item"),
        sku: String(line.sku ?? "—"),
        qty: numeric(line.qty, "line quantity"),
        unit: String(line.unit ?? ""),
        isPackaging: Boolean(line.is_packaging),
        nestedRecipe: Boolean(line.nested_recipe),
        sourceUnitCost: numeric(line.source_unit_cost, "source unit cost"),
        extendedCost: numeric(line.extended_cost, "extended cost"),
      };
    }),
  };
}

export function roundRecipeMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e4) / 1e4;
}

export function calculatePlannedRecipeCost(
  lines: RecipeCostLine[],
  outputQty: number,
  expectedYieldPct = 100,
  expectedWastePct = 0,
): PlannedRecipeCost {
  if (!Number.isFinite(outputQty) || outputQty <= 0) {
    throw new Error("Recipe output quantity must be positive.");
  }
  if (!Number.isFinite(expectedYieldPct) || expectedYieldPct <= 0 || expectedYieldPct > 100) {
    throw new Error("Expected yield must be greater than 0 and at most 100%.");
  }
  if (!Number.isFinite(expectedWastePct) || expectedWastePct < 0 || expectedWastePct >= 100) {
    throw new Error("Expected waste must be at least 0 and below 100%.");
  }

  let ingredientCost = 0;
  let packagingCost = 0;

  for (const line of lines) {
    if (!Number.isFinite(line.qty) || line.qty <= 0 || !Number.isFinite(line.unitCost)) {
      throw new Error("Recipe lines require a positive quantity and finite unit cost.");
    }
    const costable = !(line.isContainer && line.isConsumable === false);
    const extended = costable ? line.qty * Math.max(0, line.unitCost) : 0;
    if (line.isPackaging) packagingCost += extended;
    else ingredientCost += extended;
  }

  ingredientCost = roundRecipeMoney(ingredientCost);
  packagingCost = roundRecipeMoney(packagingCost);
  const wasteCost = roundRecipeMoney((ingredientCost * expectedWastePct) / 100);
  const effectiveOutputQty = roundRecipeMoney((outputQty * expectedYieldPct) / 100);
  const totalCost = roundRecipeMoney(ingredientCost + packagingCost + wasteCost);
  const unitCost = roundRecipeMoney(totalCost / effectiveOutputQty);

  return { ingredientCost, packagingCost, wasteCost, totalCost, effectiveOutputQty, unitCost };
}

export function calculateSellingMetrics(sellingPrice: number, unitCost: number): SellingMetrics {
  const price = Math.max(0, sellingPrice);
  const cost = Math.max(0, unitCost);
  const grossProfit = roundRecipeMoney(price - cost);
  return {
    grossProfit,
    grossMarginPct: price > 0 ? roundRecipeMoney((grossProfit / price) * 100) : null,
    foodCostPct: price > 0 ? roundRecipeMoney((cost / price) * 100) : null,
    markupPct: cost > 0 ? roundRecipeMoney((grossProfit / cost) * 100) : null,
  };
}
