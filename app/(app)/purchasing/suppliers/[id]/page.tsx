import { notFound, redirect } from "next/navigation";
import { getAuthContext, can } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import {
  SupplierDetailClient,
  type SupplierItemRow,
  type InventoryItemOption,
} from "@/components/purchasing/supplier-detail-client";

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ctx = await getAuthContext();
  if (!can("supplier.read", ctx.permissions)) redirect("/dashboard");
  const canManageItems = can("supplier.write", ctx.permissions);
  const canReadPrice = can("supplier_price.read", ctx.permissions);
  const canManagePrice = can("supplier_price.write", ctx.permissions);

  const supabase = await createClient();

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id, name, contact_name, contact_email, contact_phone, lead_time_days, active")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!supplier) notFound();

  type RawSupplierItem = {
    id: string;
    supplier_sku: string | null;
    pack_size: string | number | null;
    item: { name: string; sku: string } | null;
  };

  const [{ data: supplierItemsData }, { data: inventoryItemsData }] = await Promise.all([
    supabase
      .from("supplier_items")
      .select("id, supplier_sku, pack_size, item:inventory_items(name, sku)")
      .eq("supplier_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("inventory_items")
      .select("id, name, sku")
      .eq("active", true)
      .is("deleted_at", null)
      .order("name", { ascending: true }),
  ]);

  const rawSupplierItems = (supplierItemsData as RawSupplierItem[] | null) ?? [];

  // Sensitive: only query supplier_prices when the caller can actually see them.
  const latestPriceBySupplierItem = new Map<
    string,
    { price: number; currency: string; effectiveDate: string }
  >();
  if (canReadPrice && rawSupplierItems.length > 0) {
    const supplierItemIds = rawSupplierItems.map((si) => si.id);
    const { data: pricesData } = await supabase
      .from("supplier_prices")
      .select("supplier_item_id, price, currency, effective_date")
      .in("supplier_item_id", supplierItemIds)
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false });

    type RawPrice = {
      supplier_item_id: string;
      price: string | number;
      currency: string;
      effective_date: string;
    };
    for (const p of (pricesData as RawPrice[] | null) ?? []) {
      // Rows arrive newest-first; keep only the first (latest) price per supplier_item.
      if (!latestPriceBySupplierItem.has(p.supplier_item_id)) {
        latestPriceBySupplierItem.set(p.supplier_item_id, {
          price: Number(p.price),
          currency: p.currency,
          effectiveDate: p.effective_date,
        });
      }
    }
  }

  const supplierItems: SupplierItemRow[] = rawSupplierItems.map((si) => ({
    id: si.id,
    itemName: si.item?.name ?? "—",
    itemSku: si.item?.sku ?? "—",
    supplierSku: si.supplier_sku,
    packSize: si.pack_size === null ? null : Number(si.pack_size),
    latestPrice: canReadPrice ? (latestPriceBySupplierItem.get(si.id) ?? null) : undefined,
  }));

  const inventoryItems: InventoryItemOption[] = (
    (inventoryItemsData as { id: string; name: string; sku: string }[] | null) ?? []
  ).map((it) => ({ id: it.id, label: `${it.name} (${it.sku})` }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Purchasing · Suppliers</p>
        <h1 className="font-display mt-1 text-3xl">{supplier.name}</h1>
        <p className="text-muted-foreground mt-1">
          Items this supplier provides, their supplier SKUs, and pack sizes.
          {canReadPrice && " Price history is tracked per item."}
        </p>
      </div>
      <SupplierDetailClient
        supplierId={supplier.id}
        supplierItems={supplierItems}
        inventoryItems={inventoryItems}
        canManageItems={canManageItems}
        canReadPrice={canReadPrice}
        canManagePrice={canManagePrice}
      />
    </div>
  );
}
