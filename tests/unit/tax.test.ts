import { describe, it, expect } from "vitest";
import { computeLineTax, parseTaxConfig, VAT_DISABLED, type TaxConfig } from "@/lib/catalog/tax";

const VAT_ON: TaxConfig = { enabled: true, rate: 0.12 };

describe("computeLineTax — critical scenario 20 (VAT only when enabled)", () => {
  it("does not tax when VAT is disabled, regardless of tax_mode", () => {
    for (const mode of ["none", "inclusive", "exclusive"] as const) {
      const r = computeLineTax(100, mode, VAT_DISABLED);
      expect(r.applied).toBe(false);
      expect(r.tax).toBe(0);
      expect(r.net).toBe(100);
      expect(r.gross).toBe(100);
    }
  });

  it("never taxes a 'none' price even when VAT is enabled", () => {
    const r = computeLineTax(100, "none", VAT_ON);
    expect(r.applied).toBe(false);
    expect(r.tax).toBe(0);
    expect(r.gross).toBe(100);
  });

  it("adds VAT on an exclusive price when enabled", () => {
    const r = computeLineTax(100, "exclusive", VAT_ON);
    expect(r).toMatchObject({ net: 100, tax: 12, gross: 112, rate: 0.12, applied: true });
  });

  it("extracts VAT from an inclusive price when enabled", () => {
    const r = computeLineTax(112, "inclusive", VAT_ON);
    expect(r).toMatchObject({ net: 100, tax: 12, gross: 112, applied: true });
  });

  it("treats a zero rate as no tax even if enabled", () => {
    const r = computeLineTax(100, "exclusive", { enabled: true, rate: 0 });
    expect(r.applied).toBe(false);
    expect(r.tax).toBe(0);
  });
});

describe("parseTaxConfig", () => {
  it("reads the DB jsonb shape", () => {
    const cfg = parseTaxConfig({ enabled: true, rate: 0.12, registered_name: "Zombeans", tin: "123" });
    expect(cfg).toEqual({ enabled: true, rate: 0.12, registeredName: "Zombeans", tin: "123" });
  });

  it("falls back to disabled for malformed input", () => {
    expect(parseTaxConfig(null)).toEqual(VAT_DISABLED);
    expect(parseTaxConfig(undefined)).toEqual(VAT_DISABLED);
  });

  it("coerces a string rate", () => {
    expect(parseTaxConfig({ enabled: false, rate: "0.12" }).rate).toBe(0.12);
  });
});
