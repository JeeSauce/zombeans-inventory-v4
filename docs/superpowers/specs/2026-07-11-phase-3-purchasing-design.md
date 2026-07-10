# Phase 3 — Ingredients, Suppliers & Purchasing — Design Spec

Date: 2026-07-11 · Status: approved for planning · Gate: critical scenarios **6** and **7**

Builds the purchasing and costing domain on top of the Phase 2 catalog. Because receiving must
post stock and update weighted-average cost, Phase 3 also introduces a **minimal, receiving-scoped
slice of the ledger core** that Phase 6 later extends to stock-out, transfers, and requests.

## 1. Scope

**In scope**
- Suppliers, supplier_items, supplier_prices (sensitive, history-retained).
- Purchase orders + lines (unit_cost sensitive, auto-filled from the current supplier price).
- Partial receiving: per-line delivered/accepted/rejected/damaged/missing + expiry + lot.
- Minimal ledger core: `stock_transactions`/`stock_transaction_lines`, `inventory_lots`,
  `inventory_balances` — scoped to `purchase_receiving` and `supplier_return` only.
- Weighted-average costing, maintained on `inventory_items.weighted_avg_cost` (global per item).
- Supplier returns (stock-out reversal + payable adjustment).
- Lightweight PO payment status.

**Deferred**
- Receiving photo attachment (Supabase Storage) — later.
- Full stock-out / transfers / stock requests / discrepancies — Phase 6.
- Full accounts-payable ledger — later (Phase 9 reporting territory).

**Key decisions from brainstorming**
- Ledger: build the minimal core now (scenarios 6 & 7 require it); Phase 6 extends.
- Cost flow: supplier_prices (Super Admin) → PO-line unit_cost auto-fill (hidden from managers) →
  receiving posts at PO-line cost → weighted-average updates. No non-Super user sees/enters cost.
- Receiving lifecycle: auto-transition PO status + manual early close; **over-receipt blocked**.
- Secondary features included: PO payment status, supplier returns. Photo deferred.

## 2. Data model

Conventions follow `docs/DATABASE_SCHEMA.md` §Conventions (uuid pk, created/updated_at + _by,
version, soft-delete where applicable, money/qty `numeric(14,4)`, idempotency_key on mutation
tables, enums for controlled vocab).

### New enums
- `po_status` (draft, submitted, approved, partially_received, fully_received, closed, cancelled)
- `payment_status` (unpaid, partially_paid, paid, overdue, cancelled, refunded)
- `stock_txn_type` — full enum per DATABASE_SCHEMA; Phase 3 **uses** only `purchase_receiving`,
  `supplier_return` (and `manual_adjustment` for Super-Admin cost corrections). Others land in P6.
- `txn_status` (draft, pending_approval, approved, rejected, posted, reversed)
- `lot_status` (available, expired, quarantined)

### Purchasing tables
- **suppliers** — name, contact fields, `lead_time_days`, `payment_terms`, `active`; soft-delete.
- **supplier_items** — (`supplier_id`, `item_id`) unique, `supplier_sku`, `pack_size`.
- **supplier_prices** — `supplier_item_id`, `price numeric(14,4)` (SENSITIVE), `effective_date`,
  `currency default 'PHP'`. **Append-only history**: a price change inserts a new row; the current
  price is the one with the latest `effective_date ≤ today`. No in-place update.
- **purchase_orders** — `reference` (`PO-YYYY-NNNNNN`), `supplier_id`, `status po_status`,
  `payment_status default 'unpaid'`, `expected_date`, `subtotal/total numeric` (SENSITIVE),
  `notes`; audit + soft-delete.
- **purchase_order_lines** — `po_id`, `item_id`, `ordered_qty numeric`, `unit_id`,
  `unit_cost numeric(14,4)` (SENSITIVE; auto-filled from current supplier_price at add-time),
  `received_accepted_qty numeric default 0` (running tally). CHECK ordered_qty > 0.
- **purchase_receipts** — `reference`, `po_id`, `received_by`, `received_at`, checklist flags
  (`has_shortage`, `has_damage`, `has_price_diff`, `needs_review`), `status` (draft/posted),
  `idempotency_key text unique`, `correlation_id`.
- **purchase_receipt_lines** — `receipt_id`, `po_line_id`, `delivered_qty`, `accepted_qty`,
  `rejected_qty`, `damaged_qty`, `missing_qty`, `expiration_date`, `lot_number`. All qty in the
  PO line's unit. CHECK each qty ≥ 0.
- **supplier_returns** — `reference`, `supplier_id`, `status`, `reason`, `idempotency_key unique`,
  `payable_adjustment numeric` (SENSITIVE).
- **supplier_return_lines** — `return_id`, `item_id`, `lot_id`, `qty numeric` (base unit), reason.

### Ledger core (minimal, receiving/returns-scoped)
- **inventory_lots** — `item_id`, `branch_id`, `lot_number`, `received_date`, `expiration_date`,
  `qty_remaining numeric`, `unit_cost numeric(14,4)` (SENSITIVE snapshot), `status lot_status`.
  Index for FEFO (`item_id`, `branch_id`, `expiration_date`) where status='available'.
- **inventory_balances** — (`item_id`, `branch_id`) pk, `qty_on_hand numeric`, `updated_at`.
  Projection maintained solely by posting functions; may go negative (flagged in P6).
- **stock_transactions** — `reference`, `type stock_txn_type`, `status txn_status`,
  `source_branch_id?`, `dest_branch_id?`, `reason`, `notes`, `created_by`, `approved_by`,
  `confirmed_at`, `idempotency_key text unique`, `correlation_id`, related-record refs
  (`purchase_receipt_id?`, `supplier_return_id?`). Append-only.
- **stock_transaction_lines** — `txn_id`, `item_id`, `qty numeric` (base unit, signed by type),
  `unit_id`, `lot_id?`, `unit_cost_snapshot numeric(14,4)` (SENSITIVE).

## 3. Costing & posting

### Pure helpers — `lib/purchasing/costing.ts` (unit-tested; DB twin below)
- `purchaseCostToBase(unitCost, factor)` → base-unit cost = `unitCost / factor`
  (factor = purchase-unit → base-unit conversion; e.g. sack ₱1000, 1 sack = 25 kg → ₱40/kg).
- `weightedAverage(oldQty, oldAvg, recvQty, recvCost)` →
  `(oldQty·oldAvg + recvQty·recvCost)/(oldQty+recvQty)`, rounded to 4 dp;
  if `oldQty ≤ 0` → `recvCost`. Requires `recvQty > 0`.

### `post_purchase_receipt(p_receipt_id uuid)` — SECURITY DEFINER, single transaction
1. **Idempotency:** if a `stock_transactions` row already exists with this receipt's
   `idempotency_key`, return it — no double-post.
2. For each receipt line where `accepted_qty > 0` (scenario 6 — only accepted posts):
   - Resolve base-unit cost from the PO line `unit_cost` via `unit_conversions`
     (purchase unit → base unit); convert accepted qty to base units.
   - Insert an `inventory_lots` row (branch = the `is_main` branch — the commissary; raw
     ingredients live only at Main), `qty_remaining` = accepted base qty,
     `unit_cost` = base cost snapshot, expiry/lot from the line, status available).
   - Insert a `stock_transaction_lines` row (qty = +accepted base, `unit_cost_snapshot`).
   - Upsert `inventory_balances(item, Main)` += accepted base qty.
   - **Recompute `inventory_items.weighted_avg_cost`** via the weighted-average formula
     (scenario 7). Finalized lot snapshots are never recomputed afterward.
   - Increment `purchase_order_lines.received_accepted_qty`.
3. Insert the parent `stock_transactions` row (type `purchase_receiving`, status `posted`,
   idempotency_key = receipt key, `purchase_receipt_id`).
4. Recompute PO status: `fully_received` when every line's cumulative accepted ≥ ordered, else
   `partially_received`. **Over-receipt blocked**: `accepted` may not exceed outstanding
   (`ordered − already_accepted`) — raise otherwise.
5. Mark the receipt `posted`.

### `post_supplier_return(p_return_id uuid)` — SECURITY DEFINER, single transaction
Idempotency-keyed. For each line: reduce the chosen lot's `qty_remaining` and the balance by the
qty **at the lot's cost snapshot** (weighted-average unchanged on removal — standard). Insert a
`stock_transactions` (type `supplier_return`, negative line qty) + set `payable_adjustment`.
Reject if lot `qty_remaining` < requested.

## 4. Permissions & sensitivity (rule 4)

- **Reuse:** `supplier.read/write`, `supplier_price.read` (sensitive), `cost.read` (sensitive),
  `purchase.create/approve/receive`.
- **Add one permission:** `supplier_price.write` (sensitive, Super-Admin only) — mirrors the
  existing read; seeded into `permissions` + `role_permissions` (super_admin) via migration.
- **DB-layer cost gate:** column-revoke from `authenticated` (Phase 2 technique) on
  `supplier_prices.price`, `purchase_orders.subtotal/total`, `purchase_order_lines.unit_cost`,
  `inventory_lots.unit_cost`, `stock_transaction_lines.unit_cost_snapshot`,
  `supplier_returns.payable_adjustment` (and the existing `inventory_items.weighted_avg_cost`).
- **Cost-gated read path:** a `cost.read`-gated view/RPC exposes cost columns to Super Admin —
  this is the cost view foreshadowed in Phase 2 (A-019), pulled forward for purchasing.
- **Write paths:** authenticated client + `requirePermission` (RLS backstop); multi-table posts go
  only through the SECURITY DEFINER functions (ordinary roles have no direct insert on
  lots/balances/ledger). Audits written with the service role.
- **Role reality:** managers (`purchase.create`) build POs with costs auto-filled & hidden;
  inventory staff (`purchase.receive`) record quantities/lot/expiry only; Super Admin approves POs
  (`purchase.approve`), maintains supplier prices, reviews flagged receipts, and sees costs.

## 5. Lifecycles

**PO:** `draft → submitted → approved → partially_received → fully_received → closed`;
`cancelled` from any pre-received state; manual **close** ends a PO early. Approve gated by
`purchase.approve`.

**Receipt:** created against an approved PO (`purchase.receive`); records per-line
delivered/accepted/rejected/damaged/missing + expiry + lot. Shortage/damage/price-diff set
`needs_review`; a Super Admin reviews before finalize. Clean receipts post immediately via
`post_purchase_receipt`.

**Payment:** `payment_status` on the PO with audited transitions
(unpaid → partially_paid → paid → overdue/cancelled/refunded). No AP ledger.

**Return:** select lot(s), submit → `post_supplier_return`.

## 6. UI surfaces (`app/(app)`)

- **Suppliers** (`supplier.read`/`write`) — list + create/edit; manage supplier_items.
- **Supplier prices** (Super Admin) — price history per supplier_item; add new effective price.
- **Purchase orders** — list; create draft (add items + qty; unit_cost auto-filled, shown only to
  `cost.read`); submit; approve; view with received progress.
- **Receiving** — open a receipt against an approved PO; per-line accept/reject/damage + lot/expiry;
  submit → posts. A review queue lists flagged receipts for Super Admin.
- **Supplier returns** — create a return, pick lots, submit.
- Cost columns render only for `cost.read`; nav entries gated by the relevant permissions;
  every page has loading/empty/error states; mobile-verified.

## 7. Testing → gate mapping

- **Unit** (`lib/purchasing/costing.ts`): weighted-average (first receipt / accumulation /
  zero-or-negative prior qty), purchase→base cost conversion. Covers **scenario 7** logic.
- **Integration/RLS**:
  - **Scenario 6** — a partial delivery posts only accepted quantities; PO transitions
    partially→fully; over-receipt blocked.
  - **Scenario 7** — weighted-average correct after multiple receipts at different costs.
  - Idempotent re-post of the same receipt does not double-post.
  - Cost columns denied to non-Super users; supplier-price sensitivity; supplier-price write gated.
  - Supplier return reduces the correct lot and leaves weighted-average unchanged.
- **e2e**: manager creates + submits a PO with no visible costs; inventory staff receive a partial
  delivery; permission gating for both (viewport-agnostic, per the Phase 2 e2e lesson).

## 8. Commit plan (small, verified — Phase 2 cadence)

1. **Schema** — purchasing tables + ledger core tables + enums (one migration or two).
2. **RLS + grants** — policies, `supplier_price.write` seed, column-level cost gates, cost-gated view.
3. **Posting functions + costing lib** — `post_purchase_receipt`, `post_supplier_return`,
   `lib/purchasing/costing.ts` + unit tests.
4. **Integration/RLS tests** — gate scenarios 6 & 7 + idempotency + sensitivity.
5. **Server actions + UI** — suppliers → supplier prices → POs → receiving → returns.
6. **e2e + docs** — CHANGELOG, ASSUMPTIONS, `docs/reports/PHASE_3.md`; full CI (incl. `format:check`).

## 9. Open assumptions to record (ASSUMPTIONS.md during build)

- Weighted-average is **global per item** (raw ingredients live only at Main), stored on
  `inventory_items.weighted_avg_cost`; balances remain per (item, branch).
- Supplier returns remove stock **at the lot cost snapshot**; weighted-average is unchanged on
  removal (standard weighted-average valuation).
- Receiving posts at the **PO-line (expected) cost**; genuine invoice/price differences are
  corrected by a Super Admin via a `manual_adjustment` compensating entry (not by the receiver).
- `supplier_price.write` added to the permission catalog (super_admin only).
