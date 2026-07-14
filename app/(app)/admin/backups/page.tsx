import { redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, DatabaseBackup, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { can, getAuthContext } from "@/lib/auth/context";
import { formatHumanDate, formatHumanDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { backupStatusSchema } from "@/lib/validation/phase9";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export default async function BackupsPage() {
  const auth = await getAuthContext();
  if (!can("backup.manage", auth.permissions)) redirect("/dashboard");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_backup_status");
  if (error) throw new Error(error.message);
  const parsed = backupStatusSchema.safeParse(data);
  if (!parsed.success) throw new Error("Backup status did not match its safe metadata contract.");
  const status = parsed.data;
  const latestHealthy = status.latest && ["succeeded", "verified"].includes(status.latest.status);

  return (
    <main className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <p className="text-muted-foreground text-sm">Super Admin</p>
        <h1 className="font-heading text-2xl font-semibold sm:text-3xl">Backups</h1>
        <p className="text-muted-foreground mt-2 max-w-3xl text-sm">
          Non-secret run metadata and recovery readiness. Backup data and credentials never pass
          through this app.
        </p>
      </div>

      {status.latest ? (
        <Alert
          className={
            latestHealthy
              ? "border-emerald-500/40 bg-emerald-500/5"
              : "border-amber-500/40 bg-amber-500/5"
          }
        >
          {latestHealthy ? (
            <CheckCircle2 aria-hidden="true" />
          ) : (
            <AlertTriangle aria-hidden="true" />
          )}
          <AlertTitle>Latest run: {status.latest.reference}</AlertTitle>
          <AlertDescription>
            {status.latest.status.replaceAll("_", " ")} · started{" "}
            {formatHumanDateTime(status.latest.startedAt)}
            {status.latest.safeFailureSummary ? ` · ${status.latest.safeFailureSummary}` : ""}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="border-amber-500/40 bg-amber-500/5">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>No backup runs recorded</AlertTitle>
          <AlertDescription>
            Connect secured CI/cron to the service-role metadata RPC after configuring encrypted
            off-site storage.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(status.policy).map(([key, value]) => (
          <Card key={key}>
            <CardHeader>
              <div className="bg-muted w-fit rounded-lg p-2">
                {key === "restoreTest" ? (
                  <ShieldCheck className="size-5" aria-hidden="true" />
                ) : (
                  <DatabaseBackup className="size-5" aria-hidden="true" />
                )}
              </div>
              <CardTitle className="capitalize">
                {key.replace(/([a-z])([A-Z])/g, "$1 $2")}
              </CardTitle>
              <CardDescription>{value}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Backup history</CardTitle>
          <CardDescription>Safe metadata only; no object keys or database URLs.</CardDescription>
        </CardHeader>
        <CardContent>
          {status.history.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Mechanism</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Encrypted</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Retention</TableHead>
                  <TableHead>Verified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.history.map((run) => (
                  <TableRow key={run.reference}>
                    <TableCell className="font-medium">{run.reference}</TableCell>
                    <TableCell>{run.mechanism.replaceAll("_", " ")}</TableCell>
                    <TableCell>
                      <Badge variant={run.status === "failed" ? "destructive" : "secondary"}>
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatHumanDateTime(run.startedAt)}</TableCell>
                    <TableCell>{run.encrypted ? "Yes" : "No"}</TableCell>
                    <TableCell>{formatBytes(run.sizeBytes)}</TableCell>
                    <TableCell>
                      {run.retentionUntil ? formatHumanDate(run.retentionUntil) : "—"}
                    </TableCell>
                    <TableCell>
                      {run.verifiedAt ? formatHumanDateTime(run.verifiedAt) : "Not verified"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">
              History will appear after secured infrastructure records its first run.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Restore drill</CardTitle>
          <CardDescription>
            Quarterly, restore the latest encrypted export into a scratch project.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Provision an isolated scratch Supabase project or local instance.</li>
            <li>
              Run <code className="bg-muted rounded px-1">pg_restore --clean --if-exists</code> from
              secured infrastructure.
            </li>
            <li>Run strict typecheck and smoke browser tests against the restored database.</li>
            <li>
              Record the result and measured RTO in the changelog; use PITR first for production
              recovery.
            </li>
          </ol>
        </CardContent>
      </Card>
    </main>
  );
}
