"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";

export type ReceiveActionState = { error?: string; info?: string };
const num = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? Number(s) : 0;
};

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type ParsedLine = {
  poLineId: string;
  accepted: number;
  rejected: number;
  damaged: number;
  missing: number;
  delivered: number;
  lot: string | null;
  expiry: string | null;
  outstanding: number;
};

/**
 * Insert the receipt lines for `receiptId`, post the receipt, write the audit entry, and
 * revalidate. Shared by the happy path (fresh receipt) and the idempotency-replay path
 * (reconciling a stale draft parent from a failed first attempt) so both post identical line
 * shapes through identical logic.
 */
async function insertLinesAndPost(
  supabase: SupabaseClient,
  args: {
    receiptId: string;
    poId: string;
    ref: string;
    parsed: ParsedLine[];
    userId: string;
  },
): Promise<ReceiveActionState> {
  const { receiptId, poId, ref, parsed, userId } = args;

  const hasDamage = parsed.some((p) => p.damaged > 0);
  const hasShortage = parsed.some((p) => p.missing > 0 || p.accepted < p.outstanding);

  const { error: flagsErr } = await supabase
    .from("purchase_receipts")
    .update({
      has_damage: hasDamage,
      has_shortage: hasShortage,
      needs_review: hasDamage || hasShortage,
      updated_by: userId,
    })
    .eq("id", receiptId);
  if (flagsErr) return { error: flagsErr.message.replace(/^.*?:\s*/, "") };

  const { error: rlErr } = await supabase.from("purchase_receipt_lines").insert(
    parsed
      .filter((p) => p.delivered > 0 || p.missing > 0)
      .map((p) => ({
        receipt_id: receiptId,
        po_line_id: p.poLineId,
        delivered_qty: p.delivered,
        accepted_qty: p.accepted,
        rejected_qty: p.rejected,
        damaged_qty: p.damaged,
        missing_qty: p.missing,
        lot_number: p.lot,
        expiration_date: p.expiry,
      })),
  );
  if (rlErr) return { error: rlErr.message.replace(/^.*?:\s*/, "") };

  const { error: postErr } = await supabase.rpc("post_purchase_receipt", {
    p_receipt_id: receiptId,
  });
  if (postErr) return { error: postErr.message.replace(/^.*?:\s*/, "") };

  await writeAudit({
    actorId: userId,
    action: "receipt.posted",
    entityType: "purchase_receipt",
    entityId: receiptId,
    after: { reference: ref },
  });
  revalidatePath("/purchasing/receiving");
  revalidatePath(`/purchasing/orders/${poId}`);
  return { info: `Received ${ref}.` };
}

export async function submitReceiptAction(
  poId: string,
  _p: ReceiveActionState,
  fd: FormData,
): Promise<ReceiveActionState> {
  const { user } = await requirePermission("purchase.receive");
  const supabase = await createClient();

  const { data: lines, error: linesErr } = await supabase
    .from("purchase_order_lines")
    .select("id, ordered_qty, received_accepted_qty")
    .eq("po_id", poId);
  if (linesErr || !lines?.length) return { error: "Could not load the order lines." };

  const parsed: ParsedLine[] = lines.map((l) => ({
    poLineId: l.id as string,
    accepted: num(fd.get(`accepted_${l.id}`)),
    rejected: num(fd.get(`rejected_${l.id}`)),
    damaged: num(fd.get(`damaged_${l.id}`)),
    missing: num(fd.get(`missing_${l.id}`)),
    delivered:
      num(fd.get(`accepted_${l.id}`)) +
      num(fd.get(`rejected_${l.id}`)) +
      num(fd.get(`damaged_${l.id}`)),
    lot: (fd.get(`lot_${l.id}`) as string) || null,
    expiry: (fd.get(`expiry_${l.id}`) as string) || null,
    outstanding: Number(l.ordered_qty) - Number(l.received_accepted_qty),
  }));
  if (
    parsed.every((p) => p.accepted === 0 && p.rejected === 0 && p.damaged === 0 && p.missing === 0)
  )
    return { error: "Enter at least one received quantity." };

  const { data: ref } = await supabase.rpc("next_receipt_reference");
  const idempotencyKey = (fd.get("idempotencyKey") as string) || crypto.randomUUID();
  // has_damage / has_shortage / needs_review are set authoritatively by insertLinesAndPost
  // (from the current request's parsed lines) immediately after this insert, so the
  // fresh-insert defaults below are only a transient placeholder.
  const { data: receipt, error: rErr } = await supabase
    .from("purchase_receipts")
    .insert({
      reference: ref as string,
      po_id: poId,
      received_by: user.id,
      idempotency_key: idempotencyKey,
      has_damage: false,
      has_shortage: false,
      needs_review: false,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();
  if (rErr) {
    if (/duplicate key|already exists|unique/i.test(rErr.message) || rErr.code === "23505") {
      // Duplicate idempotency_key. Look up the existing parent row to decide what happened:
      const { data: existing, error: existingErr } = await supabase
        .from("purchase_receipts")
        .select("id, reference, status")
        .eq("idempotency_key", idempotencyKey)
        .single();
      // No row for THIS idempotency key — the 23505 came from some other unique constraint
      // (e.g. a `reference` race). Not a replay; surface the original insert error.
      if (existingErr || !existing) return { error: rErr.message.replace(/^.*?:\s*/, "") };

      if (existing.status === "posted") {
        // True replay of a completed submission (e.g. dropped response after success).
        // Nothing to do — do not insert lines, do not re-post.
        return { info: "This delivery was already recorded." };
      }

      // Draft parent left behind by a failed first attempt (the posting RPC raised, e.g.
      // over-receipt or lot-qty-exceeded). Nothing was ever posted for this key, so it's safe
      // to discard the stale lines and reconcile with the corrected quantities from this
      // request, then complete the post.
      const { error: delErr } = await supabase
        .from("purchase_receipt_lines")
        .delete()
        .eq("receipt_id", existing.id);
      if (delErr) return { error: delErr.message.replace(/^.*?:\s*/, "") };

      return insertLinesAndPost(supabase, {
        receiptId: existing.id,
        poId,
        ref: existing.reference as string,
        parsed,
        userId: user.id,
      });
    }
    return { error: rErr.message.replace(/^.*?:\s*/, "") };
  }

  return insertLinesAndPost(supabase, {
    receiptId: receipt.id,
    poId,
    ref: ref as string,
    parsed,
    userId: user.id,
  });
}
