#!/usr/bin/env bash
# HARDENING-PLAN.md item #5 — encrypted backup of Postgres + MinIO.
# Run nightly via cron. Stores age-encrypted artefacts under /backup/<date>/
# and ships a copy to the off-host destination via rclone (operator config).

set -euo pipefail

# Cron runs with no inherited shell env, but this script needs DATABASE_URL +
# S3_* (the original cron entry ran the script bare, so a scheduled backup would
# exit 2 before doing anything — a silently-failing backup is worse than none).
# Self-load the deployment .env when those vars aren't already present. Manual
# runs that sourced ./scripts/load-env.sh first are unaffected.
if [ -z "${DATABASE_URL:-}" ]; then
  ENV_FILE="${BACKUP_ENV_FILE:-$(cd "$(dirname "$0")/.." && pwd)/.env}"
  if [ -f "$ENV_FILE" ]; then
    set -a; . "$ENV_FILE"; set +a
  fi
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST_LOCAL="/backup/$STAMP"
RECIPIENT="$(cat /etc/vaidix/backup.pub | tr -d '\n\r')"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[backup] DATABASE_URL must be set (./scripts/load-env.sh first)" >&2
  exit 2
fi
if [ -z "${S3_ENDPOINT:-}" ] || [ -z "${S3_BUCKET:-}" ]; then
  echo "[backup] S3 env vars must be set" >&2
  exit 2
fi

mkdir -p "$DEST_LOCAL"

echo "[backup] postgres -> $DEST_LOCAL/pg.dump.age"
pg_dump --format=custom --no-owner "$DATABASE_URL" \
  | age -r "$RECIPIENT" -o "$DEST_LOCAL/pg.dump.age"

echo "[backup] minio   -> $DEST_LOCAL/minio.tar.age"
mc alias set vaidix-bk "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
mc mirror --quiet "vaidix-bk/$S3_BUCKET" "$DEST_LOCAL/minio/" >/dev/null
tar -C "$DEST_LOCAL" -cf - minio/ \
  | age -r "$RECIPIENT" -o "$DEST_LOCAL/minio.tar.age"
rm -rf "$DEST_LOCAL/minio"

# Manifest for restore-time integrity check.
sha256sum "$DEST_LOCAL"/*.age > "$DEST_LOCAL/SHA256SUMS"

# Off-host replication (operator configures `rclone config` once for "vaidix-offsite").
if command -v rclone >/dev/null 2>&1 && rclone listremotes | grep -q '^vaidix-offsite:'; then
  echo "[backup] off-host -> vaidix-offsite:vaidix-backups/$STAMP"
  rclone copy "$DEST_LOCAL" "vaidix-offsite:vaidix-backups/$STAMP" --quiet
else
  echo "[backup] WARN: vaidix-offsite rclone remote not configured — keeping on-host only"
fi

# Retention: keep 30 daily + 12 monthly. Cheap-and-correct via mtime + xargs.
find /backup -mindepth 1 -maxdepth 1 -type d -mtime +30 \
  ! -regex '.*[0-9]\{8\}T01.*' -exec rm -rf {} + 2>/dev/null || true

echo "[backup] OK $STAMP"
