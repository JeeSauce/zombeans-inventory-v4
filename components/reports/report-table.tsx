import { AlertCircle, Download, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PrintButton } from "@/components/reports/print-button";
import { formatReportCell } from "@/lib/reports/format";
import type { ExportFormat, ReportEnvelope } from "@/lib/validation/phase9";

function summaryLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function summaryValue(key: string, value: unknown): string {
  if (/value/i.test(key)) {
    return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
      Number(value),
    );
  }
  return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 4 }).format(Number(value));
}

export function ReportTable({
  report,
  exportHref,
}: {
  report: ReportEnvelope;
  exportHref: (format: ExportFormat) => string;
}) {
  return (
    <div className="space-y-6">
      {report.reportClass === "financial" ? (
        <Alert className="border-amber-500/40 bg-amber-500/5">
          <LockKeyhole aria-hidden="true" />
          <AlertTitle>Financial report</AlertTitle>
          <AlertDescription>
            Protected cost values are authorized by the database and included only for Super Admin.
          </AlertDescription>
        </Alert>
      ) : null}

      {report.note ? (
        <Alert>
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Report note</AlertTitle>
          <AlertDescription>{report.note}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(report.summary).map(([key, value]) => (
          <Card key={key} className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-muted-foreground text-sm font-medium">
                {summaryLabel(key)}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 text-2xl font-semibold">
              {summaryValue(key, value)}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="print-hidden flex flex-wrap gap-2">
        {(["csv", "excel", "pdf"] as const).map((format) => (
          <Button asChild variant="outline" key={format}>
            <Link href={exportHref(format)} prefetch={false}>
              <Download aria-hidden="true" />
              {format === "excel" ? "Excel" : format.toUpperCase()}
            </Link>
          </Button>
        ))}
        <PrintButton />
      </div>

      <Card className="print-card gap-3 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              {report.columns.map((column) => (
                <TableHead key={column.key}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.rows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {report.columns.map((column) => (
                  <TableCell key={column.key}>
                    {formatReportCell(row[column.key], column)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!report.rows.length ? (
          <div className="text-muted-foreground px-6 py-12 text-center">
            No report rows match these filters. Try a wider date range or another branch.
          </div>
        ) : null}
      </Card>
    </div>
  );
}
