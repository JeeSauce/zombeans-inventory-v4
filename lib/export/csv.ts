import type { ReportEnvelope } from "@/lib/validation/phase9";

function formulaSafe(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: unknown): string {
  const text = formulaSafe(value === null || value === undefined ? "" : String(value));
  return `"${text.replaceAll('"', '""')}"`;
}

export function reportToCsv(report: ReportEnvelope): Uint8Array {
  const lines = [report.columns.map((column) => csvCell(column.label)).join(",")];
  for (const row of report.rows) {
    lines.push(report.columns.map((column) => csvCell(row[column.key])).join(","));
  }
  return new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`);
}
