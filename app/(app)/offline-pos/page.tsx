import { formatInTimeZone } from "date-fns-tz";
import { redirect } from "next/navigation";
import { BarcodeLookup } from "@/components/offline-pos/barcode-lookup";
import { ConflictReview, type OfflineConflictView } from "@/components/offline-pos/conflict-review";
import {
  OfflineDrafts,
  type OfflineBranchOption,
  type OfflineItemOption,
  type OfflineProductionOrderOption,
} from "@/components/offline-pos/offline-drafts";
import {
  PosWorkspace,
  type LoyverseMappingView,
  type PosImportView,
} from "@/components/offline-pos/pos-workspace";
import { can, getAuthContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

type RawItem = {
  id: string;
  name: string;
  sku: string;
  unit: { code: string } | null;
};
type RawProductionOrder = {
  id: string;
  reference: string;
  branch_id: string;
  planned_output_qty: string | number;
  branch: { name: string } | null;
  output_item: { name: string; sku: string } | null;
  output_unit: { code: string } | null;
  inputs: Array<{
    id: string;
    planned_qty: string | number;
    item: { name: string; sku: string } | null;
    unit: { code: string } | null;
  }>;
};
type RawMapping = {
  id: string;
  entity_type: LoyverseMappingView["entityType"];
  external_id: string;
  external_name: string | null;
  external_sku: string | null;
  inventory_qty: string | number;
  active: boolean;
  item: { name: string; sku: string } | null;
};
type RawImport = {
  id: string;
  reference: string;
  filename: string;
  status: PosImportView["status"];
  row_count: number;
  valid_count: number;
  error_count: number;
  previewed_at: string;
  confirmed_at: string | null;
  branch: { name: string } | null;
  rows: Array<{
    row_number: number;
    external_reference: string;
    external_line_id: string;
    movement_type: "sale" | "refund";
    entity_type: "item" | "variant" | "modifier";
    external_id: string;
    quantity: string | number;
    inventory_qty: string | number | null;
    validation_status: "valid" | "unmapped" | "duplicate" | "invalid";
    validation_error: string | null;
    item: { name: string; sku: string } | null;
  }>;
};

export default async function OfflinePosPage() {
  const auth = await getAuthContext();
  const canSync = can("offline.sync", auth.permissions);
  const canRecount = canSync && can("recount.perform", auth.permissions);
  const canProduction = canSync && can("production.record", auth.permissions);
  const canReview = can("offline.review", auth.permissions);
  const canImport = can("pos.import", auth.permissions);
  const canLookup = can("catalog.item.read", auth.permissions);
  if (!canSync && !canReview && !canImport && !canLookup) redirect("/dashboard");

  const supabase = await createClient();
  const branchResult = await supabase
    .from("branches")
    .select("id, name")
    .eq("active", true)
    .is("deleted_at", null)
    .order("name");
  const itemResult = await supabase
    .from("inventory_items")
    .select("id, name, sku, unit:units!inventory_items_base_unit_id_fkey(code)")
    .eq("active", true)
    .eq("trackable", true)
    .is("deleted_at", null)
    .order("name");
  if (branchResult.error || itemResult.error) {
    throw new Error(branchResult.error?.message ?? itemResult.error?.message ?? "Catalog failed");
  }

  const branches: OfflineBranchOption[] = (branchResult.data ?? []).map((branch) => ({
    id: branch.id,
    name: branch.name,
  }));
  const items: OfflineItemOption[] = ((itemResult.data as unknown as RawItem[] | null) ?? []).map(
    (item) => ({
      id: item.id,
      name: item.name,
      sku: item.sku,
      unitCode: item.unit?.code ?? "unit",
    }),
  );

  let productionOrders: OfflineProductionOrderOption[] = [];
  if (canProduction) {
    const result = await supabase
      .from("production_orders")
      .select(
        "id, reference, branch_id, planned_output_qty, branch:branches(name), output_item:inventory_items!production_orders_output_item_id_fkey(name, sku), output_unit:units!production_orders_output_unit_id_fkey(code), inputs:production_order_inputs(id, planned_qty, item:inventory_items(name, sku), unit:units(code))",
      )
      .eq("status", "in_progress")
      .order("created_at");
    if (result.error) throw new Error(result.error.message);
    productionOrders = ((result.data as unknown as RawProductionOrder[] | null) ?? []).map(
      (order) => ({
        id: order.id,
        reference: order.reference,
        branchId: order.branch_id,
        branchName: order.branch?.name ?? "Unknown branch",
        outputName: order.output_item?.name ?? "Unknown output",
        outputSku: order.output_item?.sku ?? "—",
        unitCode: order.output_unit?.code ?? "unit",
        plannedOutputQty: Number(order.planned_output_qty),
        inputs: (order.inputs ?? []).map((input) => ({
          id: input.id,
          itemName: input.item?.name ?? "Unknown input",
          itemSku: input.item?.sku ?? "—",
          unitCode: input.unit?.code ?? "unit",
          plannedQty: Number(input.planned_qty),
        })),
      }),
    );
  }

  let conflicts: OfflineConflictView[] = [];
  if (canReview) {
    const result = await supabase.rpc("list_offline_conflicts");
    if (result.error) throw new Error(result.error.message);
    conflicts = (result.data ?? []) as OfflineConflictView[];
  }

  let mappings: LoyverseMappingView[] = [];
  let imports: PosImportView[] = [];
  if (canImport) {
    const [mappingResult, importResult] = await Promise.all([
      supabase
        .from("loyverse_mappings")
        .select(
          "id, entity_type, external_id, external_name, external_sku, inventory_qty, active, item:inventory_items!loyverse_mappings_inventory_item_id_fkey(name, sku)",
        )
        .order("external_name"),
      supabase
        .from("pos_imports")
        .select(
          "id, reference, filename, status, row_count, valid_count, error_count, previewed_at, confirmed_at, branch:branches(name), rows:pos_import_rows(row_number, external_reference, external_line_id, movement_type, entity_type, external_id, quantity, inventory_qty, validation_status, validation_error, item:inventory_items!pos_import_rows_inventory_item_id_fkey(name, sku))",
        )
        .order("previewed_at", { ascending: false })
        .limit(20),
    ]);
    if (mappingResult.error || importResult.error) {
      throw new Error(
        mappingResult.error?.message ?? importResult.error?.message ?? "POS load failed",
      );
    }
    mappings = ((mappingResult.data as unknown as RawMapping[] | null) ?? []).map((mapping) => ({
      id: mapping.id,
      entityType: mapping.entity_type,
      externalId: mapping.external_id,
      externalName: mapping.external_name,
      externalSku: mapping.external_sku,
      itemName: mapping.item?.name ?? "Unknown item",
      itemSku: mapping.item?.sku ?? "—",
      inventoryQty: Number(mapping.inventory_qty),
      active: mapping.active,
    }));
    imports = ((importResult.data as unknown as RawImport[] | null) ?? []).map((value) => ({
      id: value.id,
      reference: value.reference,
      branchName: value.branch?.name ?? "Unknown branch",
      filename: value.filename,
      status: value.status,
      rowCount: value.row_count,
      validCount: value.valid_count,
      errorCount: value.error_count,
      previewedAt: value.previewed_at,
      confirmedAt: value.confirmed_at,
      rows: (value.rows ?? [])
        .sort((left, right) => left.row_number - right.row_number)
        .map((row) => ({
          rowNumber: row.row_number,
          externalReference: row.external_reference,
          externalLineId: row.external_line_id,
          movementType: row.movement_type,
          entityType: row.entity_type,
          externalId: row.external_id,
          quantity: Number(row.quantity),
          inventoryQty: row.inventory_qty === null ? null : Number(row.inventory_qty),
          validationStatus: row.validation_status,
          validationError: row.validation_error,
          itemName: row.item?.name ?? null,
          itemSku: row.item?.sku ?? null,
        })),
    }));
  }

  const businessDate = formatInTimeZone(new Date(), "Asia/Manila", "yyyy-MM-dd");
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Phase 10 · server-owned synchronization</p>
        <h1 className="font-display mt-1 text-3xl">Offline &amp; POS staging</h1>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          Device drafts, explicit conflict review, barcode identification, and preview-before-post
          Loyverse CSV imports. Live POS synchronization is intentionally disabled.
        </p>
      </div>
      {canSync && (
        <OfflineDrafts
          branches={branches}
          items={items}
          productionOrders={productionOrders}
          businessDate={businessDate}
          canRecount={canRecount}
          canProduction={canProduction}
        />
      )}
      {canReview && <ConflictReview conflicts={conflicts} />}
      {canLookup && <BarcodeLookup />}
      {canImport && (
        <PosWorkspace branches={branches} items={items} mappings={mappings} imports={imports} />
      )}
    </div>
  );
}
