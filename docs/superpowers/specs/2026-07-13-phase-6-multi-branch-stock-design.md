# Phase 6 — Multi-branch Stock — Design Specification

Date: 2026-07-13  
Branch: `codex/phase-6-multi-branch-stock`

## Goal

Add permission-gated, multi-branch stock operations over the existing append-only ledger: direct
stock-in and stock-out, branch stock requests, FEFO/cost-preserving transfers, idempotent transfer
receiving, discrepancy records, and prominently visible Critical negative-inventory alerts.

## Scope

- Direct stock-in with optional batch/lot and expiry data.
- Direct stock-out with FEFO lot consumption and explicit operational cause.
- Stock requests from a receiving branch, with Main review and approved quantities.
- Transfer preparation, manager approval/dispatch, receiving counts, and discrepancy capture.
- Per-source-lot transfer allocations so destination lots preserve historical costs and expiry.
- Negative balances that remain exact and visible, with an active Critical alert per causing post.
- Unit, real-Postgres integration/RLS, and Playwright coverage for critical scenarios 5, 9, and 10.

Out of scope: POS/sale posting (Phase 10), recount adjustments and day close (Phase 7), popup-event
settlement (Phase 8), email delivery and notification preferences (Phase 8), and recycle-bin purge
(Phase 9).

## Negative-inventory policy

`docs/BUSINESS_RULES.md` states that negative inventory is allowed when a valid transaction posts,
but it must be Critical, investigated, prominent, never hidden, and tied to a cause. Phase 6
therefore uses **allow-with-alert** for direct stock-out:

1. The full signed quantity is appended to the ledger.
2. Available, unexpired lots are consumed FEFO down to zero; any uncovered quantity remains a
   lot-less negative ledger line valued at the protected current item average.
3. `inventory_balances.qty_on_hand` is reduced by the full quantity and is never clamped.
4. If the result is negative, an `inventory_alerts` row with severity `critical`, the exact balance,
   branch, item, cause transaction, actor, and reason is created in the same transaction.
5. The stock overview displays negative balances and active alerts first, with a Critical badge.

Transfers do not use the negative-stock allowance. They require real eligible source lots because
the destination must inherit concrete FEFO lot costs and expiry. Insufficient source lots reject the
whole approval transaction.

## Domain model

### Stock requests

`stock_requests` stores a human reference, requesting branch, status, notes, requester, and review
history. `stock_request_lines` stores requested and approved base-unit quantities. The lifecycle is
`requested → approved → fulfilled`; a manager may reject or an operator may cancel before
fulfilment. `stock.transfer.prepare` creates requests and `stock.transfer.approve` reviews them.

### Transfers

`transfers` stores source/destination branches, optional approved request, stable prepare key,
correlation ID, lifecycle actors/timestamps, and source/destination ledger links. `transfer_lines`
stores prepared, shipped, received, rejected, damaged, and missing quantities in base units.

Lifecycle:

| Action              | Permission               | State change                  | Inventory effect      |
| ------------------- | ------------------------ | ----------------------------- | --------------------- |
| Prepare             | `stock.transfer.prepare` | new `prepared` transfer       | none                  |
| Approve/dispatch    | `stock.transfer.approve` | `prepared → in_transit`       | FEFO source deduction |
| Receive             | `stock.transfer.receive` | `in_transit → received`       | destination addition  |
| Resolve discrepancy | `stock.transfer.approve` | discrepancy `open → resolved` | none                  |

`transfer_lot_allocations` freezes the lot ID, source lot metadata, allocated quantity, and
sensitive unit-cost snapshot at approval. Receiving walks those allocations deterministically,
creates destination lots for accepted quantities at the same cost/expiry, and links each created
lot back to its allocation. Source and destination `transfer` transactions share a correlation ID.

Receiving quantities must account for every shipped unit:
`received + rejected + damaged + missing = shipped`. Any non-received quantity requires a reason
and creates an open `transfer_discrepancies` row. A manager may later record its resolution; the
posted ledger is never edited.

### Inventory alerts

`inventory_alerts` is a non-cost-bearing operational table with severity fixed to `critical` for
Phase 6 negative-inventory alerts. It records item, branch, exact observed balance, cause
transaction, reason, actor, timestamps, and optional resolution. Direct authenticated writes are
absent; stock posting functions create alerts. Reads require a stock operation permission or
`catalog.item.read` and remain subject to RLS.

## Direct stock operations

`post_stock_in(branch, reason, notes, idempotency_key, lines)` and
`post_stock_out(branch, reason, notes, idempotency_key, lines)` are `SECURITY DEFINER`, use
`set search_path = public`, validate `auth.uid()` permissions internally, take advisory locks on
stable idempotency keys, and return the original transaction on replay.

Stock-in requires positive base-unit quantities. Batch/expiry-tracked items require the applicable
lot and expiry fields. The lot cost is resolved internally from the protected item average; stock
operators never submit or see cost. Raw ingredients may be stocked only at Main.

Stock-out requires positive base-unit quantities and a nonblank operational cause. It consumes
eligible lots FEFO, skips expired/quarantined lots, writes negative per-lot ledger lines, and uses a
lot-less line for any negative remainder. It is a generic operational stock removal, not a sale or
recipe deduction path; Phase 10 owns POS posting.

## Atomicity and idempotency

Every stock-affecting operation is one database function/transaction. Relevant parent rows and
eligible lots are locked `FOR UPDATE`; failures roll back lots, balances, ledger, alerts, transfer
state, and discrepancies together.

- Direct stock-in/out use the client-generated key directly on `stock_transactions`.
- Transfer prepare has a stable unique key on `transfers`.
- Approval uses a deterministic `<prepare-key>:source` transaction key.
- Receive accepts its own stable client-generated key, stores it on the transfer and destination
  transaction, and checks it before status validation. Repeating the same receive returns the
  existing destination transaction without adding lots, balances, ledger lines, or discrepancies.
- A different receive key after completion fails loudly.

## Authorization and RLS

Server pages use `getAuthContext`/`can`; Server Actions call `requirePermission`; mutations use the
session Supabase client so database functions see the real `auth.uid()`. Functions repeat the
permission check. RLS is enabled on every new table.

Authenticated users receive no direct insert/update/delete grants on lots, balances, ledger,
transfer allocations, or alerts. Transfer/request lifecycle tables expose only permission-appropriate
rows/actions. Sensitive allocation and cost columns are omitted from authenticated grants. The
service-role client is not used by Phase 6 browser or action code.

## Cost preservation

Transfer approval consumes FEFO source lots that are available, positive, and unexpired on the
Asia/Manila business date. Each allocation freezes the source lot cost. Receiving copies accepted
allocation quantities into destination lots and positive ledger lines at that exact cost. Direct
stock operators do not read or render any cost. Phase 6 does not recompute the global
`weighted_avg_cost` merely because stock moves between branches; a transfer changes location, not
enterprise valuation.

## UI

- `/stock` shows branch/item balances (including negatives), active Critical alerts, and role-gated
  stock-in/out forms with readable branches, names, SKUs, units, lots, and expiry.
- `/stock/requests` lists requests and supports create/review with readable item and branch labels.
- `/stock/transfers` lists the lifecycle and supports preparation.
- `/stock/transfers/[id]` supports manager approval, inventory receiving counts/reasons, and
  discrepancy resolution. A stable receive token is owned by the client form.
- Loading, empty, success, warning, and error states are present; raw UUIDs and cost values are not
  rendered.

## Critical gate mapping

- **Scenario 5 — duplicate receive:** a real integration test approves a transfer, receives it twice
  with the same key, and asserts identical destination transaction ID, unchanged destination lots
  and balance, and unchanged ledger/discrepancy counts.
- **Scenario 9 — prepared sale inputs:** a real integration assertion retains the Phase 4 database
  trigger rejection for raw inputs in sale recipes. No Phase 6 operation is typed as `pos_sale` or
  accepts a sale recipe, so no alternate raw-on-sale path is introduced.
- **Scenario 10 — negative visible + Critical:** a real integration test posts a stock-out greater
  than eligible lots, asserts the exact negative balance and signed ledger quantity, and reads the
  associated active Critical alert through an authorized session. UI/E2E coverage asserts the
  Critical indicator and negative quantity remain visible.

Additional integration coverage verifies transfer FEFO, expired-lot exclusion, cross-branch cost
preservation, lifecycle/status guards, discrepancy creation, and role permission denial.
