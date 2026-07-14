"use server";

import { revalidatePath } from "next/cache";
import { manilaLocalToUtc } from "@/lib/calendar/time";
import { requirePermission } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { calendarCreateSchema, calendarUpdateSchema } from "@/lib/validation/phase8";

export type CalendarActionState = { error?: string; info?: string; entityId?: string };

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Calendar command failed.";
  return message
    .replace(/^.*?:\s*/, "")
    .replace(/Permission denied: /i, "You do not have permission: ");
}

function revalidateCalendar() {
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  revalidatePath("/popups");
}

export async function createCalendarEventAction(
  _previous: CalendarActionState,
  formData: FormData,
): Promise<CalendarActionState> {
  try {
    await requirePermission("calendar.manage");
    const parsed = calendarCreateSchema.safeParse({
      title: formData.get("title"),
      description: formData.get("description"),
      location: formData.get("location"),
      eventType: formData.get("eventType"),
      branchId: formData.get("branchId"),
      startsAtLocal: formData.get("startsAtLocal"),
      endsAtLocal: formData.get("endsAtLocal"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid event." };

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_calendar_event", {
      p_title: parsed.data.title,
      p_description: parsed.data.description ?? null,
      p_location: parsed.data.location ?? null,
      p_event_type: parsed.data.eventType,
      p_branch_id: parsed.data.branchId ?? null,
      p_starts_at: manilaLocalToUtc(parsed.data.startsAtLocal),
      p_ends_at: manilaLocalToUtc(parsed.data.endsAtLocal),
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (error) return { error: cleanError(error) };
    const result = data as { event_id: string; reference: string; replayed: boolean };
    revalidateCalendar();
    return {
      info: result.replayed
        ? `${result.reference} was already saved.`
        : `Created ${result.reference}.`,
      entityId: result.event_id,
    };
  } catch (error) {
    return { error: cleanError(error) };
  }
}

export async function updateCalendarEventAction(
  _previous: CalendarActionState,
  formData: FormData,
): Promise<CalendarActionState> {
  try {
    await requirePermission("calendar.manage");
    const parsed = calendarUpdateSchema.safeParse({
      eventId: formData.get("eventId"),
      expectedVersion: formData.get("expectedVersion"),
      title: formData.get("title"),
      description: formData.get("description"),
      location: formData.get("location"),
      eventType: formData.get("eventType"),
      status: formData.get("status"),
      branchId: formData.get("branchId"),
      startsAtLocal: formData.get("startsAtLocal"),
      endsAtLocal: formData.get("endsAtLocal"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid event." };

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("update_calendar_event", {
      p_event_id: parsed.data.eventId,
      p_expected_version: parsed.data.expectedVersion,
      p_title: parsed.data.title,
      p_description: parsed.data.description ?? null,
      p_location: parsed.data.location ?? null,
      p_event_type: parsed.data.eventType,
      p_status: parsed.data.status,
      p_branch_id: parsed.data.branchId ?? null,
      p_starts_at: manilaLocalToUtc(parsed.data.startsAtLocal),
      p_ends_at: manilaLocalToUtc(parsed.data.endsAtLocal),
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (error) return { error: cleanError(error) };
    const result = data as { event_id: string; reference: string; replayed: boolean };
    revalidateCalendar();
    return {
      info: result.replayed
        ? `${result.reference} was already updated.`
        : `Updated ${result.reference}.`,
      entityId: result.event_id,
    };
  } catch (error) {
    return { error: cleanError(error) };
  }
}
