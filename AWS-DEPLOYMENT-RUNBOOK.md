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

## 9. ⚠ BACKUPS — currently NONE (this is the top risk)

The 2026‑06‑05 wipe was unrecoverable because nothing was backed up. Add, in order of priority:
1. **Move the DB to RDS** (`DATABASE_URL` → the RDS endpoint). RDS has automated daily backups + point‑in‑time recovery, and lives outside `/var/lib/docker`, so a docker mistake can't touch it.
2. **Daily `pg_dump`** of postgres → a file + upload to S3.
3. **Daily `mc mirror`** of the MinIO bucket → another bucket / disk.
4. **Snapshot the EBS volume** of the instance periodically (AWS Backup).

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

---
*Maintained alongside the Vaidix deployment. Update the infra table when the instance/IP/domain changes.*
