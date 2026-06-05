#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Vaidix — infrastructure health check + auto-fix
# ════════════════════════════════════════════════════════════════════════════
# Verifies every layer that causes silent production failures:
#   - Container health (all vaidix-* services)
#   - Disk space on /var/lib/docker
#   - TURN/coturn reachability (UDP 3478, TCP 3478, relay ports 49152-65535)
#   - coturn config sanity (external-ip, credential match against .env)
#   - LiveKit config TURN credential match (prevents drift from coturn)
#   - MinIO CORS (PUT must be allowed from the app origin for file uploads)
#   - DNS resolution of COTURN_REALM (required for turn_servers host lookup)
#
# Usage (run from repo root, or anywhere — script cd's to repo root):
#   ./scripts/infra-check.sh               # check only
#   ./scripts/infra-check.sh --fix-cors    # also apply MinIO CORS fix
#   ./scripts/infra-check.sh --full-turn   # also run turnutils relay probe
#
# Exit codes:
#   0  all checks passed (or all fixable issues were fixed with --fix-cors)
#   1  one or more checks failed
# ════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

FIX_CORS=0
FULL_TURN=0
for arg in "$@"; do
  case "$arg" in
    --fix-cors)   FIX_CORS=1 ;;
    --full-turn)  FULL_TURN=1 ;;
    *)
      echo "[infra-check] unknown flag: $arg" >&2
      echo "[infra-check] valid flags: --fix-cors, --full-turn" >&2
      exit 1
      ;;
  esac
done

PASS=0; WARN=0; FAIL=0
pass() { echo "  [OK]  $*"; PASS=$((PASS+1)); }
warn() { echo "  [WARN] $*"; WARN=$((WARN+1)); }
fail() { echo "  [FAIL] $*"; FAIL=$((FAIL+1)); }
section() { echo; echo "── $* ──────────────────────────────────────────"; }

# ─── Load .env ────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "[infra-check] .env not found at $REPO_ROOT/.env — run ./scripts/load-env.sh first" >&2
  exit 1
fi
set -a; . .env; set +a

# Helpers
env_val() { local v="${!1:-}"; echo "$v"; }
env_ok() {
  local name="$1" val
  val="$(env_val "$name")"
  if [ -z "$val" ]; then
    fail "env var $name is empty/unset"
    return 1
  fi
  case "$val" in
    *CHANGE_ME*) fail "env var $name still holds placeholder CHANGE_ME"; return 1 ;;
  esac
  return 0
}

echo "[infra-check] repo root: $REPO_ROOT"
echo "[infra-check] $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ═══════════════════════════════════════════════════════════════════════════
section "1. Required env vars"
# ═══════════════════════════════════════════════════════════════════════════

for var in TURN_SHARED_SECRET COTURN_EXTERNAL_IP COTURN_REALM \
           LIVEKIT_API_KEY LIVEKIT_API_SECRET \
           LIVEKIT_INTERNAL_WS_URL S3_ENDPOINT S3_BUCKET \
           S3_ACCESS_KEY S3_SECRET_KEY; do
  if env_ok "$var"; then
    pass "$var is set"
  fi
done

# S3_PUBLIC_ENDPOINT is required in production; browsers cannot resolve
# the internal Docker hostname (minio:9000).
S3_PUB="$(env_val S3_PUBLIC_ENDPOINT)"
if [ -z "$S3_PUB" ]; then
  fail "S3_PUBLIC_ENDPOINT is not set — presigned PUT/GET URLs will use the internal" \
       "hostname (minio:9000) which browsers cannot resolve. Set to https://s3.vaidix.lvpei.org"
elif [[ "$S3_PUB" == *minio* ]] || [[ "$S3_PUB" == *localhost* ]]; then
  warn "S3_PUBLIC_ENDPOINT looks like an internal URL ($S3_PUB) — browser presigned PUT will fail in production"
else
  pass "S3_PUBLIC_ENDPOINT is set ($S3_PUB)"
fi

# COTURN_EXTERNAL_IP must be a bare IPv4 (not a hostname).
EXT_IP="$(env_val COTURN_EXTERNAL_IP)"
if [[ "$EXT_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  pass "COTURN_EXTERNAL_IP looks like an IPv4 ($EXT_IP)"
else
  fail "COTURN_EXTERNAL_IP should be a bare IPv4, got: $EXT_IP"
fi

# LIVEKIT_INTERNAL_WS_URL must start with ws:// or wss://.
IWS="$(env_val LIVEKIT_INTERNAL_WS_URL)"
case "$IWS" in
  ws://*|wss://*) pass "LIVEKIT_INTERNAL_WS_URL protocol OK ($IWS)" ;;
  *) fail "LIVEKIT_INTERNAL_WS_URL must start with ws:// or wss://" ;;
esac

# ═══════════════════════════════════════════════════════════════════════════
section "2. Rendered config files"
# ═══════════════════════════════════════════════════════════════════════════

for f in turnserver.conf livekit.prod.yaml egress.yaml; do
  if [ -f "$f" ]; then
    pass "$f rendered"
    # Check for stray CHANGE_ME or ${VAR} leftovers from a failed envsubst
    if grep -qE '\$\{[A-Z_]+\}|CHANGE_ME' "$f" 2>/dev/null; then
      fail "$f still contains un-rendered placeholders — re-run render-configs.sh"
    else
      pass "$f has no un-rendered placeholders"
    fi
  else
    fail "$f missing — run ./scripts/render-configs.sh"
  fi
done

# ─── Verify credential sync across rendered files ──────────────────────────
# coturn and LiveKit must agree on the TURN password; if they drifted
# (possible if someone manually edited one of the files) calls will fail.
TURN_SECRET_ENV="$(env_val TURN_SHARED_SECRET)"

if [ -f turnserver.conf ]; then
  if grep -q "user=livekit:${TURN_SECRET_ENV}" turnserver.conf 2>/dev/null; then
    pass "turnserver.conf credential matches TURN_SHARED_SECRET"
  else
    fail "turnserver.conf credential DOES NOT match TURN_SHARED_SECRET — re-run render-configs.sh"
  fi
fi

if [ -f livekit.prod.yaml ]; then
  if grep -q "credential: ${TURN_SECRET_ENV}" livekit.prod.yaml 2>/dev/null; then
    pass "livekit.prod.yaml TURN credential matches TURN_SHARED_SECRET"
  else
    fail "livekit.prod.yaml TURN credential DOES NOT match TURN_SHARED_SECRET — re-run render-configs.sh"
  fi
fi

if [ -f livekit.prod.yaml ]; then
  if grep -q "host: $(env_val COTURN_REALM)" livekit.prod.yaml 2>/dev/null; then
    pass "livekit.prod.yaml turn_servers host matches COTURN_REALM"
  else
    fail "livekit.prod.yaml turn_servers host DOES NOT match COTURN_REALM"
  fi
fi

# egress.yaml credential check — the #1 root cause of "No media was captured":
# egress.yaml used to have hardcoded `api_key: devkey` which caused the
# egress Chrome bot to fail authentication against LiveKit and timeout
# ("Start signal not received"). Verify it now matches the real API key.
if [ -f egress.yaml ]; then
  LIVEKIT_KEY_ENV="$(env_val LIVEKIT_API_KEY)"
  if grep -q "api_key: ${LIVEKIT_KEY_ENV}" egress.yaml 2>/dev/null; then
    pass "egress.yaml api_key matches LIVEKIT_API_KEY"
  elif grep -q "api_key: devkey" egress.yaml 2>/dev/null; then
    fail "egress.yaml api_key is still 'devkey' — re-run render-configs.sh (THIS CAUSES 'No media was captured')"
  else
    fail "egress.yaml api_key DOES NOT match LIVEKIT_API_KEY — re-run render-configs.sh"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════
section "3. Container health"
# ═══════════════════════════════════════════════════════════════════════════

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"
EXPECTED_SERVICES="app workers livekit livekit-egress vaidix-captions-agent coturn nginx"

if ! command -v docker >/dev/null 2>&1; then
  fail "docker not found on PATH"
else
  for svc in $EXPECTED_SERVICES; do
    # Map compose service names to container names (convention: vaidix-<svc>)
    # coturn is special: compose service=coturn, container=vaidix-coturn
    container="vaidix-${svc}"
    status="$(docker inspect --format '{{.State.Status}}' "$container" 2>/dev/null || echo missing)"
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || echo missing)"
    restarts="$(docker inspect --format '{{.RestartCount}}' "$container" 2>/dev/null || echo '?')"

    if [ "$status" = "missing" ]; then
      fail "$container: not found (run deploy.sh?)"
    elif [ "$status" != "running" ]; then
      fail "$container: status=$status (expected running)"
    else
      if [ "$health" = "unhealthy" ]; then
        fail "$container: running but UNHEALTHY (health=$health, restarts=$restarts)"
      elif [ "$restarts" != "?" ] && [ "$restarts" -gt 3 ] 2>/dev/null; then
        warn "$container: running but high restart count ($restarts) — check logs"
        pass "$container: running"
      else
        pass "$container: running (health=$health)"
      fi
    fi
  done
fi

# ─── Disk space ─────────────────────────────────────────────────────────────
AVAIL_KB="$(df /var/lib/docker 2>/dev/null | awk 'NR==2{print $4}' || echo 0)"
AVAIL_GB=$(( AVAIL_KB / 1048576 ))
if [ "$AVAIL_GB" -ge 10 ]; then
  pass "Disk: ${AVAIL_GB} GB free on /var/lib/docker"
elif [ "$AVAIL_GB" -ge 5 ]; then
  warn "Disk: only ${AVAIL_GB} GB free — runs docker image prune before next build"
else
  fail "Disk: CRITICAL — only ${AVAIL_GB} GB free on /var/lib/docker. Run: docker system prune -f --volumes"
fi

# ═══════════════════════════════════════════════════════════════════════════
section "4. DNS resolution for COTURN_REALM"
# ═══════════════════════════════════════════════════════════════════════════

REALM="$(env_val COTURN_REALM)"
if command -v dig >/dev/null 2>&1; then
  RESOLVED="$(dig +short "$REALM" A 2>/dev/null | head -1)"
  if [ -z "$RESOLVED" ]; then
    fail "DNS: $REALM resolves to nothing — LiveKit's TURN host lookup will fail"
    echo "     Fix: add an A record for $REALM pointing to $EXT_IP"
  elif [ "$RESOLVED" = "$EXT_IP" ]; then
    pass "DNS: $REALM → $RESOLVED (matches COTURN_EXTERNAL_IP)"
  else
    warn "DNS: $REALM → $RESOLVED (expected $EXT_IP — may be an LB or CDN, verify)"
  fi
elif command -v host >/dev/null 2>&1; then
  if host "$REALM" >/dev/null 2>&1; then
    pass "DNS: $REALM resolves (dig not available for IP comparison)"
  else
    fail "DNS: $REALM does not resolve"
  fi
else
  warn "DNS: neither dig nor host available — skipping realm DNS check"
fi

# ═══════════════════════════════════════════════════════════════════════════
section "5. TURN/coturn port reachability"
# ═══════════════════════════════════════════════════════════════════════════

check_port_tcp() {
  local host="$1" port="$2" label="$3"
  if timeout 3 bash -c ">/dev/tcp/$host/$port" 2>/dev/null; then
    pass "TCP $port: $label reachable"
    return 0
  else
    fail "TCP $port: $label UNREACHABLE — check AWS security group inbound rule TCP $port"
    return 1
  fi
}

check_port_udp_nc() {
  local host="$1" port="$2" label="$3"
  # nc -zuv sends an empty UDP probe; exit 0 only if the host accepts the datagram.
  # This is best-effort: many firewalls silently drop rather than ICMP-reject, so
  # a timeout here is likely a block, but not guaranteed.
  if command -v nc >/dev/null 2>&1; then
    if nc -zuv -w3 "$host" "$port" >/dev/null 2>&1; then
      pass "UDP $port: $label reachable"
      return 0
    else
      fail "UDP $port: $label UNREACHABLE — check AWS security group inbound rule UDP $port"
      return 1
    fi
  else
    warn "UDP $port: nc not available — cannot probe $label (install netcat-openbsd)"
    return 0
  fi
}

# Check against the external IP (not the realm DNS — we want the raw IP path too)
echo "  Probing $EXT_IP (COTURN_EXTERNAL_IP)"

check_port_tcp "$EXT_IP" 3478 "coturn TURN/TCP"
check_port_udp_nc "$EXT_IP" 3478 "coturn STUN+TURN/UDP"

# Check if coturn is actually listening on 3478 locally (network_mode: host)
if command -v ss >/dev/null 2>&1; then
  if ss -lntu 2>/dev/null | grep -q ':3478'; then
    pass "coturn: port 3478 is bound locally (ss confirms)"
  else
    fail "coturn: port 3478 NOT bound locally — coturn may not be running"
  fi
elif command -v netstat >/dev/null 2>&1; then
  if netstat -lntu 2>/dev/null | grep -q ':3478'; then
    pass "coturn: port 3478 is bound locally (netstat confirms)"
  else
    fail "coturn: port 3478 NOT bound locally — coturn may not be running"
  fi
fi

# Check relay port range in coturn config
if [ -f turnserver.conf ]; then
  MIN_PORT="$(grep -m1 '^min-port=' turnserver.conf | cut -d= -f2 | tr -d '[:space:]')"
  MAX_PORT="$(grep -m1 '^max-port=' turnserver.conf | cut -d= -f2 | tr -d '[:space:]')"
  if [ -n "$MIN_PORT" ] && [ -n "$MAX_PORT" ]; then
    pass "coturn relay range: UDP $MIN_PORT-$MAX_PORT (must be open in AWS security group)"
    echo "     AWS check: aws ec2 describe-security-groups | grep -i $MIN_PORT"
  else
    warn "coturn: could not parse min-port/max-port from turnserver.conf"
  fi
fi

# Optional: turnutils_uclient relay probe (use with --full-turn)
if [ "$FULL_TURN" -eq 1 ]; then
  if command -v turnutils_uclient >/dev/null 2>&1; then
    echo "  Running turnutils_uclient relay probe (this takes ~5s)…"
    # The -e / -r flags send a test allocation + relay; output contains "Received"
    # on success and nothing (timeout) on failure. Run inside coturn container
    # since the binary is packaged there.
    if docker exec vaidix-coturn \
        turnutils_uclient -T \
        -u livekit \
        -w "${TURN_SHARED_SECRET}" \
        -p 3478 \
        "${EXT_IP}" 2>&1 | grep -iq 'received\|relay'; then
      pass "turnutils_uclient: relay allocation succeeded"
    else
      fail "turnutils_uclient: relay allocation FAILED — TURN relay is broken"
      echo "     Logs: docker logs vaidix-coturn --tail 30"
      echo "     Check: UDP 49152-65535 inbound open in security group?"
    fi
  else
    # Try inside the container
    if docker exec vaidix-coturn which turnutils_uclient >/dev/null 2>&1; then
      if docker exec vaidix-coturn \
          turnutils_uclient -T \
          -u livekit \
          -w "${TURN_SHARED_SECRET}" \
          -p 3478 \
          "${EXT_IP}" 2>&1 | grep -iq 'received\|relay'; then
        pass "turnutils_uclient (in container): relay allocation succeeded"
      else
        fail "turnutils_uclient (in container): relay allocation FAILED"
        echo "     Check UDP 49152-65535 inbound in AWS security group"
      fi
    else
      warn "--full-turn: turnutils_uclient not available on host or in container; skipping relay probe"
    fi
  fi
fi

# ─── Scan coturn logs for auth errors ────────────────────────────────────
echo "  Scanning coturn logs for auth/relay errors (last 200 lines)…"
if docker logs vaidix-coturn --tail 200 2>&1 | grep -ciE 'error|refused|denied|allocation failed' | grep -qv '^0$'; then
  COTURN_ERR_COUNT="$(docker logs vaidix-coturn --tail 200 2>&1 | grep -ciE 'error|refused|denied|allocation failed' || echo 0)"
  warn "coturn: $COTURN_ERR_COUNT error-like lines in last 200 log lines"
  docker logs vaidix-coturn --tail 200 2>&1 | grep -iE 'error|refused|denied|allocation failed' | tail -5
else
  pass "coturn: no error lines in last 200 log lines"
fi

# ═══════════════════════════════════════════════════════════════════════════
section "6. LiveKit ICE / TURN logs"
# ═══════════════════════════════════════════════════════════════════════════

echo "  Scanning LiveKit logs for ICE failures (last 200 lines)…"
LK_LOGS="$(docker logs vaidix-livekit --tail 200 2>&1 || echo '')"

if echo "$LK_LOGS" | grep -qiE 'ice.*fail|turn.*error|turn.*unreachable'; then
  fail "LiveKit: ICE/TURN errors detected in logs"
  echo "$LK_LOGS" | grep -iE 'ice.*fail|turn.*error|turn.*unreachable' | tail -5
else
  pass "LiveKit: no ICE/TURN errors in last 200 log lines"
fi

if echo "$LK_LOGS" | grep -qiE 'starting.*turn|using.*turn|turn.*server'; then
  pass "LiveKit: TURN server registered (found in startup log)"
elif echo "$LK_LOGS" | grep -qi 'started'; then
  warn "LiveKit: started but no TURN registration log found — may not be advertising relay candidates"
fi

# ═══════════════════════════════════════════════════════════════════════════
section "7. MinIO CORS"
# ═══════════════════════════════════════════════════════════════════════════

S3_EP="$(env_val S3_ENDPOINT)"
S3_BKT="$(env_val S3_BUCKET)"
APP_ORIGIN="${NEXT_PUBLIC_APP_URL:-}"

# Derive origin from env if not set
if [ -z "$APP_ORIGIN" ]; then
  APP_ORIGIN="${NEXTAUTH_URL:-}"
fi
if [ -z "$APP_ORIGIN" ]; then
  warn "MinIO CORS: NEXT_PUBLIC_APP_URL / NEXTAUTH_URL not set — cannot validate app origin"
else
  echo "  App origin: $APP_ORIGIN"
fi

# Check MinIO reachability
if curl -fsS "${S3_EP}/minio/health/live" >/dev/null 2>&1; then
  pass "MinIO: health endpoint live at ${S3_EP}"
elif curl -fsS "${S3_EP}/minio/health/cluster" >/dev/null 2>&1; then
  pass "MinIO: cluster health OK"
else
  fail "MinIO: health check FAILED at ${S3_EP} — is docker-compose.minio.yml up?"
fi

if command -v mc >/dev/null 2>&1; then
  # Configure alias silently
  mc alias set vaidix-check "$S3_EP" \
     "$(env_val S3_ACCESS_KEY)" "$(env_val S3_SECRET_KEY)" >/dev/null 2>&1 || true

  # Check CORS rules
  CORS_JSON="$(mc cors get "vaidix-check/$S3_BKT" 2>/dev/null || echo '')"
  if [ -n "$CORS_JSON" ]; then
    pass "MinIO: CORS rules exist on bucket $S3_BKT"
    # Check for PUT in allowed methods
    if echo "$CORS_JSON" | grep -qi 'PUT'; then
      pass "MinIO: PUT method allowed in CORS rules"
    else
      fail "MinIO: PUT method NOT in CORS rules — file uploads will fail with CORS error"
      echo "     Fix: run ./scripts/infra-check.sh --fix-cors"
    fi
    # Check origin covers the app
    if [ -n "$APP_ORIGIN" ]; then
      if echo "$CORS_JSON" | grep -qF "$APP_ORIGIN" || echo "$CORS_JSON" | grep -q '"*"'; then
        pass "MinIO: app origin covered in CORS rules"
      else
        fail "MinIO: app origin $APP_ORIGIN NOT in CORS allowed origins"
        echo "     Fix: run ./scripts/infra-check.sh --fix-cors"
      fi
    fi
  else
    fail "MinIO: no CORS rules on bucket $S3_BKT — file uploads will fail"
    echo "     Fix: run ./scripts/infra-check.sh --fix-cors"
  fi

  if [ "$FIX_CORS" -eq 1 ]; then
    echo "  Applying MinIO CORS fix…"
    # Build JSON CORS config — allow PUT/GET/HEAD/POST from app origin + wildcard fallback
    # Using wildcard so presigned URL fetches from browser always work regardless of
    # referrer. If you want strict origin control, replace '*' with "$APP_ORIGIN".
    CORS_CONFIG='{
  "CORSRules": [
    {
      "AllowedOrigins": ["*"],
      "AllowedMethods": ["GET", "HEAD", "PUT", "POST", "DELETE"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag", "x-amz-request-id"],
      "MaxAgeSeconds": 3600
    }
  ]
}'
    echo "$CORS_CONFIG" > /tmp/vaidix-cors.json

    if mc cors set "vaidix-check/$S3_BKT" /tmp/vaidix-cors.json 2>/dev/null; then
      pass "MinIO: CORS rules applied (PUT from * allowed)"
      echo "     NOTE: AllowedOrigins is * — tighten to $APP_ORIGIN in production if desired"
    else
      # Older mc version: use mc anonymous set-json or mc admin policy
      if mc anonymous set-json /tmp/vaidix-cors.json "vaidix-check/$S3_BKT" 2>/dev/null; then
        pass "MinIO: CORS rules applied via anonymous set-json"
      else
        fail "MinIO: could not apply CORS rules — try via MinIO Console (:9001) → Buckets → $S3_BKT → CORS"
      fi
    fi
    rm -f /tmp/vaidix-cors.json
  fi
else
  warn "MinIO: mc (MinIO client) not on PATH — skipping CORS check"
  echo "     Install: https://min.io/docs/minio/linux/reference/minio-mc.html"
  echo "     Or manually: MinIO Console → Buckets → $S3_BKT → CORS → add PUT from $APP_ORIGIN"
  if [ "$FIX_CORS" -eq 1 ]; then
    warn "MinIO --fix-cors: mc not available, cannot apply fix automatically"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════
section "Summary"
# ═══════════════════════════════════════════════════════════════════════════

echo
TOTAL=$((PASS + WARN + FAIL))
echo "  Total: $TOTAL checks  |  Passed: $PASS  |  Warnings: $WARN  |  Failed: $FAIL"
echo

if [ "$FAIL" -gt 0 ]; then
  echo "  ACTION REQUIRED — $FAIL check(s) failed. Address the [FAIL] items above."
  echo "  Common fixes:"
  echo "    TURN connectivity:   Check AWS EC2 Security Group — inbound UDP 3478, TCP 3478, UDP 49152-65535"
  echo "    Credential mismatch: ./scripts/render-configs.sh then ./scripts/deploy.sh --force=livekit"
  echo "    MinIO CORS:          ./scripts/infra-check.sh --fix-cors"
  echo "    Container down:      docker compose -f docker-compose.prod.yml --env-file .env up -d <service>"
  echo "    Disk space:          docker system prune -f --volumes  (WARNING: removes all stopped containers)"
  echo
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo "  Passed with $WARN warning(s). Review [WARN] items above."
  exit 0
else
  echo "  All checks passed."
  exit 0
fi
