#!/usr/bin/env bash
# Wrapper invoked by Windows Task Scheduler (via Git Bash) to run the daily prod backup
# with logging, a Docker precheck, and local retention. See scripts/backup-prod.sh and
# docs/BACKUP_AND_RECOVERY.md. Appends every run to backups/backup.log.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Task Scheduler runs with a minimal environment — put supabase (scoop) and docker on PATH.
export PATH="$HOME/scoop/shims:/c/Program Files/Docker/Docker/resources/bin:$PATH"
LOG="$REPO_ROOT/backups/backup.log"
mkdir -p "$REPO_ROOT/backups"

{
  echo "===== backup run $(date '+%Y-%m-%d %H:%M:%S %z') ====="

  if ! docker info >/dev/null 2>&1; then
    echo "ERROR: Docker is not running — supabase db dump needs it. Backup skipped."
    echo ""
    exit 1
  fi

  bash "$REPO_ROOT/scripts/backup-prod.sh"
  rc=$?

  if [ "$rc" -eq 0 ]; then
    # Local retention: drop dumps older than 30 days (off-site copy is the long-term store).
    find "$REPO_ROOT/backups" -name 'prod-*.sql' -type f -mtime +30 -delete 2>/dev/null || true
    echo "backup OK; pruned local dumps older than 30 days"
  else
    echo "backup FAILED (rc=$rc) — check the errors above"
  fi
  echo ""
  exit "$rc"
} >>"$LOG" 2>&1
