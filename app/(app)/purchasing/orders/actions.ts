"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { poSchema, poLineSchema } from "@/lib/validation/purchasing";

export type PoActionState = { error?: string; info?: string };
const PAYMENT = ["unpaid", "partially_paid", "paid", "overdue", "cancelled", "refunded"] as const;

export async function createPoAction(_p: PoActionState, fd: FormData): Promise<PoActionState> {
  const { user } = await requirePermission("purchase.create");
  const parsed = poSchema.safeParse({
    supplierId: fd.get("supplierId"),
    expectedDate: fd.get("expectedDate") || undefined,
    notes: fd.get("notes") || null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const supabase = await createClient();
  const { data: ref } = await supabase.rpc("next_po_reference");
  const row: Record<string, unknown> = {
    reference: ref as string,
    supplier_id: parsed.data.supplierId,
    status: "draft",
    notes: parsed.data.notes ?? null,
    created_by: user.id,
    updated_by: user.id,
  };
  if (parsed.data.expectedDate) row.expected_date = parsed.data.expectedDate;
  const { data, error } = await supabase.from("purchase_orders").insert(row).select("id").single();
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  await writeAudit({
    actorId: user.id,
    action: "po.created",
    entityType: "purchase_order",
    entityId: data.id,
    after: { reference: ref },
  });
  revalidatePath("/purchasing/orders");
  return { info: `Created ${ref}.` };
}

export async function addPoLineAction(
  poId: string,
  _p: PoActionState,
  fd: FormData,
): Promise<PoActionState> {
  const { user } = await requirePermission("purchase.create");
  const parsed = poLineSchema.safeParse({
    poId,
    itemId: fd.get("itemId"),
    unitId: fd.get("unitId"),
    orderedQty: fd.get("orderedQty"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  // Cost lookup + write uses the service role (unit_cost/subtotal/total are server-only columns).
  const admin = createAdminClient();
  const { data: po } = await admin
    .from("purchase_orders")
    .select("supplier_id")
    .eq("id", poId)
    .single();
  if (!po) return { error: "PO not found." };
  const { data: si } = await admin
    .from("supplier_items")
    .select("id")
    .eq("supplier_id", po.supplier_id)
    .eq("item_id", parsed.data.itemId)
    .maybeSingle();
  let unitCost = 0;
  if (si) {
    const { data: price } = await admin
      .from("supplier_prices")
      .select("price")
      .eq("supplier_item_id", si.id)
      .order("effective_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    unitCost = price ? Number(price.price) : 0;
  }
  const { error } = await admin.from("purchase_order_lines").insert({
    po_id: poId,
    item_id: parsed.data.itemId,
    unit_id: parsed.data.unitId,
    ordered_qty: parsed.data.orderedQty,
    unit_cost: unitCost,
    created_by: user.id,
    updated_by: user.id,
  });
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  // Recompute totals.
  const { data: lines } = await admin
    .from("purchase_order_lines")
    .select("ordered_qty, unit_cost")
    .eq("po_id", poId);
  const subtotal = (lines ?? []).reduce(
    (s, l) => s + Number(l.ordered_qty) * Number(l.unit_cost),
    0,
  );
  await admin
    .from("purchase_orders")
    .update({ subtotal, total: subtotal, updated_by: user.id })
    .eq("id", poId);
  await writeAudit({
    actorId: user.id,
    action: "po.line.added",
    entityType: "purchase_order",
    entityId: poId,
    after: { itemId: parsed.data.itemId, orderedQty: parsed.data.orderedQty },
  });
  revalidatePath(`/purchasing/orders/${poId}`);
  return { info: "Line added." };
}

export async function submitPoAction(poId: string): Promise<PoActionState> {
  const { user } = await requirePermission("purchase.create");
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update({ status: "submitted", updated_by: user.id })
    .eq("id", poId)
    .eq("status", "draft");
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  await writeAudit({
    actorId: user.id,
    action: "po.submitted",
    entityType: "purchase_order",
    entityId: poId,
  });
  revalidatePath(`/purchasing/orders/${poId}`);
  return { info: "Submitted for approval." };
}

export async function approvePoAction(poId: string): Promise<PoActionState> {
  const { user } = await requirePermission("purchase.approve");
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update({
      status: "approved",
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", poId)
    .eq("status", "submitted");
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  await writeAudit({
    actorId: user.id,
    action: "po.approved",
    entityType: "purchase_order",
    entityId: poId,
  });
  revalidatePath(`/purchasing/orders/${poId}`);
  return { info: "Approved." };
}

export async function setPaymentStatusAction(poId: string, status: string): Promise<PoActionState> {
  const { user } = await requirePermission("purchase.approve");
  if (!(PAYMENT as readonly string[]).includes(status)) return { error: "Invalid status." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update({ payment_status: status, updated_by: user.id })
    .eq("id", poId);
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  await writeAudit({
    actorId: user.id,
    action: "po.payment.updated",
    entityType: "purchase_order",
    entityId: poId,
    after: { status },
  });
  revalidatePath(`/purchasing/orders/${poId}`);
  return { info: "Payment status updated." };
}
