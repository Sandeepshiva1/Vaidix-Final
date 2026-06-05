#!/usr/bin/env bash
# HARDENING-PLAN.md item #5 — restore from a backup directory.
# Usage: ./scripts/restore.sh /backup/20260425T030000Z
#
# This drops the target DB and re-creates it from the dump. RUN A DRILL BEFORE
# YOU NEED IT. Drill cadence = monthly; record outcomes in
# docs/RUNBOOK-BACKUP.md.

set -euo pipefail

SRC="${1:-}"
if [ -z "$SRC" ] || [ ! -d "$SRC" ]; then
  echo "usage: $0 <backup-dir>" >&2
  exit 2
fi

KEY="/etc/vaidix/backup.key"
if [ ! -f "$KEY" ]; then
  echo "[restore] missing age private key at $KEY" >&2
  exit 2
fi

cd "$SRC"
sha256sum -c SHA256SUMS

# Postgres
echo "[restore] decrypting + restoring postgres..."
age -d -i "$KEY" pg.dump.age | pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL"

# MinIO
echo "[restore] decrypting + restoring minio..."
mkdir -p ./_minio_restore
age -d -i "$KEY" minio.tar.age | tar -xf - -C ./_minio_restore
mc alias set vaidix-rs "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
mc mirror --quiet --overwrite ./_minio_restore/minio "vaidix-rs/$S3_BUCKET"
rm -rf ./_minio_restore

echo "[restore] OK from $SRC"
