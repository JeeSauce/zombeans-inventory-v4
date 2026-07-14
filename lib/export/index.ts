import "server-only";
import { reportToCsv } from "@/lib/export/csv";
import { reportToExcelXml } from "@/lib/export/excel";
import { reportToPdf } from "@/lib/export/pdf";
import type { ExportFormat, ReportEnvelope } from "@/lib/validation/phase9";

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  excel: "application/vnd.ms-excel; charset=utf-8",
  pdf: "application/pdf",
};
const EXTENSIONS: Record<ExportFormat, string> = { csv: "csv", excel: "xls", pdf: "pdf" };

export function generateReportExport(report: ReportEnvelope, format: ExportFormat) {
  const body =
    format === "csv"
      ? reportToCsv(report)
      : format === "excel"
        ? reportToExcelXml(report)
        : reportToPdf(report);
  return {
    body,
    contentType: CONTENT_TYPES[format],
    filename: `${report.reportType}-${report.filters.endDate}.${EXTENSIONS[format]}`,
  };
}
