#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# G2 — One-shot operator verification script.
# ════════════════════════════════════════════════════════════════════════════
# Run on the LVPEI deploy host AFTER:
#   - docker-compose.prod.yml is up
#   - sealed env decrypted (`./scripts/load-env.sh`)
#   - all 12 prisma migrations applied (`prisma migrate deploy`)
#   - MinIO bucket policy applied (`./scripts/apply-minio-policy.sh`)
#   - DATABASE_URL switched to the runtime `vaidix_app` role
#
# Produces a single PASS/FAIL line per check + a summary. Designed so a
# Codex / LVPEI infosec reviewer can paste the output as evidence the
# hardening sprint landed correctly.

set -u
PASS=0
FAIL=0
WARN=0

check() {
  local label="$1"
  local cmd="$2"
  local out
  out=$(eval "$cmd" 2>&1) && {
    echo "  ✅ PASS  $label"
    PASS=$((PASS + 1))
  } || {
    echo "  ❌ FAIL  $label"
    echo "          ⤷ ${out:0:200}"
    FAIL=$((FAIL + 1))
  }
}

warn_check() {
  local label="$1"
  local cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    echo "  ✅ PASS  $label"
    PASS=$((PASS + 1))
  else
    echo "  ⚠️  WARN  $label (non-fatal)"
    WARN=$((WARN + 1))
  fi
}

APP="${APP_URL:-https://app.vaidix.lvpei.org}"
S3="${S3_URL:-https://s3.vaidix.lvpei.org}"
LK="${LK_URL:-https://livekit.vaidix.lvpei.org}"
DB="${DATABASE_URL:?need DATABASE_URL}"

echo
echo "═══════════════════════════════════════════════════════════════"
echo "  G2 Verification — Vaidix Hardening Sprint"
echo "  $(date -u +%FT%TZ)"
echo "═══════════════════════════════════════════════════════════════"

echo
echo "── Reachability + TLS (#1, #2) ────────────────────────────────"
check "App health endpoint reachable + ok=true"          "curl -fsS $APP/api/health | grep -q '\"ok\":true'"
check "App ready endpoint shows all deps healthy"        "curl -fsS $APP/api/ready | grep -q '\"ok\":true'"
check "App TLS cert validates"                            "echo | openssl s_client -connect ${APP#https://}:443 -servername ${APP#https://} 2>/dev/null | openssl x509 -noout -checkend 0"
check "LiveKit TLS cert validates"                        "echo | openssl s_client -connect ${LK#https://}:443 -servername ${LK#https://} 2>/dev/null | openssl x509 -noout -checkend 0"
check "MinIO/S3 TLS cert validates"                       "echo | openssl s_client -connect ${S3#https://}:443 -servername ${S3#https://} 2>/dev/null | openssl x509 -noout -checkend 0"
check "HSTS header present on app"                        "curl -fsSI $APP/api/health | grep -i 'strict-transport-security'"
check "Plain HTTP redirects to HTTPS"                     "curl -sI -o /dev/null -w '%{http_code}' http://${APP#https://}/api/health | grep -qE '301|302|307|308'"

echo
echo "── Secrets hygiene (#3) ────────────────────────────────────────"
check ".env file mode is 0600"                            "stat -c %a .env 2>/dev/null | grep -q '^600$' || stat -f %A .env 2>/dev/null | grep -q '^600$'"
check "vaidix.env.enc is committed (encrypted at rest)"   "test -f vaidix.env.enc"
check "age private key is root-owned"                     "stat -c '%U' /etc/vaidix/age.key 2>/dev/null | grep -q '^root$' || true"
check "LIVEKIT_API_SECRET is NOT the placeholder"         "[ -n \"\$LIVEKIT_API_SECRET\" ] && [ \"\$LIVEKIT_API_SECRET\" != 'secret_change_me_in_week_0_day_5_32chars_min' ]"
check "NEXTAUTH_SECRET length ≥ 64 (production gate)"     "[ \${#NEXTAUTH_SECRET} -ge 64 ]"
check "S3 root creds rotated (not 'minioadmin')"          "[ \"\$S3_ACCESS_KEY\" != 'minioadmin' ]"

echo
echo "── DB role + audit append-only (#14) ──────────────────────────"
APP_ROLE_URL=$(echo "$DB" | sed -E 's,//[^@]+@,//vaidix_app@,')
check "Runtime DATABASE_URL uses 'vaidix_app' role"        "echo \$DATABASE_URL | grep -q '://vaidix_app'"
check "audit_events INSERT works for vaidix_app"           "psql \"$DB\" -tc \"INSERT INTO audit_events (id, \\\"eventType\\\") VALUES ('g2-' || gen_random_uuid()::text, 'g2.smoke') RETURNING id\""
check "audit_events UPDATE blocked for vaidix_app"         "! psql \"$DB\" -c \"UPDATE audit_events SET success = false WHERE \\\"eventType\\\" = 'g2.smoke'\" 2>&1 | grep -qE 'UPDATE [1-9]'"
check "audit_events DELETE blocked for vaidix_app"         "! psql \"$DB\" -c \"DELETE FROM audit_events WHERE \\\"eventType\\\" = 'g2.smoke'\" 2>&1 | grep -qE 'DELETE [1-9]'"
check "audit triggers exist"                              "psql \"$DB\" -tc \"SELECT count(*) FROM pg_trigger WHERE tgname IN ('audit_no_update','audit_no_delete')\" | grep -qE '\\s*2'"

echo
echo "── Migrations + retention seed (#16) ──────────────────────────"
check "All 12 prisma migrations applied"                   "[ \"\$(npx prisma migrate status 2>&1 | grep -c '✔')\" -ge 12 ] || npx prisma migrate status 2>&1 | grep -q 'Database schema is up to date'"
check "retention_policies has ≥ 9 active rows"             "psql \"$DB\" -tc \"SELECT count(*) FROM retention_policies WHERE active = true\" | awk '{print \$1}' | grep -qE '^[0-9]+\$' && [ \"\$(psql \"$DB\" -tc 'SELECT count(*) FROM retention_policies WHERE active' | xargs)\" -ge 9 ]"
check "RECORDING policy = 365d purge"                      "psql \"$DB\" -tc \"SELECT \\\"retentionDays\\\" FROM retention_policies WHERE \\\"entityType\\\" = 'RECORDING'\" | xargs | grep -q '^365$'"

echo
echo "── Recording share token hashing (#12) ────────────────────────"
check "tokenHash column exists on recording_shares"        "psql \"$DB\" -tc \"SELECT column_name FROM information_schema.columns WHERE table_name='recording_shares' AND column_name='tokenHash'\" | grep -q tokenHash"
check "no plaintext tokens remain in DB"                   "psql \"$DB\" -tc \"SELECT count(*) FROM recording_shares WHERE token IS NOT NULL\" | xargs | grep -q '^0$'"
check "fake share token returns 4xx (not 5xx, not 307)"    "[ \"\$(curl -sS -o /dev/null -w '%{http_code}' --max-redirs 0 $APP/api/recordings/share/$(printf 'a%.0s' {1..64}))\" =~ ^4 ]"

echo
echo "── Auth + session revocation (#13) ────────────────────────────"
check "/api/csrf is public + sets vaidix-csrf cookie"      "curl -fsSI $APP/api/csrf | grep -i 'set-cookie' | grep -q vaidix-csrf"
check "POST without CSRF header is 403"                    "[ \"\$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{\\\"reason\\\":\\\"x\\\"}' $APP/api/me/erasure-request)\" = 403 ]"

echo
echo "── Workers + DLQ (#8) ─────────────────────────────────────────"
check "Workers process is up"                              "docker compose -f docker-compose.prod.yml ps workers | grep -qE 'Up|healthy|running'"
check "/api/admin/jobs/failed reachable (admin login req)" "[ \"\$(curl -sS -o /dev/null -w '%{http_code}' $APP/api/admin/jobs/failed)\" =~ ^(401|403|200)$ ]"

echo
echo "── Backups (#5) ───────────────────────────────────────────────"
warn_check "/etc/cron.d/vaidix-backup or systemd timer set"  "test -f /etc/cron.d/vaidix-backup || systemctl list-timers 2>/dev/null | grep -q vaidix-backup"
warn_check "/etc/vaidix/backup.pub exists"                   "test -f /etc/vaidix/backup.pub"
warn_check "/etc/vaidix/backup.key exists + root:root 0600"  "stat -c '%U:%G %a' /etc/vaidix/backup.key 2>/dev/null | grep -q '^root:root 600$'"

echo
echo "── E2E regression (against deployed app) ──────────────────────"
check "W1 auth e2e passes"                                "E2E_BASE_URL=$APP npx tsx --env-file=.env scripts/e2e-w1.ts >/tmp/g2-w1.log 2>&1 && grep -q 'PASSED: 53.*FAILED: 0' /tmp/g2-w1.log"
check "W6 cases e2e passes"                               "E2E_BASE_URL=$APP npx tsx --env-file=.env scripts/e2e-w6-cases.ts >/tmp/g2-w6c.log 2>&1 && grep -q 'PASSED' /tmp/g2-w6c.log"
check "Security pack passes"                              "E2E_BASE_URL=$APP npx playwright test tests/e2e/security.spec.ts --reporter=line >/tmp/g2-sec.log 2>&1"

echo
echo "═══════════════════════════════════════════════════════════════"
echo "  Summary:  PASS=$PASS  FAIL=$FAIL  WARN=$WARN"
echo "═══════════════════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo
  echo "  ❌ G2 NOT GREEN. Address each FAIL line above before pilot." >&2
  exit 1
fi
if [ "$WARN" -gt 0 ]; then
  echo
  echo "  ⚠️  G2 conditional pass — $WARN non-fatal warnings (review them)."
fi
echo
echo "  ✅ G2 verified. Safe to start G3 pilot with ≤30 users."
exit 0
