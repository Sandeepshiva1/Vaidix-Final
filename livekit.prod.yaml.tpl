# ════════════════════════════════════════════════════════════════════════════
# Vaidix — LiveKit Server Config (PRODUCTION) — TEMPLATE
# ════════════════════════════════════════════════════════════════════════════
# Rendered to ./livekit.prod.yaml by scripts/render-configs.sh at deploy time.
# Edit THIS .tpl file, NOT the rendered output (which is .gitignored).
#
# Mounted by docker-compose.prod.yml at /etc/livekit.yaml inside the container.
# DEV uses livekit.yaml in the repo root — DO NOT collapse the two; the dev
# file hardcodes a LAN IP so the host browser can ICE-connect, and that
# strategy breaks on a cloud host.
#
# Env vars consumed (validated by render-configs.sh, render aborts on
# unrotated-placeholder / empty values):
#   ${COTURN_REALM}         — TURN realm; matches turnserver.conf
#   ${TURN_SHARED_SECRET}   — TURN password; matches turnserver.conf
#   ${LIVEKIT_API_KEY}      — token-mint API key; matches .env
#   ${LIVEKIT_API_SECRET}   — token-mint secret; matches .env
#
# The same ${TURN_SHARED_SECRET} renders into BOTH this file's `credential`
# fields AND turnserver.conf's `user=livekit:…` — guarantees the two cannot
# drift, which was the v2.4 root cause of "guest's name keeps refreshing".

port: 7880
bind_addresses:
  - ""

rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
  # On EC2 / any cloud VM: LiveKit queries the instance metadata service
  # (169.254.169.254 on AWS) at startup and uses the discovered public IP
  # as nodeIP. ICE candidates then advertise that public IP to clients,
  # which is what they can actually route to. The earlier prod outage was
  # caused by the dev `node_ip: 192.168.1.7` shipping unchanged to prod —
  # the browser tried to send media to a private Docker IP and ICE timed
  # out. Hence the split-config approach.
  use_external_ip: true
  # node_ip is intentionally omitted. With use_external_ip:true LiveKit
  # auto-fills it from the metadata service. If you ever need to pin it
  # (e.g. a host without metadata service access), uncomment and set
  # to the Elastic IP, NOT the private/docker IP.
  # node_ip: "${COTURN_EXTERNAL_IP}"

  # External TURN relay — advertised to clients alongside LiveKit's own
  # host candidates so participants behind symmetric NATs (mobile hotspots,
  # corporate firewalls) can punch through.
  #
  # Symptom this fixes: ICE candidate stats showed only `host` candidates
  # with state=failed, requestsSent=8 responsesReceived=0. Without a relay
  # candidate in the SDP, clients on restrictive networks had nowhere to
  # fall back to and the LiveKit signal channel reconnected every 15-30s.
  # That reconnect storm is what users saw as "guest's name keeps refreshing".
  #
  # `credential` is sourced from ${TURN_SHARED_SECRET} — same value renders
  # into turnserver.conf, so by construction they cannot drift. AWS security
  # group on the EC2 host must open inbound UDP 3478 + TCP 3478 + the
  # UDP relay range 49152-65535 declared in turnserver.conf.
  #
  # `host` uses ${COTURN_EXTERNAL_IP} (a bare IPv4) rather than the realm
  # DNS name on purpose: this deployment didn't have a `turn.<realm>` A
  # record published, so clients NXDOMAIN'd on the lookup and ICE never
  # tried the relay. Using the IP literal removes that DNS dependency —
  # `realm` (an auth/audit string, not a hostname) stays as a DNS-style
  # label for log readability. If you later publish a real A record + TLS
  # cert for ${COTURN_REALM}, swap these two `host:` values back to the
  # realm and add a `protocol: tls` entry on port 5349.
  turn_servers:
    - host: ${COTURN_EXTERNAL_IP}
      port: 3478
      protocol: udp
      username: livekit
      credential: ${TURN_SHARED_SECRET}
    - host: ${COTURN_EXTERNAL_IP}
      port: 3478
      protocol: tcp
      username: livekit
      credential: ${TURN_SHARED_SECRET}

redis:
  address: redis:6379

keys:
  # MUST match .env LIVEKIT_API_KEY / LIVEKIT_API_SECRET on the same host.
  # Rendered from the SAME .env values, so they cannot drift.
  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}

logging:
  level: info
  pion_level: warn
  json: false

turn:
  # Disabled here — the standalone coturn container handles relay.
  enabled: false

room:
  auto_create: true
  enable_remote_unmute: true
  max_participants: 1000
  empty_timeout: 300
  departure_timeout: 20

webhook:
  api_key: ${LIVEKIT_API_KEY}
  urls:
    # In prod everything runs inside Docker on vaidix-net, so we address the
    # Next.js app by service name. host.docker.internal works on Docker
    # Desktop (mac/win dev) but does NOT exist on Linux without explicit
    # extra_hosts mapping — that's why dev and prod webhook URLs differ.
    - http://app:3000/api/classroom/webhooks/livekit
