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
`production_status` (draft, in_progress, awaiting_confirmation, completed, cancelled) ·
`transfer_status` (requested, approved, prepared, in_transit, received, reconciled, cancelled) ·
`po_status` (draft, submitted, approved, partially_received, fully_received, closed, cancelled) ·
`payment_status` (unpaid, partially_paid, paid, overdue, cancelled, refunded) ·
`recount_session_type` (start_of_day, end_of_day, cycle) ·
`recount_session_status` (draft, submitted, adjusted, closed) ·
`recount_adjustment_reason` (counting_error, unrecorded_movement, spoilage, damage, theft_or_loss,
found_stock, unit_conversion, other) ·
`day_close_status` (closed, reopened) · `day_close_event_type` (close, reopen) ·
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

- **production_templates** — `name`, one `production` `recipe_id`,
  `default_batch_multiplier`, optional `default_expiry_days`, instructions, active/audit/soft-delete
  fields. A live recipe has at most one live template.
- **production_orders** — human `reference`, `template_id`, frozen `recipe_version_id` and protected
  `cost_snapshot_id`, Main `branch_id`, output item/unit, `status production_status`, batch
  multiplier, planned/actual output, output lot/production/expiration dates, stable unique
  `idempotency_key`, correlation ID, lifecycle actors/timestamps, and output transaction link.
- **production_order_inputs** — frozen `recipe_line_id`, item/base unit and `planned_qty`, with
  recorded `actual_consumed_qty`, `waste_qty`, and notes. One row per planned recipe input.
- `stock_transactions.production_order_id` relates the separate consumption, waste, and output
  ledger movements. Their shared correlation ID and deterministic derived idempotency keys keep
  completion atomic and replay-safe.

## 6. Inventory Core

- **inventory_lots** — `item_id`, `branch_id`, `lot_number`, `received_date`, `expiration_date`,
  `qty_remaining`, `unit_cost` (sensitive, snapshot), `status` (available/expired/quarantined).
  FEFO selection orders by `expiration_date`.
- **inventory_balances** — (`item_id`, `branch_id`) pk, `qty_on_hand numeric`, `updated_at`.
  Derived projection maintained by posting functions; may go negative (flagged Critical).
- **stock_transactions** — `reference` (human), `type stock_txn_type`, `status txn_status`,
  `source_branch_id?`, `dest_branch_id?`, `reason`, `notes`, `created_by`, `approved_by`,
  `confirmed_at`, `idempotency_key unique`, `correlation_id`, `production_order_id?`,
  `transfer_id?`, purchasing refs, and `day_reopen_event_id?` attribution. Append-only.
- **stock_transaction_lines** — `txn_id`, `item_id`, `qty numeric` (base unit), `unit_id`,
  `lot_id?`, `unit_cost_snapshot numeric` (sensitive).
- **stock_requests** — human `reference`, `requesting_branch_id`, `status stock_request_status`,
  notes, stable `idempotency_key`, requester, and manager review history.
- **stock_request_lines** — `request_id`, item/base unit, positive `requested_qty`, bounded
  `approved_qty`.
- **transfers** — human `reference`, optional approved `stock_request_id`, source/destination,
  `status transfer_status` (`prepared/in_transit/received/cancelled`), stable preparation and
  receive idempotency keys, correlation ID, lifecycle actors/timestamps, and source/receive
  transaction links.
- **transfer_lines** — item/base unit and `prepared/shipped/received/rejected/damaged/missing_qty`;
  database constraints prevent over-accounting.
- **transfer_lot_allocations** — one row per FEFO source lot allocation, freezing allocated and
  received quantity, source/destination lot links, lot metadata, expiration, and sensitive
  `unit_cost_snapshot` for cost-preserving receiving.
- **transfer_discrepancies** — transfer/line, rejected/damaged/missing type, quantity, reason,
  open/resolved status, resolution, and lifecycle actors/timestamps.
- **inventory_alerts** — item/branch, Critical severity, exact negative `qty_on_hand`, causing
  stock transaction, reason, actor, and active/resolved lifecycle. Created only by posting
  functions; active alerts are surfaced prominently on `/stock`.

## 7. Control

- **recount_sessions** — human `reference`, branch/business date, `type`
  (start_of_day/end_of_day/cycle), lifecycle `status` (draft/submitted/adjusted/closed), frozen
  `snapshot_at`, unique open/submit idempotency keys, unusual decision/signals, lifecycle actors and
  timestamps, and optional `day_reopen_event_id`. A partial unique index permits only one
  draft/submitted session per branch/date/type.
- **recount_lines** — session/item/base unit plus frozen formula components
  (`opening + received + production_output - transfers_out - usage - stock_out - waste`),
  `expected_qty`, entered `physical_qty`, four-decimal `variance_qty`, protected
  `unit_cost_snapshot`, protected `variance_value_snapshot`, and frozen unusual signals. Database
  checks enforce both formulas.
- **variance_adjustments** — one human-referenced, reason-typed adjustment per session, stable
  idempotency key, link to its append-only `recount_adjustment` stock transaction, protected total
  frozen variance value, unusual flag, posting actor/time, and optional reopen-event attribution.
- **daily_operational_closures** — one mutable current-state row per branch/business date with a
  human reference, closed/reopened state, transition counts, latest actors/times, and latest event.
- **day_close_events** — append-only close/reopen transition history with human reference, stable
  idempotency key, actor, mandatory reopen reason, timestamp, and one linked cost-free
  `audit_logs` row. Reopen events attribute every later stock/recount change explicitly.
- **approval_requests** — `entity_type`, `entity_id`, `rule_key`, `status`, `required_role/perm`.
- **approval_history** — `approval_request_id`, `actor_id`, `decision`, `reason`, `at`.

## 8. Ops & UX

- **notifications** — human reference, enforced source/severity, active/resolved current state,
  entity linkage, role/branch/user target, stable dedup key, Critical-only email flag, raise count,
  and first/last/resolution timestamps. A partial unique index permits one active row per dedup key.
- **notification_receipts** — one per notification/user with current read and acknowledged times.
  Users can change only their own receipt through the idempotent receipt RPC.
- **notification_events** — append-only raises, re-raises, resolution, read/ack, and delivery
  transitions with actor, metadata, timestamp, and stable idempotency key.
- **notification_deliveries** — server-owned in-app/email delivery state, recipient, unique delivery
  key, claim token, bounded attempt count, provider result, and failure detail. Recipient addresses
  are omitted from all authenticated grants.
- **calendar_events** — human reference, title/description/location, operation/popup/production/
  delivery/recount/other type, optional branch, UTC start/end, lifecycle, audit actors, and version.
- **calendar_event_commands** — append-only idempotent create/update/cancel command record with
  resulting event/version and cost-free audit link.
- **popup_event_sessions** — one-to-one calendar event, permanent popup branch, return-to Main
  branch, lifecycle, human reference, notes, lifecycle actors/timestamps, and optimistic version.
- **popup_event_count_lines** — per-session/item frozen transferred-in, returned, ending,
  consumed, waste, loss, and gain quantities with database-enforced reconciliation equations.
- **popup_event_movements** — append-only links from an engagement summary to existing received
  transfers or posted stock transactions; this table never posts inventory itself.
- **popup_event_commands** — append-only, replay-safe lifecycle/count/link commands with result
  status/version and cost-free audit linkage.
- **production_orders Phase 8 failure fields** — failure actor/time/reason/idempotency metadata for
  the explicit failed state and its Critical producer.

## 9. Lifecycle & Settings

- **application_settings** — key/value (jsonb): VAT config, thresholds (global + item overrides),
  target margin, notification recipients. Super Admin only.
- **retention_holds** — explicit legal/accounting/operational holds on supported business roots,
  with human reference, reason, optional expiry, release actor/time, and append-only audit history.
- **recycle_bin_commands** — append-only idempotency and audit linkage for soft-delete, restore,
  hold/release, and purge commands.
- **recycle_purge_runs** — idempotent purge-run metadata and safe per-record results. Purge respects
  active holds, inbound dependencies, and ledger/accounting history.
- **backup_runs** — non-secret metadata reported by secured backup infrastructure: human reference,
  mechanism/status, safe provider label, encryption flag, timing, retention, size, verification,
  and sanitized failure summary. It stores no URL, path, credentials, or database secrets.
- Soft-delete lifecycle columns and hard deletes are trigger-guarded. Authenticated and service-role
  callers must use the audited command functions; the database owner retains explicit maintenance
  access for migrations and controlled test cleanup.

## 10. Offline & POS preparation (no live sync)

- **offline_snapshots** / **offline_snapshot_items** — immutable, server-issued receipts binding
  actor, branch, operation type, client draft, business date/order, item scope, capture time, and
  frozen ledger watermark. A browser timestamp alone is never trusted for conflict detection.
- **offline_submissions** / **offline_submission_items** — one idempotent sync result per actor and
  stable key, with a human reference, payload hash, snapshot linkage, applied/review/rejected
  state, cost-free result links, and append-only audit evidence.
- **offline_conflict_resolutions** — append-only reasoned accept/reject commands. Review never
  silently overwrites a newer count; accepted work calls the existing atomic recount/production
  primitives and rejected work produces no inventory movement.
- **loyverse_mappings** / **loyverse_mapping_commands** — active external item/variant/modifier to
  internal inventory-item mappings, base quantity per sale, version, actor, reason, idempotency,
  and audit history. They contain no Loyverse credential or cost field.
- **pos_imports** / **pos_import_rows** — immutable UTF-8 CSV staging headers/rows with payload hash,
  exact validation state, captured mapping and base quantity, human reference, branch, and
  preview/confirmation actors. Preview has no inventory linkage or side effect.
- **pos_import_postings** — append-only one-to-one evidence from an external line to its single
  `pos_sale` or `pos_refund` ledger transaction. External line/type and confirmation idempotency
  constraints prevent duplicate posting.
- `issue_offline_snapshot`, offline submit/review functions, mapping commands, and POS preview/
  confirm functions are `SECURITY DEFINER`, permission checked, audit linked, and closed to direct
  authenticated DML. POS sales use FEFO eligible lots and preserve the existing negative-stock
  Critical alert behavior; refunds increase the balance through the same atomic function.

## Integrity highlights

- FK everywhere; `check` constraints on quantities/enums; `unique` on sku/barcode/reference/
  idempotency_key; partial indexes for `active`/`deleted_at is null` and FEFO (`expiration_date`).
- All multi-table inventory writes go through `SECURITY DEFINER` functions (see ARCHITECTURE) —
  ordinary roles have no direct `insert/update` on ledger/balances.
