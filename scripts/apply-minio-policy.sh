#!/usr/bin/env bash
# HARDENING-PLAN.md item #10 — apply prefix-scoped bucket policy to MinIO.
# Run on the deploy host once after bucket exists. Re-running is idempotent.
#
# Required env (typically loaded by ./scripts/load-env.sh):
#   S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY

set -euo pipefail

if ! command -v mc >/dev/null 2>&1; then
  echo "[minio-policy] mc (MinIO client) not found. Install from https://min.io/docs/minio/linux/reference/minio-mc.html"
  exit 2
fi

ALIAS="vaidix"
mc alias set "$ALIAS" "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null

# 1. Create the dedicated app service account if missing.
if ! mc admin user info "$ALIAS" vaidix-app >/dev/null 2>&1; then
  APP_SECRET="$(openssl rand -hex 32)"
  echo "[minio-policy] creating user vaidix-app — record this secret in vault:"
  echo "[minio-policy]   S3_APP_SECRET=$APP_SECRET"
  mc admin user add "$ALIAS" vaidix-app "$APP_SECRET" >/dev/null
fi

# 2. Apply the bucket policy.
mc anonymous set none "$ALIAS/$S3_BUCKET" || true
mc admin policy create "$ALIAS" vaidix-app-policy "$(dirname "$0")/minio-policy.json"
mc admin policy attach "$ALIAS" vaidix-app-policy --user vaidix-app

# 3. Lifecycle — auto-expire raw recordings staging area.
cat > /tmp/lifecycle.json <<'EOF'
{
  "Rules": [
    { "ID": "expire-raw-recordings-after-90d", "Status": "Enabled",
      "Filter": { "Prefix": "recordings/raw/" },
      "Expiration": { "Days": 90 } },
    { "ID": "expire-dsr-exports-after-7d", "Status": "Enabled",
      "Filter": { "Prefix": "dsr-export/" },
      "Expiration": { "Days": 7 } }
  ]
}
EOF
mc ilm import "$ALIAS/$S3_BUCKET" < /tmp/lifecycle.json
rm -f /tmp/lifecycle.json

echo "[minio-policy] OK"
echo "[minio-policy] reminder: switch the app's S3_ACCESS_KEY/S3_SECRET_KEY to the vaidix-app account before next deploy"
