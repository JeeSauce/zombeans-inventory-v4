import { redirect } from "next/navigation";
import { getAuthContext, can } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { formatHumanDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function AuditPage() {
  const ctx = await getAuthContext();
  if (!can("audit.read", ctx.permissions)) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, created_at, actor:profiles(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(100);

  type Row = {
    id: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    created_at: string;
    actor: { full_name: string; email: string } | null;
  };
  const rows = (data as Row[] | null) ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Administration</p>
        <h1 className="font-display mt-1 text-3xl">Audit log</h1>
        <p className="text-muted-foreground mt-1">
          The 100 most recent security and account events. Append-only.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
          No audit activity yet.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-data text-muted-foreground text-xs whitespace-nowrap">
                    {formatHumanDateTime(r.created_at)}
                  </TableCell>
                  <TableCell className="text-sm">{r.actor?.full_name ?? "System"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-data text-xs">
                      {r.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{r.entity_type}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
