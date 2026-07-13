# Phase 6 — Multi-branch Stock — Implementation Plan

Design: `docs/superpowers/specs/2026-07-13-phase-6-multi-branch-stock-design.md`

## Goal and gate

Deliver stock-in/out, stock requests, FEFO/cost-preserving transfers, receiving discrepancies, and
visible Critical negative-inventory alerts. Critical scenarios 5, 9, and 10 must pass against local
Postgres.

## Global constraints

- Preserve all Phase 1–5 behavior and the append-only ledger.
- Inventory quantities change only inside atomic `SECURITY DEFINER` functions.
- Use normalized base units; raw ingredients remain Main-only.
- Never expose cost columns or the service-role client to browser code.
- Every posting function sets `search_path=public`, checks permission internally, and is idempotent.
- Server Actions call `requirePermission`; RLS remains the backstop.
- Record unspecified decisions in `docs/ASSUMPTIONS.md`.

## Task 1 — Baseline and design

- Start from merged `origin/main` on `codex/phase-6-multi-branch-stock`.
- Confirm local Supabase, the 80-test baseline, and production build.
- Write the Phase 6 design and this plan before implementation.
- Map scenarios 5, 9, and 10 to real integration assertions.

## Task 2 — Schema (`0020_phase6_stock_schema.sql`)

- Add request/transfer/discrepancy enums and human-reference sequences.
- Add requests/lines, transfers/lines, per-lot allocations, discrepancies, and inventory alerts.
- Link transfer ledger rows, enforce lifecycle invariants, index operational lookups, and preserve
  append-only behavior.

## Task 3 — RLS and grants (`0021_phase6_stock_rls.sql`)

- Enable RLS and permission-scoped policies on every new table.
- Keep lot allocations, costs, balances, ledger, and alerts definer-only for writes.
- Grant authenticated users only non-sensitive columns and actions; add authorization tests.

## Task 4 — Pure helpers and validation

- Add quantity normalization, receiving-accounting, discrepancy, and Critical-balance helpers.
- Add Zod schemas for stock-in/out, request create/review, transfer prepare/receive, and discrepancy
  resolution.
- Unit-test four-decimal boundaries and receiving totals.

## Task 5 — Atomic functions and gate integration tests (`0022_phase6_stock_functions.sql`)

- Add reference generators and idempotent direct stock-in/out RPCs.
- Add atomic request create/review, transfer prepare, approval/FEFO dispatch, idempotent receiving,
  and discrepancy resolution RPCs.
- Assert negative balances are exact and alert atomically (scenario 10).
- Assert duplicate transfer receiving cannot add twice (scenario 5).
- Reassert the sale-recipe prepared-input trigger (scenario 9).
- Cover FEFO, expiry exclusion, cost preservation, discrepancies, lifecycle guards, and permissions.

## Task 6 — Server Actions

- Use the session client for all internally authorized RPCs.
- Thread stable form tokens through stock posting, transfer preparation, and receiving.
- Require explicit server permissions, write cost-free audit events, return `{ error?, info? }`, and
  revalidate affected stock/request/transfer paths.

## Task 7 — Stock UI

- Add stock overview with branch balances and Critical negative alerts.
- Add stock-in/out dialogs with batch/lot/expiry fields and clear operational causes.
- Provide loading, empty, success, warning, and error states without costs or raw UUIDs.

## Task 8 — Requests and transfers UI

- Add request list/create/review surfaces.
- Add transfer list/prepare/detail surfaces for approve, receive, discrepancy display, and resolution.
- Fail loud on stale lifecycle actions; forms close on action success.

## Task 9 — Navigation and E2E

- Add permission-aware Stock navigation and update the sidebar phase label.
- Verify Inventory Staff can stock in/out, prepare, and receive; Branch Manager can approve and
  resolve but cannot stock in/out; unauthorized roles are redirected.
- Verify a negative balance and Critical alert are visible and costs remain absent.

## Task 10 — Documentation and full verification

- Update assumptions, changelog, database schema/ERD, phase marker, and `docs/reports/PHASE_6.md`.
- Run format, format check, lint, typecheck, unit/all Vitest, build, bundle scan, integration tests,
  and Playwright.
- Commit by task, push the branch, and open a draft PR into `main` titled
  `Phase 6 — Multi-branch Stock` with gate/security/limitations notes.
