import { notFound, redirect } from "next/navigation";
import { getAuthContext, can } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  OrderDetailClient,
  type PoDetail,
  type PoLineRow,
  type InventoryItemOption,
  type UnitOption,
} from "@/components/purchasing/order-detail-client";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ctx = await getAuthContext();
  const canView =
    can("purchase.create", ctx.permissions) ||
    can("purchase.approve", ctx.permissions) ||
    can("purchase.receive", ctx.permissions);
  if (!canView) redirect("/dashboard");
  const canCreate = can("purchase.create", ctx.permissions);
  const canApprove = can("purchase.approve", ctx.permissions);
  const canReadCost = can("cost.read", ctx.permissions);

  const supabase = await createClient();

  const { data: poData } = await supabase
    .from("purchase_orders")
    .select("id, reference, status, payment_status, expected_date, notes, supplier:suppliers(name)")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!poData) notFound();

  type RawPo = {
    id: string;
    reference: string;
    status: string;
    payment_status: string;
    expected_date: string | null;
    notes: string | null;
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

  const [{ data: linesData }, { data: inventoryItemsData }, { data: unitsData }] =
    await Promise.all([
      supabase
        .from("purchase_order_lines")
        .select(
          "id, item:inventory_items(name, sku), unit:units(code), ordered_qty, received_accepted_qty",
        )
        .eq("po_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("inventory_items")
        .select("id, name, sku")
        .eq("active", true)
        .is("deleted_at", null)
        .order("name", { ascending: true }),
      supabase
        .from("units")
        .select("id, code")
        .eq("active", true)
        .order("code", { ascending: true }),
    ]);

  const rawLines = (linesData as RawLine[] | null) ?? [];

  // Sensitive: unit_cost / subtotal / total are omitted from the `authenticated` grant, so this
  // read must go through the service-role admin client. The `canReadCost` guard is the gate.
  let subtotal: number | undefined;
  let total: number | undefined;
  const unitCostByLine = new Map<string, number>();
  if (canReadCost) {
    const admin = createAdminClient();
    const [{ data: costData }, { data: lineCosts }] = await Promise.all([
      admin.from("purchase_orders").select("subtotal, total").eq("id", id).single(),
      admin.from("purchase_order_lines").select("id, unit_cost").eq("po_id", id),
    ]);
    if (costData) {
      subtotal = Number(costData.subtotal);
      total = Number(costData.total);
    }
    for (const l of (lineCosts as { id: string; unit_cost: string | number }[] | null) ?? []) {
      unitCostByLine.set(l.id, Number(l.unit_cost));
    }
  }

  const lines: PoLineRow[] = rawLines.map((l) => ({
    id: l.id,
    itemName: l.item?.name ?? "—",
    itemSku: l.item?.sku ?? "—",
    unitCode: l.unit?.code ?? "—",
    orderedQty: Number(l.ordered_qty),
    receivedAcceptedQty: Number(l.received_accepted_qty),
    unitCost: canReadCost ? (unitCostByLine.get(l.id) ?? 0) : undefined,
  }));

  const poDetail: PoDetail = {
    id: po.id,
    reference: po.reference,
    supplierName: po.supplier?.name ?? "—",
    status: po.status as PoDetail["status"],
    paymentStatus: po.payment_status as PoDetail["paymentStatus"],
    expectedDate: po.expected_date,
    notes: po.notes,
    subtotal,
    total,
  };

  const inventoryItems: InventoryItemOption[] = (
    (inventoryItemsData as { id: string; name: string; sku: string }[] | null) ?? []
  ).map((it) => ({ id: it.id, label: `${it.name} (${it.sku})` }));

  const units: UnitOption[] = ((unitsData as { id: string; code: string }[] | null) ?? []).map(
    (u) => ({ id: u.id, label: u.code }),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Purchasing · Purchase orders</p>
        <h1 className="font-display mt-1 text-3xl">{po.reference}</h1>
        <p className="text-muted-foreground mt-1">
          {po.supplier?.name ?? "Unknown supplier"}
          {canReadCost && " · Costs are visible to you because you hold cost.read."}
        </p>
      </div>
      <OrderDetailClient
        po={poDetail}
        lines={lines}
        inventoryItems={inventoryItems}
        units={units}
        canCreate={canCreate}
        canApprove={canApprove}
        canReadCost={canReadCost}
      />
    </div>
  );
}
