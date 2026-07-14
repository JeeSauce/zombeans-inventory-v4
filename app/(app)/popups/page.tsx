import { PopupsClient, type PopupListRow } from "@/components/popups/popups-client";
import { can, getAuthContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

export default async function PopupsPage() {
  const auth = await getAuthContext();
  const supabase = await createClient();
  const [sessionsResult, branchesResult] = await Promise.all([
    supabase
      .from("popup_event_sessions")
      .select(
        "id, reference, status, notes, created_at, calendar_events(title, location, starts_at, ends_at), popup_branch:branches!popup_event_sessions_popup_branch_id_fkey(name), return_branch:branches!popup_event_sessions_return_branch_id_fkey(name)",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("branches")
      .select("id, key, name, is_main")
      .eq("active", true)
      .is("deleted_at", null)
      .order("name"),
  ]);
  type Raw = {
    id: string;
    reference: string;
    status: PopupListRow["status"];
    notes: string | null;
    calendar_events: {
      title: string;
      location: string | null;
      starts_at: string;
      ends_at: string;
    } | null;
    popup_branch: { name: string } | null;
    return_branch: { name: string } | null;
  };
  const sessions: PopupListRow[] = ((sessionsResult.data as unknown as Raw[] | null) ?? []).map(
    (row) => ({
      id: row.id,
      reference: row.reference,
      status: row.status,
      title: row.calendar_events?.title ?? "Popup engagement",
      location: row.calendar_events?.location ?? null,
      startsAt: row.calendar_events?.starts_at ?? row.reference,
      endsAt: row.calendar_events?.ends_at ?? row.reference,
      popupBranchName: row.popup_branch?.name ?? "Zombeans Popup",
      returnBranchName: row.return_branch?.name ?? "Main",
      notes: row.notes,
    }),
  );
  const branches = branchesResult.data ?? [];
  return (
    <PopupsClient
      sessions={sessions}
      popupBranches={branches.filter((branch) => branch.key === "popup")}
      returnBranches={branches.filter((branch) => branch.is_main)}
      canManage={can("calendar.manage", auth.permissions)}
      loadError={Boolean(sessionsResult.error || branchesResult.error)}
    />
  );
}
