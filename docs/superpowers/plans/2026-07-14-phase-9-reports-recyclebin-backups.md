# Phase 9 — Reports, Exports, Recycle Bin, Backups — Implementation Plan

Design: `docs/superpowers/specs/2026-07-14-phase-9-reports-recyclebin-backups-design.md`

## Goal and gate

Deliver branch-aware operational and database-gated financial reports, server-only CSV/Excel/PDF
exports, dependency-aware recycle-bin recovery/purge, and backup metadata/recovery operations. The
real-Postgres gate proves critical scenarios 14, 15, and 16 plus export financial isolation.

## Global constraints

- Preserve Phase 1–8 behavior and the append-only ledger/compensating-entry model.
- Never mutate inventory from a browser or Phase 9 reporting/lifecycle function.
- Keep service-role usage behind `import "server-only"` or secured external CI/cron.
- Enable RLS on every new business table and deliberately grant safe columns only.
- Require `cost.read` inside the financial report RPC used by both pages and exports.
- Require stable idempotency keys and atomic audit rows for soft delete, restore, purge, and backup
  metadata recording.
- Never purge ledger, audit, activated accounting history, cost snapshots, or explicitly held data.
- Store timestamps in UTC; present dates in Asia/Manila and money as Philippine pesos.
- Never render raw UUIDs, protected prices/costs/variance values, secrets, or backup locations.
- Record unspecified decisions in `docs/ASSUMPTIONS.md`.

## Task 1 — Baseline, design, and plan

- Fast-forward `main` to merged Phase 8 and create
  `codex/phase-9-reports-recyclebin-backups`.
- Read Phase 9 contracts plus prior RLS/grant, permission, idempotency, audit, and UI patterns.
- Reproduce format, lint, typecheck, clean DB reset/seed, unit, integration, build, bundle scan, and
  desktop/mobile Playwright gates before implementation.
- Write the Phase 9 design specification and this plan.

## Task 2 — Schema (`0030_phase9_schema.sql`)

- Add lifecycle entity/command/hold and backup metadata enums.
- Add explicit retention holds, append-only recycle commands, idempotent purge runs, and backup-run
  metadata with safe constraints/indexes.
- Add lifecycle guard triggers to supported soft-delete roots and append-only triggers to history.
- Add service-role grants needed by later definer/external paths, but no authenticated DML.

## Task 3 — RLS and grants (`0031_phase9_rls.sql`)

- Enable RLS on all Phase 9 tables.
- Add Super-Admin permission policies for safe retention-hold, recycle-history, purge-run, and
  backup-run reads.
- Revoke direct hard delete on supported roots and rely on guard triggers for lifecycle columns.
- Grant only safe backup/recycle columns; omit cost, supplier-price, variance-value, credentials,
  provider internals, and lifecycle idempotency details from ordinary reads.
- Prove ordinary roles cannot read admin metadata or forge lifecycle writes.

## Task 4 — Database functions (`0032_phase9_functions.sql`)

- Add validated branch/date/category/item-type filter helpers.
- Add common-envelope operational report RPC for balances, movements, production, and recounts.
- Add separate `cost.read`-gated financial RPC for valuation and frozen movement costs.
- Add dependency inspection and safe recycle-bin listing.
- Add idempotent soft-delete, restore, and purge commands with atomic audit rows and replay.
- Add service-role-only idempotent backup metadata recording and Super-Admin backup status reads.
- Revoke public function execution and grant only the intended authenticated/service roles.

## Task 5 — Validation, report contracts, and export encoders

- Add `lib/validation/phase9.ts` for report filters, report slugs, export formats, lifecycle commands,
  retention holds, purge runs, and backup metadata.
- Add `lib/reports/` types, catalog metadata, envelope validation, defaults, and query composition.
- Add server-only `lib/export/` CSV, SpreadsheetML Excel, and paginated PDF encoders with safe
  filenames/content types and no client/service-role imports.
- Unit-test validation boundaries, escaping, formulas-as-data handling, PDF headers, and financial
  report catalog gating.

## Task 6 — Server actions and export route

- Add report data loading shared by page and export route.
- Add `/reports/[type]/export` route handler that authenticates, validates, queries the gated RPC,
  serializes server-side, and returns no-store/nosniff attachment responses.
- Add recycle restore/purge actions using `requirePermission("recyclebin.restore")` and stable keys.
- Add supported-page soft-delete actions using the entity's existing write permission and RPC.
- Revalidate report, source, recycle, and admin routes after successful commands.

## Task 7 — Reports UI

- Add `/reports` catalog cards for operational reports and `cost.read`-visible financial reports.
- Add `/reports/[type]` filters, summary cards, responsive safe table, export links, print action,
  and visible financial sensitivity copy.
- Add loading, empty, success, warning, and error states plus print styles.
- Add a permission-neutral Reports navigation item for authenticated users.

## Task 8 — Recycle-bin and backups UI

- Add `/admin/recycle-bin` with deletion/purge dates, safe eligibility reasons, restore confirmation,
  purge status, and explicit protected/not-due warnings.
- Add `/admin/backups` with current policy, latest-run health, verification/age warnings, honest
  empty state, safe history, and restore drill guidance.
- Gate navigation and pages with `recyclebin.restore` and `backup.manage` respectively.
- Add loading/error states and mobile-friendly layouts.

## Task 9 — Real-Postgres and browser tests

- Add scenario 14 coverage for hidden deleted rows, Super-Admin listing, exact restore, replay, and
  ordinary-role denial.
- Add scenario 15 coverage for elapsed window, protected/inside-window exclusions, automatic
  ledger/accounting dependency detection, explicit holds, and purge replay.
- Add scenario 16 coverage proving audit rows remain after soft delete and hard purge and remain
  `audit.read`-gated.
- Add all-role report RPC coverage for branch scope, invalid filters, operational safe keys,
  financial denial, exact frozen values, and export-equivalent envelopes.
- Add unit tests for schemas/encoders and Playwright desktop/mobile report/admin permission paths.

## Task 10 — Documentation and full verification

- Update business rules, roles/permissions, schema, UI map, testing strategy, backup/recovery,
  assumptions, diagrams where needed, changelog, and implementation phase marker.
- Run `npm run format`, then format check, lint, strict typecheck, clean DB reset/seed, unit,
  real-Postgres integration, production build, service-role bundle scan, and full Playwright with
  one worker after a clean reset/seed.
- Write `docs/reports/PHASE_9.md` with exact migrations, gate evidence, security posture, counts,
  limitations, and Phase 10 handoff.
- Commit in schema → RLS → functions → lib/actions/UI → tests → docs units, push the branch, and
  open a PR into `main`.
