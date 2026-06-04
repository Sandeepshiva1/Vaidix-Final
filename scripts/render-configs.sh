#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Vaidix — render runtime config files from .tpl templates
# ════════════════════════════════════════════════════════════════════════════
# Several service config files (egress.yaml, turnserver.conf, livekit.prod.yaml)
# need secrets that the upstream binaries don't read from env vars directly.
# For each we keep a `.tpl` version in git with `${VAR}` placeholders,
# gitignore the rendered output, and run this script to substitute env
# values at deploy time.
#
# Usage (run from repo root):
#   ./scripts/render-configs.sh
#
# Run before `docker compose up` (the services bind-mount the rendered files).
# Re-running overwrites the rendered outputs — safe and idempotent.
#
# REFUSES TO RENDER when:
#   - required env var is empty / unset
#   - required env var contains the substring "CHANGE_ME"
#   - LIVEKIT_INTERNAL_WS_URL doesn't start with ws:// or wss://
#
# These guards exist because every "weird" outage in this stack has been a
# placeholder shipping to prod (the v2.4 egress storm = LAN IP in egress.yaml
# never replaced; the v2.7 TURN regression = CHANGE_ME_STRONG_TURN_PASSWORD
# literal staying in turnserver.conf because the operator forgot the sed).
# Validating up-front means a missing/placeholder secret aborts the deploy
# loudly here, not silently at runtime.
# ════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# Resolve repo root regardless of where the script is called from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v envsubst >/dev/null 2>&1; then
  echo "[render-configs] envsubst not found. Install with: sudo apt-get install -y gettext-base" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "[render-configs] .env not found at $REPO_ROOT/.env" >&2
  exit 1
fi

# Load .env so envsubst can see the variables. Use `set -a` so all assignments
# become exports automatically, regardless of whether .env quotes them.
set -a
# shellcheck disable=SC1091
. .env
set +a

# ─── Validation guards ─────────────────────────────────────────────────────

require_env() {
  local name="$1"
  local value="${!name:-}"
  if [ -z "$value" ]; then
    echo "[render-configs] required env var $name is empty or unset in .env" >&2
    exit 1
  fi
  case "$value" in
    *CHANGE_ME*)
      echo "[render-configs] env var $name still contains placeholder 'CHANGE_ME' — rotate it in .env first" >&2
      echo "[render-configs]   current value: $value" >&2
      exit 1
      ;;
  esac
}

# egress.yaml — LiveKit connection + API credentials (all three rendered).
# All three must match the values in livekit.prod.yaml (same .env source).
# A mismatch causes every egress job to fail with "Start signal not received":
# the egress Chrome bot is refused by LiveKit, the room never starts recording.
require_env LIVEKIT_INTERNAL_WS_URL
case "$LIVEKIT_INTERNAL_WS_URL" in
  ws://*|wss://*) ;;
  *)
    echo "[render-configs] LIVEKIT_INTERNAL_WS_URL must start with ws:// or wss:// (got: $LIVEKIT_INTERNAL_WS_URL)" >&2
    exit 1
    ;;
esac

# turnserver.conf + livekit.prod.yaml — shared TURN credentials and addressing
require_env TURN_SHARED_SECRET
require_env COTURN_EXTERNAL_IP
require_env COTURN_REALM
# Sanity: COTURN_EXTERNAL_IP should look like an IPv4. Catches the common
# error of putting the DNS name there ("turn.vaidix..." in COTURN_EXTERNAL_IP
# breaks coturn's allocation responses).
case "$COTURN_EXTERNAL_IP" in
  *[!0-9.]*)
    echo "[render-configs] COTURN_EXTERNAL_IP should be a bare IPv4, got: $COTURN_EXTERNAL_IP" >&2
    echo "[render-configs]   (the DNS name goes in COTURN_REALM)" >&2
    exit 1
    ;;
esac

# livekit.prod.yaml — token-mint keys (same as app .env)
require_env LIVEKIT_API_KEY
require_env LIVEKIT_API_SECRET

# ─── Render templates ──────────────────────────────────────────────────────

RENDERED=()
render() {
  local src="$1" out="$2" mode="${3:-644}"
  if [ ! -f "$src" ]; then
    echo "[render-configs] template missing: $src" >&2
    exit 1
  fi
  # Self-heal the "is a directory" footgun: if the stack was ever brought up
  # with `docker compose up` BEFORE this script ran, Docker found the bind
  # source ($out) missing and auto-created it as an empty DIRECTORY. Then
  # `envsubst > "$out"` fails with "Is a directory" and the container that
  # mounts it crash-loops on `read /etc/<cfg>: is a directory`. Remove the
  # stray dir so we can write the real file. The dir is empty + the repo root
  # is owned by the deploy user, so this rm needs no sudo even though Docker
  # created the dir as root (removal depends on the parent dir's perms).
  if [ -d "$out" ]; then
    echo "[render-configs] $out is a stray directory (created by a pre-render 'compose up') — removing"
    rm -rf "$out"
  fi
  envsubst < "$src" > "$out"
  # mode 644 by default — bind-mounted into containers running as non-root
  # uids (egress runs as its own user; coturn/coturn:latest runs as the
  # `coturn` system user, NOT root, despite network_mode:host). 640 owned
  # by the host deploy user blocks reads from inside those containers.
  # The host directory itself should be access-controlled.
  # An earlier comment claimed coturn runs as root under network_mode:host —
  # that's wrong: network mode is independent of uid, and the symptom was
  # coturn starting with NO config (empty realm, listener address only on
  # private IPs) because it could not read the mounted file.
  chmod "$mode" "$out"
  RENDERED+=("$out")
}

render egress.yaml.tpl        egress.yaml
render turnserver.conf.tpl    turnserver.conf       644
render livekit.prod.yaml.tpl  livekit.prod.yaml     640

echo "[render-configs] rendered:"
printf '  %s\n' "${RENDERED[@]}"
