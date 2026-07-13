import { redirect } from "next/navigation";
import { getAuthContext, can } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import {
  ReturnsClient,
  type SupplierOption,
  type LotOption,
  type ReturnRow,
} from "@/components/purchasing/returns-client";

export default async function ReturnsPage() {
  const ctx = await getAuthContext();
  if (!can("supplier.read", ctx.permissions)) redirect("/dashboard");
  const canCreate = can("supplier.write", ctx.permissions);

  const supabase = await createClient();

  type RawLot = {
    id: string;
    lot_number: string | null;
    qty_remaining: string | number;
    item_id: string;
    item: { name: string; sku: string } | null;
  };
  type RawReturn = {
    id: string;
    reference: string;
    status: string;
    created_at: string;
    supplier: { name: string } | null;
  };

  const [
    { data: suppliersData },
    { data: lotsData, error: lotsError },
    { data: returnsData, error: returnsError },
  ] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, name")
      .is("deleted_at", null)
      .order("name", { ascending: true }),
    // No unit_cost column is selected here — the returns UI never shows cost.
    supabase
      .from("inventory_lots")
      .select("id, lot_number, qty_remaining, item_id, item:inventory_items(name, sku)")
      .gt("qty_remaining", 0)
      .eq("status", "available")
      .order("received_date", { ascending: true }),
    supabase
      .from("supplier_returns")
      .select("id, reference, status, created_at, supplier:suppliers(name)")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const suppliers: SupplierOption[] = (
    (suppliersData as { id: string; name: string }[] | null) ?? []
  ).map((s) => ({ id: s.id, name: s.name }));

  const lots: LotOption[] = ((lotsData as RawLot[] | null) ?? []).map((l) => ({
    id: l.id,
    itemName: l.item?.name ?? "—",
    itemSku: l.item?.sku ?? "—",
    lotNumber: l.lot_number,
    qtyRemaining: Number(l.qty_remaining),
  }));

  const returns: ReturnRow[] = ((returnsData as RawReturn[] | null) ?? []).map((r) => ({
    id: r.id,
    reference: r.reference,
    status: r.status,
    createdAt: r.created_at,
    supplierName: r.supplier?.name ?? "—",
  }));

  const loadError = Boolean(lotsError || returnsError);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Purchasing</p>
        <h1 className="font-display mt-1 text-3xl">Returns</h1>
        <p className="text-muted-foreground mt-1">
          Send received stock back to a supplier. Choose the lot and quantity — cost and payable
          adjustments are never shown here.
        </p>
      </div>
      {loadError ? (
        <div className="text-destructive rounded-lg border border-dashed p-10 text-center">
          Could not load returns data. Try refreshing the page.
        </div>
      ) : (
        <ReturnsClient suppliers={suppliers} lots={lots} returns={returns} canCreate={canCreate} />
      )}
    </div>
  );
}
