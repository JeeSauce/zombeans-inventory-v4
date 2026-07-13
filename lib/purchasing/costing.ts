/**
 * Purchasing cost math — the TypeScript twin of the DB posting logic (migration 0012). The database
 * remains the source of truth for posted amounts; these pure helpers make the math unit-testable and
 * are reused for UI estimates. Critical scenario 7: weighted-average cost updates correctly.
 */

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e4) / 1e4;
}

/** Cost per base unit = purchase-unit cost ÷ (purchase→base conversion factor). */
export function purchaseCostToBase(unitCost: number, factor: number): number {
  if (!factor) return round4(unitCost);
  return round4(unitCost / factor);
}

/**
 * Weighted-average cost after receiving `recvQty` (base units) at `recvCost` (per base unit).
 * First receipt or non-positive prior quantity → the received cost.
 */
export function weightedAverage(
  oldQty: number,
  oldAvg: number,
  recvQty: number,
  recvCost: number,
): number {
  if (oldQty <= 0) return round4(recvCost);
  const total = oldQty + recvQty;
  if (total <= 0) return round4(recvCost);
  return round4((oldQty * oldAvg + recvQty * recvCost) / total);
}
