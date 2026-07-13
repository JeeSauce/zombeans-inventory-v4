import { redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import {
  DailyOpsClient,
  type DayClosureView,
  type RecountLineView,
  type RecountSessionView,
} from "@/components/daily-ops/daily-ops-client";
import { can, getAuthContext } from "@/lib/auth/context";
import { formatHumanDate, formatHumanDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function DailyOpsPage() {
  const auth = await getAuthContext();
  const participating = [
    "recount.perform",
    "recount.confirm",
    "recount.confirm_unusual",
    "closure.reopen",
  ].some((permission) => can(permission, auth.permissions));
  if (!participating) redirect("/dashboard");

  const businessDate = formatInTimeZone(new Date(), "Asia/Manila", "yyyy-MM-dd");
  const supabase = await createClient();
  const [branchesResult, itemsResult, sessionsResult, closuresResult] = await Promise.all([
    supabase
      .from("branches")
      .select("id, name, is_main")
      .eq("active", true)
      .is("deleted_at", null)
      .order("is_main", { ascending: false })
      .order("name"),
    supabase
      .from("inventory_items")
      .select("id, name, sku, units:base_unit_id(code)")
      .eq("active", true)
      .eq("trackable", true)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("recount_sessions")
      .select(
        "id, reference, branch_id, business_date, type, status, is_unusual, unusual_signals, opened_at, submitted_at",
      )
      .eq("business_date", businessDate)
      .order("opened_at", { ascending: false }),
    supabase
      .from("daily_operational_closures")
      .select("id, reference, branch_id, business_date, status, last_closed_at, last_reopened_at")
      .eq("business_date", businessDate)
      .order("created_at", { ascending: false }),
  ]);

  const sessionRows = sessionsResult.data ?? [];
  const sessionIds = sessionRows.map((session) => session.id);
  const closureRows = closuresResult.data ?? [];
  const closureIds = closureRows.map((closure) => closure.id);

  const [linesResult, adjustmentsResult, eventsResult] = await Promise.all([
    sessionIds.length > 0
      ? supabase
          .from("recount_lines")
          .select(
            "id, session_id, item_id, unit_id, expected_qty, physical_qty, variance_qty, unusual_signals, inventory_items(name, sku), units(code)",
          )
          .in("session_id", sessionIds)
          .order("created_at")
      : Promise.resolve({ data: [], error: null }),
    sessionIds.length > 0
      ? supabase
          .from("variance_adjustments")
          .select("session_id, reference, reason")
          .in("session_id", sessionIds)
      : Promise.resolve({ data: [], error: null }),
    closureIds.length > 0
      ? supabase
          .from("day_close_events")
          .select("id, reference, closure_id, event_type, reason, created_at")
          .in("closure_id", closureIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const eventRows = eventsResult.data ?? [];
  const eventIds = eventRows.map((event) => event.id);
  const changesResult = eventIds.length
    ? await supabase
        .from("stock_transactions")
        .select("reference, type, reason, created_at, day_reopen_event_id")
        .in("day_reopen_event_id", eventIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };

  const branchMap = new Map((branchesResult.data ?? []).map((branch) => [branch.id, branch.name]));
  const lineMap = new Map<string, RecountLineView[]>();
  for (const row of linesResult.data ?? []) {
    const item = row.inventory_items as unknown as { name: string; sku: string } | null;
    const unit = row.units as unknown as { code: string } | null;
    const line: RecountLineView = {
      id: row.id,
      itemId: row.item_id,
      itemName: item?.name ?? "Inventory item",
      itemSku: item?.sku ?? "SKU unavailable",
      unitCode: unit?.code ?? "unit",
      expectedQty: Number(row.expected_qty),
      physicalQty: row.physical_qty == null ? null : Number(row.physical_qty),
      varianceQty: row.variance_qty == null ? null : Number(row.variance_qty),
      unusualSignals: (row.unusual_signals as string[] | null) ?? [],
    };
    lineMap.set(row.session_id, [...(lineMap.get(row.session_id) ?? []), line]);
  }
  const adjustmentMap = new Map(
    (adjustmentsResult.data ?? []).map((adjustment) => [adjustment.session_id, adjustment]),
  );
  const sessions: RecountSessionView[] = sessionRows.map((session) => {
    const adjustment = adjustmentMap.get(session.id);
    return {
      id: session.id,
      reference: session.reference,
      branchId: session.branch_id,
      branchName: branchMap.get(session.branch_id) ?? "Branch",
      type: session.type as RecountSessionView["type"],
      status: session.status as RecountSessionView["status"],
      isUnusual: session.is_unusual,
      unusualSignals: (session.unusual_signals as string[] | null) ?? [],
      openedAt: formatHumanDateTime(session.opened_at),
      submittedAt: session.submitted_at ? formatHumanDateTime(session.submitted_at) : null,
      adjustmentReference: adjustment?.reference ?? null,
      adjustmentReason: adjustment?.reason ?? null,
      lines: lineMap.get(session.id) ?? [],
    };
  });

  const changesByEvent = new Map<
    string,
    Array<{ reference: string; type: string; reason: string | null; createdAt: string }>
  >();
  for (const change of changesResult.data ?? []) {
    if (!change.day_reopen_event_id) continue;
    const existing = changesByEvent.get(change.day_reopen_event_id) ?? [];
    existing.push({
      reference: change.reference,
      type: change.type,
      reason: change.reason,
      createdAt: formatHumanDateTime(change.created_at),
    });
    changesByEvent.set(change.day_reopen_event_id, existing);
  }
  const eventsByClosure = new Map<string, DayClosureView["events"]>();
  for (const event of eventRows) {
    const existing = eventsByClosure.get(event.closure_id) ?? [];
    existing.push({
      id: event.id,
      reference: event.reference,
      type: event.event_type as "close" | "reopen",
      reason: event.reason,
      createdAt: formatHumanDateTime(event.created_at),
      laterChanges: changesByEvent.get(event.id) ?? [],
    });
    eventsByClosure.set(event.closure_id, existing);
  }
  const closures: DayClosureView[] = closureRows.map((closure) => ({
    id: closure.id,
    reference: closure.reference,
    branchId: closure.branch_id,
    status: closure.status as "closed" | "reopened",
    lastClosedAt: formatHumanDateTime(closure.last_closed_at),
    lastReopenedAt: closure.last_reopened_at ? formatHumanDateTime(closure.last_reopened_at) : null,
    events: eventsByClosure.get(closure.id) ?? [],
  }));

  const loadError = Boolean(
    branchesResult.error ||
    itemsResult.error ||
    sessionsResult.error ||
    closuresResult.error ||
    linesResult.error ||
    adjustmentsResult.error ||
    eventsResult.error ||
    changesResult.error,
  );

  return (
    <DailyOpsClient
      branches={(branchesResult.data ?? []).map((branch) => ({
        id: branch.id,
        name: branch.name,
        isMain: branch.is_main,
      }))}
      items={(itemsResult.data ?? []).map((item) => ({
        id: item.id,
        name: item.name,
        sku: item.sku,
        unitCode: (item.units as unknown as { code: string } | null)?.code ?? "unit",
      }))}
      sessions={sessions}
      closures={closures}
      businessDate={businessDate}
      businessDateLabel={formatHumanDate(businessDate)}
      canPerform={can("recount.perform", auth.permissions)}
      canClose={can("recount.confirm", auth.permissions)}
      canConfirmUnusual={can("recount.confirm_unusual", auth.permissions)}
      canReopen={can("closure.reopen", auth.permissions)}
      loadError={loadError}
    />
  );
}
