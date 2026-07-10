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

## Backup procedure (independent daily export)

```bash
# Runs from a secured CI/cron context with prod DB URL in a secret (never in the repo).
pg_dump "$PROD_DB_URL" --format=custom --file "backups/zombeans-$(date +%F).dump"
# upload to encrypted off-site bucket, then remove local copy
```

## Restore procedure

1. Provision a scratch Supabase project (or local instance).
2. `pg_restore --clean --if-exists --dbname "$TARGET_DB_URL" backups/zombeans-YYYY-MM-DD.dump`
3. Run `npm run typecheck`/smoke e2e against the restored DB.
4. For production recovery, prefer Supabase PITR to a timestamp; use the export only if PITR is
   unavailable.

## Restore testing

- Quarterly: restore the latest export into a scratch project and run smoke e2e. Record the result
  and the measured RTO in `CHANGELOG.md`.

## Recycle bin vs backup

Soft-deleted business records live 30 days in the recycle bin (Super Admin restore) and are then
purged **unless** protected by ledger/audit/legal/accounting dependencies. Backups are the
disaster-recovery layer; the recycle bin is user-facing undo. The two are independent.
