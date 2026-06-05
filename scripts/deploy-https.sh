#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# deploy-https.sh — One-shot HTTPS bootstrap for the Vaidix prod stack
# ════════════════════════════════════════════════════════════════════════════
#
# Run this ON THE EC2 HOST (not your laptop), from the vaidix/ directory.
#
# Prerequisites (do these first, in order):
#   1. Allocate an Elastic IP in AWS and associate it with this EC2 instance.
#   2. In the EC2 security group, open inbound TCP 80 and 443 from 0.0.0.0/0.
#   3. In GoDaddy DNS, add three A records pointing to the Elastic IP:
#        app.<your-domain>      → <elastic-ip>
#        livekit.<your-domain>  → <elastic-ip>
#        s3.<your-domain>       → <elastic-ip>
#      Wait for DNS propagation (5–15 min). Verify: dig +short app.<domain>
#   4. Make sure .env is decrypted and present in this directory
#      (./scripts/load-env.sh).
#
# Usage:
#   APP_HOST=vaidix.arthivaa.com ADMIN_EMAIL=you@example.com \
#     sudo -E bash scripts/deploy-https.sh
#
#   APP_HOST is the hostname where the Next.js app will be served. The
#   livekit signalling and S3 hostnames are derived as livekit.<APP_HOST>
#   and s3.<APP_HOST>.
#
# Re-running:
#   Safe to re-run for cert renewal or to redeploy. If you change APP_HOST,
#   the script reads the previous hostname from .deployed-domain to do the
#   swap correctly.
# ════════════════════════════════════════════════════════════════════════════

set -euo pipefail

: "${APP_HOST:?APP_HOST required, e.g. APP_HOST=vaidix.arthivaa.com}"
: "${ADMIN_EMAIL:?ADMIN_EMAIL required for Lets Encrypt notifications}"

LK_HOST="livekit.${APP_HOST}"
S3_HOST="s3.${APP_HOST}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

STATE_FILE=".deployed-domain"
PLACEHOLDER_APP_HOST="app.vaidix.lvpei.org"
PLACEHOLDER_LK_HOST="livekit.vaidix.lvpei.org"
PLACEHOLDER_S3_HOST="s3.vaidix.lvpei.org"
PREV_APP_HOST="$(cat "$STATE_FILE" 2>/dev/null || echo "$PLACEHOLDER_APP_HOST")"
PREV_LK_HOST="livekit.${PREV_APP_HOST#app.}"
PREV_S3_HOST="s3.${PREV_APP_HOST#app.}"
# Handle the very first run where placeholders use "app.<base>" form.
if [[ "$PREV_APP_HOST" == "$PLACEHOLDER_APP_HOST" ]]; then
  PREV_LK_HOST="$PLACEHOLDER_LK_HOST"
  PREV_S3_HOST="$PLACEHOLDER_S3_HOST"
fi

log() { printf "\n\033[1;36m[deploy-https]\033[0m %s\n" "$*"; }
die() { printf "\n\033[1;31m[deploy-https] ERROR:\033[0m %s\n" "$*" >&2; exit 1; }

# ── 1. Sanity checks ───────────────────────────────────────────────────────
[[ "$(uname)" == "Linux" ]] || die "Run this on the EC2 Linux host, not locally."
[[ "$(id -u)" == "0" ]]      || die "Run with sudo (needs ports 80/443 + certbot)."

command -v docker >/dev/null || die "docker not found on PATH."
docker compose version >/dev/null 2>&1 || die "docker compose plugin not installed."

[[ -f .env ]] || die ".env not found. Run scripts/load-env.sh to decrypt sealed env first."

# ── 2. DNS verification ────────────────────────────────────────────────────
PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org || curl -fsS --max-time 5 https://ifconfig.me)"
log "This host public IP: ${PUBLIC_IP}"

command -v dig >/dev/null || apt-get install -y dnsutils
for H in "$APP_HOST" "$LK_HOST" "$S3_HOST"; do
  RESOLVED="$(dig +short "$H" @1.1.1.1 | tail -n1)"
  if [[ -z "$RESOLVED" ]]; then
    die "DNS lookup for ${H} returned nothing. Check the GoDaddy A record."
  fi
  if [[ "$RESOLVED" != "$PUBLIC_IP" ]]; then
    die "DNS for ${H} resolves to ${RESOLVED}, but this host is ${PUBLIC_IP}. Fix the A record (or wait for propagation)."
  fi
  log "DNS OK: ${H} → ${RESOLVED}"
done

# ── 3. Install certbot if missing ──────────────────────────────────────────
if ! command -v certbot >/dev/null; then
  log "Installing certbot..."
  apt-get update
  apt-get install -y certbot
fi

# ── 4. Free port 80 (certbot --standalone needs it) ────────────────────────
log "Freeing port 80 for ACME challenge..."
systemctl stop nginx 2>/dev/null || true
docker compose -f docker-compose.dev.yml down 2>/dev/null || true
docker compose -f docker-compose.prod.yml stop nginx 2>/dev/null || true

# ── 5. Issue / renew certificates ──────────────────────────────────────────
log "Requesting Lets Encrypt cert for ${APP_HOST}, ${LK_HOST}, ${S3_HOST}..."
certbot certonly --standalone --non-interactive --agree-tos --keep-until-expiring \
  --email "${ADMIN_EMAIL}" \
  -d "${APP_HOST}" \
  -d "${LK_HOST}" \
  -d "${S3_HOST}"

# Certbot stored a single cert under the FIRST -d hostname. Symlink the
# other two paths so the per-vhost ssl_certificate paths in nginx all resolve.
LIVE_DIR="/etc/letsencrypt/live"
ln -sfn "${LIVE_DIR}/${APP_HOST}" "${LIVE_DIR}/${LK_HOST}"
ln -sfn "${LIVE_DIR}/${APP_HOST}" "${LIVE_DIR}/${S3_HOST}"

# ── 6. Substitute hostnames in nginx site configs ──────────────────────────
log "Updating nginx site configs: ${PREV_APP_HOST} → ${APP_HOST}"
sed -i "s|${PREV_APP_HOST}|${APP_HOST}|g" nginx/sites-enabled/app.conf
sed -i "s|${PREV_LK_HOST}|${LK_HOST}|g"   nginx/sites-enabled/livekit.conf
sed -i "s|${PREV_S3_HOST}|${S3_HOST}|g"   nginx/sites-enabled/s3.conf
echo "${APP_HOST}" > "${STATE_FILE}"

# ── 7. Bring up the prod stack ─────────────────────────────────────────────
log "Bringing up vaidix-net, redis, minio, prod stack..."
docker network create vaidix-net 2>/dev/null || true
docker compose -f docker-compose.redis.yml --env-file .env up -d
docker compose -f docker-compose.minio.yml --env-file .env up -d
docker compose -f docker-compose.prod.yml  --env-file .env up -d

# ── 8. Cron entry for renewal ──────────────────────────────────────────────
log "Installing weekly renewal cron..."
RENEW_CMD="cd ${REPO_ROOT} && certbot renew --quiet --pre-hook 'docker compose -f ${REPO_ROOT}/docker-compose.prod.yml stop nginx' --post-hook 'docker compose -f ${REPO_ROOT}/docker-compose.prod.yml start nginx'"
CRON_LINE="0 3 * * 1 root ${RENEW_CMD}"
echo "${CRON_LINE}" > /etc/cron.d/vaidix-cert-renew
chmod 644 /etc/cron.d/vaidix-cert-renew

log "Done."
echo ""
echo "  Open: https://${APP_HOST}"
echo "  LiveKit signalling: wss://${LK_HOST}"
echo "  S3 API: https://${S3_HOST}"
echo ""
echo "  Tail logs:  docker compose -f docker-compose.prod.yml logs -f --tail=100"
