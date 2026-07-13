# Phase 5 — Production — Implementation Plan

Design: `docs/superpowers/specs/2026-07-13-phase-5-production-design.md`

## Goal and gate

Deliver templates, orders, planned/actual inputs and outputs, yield/waste handling, output batches
and expiry, approvals, FEFO consumption, atomic ledger posting, and immutable cost-snapshot
attachment. Critical scenarios 2, 3, and 4 must pass against local Postgres.

## Global constraints

- Preserve all Phase 1–4 behavior and the append-only ledger.
- Inventory quantities change only inside the production posting function.
- Use normalized base units and Main branch inventory.
- Never expose cost columns or the service-role client to browser code.
- `SECURITY DEFINER` functions set `search_path=public`, check permission internally, and are
  idempotent.
- Server Actions call `requirePermission`; RLS remains the backstop.
- Record unspecified decisions in `docs/ASSUMPTIONS.md`.

## Task 1 — Baseline and design

- Confirm the clean Phase 4 head, local Supabase availability, 71-test baseline, and production
  build.
- Write the Phase 5 design and this plan before implementation.
- Map scenarios 2–4 to real integration assertions.

## Task 2 — Production schema (`0016_production_schema.sql`)

- Add production status enum, reference sequence, templates, orders, and frozen input rows.
- Add constraints, indexes, timestamps, terminal immutability, and lifecycle guards.
- Link production transactions back to their order without weakening ledger append-only rules.

## Task 3 — RLS and grants (`0017_production_rls.sql`)

- Add read/create/record/confirm policies using the seeded production permissions.
- Grant only non-sensitive columns to `authenticated`.
- Keep lots, balances, ledger writes, and raw cost data unavailable to direct clients.
- Add production RLS/permission assertions.

## Task 4 — Planning, warning, and validation library

- Add pure batch-scaling and yield/waste warning helpers with four-decimal normalization.
- Add Zod schemas for template, order, actual recording, lifecycle, and confirmation inputs.
- Cover boundary and rounding behavior with unit tests.

## Task 5 — Atomic posting (`0018_production_functions.sql`) and gate tests

- Add `next_production_reference`, order creation/planning RPC, and atomic completion RPC.
- Implement row locking, FEFO lot allocation, expiry/status exclusion, balance projection, output
  lot creation, signed ledger lines, cost-snapshot attachment, and idempotent replay.
- Integration-test FEFO order and expired-only refusal (scenario 2), multi-input rollback
  (scenario 3), and duplicate replay (scenario 4).

## Task 6 — Server Actions and lifecycle

- Create templates/orders with stable form tokens.
- Start, record actuals, submit, cancel, and confirm with explicit permission checks.
- Use the session client for RPCs so `auth.uid()` reaches database authorization.
- Write cost-free audit entries and return `{ error?, info? }` action state.

## Task 7 — Production UI

- Add production list, create, detail, loading, and error surfaces.
- Show planned/actual quantities, batches/expiry, yield/waste warnings, and readable item/unit data.
- Gate record and confirm controls by permission and never render cost.

## Task 8 — Navigation and E2E

- Add the Production navigation entry and bump the sidebar phase label.
- Verify Production Staff can create/record but not confirm; Branch Manager can confirm but not
  create; Inventory Staff is gated; non-cost readers never see cost.

## Task 9 — Documentation and full verification

- Update assumptions, changelog, database schema/ERD, phase marker, and `docs/reports/PHASE_5.md`.
- Run format, format check, lint, typecheck, unit/all Vitest, build, bundle scan, integration tests,
  and Playwright.
- Commit each task separately, push the branch, and open a draft PR into `main` titled
  `Phase 5 — Production` with gate/security/limitations notes.
