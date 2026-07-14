import {
  NotificationsClient,
  type NotificationRow,
} from "@/components/notifications/notifications-client";
import { getAuthContext } from "@/lib/auth/context";
import { refreshOperationalNotifications } from "@/lib/notifications/refresh";
import { createClient } from "@/lib/supabase/server";

export default async function NotificationsPage() {
  await getAuthContext();
  let refreshError = false;
  try {
    await refreshOperationalNotifications();
  } catch (error) {
    refreshError = true;
    console.error("Notification center refresh failed", error);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select(
      "id, reference, severity, source_type, status, title, message, entity_reference, email_required, first_raised_at, last_raised_at, raise_count, notification_receipts(read_at, acknowledged_at), notification_deliveries(channel, status)",
    )
    .eq("status", "active")
    .order("severity")
    .order("last_raised_at", { ascending: false });

  type RawNotification = Omit<NotificationRow, "readAt" | "acknowledgedAt" | "emailStatus"> & {
    notification_receipts: Array<{ read_at: string | null; acknowledged_at: string | null }> | null;
    notification_deliveries: Array<{ channel: string; status: string }> | null;
  };
  const rows = ((data as unknown as RawNotification[] | null) ?? []).map((row) => {
    const receipt = row.notification_receipts?.[0];
    const email = row.notification_deliveries?.find((delivery) => delivery.channel === "email");
    return {
      id: row.id,
      reference: row.reference,
      severity: row.severity,
      source_type: row.source_type,
      status: row.status,
      title: row.title,
      message: row.message,
      entity_reference: row.entity_reference,
      email_required: row.email_required,
      first_raised_at: row.first_raised_at,
      last_raised_at: row.last_raised_at,
      raise_count: row.raise_count,
      readAt: receipt?.read_at ?? null,
      acknowledgedAt: receipt?.acknowledged_at ?? null,
      emailStatus: email?.status ?? null,
    } satisfies NotificationRow;
  });

  return <NotificationsClient notifications={rows} loadError={Boolean(refreshError || error)} />;
}
