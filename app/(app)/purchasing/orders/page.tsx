import { redirect } from "next/navigation";
import { getAuthContext, can } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import {
  OrdersClient,
  type OrderRow,
  type SupplierOption,
} from "@/components/purchasing/orders-client";

export default async function OrdersPage() {
  const ctx = await getAuthContext();
  const canView =
    can("purchase.create", ctx.permissions) ||
    can("purchase.approve", ctx.permissions) ||
    can("purchase.receive", ctx.permissions);
  if (!canView) redirect("/dashboard");
  const canCreate = can("purchase.create", ctx.permissions);

  const supabase = await createClient();

  type RawOrder = {
    id: string;
    reference: string;
    status: string;
    payment_status: string;
    expected_date: string | null;
    supplier: { name: string } | null;
  };

  const [{ data: ordersData }, { data: suppliersData }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, reference, status, payment_status, expected_date, supplier:suppliers(name)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("active", true)
      .is("deleted_at", null)
      .order("name", { ascending: true }),
  ]);

  const orders: OrderRow[] = ((ordersData as RawOrder[] | null) ?? []).map((o) => ({
    id: o.id,
    reference: o.reference,
    status: o.status as OrderRow["status"],
    paymentStatus: o.payment_status as OrderRow["paymentStatus"],
    expectedDate: o.expected_date,
    supplierName: o.supplier?.name ?? "—",
  }));

  const suppliers: SupplierOption[] = (
    (suppliersData as { id: string; name: string }[] | null) ?? []
  ).map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Purchasing</p>
        <h1 className="font-display mt-1 text-3xl">Purchase orders</h1>
        <p className="text-muted-foreground mt-1">
          Draft, submit, and approve purchase orders. Line costs are filled in automatically from
          the supplier&apos;s latest price.
        </p>
      </div>
      <OrdersClient orders={orders} suppliers={suppliers} canCreate={canCreate} />
    </div>
  );
}
