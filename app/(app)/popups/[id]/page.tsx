import { notFound } from "next/navigation";
import {
  PopupDetailClient,
  type PopupCountRow,
  type PopupDetail,
  type PopupMovementRow,
} from "@/components/popups/popup-detail-client";
import { can, getAuthContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

export default async function PopupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext();
  const supabase = await createClient();
  const sessionResult = await supabase
    .from("popup_event_sessions")
    .select(
      "id, reference, status, notes, popup_branch_id, return_branch_id, started_at, counted_at, completed_at, calendar_events(title, description, location, starts_at, ends_at), popup_branch:branches!popup_event_sessions_popup_branch_id_fkey(name), return_branch:branches!popup_event_sessions_return_branch_id_fkey(name)",
    )
    .eq("id", id)
    .single();
  if (!sessionResult.data) notFound();
  const session = sessionResult.data;
  const [linesResult, movementsResult, transfersResult, stockResult, itemsResult] =
    await Promise.all([
      supabase
        .from("popup_event_count_lines")
        .select(
          "item_id, unit_id, transferred_in_qty, remaining_qty, returned_qty, consumed_qty, waste_qty, loss_qty, gain_qty, ending_qty, notes, inventory_items(name, sku), units(code)",
        )
        .eq("popup_event_id", id)
        .order("created_at"),
      supabase
        .from("popup_event_movements")
        .select(
          "id, movement_type, quantity, inventory_items(name, sku), transfers(reference, status), stock_transactions(reference, type)",
        )
        .eq("popup_event_id", id)
        .order("created_at"),
      supabase
        .from("transfers")
        .select(
          "id, reference, status, source_branch_id, dest_branch_id, popup_event_id, source:branches!transfers_source_branch_id_fkey(name), destination:branches!transfers_dest_branch_id_fkey(name)",
        )
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("stock_transactions")
        .select("id, reference, type, status, reason, source_branch_id, dest_branch_id, created_at")
        .eq("status", "posted")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("inventory_items")
        .select("id, name, sku, base_unit_id, units:base_unit_id(code)")
        .eq("active", true)
        .eq("trackable", true)
        .is("deleted_at", null)
        .order("name"),
    ]);
  const calendar = session.calendar_events as unknown as {
    title: string;
    description: string | null;
    location: string | null;
    starts_at: string;
    ends_at: string;
  } | null;
  const detail: PopupDetail = {
    id: session.id,
    reference: session.reference,
    status: session.status as PopupDetail["status"],
    title: calendar?.title ?? "Popup engagement",
    description: calendar?.description ?? null,
    location: calendar?.location ?? null,
    startsAt: calendar?.starts_at ?? "",
    endsAt: calendar?.ends_at ?? "",
    popupBranchId: session.popup_branch_id,
    popupBranchName:
      (session.popup_branch as unknown as { name: string } | null)?.name ?? "Zombeans Popup",
    returnBranchId: session.return_branch_id,
    returnBranchName: (session.return_branch as unknown as { name: string } | null)?.name ?? "Main",
    notes: session.notes,
    startedAt: session.started_at,
    countedAt: session.counted_at,
    completedAt: session.completed_at,
  };
  const countRows: PopupCountRow[] = (linesResult.data ?? []).map((line) => ({
    itemId: line.item_id,
    unitId: line.unit_id,
    itemName:
      (line.inventory_items as unknown as { name: string; sku: string } | null)?.name ?? "Item",
    itemSku: (line.inventory_items as unknown as { name: string; sku: string } | null)?.sku ?? "—",
    unitCode: (line.units as unknown as { code: string } | null)?.code ?? "unit",
    transferredInQty: Number(line.transferred_in_qty),
    remainingQty: Number(line.remaining_qty),
    returnedQty: Number(line.returned_qty),
    consumedQty: Number(line.consumed_qty),
    wasteQty: Number(line.waste_qty),
    lossQty: Number(line.loss_qty),
    gainQty: Number(line.gain_qty),
    endingQty: Number(line.ending_qty),
    notes: line.notes,
  }));
  const movements: PopupMovementRow[] = (movementsResult.data ?? []).map((movement) => ({
    id: movement.id,
    movementType: movement.movement_type,
    quantity: Number(movement.quantity),
    itemName:
      (movement.inventory_items as unknown as { name: string; sku: string } | null)?.name ?? "Item",
    itemSku:
      (movement.inventory_items as unknown as { name: string; sku: string } | null)?.sku ?? "—",
    sourceReference:
      (movement.transfers as unknown as { reference: string } | null)?.reference ??
      (movement.stock_transactions as unknown as { reference: string } | null)?.reference ??
      "Posted movement",
  }));
  const transfers = (transfersResult.data ?? [])
    .filter(
      (transfer) =>
        (transfer.popup_event_id === null || transfer.popup_event_id === id) &&
        ((transfer.source_branch_id === detail.returnBranchId &&
          transfer.dest_branch_id === detail.popupBranchId) ||
          (transfer.source_branch_id === detail.popupBranchId &&
            transfer.dest_branch_id === detail.returnBranchId)),
    )
    .map((transfer) => ({
      id: transfer.id,
      reference: transfer.reference,
      status: transfer.status,
      sourceName: (transfer.source as unknown as { name: string } | null)?.name ?? "Source",
      destinationName:
        (transfer.destination as unknown as { name: string } | null)?.name ?? "Destination",
    }));
  const stockMovements = (stockResult.data ?? [])
    .filter(
      (transaction) =>
        transaction.source_branch_id === detail.popupBranchId ||
        transaction.dest_branch_id === detail.popupBranchId,
    )
    .map((transaction) => ({
      id: transaction.id,
      reference: transaction.reference,
      type: transaction.type,
      reason: transaction.reason,
    }));
  const items = (itemsResult.data ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    sku: item.sku,
    unitId: item.base_unit_id,
    unitCode: (item.units as unknown as { code: string } | null)?.code ?? "unit",
  }));
  return (
    <PopupDetailClient
      detail={detail}
      countRows={countRows}
      movements={movements}
      transfers={transfers}
      stockMovements={stockMovements}
      items={items}
      canManage={can("calendar.manage", auth.permissions)}
      loadError={Boolean(
        sessionResult.error ||
        linesResult.error ||
        movementsResult.error ||
        transfersResult.error ||
        stockResult.error ||
        itemsResult.error,
      )}
    />
  );
}
