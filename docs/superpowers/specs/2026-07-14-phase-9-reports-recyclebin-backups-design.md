# Phase 9 — Reports, Exports, Recycle Bin, Backups — Design Specification

Date: 2026-07-14

Branch: `codex/phase-9-reports-recyclebin-backups`

## Goal

Add branch-aware operational and Super-Admin financial reports, server-generated CSV/Excel/PDF
exports and print output, a dependency-aware 30-day recycle bin, and a backup status/history
surface. The Phase 9 gate must pass against local Postgres: restore before purge, purge only when
eligible, and audit history surviving both soft deletion and hard purge.

## Baseline

Phase 9 starts from merged `origin/main` commit `99dab82`, which includes Phase 8. The clean local
baseline applies migrations 0001–0029, seeds all four development roles, passes 58 unit and 62
real-Postgres integration tests, builds 34 routes, and keeps the service-role key out of 98 client
bundle files. All 68 Playwright cases executed successfully (63 pass and five intentional mobile
skips); on Windows the completed runner retained its web-server process until the command timeout.

## Scope

- A report catalog at `/reports` and detail pages at `/reports/[type]` with validated date range,
  branch, category, and item-type filters.
- Operational inventory, stock movement, production output, and recount variance reports for
  authenticated operational roles, always limited to accessible branches.
- Financial inventory valuation and frozen movement-cost reports available only through a
  `cost.read`-checking database function and rendered only to Super Admin.
- Server-only CSV, Excel-compatible SpreadsheetML, and PDF generation from the same already-gated
  report result used by the page, plus a print stylesheet/action.
- Soft deletion, Super-Admin restore, dependency-aware purge, lifecycle command history, explicit
  retention holds, and a Super-Admin recycle-bin page.
- Backup run metadata, a `backup.manage`-gated status/history page, and an audited service-role RPC
  for secured CI/cron to record non-secret run metadata.
- Zod validation, permission checks, RLS/grants, audit logging, responsive real-data UI states,
  unit/integration/authorization/Playwright coverage, and updated recovery documentation.

Out of scope: running `pg_dump` or PITR from the web app, storing backup data or credentials in the
repository/database metadata surface, production scheduler provisioning, offline/sync, POS import,
and deployment hardening.

## Report model

### Report catalog and filters

Phase 9 supports these stable slugs:

| Slug                  | Class       | Source and intent                                           |
| --------------------- | ----------- | ----------------------------------------------------------- |
| `inventory-balances`  | operational | Current quantity by accessible branch and active item       |
| `stock-movements`     | operational | Posted movement lines in the selected date range            |
| `production-output`   | operational | Completed production quantities in the selected range       |
| `recount-variances`   | operational | Frozen recount expected/physical/variance quantities        |
| `inventory-valuation` | financial   | Current quantity × protected weighted-average cost          |
| `movement-costs`      | financial   | Frozen `unit_cost_snapshot` values from posted ledger lines |

Every detail request validates ISO dates, enforces start ≤ end, caps the range at 366 days, and
validates optional UUID/item-type filters in Zod and again inside Postgres. A selected branch must
pass `has_branch_access(auth.uid(), branch)`. An unselected branch means all branches for which the
same helper returns true. Deleted catalog records are excluded from ordinary report reads.

The database returns a common JSON envelope containing the report slug/title/class, generated UTC
timestamp, normalized filters, safe column definitions, rows, and summary. Rows use human branch
names, item names/SKUs, transaction references, dates, statuses, quantities, and unit codes. Raw
UUIDs are not report columns.

### Financial boundary and frozen values

`get_operational_report()` never selects or returns weighted costs, supplier prices, purchase
prices, unit-cost snapshots, or variance-value snapshots. `get_financial_report()` checks
`cost.read` before touching protected columns. A forged direct RPC call by any non-Super role must
fail.

Inventory valuation is explicitly a current-state report and uses current weighted-average cost.
Historical movement cost uses the frozen ledger-line cost snapshot and is never recomputed.
Operational recount output reports quantities only; protected variance values remain outside the
operational result. The same database boundary protects browser views and every export format.

## Exports

The export route handler authenticates the request, validates the same filter schema, calls the
same operational or financial report RPC, validates its safe envelope, and only then serializes it.
It never accepts browser-supplied rows or columns.

- CSV uses RFC 4180 escaping and UTF-8 with a BOM for spreadsheet compatibility.
- Excel output uses SpreadsheetML XML with an `.xls` filename and typed cells, avoiding a large
  client bundle dependency.
- PDF output uses a small server-only PDF writer with a report heading, filter summary, table rows,
  pagination, and escaped text.
- Print uses the rendered safe table and print-specific CSS; controls/navigation are suppressed.

Download filenames contain the report slug and Manila business date. Responses use attachment,
`nosniff`, private/no-store caching, and the appropriate content type. Export code never imports
the service-role client and no generation module is reachable from a client component.

## Recycle-bin domain model

### Supported roots

Lifecycle RPCs support six root business entities that already carry `deleted_at`, `deleted_by`,
and `purge_at`: category, inventory item, supplier, purchase order, recipe, and production
template. Child/history rows are not independently recycled. Catalog overlays remain hidden with
their deleted parent, while finalized/history records retain their own immutable data.

`soft_delete_record()` maps each entity type to its existing write permission, validates the actor,
locks the target and idempotency token, sets only the three lifecycle columns, and writes an audit
row plus append-only command row in the same transaction. It does not modify inventory, ledger,
cost snapshots, or the record's business values. The purge deadline is exactly deletion time plus
30 days.

Normal RLS continues to require `deleted_at IS NULL`. Deleted rows are exposed only through
`list_recycle_bin()`, which requires `recyclebin.restore` and returns safe labels/references,
deleter name, deletion/purge dates, and computed eligibility/reason. Direct hard delete and direct
changes to lifecycle columns are blocked by grants plus lifecycle guard triggers.

### Restore

`restore_recycle_record()` requires `recyclebin.restore`, so only the seeded Super Admin can call
it. It locks and replays by idempotency key before state checks, clears only the lifecycle columns,
and writes audit/command history atomically. All other columns remain byte-for-byte unchanged.
Restore before the purge deadline is permitted; a purged record cannot be restored. Unique or
structural conflicts fail safely without a partial restore.

### Retention dependencies and purge

Purge eligibility requires `purge_at <= now()` and no protection. Protection is computed from both
automatic historical dependencies and explicit `retention_holds`:

- an inventory item with balances, lots, ledger lines, recipe lines, or production/recount history
  is ledger/accounting protected;
- a supplier with purchasing or return history is accounting protected;
- a purchase order with lines/receipts is accounting protected;
- a recipe with activated versions, cost snapshots, templates, or production orders is accounting
  protected;
- a production template with production orders is ledger/accounting protected;
- a category with live child categories/items is structurally protected; and
- any active explicit ledger, audit, legal, or accounting hold protects any supported record.

The existence of an `audit_logs` row is not itself an active hold: every lifecycle action creates
audit history, and treating all audit rows as holds would make scenario 16 impossible. An explicit
audit hold represents a separately declared retention dependency. Audit rows have no cascading FK
to business records and are never deleted by the purge routine.

`purge_recycle_bin(run_key, limit)` is an idempotent scheduler/Super-Admin command. It locks one run
key, selects eligible expired rows with `FOR UPDATE SKIP LOCKED`, rechecks eligibility immediately
before each delete, writes a purge audit/command row, and hard-deletes only the eligible root.
Replaying a completed run returns its frozen result. Protected and not-yet-due rows remain visible
with their reason. The append-only ledger, cost snapshots, audit logs, legal/accounting history,
and protected business roots are never edited or purged.

## Backup metadata and recovery boundary

`backup_runs` stores non-secret operational metadata only: stable run key/reference, mechanism
(`managed`, `pg_dump`, `pitr_test`), status, start/completion timestamps, encrypted/verified flags,
retention deadline, size, safe storage provider label, safe failure summary, and audit timestamps.
It never stores a database URL, credential, dump path, object key, checksum secret, or backup data.

Authenticated access requires `backup.manage`; there is no authenticated DML. A service-role-only
`record_backup_run()` RPC lets secured CI/cron idempotently create/update metadata and writes an
audit row. The page shows latest status, policy, age/verification warnings, history, and the
documented restore-test procedure. An empty history is an honest warning state, not fake data.

Actual `pg_dump`, encryption, upload, retention deletion, PITR selection, and restore execution
stay in secured infrastructure with secrets. `/backups/`, `*.dump`, and `*.sql.gz` remain ignored.

## Atomicity and idempotency

- Every Phase 9 mutating RPC is `SECURITY DEFINER`, fixes `search_path = public`, validates the
  real actor/role, and revokes public execution.
- Stable command/run keys use unique constraints plus advisory locks. Replay lookup happens before
  stale lifecycle checks and returns the original frozen result.
- Soft delete, restore, lifecycle command history, and audit history commit or roll back together.
- Purge rechecks the due date and every dependency inside the delete transaction. A failed FK or
  changed dependency rolls back that record without deleting its audit trail.
- Report/export functions are read-only/stable and do not create ledger or inventory mutations.
- Backup metadata recording is idempotent and cannot trigger a backup or restore.

## Authorization, RLS, grants, and sensitive data

RLS is enabled on every new table. `retention_holds`, lifecycle commands, purge runs, and backup
runs receive no ordinary-role DML. Safe recycle-bin and backup reads require their Super-Admin-only
permissions. Service role is used only by secured server/CI paths and never reaches client code.

- All signed-in operational roles may use safe reports within branch scope.
- Only `cost.read` holders may call financial reports or export financial data.
- Only `recyclebin.restore` holders may list/restore deleted records; delete permission follows the
  entity's existing write permission.
- Only `backup.manage` holders may view backup metadata or invoke a manual purge; only service role
  may record backup-run metadata.
- Explicit column grants omit weighted cost, supplier price, PO totals/unit costs, frozen movement
  costs, and recount variance values from authenticated table access.
- UI and exports show names, SKUs, references, quantities, status, and safe retention reasons—never
  raw UUIDs, credentials, storage object identifiers, or protected financial columns.

## Server actions and UI states

Server actions parse Zod input, repeat `requirePermission()` for restore/purge, call actor-aware
RPCs with the session client, return explicit `{ error?, info? }` state, and revalidate affected
routes. Delete controls added to supported root pages use the same validated soft-delete RPC and a
confirmation dialog; no client component writes lifecycle columns.

`/reports`, `/reports/[type]`, `/admin/recycle-bin`, and `/admin/backups` include loading skeletons,
empty states, success content, warnings, and error boundaries. Tables remain horizontally usable on
mobile; filters are labelled and keyboard accessible; dates render in Asia/Manila; money uses
`₱1,234.56`; and print output is operationally clear in light mode.

## Phase gate mapping

- **Scenario 14 — restore before purge:** create a supported record, soft-delete it, prove ordinary
  RLS reads hide it and the Super-Admin recycle RPC shows it, restore with the same command twice,
  and prove every original business value returns unchanged. Direct ordinary-role restore calls
  fail at the permission/RPC boundary.
- **Scenario 15 — purge when eligible:** create an expired, dependency-free deleted record and
  prove one purge; create an inside-window record and an expired record with an active legal hold
  or ledger dependency and prove neither is deleted. Replay the run key and a later run to prove
  idempotency and rechecked protection.
- **Scenario 16 — audit survives deletion:** prove the delete audit remains after soft deletion,
  then purge an eligible record and prove its pre-delete, delete, and purge audit rows still exist
  and remain readable only with `audit.read`.

Additional real-Postgres coverage directly calls operational and financial report RPCs as all four
roles, asserts branch scoping, validates filters, searches unauthorized report/export JSON for
cost/supplier-price/variance-value keys, proves lifecycle column/hard-delete guards, and verifies
backup/recycle RLS. Unit tests cover report schemas and all export encoders; Playwright covers
desktop/mobile report filtering/export controls and Super-Admin-only admin routes.
