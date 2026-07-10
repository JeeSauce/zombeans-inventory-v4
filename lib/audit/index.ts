import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Append-only audit writer. Uses the service role (audit_logs has no client insert path). */
export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  branchId?: string | null;
  requestIp?: string | null;
  correlationId?: string | null;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("audit_logs").insert({
    actor_id: entry.actorId ?? null,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    branch_id: entry.branchId ?? null,
    request_ip: entry.requestIp ?? null,
    correlation_id: entry.correlationId ?? null,
  });
  if (error) {
    // Audit must never silently vanish; surface it.
    throw new Error(`Failed to write audit log: ${error.message}`);
  }
}
