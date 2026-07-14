"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { notificationReceiptSchema } from "@/lib/validation/phase8";

export type NotificationActionState = { error?: string; info?: string };

export async function setNotificationReceiptAction(
  _previous: NotificationActionState,
  formData: FormData,
): Promise<NotificationActionState> {
  const user = await getSessionUser();
  if (!user) return { error: "Authentication required." };
  const parsed = notificationReceiptSchema.safeParse({
    notificationId: formData.get("notificationId"),
    acknowledge: formData.get("acknowledge") === "true",
    idempotencyKey: formData.get("idempotencyKey"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid notification command." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_notification_receipt_state", {
    p_notification_id: parsed.data.notificationId,
    p_acknowledge: parsed.data.acknowledge,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  revalidatePath("/notifications");
  revalidatePath("/dashboard");
  return {
    info: parsed.data.acknowledge ? "Notification acknowledged." : "Notification marked read.",
  };
}
