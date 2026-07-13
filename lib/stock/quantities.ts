export const QTY_SCALE = 4;

export function normalizeQty(value: number): number {
  return Number(value.toFixed(QTY_SCALE));
}

export interface ReceivingCounts {
  shipped: number;
  received: number;
  rejected: number;
  damaged: number;
  missing: number;
}

export function accountedReceivingQty(counts: ReceivingCounts): number {
  return normalizeQty(counts.received + counts.rejected + counts.damaged + counts.missing);
}

export function isReceivingBalanced(counts: ReceivingCounts): boolean {
  return accountedReceivingQty(counts) === normalizeQty(counts.shipped);
}

export function hasReceivingDiscrepancy(counts: ReceivingCounts): boolean {
  return normalizeQty(counts.rejected + counts.damaged + counts.missing) > 0;
}

export function isCriticalBalance(qtyOnHand: number): boolean {
  return normalizeQty(qtyOnHand) < 0;
}
