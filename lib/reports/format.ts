import { formatHumanDate, formatHumanDateTime, formatPeso } from "@/lib/format";
import type { ReportColumn } from "@/lib/validation/phase9";

export function formatReportCell(value: unknown, column: ReportColumn): string {
  if (value === null || value === undefined || value === "") return "—";
  if (column.type === "money") return formatPeso(Number(value));
  if (column.type === "quantity") {
    return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 4 }).format(Number(value));
  }
  if (column.type === "date") return formatHumanDate(String(value));
  if (column.type === "datetime") return formatHumanDateTime(String(value));
  if (column.type === "boolean") return value ? "Yes" : "No";
  return String(value).replaceAll("_", " ");
}
