#!/usr/bin/env bash
# Daily logical backup of the PRODUCTION Supabase project.
#
# Why this exists: production runs on the Supabase FREE tier, which has NO managed
# PITR/daily backups. These logical dumps are the ONLY disaster-recovery layer, so run
# this at least daily and copy the output off-machine (encrypted). See docs/BACKUP_AND_RECOVERY.md.
#
# Uses the Supabase CLI (`supabase db dump --linked`) so no standalone pg_dump install is
# needed and no DB password is handled in plaintext (the linked credentials are cached).
#
# Produces four files under backups/ (all gitignored):
#   prod-roles-DATE.sql      cluster roles
#   prod-schema-DATE.sql     public schema (tables, RLS, functions, triggers)
#   prod-data-DATE.sql       public data (COPY)
#   prod-auth-data-DATE.sql  auth accounts (login users) — excluded from the default dump
#
# Full-fidelity restore target is a FRESH Supabase project (it provides the auth/storage/
# vault/migrations infrastructure the logical dump omits). Restore order:
#   roles -> schema -> public data -> auth data.  Load data with FKs/triggers disabled
#   (`SET session_replication_role = replica;`) to sidestep the stock_transactions<->transfers
#   circular FK. Verified restore RTO on 2026-07-16 was ~4s (near-empty prod).
set -euo pipefail

PROD_REF="kegvbhqkorsqyyaqosyd"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$REPO_ROOT/backups"
DATE="$(date +%F)"

# Safety: refuse to run unless the CLI is linked to PROD (never back up the wrong project).
LINKED="$(cat "$REPO_ROOT/supabase/.temp/project-ref" 2>/dev/null || echo "")"
if [ "$LINKED" != "$PROD_REF" ]; then
  echo "ERROR: Supabase CLI is linked to '$LINKED', not prod ($PROD_REF)." >&2
  echo "Run: supabase link --project-ref $PROD_REF   then re-run this script." >&2
  exit 1
fi

mkdir -p "$OUT"
echo "Backing up prod ($PROD_REF) -> $OUT (date $DATE)"

supabase db dump --linked --role-only            -f "$OUT/prod-roles-$DATE.sql"
supabase db dump --linked                        -f "$OUT/prod-schema-$DATE.sql"
supabase db dump --linked --data-only --use-copy -f "$OUT/prod-data-$DATE.sql"
supabase db dump --linked --data-only -s auth    -f "$OUT/prod-auth-data-$DATE.sql"

echo "Done. Files:"
ls -la "$OUT"/*"$DATE".sql
echo "REMINDER: copy these to encrypted off-site storage, then they may be removed locally."
