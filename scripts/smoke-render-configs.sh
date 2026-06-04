#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Vaidix — render-configs.sh smoke (proves the validator + render works)
# ════════════════════════════════════════════════════════════════════════════
# Validates the v2.7 deploy guard: render-configs.sh MUST refuse to render
# when any required env var contains "CHANGE_ME" or is empty, MUST refuse
# when COTURN_EXTERNAL_IP isn't an IPv4, and MUST produce correctly
# substituted output when given clean values.
#
# Why this exists: the v2.4 + v2.7 incident class was placeholder text
# shipping to prod inside tracked config files. Catching the validator
# regression at build time means the next time someone weakens the guard
# (or adds a new template var without registering it), CI fails before
# merge — not at 11pm when a faculty member can't join a session.
#
# Usage (run from repo root):
#   ./scripts/smoke-render-configs.sh
#
# Exit 0 = all cases pass; non-zero = something regressed.
# ════════════════════════════════════════════════════════════════════════════

set -uo pipefail   # NOT -e: we want to catch deliberate failures in cases

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Work in a temp dir; copy templates + script there. We never touch the
# real .env or rendered files in the repo root.
TMP="$(mktemp -d -t vaidix-smoke-render.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

cp turnserver.conf.tpl     "$TMP/"
cp livekit.prod.yaml.tpl   "$TMP/"
cp egress.yaml.tpl         "$TMP/"
cp scripts/render-configs.sh "$TMP/render-configs.sh"
mkdir -p "$TMP/scripts"
cp scripts/render-configs.sh "$TMP/scripts/render-configs.sh"

PASS=0
FAIL=0

case_label() {
  printf "\n[%02d] %s\n" "$((PASS + FAIL + 1))" "$1"
}
ok() {
  printf "     ✓ %s\n" "$1"
  PASS=$((PASS + 1))
}
bad() {
  printf "     ✗ %s\n" "$1"
  FAIL=$((FAIL + 1))
}

run_render() {
  # Run render-configs in the temp dir. Capture stdout+stderr together.
  ( cd "$TMP" && bash scripts/render-configs.sh ) 2>&1
}

write_env() {
  cat > "$TMP/.env" <<EOF
$1
EOF
}

# A clean env that should succeed.
CLEAN_ENV='LIVEKIT_INTERNAL_WS_URL="ws://livekit:7880"
TURN_SHARED_SECRET="test-real-secret-32-chars-abcdef"
COTURN_EXTERNAL_IP="13.234.37.54"
COTURN_REALM="turn.test.local"
LIVEKIT_API_KEY="devkey"
LIVEKIT_API_SECRET="test-api-secret-32-chars-abcdef0"'

# ─── Case 1: clean env renders all three files ─────────────────────────────

case_label "clean env renders all three configs without error"
write_env "$CLEAN_ENV"
OUT="$(run_render)"
RC=$?
if [ $RC -eq 0 ]; then
  ok "render exit 0"
else
  bad "render exit $RC; output: $(echo "$OUT" | tail -3)"
fi
[ -f "$TMP/turnserver.conf" ]   && ok "turnserver.conf written"   || bad "turnserver.conf missing"
[ -f "$TMP/livekit.prod.yaml" ] && ok "livekit.prod.yaml written" || bad "livekit.prod.yaml missing"
[ -f "$TMP/egress.yaml" ]       && ok "egress.yaml written"       || bad "egress.yaml missing"

# ─── Case 2: rendered files have the env values substituted in ─────────────

case_label "rendered turnserver.conf contains the real secret + external-ip"
if grep -q "user=livekit:test-real-secret-32-chars-abcdef" "$TMP/turnserver.conf"; then
  ok "user=livekit:<TURN_SHARED_SECRET> substituted"
else
  bad "user line missing or wrong: $(grep '^user=' "$TMP/turnserver.conf" 2>&1)"
fi
if grep -q "external-ip=13.234.37.54" "$TMP/turnserver.conf"; then
  ok "external-ip=<COTURN_EXTERNAL_IP> substituted"
else
  bad "external-ip line missing or wrong: $(grep '^external-ip' "$TMP/turnserver.conf" 2>&1)"
fi
if grep -q "realm=turn.test.local" "$TMP/turnserver.conf"; then
  ok "realm=<COTURN_REALM> substituted"
else
  bad "realm line missing or wrong: $(grep '^realm' "$TMP/turnserver.conf" 2>&1)"
fi

case_label "rendered livekit.prod.yaml contains matching TURN config"
if grep -q "credential: test-real-secret-32-chars-abcdef" "$TMP/livekit.prod.yaml"; then
  ok "credential: <TURN_SHARED_SECRET> substituted (same value as turnserver.conf — by construction)"
else
  bad "credential line missing or wrong"
fi
if grep -q "host: turn.test.local" "$TMP/livekit.prod.yaml"; then
  ok "host: <COTURN_REALM> substituted"
else
  bad "host line missing or wrong"
fi
if grep -q "devkey: test-api-secret-32-chars-abcdef0" "$TMP/livekit.prod.yaml"; then
  ok "<LIVEKIT_API_KEY>: <LIVEKIT_API_SECRET> substituted"
else
  bad "keys block missing or wrong: $(grep -A1 'keys:' "$TMP/livekit.prod.yaml" 2>&1)"
fi

# ─── Case 3: NO rendered file may contain a CHANGE_ME placeholder ──────────

case_label "rendered files contain ZERO 'CHANGE_ME' placeholders (prod-safety invariant)"
if ! grep -l CHANGE_ME "$TMP/turnserver.conf" "$TMP/livekit.prod.yaml" "$TMP/egress.yaml" >/dev/null 2>&1; then
  ok "no CHANGE_ME in any rendered file"
else
  bad "CHANGE_ME leaked into rendered output: $(grep -l CHANGE_ME "$TMP"/*.{conf,yaml})"
fi

# ─── Case 4: env with CHANGE_ME in TURN_SHARED_SECRET aborts render ────────

case_label "render REFUSES when TURN_SHARED_SECRET contains CHANGE_ME"
write_env 'LIVEKIT_INTERNAL_WS_URL="ws://livekit:7880"
TURN_SHARED_SECRET="CHANGE_ME_STRONG_TURN_PASSWORD"
COTURN_EXTERNAL_IP="13.234.37.54"
COTURN_REALM="turn.test.local"
LIVEKIT_API_KEY="devkey"
LIVEKIT_API_SECRET="test-api-secret"'
OUT="$(run_render)"
RC=$?
if [ $RC -ne 0 ]; then
  ok "render exit $RC (non-zero, correctly refused)"
else
  bad "render exit 0 — should have refused the CHANGE_ME placeholder!"
fi
if echo "$OUT" | grep -q "TURN_SHARED_SECRET still contains placeholder"; then
  ok "error message names the offending var"
else
  bad "error message did not name the offending var; got: $(echo "$OUT" | tail -3)"
fi

# ─── Case 5: empty COTURN_EXTERNAL_IP aborts render ────────────────────────

case_label "render REFUSES when COTURN_EXTERNAL_IP is empty"
write_env 'LIVEKIT_INTERNAL_WS_URL="ws://livekit:7880"
TURN_SHARED_SECRET="ok-secret-32-chars-aaaaaaaaaaa"
COTURN_EXTERNAL_IP=""
COTURN_REALM="turn.test.local"
LIVEKIT_API_KEY="devkey"
LIVEKIT_API_SECRET="test-api-secret"'
OUT="$(run_render)"
RC=$?
if [ $RC -ne 0 ]; then
  ok "render exit $RC (non-zero, correctly refused)"
else
  bad "render exit 0 — should have refused the empty value!"
fi
if echo "$OUT" | grep -q "COTURN_EXTERNAL_IP is empty"; then
  ok "error message names COTURN_EXTERNAL_IP"
else
  bad "error message did not name COTURN_EXTERNAL_IP"
fi

# ─── Case 6: COTURN_EXTERNAL_IP that's a DNS name (not IPv4) aborts ────────

case_label "render REFUSES when COTURN_EXTERNAL_IP is a DNS name (operator confusion guard)"
write_env 'LIVEKIT_INTERNAL_WS_URL="ws://livekit:7880"
TURN_SHARED_SECRET="ok-secret-32-chars-aaaaaaaaaaa"
COTURN_EXTERNAL_IP="turn.example.org"
COTURN_REALM="turn.example.org"
LIVEKIT_API_KEY="devkey"
LIVEKIT_API_SECRET="test-api-secret"'
OUT="$(run_render)"
RC=$?
if [ $RC -ne 0 ]; then
  ok "render exit $RC (correctly rejected DNS name in IP-only field)"
else
  bad "render exit 0 — DNS name passed IPv4 sanity check"
fi
if echo "$OUT" | grep -q "should be a bare IPv4"; then
  ok "error message guides to fix"
fi

# ─── Case 7: bad LIVEKIT_INTERNAL_WS_URL scheme aborts ─────────────────────

case_label "render REFUSES when LIVEKIT_INTERNAL_WS_URL doesn't start with ws:// or wss://"
write_env 'LIVEKIT_INTERNAL_WS_URL="http://livekit:7880"
TURN_SHARED_SECRET="ok-secret-32-chars-aaaaaaaaaaa"
COTURN_EXTERNAL_IP="13.234.37.54"
COTURN_REALM="turn.test.local"
LIVEKIT_API_KEY="devkey"
LIVEKIT_API_SECRET="test-api-secret"'
OUT="$(run_render)"
RC=$?
if [ $RC -ne 0 ]; then
  ok "render exit $RC (correctly rejected http:// scheme)"
else
  bad "render exit 0 — http:// passed the ws://|wss:// guard"
fi

# ─── Case 8: missing .env aborts ───────────────────────────────────────────

case_label "render REFUSES when .env is missing entirely"
rm -f "$TMP/.env"
OUT="$(run_render)"
RC=$?
if [ $RC -ne 0 ]; then
  ok "render exit $RC (correctly aborted on missing .env)"
else
  bad "render exit 0 with no .env present"
fi
if echo "$OUT" | grep -q ".env not found"; then
  ok ".env-not-found message present"
fi

# ─── Summary ───────────────────────────────────────────────────────────────

echo ""
if [ $FAIL -eq 0 ]; then
  echo "render-configs smoke — PASS ($PASS / $PASS checks)"
  exit 0
else
  echo "render-configs smoke — FAIL ($FAIL of $((PASS + FAIL)) failed)"
  exit 1
fi
