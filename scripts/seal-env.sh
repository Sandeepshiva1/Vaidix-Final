#!/usr/bin/env bash
# HARDENING-PLAN.md item #3 — encrypt .env.prod into vaidix.env.enc.
#
# Usage (operator, on a trusted machine):
#   1. Make sure ./age.pub exists (the recipient public key, see secret-rotate
#      runbook). Never commit the private key.
#   2. Edit .env.prod with the real production secrets.
#   3. Run: ./scripts/seal-env.sh
#   4. Commit vaidix.env.enc to the deploy artefacts (or scp to host).
#   5. Securely delete .env.prod.
#
# Decryption is done at boot by ./scripts/load-env.sh on the target host.

set -euo pipefail

if ! command -v age >/dev/null 2>&1; then
  echo "[seal-env] age is not installed. apt: 'apt install age'  brew: 'brew install age'"
  exit 2
fi

if [ ! -f .env.prod ]; then
  echo "[seal-env] expected .env.prod with the real production secrets — not found."
  exit 2
fi

if [ ! -f age.pub ]; then
  echo "[seal-env] age.pub (recipient public key) not found in repo root."
  echo "         generate a keypair on the deploy host once with: age-keygen -o age.key"
  echo "         then copy ONLY the public line into ./age.pub"
  exit 2
fi

RECIPIENT="$(cat age.pub | tr -d '\n\r')"

age --recipient "$RECIPIENT" --output vaidix.env.enc .env.prod

echo "[seal-env] OK → vaidix.env.enc"
echo "[seal-env] reminder: shred -u .env.prod"
