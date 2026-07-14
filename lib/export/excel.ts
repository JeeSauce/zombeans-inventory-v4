import type { ReportColumn, ReportEnvelope } from "@/lib/validation/phase9";

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formulaSafe(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function excelCell(value: unknown, column?: ReportColumn): string {
  const numeric =
    column && ["quantity", "money"].includes(column.type) && Number.isFinite(Number(value));
  const type = numeric ? "Number" : "String";
  const safeValue = numeric
    ? String(Number(value))
    : formulaSafe(value === null || value === undefined ? "" : String(value));
  const style = column?.type === "money" ? ' ss:StyleID="Money"' : "";
  return `<Cell${style}><Data ss:Type="${type}">${xmlEscape(safeValue)}</Data></Cell>`;
}

export function reportToExcelXml(report: ReportEnvelope): Uint8Array {
  const header = report.columns.map((column) => excelCell(column.label)).join("");
  const rows = report.rows
    .map(
      (row) =>
        `<Row>${report.columns.map((column) => excelCell(row[column.key], column)).join("")}</Row>`,
    )
    .join("");
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles><Style ss:ID="Money"><NumberFormat ss:Format="₱#,##0.00"/></Style></Styles>
 <Worksheet ss:Name="Report"><Table><Row>${header}</Row>${rows}</Table></Worksheet>
</Workbook>`;
  return new TextEncoder().encode(xml);
}
