import "server-only";
import { getEmailTransport } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";

interface ClaimedDelivery {
  delivery_id: string;
  notification_id: string;
  recipient_address: string;
  subject: string;
  body: string;
}

export interface NotificationDeliveryResult {
  claimed: number;
  delivered: number;
  failed: number;
}

/** Claim, send, and finalize queued notification emails. Safe to run concurrently. */
export async function dispatchPendingNotificationEmails(
  limit = 20,
): Promise<NotificationDeliveryResult> {
  const admin = createAdminClient();
  const transport = getEmailTransport();
  const claimToken = crypto.randomUUID();
  const { data, error } = await admin.rpc("claim_notification_email_deliveries", {
    p_claim_token: claimToken,
    p_limit: limit,
  });
  if (error) throw new Error(`Failed to claim notification email: ${error.message}`);

  const deliveries = (data ?? []) as ClaimedDelivery[];
  let delivered = 0;
  let failed = 0;
  for (const delivery of deliveries) {
    try {
      await transport.send({
        to: delivery.recipient_address,
        subject: `[Zombeans] ${delivery.subject}`,
        text: delivery.body,
        idempotencyKey: `notification-delivery-${delivery.delivery_id}`,
      });
      const { error: finalizeError } = await admin.rpc("finalize_notification_email_delivery", {
        p_delivery_id: delivery.delivery_id,
        p_claim_token: claimToken,
        p_succeeded: true,
        p_provider_message_id: null,
        p_error: null,
      });
      if (finalizeError) throw finalizeError;
      delivered += 1;
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : "Unknown delivery error";
      const { error: finalizeError } = await admin.rpc("finalize_notification_email_delivery", {
        p_delivery_id: delivery.delivery_id,
        p_claim_token: claimToken,
        p_succeeded: false,
        p_provider_message_id: null,
        p_error: message.slice(0, 500),
      });
      if (finalizeError) {
        throw new Error(`Failed to record notification email failure: ${finalizeError.message}`);
      }
      failed += 1;
    }
  }
  return { claimed: deliveries.length, delivered, failed };
}
