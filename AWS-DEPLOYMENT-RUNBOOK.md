# Vaidix — AWS Deployment Runbook & ⛔ DO‑NOT‑TOUCH

> Single source of truth for the production box. Read sections 3 + 4 before
> running ANY docker/apt command on the server.

## 1. Infrastructure (as of Jun 2026)

| Thing | Value |
|---|---|
| EC2 instance | `i-00115b3dc5b00ca0e` "Vaidix", **m7i‑flex.large** (2 vCPU / 8 GB), `ap-south-1a` (Mumbai) |
| Public IP | **13.201.67.57** ⚠ *not* an Elastic IP — it changes if you stop/start the instance. Allocate an Elastic IP. |
| Security groups | `launch-wizard-1` (`sg-0cedcc5ea5b11ede2`) — app/livekit/turn ports · `ec2-rds-1` (`sg-06d13d414a0b57acb`) — RDS access |
| Domain | `vaidix.arthivaa.com`, `livekit.vaidix.arthivaa.com`, `s3.vaidix.arthivaa.com` → 13.201.67.57 (GoDaddy / domaincontrol DNS) |
| Old box (decommissioned) | `13.234.37.54` — the previous deployment; the *old registered users* may be here or in RDS |
| RDS | exists (the `ec2-rds-1` SG) — **currently NOT used** (app points at the dockerized postgres). May hold the old data. |
| Repo | `~/Vaidix-Final` — github.com/Sandeepshiva1/Vaidix-Final, branch `main` |
| Secrets | **only** in `~/Vaidix-Final/.env` (gitignored). If this file is lost, the deployment is unrecoverable — back it up. |

Required SG inbound: UDP `50000-50100`, `7882`, `3478`, `49152-65535` · TCP `7881`, `5349`, `443`, `80`, `22`.

## 2. The Docker stack (10 containers, compose project `vaidix-final`)

Four compose files share the external network `vaidix-net`:
- `docker-compose.postgres.yml` → `vaidix-postgres` (database)
- `docker-compose.redis.yml` → `vaidix-redis` (cache / queues)
- `docker-compose.minio.yml` → `vaidix-minio` (S3 object store)
- `docker-compose.prod.yml` → `nginx`, `app`, `workers`, `livekit`, `livekit-egress`, `coturn`, `captions-agent`

## 3. WHERE YOUR DATA LIVES — Docker named volumes (`/var/lib/docker/volumes/`)

| Volume | Holds | If destroyed |
|---|---|---|
| **vaidix-postgres-data** | ALL relational data — users, sessions, transcripts, pearls, evaluations | **catastrophic** |
| **vaidix-minio-data** | uploaded documents, slide images, promo assets, processed recordings | **major** |
| **vaidix-recordings** | raw egress recordings | major |
| vaidix-redis-data | cache / queues | regenerates |
| vaidix-livekit-data · vaidix-nginx-cache | ephemeral | fine |

Because these are *named volumes*, they live under `/var/lib/docker` — **anything that wipes `/var/lib/docker` destroys the database.**

## 4. ⛔ NEVER RUN THESE (data‑loss commands)

1. **`apt-get remove --purge docker.io`** (or any `--purge` on `docker.io`) — runs Ubuntu's `nuke-graph-directory.sh` hook which does `rm -rf /var/lib/docker` → **wipes EVERY volume incl. the DB.** *(This is what destroyed the database on 2026‑06‑05.)* If you ever must remove docker.io, use **`apt-get remove docker.io`** with **NO `--purge`**.
2. **`docker compose ... down -v`** — the `-v` deletes named volumes (DB + MinIO). Use `down` **without** `-v`.
3. **`docker volume rm vaidix-postgres-data`** (or any `vaidix-*-data`) — deletes that data permanently.
4. **`docker compose ... up --remove-orphans`** — removes `redis`/`minio`/`postgres` (they run from separate compose files, so the prod compose sees them as "orphans"). **Never add `--remove-orphans`.** The orphan warning is harmless — ignore it.
5. **`docker system prune --volumes`** / **`docker volume prune`** — deletes "unused" volumes.
6. **`docker compose ... up` BEFORE `./scripts/render-configs.sh`** — Docker auto‑creates `livekit.prod.yaml`/`egress.yaml` as empty **directories** → livekit crash‑loops on "is a directory". **Always render first.**
7. Don't hand‑edit / delete the *rendered* configs (`livekit.prod.yaml`, `egress.yaml`, `turnserver.conf`) — they're generated from `.env` by `render-configs.sh`.

## 5. ✅ SAFE OPERATIONS

| Task | Command |
|---|---|
| Redeploy latest code | `cd ~/Vaidix-Final && ./scripts/deploy.sh` (pulls, renders, recreates only changed services) |
| Restart one service | `docker compose -f docker-compose.prod.yml --env-file .env restart <svc>` ⚠ does NOT re‑read `.env` |
| Apply a `.env` change | `docker compose -f docker-compose.prod.yml --env-file .env up -d --force-recreate <svc>` |
| Render configs (always before `up`) | `./scripts/render-configs.sh` then `file livekit.prod.yaml` (must say "ASCII text") |
| Health | `docker compose -f docker-compose.prod.yml --env-file .env ps` + `curl -s https://vaidix.arthivaa.com/api/ready` |
| Logs | `docker logs <container> --tail 50` |
| **Fix `502` after recreating `app`** | `docker exec vaidix-nginx nginx -t && docker exec vaidix-nginx nginx -s reload` — app got a new IP on `vaidix-net`; nginx cached the old one. Run after EVERY `--force-recreate app`. See §12.6 |

## 6. Golden order to bring the stack up from cold

```bash
cd ~/Vaidix-Final
git pull origin main                                   # resolve local changes first if blocked
./scripts/render-configs.sh                            # creates the config FILES
file livekit.prod.yaml egress.yaml                     # MUST be "ASCII text", not directory
docker network create vaidix-net 2>/dev/null || true
docker compose -f docker-compose.postgres.yml --env-file .env up -d
docker compose -f docker-compose.redis.yml    --env-file .env up -d
docker compose -f docker-compose.minio.yml    --env-file .env up -d
docker compose -f docker-compose.prod.yml     --env-file .env up -d --build
# migrations (additive, safe). Seed ONLY on a brand-new DB.
docker compose -f docker-compose.prod.yml --env-file .env exec app npx prisma migrate deploy
```

## 7. Credentials

```bash
# Admin (created by the seed from .env):
grep -E '^(ADMIN_EMAIL|ADMIN_PASSWORD)=' .env
# Provisioned class accounts:
#   faculty1@vaidix.local        / Vaidix@Faculty2026
#   member01..member25@vaidix.local / Vaidix@Class2026
```
All real secrets live ONLY in `~/Vaidix-Final/.env`. Copy it somewhere safe (a password manager / private S3). **It is gitignored and exists on no other machine.**

## 8. Live captions (Deepgram)

The live **Captions** tab stays on *“Waiting for captions…”* until the
`vaidix-captions-agent` container has a real **`DEEPGRAM_API_KEY`**. Symptom in
the logs: `WARN The "DEEPGRAM_API_KEY" variable is not set. Defaulting to a
blank string.` — and (after the fail-fast fix) the agent now logs a clear
`FATAL: DEEPGRAM_API_KEY is not set …` and exits instead of running uselessly.

Fix:
```bash
cd ~/Vaidix-Final
# 1. Put a real key in .env (get one at https://console.deepgram.com)
grep -q '^DEEPGRAM_API_KEY=' .env && \
  sed -i 's#^DEEPGRAM_API_KEY=.*#DEEPGRAM_API_KEY=<your-deepgram-key>#' .env || \
  echo 'DEEPGRAM_API_KEY=<your-deepgram-key>' >> .env
# 2. Recreate ONLY the agent (restart does NOT re-read .env)
docker compose -f docker-compose.prod.yml --env-file .env up -d \
  --force-recreate vaidix-captions-agent
# 3. Verify it stayed up (no FATAL) and registered with LiveKit
docker logs vaidix-captions-agent --tail 30
```
The agent auto-joins every LIVE room as a hidden participant; one Deepgram
stream opens per **unmuted speaker**, not per viewer. Captions then fan out to
all viewers over the existing SSE — no per-seat cost.

## 9. ⚠ BACKUPS — the system EXISTS; ENABLE it on this instance

Correction to earlier notes: a full encrypted backup + restore system already
ships in the repo — **`scripts/backup.sh`** (nightly `pg_dump` + MinIO
`mc mirror`, age‑encrypted, rclone offsite, retention) and
**`scripts/restore.sh`**, documented in
[docs/RUNBOOK-BACKUP.md](docs/RUNBOOK-BACKUP.md) (HARDENING‑PLAN item #5). The
2026‑06‑05 wipe was unrecoverable **not because no system exists, but because
the operator one‑time setup was never run on this instance** — nothing was
actually being dumped.

**Enable it now** (full steps in RUNBOOK‑BACKUP.md → "Initial setup"):
1. `age-keygen` → install the private key `0600` at `/etc/vaidix/backup.key` and
   the public key at `/etc/vaidix/backup.pub`. Keep a copy of the PRIVATE key
   **off the instance** — without it the encrypted backups are unrecoverable.
2. `rclone config` an offsite remote named `vaidix-offsite` (S3 / B2 / NAS).
3. Cron it **from the repo** so `backup.sh` self‑loads `.env`:
   `30 2 * * * cd ~/Vaidix-Final && ./scripts/backup.sh >> /var/log/vaidix-backup.log 2>&1`
4. Run `./scripts/backup.sh` once by hand to confirm it works — don't wait for 02:30.
5. Restore drill: `./scripts/restore.sh /backup/<date>` on a second host; log the
   RTO in RUNBOOK‑BACKUP.md (target < 30 min).

Stronger still (recommended, complementary — not either/or):
- **Move the DB to RDS** (`DATABASE_URL` → the existing `vaidix-db` RDS) for
  automated PITR backups that live outside `/var/lib/docker` entirely.
- **Migrate object storage to AWS S3** (§10) — durable + off the EC2 disk.
- **AWS Backup EBS snapshots** of the instance volume as a coarse safety net.

## 10. Move object storage to AWS S3 (off the EC2 disk)

MinIO (`vaidix-minio-data` + `vaidix-recordings`) is the biggest consumer of
`/var/lib/docker` — recordings especially — and is what caused the "no space"
(`exit 102`) build failures. Moving it to AWS S3 frees the EC2 disk, gives
11-nines durability + lifecycle expiry, and removes a container from the
2-vCPU/8-GB box. The code already supports it (`S3_FORCE_PATH_STYLE`), so it's
a config + one-time data migration:

```bash
# 1. Create a PRIVATE, encrypted bucket (block all public access), e.g.
#    aws s3api create-bucket --bucket vaidix-media --region ap-south-1 \
#      --create-bucket-configuration LocationConstraint=ap-south-1
#    aws s3api put-public-access-block --bucket vaidix-media \
#      --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
#    aws s3api put-bucket-encryption --bucket vaidix-media \
#      --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
# 2. Create an IAM user with least-privilege access to JUST that bucket; note its keys.
# 3. Mirror existing objects MinIO -> S3 (mc is the MinIO client):
mc alias set s3 https://s3.ap-south-1.amazonaws.com <AWS_KEY> <AWS_SECRET>
mc mirror --overwrite local-minio/vaidix-video s3/vaidix-media
# 4. Edit ~/Vaidix-Final/.env:
#      S3_BUCKET=vaidix-media
#      S3_REGION=ap-south-1
#      S3_ACCESS_KEY=<AWS_KEY>   S3_SECRET_KEY=<AWS_SECRET>
#      S3_FORCE_PATH_STYLE=false
#      EGRESS_S3_ENDPOINT=https://s3.ap-south-1.amazonaws.com
#      # remove/comment S3_ENDPOINT and S3_PUBLIC_ENDPOINT (use AWS default)
# 5. Recreate app + workers + egress so they re-read .env:
docker compose -f docker-compose.prod.yml --env-file .env up -d --force-recreate app workers livekit-egress
curl -s https://vaidix.arthivaa.com/api/ready    # expect {"ok":true}
# 6. Once verified, stop MinIO (do NOT -v) and drop its nginx vhost:
#    docker compose -f docker-compose.minio.yml --env-file .env down
#    (then remove nginx/sites-enabled/s3.conf and reload nginx)
```
Defaults are unchanged (`S3_FORCE_PATH_STYLE` defaults to path-style/MinIO), so
existing deployments keep working until you opt in. For PHI, sign an AWS BAA and
consider a VPC gateway endpoint for S3 (free, keeps traffic off the internet).

## 11. Gated manual deploy (code + Prisma migrations) — the safe procedure

`./scripts/deploy.sh` works for code-only changes, but it has a **migration-ordering
bug** (§12.2) and gives no checkpoints. For any deploy that ships **Prisma
migrations, new required env vars, or a big batch**, use this gated sequence and
verify each step before the next. Run from `~/Vaidix-Final`.

```bash
# 0. PRE-FLIGHT (read-only, safe)
grep -E '^LIVEKIT_URL=' .env                 # MUST be wss:// (prod boot gate, §12.3)
grep -E '^(S3_|EGRESS_S3)' .env | sed -E 's/(KEY|SECRET)=.*/\1=***/'  # storage config (§12.4)
df -h /                                       # need ~12-15 GB free for the build (§12.5)
git pull origin main                          # if it complains about local nginx edits, see §12.7

# 1. RENDER CONFIGS (always before any `up`)
./scripts/render-configs.sh
file livekit.prod.yaml egress.yaml turnserver.conf   # each MUST be text, NOT "directory"

# 2. FREE DISK + BUILD (running app untouched during build)
rm -rf .next node_modules                     # host build artifacts the container build never uses (~2 GB)
docker image prune -a -f && docker builder prune -a -f
df -h /                                        # if < ~12 GB, GROW EBS (§12.5) before building
docker compose -f docker-compose.prod.yml --env-file .env build --no-cache app
echo "BUILD EXIT CODE: $?"                     # must be 0

# 3. RECREATE app + workers (the cutover — they SHARE the image, recreate BOTH)
docker compose -f docker-compose.prod.yml --env-file .env up -d --force-recreate app workers
sleep 30
docker logs vaidix-app --tail 40              # want "✓ Ready", no env "violations", no crash loop

# 4. APPLY MIGRATIONS — AFTER the rebuild+recreate, NOT before (§12.2)
docker compose -f docker-compose.prod.yml --env-file .env exec -T app npx prisma migrate deploy

# 5. RELOAD NGINX so it re-resolves the recreated app's new IP (§12.6)
docker exec vaidix-nginx nginx -t && docker exec vaidix-nginx nginx -s reload

# 6. VERIFY
docker compose -f docker-compose.prod.yml --env-file .env exec -T app npx prisma migrate status   # "up to date"
docker compose -f docker-compose.prod.yml --env-file .env exec -T app \
  sh -c 'npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script'  # drift audit (§12.1)
curl -s https://vaidix.arthivaa.com/api/ready ; echo                # {"ok":true}
```

## 12. Deploy gotchas — hard-won lessons (read before deploying)

### 12.1 Prisma schema **drift from `prisma db push`** → P2022 in prod
Adding a field to `schema.prisma` and applying it locally with `prisma db push`
creates **no migration file**. Prod builds a Prisma Client that SELECTs/INSERTs
the column, but `migrate deploy` never creates it → runtime
`P2022: column ... does not exist` (hit on `slides.overlayJson`, then again on
`slides.imageBox`/`richJson`). **`migrate status` does NOT catch this** — it only
diffs migration files vs `_prisma_migrations`, not schema-vs-DB.
- **Detect:** `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` (empty = clean; any `ALTER/CREATE` = drift).
- **Fix:** write a migration with `ADD COLUMN IF NOT EXISTS ... JSONB` (house style — idempotent/replay-safe), commit it, `migrate deploy`.
- **Prevent:** never `db push` for shared work — always `prisma migrate dev --name x` so a migration is committed.
- **Known benign drift:** the audit always prints 3 `ALTER … "updatedAt" DROP DEFAULT` lines (`session_shares`, `specialties`, `sub_specialties`). That's the Prisma `@updatedAt` quirk (app-managed, harmless) — ignore unless you want a cosmetic cleanup migration.

### 12.2 `deploy.sh` runs `migrate deploy` BEFORE the image rebuild
The migrations folder is **baked into the image** (Dockerfile `COPY prisma`), and
the app container has no source bind-mount. `deploy.sh` step 3 execs
`migrate deploy` in the **still-running OLD container**, which lacks the new
migration files → "No pending migrations", then it rebuilds. **Net: new
migrations are never applied by deploy.sh.** Always run `migrate deploy`
**manually after** the recreate (step 4 in §11). (Fix TODO: reorder deploy.sh.)

### 12.3 New **required env var** → app won't boot / build fails
`src/lib/env.ts` runs `envSchema.safeParse(process.env)` at module load and
**throws on any missing required var** — at runtime AND during `next build`
("Collecting page data"). Adding a required var means **two** places must be
updated or the deploy breaks:
1. **Server `~/Vaidix-Final/.env`** — or the recreated app crash-loops on boot.
2. **Dockerfile build-stage `ENV` placeholder** — or `docker build` fails after
   compiling (this bit us: the MinIO→S3 commit added required `S3_RECORDINGS_BUCKET`
   but no build placeholder → `failed to execute bake: exit status 1`).
Also: **`LIVEKIT_URL` must be `wss://`** in prod (cleartext `ws://` is refused by
a boot gate). The internal `LIVEKIT_INTERNAL_WS_URL=ws://livekit:7880` is a
different, un-gated var.

### 12.4 Storage: MinIO vs the AWS S3 migration (`S3_RECORDINGS_BUCKET`, path-style)
The MinIO→S3 commit split storage into two buckets and **changed defaults to be
AWS-first** (this supersedes §10's "defaults unchanged" note):
- `S3_RECORDINGS_BUCKET` is now **required**.
- `S3_FORCE_PATH_STYLE` now defaults to **`false`** (AWS). **MinIO needs `true`** or every upload/download breaks.
- `EGRESS_S3_ENDPOINT` no longer defaults to `http://minio:9000`; unset → egress tries AWS → recording uploads fail.

**To keep running on MinIO** (no AWS cutover), the server `.env` must have:
```
S3_RECORDINGS_BUCKET=vaidix-video      # same as S3_BUCKET → existing recordings stay reachable, no data move
S3_FORCE_PATH_STYLE=true
EGRESS_S3_ENDPOINT=http://minio:9000
```
A real AWS cutover additionally needs both buckets created, IAM keys, **existing
media mirrored** (`mc mirror`), and an AWS BAA for PHI — see §10.

### 12.5 Disk: `exit status 102` = out of space during build
The box runs hot (root FS ~85-95% — MinIO/Postgres/recordings volumes). A
`--no-cache` build needs **~12-15 GB transient** (LibreOffice base + node_modules
copied twice + fresh layers, while the old image is still pinned). At < ~11 GB
the build dies at the runtime COPY / "exporting to image" with `exit 102`.
- **Safe reclaim:** `rm -rf .next node_modules` (host, ~2 GB — the container build doesn't use them), `docker image prune -a -f`, `docker builder prune -a -f`. Note `docker system prune` usually returns ~0 B because every image is in use and the real space is in **data volumes (never `--volumes`)**.
- **Permanent fix when reclaim isn't enough — grow the EBS volume (no downtime, no data loss):**
  1. AWS Console → EC2 → Volumes → root vol of `i-00115b3dc5b00ca0e` → Modify → raise size (e.g. 64→120 GB).
  2. On the box (root device `/dev/nvme0n1`, partition 1, **ext4**):
     ```bash
     lsblk                            # wait until nvme0n1 shows the new size
     sudo growpart /dev/nvme0n1 1
     sudo resize2fs /dev/nvme0n1p1
     df -h /
     ```
  Long term: move object storage to S3 (§10) to get recordings off the EBS disk.

### 12.6 Post-recreate `502 Bad Gateway` (app healthy) = stale nginx upstream IP
After `--force-recreate app`, the app gets a **new IP on `vaidix-net`**, but the
long-running `nginx` container cached the old IP → `502` even though
`docker ps` shows `vaidix-app` **healthy** and logs show `✓ Ready`. **Fix:**
`docker exec vaidix-nginx nginx -s reload` (re-resolves upstreams; `nginx -t`
first). Make this the last step of every deploy that recreates `app`.

### 12.7 Running Prisma CLI inside the app container can OOM it
`docker compose exec app npx prisma ...` spawns Node + the Prisma engine inside
the app's **2 GB cgroup**, on top of Next.js → the app can get OOM-killed and
auto-restart (brief `502`). Harmless (recovers in seconds) but expected after
`migrate deploy`/`migrate diff` — re-check health and (per §12.6) reload nginx.

### 12.8 `git pull` on the server vs local nginx edits
The server keeps **local uncommitted edits** to `nginx/sites-enabled/*.conf`
(domain/SSL specifics). A `git pull` only conflicts on a conf file that BOTH the
server and an incoming commit changed. If `s3.conf` (etc.) blocks the pull and
the committed version is the intended one: `git diff nginx/sites-enabled/s3.conf
> ~/s3conf.bak` then `git checkout -- nginx/sites-enabled/s3.conf` and pull.
`app.conf`/`livekit.conf` local edits are untouched if no incoming commit
changes them. nginx isn't affected until reloaded (§12.6).

---
*Maintained alongside the Vaidix deployment. Update the infra table when the instance/IP/domain changes.*
