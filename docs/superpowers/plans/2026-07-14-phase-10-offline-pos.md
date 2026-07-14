# Phase 10 — Offline & POS Preparation — Implementation Plan

Design: `docs/superpowers/specs/2026-07-14-phase-10-offline-pos-design.md`

## Goal and gate

Deliver device-local recount/production drafts, server-owned synchronization conflict handling,
barcode lookup, Loyverse mapping, and a staged POS CSV importer without adding a live POS
connection or a browser inventory mutation path. Real-Postgres tests must genuinely prove critical
scenarios 17, 18, and 24.

## Global constraints

- Preserve Phase 1–9 behavior, cost snapshots, append-only ledger history, branch scope, and day
  close guards.
- Use existing recount and production posting primitives where possible.
- Require stable UUID idempotency keys for every offline submission, mapping command, preview, and
  confirmation; replay before stale-state checks.
- Make the server the only conflict authority. A browser result can never silently overwrite a
  later ledger movement.
- Keep every new business table behind RLS and remove authenticated direct DML.
- Keep cost/supplier-price fields out of safe grants, RPC results, server props, and client bundles.
- Add no Loyverse credential, API call, webhook, polling job, or live synchronization.
- Store UTC, use Asia/Manila business dates, and display human references/names rather than UUIDs.
- Record safe unspecified defaults in `docs/ASSUMPTIONS.md`.

## Task 1 — Baseline, design, and plan

- Confirm clean `main` at merged Phase 9 commit `35967c9` and branch to
  `codex/phase-10-offline-pos`.
- Inspect prior permissions, RLS, stock/recount/production RPCs, audit, UI, and integration harness.
- Write the Phase 10 design specification and this plan.
- Commit the planning documents separately.

## Task 2 — Schema (`0033_phase10_schema.sql`)

- Add offline/POS enums, human-reference sequences, and Phase 10 permissions/role mappings.
- Add durable offline submissions, normalized scope items, and append-only conflict resolutions.
- Add Loyverse mappings and append-only idempotent mapping commands.
- Add POS preview headers, staged rows, and append-only confirmed posting links.
- Add lifecycle constraints, unique replay/external-line indexes, update timestamps, and append-only
  guards.
- Commit the schema independently.

## Task 3 — RLS and grants (`0034_phase10_rls.sql`)

- Enable RLS on every Phase 10 table.
- Grant only safe operational columns to authenticated users.
- Add branch/permission-aware select policies for owned sync receipts, reviewers, mappings,
  previews, rows, and postings.
- Grant service-role maintenance access while preserving browser isolation.
- Add no authenticated insert/update/delete policy or grant.
- Commit RLS/grants independently and prove forged DML fails.

## Task 4 — Database functions (`0035_phase10_functions.sql`)

- Add human-reference helpers and barcode lookup.
- Add idempotent Loyverse mapping upsert/deactivation with audit evidence.
- Add offline recount/production submission orchestration, snapshot conflict detection, stable
  replay, scope locking, and safe result envelopes.
- Add safe conflict listing and explicit accept/reject resolution with reason, current permission
  rechecks, audit, and append-only resolution evidence.
- Add POS preview staging with mapping/duplicate validation and zero inventory/ledger writes.
- Add POS confirmation with FEFO sale consumption, refund lots, cost snapshots, balances, negative
  alerts, audit, row-posting evidence, and exact replay.
- Revoke public execution and grant only authenticated/service roles.
- Commit database functions independently.

## Task 5 — Validation, CSV parser, and client draft store

- Add `lib/validation/phase10.ts` for offline payloads, conflict decisions, barcode lookup, mapping,
  CSV rows, preview, and confirmation limits.
- Add `lib/pos/csv.ts` with quoted RFC-style parsing, exact headers, safe normalization, and tests.
- Add `lib/offline/draft-store.ts` with versioned IndexedDB persistence and deterministic queue state
  transitions.
- Add server-safe shared Phase 10 result types without exposing costs.
- Commit library code independently.

## Task 6 — Server actions and page data

- Add Phase 10 server actions that validate unknown input, repeat permissions, call session RPCs,
  clean errors, and revalidate affected pages.
- Load safe branch/catalog/production/mapping/import/conflict data using the session client.
- Ensure production draft sync enters the existing awaiting-confirmation path and never confirms.
- Add barcode lookup as a read-only server action.
- Commit the server boundary independently.

## Task 7 — Offline/POS UI and PWA shell

- Add `/offline-pos` with recount/production draft editors, device queue, retry/delete controls,
  online/offline status, and safe result messages.
- Add authorized conflict cards with accept/reject confirmation dialogs and reasons.
- Add barcode manual lookup and camera detector fallback, with no quantity controls.
- Add Loyverse mapping form/table and CSV preview/confirm workflow.
- Add navigation, loading skeleton, error boundary, empty/success/warning/error states, mobile
  layouts, labels, keyboard behavior, and light/dark styling.
- Register a same-origin service worker that caches static shell assets only and never caches POSTs.
- Commit UI/PWA code independently.

## Task 8 — Unit, integration, and browser tests

- Unit-test CSV escaping/quoted newlines/header/row/size validation, Zod payload limits, and client
  draft queue transitions.
- Add a real-Postgres Phase 10 suite for scenarios 17, 18, and 24 with exact before/after ledger,
  balance, lot, replay, status, and audit assertions.
- Test all-role permissions, branch scope, direct-DML denial, append-only guards, cost isolation,
  unusual review, production sync boundary, mapping replay, barcode lookup, unmapped/duplicate POS
  rows, and confirm atomicity.
- Add Playwright desktop/mobile coverage for navigation, queue, barcode fallback, role gating,
  preview, and confirmation dialogs after clean reset/seed.
- Commit tests independently.

## Task 9 — Documentation and full verification

- Mark Phase 10 complete in `IMPLEMENTATION_PHASES.md` and update `TESTING_STRATEGY.md`,
  `DATABASE_SCHEMA.md`, `ROLES_AND_PERMISSIONS.md`, `BUSINESS_RULES.md`, `UI_STRUCTURE.md`, ERD,
  workflows, changelog, and assumptions.
- Write `docs/reports/PHASE_10.md` with completed work, files/migrations/tests, security posture,
  exact gate evidence, limitations, and Phase 11 handoff.
- Run `npm run format`, format check, lint, strict typecheck, unit tests, build, bundle scan, clean
  DB reset, real-Postgres integration tests, dev seed, and Playwright.
- Commit documentation/report independently.

## Task 10 — Review handoff

- Review commit scope and the complete branch diff against `main`.
- Push `codex/phase-10-offline-pos`.
- Open a draft pull request into `main` with gate evidence and known Phase 11 limitations.
