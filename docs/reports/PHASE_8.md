# Phase 8 — Calendar, Popup Events, Notifications, Dashboard — End-of-Phase Report

Date: 2026-07-14

Branch: `codex/phase-8-calendar-notifications`

## Completed work

- Added targeted Critical, Warning, and Info notifications with stable active-condition
  deduplication, append-only event history, per-user read/acknowledgement receipts, and an
  idempotent server-only email outbox. Producers cover negative inventory, expired lots, failed
  production, overdue and unusual recounts, out-of-stock and low-stock balances, and pending stock
  requests.
- Replaced the dashboard placeholder with branch-aware operational analytics, filters, safe recent
  movement and alert summaries, and upcoming calendar work. Inventory valuation is isolated in a
  separate database function that requires `cost.read`; the signed-in role remains visible and
  stock actions are shown only to users who can open the stock route.
- Added an Asia/Manila calendar with month, week, and agenda views. All authenticated operational
  roles can read accessible events; Super Admin and Branch Manager can create and edit through
  audited, replay-safe database commands.
- Added popup engagement sessions linked one-to-one with popup calendar events, transfer linkage,
  opening/final counts, lifecycle controls, and frozen event summaries. Completion validates
  already-posted Phase 6 stock/transfer movements and never posts inventory itself.
- Added an explicit production-failure state and notification producer. A follow-up allowlist
  migration restores authenticated reads of only `failed_at` and `failure_reason`, while
  `failed_by`, failure idempotency metadata, cost snapshots, and all other sensitive columns remain
  unavailable.
- Added responsive dashboard, calendar, popup, and notification routes with loading, empty,
  success, warning, and error states, plus app-shell navigation and an unread notification bell.

## Files and migrations

- Schema and security: `0026_phase8_schema.sql`, `0027_phase8_rls.sql`,
  `0028_phase8_functions.sql`, and `0029_phase8_production_failure_read_grant.sql`.
- Server/app routes: `app/(app)/dashboard/`, `app/(app)/calendar/`, `app/(app)/popups/`,
  `app/(app)/notifications/`, and Phase 8 additions to production, stock, daily operations, and the
  authenticated app layout.
- Components: `components/dashboard/`, `components/calendar/`, `components/popups/`,
  `components/notifications/`, and permission-aware app/production updates.
- Libraries: `lib/calendar/time.ts`, `lib/dashboard/data.ts`, `lib/notifications/`,
  `lib/email/notification-delivery.ts`, and `lib/validation/phase8.ts`.
- Tests: `tests/unit/phase8.test.ts`, `tests/integration/phase8.test.ts`, production column-grant
  coverage, `tests/e2e/phase8.spec.ts`, and cross-phase browser regression updates.
- Design/plan: `docs/superpowers/specs/2026-07-14-phase-8-calendar-notifications-design.md` and
  `docs/superpowers/plans/2026-07-14-phase-8-calendar-notifications.md`.

## Gate coverage

- **Notification deduplication and severity:** real-Postgres tests prove one active notification per
  stable condition key, incremented re-raise history, resolve/re-raise behavior, one Critical email
  delivery per recipient, exact producer severity, and no email for Warning/Info conditions.
  Payload assertions exclude costs, peso thresholds, and raw UUID copy.
- **Dashboard role gating:** non-Super roles can call the operational dashboard function within
  branch scope but are denied direct calls to the financial function. The operational payload has
  no cost/value fields; Super Admin receives the exact seeded valuation. Browser coverage proves
  operational cards remain visible while financial cards stay hidden from unauthorized roles on
  desktop and mobile.
- Additional coverage proves notification target RLS and own-receipt transitions, Critical alerts
  remain visible after acknowledgement, calendar read/manage boundaries and UTC conversion,
  optimistic event edits, popup transfer endpoint checks, ledger-backed popup completion with zero
  balance/ledger mutation, and the restored Phase 5 production detail journey.

## Security posture

- Every Phase 8 mutation function is `SECURITY DEFINER`, fixes `search_path = public`, validates the
  real authenticated actor and permission/branch/target scope, and protects stable idempotency
  tokens before changing state. Direct authenticated DML remains revoked.
- RLS is enabled on every Phase 8 business table. Notification recipients and provider errors are
  server-only; operations UI receives only safe titles, human references, quantities, and status
  metadata.
- Dashboard financials are separated from operational analytics and enforce `cost.read` inside the
  database function. Cost, supplier-price, variance-value, and threshold-peso fields are not
  exposed through operational results.
- The production allowlist grants only `failed_at` and `failure_reason` for authenticated reads.
  Regression coverage proves `failed_by` remains denied.
- Popup completion cannot create stock transactions or ledger lines. All inventory quantities
  continue to change only through the existing atomic, idempotent, append-only Phase 5/6 posting
  functions.
- The service-role client and email transport remain guarded by `import "server-only"`; the final
  bundle scan found the configured local service-role key in zero client files.

## Verification

- A clean local rebuild applies migrations 0001–0029; the development seed creates all four role
  accounts.
- Prettier check, ESLint, strict TypeScript, and the production build pass.
- Vitest passes 58/58 unit tests and 62/62 real-database integration tests (120 total).
- The production build succeeds with 34 application routes, including `/dashboard`, `/calendar`,
  `/popups`, `/popups/[id]`, `/notifications`, and `/production/[id]`.
- The bundle scan confirms the local service-role key is absent from all 98 generated client files.
- Full Playwright passes 63 tests across Chromium and Pixel 7, with 5 intentional mobile skips for
  desktop-sidebar-only assertions (68 cases total). The constrained local run used one worker after
  a fresh reset/seed; all Phase 8 cases pass on both projects.

## Known limitations / deferred

- Time-based notification refresh currently runs on relevant page loads and successful operational
  commands. A hosted scheduler remains a deployment-infrastructure decision.
- Email uses the provider-neutral outbox with the local console transport; production provider
  credentials and delivery operations are deferred.
- Notification preferences, SMS/push channels, recurring calendar rules, drag-and-drop calendar
  editing, and POS-driven popup usage remain out of scope for this phase.
- Popup summaries depend on movements already posted through the established stock/transfer flows;
  completing a popup event intentionally cannot repair or invent missing inventory movements.

## Next phase

Phase 9 — Reports, Exports, Recycle Bin, Backups: operational and financial report surfaces,
CSV/Excel/PDF/print exports, soft-delete recovery and purge rules, backup jobs, and restore
documentation.
