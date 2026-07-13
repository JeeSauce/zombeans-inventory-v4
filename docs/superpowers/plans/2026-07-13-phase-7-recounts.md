# Phase 7 — Recounts & Daily Operations — Implementation Plan

Design: `docs/superpowers/specs/2026-07-13-phase-7-recounts-design.md`

## Goal and gate

Deliver start-of-day (required) and optional end-of-day recounts, cycle counts, variance
calculation, reason-backed compensating adjustments, day closing, and audited Super Admin
reopening. Critical scenarios 11, 12, and 13 must pass against local Postgres.

## Global constraints

- Preserve all Phase 1–6 behavior and the append-only ledger.
- Inventory quantities change only inside atomic `SECURITY DEFINER` functions.
- Variance is valued from existing cost snapshots; never recompute finalized costs.
- Corrections are compensating/reversing ledger entries — never edits to posted rows.
- Never expose cost or variance-value columns or the service-role client to browser code.
- Every posting function sets `search_path=public`, checks permission internally, takes an
  idempotency key, and is idempotent (advisory lock + existing-row lookup + status guard).
- Server Actions call `requirePermission`; RLS remains the backstop.
- Record unspecified decisions in `docs/ASSUMPTIONS.md`.

## Task 1 — Baseline and design

- Start from merged `origin/main` on `codex/phase-7-recounts`.
- Confirm local Supabase, the Phase 6 test baseline, and production build are green.
- Write the Phase 7 design and this plan before implementation.
- Map scenarios 11, 12, and 13 to real integration assertions; define the expected-quantity
  formula (opening + received + production output − transfers out − usage − stock-outs − waste).

## Task 2 — Schema (`0023_phase7_recount_schema.sql`)

- Add recount session enums/status (start-of-day, end-of-day, cycle), day-close, adjustment reason
  types, close-event types, and human-reference sequences.
- Add recount sessions, recount lines (expected components/snapshot, physical count, variance),
  variance adjustments linked to the ledger, a per-branch day-close table, and append-only close
  events.
- Enforce lifecycle invariants (`draft → submitted → adjusted/closed`), one open recount per
  branch/date/type, index operational lookups, and preserve append-only behavior.

## Task 3 — RLS and grants (`0024_phase7_recount_rls.sql`)

- Enable RLS and permission-scoped policies on every new table.
- Keep adjustments, cost/variance values, close events, and ledger writes definer-only.
- Grant authenticated users only non-sensitive columns/actions; add authorization tests that prove
  ordinary staff cannot write a closed day and cannot read cost/variance-value columns.

## Task 4 — Pure helpers and validation

- Add expected-quantity computation, variance, variance-value (from a frozen cost snapshot), and
  unusual-variance signal helpers for percent/peso boundaries, post-reopen changes, negative
  results, missing cost snapshots, and repeat adjustments.
- Add Zod schemas for recount open/submit, cycle count, variance adjustment, day close, and reopen.
- Unit-test the expected-quantity formula, normalized four-decimal boundaries, and escalation
  thresholds.

## Task 5 — Atomic functions and gate integration tests (`0025_phase7_recount_functions.sql`)

- Add reference generators and idempotent open/submit recount RPCs for full and cycle counts that
  snapshot the expected quantity and compute/freeze variance.
- Add an idempotent `post_recount_adjustment` RPC that writes a compensating append-only ledger
  entry valued from frozen existing cost snapshots, requires a reason, and escalates unusual
  variances to Super Admin (scenario 11).
- Add idempotent `close_day` and Super Admin `reopen_day` RPCs; block all stock writes against a
  closed day (scenario 12); require a reason and write an atomic audit row on reopen, attributing
  later changes through the reopen event (scenario 13).
- Assert the adjustment nets the ledger correctly and mutates no posted row; assert closed-day
  writes are rejected at the function/server path and direct authenticated RLS path; assert reopen
  rejects a blank reason and is audited.
- Cover permissions, branch access, idempotent replay, full/cycle selection, threshold boundaries,
  and lifecycle guards.

## Task 6 — Server Actions

- Use the session client for all internally authorized RPCs.
- Thread stable form tokens through recount open/submit, adjustment, day close, and reopen.
- Require explicit server permissions, write cost-free audit events only for non-replayed actions,
  return `{ error?, info? }`, and revalidate affected Daily Ops, recount, and stock paths.

## Task 7 — Recount UI

- Add a start-of-day recount surface with per-item expected versus physical entry and live variance.
- Add cycle-count and optional end-of-day surfaces; adjustment review with mandatory reason and
  clear unusual-variance escalation cues.
- Provide loading, empty, success, warning, stale, and error states without costs or raw UUIDs.

## Task 8 — Day close and reopen UI

- Add day-close controls with a summary of open variances/unresolved recounts blocking close.
- Add Super Admin reopen with a required reason and a visible audit trail of reopen plus attributed
  later edits.
- Fail loud on stale lifecycle actions; forms close on action success.

## Task 9 — Navigation and E2E

- Add permission-aware Daily Ops/Recounts navigation and update the sidebar phase label.
- Verify Inventory Staff and Branch Manager can recount and post ordinary variance adjustments;
  unusual variance requires Super Admin; ordinary staff cannot edit a closed day; unauthorized
  roles are redirected.
- Verify Super Admin reopen requires a reason, is audited, and costs remain absent from the UI.

## Task 10 — Documentation and full verification

- Update assumptions, changelog, database schema/ERD/workflow, roles, phase marker, and
  `docs/reports/PHASE_7.md`.
- Run format, format check, lint, typecheck, unit/all Vitest, production build, bundle scan,
  integration tests, and Playwright.
- Commit by task, push the branch, and open a draft PR into `main` titled
  `Phase 7 — Recounts & Daily Operations` with gate/security/limitations notes.
