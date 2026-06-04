#!/usr/bin/env bash
# HARDENING-PLAN.md item #3 — decrypt vaidix.env.enc into .env on this host.
# Run on the target host before `docker compose -f docker-compose.prod.yml up`.
#
# Reads the age private key from /etc/vaidix/age.key (root-owned, 0600).
# Writes .env (mode 0600, removed by `unload-env.sh` after compose stops).

set -euo pipefail

KEY_FILE="/etc/vaidix/age.key"
SEALED="vaidix.env.enc"
OUT=".env"

if ! command -v age >/dev/null 2>&1; then
  echo "[load-env] age is not installed."
  exit 2
fi

if [ ! -f "$KEY_FILE" ]; then
  echo "[load-env] age private key not found at $KEY_FILE (must be root-owned, mode 0600)"
  exit 2
fi

if [ ! -f "$SEALED" ]; then
  echo "[load-env] sealed env file $SEALED not found"
  exit 2
fi

umask 077
age --decrypt --identity "$KEY_FILE" --output "$OUT" "$SEALED"
chmod 600 "$OUT"

echo "[load-env] decrypted → $OUT (mode 0600)"
echo "[load-env] now: docker compose -f docker-compose.prod.yml --env-file .env up -d"
