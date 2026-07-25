#!/usr/bin/env bash
# Entrypoint for the single-instance-container-vm.v1 remote drill machine.
#
# One Fly Machine runs exactly two processes:
#   1. the deterministic drill stream source on loopback (never exposed), and
#   2. the snapback server on 0.0.0.0:8080 behind Fly's TLS-terminating edge.
#
# Honesty notes recorded in the drill receipt:
#   - The bind is plaintext non-loopback behind the platform edge, so the
#     server profile is `test` (SNAPBACK_PROFILE) and dev auth requires the
#     explicit --allow-insecure-dev-auth override. This is drill posture, not
#     a production claim: prod-profile refusal of this exact configuration is
#     part of the shipped fence (src/admin.rs validate_plaintext_auth_transport).
#   - SNAPBACK_ADMIN_TOKEN must arrive as a Fly secret; the admin API refuses
#     writes on a non-loopback bind without it.
set -euo pipefail

if [[ -z "${SNAPBACK_ADMIN_TOKEN:-}" ]]; then
  echo "SNAPBACK_DRILL_ADMIN_TOKEN_MISSING: set the SNAPBACK_ADMIN_TOKEN Fly secret" >&2
  exit 1
fi

mkdir -p /data

/app/bin/drill-stream-source &
source_pid=$!
trap 'kill "$source_pid" 2>/dev/null || true' EXIT

# --ready-file: no controlling terminal exists in the machine, so the
# impersonation capability publishes to its owner-only sidecar descriptor.
exec /app/bin/snapback \
  --host 0.0.0.0 \
  --port 8080 \
  --db /data/drill.sqlite3 \
  --ready-file /data/ready.json \
  --allow-insecure-dev-auth
