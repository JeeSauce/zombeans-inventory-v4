import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { ArrowLeft, Filter } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { ReportTable } from "@/components/reports/report-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { can, getAuthContext } from "@/lib/auth/context";
import { getReportDefinition } from "@/lib/reports/catalog";
import { loadReport } from "@/lib/reports/data";
import { createClient } from "@/lib/supabase/server";
import { ITEM_TYPES } from "@/lib/validation/phase8";
import {
  reportFilterSchema,
  type ExportFormat,
  type ReportFilters,
  type ReportType,
} from "@/lib/validation/phase9";

function firstParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function defaultFilters(): ReportFilters {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 29);
  return {
    startDate: formatInTimeZone(start, "Asia/Manila", "yyyy-MM-dd"),
    endDate: formatInTimeZone(now, "Asia/Manila", "yyyy-MM-dd"),
    branchId: null,
    categoryId: null,
    itemType: null,
  };
}

function exportHref(reportType: ReportType, filters: ReportFilters, format: ExportFormat): string {
  const params = new URLSearchParams({
    format,
    start: filters.startDate,
    end: filters.endDate,
  });
  if (filters.branchId) params.set("branch", filters.branchId);
  if (filters.categoryId) params.set("category", filters.categoryId);
  if (filters.itemType) params.set("itemType", filters.itemType);
  return `/reports/${reportType}/export?${params.toString()}`;
}

export default async function ReportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ type }, query, auth] = await Promise.all([params, searchParams, getAuthContext()]);
  const definition = getReportDefinition(type);
  if (!definition) notFound();
  if (definition.reportClass === "financial" && !can("cost.read", auth.permissions)) {
    redirect("/reports");
  }

  const defaults = defaultFilters();
  const parsed = reportFilterSchema.safeParse({
    startDate: firstParam(query.start) ?? defaults.startDate,
    endDate: firstParam(query.end) ?? defaults.endDate,
    branchId: firstParam(query.branch) ?? null,
    categoryId: firstParam(query.category) ?? null,
    itemType: firstParam(query.itemType) ?? null,
  });
  const filters = parsed.success ? parsed.data : defaults;
  const supabase = await createClient();
  const [report, branchesResult, categoriesResult] = await Promise.all([
    loadReport(definition.type, filters),
    supabase
      .from("branches")
      .select("id, name")
      .is("deleted_at", null)
      .eq("active", true)
      .order("name"),
    supabase
      .from("categories")
      .select("id, name, item_type")
      .is("deleted_at", null)
      .eq("active", true)
      .order("name"),
  ]);
  if (branchesResult.error || categoriesResult.error) {
    throw new Error("Report filter options could not be loaded.");
  }

  return (
    <main className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="print-hidden">
        <Button asChild variant="ghost" className="-ml-3">
          <Link href="/reports">
            <ArrowLeft aria-hidden="true" /> All reports
          </Link>
        </Button>
      </div>
      <div>
        <p className="text-muted-foreground text-sm capitalize">{definition.reportClass} report</p>
        <h1 className="font-heading text-2xl font-semibold sm:text-3xl">{definition.title}</h1>
        <p className="text-muted-foreground mt-2 text-sm">{definition.description}</p>
      </div>

      {!parsed.success ? (
        <Alert className="border-amber-500/40">
          <Filter aria-hidden="true" />
          <AlertTitle>Invalid filters were ignored</AlertTitle>
          <AlertDescription>
            {parsed.error.issues[0]?.message ?? "Use a valid report filter."} Showing the default
            30-day range instead.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="print-hidden">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="start">Start date</Label>
              <Input id="start" name="start" type="date" defaultValue={filters.startDate} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end">End date</Label>
              <Input id="end" name="end" type="date" defaultValue={filters.endDate} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch">Branch</Label>
              <select
                id="branch"
                name="branch"
                defaultValue={filters.branchId ?? ""}
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              >
                <option value="">All accessible branches</option>
                {(branchesResult.data ?? []).map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <select
                id="category"
                name="category"
                defaultValue={filters.categoryId ?? ""}
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              >
                <option value="">All categories</option>
                {(categoriesResult.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="itemType">Item type</Label>
              <select
                id="itemType"
                name="itemType"
                defaultValue={filters.itemType ?? ""}
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              >
                <option value="">All item types</option>
                {ITEM_TYPES.map((itemType) => (
                  <option key={itemType} value={itemType}>
                    {itemType.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2 xl:col-span-5">
              <Button type="submit">
                <Filter aria-hidden="true" /> Apply filters
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <ReportTable
        report={report}
        exportHref={(format) => exportHref(definition.type, filters, format)}
      />
    </main>
  );
}
