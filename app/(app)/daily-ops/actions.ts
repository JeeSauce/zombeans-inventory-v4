"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { refreshOperationalNotifications } from "@/lib/notifications/refresh";
import { requirePermission } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  dayCloseSchema,
  dayReopenSchema,
  recountOpenSchema,
  recountSubmitSchema,
  varianceAdjustmentSchema,
} from "@/lib/validation/recounts";

export type DailyOpsActionState = { error?: string; info?: string; entityId?: string };

function cleanError(message: string): string {
  return message
    .replace(/^.*?:\s*/, "")
    .replace(/Permission denied: /i, "You do not have permission: ")
    .replace(/required$/i, "is required.");
}

function revalidateDailyOps() {
  revalidatePath("/daily-ops");
  revalidatePath("/stock");
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
}

async function refreshNotificationsAfterRecount(): Promise<void> {
  try {
    await refreshOperationalNotifications();
  } catch (error) {
    console.error("Phase 8 notification refresh failed after recount command", error);
  }
}

export async function openRecountAction(
  _previous: DailyOpsActionState,
  formData: FormData,
): Promise<DailyOpsActionState> {
  try {
    const { user } = await requirePermission("recount.perform");
    const parsed = recountOpenSchema.safeParse({
      branchId: formData.get("branchId"),
      businessDate: formData.get("businessDate"),
      type: formData.get("type"),
      idempotencyKey: formData.get("idempotencyKey"),
      itemIds: formData.getAll("itemIds"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid recount request." };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("open_recount", {
      p_branch_id: parsed.data.branchId,
      p_business_date: parsed.data.businessDate,
      p_type: parsed.data.type,
      p_idempotency_key: parsed.data.idempotencyKey,
      p_item_ids: parsed.data.itemIds,
    });
    if (error) return { error: cleanError(error.message) };
    const result = data as {
      id: string;
      reference: string;
      status: string;
      already_exists: boolean;
    };
    if (!result.already_exists) {
      await writeAudit({
        actorId: user.id,
        action: "recount.opened",
        entityType: "recount_session",
        entityId: result.id,
        branchId: parsed.data.branchId,
        after: {
          reference: result.reference,
          type: parsed.data.type,
          businessDate: parsed.data.businessDate,
          itemCount: parsed.data.itemIds.length || undefined,
        },
      });
    }
    await refreshNotificationsAfterRecount();
    revalidateDailyOps();
    return {
      info: result.already_exists
        ? `${result.reference} was already opened.`
        : `${result.reference} is ready for physical counts.`,
      entityId: result.id,
    };
  } catch (error) {
    return {
      error: cleanError(error instanceof Error ? error.message : "Recount could not open."),
    };
  }
}

export async function submitRecountAction(
  _previous: DailyOpsActionState,
  formData: FormData,
): Promise<DailyOpsActionState> {
  try {
    const { user } = await requirePermission("recount.perform");
    const sessionId = String(formData.get("sessionId") ?? "");
    const supabase = await createClient();
    const { data: lines, error: lineError } = await supabase
      .from("recount_lines")
      .select("id")
      .eq("session_id", sessionId);
    if (lineError || !lines?.length) return { error: "Recount lines could not be loaded." };

    const parsed = recountSubmitSchema.safeParse({
      sessionId,
      idempotencyKey: formData.get("idempotencyKey"),
      lines: lines.map((line) => ({
        lineId: line.id,
        physicalQty: formData.get(`physical_${line.id}`),
      })),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid physical counts." };
    }

    const { data, error } = await supabase.rpc("submit_recount", {
      p_session_id: parsed.data.sessionId,
      p_idempotency_key: parsed.data.idempotencyKey,
      p_lines: parsed.data.lines.map((line) => ({
        line_id: line.lineId,
        physical_qty: line.physicalQty,
      })),
    });
    if (error) return { error: cleanError(error.message) };
    const result = data as {
      reference: string;
      status: "submitted" | "closed";
      is_unusual: boolean;
      already_exists: boolean;
    };
    if (!result.already_exists) {
      await writeAudit({
        actorId: user.id,
        action: "recount.submitted",
        entityType: "recount_session",
        entityId: parsed.data.sessionId,
        after: {
          reference: result.reference,
          status: result.status,
          unusual: result.is_unusual,
          lineCount: parsed.data.lines.length,
        },
      });
    }
    await refreshNotificationsAfterRecount();
    revalidateDailyOps();
    return {
      info:
        result.status === "closed"
          ? `${result.reference} matched expected stock and is complete.`
          : `${result.reference} was submitted for a reason-backed adjustment.`,
      entityId: parsed.data.sessionId,
    };
  } catch (error) {
    return {
      error: cleanError(error instanceof Error ? error.message : "Recount could not submit."),
    };
  }
}

export async function postVarianceAdjustmentAction(
  _previous: DailyOpsActionState,
  formData: FormData,
): Promise<DailyOpsActionState> {
  try {
    const { user } = await requirePermission("recount.perform");
    const parsed = varianceAdjustmentSchema.safeParse({
      sessionId: formData.get("sessionId"),
      reasonType: formData.get("reasonType"),
      reason: formData.get("reason"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid variance adjustment." };
    }

    const supabase = await createClient();
    const { data: session, error: sessionError } = await supabase
      .from("recount_sessions")
      .select("is_unusual, branch_id, reference")
      .eq("id", parsed.data.sessionId)
      .single();
    if (sessionError || !session) return { error: "Recount is no longer available." };
    if (session.is_unusual) await requirePermission("recount.confirm_unusual");

    const { data, error } = await supabase.rpc("post_recount_adjustment", {
      p_session_id: parsed.data.sessionId,
      p_reason_type: parsed.data.reasonType,
      p_reason: parsed.data.reason,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (error) return { error: cleanError(error.message) };
    const result = data as {
      id: string;
      reference: string;
      stock_txn_id: string;
      is_unusual: boolean;
      already_exists: boolean;
    };
    if (!result.already_exists) {
      await writeAudit({
        actorId: user.id,
        action: "recount.adjustment.posted",
        entityType: "variance_adjustment",
        entityId: result.id,
        branchId: session.branch_id,
        after: {
          reference: result.reference,
          recountReference: session.reference,
          reasonType: parsed.data.reasonType,
          unusual: result.is_unusual,
        },
        reason: parsed.data.reason,
      });
    }
    await refreshNotificationsAfterRecount();
    revalidateDailyOps();
    return {
      info: result.already_exists
        ? `${result.reference} was already posted.`
        : `${result.reference} posted as a compensating ledger entry.`,
      entityId: result.id,
    };
  } catch (error) {
    return {
      error: cleanError(error instanceof Error ? error.message : "Adjustment could not post."),
    };
  }
}

export async function closeDayAction(
  _previous: DailyOpsActionState,
  formData: FormData,
): Promise<DailyOpsActionState> {
  try {
    await requirePermission("recount.confirm");
    const parsed = dayCloseSchema.safeParse({
      branchId: formData.get("branchId"),
      businessDate: formData.get("businessDate"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid day close." };

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("close_day", {
      p_branch_id: parsed.data.branchId,
      p_business_date: parsed.data.businessDate,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (error) return { error: cleanError(error.message) };
    const result = data as { reference: string; already_exists: boolean };
    revalidateDailyOps();
    return {
      info: result.already_exists
        ? `${result.reference} already closed this day.`
        : "Business day closed. New stock postings are now blocked.",
    };
  } catch (error) {
    return { error: cleanError(error instanceof Error ? error.message : "Day could not close.") };
  }
}

export async function reopenDayAction(
  _previous: DailyOpsActionState,
  formData: FormData,
): Promise<DailyOpsActionState> {
  try {
    await requirePermission("closure.reopen");
    const parsed = dayReopenSchema.safeParse({
      branchId: formData.get("branchId"),
      businessDate: formData.get("businessDate"),
      reason: formData.get("reason"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid reopen." };

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("reopen_day", {
      p_branch_id: parsed.data.branchId,
      p_business_date: parsed.data.businessDate,
      p_reason: parsed.data.reason,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (error) return { error: cleanError(error.message) };
    const result = data as { reference: string; already_exists: boolean };
    revalidateDailyOps();
    return {
      info: result.already_exists
        ? `${result.reference} already reopened this day.`
        : "Business day reopened. Every later stock change will reference this audit event.",
    };
  } catch (error) {
    return { error: cleanError(error instanceof Error ? error.message : "Day could not reopen.") };
  }
}
