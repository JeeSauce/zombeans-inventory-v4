import { formatInTimeZone } from "date-fns-tz";
import { notFound, redirect } from "next/navigation";
import { can, getAuthContext } from "@/lib/auth/context";
import { deriveProductionWarnings } from "@/lib/production/planning";
import { createClient } from "@/lib/supabase/server";
import {
  ProductionDetailClient,
  type ProductionDetail,
  type ProductionInputRow,
} from "@/components/production/production-detail-client";

type RawOrder = {
  id: string;
  reference: string;
  status: ProductionDetail["status"];
  planned_output_qty: string | number;
  actual_output_qty: string | number | null;
  output_lot_number: string | null;
  production_date: string | null;
  expiration_date: string | null;
  notes: string | null;
  started_at: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  template: { name: string; default_expiry_days: number | null } | null;
  recipe_version: {
    version_number: number;
    expected_yield_pct: string | number;
    expected_waste_pct: string | number;
  } | null;
  output_item: { name: string; sku: string } | null;
  output_unit: { code: string } | null;
};

type RawInput = {
  id: string;
  planned_qty: string | number;
  actual_consumed_qty: string | number;
  waste_qty: string | number;
  notes: string | null;
  item: { name: string; sku: string } | null;
  unit: { code: string } | null;
};

export default async function ProductionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getAuthContext();
  const canRecord = can("production.record", ctx.permissions);
  const canConfirm = can("production.confirm", ctx.permissions);
  const canCancel = can("production.create", ctx.permissions);
  if (!canRecord && !canConfirm && !canCancel) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: orderData }, { data: inputsData }] = await Promise.all([
    supabase
      .from("production_orders")
      .select(
        "id, reference, status, planned_output_qty, actual_output_qty, output_lot_number, production_date, expiration_date, notes, started_at, submitted_at, confirmed_at, template:production_templates(name, default_expiry_days), recipe_version:recipe_versions(version_number, expected_yield_pct, expected_waste_pct), output_item:inventory_items!production_orders_output_item_id_fkey(name, sku), output_unit:units!production_orders_output_unit_id_fkey(code)",
      )
      .eq("id", id)
      .single(),
    supabase
      .from("production_order_inputs")
      .select(
        "id, planned_qty, actual_consumed_qty, waste_qty, notes, item:inventory_items(name, sku), unit:units(code)",
      )
      .eq("production_order_id", id)
      .order("created_at"),
  ]);
  if (!orderData) notFound();
  const raw = orderData as unknown as RawOrder;
  const inputs: ProductionInputRow[] = ((inputsData as unknown as RawInput[] | null) ?? []).map(
    (input) => ({
      id: input.id,
      itemName: input.item?.name ?? "Unknown item",
      itemSku: input.item?.sku ?? "—",
      unitCode: input.unit?.code ?? "unit",
      plannedQty: Number(input.planned_qty),
      actualConsumedQty: Number(input.actual_consumed_qty),
      wasteQty: Number(input.waste_qty),
      notes: input.notes,
    }),
  );
  const order: ProductionDetail = {
    id: raw.id,
    reference: raw.reference,
    templateName: raw.template?.name ?? "Unknown template",
    recipeVersion: raw.recipe_version?.version_number ?? 0,
    outputName: raw.output_item?.name ?? "Unknown output",
    outputSku: raw.output_item?.sku ?? "—",
    unitCode: raw.output_unit?.code ?? "unit",
    status: raw.status,
    plannedOutputQty: Number(raw.planned_output_qty),
    actualOutputQty: raw.actual_output_qty === null ? null : Number(raw.actual_output_qty),
    outputLotNumber: raw.output_lot_number,
    productionDate: raw.production_date,
    expirationDate: raw.expiration_date,
    notes: raw.notes,
    startedAt: raw.started_at,
    submittedAt: raw.submitted_at,
    confirmedAt: raw.confirmed_at,
  };
  const warnings =
    order.actualOutputQty === null
      ? []
      : deriveProductionWarnings(
          order.plannedOutputQty,
          order.actualOutputQty,
          inputs.map((input) => ({
            plannedQty: input.plannedQty,
            actualConsumedQty: input.actualConsumedQty,
            wasteQty: input.wasteQty,
          })),
          Number(raw.recipe_version?.expected_yield_pct ?? 100),
          Number(raw.recipe_version?.expected_waste_pct ?? 0),
        ).map((warning) => warning.message);

  const now = new Date();
  const defaultProductionDate = formatInTimeZone(now, "Asia/Manila", "yyyy-MM-dd");
  const expiryDate = new Date(now);
  expiryDate.setDate(expiryDate.getDate() + (raw.template?.default_expiry_days ?? 1));
  const defaultExpirationDate = formatInTimeZone(expiryDate, "Asia/Manila", "yyyy-MM-dd");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Production · {order.templateName}</p>
        <h1 className="font-display font-data mt-1 text-3xl">{order.reference}</h1>
        <p className="text-muted-foreground mt-1">
          {order.outputName} · {order.outputSku}
        </p>
      </div>
      <ProductionDetailClient
        order={order}
        inputs={inputs}
        warnings={warnings}
        canRecord={canRecord}
        canConfirm={canConfirm}
        canCancel={canCancel}
        defaultProductionDate={defaultProductionDate}
        defaultExpirationDate={defaultExpirationDate}
      />
    </div>
  );
}
