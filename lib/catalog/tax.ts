import type { TaxMode } from "@/lib/validation/catalog";

/**
 * VAT computation — the TypeScript twin of the Postgres `compute_line_tax()` function (migration
 * 0008). The database remains the source of truth for stored/posted amounts; this helper is for
 * rendering prices in the UI without a round-trip. Both must agree (critical scenario 20:
 * "VAT is calculated only when enabled").
 */

export interface TaxConfig {
  enabled: boolean;
  rate: number; // fraction, e.g. 0.12 for 12%
  registeredName?: string | null;
  tin?: string | null;
}

export interface TaxBreakdown {
  net: number;
  tax: number;
  gross: number;
  rate: number;
  applied: boolean;
}

export const VAT_DISABLED: TaxConfig = { enabled: false, rate: 0.12 };

/** Round to 4 decimal places to match the DB's numeric(14,4) rounding. */
function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e4) / 1e4;
}

/**
 * VAT applies ONLY when the config is enabled AND the price's tax_mode is inclusive/exclusive.
 *   none      → never taxed
 *   exclusive → `price` is net; gross = price * (1 + rate)
 *   inclusive → `price` is gross; net = price / (1 + rate)
 */
export function computeLineTax(price: number, mode: TaxMode, cfg: TaxConfig): TaxBreakdown {
  const p = Number.isFinite(price) ? price : 0;

  if (!cfg.enabled || mode === "none" || cfg.rate === 0) {
    return { net: p, tax: 0, gross: p, rate: 0, applied: false };
  }

  if (mode === "exclusive") {
    const net = round4(p);
    const tax = round4(p * cfg.rate);
    return { net, tax, gross: round4(net + tax), rate: cfg.rate, applied: true };
  }

  // inclusive
  const gross = round4(p);
  const net = round4(p / (1 + cfg.rate));
  return { net, tax: round4(gross - net), gross, rate: cfg.rate, applied: true };
}

/** Parse the raw `application_settings.value` jsonb for key 'vat' into a typed config. */
export function parseTaxConfig(value: unknown): TaxConfig {
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return {
      enabled: Boolean(v.enabled),
      rate: typeof v.rate === "number" ? v.rate : Number(v.rate) || 0,
      registeredName: (v.registered_name as string | null) ?? null,
      tin: (v.tin as string | null) ?? null,
    };
  }
  return VAT_DISABLED;
}
