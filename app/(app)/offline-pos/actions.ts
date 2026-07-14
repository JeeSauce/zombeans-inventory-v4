"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/permissions";
import { parseLoyverseCsv, PosCsvError } from "@/lib/pos/csv";
import { createClient } from "@/lib/supabase/server";
import {
  barcodeLookupResultSchema,
  barcodeLookupSchema,
  loyverseMappingDeactivateSchema,
  loyverseMappingSchema,
  offlineConflictResolutionSchema,
  offlineDraftSyncSchema,
  offlineSnapshotRequestSchema,
  posConfirmSchema,
  posPreviewSchema,
  type BarcodeLookupResult,
} from "@/lib/validation/phase10";

export type Phase10ActionState = {
  error?: string;
  info?: string;
  status?: "synced" | "posted" | "review_required" | "rejected" | "confirmed" | "preview";
  reference?: string;
  importId?: string;
};

function cleanError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : "";
  if (/permission denied/i.test(message)) return "You do not have permission for this operation.";
  if (/authentication required|session expired/i.test(message))
    return "Your session expired. Sign in again.";
  if (/snapshot is invalid or expired/i.test(message))
    return "This offline draft is too old to auto-sync. Recreate it from current data.";
  if (/inventory moved|already open|review is required|changed after/i.test(message))
    return "The server detected newer work. This draft requires explicit review.";
  if (/unusual recount variance/i.test(message))
    return "The variance is unusual and requires an authorized review.";
  if (/mapping changed/i.test(message))
    return "A mapping changed after preview. Generate a fresh preview before confirming.";
  if (/every pos preview row must be valid/i.test(message))
    return "Resolve every preview warning before confirming the import.";
  if (/external pos line was already confirmed/i.test(message))
    return "An external POS line was already confirmed and cannot be posted twice.";
  if (/closed business day/i.test(message))
    return "Inventory is closed for that business date. A Super Admin must reopen it first.";
  if (/production order/i.test(message)) return message.replace(/^.*?:\s*/, "");
  if (error instanceof PosCsvError) return error.message;
  return "The operation could not be completed safely. Refresh current data and try again.";
}

function revalidateOfflinePos() {
  revalidatePath("/offline-pos");
  revalidatePath("/daily-ops");
  revalidatePath("/production");
  revalidatePath("/stock");
  revalidatePath("/dashboard");
}

export async function issueOfflineSnapshotAction(input: unknown): Promise<{
  error?: string;
  snapshot?: { id: string; capturedAt: string; expiresAt: string };
}> {
  try {
    const parsed = offlineSnapshotRequestSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Offline snapshot request is invalid." };
    }
    await requirePermission("offline.sync");
    if (parsed.data.type === "recount") await requirePermission("recount.perform");
    else await requirePermission("production.record");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("issue_offline_snapshot", {
      p_snapshot_type: parsed.data.type,
      p_branch_id: parsed.data.branchId,
      p_client_draft_id: parsed.data.clientDraftId,
      p_item_ids: parsed.data.type === "recount" ? parsed.data.itemIds : [],
      p_production_order_id:
        parsed.data.type === "production" ? parsed.data.productionOrderId : null,
    });
    if (error) return { error: cleanError(error) };
    const result = data as { id: string; capturedAt: string; expiresAt: string };
    return { snapshot: result };
  } catch (error) {
    return { error: cleanError(error) };
  }
}

export async function syncOfflineDraftAction(input: unknown): Promise<Phase10ActionState> {
  try {
    const parsed = offlineDraftSyncSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Offline draft is invalid." };
    }
    await requirePermission("offline.sync");
    const supabase = await createClient();

    if (parsed.data.type === "recount") {
      await requirePermission("recount.perform");
      const { data, error } = await supabase.rpc("submit_offline_recount", {
        p_branch_id: parsed.data.payload.branchId,
        p_business_date: parsed.data.payload.businessDate,
        p_client_draft_id: parsed.data.id,
        p_snapshot_id: parsed.data.snapshotId,
        p_client_created_at: parsed.data.clientCreatedAt,
        p_idempotency_key: parsed.data.idempotencyKey,
        p_reason: parsed.data.payload.reason,
        p_lines: parsed.data.payload.lines.map((line) => ({
          itemId: line.itemId,
          physicalQty: line.physicalQty,
        })),
      });
      if (error) return { error: cleanError(error) };
      const result = data as {
        reference: string;
        status: "synced" | "posted" | "review_required";
        conflictReason?: string | null;
        replayed: boolean;
      };
      revalidateOfflinePos();
      return {
        info:
          result.status === "review_required"
            ? `${result.reference} is waiting for review; no silent overwrite occurred.`
            : `${result.reference} ${result.replayed ? "was already synchronized" : "synchronized"}.`,
        status: result.status,
        reference: result.reference,
      };
    }

    await requirePermission("production.record");
    const { data, error } = await supabase.rpc("submit_offline_production", {
      p_production_order_id: parsed.data.payload.productionOrderId,
      p_client_draft_id: parsed.data.id,
      p_snapshot_id: parsed.data.snapshotId,
      p_client_created_at: parsed.data.clientCreatedAt,
      p_idempotency_key: parsed.data.idempotencyKey,
      p_actual_output_qty: parsed.data.payload.actualOutputQty,
      p_output_lot_number: parsed.data.payload.outputLotNumber,
      p_production_date: parsed.data.payload.productionDate,
      p_expiration_date: parsed.data.payload.expirationDate,
      p_notes: parsed.data.payload.notes ?? null,
      p_inputs: parsed.data.payload.inputs.map((line) => ({
        id: line.id,
        actual_consumed_qty: line.actualConsumedQty,
        waste_qty: line.wasteQty,
        notes: line.notes ?? null,
      })),
    });
    if (error) return { error: cleanError(error) };
    const result = data as {
      reference: string;
      status: "synced" | "review_required";
      productionOrderReference: string;
      replayed: boolean;
    };
    revalidateOfflinePos();
    return {
      info:
        result.status === "review_required"
          ? `${result.reference} is waiting for review; production was not overwritten.`
          : `${result.productionOrderReference} is ready for its existing confirmation step.`,
      status: result.status,
      reference: result.reference,
    };
  } catch (error) {
    return { error: cleanError(error) };
  }
}

export async function resolveOfflineConflictAction(
  _previous: Phase10ActionState,
  formData: FormData,
): Promise<Phase10ActionState> {
  try {
    const parsed = offlineConflictResolutionSchema.safeParse({
      submissionId: formData.get("submissionId"),
      decision: formData.get("decision"),
      reason: formData.get("reason"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Conflict decision is invalid." };
    }
    await requirePermission("offline.review");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("resolve_offline_conflict", {
      p_submission_id: parsed.data.submissionId,
      p_decision: parsed.data.decision,
      p_reason: parsed.data.reason,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (error) return { error: cleanError(error) };
    const result = data as {
      reference: string;
      status: "synced" | "posted" | "rejected";
      decision: "accept" | "reject";
      replayed: boolean;
    };
    revalidateOfflinePos();
    return {
      info: `${result.reference} was ${result.decision === "accept" ? "accepted" : "rejected"}${result.replayed ? " previously" : ""}.`,
      status: result.status,
      reference: result.reference,
    };
  } catch (error) {
    return { error: cleanError(error) };
  }
}

export async function lookupBarcodeAction(input: unknown): Promise<{
  error?: string;
  result?: BarcodeLookupResult;
}> {
  try {
    const parsed = barcodeLookupSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid barcode." };
    await requirePermission("catalog.item.read");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("lookup_inventory_item_by_barcode", {
      p_barcode: parsed.data.barcode,
    });
    if (error) return { error: cleanError(error) };
    const result = barcodeLookupResultSchema.safeParse(data);
    if (!result.success) return { error: "Barcode result did not match its safe contract." };
    return { result: result.data };
  } catch (error) {
    return { error: cleanError(error) };
  }
}

export async function upsertLoyverseMappingAction(
  _previous: Phase10ActionState,
  formData: FormData,
): Promise<Phase10ActionState> {
  try {
    const parsed = loyverseMappingSchema.safeParse({
      entityType: formData.get("entityType"),
      externalId: formData.get("externalId"),
      externalName: formData.get("externalName"),
      externalSku: formData.get("externalSku"),
      inventoryItemId: formData.get("inventoryItemId"),
      inventoryQty: formData.get("inventoryQty"),
      reason: formData.get("reason"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Loyverse mapping is invalid." };
    }
    await requirePermission("pos.import");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("upsert_loyverse_mapping", {
      p_entity_type: parsed.data.entityType,
      p_external_id: parsed.data.externalId,
      p_external_name: parsed.data.externalName,
      p_external_sku: parsed.data.externalSku,
      p_inventory_item_id: parsed.data.inventoryItemId,
      p_inventory_qty: parsed.data.inventoryQty,
      p_reason: parsed.data.reason,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (error) return { error: cleanError(error) };
    const result = data as { externalId: string; replayed: boolean };
    revalidatePath("/offline-pos");
    return {
      info: `Loyverse ${result.externalId} ${result.replayed ? "was already mapped" : "was mapped"}.`,
    };
  } catch (error) {
    return { error: cleanError(error) };
  }
}

export async function deactivateLoyverseMappingAction(
  _previous: Phase10ActionState,
  formData: FormData,
): Promise<Phase10ActionState> {
  try {
    const parsed = loyverseMappingDeactivateSchema.safeParse({
      mappingId: formData.get("mappingId"),
      reason: formData.get("reason"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Mapping command is invalid." };
    }
    await requirePermission("pos.import");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("deactivate_loyverse_mapping", {
      p_mapping_id: parsed.data.mappingId,
      p_reason: parsed.data.reason,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (error) return { error: cleanError(error) };
    const result = data as { externalId: string; replayed: boolean };
    revalidatePath("/offline-pos");
    return {
      info: `Loyverse ${result.externalId} ${result.replayed ? "was already inactive" : "was deactivated"}.`,
    };
  } catch (error) {
    return { error: cleanError(error) };
  }
}

export async function previewPosImportAction(input: unknown): Promise<Phase10ActionState> {
  try {
    const envelope = input as Record<string, unknown> | null;
    if (!envelope || typeof envelope.csvText !== "string") {
      return { error: "Choose a valid UTF-8 CSV file." };
    }
    const rows = parseLoyverseCsv(envelope.csvText);
    const request = {
      branchId: envelope.branchId,
      filename: envelope.filename,
      idempotencyKey: envelope.idempotencyKey,
      rows,
    };
    const parsed = posPreviewSchema.safeParse(request);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "POS preview request is invalid." };
    }
    await requirePermission("pos.import");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("preview_pos_import", {
      p_branch_id: parsed.data.branchId,
      p_filename: parsed.data.filename,
      p_idempotency_key: parsed.data.idempotencyKey,
      p_rows: parsed.data.rows,
    });
    if (error) return { error: cleanError(error) };
    const result = data as {
      id: string;
      reference: string;
      rowCount: number;
      validCount: number;
      errorCount: number;
      replayed: boolean;
    };
    revalidatePath("/offline-pos");
    return {
      info: `${result.reference} previewed ${result.rowCount} rows: ${result.validCount} valid, ${result.errorCount} requiring attention. No inventory was posted.`,
      status: "preview",
      reference: result.reference,
      importId: result.id,
    };
  } catch (error) {
    return { error: cleanError(error) };
  }
}

export async function confirmPosImportAction(
  _previous: Phase10ActionState,
  formData: FormData,
): Promise<Phase10ActionState> {
  try {
    const parsed = posConfirmSchema.safeParse({
      importId: formData.get("importId"),
      reason: formData.get("reason"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "POS confirmation is invalid." };
    }
    await requirePermission("pos.import");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("confirm_pos_import", {
      p_import_id: parsed.data.importId,
      p_reason: parsed.data.reason,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (error) return { error: cleanError(error) };
    const result = data as {
      reference: string;
      status: "confirmed";
      transactionReferences: string[];
      replayed: boolean;
    };
    revalidateOfflinePos();
    return {
      info: `${result.reference} ${result.replayed ? "was already confirmed" : `confirmed ${result.transactionReferences.length} ledger transactions`}.`,
      status: "confirmed",
      reference: result.reference,
    };
  } catch (error) {
    return { error: cleanError(error) };
  }
}
