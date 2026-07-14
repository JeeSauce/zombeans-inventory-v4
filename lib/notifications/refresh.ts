import "server-only";
import { dispatchPendingNotificationEmails } from "@/lib/email/notification-delivery";
import { createClient } from "@/lib/supabase/server";

/** Refresh real database conditions, then drain any newly queued Critical email on the server. */
export async function refreshOperationalNotifications(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("refresh_operational_notifications");
  if (error) throw new Error(`Failed to refresh operational notifications: ${error.message}`);
  await dispatchPendingNotificationEmails();
}
