import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getReportDefinition } from "@/lib/reports/catalog";
import {
  reportEnvelopeSchema,
  type ReportEnvelope,
  type ReportFilters,
  type ReportType,
} from "@/lib/validation/phase9";

export async function loadReport(
  reportType: ReportType,
  filters: ReportFilters,
): Promise<ReportEnvelope> {
  const definition = getReportDefinition(reportType);
  if (!definition) throw new Error("Unknown report type.");

  const supabase = await createClient();
  const args = {
    p_report_type: reportType,
    p_start_date: filters.startDate,
    p_end_date: filters.endDate,
    p_branch_id: filters.branchId ?? null,
    p_category_id: filters.categoryId ?? null,
    p_item_type: filters.itemType ?? null,
  };
  const { data, error } =
    definition.reportClass === "financial"
      ? await supabase.rpc("get_financial_report", args)
      : await supabase.rpc("get_operational_report", args);
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, ""));

  const parsed = reportEnvelopeSchema.safeParse(data);
  if (!parsed.success) throw new Error("The report response did not match its safe data contract.");
  if (parsed.data.reportType !== reportType || parsed.data.reportClass !== definition.reportClass) {
    throw new Error("The report response did not match the requested report.");
  }
  return parsed.data;
}
