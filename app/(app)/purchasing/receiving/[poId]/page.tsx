import { notFound, redirect } from "next/navigation";
import { getAuthContext, can } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import {
  ReceivingClient,
  type ReceivingPoDetail,
  type ReceivingLineRow,
} from "@/components/purchasing/receiving-client";

export default async function ReceivePoPage({ params }: { params: Promise<{ poId: string }> }) {
  const { poId } = await params;

  const ctx = await getAuthContext();
  if (!can("purchase.receive", ctx.permissions)) redirect("/dashboard");

  const supabase = await createClient();

  const { data: poData } = await supabase
    .from("purchase_orders")
    .select("id, reference, status, supplier:suppliers(name)")
    .eq("id", poId)
    .is("deleted_at", null)
    .single();

  if (!poData) notFound();

  type RawPo = {
    id: string;
    reference: string;
    status: string;
    supplier: { name: string } | null;
  };
  const po = poData as unknown as RawPo;

  type RawLine = {
    id: string;
    item: { name: string; sku: string } | null;
    unit: { code: string } | null;
    ordered_qty: string | number;
    received_accepted_qty: string | number;
  };

  // Receiver never sees cost: only item identity + ordered/received quantities are selected.
  // No unit_cost / subtotal / total column appears in this query.
  const { data: linesData, error: linesErr } = await supabase
    .from("purchase_order_lines")
    .select(
      "id, item:inventory_items(name, sku), unit:units(code), ordered_qty, received_accepted_qty",
    )
    .eq("po_id", poId)
    .order("created_at", { ascending: true });

  const lines: ReceivingLineRow[] = ((linesData as RawLine[] | null) ?? []).map((l) => ({
    id: l.id,
    itemName: l.item?.name ?? "—",
    itemSku: l.item?.sku ?? "—",
    unitCode: l.unit?.code ?? "—",
    orderedQty: Number(l.ordered_qty),
    receivedAcceptedQty: Number(l.received_accepted_qty),
  }));

  const canReceiveNow = po.status === "approved" || po.status === "partially_received";

  const poDetail: ReceivingPoDetail = {
    id: po.id,
    reference: po.reference,
    supplierName: po.supplier?.name ?? "—",
    status: po.status,
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Purchasing · Receiving</p>
        <h1 className="font-display mt-1 text-3xl">{po.reference}</h1>
        <p className="text-muted-foreground mt-1">{po.supplier?.name ?? "Unknown supplier"}</p>
      </div>
      <ReceivingClient
        po={poDetail}
        lines={lines}
        canReceive={canReceiveNow}
        loadError={Boolean(linesErr)}
      />
    </div>
  );
}
