import { redirect } from "next/navigation";
import { getAuthContext, can } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { SuppliersClient, type SupplierRow } from "@/components/purchasing/suppliers-client";

export default async function SuppliersPage() {
  const ctx = await getAuthContext();
  if (!can("supplier.read", ctx.permissions)) redirect("/dashboard");
  const canWrite = can("supplier.write", ctx.permissions);

  const supabase = await createClient();
  const { data } = await supabase
    .from("suppliers")
    .select(
      "id, name, contact_name, contact_email, contact_phone, lead_time_days, payment_terms, active",
    )
    .is("deleted_at", null)
    .order("name", { ascending: true });

  const suppliers: SupplierRow[] = ((data as SupplierRow[] | null) ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    contact_name: s.contact_name,
    contact_email: s.contact_email,
    contact_phone: s.contact_phone,
    lead_time_days: s.lead_time_days,
    payment_terms: s.payment_terms,
    active: s.active,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Purchasing</p>
        <h1 className="font-display mt-1 text-3xl">Suppliers</h1>
        <p className="text-muted-foreground mt-1">
          Vendors you buy ingredients and supplies from, with contact details and lead times.
        </p>
      </div>
      <SuppliersClient suppliers={suppliers} canWrite={canWrite} />
    </div>
  );
}
