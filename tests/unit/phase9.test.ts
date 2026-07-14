import { describe, expect, it } from "vitest";
import { reportToCsv } from "@/lib/export/csv";
import { reportToExcelXml } from "@/lib/export/excel";
import { reportToPdf } from "@/lib/export/pdf";
import { visibleReports } from "@/lib/reports/catalog";
import {
  exportRequestSchema,
  reportFilterSchema,
  type ReportEnvelope,
} from "@/lib/validation/phase9";

const report: ReportEnvelope = {
  reportType: "stock-movements",
  title: "Stock movements",
  reportClass: "operational",
  generatedAt: "2026-07-14T02:00:00.000Z",
  filters: {
    startDate: "2026-07-01",
    endDate: "2026-07-14",
    branchId: null,
    categoryId: null,
    itemType: null,
  },
  columns: [
    { key: "reference", label: "Reference", type: "text" },
    { key: "quantity", label: "Quantity", type: "quantity" },
  ],
  rows: [{ reference: '=HYPERLINK("bad")', quantity: 12.5 }],
  summary: { rowCount: 1 },
  note: null,
};

describe("Phase 9 report validation", () => {
  it("accepts a bounded date range and rejects reversed or oversized ranges", () => {
    expect(
      reportFilterSchema.safeParse({
        startDate: "2026-07-01",
        endDate: "2026-07-14",
        branchId: "",
        categoryId: "",
        itemType: "",
      }).success,
    ).toBe(true);
    expect(
      reportFilterSchema.safeParse({
        startDate: "2026-07-15",
        endDate: "2026-07-14",
      }).success,
    ).toBe(false);
    expect(
      reportFilterSchema.safeParse({
        startDate: "2024-01-01",
        endDate: "2026-07-14",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown report types and export formats", () => {
    expect(
      exportRequestSchema.safeParse({
        reportType: "inventory-balances",
        format: "csv",
        startDate: "2026-07-01",
        endDate: "2026-07-14",
      }).success,
    ).toBe(true);
    expect(
      exportRequestSchema.safeParse({
        reportType: "supplier-prices",
        format: "xlsx-macro",
        startDate: "2026-07-01",
        endDate: "2026-07-14",
      }).success,
    ).toBe(false);
  });

  it("shows financial definitions only to cost readers", () => {
    expect(visibleReports(false)).toHaveLength(4);
    expect(visibleReports(false).every((entry) => entry.reportClass === "operational")).toBe(true);
    expect(visibleReports(true)).toHaveLength(6);
  });
});

describe("Phase 9 server export encoders", () => {
  it("emits RFC-style CSV and neutralizes spreadsheet formulas", () => {
    const bytes = reportToCsv(report);
    const csv = new TextDecoder().decode(bytes);
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv).toContain('"Reference","Quantity"');
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
  });

  it("emits Excel-compatible SpreadsheetML with formula-safe strings", () => {
    const excel = new TextDecoder().decode(reportToExcelXml(report));
    expect(excel).toContain("Excel.Sheet");
    expect(excel).toContain("&apos;=HYPERLINK");
    expect(excel).toContain('ss:Type="Number">12.5');
  });

  it("emits a self-contained paginated PDF document", () => {
    const pdf = new TextDecoder().decode(reportToPdf(report));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("Stock movements");
    expect(pdf).toContain("xref");
    expect(pdf.endsWith("%%EOF")).toBe(true);
  });
});
