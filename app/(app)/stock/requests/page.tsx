import { redirect } from "next/navigation";
import { StockRequestsClient } from "@/components/stock/stock-requests-client";
import { can, getAuthContext } from "@/lib/auth/context";
import { formatHumanDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function StockRequestsPage() {
  const auth = await getAuthContext();
  const canPrepare = can("stock.transfer.prepare", auth.permissions);
  const canApprove = can("stock.transfer.approve", auth.permissions);
  if (!canPrepare && !canApprove) redirect("/dashboard");
  const supabase = await createClient();
  const [requestsResult, branchesResult, itemsResult] = await Promise.all([
    supabase
      .from("stock_requests")
      .select(
        "id, reference, status, notes, created_at, branches:requesting_branch_id(name), stock_request_lines(id, requested_qty, approved_qty, inventory_items(name, sku), units(code))",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("branches")
      .select("id, name, is_main")
      .eq("active", true)
      .is("deleted_at", null)
      .order("is_main", { ascending: false })
      .order("name"),
    supabase
      .from("inventory_items")
      .select("id, name, sku, batch_tracked, expiry_tracked, units:base_unit_id(code)")
      .eq("active", true)
      .eq("trackable", true)
      .is("deleted_at", null)
      .order("name"),
  ]);
  const loadError = Boolean(requestsResult.error || branchesResult.error || itemsResult.error);
  return (
    <StockRequestsClient
      requests={(requestsResult.data ?? []).map((request) => ({
        id: request.id,
        reference: request.reference,
        branchName: (request.branches as unknown as { name: string }).name,
        status: request.status,
        notes: request.notes,
        createdAt: formatHumanDateTime(request.created_at),
        lines: (
          (request.stock_request_lines ?? []) as unknown as Array<{
            id: string;
            requested_qty: string;
            approved_qty: string;
            inventory_items: { name: string; sku: string };
            units: { code: string };
          }>
        ).map((line) => ({
          id: line.id,
          itemName: line.inventory_items.name,
          itemSku: line.inventory_items.sku,
          unitCode: line.units.code,
          requestedQty: Number(line.requested_qty),
          approvedQty: Number(line.approved_qty),
        })),
      }))}
      branches={(branchesResult.data ?? []).map((branch) => ({
        id: branch.id,
        name: branch.name,
        isMain: branch.is_main,
      }))}
      items={(itemsResult.data ?? []).map((item) => ({
        id: item.id,
        name: item.name,
        sku: item.sku,
        unitCode: (item.units as unknown as { code: string }).code,
        batchTracked: item.batch_tracked,
        expiryTracked: item.expiry_tracked,
      }))}
      canPrepare={canPrepare}
      canApprove={canApprove}
      loadError={loadError}
    />
  );
}
