# Database Schema

Normalized Postgres schema, built up by numbered migrations (schema → constraints/indexes → RLS
→ functions). See [`diagrams/erd.md`](./diagrams/erd.md) for the visual ERD. UUID primary keys
(`gen_random_uuid()` via `pgcrypto`) — but UUIDs are NEVER shown in the UI; human references
(name, SKU, barcode, reference number) are.

## Conventions (every business table)

- `id uuid pk default gen_random_uuid()`
- `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`
- `created_by uuid references profiles(id)`, `updated_by uuid references profiles(id)`
- `version integer not null default 1` (optimistic concurrency)
- Soft-deletable tables add `deleted_at timestamptz`, `deleted_by uuid`, `purge_at timestamptz`
- Ledger & mutation tables add `idempotency_key text unique`, `correlation_id uuid`
- Controlled vocabularies use Postgres `enum` or lookup tables; money as `numeric(14,4)`;
  quantities as `numeric(14,4)` in **base units**.

## Enums (indicative)

`item_type` (drink, food, raw_ingredient, sub_product, portioned_product, packaging, container) ·
`stock_txn_type` (stock_in, batch_stock_in, stock_out, batch_stock_out, transfer,
production_consumption, production_output, waste, manual_adjustment, purchase_receiving,
recount_adjustment, supplier_return, pos_sale, pos_refund) ·
`txn_status` (draft, pending_approval, approved, rejected, posted, reversed) ·
`production_status` (draft, submitted, approved, in_progress, awaiting_output, completed,
partially_completed, failed, cancelled) ·
`transfer_status` (requested, approved, prepared, in_transit, received, reconciled, cancelled) ·
`po_status` (draft, submitted, approved, partially_received, fully_received, closed, cancelled) ·
`payment_status` (unpaid, partially_paid, paid, overdue, cancelled, refunded) ·
`notif_severity` (info, warning, urgent, critical).

---

## 1. Identity & Access

- **profiles** — `id (=auth.users.id)`, `full_name`, `email`, `status` (active/disabled),
  `is_protected bool`, `avatar_url`. 1:1 with Supabase `auth.users`.
- **roles** — `key`, `name`, `is_system bool`.
- **permissions** — `slug` (`resource.action`), `description`, `is_sensitive bool`.
- **role_permissions** — (`role_id`, `permission_id`) pk.
- **user_roles** — (`profile_id`, `role_id`) pk.
- **user_branch_assignments** — (`profile_id`, `branch_id`) pk. Absent ⇒ global (Super Admin/Mgr).
- **email_code_challenges** — `profile_id`, `code_hash`, `purpose`, `expires_at`, `attempts`,
  `consumed_at`, `ip`. Plaintext code NEVER stored.
- **audit_logs** — `actor_id`, `action`, `entity_type`, `entity_id`, `before jsonb`, `after jsonb`,
  `reason`, `branch_id`, `ip`, `correlation_id`, `created_at`. Append-only; no secrets.

## 2. Org & Catalog

- **branches** — `key`, `name`, `is_main bool`, `holds_raw_ingredients bool`, `active bool`.
- **categories** — `name`, `item_type`, `parent_id` (self-ref), `active`.
- **units** — `code` (g, kg, ml, l, pc, serving, portion, pack, tray, container, sack, box),
  `name`, `dimension` (mass/volume/count).
- **unit_conversions** — `item_id?`, `from_unit_id`, `to_unit_id`, `factor numeric`. Item-specific
  conversions allowed (e.g. 1 sack = 25 kg); cross-dimension only if explicitly defined.
- **inventory_items** — unified item table: `name`, `sku` (unique), `item_type`, `category_id`,
  `base_unit_id`, `purchase_unit_id`, `low_stock_threshold`, `reorder_level`, `trackable bool`,
  `batch_tracked bool`, `expiry_tracked bool`, `is_consumable bool` (containers),
  `image_url`, `active bool`, `weighted_avg_cost numeric` (sensitive), storage notes.
- **products** — sellable overlay on an item: `item_id`, `product_kind` (drink/food),
  `is_active`. Product-specific selling metadata.
- **product_variants** — `product_id`, `name`, `sku`, `barcode`, own recipe/cost/price/active.
- **modifiers** — `product_id`, `name`, `selection` (single/multi), `required bool`.
- **modifier_options** — `modifier_id`, `name`, `affects` (price/inventory/both/none),
  `price_delta numeric`, links to a deduction recipe when stock-affecting.
- **branch_prices** — (`product_or_variant_id`, `branch_id`) `price numeric`,
  `tax_mode` (none/inclusive/exclusive), `active`. Prices independent per branch.
- **barcodes** — `item_id`, `code`, `symbology` (ean13/qr/…), unique.

## 3. Suppliers & Purchasing

- **suppliers** — `name`, contact, `lead_time_days`, `payment_terms`, `active`.
- **supplier_items** — (`supplier_id`, `item_id`), `supplier_sku`, `pack_size`.
- **supplier_prices** — `supplier_item_id`, `price numeric` (sensitive), `effective_date`,
  `currency`. History retained.
- **purchase_orders** — `reference` (human), `supplier_id`, `status po_status`,
  `payment_status`, `expected_date`, totals.
- **purchase_order_lines** — `po_id`, `item_id`, `ordered_qty`, `unit_cost` (sensitive), unit.
- **purchase_receipts** — `reference`, `po_id`, `received_by`, `received_at`, checklist flags,
  `idempotency_key`, optional photo.
- **purchase_receipt_lines** — `receipt_id`, `po_line_id`, `delivered/accepted/rejected/damaged/
missing_qty`, `expiration_date`, `lot_number`, `actual_unit_cost` (sensitive). Accepted qty →
  auto stock-in + weighted-avg update.
- **supplier_returns** — `reference`, `supplier_id`, lines, inventory + payable adjustments.

## 4. Recipes & Costing

- **recipes** — `name`, `kind` (production/sale/modifier), `output_item_id`, exactly one optional
  catalog target appropriate to the kind (`product_id`, `variant_id`, `modifier_option_id`),
  `active`, audit/version/soft-delete columns. Partial unique indexes permit only one live recipe
  for each production output or catalog target.
- **recipe_versions** — `recipe_id`, `version_number`, `effective_date`, `output_qty`,
  `output_unit_id`, `expected_yield_pct`, `expected_waste_pct`, `is_active`, `activated_at/by`,
  `prep_notes`. A partial unique index enforces one active version. Activated rows are immutable;
  revisions require a new draft version.
- **recipe_lines** — `recipe_version_id`, `input_item_id`, `qty numeric` (base unit),
  `is_packaging bool`. One input per version; multi-level costing follows an input item's active
  production recipe. Sale/modifier lines are restricted to prepared items and packaging.
- **cost_snapshots** — `recipe_version_id`, `snapshot_reason`, ingredient/packaging/waste/total/
  unit costs, `effective_output_qty`, item-level `breakdown jsonb`, `computed_at`, `created_by`.
  SENSITIVE and append-only; authenticated users have no direct table access and read through a
  `cost.read`-checking function only.

## 5. Production

- **production_templates** — seeded editable templates (Latin Mix, …, Espresso 2kg→20L),
  `output_item_id`, default recipe, batch-code format, shelf life, storage.
- **production_orders** — `reference`, `template_id?`, `recipe_version_id`, `status`,
  planned/actual times, `target_output`, `acceptable_yield_min/max`, `responsible_id`,
  `idempotency_key`, notes.
- **production_inputs** — `order_id`, `item_id`, `planned_qty`, `actual_qty`, `lot_id?`.
- **production_outputs** — `order_id`, `item_id`, `planned_qty`, `actual_qty`, `waste_qty`,
  `expiration_date`.
- **production_batches** — `reference/qr`, `output_id`, `produced_qty`, `expiration_date`.

## 6. Inventory Core

- **inventory_lots** — `item_id`, `branch_id`, `lot_number`, `received_date`, `expiration_date`,
  `qty_remaining`, `unit_cost` (sensitive, snapshot), `status` (available/expired/quarantined).
  FEFO selection orders by `expiration_date`.
- **inventory_balances** — (`item_id`, `branch_id`) pk, `qty_on_hand numeric`, `updated_at`.
  Derived projection maintained by posting functions; may go negative (flagged Critical).
- **stock_transactions** — `reference` (human), `type stock_txn_type`, `status txn_status`,
  `source_branch_id?`, `dest_branch_id?`, `reason`, `notes`, `created_by`, `approved_by`,
  `confirmed_at`, `idempotency_key unique`, `correlation_id`, related-record refs. Append-only.
- **stock_transaction_lines** — `txn_id`, `item_id`, `qty numeric` (base unit), `unit_id`,
  `lot_id?`, `unit_cost_snapshot numeric` (sensitive).
- **stock_requests** — `reference`, `requesting_branch_id`, `status`, notes, approval history.
- **stock_request_lines** — `request_id`, `item_id`, `requested_qty`, `approved_qty`.
- **transfers** — `reference`, `stock_request_id?`, `source_branch_id`, `dest_branch_id`,
  `status transfer_status`, `popup_event_id?`, `idempotency_key`.
- **transfer_lines** — `transfer_id`, `item_id`, `prepared/shipped/received/rejected/damaged/
missing_qty`, `lot_id?`.
- **transfer_discrepancies** — `transfer_line_id`, `type`, `qty`, `reason`, `resolution`.

## 7. Control

- **recount_sessions** — `reference`, `branch_id`, `kind` (start_of_day/end_of_day/full/category/
  high_value/cycle), `status`, `business_date`, `performed_by`.
- **recount_lines** — `session_id`, `item_id`, `expected_qty` (computed), `physical_qty`,
  `variance_qty` (generated).
- **recount_variances** — `recount_line_id`, `classification`, `reason`, `variance_value`
  (via cost snapshot, sensitive), `escalated bool`.
- **daily_operational_closures** — (`branch_id`, `business_date`) pk, `closed_by`, `closed_at`,
  `reopened_by?`, `reopen_reason?`, `reopened_at?`.
- **approval_requests** — `entity_type`, `entity_id`, `rule_key`, `status`, `required_role/perm`.
- **approval_history** — `approval_request_id`, `actor_id`, `decision`, `reason`, `at`.

## 8. Ops & UX

- **calendar_events** — `title`, `type`, `branch_id?`, `starts_at`, `ends_at`, `status`,
  related-record refs (production/transfer/po/recount/popup).
- **popup_event_sessions** — `calendar_event_id`, `name`, `client`, `venue`, planned products,
  reserved stock, transfer/return refs, recount ref, event summary.
- **notifications** — `recipient_id`, `type`, `severity`, `title`, `body`, `related_ref`,
  `read_at`, `email_status`, `retry_count`, `dedupe_key`.
- **notification_preferences** — `profile_id`, `type`, `channel_inapp bool`, `channel_email bool`.

## 9. Lifecycle & Settings

- **application_settings** — key/value (jsonb): VAT config, thresholds (global + item overrides),
  target margin, notification recipients. Super Admin only.
- Recycle-bin is a set of views over soft-deleted rows (deletion date, deleted_by, purge_at,
  restore eligibility). Purge job respects ledger/audit/legal dependencies.

## 10. POS V2 (schema only, no live sync)

- **pos_item_mappings** — `product_or_variant_id`, `loyverse_item_id`, `branch_id`.
- **pos_transaction_mappings** — `loyverse_txn_id unique`, `status`, reversal refs.
- **pos_sync_logs** — run metadata, errors.
- **import_jobs** / **import_rows** — CSV import preview: detected columns, proposed mappings,
  invalid/duplicate/unmatched rows, confirmation, result. No inventory posts before confirmation.

## Integrity highlights

- FK everywhere; `check` constraints on quantities/enums; `unique` on sku/barcode/reference/
  idempotency_key; partial indexes for `active`/`deleted_at is null` and FEFO (`expiration_date`).
- All multi-table inventory writes go through `SECURITY DEFINER` functions (see ARCHITECTURE) —
  ordinary roles have no direct `insert/update` on ledger/balances.
