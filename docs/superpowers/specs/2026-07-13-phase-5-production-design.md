# Phase 5 — Production — Design Specification

Date: 2026-07-13  
Branch: `codex/phase-5-production`

## Goal

Add a permission-gated production workflow that turns active production recipe versions into
planned orders, records actual input, waste, output batch, and expiry data, and posts every stock
movement atomically through the append-only ledger. Production must preserve the recipe version's
immutable activation cost snapshot and must never consume an expired or unavailable lot.

## Scope

- Reusable production templates linked to `production` recipes.
- Production orders with planned versus actual output and input quantities.
- Draft, start, record, submit, confirm, and cancel lifecycle controls.
- Output batch/expiry capture, yield and waste warnings, and manager confirmation.
- FEFO lot allocation at confirmation time.
- Atomic consumption, waste, output-lot, balance, ledger, and order completion posting.
- Stable idempotency keys from the client through the posting function.
- Unit, integration/RLS, and E2E coverage for the Phase 5 permissions and critical scenarios 2–4.

Out of scope: transfers and negative-stock alerts (Phase 6), recount/day close (Phase 7), and POS
imports (Phase 10).

## Domain model

### `production_templates`

Templates provide an operational name and defaults over an existing production recipe:

- `recipe_id` identifies a `recipes.kind = 'production'` recipe.
- `name`, optional `instructions`, `default_batch_multiplier`, and `default_expiry_days` provide
  safe defaults without copying recipe composition.
- `active`, audit columns, optimistic `version`, and soft-delete columns follow repository
  conventions.

The active recipe version is resolved when an order is created. A template does not silently
change an existing order when a later recipe version is activated.

### `production_orders`

- Human `reference` and unique stable `idempotency_key`.
- `template_id`, immutable `recipe_version_id`, `cost_snapshot_id`, `branch_id`, and output item.
- `planned_output_qty`, `actual_output_qty`, output lot number, production/expiration dates.
- Lifecycle status: `draft → in_progress → awaiting_confirmation → completed`; cancellation is
  allowed before confirmation.
- Actors/timestamps for creation, start, recording, submission, and confirmation.
- `production_output_txn_id` links the completed order to its output ledger transaction.

Orders are editable only before submission. Completed/cancelled orders are immutable. The branch
is Main for Phase 5, consistent with the raw-ingredient and production business rules.

### `production_order_inputs`

Each row is a frozen copy of an active recipe line at order creation:

- `item_id`, `unit_id`, `planned_qty` scaled by the requested batch multiplier.
- `actual_consumed_qty` and `waste_qty` recorded in normalized base units.
- `recipe_line_id` retains traceability to the source version.

The posting function validates the copied item/unit against the linked active version and rejects
non-positive output or negative actual quantities.

## Lifecycle and authorization

| Action                   | Required permission  | Status transition                      |
| ------------------------ | -------------------- | -------------------------------------- |
| Create template/order    | `production.create`  | new order is `draft`                   |
| Start and record actuals | `production.record`  | `draft → in_progress`                  |
| Submit for confirmation  | `production.record`  | `in_progress → awaiting_confirmation`  |
| Confirm and post         | `production.confirm` | `awaiting_confirmation → completed`    |
| Cancel before posting    | `production.create`  | draft/in-progress/awaiting → cancelled |

Server Actions check permissions and validation. RLS is the backstop for reads and pre-post
mutations. A trigger rejects invalid direct status transitions and all mutation after terminal
states. The posting function independently checks `production.confirm` using `auth.uid()`.

## Planning and actuals

At order creation the server resolves the template's single active production recipe version and
its activation snapshot. Planned output and every input line are scaled by a positive batch
multiplier. The resulting order remains tied to those immutable records.

Actual input and waste quantities are recorded separately. Actual output, lot number, production
date, and expiration date are mandatory before submission. Expiration cannot precede production.
Warnings are derived from planned versus actual data: low yield, over-usage, and waste above the
recipe's expected percentage. Warnings do not weaken authorization; manager confirmation remains
required.

## Atomic posting and FEFO

`post_production_completion(p_production_order_id uuid)` is a `SECURITY DEFINER` function with
`set search_path = public` and execute granted only to `authenticated`/`service_role`.

In one database transaction it:

1. Requires `production.confirm`, locks the order `FOR UPDATE`, and returns the existing output
   transaction when the order is already completed.
2. Validates `awaiting_confirmation`, actual fields, recipe version/snapshot linkage, and Main
   branch.
3. For every actual consumption and waste quantity, locks eligible lots in FEFO order:
   `status = 'available'`, `qty_remaining > 0`, and expiration null or not before the current
   Asia/Manila business date. Expiration sorts ascending with nulls last.
4. Raises on insufficient eligible stock. Any deductions made earlier in the function roll back.
5. Writes negative per-lot `production_consumption` and `waste` ledger lines, decrements lots and
   balances, creates the output lot and positive `production_output` line, increments the output
   balance, and completes the order.

No browser code inserts or updates lots, balances, or ledger rows. Direct authenticated grants for
those writes remain absent.

## Idempotency

The completion form owns one client-generated UUID for the logical order. `production_orders`
enforces it as unique. Derived ledger keys (`:consumption`, `:waste`, `:output`) are deterministic.
After a successful post, replay locks the completed order and returns its existing output
transaction without changing lots, balances, or ledger rows.

## Cost preservation

Order creation attaches the activation-time `cost_snapshots` row for its recipe version. Cost
values are never exposed through production tables or UI. The output lot cost uses the frozen
snapshot batch cost scaled to the order and divided by actual output, preserving the historical
input snapshot while applying the business rule for actual-output yield. Existing authenticated
cost-column revokes on lots and ledger lines remain in force.

## UI

- `/production` lists templates and orders with readable references, recipe/output names, status,
  planned/actual quantities, warning badges, and role-appropriate actions.
- `/production/new` creates an order from an active template and stable idempotency token.
- `/production/[id]` records actual inputs, waste, output batch/expiry, starts/submits the order,
  and exposes confirmation only to `production.confirm`.
- Loading, empty, success, warning, and error states are present. No raw UUID or cost value is
  rendered.

## Critical gate mapping

- **Scenario 2 — expired stock:** integration coverage creates expired, quarantined, later-expiry,
  and earlier-expiry lots; posting uses eligible lots in FEFO order and refuses a requirement that
  can only be satisfied by expired/unavailable stock.
- **Scenario 3 — atomicity:** integration coverage makes the first input sufficient and a later
  input insufficient, asserts the RPC fails, then proves every lot, balance, order, and ledger row
  remains unchanged.
- **Scenario 4 — idempotency:** integration coverage calls completion twice and asserts identical
  transaction identity with exactly one deduction/output and unchanged second-call counts.

## Recorded assumptions

Phase 5 decisions are recorded in `docs/ASSUMPTIONS.md`: templates wrap production recipes;
confirmation is the posting boundary; output unit cost uses the frozen snapshot with actual-yield
division; expiration uses the Asia/Manila business date; and Phase 5 production is Main-only.
