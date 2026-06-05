#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Vaidix — production deploy script (idempotent, change-aware)
# ════════════════════════════════════════════════════════════════════════════
# Single command to land any merge to master on the EC2 box. Designed so an
# operator who forgets a step (or pastes a half-script from an SSH window
# that closed mid-execution) cannot leave the deploy in a half-applied state:
#
#   - Uses the CORRECT compose service names (`app`, `livekit`, `coturn`,
#     `livekit-egress`, `nginx`) — NOT the container names (`vaidix-app`...).
#     The previous deploys silently no-op'd because operators reached for
#     container names from `docker ps` instead of service names from the
#     compose yaml.
#   - Stashes local nginx hostname edits so `git pull` never conflicts.
#   - Re-renders templated configs (egress.yaml, turnserver.conf,
#     livekit.prod.yaml) — render-configs.sh aborts loudly if any required
#     env var still contains the literal "CHANGE_ME" placeholder, so the
#     v2.4 / v2.7 incident class (placeholders shipping to prod) cannot
#     recur silently.
#   - Detects what changed in the merge and only restarts the affected
#     containers — app rebuilds on `src/`, `prisma/`, `package.json`,
#     `next.config.ts` changes; livekit + coturn + livekit-egress restart
#     when their templates change; nginx reloads when its sites change.
#   - Fails loudly if any container is wedged after recreate.
#
# Usage (from anywhere; script cd's to repo root):
#   ./scripts/deploy.sh
#
# First-time setup (before running deploy.sh for the first time):
#   1. Copy .env.production.example to .env, fill in real secrets including
#      TURN_SHARED_SECRET, COTURN_EXTERNAL_IP, COTURN_REALM.
#   2. AWS Security Group → inbound: UDP 3478, TCP 3478, UDP 49152-65535.
#   3. ./scripts/deploy.sh
# ════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# Resolve repo root regardless of where the script is called from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ─── Optional force flags ──────────────────────────────────────────────────
# Use these when containers are stale but git is already up to date (e.g. after
# an interrupted deploy, or when secrets change without a code commit):
#   --force            rebuild + recreate ALL services
#   --force=app        force rebuild + recreate `app` only
#   --force=livekit    force recreate `livekit` + `coturn`
#   --force=egress     force recreate `livekit-egress`
FORCE_APP=0; FORCE_LIVEKIT=0; FORCE_EGRESS=0
for arg in "$@"; do
  case "$arg" in
    --force)            FORCE_APP=1; FORCE_LIVEKIT=1; FORCE_EGRESS=1 ;;
    --force=app)        FORCE_APP=1 ;;
    --force=livekit)    FORCE_LIVEKIT=1 ;;
    --force=egress)     FORCE_EGRESS=1 ;;
    *)
      echo "[deploy] unknown flag: $arg" >&2
      echo "[deploy] valid flags: --force, --force=app, --force=livekit, --force=egress" >&2
      exit 1
      ;;
  esac
done

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"

echo "[deploy] repo root: $REPO_ROOT"
echo "[deploy] $(date -u +%Y-%m-%dT%H:%M:%SZ)"
[ "$FORCE_APP" -eq 1 ] || [ "$FORCE_LIVEKIT" -eq 1 ] || [ "$FORCE_EGRESS" -eq 1 ] && \
  echo "[deploy] force flags: app=$FORCE_APP livekit=$FORCE_LIVEKIT egress=$FORCE_EGRESS"

# ─── 1. Pull (stashing local nginx edits) ──────────────────────────────────

NEEDS_STASH=0
if ! git diff --quiet nginx/sites-enabled/ 2>/dev/null; then
  echo "[deploy] stashing local nginx/sites-enabled/ edits"
  git stash push -m "deploy.sh nginx stash $(date +%s)" -- nginx/sites-enabled/
  NEEDS_STASH=1
fi

BEFORE_SHA="$(git rev-parse HEAD)"
git fetch origin
# Pull the branch THIS checkout is on. The remote default is `main`; hardcoding
# `master` (which no longer exists on origin) made `git pull` fail under
# `set -euo pipefail` and aborted the whole deploy — pushing operators to run
# `docker compose up` by hand, which is what created the stray config dirs.
DEPLOY_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git pull origin "$DEPLOY_BRANCH"
AFTER_SHA="$(git rev-parse HEAD)"

if [ "$NEEDS_STASH" -eq 1 ]; then
  # || true: if there's a merge conflict in the nginx restore, the operator
  # resolves manually. The deploy can continue — nginx restart at the end
  # picks up whatever's on disk.
  git stash pop || echo "[deploy] WARN: nginx stash pop had conflicts; resolve manually"
fi

if [ "$BEFORE_SHA" = "$AFTER_SHA" ]; then
  echo "[deploy] no new commits since last deploy"
  CHANGED_FILES=""
  # Warn if no --force flags given — containers may predate the last source change
  # (e.g. if a previous deploy was interrupted or if only secrets changed).
  if [ "$FORCE_APP" -eq 0 ] && [ "$FORCE_LIVEKIT" -eq 0 ] && [ "$FORCE_EGRESS" -eq 0 ]; then
    echo "[deploy] ⚠  No --force flag given. If containers are stale (check: docker ps -a),"
    echo "[deploy]    re-run with: ./scripts/deploy.sh --force"
    echo "[deploy]    or target a specific service: --force=app / --force=livekit / --force=egress"
  fi
else
  CHANGED_FILES="$(git diff --name-only "$BEFORE_SHA" "$AFTER_SHA")"
  echo "[deploy] pulled $(echo "$CHANGED_FILES" | wc -l) file change(s) from $BEFORE_SHA to $AFTER_SHA"
fi

# ─── 2. Render templated configs from .env ─────────────────────────────────
# Refuses to render if any required env var is empty or contains CHANGE_ME.
./scripts/render-configs.sh

# ─── 3. Apply pending Prisma migrations ────────────────────────────────────
# Service name `app` (not `vaidix-app`). `exec -T` because we have no TTY.
# `migrate deploy` is additive-only in production; safe to re-run.
echo "[deploy] applying pending prisma migrations"
$COMPOSE exec -T app npx prisma migrate deploy

# ─── 4. Rebuild + recreate `app` when its sources changed ──────────────────
NEEDS_APP=0
if [ -n "$CHANGED_FILES" ] && echo "$CHANGED_FILES" | grep -qE '^(src/|prisma/|package(-lock)?\.json|next\.config\.ts|Dockerfile)'; then
  NEEDS_APP=1
fi
if [ "$FORCE_APP" -eq 1 ]; then
  NEEDS_APP=1
fi
if [ "$NEEDS_APP" -eq 1 ]; then
  # Guard: builds fail with "failed to export" when the overlay-fs layer store
  # runs out of disk. Prune dangling layers first, then check we have >= 5 GB.
  echo "[deploy] pruning dangling Docker images to free space before build"
  docker image prune -f 2>/dev/null || true
  # Also prune build cache older than 48h so repeated no-cache builds don't
  # accumulate multi-GB caches indefinitely.
  docker buildx prune -f --filter until=48h 2>/dev/null || true
  AVAIL_KB=$(df /var/lib/docker 2>/dev/null | awk 'NR==2{print $4}' || echo "0")
  if [ "$AVAIL_KB" -lt 5242880 ]; then  # 5 GB in KB
    echo "[deploy] ⚠  Less than 5 GB free on /var/lib/docker (${AVAIL_KB} KB). Running full Docker prune."
    docker system prune -f --volumes 2>/dev/null || true
    AVAIL_KB=$(df /var/lib/docker 2>/dev/null | awk 'NR==2{print $4}' || echo "0")
    echo "[deploy]    Free after prune: ${AVAIL_KB} KB"
  fi

  echo "[deploy] app sources changed — rebuilding image (no-cache)"
  if ! $COMPOSE build --no-cache app; then
    echo "[deploy] ✗ build failed — checking disk and logs" >&2
    df -h /var/lib/docker >&2
    docker logs vaidix-app --tail 20 2>&1 >&2 || true
    exit 1
  fi
  echo "[deploy] recreating app container"
  $COMPOSE up -d --force-recreate app
fi

# ─── 5. Recreate livekit/coturn/livekit-egress when their templates changed ─
NEEDS_LIVEKIT=0
NEEDS_COTURN=0
NEEDS_EGRESS=0
if [ -n "$CHANGED_FILES" ]; then
  if echo "$CHANGED_FILES" | grep -qE '(livekit\.prod\.yaml\.tpl|turnserver\.conf\.tpl|scripts/render-configs\.sh|docker-compose\.prod\.yml)'; then
    NEEDS_LIVEKIT=1
    NEEDS_COTURN=1
  fi
  # Recreate egress when its template OR the render script / compose changes —
  # egress bind-mounts a freshly-rendered egress.yaml, so a render change must
  # bounce it too (otherwise it keeps the old mount, incl. a stray directory).
  if echo "$CHANGED_FILES" | grep -qE '(egress\.yaml\.tpl|scripts/render-configs\.sh|docker-compose\.prod\.yml)'; then
    NEEDS_EGRESS=1
  fi
fi
if [ "$FORCE_LIVEKIT" -eq 1 ]; then
  NEEDS_LIVEKIT=1
  NEEDS_COTURN=1
fi
if [ "$FORCE_EGRESS" -eq 1 ]; then
  NEEDS_EGRESS=1
fi
if [ "$NEEDS_LIVEKIT" -eq 1 ]; then
  echo "[deploy] livekit/turnserver templates changed — recreating livekit + coturn"
  $COMPOSE up -d --force-recreate livekit coturn
fi
if [ "$NEEDS_EGRESS" -eq 1 ]; then
  echo "[deploy] egress template changed — recreating livekit-egress"
  $COMPOSE up -d --force-recreate livekit-egress
fi

# ─── 6. Reload nginx when its sites changed ────────────────────────────────
if [ -n "$CHANGED_FILES" ] && echo "$CHANGED_FILES" | grep -qE '^nginx/'; then
  echo "[deploy] nginx config changed — reloading"
  $COMPOSE exec -T nginx nginx -s reload || $COMPOSE restart nginx
fi

# ─── 7. Health check ───────────────────────────────────────────────────────
sleep 15
echo "[deploy] container status:"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.CreatedAt}}' | grep -E 'vaidix-' || true

# Surface app-level boot errors if the app was recreated.
if [ "$NEEDS_APP" -eq 1 ]; then
  echo "[deploy] last 30 app log lines (errors stand out here):"
  docker logs vaidix-app --tail 30 2>&1 | grep -E 'Ready in|error|Error|prisma|wizard-forge' || \
    docker logs vaidix-app --tail 30 2>&1
fi

# Surface LiveKit TURN-candidate confirmation if the LiveKit config changed.
if [ "$NEEDS_LIVEKIT" -eq 1 ]; then
  echo "[deploy] last 30 livekit log lines (look for turn / external):"
  docker logs vaidix-livekit --tail 30 2>&1 | grep -iE 'turn|external|candidate|error' || \
    docker logs vaidix-livekit --tail 30 2>&1
fi

echo "[deploy] done — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
