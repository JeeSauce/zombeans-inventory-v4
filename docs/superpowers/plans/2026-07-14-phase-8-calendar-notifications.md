# Phase 8 — Calendar, Popup Events, Notifications, Dashboard — Implementation Plan

Design: `docs/superpowers/specs/2026-07-14-phase-8-calendar-notifications-design.md`

## Goal and gate

Deliver operational scheduling, popup engagement inventory sessions, deduplicated in-app/email
alerts, and role-gated dashboard analytics. The real-Postgres Phase 8 gate proves notification
dedup/severity and database-level dashboard financial authorization.

## Global constraints

- Preserve Phase 1–7 behavior and the append-only inventory ledger.
- Never mutate inventory from a browser or a Phase 8 popup summary function. Use only existing
  atomic ledger posting functions with stable idempotency keys.
- Keep the service-role client and email transport behind `import "server-only"`.
- Enable RLS on every new business table; authenticated users receive no direct Phase 8 DML.
- Require `cost.read` inside the financial dashboard RPC as well as at the UI.
- Every definer function fixes `search_path = public`, authorizes `auth.uid()`, locks stable
  idempotency tokens, and checks replay before stale lifecycle guards.
- Store timestamps in UTC and present business dates in `Asia/Manila`.
- Never render raw UUIDs, costs, supplier data, recipient email addresses, or peso thresholds to an
  unauthorized role. Record unspecified decisions in `docs/ASSUMPTIONS.md`.

## Task 1 — Baseline, design, and plan

- Refresh `main` to merged Phase 7 and create `codex/phase-8-calendar-notifications`.
- Read the Phase 8 contracts plus Phase 6/7 RLS, definer, idempotency, audit, and UI patterns.
- Write the Phase 8 design specification and this plan before implementation.
- Map notification dedup/severity and financial role-gating to real-Postgres assertions.

## Task 2 — Schema (`0026_phase8_schema.sql`)

- Add notification severity/source/status/event/delivery enums, current notifications,
  per-user receipts, append-only events, and email outbox/delivery rows.
- Add calendar event type/status and popup session/status/movement enums.
- Add calendar events, popup sessions, popup count lines, and linked movement records.
- Add nullable popup-event linkage to existing transfers and indexes/checks for operational reads.
- Add human-reference sequences, partial active dedup uniqueness, lifecycle constraints, delivery
  uniqueness, append-only triggers, and updated-at triggers.

## Task 3 — RLS and grants (`0027_phase8_rls.sql`)

- Enable RLS on every new table and add target/branch-aware read policies.
- Grant authenticated users safe notification/calendar/popup columns only and no direct DML.
- Keep notification recipient addresses, provider details, and all cost data server-only.
- Prove users see only matching notifications, may mutate state only through own-receipt RPCs, and
  calendar readers cannot forge writes.

## Task 4 — Database functions (`0028_phase8_functions.sql`)

- Add target-aware idempotent notification raise/resolve/read/ack functions and append-only events.
- Add producer refresh for negative inventory, expired lots, overdue start recounts, unusual recount
  variance, failed production, low/out-of-stock, and pending requests; trigger negative alerts
  immediately and enqueue Critical email once per recipient.
- Add idempotent delivery claim/finalize functions for the server-only email worker.
- Add role/branch-filtered operational dashboard RPC and separate `cost.read`-gated financial RPC.
- Add idempotent calendar create/edit and popup create/edit/lifecycle/count/link/completion functions
  with atomic audit rows.
- Validate popup completion against existing posted ledger/received transfer links and assert it
  never changes balances or ledger rows.

## Task 5 — Pure helpers, validation, and email service

- Add notification severity/label helpers and unit tests for every producer mapping.
- Add dashboard filter/date helpers and safe result types.
- Add Zod schemas for notification state, dashboard filters, calendar create/edit, popup lifecycle,
  count lines, and movement links.
- Extend the provider-neutral server-only email layer with idempotent outbox drain orchestration;
  keep console delivery for local development.

## Task 6 — Server Actions and server queries

- Add calendar and popup actions using `calendar.manage`, stable form tokens, actor-aware RPCs,
  audit-safe errors, and route revalidation.
- Add own-notification read/ack actions and server-only producer refresh/email dispatch.
- Add dashboard query composition that always calls operational analytics but calls financial
  analytics only with `cost.read`.
- Wire existing stock/recount/production server paths to refresh producers and drain Critical email
  after successful first execution without changing their stock atomicity boundary.

## Task 7 — Dashboard and notifications UI

- Replace the placeholder dashboard with real role-filtered KPI/alert cards from `UI_STRUCTURE`,
  date/branch/category/item-type filters, safe recent movement lists, and upcoming events.
- Add `/notifications`, an app-shell bell/unread count, severity filters, read/ack controls, and
  persistent Critical treatment.
- Add loading, empty, success, warning, stale/error, responsive, light, and dark states.

## Task 8 — Calendar and popup UI

- Add `/calendar` month/week/agenda views over real UTC event rows rendered in Asia/Manila.
- Add accessible create/edit forms for Super Admin/Branch Manager and read-only detail for others.
- Add `/popups` and `/popups/[id]` with engagement lifecycle, linked transfers, remaining count,
  categorized ledger-backed movements, completion readiness, and frozen inventory summary.
- Show names, SKUs, references, dates, and quantities; never raw UUIDs or costs.

## Task 9 — Unit and real-Postgres gate tests

- Prove stable active dedup, re-raise update, resolve/re-raise history, one email per recipient, and
  idempotent delivery claims.
- Prove every producer's exact severity and safe payload behavior.
- Prove non-Super direct API calls cannot read dashboard valuation and operational responses contain
  no financial fields; prove exact Super Admin valuation and branch-filter denial.
- Cover notification target RLS, calendar read/manage, stale/idempotent edit, popup endpoint and
  ledger-link validation, and zero popup-completion stock mutation.

## Task 10 — Playwright, documentation, and verification

- Add desktop/mobile flows for dashboard role cards/filters, notifications states, calendar
  read/manage, and popup lifecycle/summary.
- Update assumptions, changelog, database schema/ERD/workflow, roles, UI route docs, phase marker,
  and `docs/reports/PHASE_8.md`.
- Run Prettier write/check, ESLint, strict TypeScript, unit tests, clean database reset and seed,
  integration tests, production build, service-key bundle scan, and full Playwright after a second
  fresh reset/seed.
- Record unit/integration totals, route count, bundle-file count, and Playwright pass/skip totals in
  the Phase 8 report. Commit by task in the requested schema → RLS → functions → lib → actions → UI
  → tests → docs sequence.
