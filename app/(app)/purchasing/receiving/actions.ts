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

  const parsed = lines.map((l) => ({
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

  const hasDamage = parsed.some((p) => p.damaged > 0);
  const hasShortage = parsed.some((p) => p.missing > 0 || p.accepted < p.outstanding);

  const { data: ref } = await supabase.rpc("next_receipt_reference");
  const idempotencyKey = (fd.get("idempotencyKey") as string) || crypto.randomUUID();
  const { data: receipt, error: rErr } = await supabase
    .from("purchase_receipts")
    .insert({
      reference: ref as string,
      po_id: poId,
      received_by: user.id,
      idempotency_key: idempotencyKey,
      has_damage: hasDamage,
      has_shortage: hasShortage,
      needs_review: hasDamage || hasShortage,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();
  if (rErr) {
    if (/duplicate key|already exists|unique/i.test(rErr.message) || rErr.code === "23505") {
      // Replay of a resubmitted form (e.g. dropped response after the first insert succeeded).
      // The parent row already exists for this idempotency key — do not insert new lines,
      // just ensure it's posted (the RPC is idempotent) and report success.
      const { data: existing, error: existingErr } = await supabase
        .from("purchase_receipts")
        .select("id, reference")
        .eq("idempotency_key", idempotencyKey)
        .single();
      if (existingErr || !existing) return { error: rErr.message.replace(/^.*?:\s*/, "") };

      const { error: replayPostErr } = await supabase.rpc("post_purchase_receipt", {
        p_receipt_id: existing.id,
      });
      if (replayPostErr) return { error: replayPostErr.message.replace(/^.*?:\s*/, "") };

      return { info: "This delivery was already recorded." };
    }
    return { error: rErr.message.replace(/^.*?:\s*/, "") };
  }

  const { error: rlErr } = await supabase.from("purchase_receipt_lines").insert(
    parsed
      .filter((p) => p.delivered > 0 || p.missing > 0)
      .map((p) => ({
        receipt_id: receipt.id,
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
    p_receipt_id: receipt.id,
  });
  if (postErr) return { error: postErr.message.replace(/^.*?:\s*/, "") };

  await writeAudit({
    actorId: user.id,
    action: "receipt.posted",
    entityType: "purchase_receipt",
    entityId: receipt.id,
    after: { reference: ref },
  });
  revalidatePath("/purchasing/receiving");
  revalidatePath(`/purchasing/orders/${poId}`);
  return { info: `Received ${ref}.` };
}
