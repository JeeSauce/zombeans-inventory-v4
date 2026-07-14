# Phase 8 — Calendar, Popup Events, Notifications, Dashboard — Design Specification

Date: 2026-07-14

Branch: `codex/phase-8-calendar-notifications`

## Goal

Add an operational calendar, popup engagement sessions, deduplicated in-app and email
notifications, and a role-filtered analytics dashboard over the existing append-only inventory
ledger. The Phase 8 gate must pass against local Postgres: notification deduplication/severity and
dashboard financial role-gating.

## Baseline

Phase 8 starts from merged `origin/main` commit `fd447ec`, which includes Phase 7. Its end-of-phase
report records 47 unit tests, 51 real-Postgres integration tests, 26 application routes, 85 scanned
client bundle files, and 53 full Playwright tests with 5 intentional mobile skips.

## Scope

- Targeted notifications with Critical, Warning, and Info severity; stable active deduplication;
  per-user read and acknowledgement state; append-only events; in-app/email delivery tracking.
- Producers for negative inventory, expired lots, overdue start-of-day recounts, unusual recount
  variances, failed production, low/out-of-stock balances, and pending stock requests.
- A server-only, provider-neutral email outbox and transport. Local development uses the existing
  console transport; a delivery is claimed and finalized idempotently.
- A role-filtered dashboard with operational KPIs, alerts, recent activity, and upcoming events.
  Inventory valuation is isolated behind a separate `cost.read`-gated database function.
- An Asia/Manila operational calendar with month, week, and agenda views. Super Admin and Branch
  Manager may create/edit; other authenticated roles are read-only.
- Popup engagement sessions linked to calendar events, optional popup transfers, remaining-stock
  counts, ledger-backed consumed/waste/loss/gain/return links, and an event inventory summary.
- Zod validation, Server Actions, RLS, audit logging, responsive real-data UI states, unit,
  integration, authorization, and Playwright coverage.

Out of scope: external SMTP/Resend credentials, scheduled/background job infrastructure, arbitrary
user notification preferences, SMS/push delivery, recurring calendar rules, drag-and-drop calendar
editing, POS usage import, and Phase 9 report/export formats.

## Notification domain model

### Notifications and append-only history

`notifications` is the current operational alert row. It stores severity, source type, safe title
and message, entity type/ID, optional branch/role/user target, a stable dedup key, active/resolved
status, first/last raised timestamps, raise count, and resolver metadata. A partial unique index on
`dedup_key WHERE status = 'active'` is the database guarantee against duplicate active alerts.

`raise_notification()` is the only creation path. Under an advisory lock it either creates the
active row or refreshes the existing row's severity, safe copy, target, and `last_raised_at`, then
increments `raise_count`. Every raise/re-raise, resolve, read, acknowledgement, delivery claim, and
delivery result also writes a `notification_events` append-only row. Current-state rows may change;
their history never does.

`notification_receipts` stores user-specific `read_at` and `acknowledged_at` state because a
branch/role notification can target multiple people. Mark-read and acknowledge functions are
idempotent, target-aware, and never resolve the underlying condition. A Critical alert remains
active and prominent even after acknowledgement.

### Target visibility

A notification can target one or more of:

- one user (`target_user_id`);
- one role (`target_role_id`);
- one branch (`target_branch_id`); or
- all authenticated users when all three are null.

Visibility requires every populated target dimension to match the current user. Branch matching
uses `has_branch_access`; role matching uses `user_roles`. RLS applies the same helper to
notifications, receipts, events, and delivery metadata. Operations UI receives title, message,
severity, safe human entity reference, and timestamps; it never renders entity UUIDs, costs, or
peso thresholds.

### Severity mapping and producers

The mapping is deterministic and covered in pure helpers plus real-Postgres tests:

| Condition                          | Severity | Target                  | Email |
| ---------------------------------- | -------- | ----------------------- | ----- |
| Negative inventory                 | Critical | affected branch         | yes   |
| Expired lot with positive quantity | Critical | affected branch         | yes   |
| Failed production                  | Critical | production branch       | yes   |
| Overdue start-of-day recount       | Warning  | affected branch         | no    |
| Unusual submitted recount variance | Warning  | Super Admin role        | no    |
| Out-of-stock tracked item          | Warning  | affected branch         | no    |
| Pending stock request              | Warning  | Main/manager operations | no    |
| Low stock above zero               | Info     | affected branch         | no    |

Each key represents the underlying condition, for example
`negative-inventory:<branch>:<item>` or `failed-production:<order>`. Re-running producers updates
the active row instead of creating another. Resolved conditions may later raise a new active row
with the same key, preserving the earlier resolved history.

Negative inventory synchronizes immediately from the existing `inventory_alerts` row through a
database trigger. `refresh_operational_notifications()` discovers all other current conditions and
is safe to call on page loads and after relevant Server Actions. This phase does not assume a job
runner; production deployment should invoke the same function from a scheduler for time-based
conditions.

### Email delivery

`notification_deliveries` is an outbox with a unique `(notification_id, channel, recipient)` key,
status, attempts, claim token/time, provider message ID, delivered/failed timestamps, and a safe
error. Critical raises enqueue one email per visible active recipient; upsert/replay never creates a
second delivery.

Only a module guarded by `import "server-only"` may claim and send email. It calls the existing
email transport, then finalizes the claim through database functions. Browser modules never import
the service-role client or transport and never receive delivery addresses. Local console delivery
has the same claim/finalize semantics as a production provider.

## Dashboard

### Operational analytics

`get_dashboard_operational(start, end, branch, category, item_type)` is an authenticated,
branch-aware `SECURITY DEFINER` function returning only non-cost data:

- low-stock and out-of-stock counts;
- today's production count/output summaries;
- pending stock-request count;
- branch stock-level summaries by tracked item count and negative count;
- most-used ingredients by normalized quantity and unit (never sums unlike units into money);
- recent human-referenced movements;
- active Critical negative inventory and failed production;
- submitted recount variance summaries; and
- upcoming calendar events.

Date range, branch, category, and item-type filters are validated before query use. A requested
branch must pass `has_branch_access`. Global results include only rows from accessible branches.

### Financial analytics boundary

`get_dashboard_financials(branch, category, item_type)` is a separate `SECURITY DEFINER` function
that first requires `cost.read` and then returns current inventory value from balance quantity ×
the protected weighted-average cost. The operational RPC never selects or returns any cost-derived
field. The UI calls the financial RPC and renders its card only when `cost.read` is present.

The role-gating gate signs in as each non-Super role and proves a direct API call to the financial
RPC fails, while the operational RPC succeeds within branch scope. It also proves Super Admin sees
the exact valuation. This is DB enforcement, not merely a hidden card.

## Calendar

`calendar_events` stores a human reference, safe title/description/location, event type, status,
optional branch, UTC start/end timestamps, `Asia/Manila` display timezone, creator/updater, stable
create/edit idempotency keys, and version. Timestamps must have `end_at > start_at`.

All authenticated roles may read events that are global or in an accessible branch. Direct writes
are denied. `create_calendar_event()` and `update_calendar_event()` are `SECURITY DEFINER`, require
`calendar.manage` internally, validate branch access, lock the idempotency token and row, enforce
optimistic versioning on edit, and write an audit row in the same transaction. The Server Actions
repeat `requirePermission("calendar.manage")` and Zod validation.

The browser presents month, week, and agenda projections of the same real event rows. Form input is
interpreted in Asia/Manila and stored as UTC. Read-only users see details but no mutation controls.

## Popup event sessions

Zombeans Popup remains a permanent branch. `popup_event_sessions` represents one engagement and is
one-to-one with a `calendar_events(type = 'popup')` row. It records the Popup branch, the Main
return branch, planned/in-progress/reconciling/completed/cancelled lifecycle, opening/final count
timestamps, actors, notes, and completion idempotency key.

`transfers.popup_event_id` optionally links a normal transfer to the session. Linking validates
that one endpoint is the Popup branch, the other is the session's return branch, and the transfer
has not completed. Transfer approval and receipt remain the existing Phase 6 atomic functions with
their original idempotency and append-only ledger behavior.

`popup_event_count_lines` records each item's transferred-in, physical remaining, planned return,
consumed, waste, loss, and gain quantities. `popup_event_movements` links the summary category to an
already-posted stock transaction or received transfer. The completion function never changes a
balance and never writes a ledger row. It verifies that every nonzero summary quantity is backed by
linked existing Phase 6 stock/transfer movements, then freezes the summary and completes the
session. Stock changes therefore remain exclusively inside the established atomic posting
functions; the popup browser UI cannot create a second mutation path.

All create, edit, link, count, and completion functions require `calendar.manage`, check branch
access, use stable idempotency keys, lock lifecycle rows, and audit successful first execution.
Calendar readers may view safe popup summaries through RLS but cannot write them.

## Atomicity and idempotency

- Every Phase 8 mutation function is `SECURITY DEFINER`, sets `search_path = public`, checks the
  real `auth.uid()` and permission/target/branch scope internally, and revokes public execution.
- Stable form tokens are protected by unique constraints plus transaction-scoped advisory locks.
  Replay lookup occurs before stale lifecycle/version checks and returns the original result.
- Notification raise/upsert, event history, recipient outbox creation, and producer-side audit
  commit or roll back together.
- Calendar/popup lifecycle changes and their audit rows commit or roll back together.
- Popup completion does not post stock; it only freezes a summary after validating links to
  existing idempotent, ledger-backed movements.
- Posted stock transactions, ledger lines, notification events, and calendar/popup audit history
  are append-only. No Phase 8 function edits finalized ledger or cost snapshots.

## Authorization, RLS, and sensitive data

RLS is enabled on every new table. Authenticated users receive safe column-level reads and no
direct DML. Parent visibility helpers scope child notification and popup tables. Service role is
reserved for recipient expansion/email delivery and never reaches client code.

- All signed-in roles read applicable calendar events and targeted notifications.
- Only Super Admin and Branch Manager hold `calendar.manage` and may mutate calendar/popup data.
- A user may mark only their own visible notification receipt read/acknowledged.
- `cost.read` is required inside the dashboard financial RPC; raw weighted costs remain revoked.
- Notification delivery recipients/provider metadata are server-only.
- Dashboard and notification output use human references, names, SKUs, quantities, and safe signal
  labels. Raw UUIDs, costs, supplier data, and threshold peso values are absent from unauthorized UI.

## Server Actions and UI states

Server Actions validate all input with Zod, repeat permission checks, use the session client for
actor-aware RPCs, drain email only from server-only code after critical producers, and revalidate
affected routes. They return explicit `{ error?, info? }` state and never close forms on failure.

Major pages `/dashboard`, `/calendar`, `/popups`, `/popups/[id]`, and `/notifications` include
loading skeletons plus explicit empty, success, warning, and error states. Calendar/popups show
Asia/Manila dates; dashboard filters are labelled and keyboard accessible; notifications retain a
prominent Critical treatment after read/ack; layouts remain usable on mobile, light, and dark themes.

## Phase gate mapping

- **Notification deduplication:** raise the same negative-inventory condition twice, assert one
  active notification, one unique email outbox row per recipient, incremented raise count, two
  append-only raise events, unchanged underlying inventory alert, and no duplicate on producer
  refresh. Resolve then re-raise to prove a new active occurrence is allowed without rewriting the
  earlier history.
- **Notification severity:** create each producer condition at boundary values and assert the exact
  Critical/Warning/Info mapping above. Assert payloads contain no cost, peso threshold, or raw UUID
  copy and that Critical conditions queue email while lower severities do not.
- **Dashboard role gating:** non-Super role tokens are denied by
  `get_dashboard_financials()` even when calling the API directly; the operational RPC returns no
  cost/value key. Super Admin receives an exact seeded valuation. Branch-scoped users cannot widen
  filters to another branch.

Additional coverage verifies notification target RLS, own-receipt mutation, idempotent delivery,
calendar read versus manage permissions, UTC/Asia-Manila conversion, stale edit rejection, popup
transfer endpoint validation, ledger-backed summary completion, no balance/ledger mutation during
popup completion, responsive states, and Phase 1–7 regressions.
