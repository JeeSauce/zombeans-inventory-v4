# Phase 7 — Recounts & Daily Operations — End-of-Phase Report

Date: 2026-07-13

Branch: `codex/phase-7-recounts`

## Completed work

- Added required start-of-day, optional end-of-day, and targeted cycle recounts with human
  references and guarded `draft → submitted → adjusted/closed` lifecycles.
- Full counts snapshot the branch inventory universe; cycle counts snapshot one selected item.
  Each line freezes the expected formula components, physical quantity, four-decimal variance,
  existing posted-cost snapshot, frozen variance value, and unusual-policy signals.
- Implemented reason-backed compensating adjustments. Positive corrections create a traceable
  recount-origin lot; negative corrections consume eligible lots before any lot-less remainder.
  The adjustment, signed append-only ledger entry, lots, balance, and session transition commit as
  one transaction.
- Added one current day-close row per branch/business date plus append-only close/reopen events.
  Close requires a completed start recount and no draft/submitted sessions. All inventory posting
  paths reject a closed date at the database boundary.
- Added Super Admin-only reasoned reopen. Its close event and audit row are atomic and idempotent;
  later stock transactions, recount sessions, and adjustments carry the reopen-event link.
- Added `/daily-ops` with live quantity variance, ordinary/unusual review cues, close blockers,
  reopen history, later-change references, loading/empty/success/warning/error states, and
  permission-aware desktop/mobile navigation. No cost, variance value, or raw UUID is rendered.

## Files and migrations

- Migrations: `0023_phase7_recount_schema.sql`, `0024_phase7_recount_rls.sql`, and
  `0025_phase7_recount_functions.sql`.
- Server/app: `app/(app)/daily-ops/`.
- Components/navigation: `components/daily-ops/` and Phase 7 Daily Ops entries in
  `components/app/`.
- Libraries: `lib/recounts/calculations.ts` and `lib/validation/recounts.ts`.
- Tests: `tests/unit/recount-calculations.test.ts`, `tests/integration/recounts.test.ts`, and
  `tests/e2e/recounts.spec.ts`.
- Design/plan: `docs/superpowers/specs/2026-07-13-phase-7-recounts-design.md` and
  `docs/superpowers/plans/2026-07-13-phase-7-recounts.md`.

## Gate coverage

- **Critical scenario 11 — correct recount adjustment:** a real-Postgres fixture asserts
  `opening + received + production output - transfers out - usage - stock-outs - waste`, then
  proves `variance = physical - expected` at four decimals. The reason-backed adjustment changes
  balance and ledger by exactly that variance at the frozen cost, replays without duplication, and
  leaves every previously posted row byte-for-byte unchanged. Ordinary staff are rejected for an
  unusual case and Super Admin succeeds.
- **Critical scenario 12 — closed-day denial:** a manager closes a ready date. Inventory Staff is
  rejected through a normal stock RPC and direct authenticated Phase 7 writes are rejected by
  grants/RLS; balance, recount, and ledger counts remain unchanged.
- **Critical scenario 13 — audited reopen:** blank reason and non-Super attempts fail. Super Admin
  creates exactly one replay-safe reopen event and audit row containing actor, branch/date, and
  reason; the next stock posting and recount activity explicitly reference that event.
- Additional coverage proves lifecycle/status guards, one-open-session enforcement, cost-column
  denial, formula/check constraints, start/close blockers, unusual thresholds, branch permissions,
  and all posting-function idempotency paths.

## Security posture

- Every Phase 7 posting RPC is `SECURITY DEFINER`, fixes `search_path = public`, validates the real
  `auth.uid()` permission and branch scope internally, takes a stable idempotency key, locks its
  token and business rows, and checks replay before lifecycle guards.
- Server Actions use only the session Supabase client, repeat `requirePermission`, validate with
  Zod, emit cost-free audit details, and return explicit stale/closed/permission errors.
- Authenticated grants omit recount unit-cost snapshots, variance-value snapshots, adjustment
  totals, and ledger cost columns. New tables have RLS, no authenticated direct DML, and
  definer-owned writes.
- The stock insert guard extends closed-day enforcement to Phase 1-6 posting functions. Super Admin
  cannot bypass a close; a reasoned reopen is required first.
- Posted stock transactions, ledger lines, and day-close events are append-only. Corrections add
  compensating rows and never edit finalized history.

## Verification

- A clean local rebuild applies migrations 0001-0025; the development seed creates all four role
  accounts.
- Vitest passes 47/47 unit tests and 51/51 real-database integration tests (98 total).
- Production build succeeds with all 26 application routes, including `/daily-ops`.
- Focused Phase 7 Playwright passes 6/6 Chromium and 6/6 Pixel 7 scenarios concurrently.
- Prettier write/check, ESLint, strict TypeScript, unit/all Vitest, production build, env-aware
  bundle scan, integration tests, and the full Playwright suite all pass.
- Bundle scan confirms the local service-role key is absent from all 85 generated client files.
- Full Playwright passes 53 tests across Chromium and Pixel 7, with 5 intentional mobile skips for
  legacy desktop-sidebar-only assertions.

## Known limitations / deferred

- Daily Ops operates on the current Asia/Manila business date; historical/back-dated recount entry
  is deferred.
- Start-of-day is enforced at close, so a late count does not stop otherwise valid Phase 1-6 stock
  work. Managers must resolve the count before closing the date.
- Thresholds are global application settings. Per-item unusual overrides and notification delivery
  are deferred; Phase 8 owns notification infrastructure.
- Closing and reopening are explicit user actions, not scheduled jobs. End-of-day recount remains
  optional, but once opened it blocks close until resolved.
- Cost snapshots and variance values remain intentionally absent from Daily Ops for every role;
  approved cost analysis stays on existing cost-gated server surfaces.

## Next phase

Phase 8 — Calendar, Popup Events, Notifications, Dashboard: operational scheduling, popup event
inventory sessions, deduplicated in-app/email alerts, and role-gated dashboard analytics.
