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

- Quarterly: restore the latest export into a scratch project and run smoke e2e. Update the backup
  run verification timestamp and record the result and measured RTO in `CHANGELOG.md`.

## Recycle bin vs backup

Soft-deleted business records live 30 days in the recycle bin (Super Admin restore) and are then
purged **unless** protected by an explicit hold, an inbound business dependency, or ledger/
accounting history. Audit evidence survives eligible business-record purge. Backups are the
disaster-recovery layer; the recycle bin is user-facing undo. The two are independent.
