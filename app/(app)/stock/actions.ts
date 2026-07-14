"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { refreshOperationalNotifications } from "@/lib/notifications/refresh";
import { requirePermission } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  discrepancyResolutionSchema,
  stockInSchema,
  stockOutSchema,
  stockRequestCreateSchema,
  stockRequestReviewSchema,
  transferIdSchema,
  transferPrepareSchema,
  transferReceiveSchema,
} from "@/lib/validation/stock";

export type StockActionState = { error?: string; info?: string; entityId?: string };

function cleanError(message: string): string {
  return message.replace(/^.*?:\s*/, "");
}

function revalidateStock(transferId?: string) {
  revalidatePath("/stock");
  revalidatePath("/stock/requests");
  revalidatePath("/stock/transfers");
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
  if (transferId) revalidatePath(`/stock/transfers/${transferId}`);
}

async function refreshNotificationsAfterStock(): Promise<void> {
  try {
    await refreshOperationalNotifications();
  } catch (error) {
    // The stock mutation is already committed and idempotent. Its database trigger has atomically
    // persisted any Critical negative alert/outbox row; a later request can retry delivery.
    console.error("Phase 8 notification refresh failed after stock command", error);
  }
}

export async function postStockInAction(
  _previous: StockActionState,
  formData: FormData,
): Promise<StockActionState> {
  const { user } = await requirePermission("stock.in");
  const parsed = stockInSchema.safeParse({
    branchId: formData.get("branchId"),
    reason: formData.get("reason"),
    notes: formData.get("notes") || null,
    idempotencyKey: formData.get("idempotencyKey"),
    lines: [
      {
        itemId: formData.get("itemId"),
        qty: formData.get("qty"),
        lotNumber: formData.get("lotNumber") || null,
        expirationDate: formData.get("expirationDate") || null,
      },
    ],
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid stock-in" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_stock_in", {
    p_branch_id: parsed.data.branchId,
    p_reason: parsed.data.reason,
    p_notes: parsed.data.notes ?? null,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_lines: parsed.data.lines.map((line) => ({
      item_id: line.itemId,
      qty: line.qty,
      lot_number: line.lotNumber ?? null,
      expiration_date: line.expirationDate ?? null,
    })),
  });
  if (error) return { error: cleanError(error.message) };
  await writeAudit({
    actorId: user.id,
    action: "stock.in.posted",
    entityType: "stock_transaction",
    entityId: data as string,
    branchId: parsed.data.branchId,
    after: { reason: parsed.data.reason, lineCount: parsed.data.lines.length },
  });
  await refreshNotificationsAfterStock();
  revalidateStock();
  return { info: "Stock-in posted to the append-only ledger." };
}

export async function postStockOutAction(
  _previous: StockActionState,
  formData: FormData,
): Promise<StockActionState> {
  const { user } = await requirePermission("stock.out");
  const parsed = stockOutSchema.safeParse({
    branchId: formData.get("branchId"),
    reason: formData.get("reason"),
    notes: formData.get("notes") || null,
    idempotencyKey: formData.get("idempotencyKey"),
    lines: [{ itemId: formData.get("itemId"), qty: formData.get("qty") }],
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid stock-out" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_stock_out", {
    p_branch_id: parsed.data.branchId,
    p_reason: parsed.data.reason,
    p_notes: parsed.data.notes ?? null,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_lines: parsed.data.lines.map((line) => ({ item_id: line.itemId, qty: line.qty })),
  });
  if (error) return { error: cleanError(error.message) };
  await writeAudit({
    actorId: user.id,
    action: "stock.out.posted",
    entityType: "stock_transaction",
    entityId: data as string,
    branchId: parsed.data.branchId,
    after: { reason: parsed.data.reason, lineCount: parsed.data.lines.length },
  });
  await refreshNotificationsAfterStock();
  revalidateStock();
  return {
    info: "Stock-out posted. Any negative balance remains visible with a Critical alert.",
  };
}

export async function createStockRequestAction(
  _previous: StockActionState,
  formData: FormData,
): Promise<StockActionState> {
  const { user } = await requirePermission("stock.transfer.prepare");
  const parsed = stockRequestCreateSchema.safeParse({
    requestingBranchId: formData.get("requestingBranchId"),
    notes: formData.get("notes") || null,
    idempotencyKey: formData.get("idempotencyKey"),
    lines: [{ itemId: formData.get("itemId"), qty: formData.get("qty") }],
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_stock_request", {
    p_requesting_branch_id: parsed.data.requestingBranchId,
    p_notes: parsed.data.notes ?? null,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_lines: parsed.data.lines.map((line) => ({ item_id: line.itemId, qty: line.qty })),
  });
  if (error) return { error: cleanError(error.message) };
  const result = data as { id: string; reference: string; already_exists: boolean };
  if (!result.already_exists) {
    await writeAudit({
      actorId: user.id,
      action: "stock.request.created",
      entityType: "stock_request",
      entityId: result.id,
      branchId: parsed.data.requestingBranchId,
      after: { reference: result.reference, lineCount: parsed.data.lines.length },
    });
  }
  await refreshNotificationsAfterStock();
  revalidateStock();
  return {
    info: result.already_exists
      ? `${result.reference} already exists.`
      : `Created ${result.reference}.`,
    entityId: result.id,
  };
}

export async function reviewStockRequestAction(
  requestId: string,
  _previous: StockActionState,
  formData: FormData,
): Promise<StockActionState> {
  const { user } = await requirePermission("stock.transfer.approve");
  const supabase = await createClient();
  const { data: lines, error: loadError } = await supabase
    .from("stock_request_lines")
    .select("id")
    .eq("request_id", requestId);
  if (loadError || !lines?.length) return { error: "Request lines could not be loaded." };

  const decision = formData.get("decision");
  const parsed = stockRequestReviewSchema.safeParse({
    requestId,
    decision,
    reviewNotes: formData.get("reviewNotes") || null,
    lines: lines.map((line) => ({
      lineId: line.id,
      approvedQty: decision === "approve" ? formData.get(`approved_${line.id}`) : 0,
    })),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid review" };

  const { error } = await supabase.rpc("review_stock_request", {
    p_request_id: requestId,
    p_decision: parsed.data.decision,
    p_review_notes: parsed.data.reviewNotes ?? null,
    p_lines: parsed.data.lines.map((line) => ({
      line_id: line.lineId,
      approved_qty: line.approvedQty,
    })),
  });
  if (error) return { error: cleanError(error.message) };
  await writeAudit({
    actorId: user.id,
    action: `stock.request.${parsed.data.decision === "approve" ? "approved" : "rejected"}`,
    entityType: "stock_request",
    entityId: requestId,
    after: { decision: parsed.data.decision },
  });
  await refreshNotificationsAfterStock();
  revalidateStock();
  return { info: `Request ${parsed.data.decision === "approve" ? "approved" : "rejected"}.` };
}

export async function prepareTransferAction(
  _previous: StockActionState,
  formData: FormData,
): Promise<StockActionState> {
  const { user } = await requirePermission("stock.transfer.prepare");
  const supabase = await createClient();
  const stockRequestId = (formData.get("stockRequestId") as string) || null;
  let lines: Array<{ itemId: string; qty: unknown }>;
  if (stockRequestId) {
    const { data, error } = await supabase
      .from("stock_request_lines")
      .select("item_id, approved_qty")
      .eq("request_id", stockRequestId)
      .gt("approved_qty", 0);
    if (error || !data?.length) return { error: "Approved request lines could not be loaded." };
    lines = data.map((line) => ({ itemId: line.item_id, qty: line.approved_qty }));
  } else {
    lines = [{ itemId: formData.get("itemId") as string, qty: formData.get("qty") }];
  }
  const parsed = transferPrepareSchema.safeParse({
    sourceBranchId: formData.get("sourceBranchId"),
    destBranchId: formData.get("destBranchId"),
    stockRequestId,
    notes: formData.get("notes") || null,
    idempotencyKey: formData.get("idempotencyKey"),
    lines,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid transfer" };

  const { data, error } = await supabase.rpc("prepare_transfer", {
    p_source_branch_id: parsed.data.sourceBranchId,
    p_dest_branch_id: parsed.data.destBranchId,
    p_stock_request_id: parsed.data.stockRequestId ?? null,
    p_notes: parsed.data.notes ?? null,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_lines: parsed.data.lines.map((line) => ({ item_id: line.itemId, qty: line.qty })),
  });
  if (error) return { error: cleanError(error.message) };
  const result = data as { id: string; reference: string; already_exists: boolean };
  if (!result.already_exists) {
    await writeAudit({
      actorId: user.id,
      action: "stock.transfer.prepared",
      entityType: "transfer",
      entityId: result.id,
      after: { reference: result.reference, lineCount: parsed.data.lines.length },
    });
  }
  revalidateStock(result.id);
  return {
    info: result.already_exists
      ? `${result.reference} already exists.`
      : `Prepared ${result.reference}.`,
    entityId: result.id,
  };
}

export async function approveTransferAction(transferId: string): Promise<StockActionState> {
  const parsedId = transferIdSchema.safeParse(transferId);
  if (!parsedId.success) return { error: parsedId.error.issues[0]?.message };
  const { user } = await requirePermission("stock.transfer.approve");
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_transfer", { p_transfer_id: transferId });
  if (error) return { error: cleanError(error.message) };
  await writeAudit({
    actorId: user.id,
    action: "stock.transfer.approved_dispatched",
    entityType: "transfer",
    entityId: transferId,
  });
  await refreshNotificationsAfterStock();
  revalidateStock(transferId);
  return { info: "Transfer approved and dispatched from source inventory." };
}

export async function receiveTransferAction(
  transferId: string,
  _previous: StockActionState,
  formData: FormData,
): Promise<StockActionState> {
  const { user } = await requirePermission("stock.transfer.receive");
  const supabase = await createClient();
  const { data: lines, error: loadError } = await supabase
    .from("transfer_lines")
    .select("id")
    .eq("transfer_id", transferId);
  if (loadError || !lines?.length) return { error: "Transfer lines could not be loaded." };
  const parsed = transferReceiveSchema.safeParse({
    transferId,
    idempotencyKey: formData.get("idempotencyKey"),
    discrepancyReason: formData.get("discrepancyReason") || null,
    lines: lines.map((line) => ({
      lineId: line.id,
      receivedQty: formData.get(`received_${line.id}`),
      rejectedQty: formData.get(`rejected_${line.id}`) || 0,
      damagedQty: formData.get(`damaged_${line.id}`) || 0,
      missingQty: formData.get(`missing_${line.id}`) || 0,
    })),
  });
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Invalid receiving counts" };

  const { error } = await supabase.rpc("receive_transfer", {
    p_transfer_id: transferId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_discrepancy_reason: parsed.data.discrepancyReason ?? null,
    p_lines: parsed.data.lines.map((line) => ({
      line_id: line.lineId,
      received_qty: line.receivedQty,
      rejected_qty: line.rejectedQty,
      damaged_qty: line.damagedQty,
      missing_qty: line.missingQty,
    })),
  });
  if (error) return { error: cleanError(error.message) };
  await writeAudit({
    actorId: user.id,
    action: "stock.transfer.received",
    entityType: "transfer",
    entityId: transferId,
    after: { discrepancyReason: parsed.data.discrepancyReason ?? null },
  });
  await refreshNotificationsAfterStock();
  revalidateStock(transferId);
  return { info: "Transfer received. Destination stock was posted exactly once." };
}

export async function resolveTransferDiscrepancyAction(
  discrepancyId: string,
  _previous: StockActionState,
  formData: FormData,
): Promise<StockActionState> {
  const { user } = await requirePermission("stock.transfer.approve");
  const parsed = discrepancyResolutionSchema.safeParse({
    discrepancyId,
    resolution: formData.get("resolution"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid resolution" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_transfer_discrepancy", {
    p_discrepancy_id: parsed.data.discrepancyId,
    p_resolution: parsed.data.resolution,
  });
  if (error) return { error: cleanError(error.message) };
  await writeAudit({
    actorId: user.id,
    action: "stock.transfer.discrepancy_resolved",
    entityType: "transfer_discrepancy",
    entityId: parsed.data.discrepancyId,
  });
  revalidateStock();
  return { info: "Discrepancy resolution recorded." };
}
