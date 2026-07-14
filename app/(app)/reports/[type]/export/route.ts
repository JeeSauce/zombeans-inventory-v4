import { NextRequest } from "next/server";
import { generateReportExport } from "@/lib/export";
import { can } from "@/lib/auth/context";
import { getMyPermissions, getSessionUser } from "@/lib/permissions";
import { getReportDefinition } from "@/lib/reports/catalog";
import { loadReport } from "@/lib/reports/data";
import { exportRequestSchema } from "@/lib/validation/phase9";

export async function GET(request: NextRequest, context: { params: Promise<{ type: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Authentication required", { status: 401 });

  const [{ type }, permissions] = await Promise.all([context.params, getMyPermissions()]);
  const definition = getReportDefinition(type);
  if (!definition) return new Response("Unknown report type", { status: 404 });
  if (definition.reportClass === "financial" && !can("cost.read", permissions)) {
    return new Response("Financial report permission required", { status: 403 });
  }

  const query = request.nextUrl.searchParams;
  const parsed = exportRequestSchema.safeParse({
    reportType: type,
    format: query.get("format"),
    startDate: query.get("start"),
    endDate: query.get("end"),
    branchId: query.get("branch"),
    categoryId: query.get("category"),
    itemType: query.get("itemType"),
  });
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid export request" },
      { status: 400 },
    );
  }

  try {
    const report = await loadReport(parsed.data.reportType, parsed.data);
    const output = generateReportExport(report, parsed.data.format);
    const body = output.body.buffer.slice(
      output.body.byteOffset,
      output.body.byteOffset + output.body.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "Content-Type": output.contentType,
        "Content-Disposition": `attachment; filename="${output.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export generation failed";
    return Response.json({ error: message }, { status: /permission/i.test(message) ? 403 : 500 });
  }
}
