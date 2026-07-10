import { getAuthContext, can } from "@/lib/auth/context";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseTaxConfig } from "@/lib/catalog/tax";
import {
  ProductsClient,
  type ProductRow,
  type BranchOption,
  type UnitOption,
} from "@/components/catalog/products-client";
import type { TaxMode } from "@/lib/validation/catalog";

export default async function ProductsPage() {
  const ctx = await getAuthContext();
  if (!can("catalog.item.read", ctx.permissions)) redirect("/dashboard");
  const canWrite = can("catalog.item.write", ctx.permissions);
  const canReadPrice = can("price.read", ctx.permissions);
  const canWritePrice = can("price.write", ctx.permissions);

  const supabase = await createClient();
  const [{ data: productsData }, { data: branchesData }, { data: unitsData }, { data: vatValue }] =
    await Promise.all([
      supabase
        .from("products")
        .select(
          "id, product_kind, is_active, item:inventory_items(name, sku), branch_prices(branch_id, price, tax_mode)",
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("branches")
        .select("id, name, is_main")
        .is("deleted_at", null)
        .eq("active", true)
        .order("is_main", { ascending: false })
        .order("name"),
      supabase.from("units").select("id, code, name").eq("active", true).order("code"),
      supabase.rpc("tax_config"),
    ]);

  type RawProduct = {
    id: string;
    product_kind: "drink" | "food";
    is_active: boolean;
    item: { name: string; sku: string } | null;
    branch_prices: { branch_id: string; price: string | number; tax_mode: TaxMode }[];
  };

  const branches: BranchOption[] = (
    (branchesData as { id: string; name: string; is_main: boolean }[] | null) ?? []
  ).map((b) => ({ id: b.id, name: b.name, isMain: b.is_main }));

  const products: ProductRow[] = ((productsData as RawProduct[] | null) ?? []).map((p) => ({
    id: p.id,
    name: p.item?.name ?? "—",
    sku: p.item?.sku ?? "—",
    kind: p.product_kind,
    isActive: p.is_active,
    prices: p.branch_prices.map((bp) => ({
      branchId: bp.branch_id,
      price: Number(bp.price),
      taxMode: bp.tax_mode,
    })),
  }));

  const units: UnitOption[] = (
    (unitsData as { id: string; code: string; name: string }[] | null) ?? []
  ).map((u) => ({ id: u.id, label: `${u.code} — ${u.name}` }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Catalog</p>
        <h1 className="font-display mt-1 text-3xl">Products</h1>
        <p className="text-muted-foreground mt-1">
          Sellable drinks and food. Prices are set independently per branch; VAT is applied only
          when enabled in Settings.
        </p>
      </div>
      <ProductsClient
        products={products}
        branches={branches}
        units={units}
        vat={parseTaxConfig(vatValue)}
        canWrite={canWrite}
        canReadPrice={canReadPrice}
        canWritePrice={canWritePrice}
      />
    </div>
  );
}
