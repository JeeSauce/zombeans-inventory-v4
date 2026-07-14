import Link from "next/link";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export async function NotificationBell() {
  const supabase = await createClient();
  const { count } = await supabase
    .from("notification_receipts")
    .select("id, notifications!inner(status)", { count: "exact", head: true })
    .eq("notifications.status", "active")
    .is("read_at", null);
  const unread = count ?? 0;
  return (
    <Link
      href="/notifications"
      aria-label={unread ? `${unread} unread notifications` : "Notifications"}
      className="hover:bg-accent focus-visible:ring-ring relative inline-flex size-9 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
    >
      <Bell className="size-5" />
      {unread > 0 && (
        <span className="bg-destructive text-destructive-foreground absolute -top-1 -right-1 min-w-5 rounded-full px-1 text-center text-[0.65rem] font-semibold">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
