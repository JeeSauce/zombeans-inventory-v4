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
    # --- Encrypted off-site copy to Google Drive ---
    # Bundle the day's four dumps, gzip, AES-256 encrypt (PBKDF2), upload only the .enc file.
    # Decrypt with: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:PASSFILE \
    #                 -in <file>.tar.gz.enc | tar -xzf -
    PASSFILE="$HOME/.zombeans-backup-pass"
    DRIVE_DIR="/e/My Drive/Zombeans-Backups"
    DATE="$(date +%F)"
    ARCHIVE="$REPO_ROOT/backups/zombeans-backup-$DATE.tar.gz.enc"
    if [ ! -f "$PASSFILE" ]; then
      echo "WARN: passphrase file $PASSFILE missing — off-site copy skipped"
    elif [ ! -d "/e/My Drive" ]; then
      echo "WARN: Google Drive (E:\\My Drive) not mounted — off-site copy skipped"
    else
      # openssl here is a native Windows binary — give it Windows paths (cygpath), not /c/... .
      PASSFILE_W="$(cygpath -m "$PASSFILE")"
      ARCHIVE_W="$(cygpath -m "$ARCHIVE")"
      if tar -czf - -C "$REPO_ROOT/backups" \
           "prod-roles-$DATE.sql" "prod-schema-$DATE.sql" \
           "prod-data-$DATE.sql" "prod-auth-data-$DATE.sql" \
         | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$PASSFILE_W" -out "$ARCHIVE_W" \
         && [ -s "$ARCHIVE" ]; then
        mkdir -p "$DRIVE_DIR"
        cp "$ARCHIVE" "$DRIVE_DIR/"
        echo "off-site OK: $DRIVE_DIR/$(basename "$ARCHIVE") ($(du -h "$ARCHIVE" | cut -f1))"
        find "$DRIVE_DIR" -name 'zombeans-backup-*.tar.gz.enc' -mtime +90 -delete 2>/dev/null || true
      else
        echo "ERROR: encrypt/upload failed — off-site copy NOT made"
        rm -f "$ARCHIVE"
      fi
    fi
    # Local retention: drop plaintext dumps and local encrypted archives older than 30 days.
    find "$REPO_ROOT/backups" -name 'prod-*.sql' -type f -mtime +30 -delete 2>/dev/null || true
    find "$REPO_ROOT/backups" -name 'zombeans-backup-*.tar.gz.enc' -type f -mtime +30 -delete 2>/dev/null || true
    echo "backup OK; off-site synced; pruned local files older than 30 days"
  else
    echo "backup FAILED (rc=$rc) — check the errors above"
  fi
  echo ""
  exit "$rc"
} >>"$LOG" 2>&1
