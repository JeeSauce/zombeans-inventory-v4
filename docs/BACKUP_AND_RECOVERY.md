# Backup & Recovery

## Strategy

| Layer              | Mechanism                                          | Frequency        | Retention       |
| ------------------ | -------------------------------------------------- | ---------------- | --------------- |
| Managed            | Supabase automated backups (PITR where available)  | continuous/daily | per plan        |
| Independent export | `pg_dump` of production to secure off-site storage | daily            | 30 days         |
| Weekly retained    | tagged weekly export                               | weekly           | 12 weeks        |
| Migrations         | version-controlled SQL in `supabase/migrations/`   | per change       | permanent (git) |

## Rules

- Never commit credentials or backup files containing production data (`.gitignore` blocks
  `/backups/`, `*.dump`, `*.sql.gz`).
- Backups are encrypted at rest; access is least-privilege.
- Audit logs (≥ 7 years) and the ledger (effectively permanent) are included in every export and
  are never purged by the recycle-bin job.
- Backup execution and restore credentials remain outside the application. `/admin/backups` reads
  sanitized status metadata only; it cannot start a backup or restore a database.

## Backup procedure (independent daily export)

```bash
# Runs from a secured CI/cron context with prod DB URL in a secret (never in the repo).
pg_dump "$PROD_DB_URL" --format=custom --file "backups/zombeans-$(date +%F).dump"
# upload to encrypted off-site bucket, then remove local copy
```

After secure storage and verification, the job calls `record_backup_run(...)` as `service_role`.
Use a stable run key and report only a human reference, mechanism, status, safe provider label,
encryption flag, timestamps, retention date, size, verification time, and sanitized failure
summary. Paths, URLs, database names, credentials, tokens, and raw provider errors are rejected or
must never be supplied. Replaying identical metadata is safe; changing identity fields is rejected.

If no job has reported a run, `/admin/backups` states **No backup runs recorded**. It must never
infer health from policy text or from application uptime.

## Restore procedure

1. Provision a scratch Supabase project (or local instance).
2. `pg_restore --clean --if-exists --dbname "$TARGET_DB_URL" backups/zombeans-YYYY-MM-DD.dump`
3. Run `npm run typecheck`/smoke e2e against the restored DB.
4. For production recovery, prefer Supabase PITR to a timestamp; use the export only if PITR is
   unavailable.
5. Production restore is an external, human-approved incident procedure. Confirm the target twice,
   preserve the pre-restore state, record the incident/audit evidence, and never run destructive
   restore commands from the web application.

## Restore testing

- Every change: `npm run test:recovery` exercises restore-before-purge, eligible purge,
  retention/ledger protection, surviving audit evidence, direct-write backstops, and sanitized
  backup metadata against local Postgres. The full integration job also includes these checks.
- Quarterly: restore the latest export into an isolated scratch project and complete the manual
  drill below. Update the backup run verification timestamp and record the measured RTO/RPO and
  evidence reference in `CHANGELOG.md`.

## Automated recovery drill

Prerequisites: local Supabase is running and the database has been reset through the latest
migration.

```bash
npm run db:reset
npm run test:recovery
```

The drill passes only when all of these controls hold:

1. A soft-deleted record is invisible to ordinary roles, visible in the Super Admin recycle bin,
   and restores its exact business fields.
2. Restore and purge idempotency keys replay the original result without duplicating effects.
3. An expired, dependency-free record purges, while an in-window record, an explicit retention
   hold, and an inventory item referenced by the append-only stock ledger survive.
4. Pre-existing audit evidence and the purge audit event remain queryable after the business row
   is gone.
5. Authenticated users cannot bypass lifecycle functions with direct updates or hard deletes.
6. Only the external `service_role` backup job can record sanitized backup metadata; Super Admin
   can read that status, and ordinary roles cannot.

## Quarterly scratch-restore drill

This is an operator-run procedure. It must never target the production database.

1. Select the newest successful, encrypted export whose checksum and retention metadata are
   available. Record its backup reference and expected point in time (RPO).
2. Provision an empty local or scratch Supabase target. Confirm the target identifier twice and
   preserve the pre-drill state if the target is not disposable.
3. Verify the export checksum, inspect it with `pg_restore --list`, then restore with
   `pg_restore --clean --if-exists --exit-on-error --dbname "$SCRATCH_DB_URL" <dump>`.
4. Confirm the migration history reaches the repository's latest migration and no restore errors
   were ignored.
5. Compare source evidence captured by the backup job with restored row counts for
   `stock_transactions`, `stock_transaction_lines`, and `audit_logs`. Verify there are no orphaned
   ledger lines and no missing audit references expected by the manifest.
6. Point a non-production app instance at the scratch target and run typecheck, unit tests, the
   recovery drill, and representative smoke E2E for login, dashboard, stock history, and audit.
7. Record elapsed restore time (RTO), observed data gap (RPO), checksum, test results, operator,
   target, and evidence location. Destroy the scratch target after the retention window.

Acceptance criteria: checksum valid; restore exits zero; latest migration present; ledger/audit
invariants match the backup manifest; smoke checks pass; measured RTO/RPO meet the incident plan;
no production target or credential appears in logs or committed files.

### Phase 11 evidence

On 2026-07-14 the local database rebuilt cleanly through migration `0036`, and the automated
recovery drill passed. This proves the repository-controlled lifecycle and recovery invariants; it
does **not** claim that a real production export was restored. The first scratch restore remains an
operator-owned deployment prerequisite.

## Recycle bin vs backup

Soft-deleted business records live 30 days in the recycle bin (Super Admin restore) and are then
purged **unless** protected by an explicit hold, an inbound business dependency, or ledger/
accounting history. Audit evidence survives eligible business-record purge. Backups are the
disaster-recovery layer; the recycle bin is user-facing undo. The two are independent.
