import type { ReportType } from "@/lib/validation/phase9";

export interface ReportDefinition {
  type: ReportType;
  title: string;
  description: string;
  reportClass: "operational" | "financial";
}

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  {
    type: "inventory-balances",
    title: "Inventory balances",
    description: "Current branch quantities, low/zero/negative positions, and base units.",
    reportClass: "operational",
  },
  {
    type: "stock-movements",
    title: "Stock movements",
    description: "Posted ledger movements by date, branch route, item, quantity, and reason.",
    reportClass: "operational",
  },
  {
    type: "production-output",
    title: "Production output",
    description: "Completed production orders and actual output quantities.",
    reportClass: "operational",
  },
  {
    type: "recount-variances",
    title: "Recount variances",
    description: "Frozen expected, physical, and variance quantities without protected values.",
    reportClass: "operational",
  },
  {
    type: "inventory-valuation",
    title: "Inventory valuation",
    description: "Current quantities valued at protected weighted-average cost.",
    reportClass: "financial",
  },
  {
    type: "movement-costs",
    title: "Frozen movement costs",
    description: "Historical ledger quantities valued with immutable unit-cost snapshots.",
    reportClass: "financial",
  },
] as const;

export function getReportDefinition(type: string): ReportDefinition | null {
  return REPORT_DEFINITIONS.find((report) => report.type === type) ?? null;
}

export function visibleReports(canReadCosts: boolean): readonly ReportDefinition[] {
  return REPORT_DEFINITIONS.filter(
    (report) => report.reportClass === "operational" || canReadCosts,
  );
}
