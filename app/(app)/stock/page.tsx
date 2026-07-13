import { redirect } from "next/navigation";
import { StockOverviewClient } from "@/components/stock/stock-overview-client";
import { can, getAuthContext } from "@/lib/auth/context";
import { formatHumanDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function StockPage() {
  const auth = await getAuthContext();
  const participating = [
    "stock.in",
    "stock.out",
    "stock.transfer.prepare",
    "stock.transfer.approve",
    "stock.transfer.receive",
  ].some((permission) => can(permission, auth.permissions));
  if (!participating) redirect("/dashboard");

  const supabase = await createClient();
  const [branchesResult, itemsResult, balancesResult, alertsResult] = await Promise.all([
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
      .from("inventory_balances")
      .select("qty_on_hand, inventory_items(name, sku, units:base_unit_id(code)), branches(name)")
      .order("qty_on_hand"),
    supabase
      .from("inventory_alerts")
      .select("id, qty_on_hand, reason, created_at, inventory_items(name, sku), branches(name)")
      .eq("status", "active")
      .order("created_at", { ascending: false }),
  ]);
  const loadError = Boolean(
    branchesResult.error || itemsResult.error || balancesResult.error || alertsResult.error,
  );

  return (
    <StockOverviewClient
      branches={(branchesResult.data ?? []).map((branch) => ({
        id: branch.id,
        name: branch.name,
        isMain: branch.is_main,
      }))}
      items={(itemsResult.data ?? []).map((item) => ({
        id: item.id,
        name: item.name,
        sku: item.sku,
        unitCode: (item.units as unknown as { code: string } | null)?.code ?? "unit",
        batchTracked: item.batch_tracked,
        expiryTracked: item.expiry_tracked,
      }))}
      balances={(balancesResult.data ?? []).map((balance) => {
        const item = balance.inventory_items as unknown as {
          name: string;
          sku: string;
          units: { code: string } | null;
        };
        const branch = balance.branches as unknown as { name: string };
        return {
          itemName: item.name,
          itemSku: item.sku,
          branchName: branch.name,
          unitCode: item.units?.code ?? "unit",
          qtyOnHand: Number(balance.qty_on_hand),
        };
      })}
      alerts={(alertsResult.data ?? []).map((alert) => {
        const item = alert.inventory_items as unknown as { name: string; sku: string };
        const branch = alert.branches as unknown as { name: string };
        return {
          id: alert.id,
          itemName: item.name,
          itemSku: item.sku,
          branchName: branch.name,
          qtyOnHand: Number(alert.qty_on_hand),
          reason: alert.reason,
          createdAt: formatHumanDateTime(alert.created_at),
        };
      })}
      canStockIn={can("stock.in", auth.permissions)}
      canStockOut={can("stock.out", auth.permissions)}
      canPrepare={can("stock.transfer.prepare", auth.permissions)}
      canApprove={can("stock.transfer.approve", auth.permissions)}
      canReceive={can("stock.transfer.receive", auth.permissions)}
      loadError={loadError}
    />
  );
}
