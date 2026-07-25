#!/usr/bin/env bash
# Entrypoint for the LLP 0098 `loopback-terminated-single-instance.v1`
# hosted-edge deployment.
#
# Three processes, and the arrangement is the security contract:
#   1. Caddy terminates the public HTTPS leg (Fly passes raw TCP through) and
#      reverse-proxies to the origin over loopback.
#   2. The Snapback origin binds 127.0.0.1 ONLY. Nothing outside this network
#      namespace can address it, which is why LLP 0060 D2's edge-to-origin
#      clause holds literally and the direct-origin bypass class is empty.
#   3. The deterministic drill stream source, on loopback, never exposed.
#
# Unlike the plaintext drill this deployment makes no use of
# --allow-insecure-dev-auth: the bind is loopback, so the LLP 0060 D1 plaintext
# fence is satisfied by its ordinary rule and no override is needed or wanted.
set -euo pipefail

if [[ -z "${SNAPBACK_ADMIN_TOKEN:-}" ]]; then
  echo "SNAPBACK_HOSTED_ADMIN_TOKEN_MISSING: set the SNAPBACK_ADMIN_TOKEN Fly secret" >&2
  exit 1
fi

mkdir -p /data /data/caddy

# The signed admission chain is delivered out of band rather than baked into the
# image: the control plane cannot know in advance when an auto-stopped machine
# will wake, and an admission snapshot lives at most five minutes. A pre-signed
# chain covers the declared window and the origin selects the member covering
# its actual boot instant.
#
# Two delivery paths, in order of precedence:
#   1. a file already at /data/admission.json (delivered by `fly ssh sftp`), or
#   2. the SNAPBACK_HOSTED_ADMISSION_B64 secret, materialized here.
# The envelope is signed, so neither path grants authority by itself — a
# tampered or foreign chain is refused by the origin exactly as one delivered
# any other way.
if [[ ! -f /data/admission.json && -n "${SNAPBACK_HOSTED_ADMISSION_B64:-}" ]]; then
  printf '%s' "${SNAPBACK_HOSTED_ADMISSION_B64}" | base64 -d > /data/admission.json
  echo "hosted-edge: materialized the admission chain from its Fly secret"
fi

# Caddy starts first regardless, so the machine stays addressable while an
# operator delivers or refreshes the chain. Without this the machine would die
# for want of the very file an operator needs a live machine to deliver.
caddy start --config /app/etc/Caddyfile --adapter caddyfile
caddy_started=1

for _ in $(seq 1 60); do
  [[ -f /data/admission.json ]] && break
  echo "hosted-edge: waiting for /data/admission.json ..."
  sleep 10
done

if [[ ! -f /data/admission.json ]]; then
  echo "SNAPBACK_HOSTED_ADMISSION_MISSING: no admission chain was delivered" >&2
  exit 1
fi

caddy start --config /app/etc/Caddyfile --adapter caddyfile
caddy_started=1

/app/bin/drill-stream-source &
source_pid=$!
trap 'kill "$source_pid" 2>/dev/null || true; [[ -n "${caddy_started:-}" ]] && caddy stop 2>/dev/null || true' EXIT

exec /app/bin/snapback \
  --host 127.0.0.1 \
  --port 4287 \
  --db /data/hosted.sqlite3 \
  --ready-file /data/ready.json \
  --startup-artifacts /app/etc/startup-artifacts.json \
  --auth-deployment hosted \
  --hosted-edge /app/etc/hosted-edge.json \
  --hosted-admission /data/admission.json
