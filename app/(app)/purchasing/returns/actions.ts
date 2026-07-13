"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { returnLineSchema } from "@/lib/validation/purchasing";

export type ReturnActionState = { error?: string; info?: string };

const supplierIdSchema = z.string().uuid("Choose a supplier");

/**
 * Create + post a supplier return. Follows the Task 9 receiving action shape: create the parent
 * row, then the line rows, then call the SECURITY DEFINER posting RPC and surface its error.
 *
 * item_id for each line is resolved server-side from the chosen lot (never trusted from the
 * client) so a tampered form can't pair a qty against the wrong item.
 */
export async function createReturnAction(
  _p: ReturnActionState,
  fd: FormData,
): Promise<ReturnActionState> {
  const { user } = await requirePermission("supplier.write");

  const supplierParsed = supplierIdSchema.safeParse(fd.get("supplierId"));
  if (!supplierParsed.success) {
    return { error: supplierParsed.error.issues[0]?.message ?? "Choose a supplier" };
  }

  const lotIds = fd.getAll("lotId").map(String);
  const qtys = fd.getAll("qty").map(String);
  const reasons = fd.getAll("reason").map(String);

  const rows = lotIds
    .map((lotId, i) => ({ lotId, qty: qtys[i] ?? "", reason: reasons[i] ?? "" }))
    .filter((r) => r.lotId);
  if (rows.length === 0) return { error: "Add at least one line." };

  const supabase = await createClient();

  // Resolve item_id per lot via the session client (RLS-scoped, no cost columns).
  const uniqueLotIds = [...new Set(rows.map((r) => r.lotId))];
  const { data: lotRows, error: lotErr } = await supabase
    .from("inventory_lots")
    .select("id, item_id")
    .in("id", uniqueLotIds);
  if (lotErr || !lotRows) return { error: "Could not look up the selected lots." };
  const itemByLot = new Map(lotRows.map((l) => [l.id as string, l.item_id as string]));

  const parsedLines: {
    itemId: string;
    lotId: string;
    qty: number;
    reason?: string | null;
  }[] = [];
  for (const row of rows) {
    const itemId = itemByLot.get(row.lotId);
    if (!itemId) return { error: "One of the selected lots is no longer available." };
    const parsed = returnLineSchema.safeParse({
      itemId,
      lotId: row.lotId,
      qty: row.qty,
      reason: row.reason || null,
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid line" };
    parsedLines.push(parsed.data);
  }

  const { data: ref } = await supabase.rpc("next_return_reference");
  const idempotencyKey = crypto.randomUUID();

  const { data: ret, error: rErr } = await supabase
    .from("supplier_returns")
    .insert({
      reference: ref as string,
      supplier_id: supplierParsed.data,
      idempotency_key: idempotencyKey,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();
  if (rErr) return { error: rErr.message.replace(/^.*?:\s*/, "") };

  const { error: rlErr } = await supabase.from("supplier_return_lines").insert(
    parsedLines.map((l) => ({
      return_id: ret.id,
      item_id: l.itemId,
      lot_id: l.lotId,
      qty: l.qty,
      reason: l.reason ?? null,
    })),
  );
  if (rlErr) return { error: rlErr.message.replace(/^.*?:\s*/, "") };

  const { error: postErr } = await supabase.rpc("post_supplier_return", {
    p_return_id: ret.id,
  });
  if (postErr) return { error: postErr.message.replace(/^.*?:\s*/, "") };

  await writeAudit({
    actorId: user.id,
    action: "return.posted",
    entityType: "supplier_return",
    entityId: ret.id,
    after: { reference: ref },
  });
  revalidatePath("/purchasing/returns");
  return { info: `Posted ${ref}.` };
}
