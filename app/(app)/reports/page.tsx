import Link from "next/link";
import { ArrowRight, BarChart3, LockKeyhole } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can, getAuthContext } from "@/lib/auth/context";
import { visibleReports } from "@/lib/reports/catalog";

export default async function ReportsPage() {
  const auth = await getAuthContext();
  const reports = visibleReports(can("cost.read", auth.permissions));

  return (
    <main className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <p className="text-muted-foreground text-sm">Operations and finance</p>
        <h1 className="font-heading text-2xl font-semibold sm:text-3xl">Reports</h1>
        <p className="text-muted-foreground mt-2 max-w-3xl text-sm">
          Branch-aware views and server-generated exports. Financial reports are protected in both
          the interface and database.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {reports.map((report) => (
          <Link key={report.type} href={`/reports/${report.type}`} className="group">
            <Card className="h-full transition-colors group-hover:border-[#31E11A]/60">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="bg-muted rounded-lg p-2">
                    {report.reportClass === "financial" ? (
                      <LockKeyhole className="size-5" aria-hidden="true" />
                    ) : (
                      <BarChart3 className="size-5" aria-hidden="true" />
                    )}
                  </div>
                  <Badge variant={report.reportClass === "financial" ? "outline" : "secondary"}>
                    {report.reportClass}
                  </Badge>
                </div>
                <CardTitle>{report.title}</CardTitle>
                <CardDescription>{report.description}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm font-medium">
                Open report <ArrowRight className="ml-1 inline size-4" aria-hidden="true" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
