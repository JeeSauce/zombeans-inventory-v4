# Phase 9 — Reports, Exports, Recycle Bin, Backups — End-of-Phase Report

Date: 2026-07-14

Branch: `codex/phase-9-reports-recyclebin-backups`

## Completed work

- Added four branch-scoped operational reports: inventory balances, stock movements, production
  output, and recount variances. Added two financial reports: inventory valuation and movement
  costs. Every report supports validated date, accessible-branch, category, and item-type filters,
  bounded results, summaries, loading/empty/error states, and a print layout.
- Added server-generated CSV, Excel-compatible SpreadsheetML, and PDF exports from the same
  authorized report result used by the page. CSV/Excel text is formula-safe; financial routes and
  database functions require `cost.read`.
- Added reasoned, idempotent soft delete and Super-Admin restore for supported business roots,
  explicit retention holds, dependency-aware purge, append-only command/audit history, lifecycle
  DML guards, and safe human-labelled recycle-bin UI.
- Added backup-run metadata recording restricted to secured service-role infrastructure, plus a
  Super-Admin status/history, policy, and restore-drill page. Empty metadata is reported honestly;
  no backup credential, location, provider error, or destructive restore action reaches the app.
- Updated the authenticated navigation and all authoritative schema, retention, permission,
  recovery, testing, route, diagram, phase, assumption, and changelog documentation.

## Files and migrations

- Schema/security/functions: `0030_phase9_schema.sql`, `0031_phase9_rls.sql`, and
  `0032_phase9_functions.sql`.
- Reports/exports: `lib/reports/`, `lib/export/`, `lib/validation/phase9.ts`,
  `components/reports/`, `app/(app)/reports/`, and permission-aware navigation.
- Recovery/admin: `app/(app)/admin/recycle-bin/`, `components/admin/recycle-bin-client.tsx`, and
  `app/(app)/admin/backups/`.
- Tests: `tests/unit/phase9.test.ts`, `tests/integration/phase9.test.ts`,
  `tests/e2e/phase9.spec.ts`, plus exact/role-scoped fixes to two legacy Playwright locators.
- Design/plan: `docs/superpowers/specs/2026-07-14-phase-9-reports-recyclebin-backups-design.md`
  and `docs/superpowers/plans/2026-07-14-phase-9-reports-recyclebin-backups.md`.

## Gate coverage

- **Scenario 14 — restore before purge:** a soft-deleted business record is visible only to the
  Super-Admin recovery path and restores with lifecycle dates cleared, preserved business data,
  one audit record, and safe idempotent replay.
- **Scenario 15 — purge when eligible:** a record beyond its purge date with no blockers is
  physically removed through the guarded purge command; the run result and independent audit/
  command evidence remain.
- **Scenario 16 — dependency protection:** inbound business references, ledger/accounting history,
  and active explicit holds prevent purge and return a safe blocked result without deleting data.
- Report tests prove accessible-branch scoping, cost-free operational payloads, direct financial
  denial for Branch Manager/Production/Inventory roles, exact Super-Admin cost results, and no
  supplier-price or protected raw fields.
- Backup tests prove only `service_role` records sanitized metadata, identical calls replay safely,
  identity fields are stable, and only `backup.manage` reads status/history.

## Security posture

- Financial report authorization is enforced inside `get_financial_report()`, not only by hidden UI
  cards or route checks. Operational report columns are allowlisted and contain no cost/value data.
- Every Phase 9 mutating RPC is `SECURITY DEFINER`, fixes `search_path = public`, validates the real
  actor, permission, reason, target, and stable idempotency key, and appends audit evidence.
- RLS is enabled on all Phase 9 tables; authenticated direct DML is absent. Triggers block direct
  lifecycle updates and hard deletes for authenticated/service-role callers. Database-owner access
  is reserved for migrations, controlled recovery, and isolated test maintenance.
- Backup metadata rejects credential/path-like provider values and never stores URLs, object keys,
  database names, tokens, or raw errors. Restore execution remains external and human-approved.
- Report and lifecycle UI errors are allowlisted/generic; raw SQL, auth internals, UUIDs, and
  dependency identifiers are not displayed. The service-role client remains server-only.
- No Phase 9 function writes inventory balances, lots, transactions, or transaction lines. The
  atomic append-only ledger remains the only quantity mutation path.

## Verification

- A clean local rebuild applies migrations 0001–0032 and the development seed recreates all four
  role accounts.
- Prettier, ESLint, strict TypeScript, production build, and client-bundle secret scan pass.
- Vitest passes 64/64 unit tests and 69/69 real-database integration tests (133 total).
- The production build succeeds with 39 application routes, including `/reports`,
  `/reports/[type]`, `/reports/[type]/export`, `/admin/recycle-bin`, and `/admin/backups`.
- The configured local service-role key is absent from all 111 generated client-bundle files.
- Focused Phase 9 Playwright passes all 6 desktop/mobile cases. The full matrix passes 69 tests
  across Chromium and Pixel 7, with 5 intentional mobile skips for desktop-sidebar-only assertions
  (74 cases total).

## Known limitations / deferred

- Production backup credentials, storage, schedules, and restore execution must be provisioned in
  secured deployment infrastructure. Until it reports through `record_backup_run()`, the app
  correctly shows no recorded backup. Quarterly restore drills remain an operational obligation.
- Automatic purge scheduling is deployment infrastructure; this phase provides the idempotent,
  dependency-aware function and confirmed Super-Admin UI, but does not invent a hosted scheduler.
- Report requests are synchronous and intentionally limited to 366 days and 1,000 rows. Large
  asynchronous exports, saved report definitions, charts, and scheduled delivery are deferred.
- Excel output is SpreadsheetML `.xls`, not zipped `.xlsx`; PDF output is a compact deterministic
  table rather than a full document-design engine.
- Lifecycle commands cover the explicitly documented business roots. Ledger/accounting records and
  finalized history are deliberately outside the recycle bin.

## Next phase

Phase 10 — Offline & POS Preparation: offline drafts, sync queue and conflict review, barcode
scanning, Loyverse mapping tables, CSV import preview/confirmation, and POS interfaces without live
sync.
