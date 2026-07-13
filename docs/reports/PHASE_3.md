# Phase 3 — Ingredients, Suppliers & Purchasing — End-of-phase report

Date: 2026-07-11 · Branch: `phase-3-purchasing`

## Completed work

- **Suppliers & supplier pricing** (Task 6–7): `suppliers` CRUD (contact details, lead time,
  payment terms), `supplier_items` (per-supplier SKU + pack size), `supplier_prices` as a
  SENSITIVE append-only price history (never overwritten — a new effective-dated row per change).
  Supplier list/detail UI; price history is readable/writable only through the service-role admin
  client, gated on `supplier_price.write` (super_admin only, A-024).
- **Purchase orders** (Task 8): draft → submit → approve lifecycle, line items with auto-filled
  unit cost from the supplier's latest recorded price, payment status tracking
  (unpaid/partially_paid/paid/overdue/cancelled/refunded). Subtotal/total are sensitive
  server-only columns, recomputed on each line add.
- **Receiving** (Task 4, 9): partial-delivery receiving against an approved PO, per-line
  accepted/rejected/damaged/missing quantities, lot number + expiration capture, damage/shortage
  flags for review. The receiver never sees cost. Posting is atomic and idempotent
  (`purchase_receipts.idempotency_key`).
- **Supplier returns** (Task 4, 10): lot-scoped return that removes quantity at the lot's recorded
  cost without disturbing the item's weighted-average (A-022).
- **Ledger core** (Task 1, 4): `inventory_lots` (FEFO), `inventory_balances`, and the append-only
  `stock_transactions` ledger, written only by `SECURITY DEFINER` posting functions — the browser
  never mutates quantities directly (rule 1). Global-per-item weighted-average cost
  (`inventory_items.weighted_avg_cost`) recomputed on every posted receipt (A-021).
- **Cost gates** (Task 2): `unit_cost` / `subtotal` / `total` / lot `unit_cost` / supplier `price`
  are granted to `authenticated` by explicit column-list omission (rule 4) — a `cost.read`-less
  user gets a Postgres permission-denied error reading those columns directly, not just a hidden
  UI element. `stock_transactions` and `inventory_lots` have no `authenticated` write grant at all;
  only the definer posting functions can write them.
- **Gate scenarios 6 & 7** (Task 4): proven at the DB layer with integration tests — partial
  delivery posts only accepted quantities and blocks over-receipt (scenario 6); weighted-average
  blends correctly across receipts and re-posting the same receipt is a no-op (scenario 7).
- **e2e + docs** (Task 11, this task): permission-gating e2e for the purchasing module, changelog,
  assumptions log, this report, sidebar footer bumped to "Phase 3".

## Files changed

- Migrations: `supabase/migrations/0010_purchasing_schema.sql` (tables, enums, sequences),
  `0011_purchasing_rls.sql` (RLS + column-grant gates + `supplier_price.write`),
  `0012_purchasing_functions.sql` (reference-number generators, `unit_factor_to_base()`,
  `post_purchase_receipt()`, `post_supplier_return()`).
- Lib: `lib/purchasing/costing.ts` (weighted-average TS twin), `lib/purchasing/po-status.ts`
  (status badge mapping, extracted to a server-safe module), `lib/validation/purchasing.ts` (Zod).
- Actions: `app/(app)/purchasing/suppliers/actions.ts`, `app/(app)/purchasing/orders/actions.ts`,
  `app/(app)/purchasing/receiving/actions.ts`, `app/(app)/purchasing/returns/actions.ts`.
- Pages: `app/(app)/purchasing/suppliers/page.tsx` + `[id]/page.tsx`,
  `app/(app)/purchasing/orders/page.tsx` + `[id]/page.tsx`,
  `app/(app)/purchasing/receiving/page.tsx` + `[poId]/page.tsx`,
  `app/(app)/purchasing/returns/page.tsx`.
- Components: `components/purchasing/suppliers-client.tsx`,
  `components/purchasing/supplier-detail-client.tsx`, `components/purchasing/orders-client.tsx`,
  `components/purchasing/order-detail-client.tsx`, `components/purchasing/receiving-client.tsx`,
  `components/purchasing/returns-client.tsx`; `components/app/nav.ts` (Suppliers, Purchase orders,
  Receiving, Returns links), `components/app/sidebar.tsx` (footer "Phase 2" → "Phase 3").
- Tests: `tests/unit/costing.test.ts`, `tests/integration/purchasing.test.ts`,
  `tests/e2e/purchasing.spec.ts`.
- Docs: `docs/CHANGELOG.md`, `docs/ASSUMPTIONS.md` (A-021..A-025), this report.

## Migrations created

0010 (purchasing + ledger-core schema — enums, suppliers/supplier_items/supplier_prices,
purchase_orders/lines, purchase_receipts/lines, supplier_returns/lines, inventory_lots,
inventory_balances, stock_transactions, human-reference sequences), 0011 (RLS on every purchasing
table + sensitive-column grant gates + `supplier_price.write` permission + revoked
`authenticated` writes on the ledger tables), 0012 (reference-number generator functions,
`unit_factor_to_base()`, and the two `SECURITY DEFINER` posting RPCs).

## Tests added / passed

- Unit: `costing.test.ts` — 6 (weighted-average blend arithmetic, scenario 7 groundwork).
- Integration/RLS: `purchasing.test.ts` — 6, covering:
  - Scenario 6 — partial delivery posts only the accepted quantity, PO status moves to
    `partially_received`, an over-receipt attempt is rejected, and the remainder completes the PO
    to `fully_received`.
  - Scenario 7 — weighted-average blends correctly across two receipts at different costs
    ((100×40 + 100×50)/200 = 45) and a repeat post of the same receipt is idempotent (no
    double-count of on-hand or a second blend of the average).
  - Cost-column RLS: inventory staff denied reading `purchase_order_lines.unit_cost` and
    `inventory_lots.unit_cost` directly; `supplier_price.write` denied to a branch manager.
  - Supplier return removes quantity at the lot's recorded cost and leaves the item's
    weighted-average unchanged (A-022).
- E2E: `purchasing.spec.ts` — 4, covering:
  - Inventory staff can reach `/purchasing/receiving` (heading visible) but `/purchasing/suppliers`
    redirects to `/dashboard` (no `supplier.read`).
  - Branch manager can reach `/purchasing/orders` (heading visible) but `/purchasing/receiving`
    redirects to `/dashboard` (no `purchase.receive`).
  - Desktop sidebar shows purchasing links strictly by permission for both accounts (chromium
    only; skipped on the mobile project, which uses a dropdown menu instead of the sidebar).
- Full vitest suite green (unit + integration); full Playwright suite green (chromium + mobile).

## Gate

Critical scenarios **6 (partial delivery posts only accepted quantities, over-receipt blocked)**
and **7 (weighted-average updates correctly across receipts, idempotent re-post)** pass — proven
at the DB layer in `post_purchase_receipt()` and mirrored by the `lib/purchasing/costing.ts`
TypeScript twin.

## Security posture

- **Cost gated at both UI and DB** (rule 4): sensitive columns (`purchase_order_lines.unit_cost`,
  `purchase_orders.subtotal/total`, `inventory_lots.unit_cost`, `supplier_prices.price`) are
  omitted from the `authenticated` grant at the Postgres layer — a direct `select unit_cost from
purchase_order_lines` by a non-`cost.read` role fails with a permission-denied error, not just a
  hidden table column. Every server-side read/write of a sensitive column goes through the
  service-role admin client (`lib/supabase/admin.ts`, `import "server-only"`), gated by an
  explicit `can(...)` / `requirePermission(...)` check in the calling action or page before the
  admin client is ever touched.
- **Ledger is append-only, definer-only** (rules 1, 6): `stock_transactions` and `inventory_lots`
  have no `authenticated` write grant at all — the only way to move stock is through
  `post_purchase_receipt()` / `post_supplier_return()`, both `SECURITY DEFINER`. There is no
  browser-reachable path that mutates `qty_on_hand` or `qty_remaining` directly. Corrections (e.g.
  a supplier return) are new ledger rows, never edits to a posted receipt.
- **Idempotency** (rule 5): `purchase_receipts` and `supplier_returns` each carry a unique
  `idempotency_key`; `post_purchase_receipt()` / `post_supplier_return()` no-op on a repeat key for
  the same row (proven by the scenario-7 idempotent-re-post test) rather than double-posting.
- **Historical cost snapshots** (rule 7): a purchase-order line's `unit_cost` is fixed at the time
  the line is added (from the supplier's latest recorded price) and is never recomputed after
  approval; a posted receipt's per-lot cost is likewise fixed at posting time.

## Known limitations / deferred

- **PO-totals update swallows its error.** `addPoLineAction` (`app/(app)/purchasing/orders/actions.ts`)
  recomputes and writes `purchase_orders.subtotal/total` after inserting a line, but does not check
  the result of that final `update(...)` call for an error. If that write fails, the action still
  reports "Line added." and the PO's stored totals can go stale relative to its lines. The line
  insert itself is correctly error-checked; only the totals-recompute step is not.
- **Submit/approve have no client-side double-click guard beyond `disabled={pending}`.**
  `SubmitPoButton` / `ApprovePoButton` (`components/purchasing/order-detail-client.tsx`) disable on
  `pending`, but there is a brief window before React re-renders where a very fast double-click
  could fire the action twice. In practice this is mostly caught by the DB-level status guard
  (`.eq("status", "draft")` / `.eq("status", "submitted")`, so a second call finds no matching row
  and no-ops), but unlike receiving/returns there is no `idempotency_key` on submit/approve — the
  guard is a status-equality check, not a dedicated idempotency mechanism.
- **Add-line item dropdown is unrestricted and falls back to ₱0.** The "Add line" dialog
  (`AddLineDialog` in `order-detail-client.tsx`) lists every active inventory item, not just ones
  the selected supplier is known to carry. `addPoLineAction` looks up a `supplier_items` /
  `supplier_prices` match for the chosen item + PO's supplier; if none exists, it silently defaults
  `unit_cost` to 0 rather than blocking the add or warning the approver that the line has no known
  supplier price.
- **Receiving idempotency key is regenerated per submission, not derived from a stable client
  token.** `submitReceiptAction` (`app/(app)/purchasing/receiving/actions.ts`) and the equivalent
  return action call `crypto.randomUUID()` fresh on every invocation. The DB-level idempotency
  guard in `post_purchase_receipt()` / `post_supplier_return()` protects against re-posting the
  _same_ receipt/return row (e.g. a retried RPC call), but it does not protect against a user
  double-submitting the receiving form itself — that would create two distinct receipt rows with
  two distinct keys, each of which posts independently. A production hardening pass should carry a
  client-generated idempotency token through the form (e.g. a hidden field set once on mount) so a
  genuine double-submit collapses to one receipt.
- **In-function permission check deferred in the posting RPCs** (A-025). `post_purchase_receipt()`
  and `post_supplier_return()` are `SECURITY DEFINER` and do not call `has_permission()`
  internally; they rely on RLS (the caller must be able to see the receipt/return row) plus
  `requirePermission()` in the calling server action. This is safe today because the server action
  is the only caller, but a defense-in-depth in-function check should be added if a second caller
  (e.g. a future API route or scheduled job) is introduced.
- **Invoice-difference reconciliation is not automated.** Receiving posts at the PO's expected unit
  cost (A-023); if a supplier's invoice differs from that cost, correcting the ledger is a manual
  Super-Admin follow-up this phase, not a built-in workflow.
- Only the Commissary branch practically holds purchasing-relevant stock in the current seed;
  weighted-average is computed as a global-per-item value reading branch-scoped on-hand, which is
  self-consistent for the single-branch MVP but should be revisited before a second stock-holding
  branch goes live (A-021).

## Next phase

Phase 4 — Recipes & Costing (recipe definitions, ingredient consumption, food-cost % via
`cost.read`-gated views, production order integration with the ledger core built in this phase).
