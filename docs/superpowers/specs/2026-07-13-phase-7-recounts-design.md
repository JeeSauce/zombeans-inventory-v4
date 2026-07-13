# Phase 7 — Recounts & Daily Operations — Design Specification

Date: 2026-07-13

Branch: `codex/phase-7-recounts`

## Goal

Add permission-gated daily inventory control over the existing append-only ledger: required
start-of-day recounts, optional end-of-day and cycle counts, frozen expected/physical variances,
reason-backed compensating adjustments, branch business-date closing, and audited Super Admin
reopening. Critical scenarios 11, 12, and 13 must pass against local Postgres.

## Baseline

Phase 7 starts at merged `origin/main` commit `3e6b3a5`. Before this specification was written:

- the local Supabase API and Postgres services were healthy;
- all 89 Phase 1–6 Vitest assertions passed, including real-Postgres integration tests; and
- the production build completed with all 25 Phase 6 routes.

## Scope

- One required full start-of-day recount per branch and Asia/Manila business date.
- Optional full end-of-day recounts and item-selected cycle counts.
- Frozen expected-quantity components, physical quantity, variance quantity, cost snapshot, and
  variance value per recount line.
- Ordinary and unusual-variance classification with visible, cost-free warning signals.
- One reason-backed, idempotent, compensating ledger adjustment per submitted variance session.
- Per-branch business-date close state with unresolved-work checks.
- Idempotent Super Admin reopening with a nonblank reason, an append-only audit event, and explicit
  attribution of later ledger changes to the latest reopen event.
- Unit, real-Postgres integration/RLS, and Playwright coverage for critical scenarios 11–13.

Out of scope: offline recount synchronization/conflict handling (Phase 10), notification delivery
(Phase 8), POS usage posting (Phase 10), manual non-recount adjustment requests, configurable item
overrides for unusual thresholds, and historical back-dated posting.

## Business date and expected quantity

All business dates and day boundaries use `Asia/Manila`; timestamps remain UTC. A recount captures
one immutable `snapshot_at` timestamp. Expected quantities are computed only from posted ledger
lines whose transaction timestamp is at or before that cutoff.

For each branch/item line:

```text
expected quantity
  = opening quantity
  + received
  + production output
  − transfers out
  − usage
  − stock-outs
  − waste
```

The components have these exact meanings:

- **Opening quantity:** the signed sum of posted ledger lines for the branch/item before the
  Asia/Manila start of the business date.
- **Received:** purchase receiving, direct stock-in/batch stock-in, positive inbound transfer, and
  positive earlier recount/manual corrections posted during the business date.
- **Production output:** positive `production_output` lines during the business date.
- **Transfers out:** the absolute value of negative `transfer` lines from the branch during the
  business date.
- **Usage:** the absolute value of `production_consumption`, `supplier_return`, `pos_sale`, and
  other consumption-class lines during the business date. POS lines are included now so the
  formula remains correct when Phase 10 adds them.
- **Stock-outs:** the absolute value of direct `stock_out`/`batch_stock_out` lines during the
  business date, plus negative earlier recount/manual corrections.
- **Waste:** the absolute value of `waste` lines during the business date.

`opening + components` must equal the branch/item ledger sum at `snapshot_at`. The open RPC rejects
the session if the classified components do not reconcile to that ledger total. This makes the
formula testable and prevents a newly introduced transaction type from silently disappearing from
expected stock.

The expected quantity and every component are frozen on the recount line. Later ledger activity
never changes a submitted or adjusted recount. Start-of-day is operationally required and visibly
overdue until completed; `close_day` is the database enforcement point and refuses to close a date
without a terminal start-of-day session. Existing Phase 1–6 stock workflows therefore remain
usable while a late start count is being resolved, but the business date cannot be completed
without it.

## Domain model

### Recount sessions and lines

`recount_sessions` stores a human reference, branch, business date, type, lifecycle status, stable
open/submit keys, snapshot time, actors/timestamps, unusual summary, and optional latest reopen
event attribution. Types are `start_of_day`, `end_of_day`, and `cycle`; statuses are `draft`,
`submitted`, `adjusted`, and `closed`.

Full start/end sessions snapshot every active, trackable item allowed at the branch. Raw ingredients
are excluded outside a branch configured to hold raw stock. Cycle sessions require an explicit,
nonempty, duplicate-free item list and snapshot only those items.

`recount_lines` stores the opening and movement components, frozen expected quantity, nullable
physical quantity, variance quantity, unusual-signal codes, and sensitive unit-cost/variance-value
snapshots. Quantities are normalized base units at four decimal places. Physical counts cannot be
negative.

Lifecycle:

| Action                  | Required permission                    | State change               | Inventory effect          |
| ----------------------- | -------------------------------------- | -------------------------- | ------------------------- |
| Open full/cycle recount | `recount.perform`                      | new `draft`                | none                      |
| Submit physical counts  | `recount.perform`                      | `draft → submitted/closed` | none                      |
| Post ordinary variance  | `recount.perform` or `recount.confirm` | `submitted → adjusted`     | compensating ledger entry |
| Post unusual variance   | `recount.confirm_unusual`              | `submitted → adjusted`     | compensating ledger entry |

A zero-variance submission becomes terminal `closed` immediately. A nonzero submission becomes
`submitted` until its one adjustment posts, then becomes terminal `adjusted`. A partial unique index
permits only one `draft`/`submitted` session per branch/date/type; terminal cycle counts may be
repeated later in the same date.

### Variance adjustments

`variance_adjustments` stores one human-referenced adjustment per recount session, the required
reason type and nonblank explanation, stable idempotency key, unusual status, posting actor/time,
linked `recount_adjustment` stock transaction, and reopen attribution. It does not replace or edit
the recount line or any earlier ledger row.

The posting RPC creates one new stock-transaction header and signed lines equal to each nonzero
`physical − expected` variance, updates the balance projection by the same net quantities, and
sets the session to `adjusted` in one transaction. Negative corrections consume existing lots
deterministically (FEFO, including expired/quarantined stock because a physical recount reconciles
all on-hand stock) before using a lot-less negative remainder. Positive corrections create a
traceable recount-origin lot at the frozen unit cost so later FEFO operations can consume the
physical gain. No existing lot cost, finalized transaction, or ledger line is rewritten.

### Daily close state and events

`daily_operational_closures` has one row per branch/business date and stores the current state,
latest close/reopen actors and timestamps, event counters, and latest event. `day_close_events` is
an append-only history of every `close` or `reopen` command with a unique idempotency key, actor,
reason where required, and linked `audit_logs` row.

`close_day` requires `recount.confirm`, branch access, a terminal start-of-day recount, no draft or
submitted recount, and no unresolved variance. It is idempotent and moves the date to `closed`.
Optional end-of-day recount is not required, but if opened it must be resolved before close.

`reopen_day` requires `closure.reopen` (Super Admin only), a nonblank reason, and a closed date. It
is idempotent, creates the append-only event and audit row atomically, and moves the date to
`reopened` (operationally open). A later close may close it again.

Every new stock transaction carries nullable `day_reopen_event_id`. A database guard rejects any
stock posting for a closed source/destination branch date; after reopening, it assigns the latest
reopen event automatically. Recount sessions and variance adjustments opened after reopening carry
the same attribution. The Daily Ops UI can therefore show the reopen reason/actor and every later
recount adjustment or ledger reference without inference from timestamps.

## Cost preservation and sensitive data

At recount open, each line resolves the most recent posted `stock_transaction_lines.unit_cost_snapshot`
for that branch/item at or before `snapshot_at`. That existing finalized value is copied once to
the recount line. If an item has never had a posted cost snapshot, the frozen value is zero and the
line receives a `missing_cost_snapshot` unusual signal; no current cost is invented.

On submit, `variance_value_snapshot = round(variance_qty × unit_cost_snapshot, 4)`. Adjustment
ledger lines copy the same frozen unit cost. Replays and later changes to item averages, supplier
prices, recipes, lots, or thresholds do not recalculate it.

Authenticated grants omit `unit_cost_snapshot`, `variance_value_snapshot`, adjustment total value,
and ledger cost columns. Ordinary RPC return types and all browser queries contain only quantities,
status, human references, reason labels, and unusual signal codes. Super Admin cost access remains
on existing server-only/cost-gated surfaces; Phase 7 UI intentionally renders no costs for any role.

## Unusual-variance signals

Pure TypeScript helpers and SQL posting logic use the same frozen inputs and configurable global
thresholds. A session is unusual if any nonzero line has one or more of:

- absolute variance percentage at or above 10% of nonzero expected quantity;
- nonzero variance when expected quantity is zero;
- absolute frozen variance value at or above ₱5,000;
- missing existing cost snapshot;
- the resulting balance would be negative;
- the recount/adjustment occurs after a day reopen; or
- the same employee reaches three posted recount adjustments in seven days.

The percentage, peso, count, and window defaults extend the existing `thresholds` application
setting and are recorded as assumptions. Signal codes are non-sensitive; peso values and thresholds
are never returned to the browser. The submit decision is frozen so a later settings change cannot
change who was required to approve an already submitted variance.

## Atomicity and idempotency

`open_recount`, `submit_recount`, `post_recount_adjustment`, `close_day`, and `reopen_day` are
`SECURITY DEFINER`, set `search_path = public`, validate `auth.uid()` permissions and branch access
internally, and take stable form tokens. Each acquires an advisory lock on the token, checks an
existing durable key before lifecycle guards, and returns the original result on a valid replay.
A different key against a terminal or stale lifecycle fails loudly.

Relevant sessions, closures, balances, and lots are locked `FOR UPDATE`. Any error rolls back the
session state, ledger, balance, lots, close event, and audit row together.

## Closed-day enforcement

The database is the authoritative gate:

- all Phase 7 functions call a shared day-open assertion;
- a stock-transaction insert guard blocks every Phase 1–7 inventory posting while the relevant
  branch/date is closed, including calls through older definer functions;
- direct authenticated writes to recount, adjustment, close-state, close-event, balance, and
  ledger tables have no grants/policies; and
- Server Actions repeat `requirePermission`, return a clear stale/closed-day error, and never use
  the service-role client for Phase 7 RPCs.

Reopening is the only supported way to permit later inventory changes. Being Super Admin does not
bypass a closed day; the administrator must reopen it with a reason first.

## Authorization and RLS

RLS is enabled on every new table. Read policies require both a relevant recount permission and
branch access. Child-table policies inherit visibility through the authorized parent. Authenticated
users receive column-level reads for non-sensitive recount fields only and no direct DML. Definer
functions and the service role own writes.

- Inventory Staff and Branch Manager may open/submit recounts and post ordinary adjustments.
- Branch Manager and Super Admin may close a ready day.
- Only Super Admin may post an unusual adjustment or reopen a day.
- Production Staff has no recount navigation and is redirected from Daily Ops.
- `audit_logs` remains readable only with `audit.read`; Daily Ops exposes a narrow non-sensitive
  reopen-event projection to authorized operational users.

## Server Actions and UI

Phase 7 uses the session Supabase client so database functions see the real actor. Stable form
tokens survive retries for recount open/submit, adjustment, close, and reopen. Actions validate
with Zod, call the explicit permission gate, write cost-free audit events for non-replayed actions,
return `{ error?, info? }`, and revalidate Daily Ops and Stock paths.

`/daily-ops` provides:

- a required/complete/overdue start-of-day card;
- per-item expected and physical entry with live quantity variance;
- cycle-count item selection and optional end-of-day recount;
- submitted-variance review with mandatory reason and clear unusual escalation cues;
- day-close readiness with blocking unresolved-work summaries;
- Super Admin reasoned reopen; and
- visible reopen history and human-reference links for later attributed changes.

Loading, empty, success, warning, stale-action, closed-day, and permission-denied states are
explicit. Forms close only after action success. Item names/SKUs, branch names, units, and human
references are shown; raw UUIDs, costs, variance values, and threshold peso amounts are absent.

## Critical gate mapping

- **Scenario 11 — recount variance creates the correct adjustment:** a real integration test opens
  a recount over known opening and categorized ledger movements, asserts every expected component
  and the exact formula, submits a four-decimal physical count, posts the required reason-backed
  adjustment, and asserts `variance = physical − expected`, balance delta equals the variance,
  ledger lines net exactly to the variance at the frozen cost snapshot, replay adds nothing, and no
  previously posted row changed. A separate case proves an unusual signal rejects ordinary staff
  and succeeds for Super Admin.
- **Scenario 12 — closed days reject ordinary writes:** an authorized manager closes a ready day;
  Inventory Staff then receives a closed-day error from a normal stock posting RPC and cannot
  directly insert/update Phase 7 rows through RLS/grants. Counts of ledger/recount rows and the
  balance remain unchanged.
- **Scenario 13 — reasoned audited Super Admin reopen:** blank reason is rejected, a non-Super-Admin
  is rejected, and Super Admin reopening writes exactly one idempotent close event plus one audit
  row containing actor, branch/date, and reason. A later compensating entry carries that reopen
  event ID; its human reference appears in the authorized reopen audit trail.

Additional coverage verifies one-open-session uniqueness, full versus cycle item selection,
four-decimal boundaries, zero-variance closure, stale lifecycle guards, permission/branch denial,
cost-column denial, threshold boundaries, day-close blockers, idempotent replay, and Phase 1–6
regression behavior.
