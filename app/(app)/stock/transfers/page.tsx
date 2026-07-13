import { redirect } from "next/navigation";
import { TransfersClient } from "@/components/stock/transfers-client";
import { can, getAuthContext } from "@/lib/auth/context";
import { formatHumanDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const auth = await getAuthContext();
  const canPrepare = can("stock.transfer.prepare", auth.permissions);
  const participating =
    canPrepare ||
    can("stock.transfer.approve", auth.permissions) ||
    can("stock.transfer.receive", auth.permissions);
  if (!participating) redirect("/dashboard");
  const { request: selectedRequestId } = await searchParams;
  const supabase = await createClient();
  const [transfersResult, branchesResult, itemsResult, requestsResult] = await Promise.all([
    supabase
      .from("transfers")
      .select(
        "id, reference, status, created_at, source:source_branch_id(name), destination:dest_branch_id(name), transfer_lines(prepared_qty, inventory_items(name), units(code))",
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
    supabase
      .from("stock_requests")
      .select("id, reference, branches:requesting_branch_id(name)")
      .eq("status", "approved")
      .order("created_at", { ascending: false }),
  ]);
  const loadError = Boolean(
    transfersResult.error || branchesResult.error || itemsResult.error || requestsResult.error,
  );
  return (
    <TransfersClient
      transfers={(transfersResult.data ?? []).map((transfer) => {
        const source = transfer.source as unknown as { name: string };
        const destination = transfer.destination as unknown as { name: string };
        const lines = (transfer.transfer_lines ?? []) as unknown as Array<{
          prepared_qty: string;
          inventory_items: { name: string };
          units: { code: string };
        }>;
        return {
          id: transfer.id,
          reference: transfer.reference,
          status: transfer.status,
          sourceBranchName: source.name,
          destBranchName: destination.name,
          createdAt: formatHumanDateTime(transfer.created_at),
          lineSummary: lines
            .map(
              (line) =>
                `${line.inventory_items.name}: ${Number(line.prepared_qty)} ${line.units.code}`,
            )
            .join(" · "),
        };
      })}
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
      requests={(requestsResult.data ?? []).map((request) => ({
        id: request.id,
        reference: request.reference,
        branchName: (request.branches as unknown as { name: string }).name,
      }))}
      canPrepare={canPrepare}
      selectedRequestId={selectedRequestId}
      loadError={loadError}
    />
  );
}
