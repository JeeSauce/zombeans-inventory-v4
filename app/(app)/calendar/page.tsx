import { CalendarClient, type CalendarEventRow } from "@/components/calendar/calendar-client";
import { can, getAuthContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

export default async function CalendarPage() {
  const auth = await getAuthContext();
  const supabase = await createClient();
  const [eventsResult, branchesResult] = await Promise.all([
    supabase
      .from("calendar_events")
      .select(
        "id, reference, title, description, location, event_type, status, branch_id, starts_at, ends_at, version, branches(name)",
      )
      .order("starts_at"),
    supabase
      .from("branches")
      .select("id, name")
      .eq("active", true)
      .is("deleted_at", null)
      .order("name"),
  ]);
  const events: CalendarEventRow[] = (eventsResult.data ?? []).map((event) => ({
    id: event.id,
    reference: event.reference,
    title: event.title,
    description: event.description,
    location: event.location,
    eventType: event.event_type as CalendarEventRow["eventType"],
    status: event.status as CalendarEventRow["status"],
    branchId: event.branch_id,
    branchName: (event.branches as unknown as { name: string } | null)?.name ?? null,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    version: event.version,
  }));
  return (
    <CalendarClient
      events={events}
      branches={branchesResult.data ?? []}
      canManage={can("calendar.manage", auth.permissions)}
      loadError={Boolean(eventsResult.error || branchesResult.error)}
    />
  );
}
