# ════════════════════════════════════════════════════════════════════════════
# Vaidix — coturn (STUN/TURN) Config — TEMPLATE
# ════════════════════════════════════════════════════════════════════════════
# Rendered to ./turnserver.conf by scripts/render-configs.sh at deploy time.
# Edit THIS .tpl file, NOT the rendered output (which is .gitignored).
#
# WebRTC NAT traversal for participants behind symmetric NATs and corporate
# firewalls. coturn runs with `network_mode: host` (see docker-compose.prod.yml)
# so it binds directly to the EC2 host ports — no Docker port mapping needed.
#
# Operator checklist BEFORE running `./scripts/deploy.sh`:
#   1. Put the EC2 public IP in .env as COTURN_EXTERNAL_IP
#   2. Generate a strong TURN secret:
#        openssl rand -base64 24 | tr -d '+/=' | head -c 32
#      and put it in .env as TURN_SHARED_SECRET
#   3. (Optional) Override COTURN_REALM in .env if your TURN realm differs
#      from the default `turn.vaidix.arthivaa.com`
#   4. AWS security group on the EC2 host: open inbound UDP 3478, TCP 3478,
#      and UDP 49152-65535 (relay range). TLS port 5349 only if you front
#      coturn with a Let's Encrypt cert (out of scope for this revision).
#
# render-configs.sh REFUSES to render if any of the three env vars is empty
# or still holds an unrotated placeholder. So the rendered file can never
# carry the placeholder defaults that previously broke production.
#
# Why static credentials, not `use-auth-secret` time-limited tokens:
#   LiveKit's `rtc.turn_servers` config in livekit.prod.yaml sends `username`
#   + `credential` to clients literally. There is no server-side path for
#   LiveKit to mint REST-time-limited TURN tokens for an external coturn,
#   so the only working combination is static creds on both sides. The same
#   ${TURN_SHARED_SECRET} env value rendering into BOTH turnserver.conf and
#   livekit.prod.yaml guarantees they cannot drift.

listening-port=3478
tls-listening-port=5349

# REQUIRED for production. The EC2 public IP. coturn advertises this address
# in TURN allocation responses so the client knows where to send relayed
# media. Without it, clients receive 172.x.x.x (Docker bridge addrs) and
# every relay attempt fails. Set in .env as COTURN_EXTERNAL_IP.
external-ip=${COTURN_EXTERNAL_IP}

# Relay port range. Open this range as UDP inbound on the AWS security group.
# 16 K ports is the coturn default; narrow it only if you have a concrete
# reason — a smaller range trades off the max concurrent relayed sessions.
min-port=49152
max-port=65535

# Static long-term credential. The username is fixed to `livekit` so the
# matching livekit.prod.yaml entry is obvious; the password (TURN_SHARED_SECRET)
# is rendered into BOTH files from the same env value — impossible to drift.
lt-cred-mech
user=livekit:${TURN_SHARED_SECRET}

# Realm shown in TURN allocation responses. Does not have to be a real DNS
# name — any string accepted by clients works — but using the production
# host makes the credential audit log self-explanatory.
realm=${COTURN_REALM}

# Limit bandwidth per session (prevent abuse)
user-quota=12
total-quota=1200

# Logging
verbose
fingerprint
# `no-cli` (deprecated in 4.10 → use `--cli`) and `no-tlsv1*` (renamed in
# 4.10 → use tls-version-min if TLS port is configured) were dropped here
# after coturn 4.10.0 flagged them as "Bad configuration format" and
# rejected the parse. We don't expose the TLS port (5349) yet anyway, so
# the version pinning was always a no-op.
no-multicast-peers
