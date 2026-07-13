import { notFound, redirect } from "next/navigation";
import { TransferDetailClient } from "@/components/stock/transfer-detail-client";
import { can, getAuthContext } from "@/lib/auth/context";
import { formatHumanDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext();
  const participating = [
    "stock.transfer.prepare",
    "stock.transfer.approve",
    "stock.transfer.receive",
  ].some((permission) => can(permission, auth.permissions));
  if (!participating) redirect("/dashboard");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transfers")
    .select(
      "id, reference, status, notes, prepared_at, approved_at, received_at, source:source_branch_id(name), destination:dest_branch_id(name), transfer_lines(id, prepared_qty, shipped_qty, received_qty, rejected_qty, damaged_qty, missing_qty, inventory_items(name, sku), units(code)), transfer_discrepancies(id, type, qty, reason, status, resolution, transfer_lines(inventory_items(name)))",
    )
    .eq("id", id)
    .single();
  if (error || !data) notFound();
  const source = data.source as unknown as { name: string };
  const destination = data.destination as unknown as { name: string };
  const lines = (data.transfer_lines ?? []) as unknown as Array<{
    id: string;
    prepared_qty: string;
    shipped_qty: string;
    received_qty: string;
    rejected_qty: string;
    damaged_qty: string;
    missing_qty: string;
    inventory_items: { name: string; sku: string };
    units: { code: string };
  }>;
  const discrepancies = (data.transfer_discrepancies ?? []) as unknown as Array<{
    id: string;
    type: string;
    qty: string;
    reason: string;
    status: string;
    resolution: string | null;
    transfer_lines: { inventory_items: { name: string } };
  }>;
  return (
    <TransferDetailClient
      transfer={{
        id: data.id,
        reference: data.reference,
        status: data.status,
        sourceBranchName: source.name,
        destBranchName: destination.name,
        notes: data.notes,
        preparedAt: formatHumanDateTime(data.prepared_at),
        approvedAt: data.approved_at ? formatHumanDateTime(data.approved_at) : null,
        receivedAt: data.received_at ? formatHumanDateTime(data.received_at) : null,
        lines: lines.map((line) => ({
          id: line.id,
          itemName: line.inventory_items.name,
          itemSku: line.inventory_items.sku,
          unitCode: line.units.code,
          preparedQty: Number(line.prepared_qty),
          shippedQty: Number(line.shipped_qty),
          receivedQty: Number(line.received_qty),
          rejectedQty: Number(line.rejected_qty),
          damagedQty: Number(line.damaged_qty),
          missingQty: Number(line.missing_qty),
        })),
        discrepancies: discrepancies.map((item) => ({
          id: item.id,
          itemName: item.transfer_lines.inventory_items.name,
          type: item.type,
          qty: Number(item.qty),
          reason: item.reason,
          status: item.status,
          resolution: item.resolution,
        })),
      }}
      canApprove={can("stock.transfer.approve", auth.permissions)}
      canReceive={can("stock.transfer.receive", auth.permissions)}
    />
  );
}
