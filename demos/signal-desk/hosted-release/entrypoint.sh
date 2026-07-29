#!/bin/sh
#
# One target boot owns one admission renewer, one loopback Snapback origin, and
# one in-namespace TLS terminator. Any renewer failure terminates the origin.
#
# @ref LLP 0111#always-on-supervisor-and-canonical-single-writer-head — the
# target pulls short-lived authority over outbound mTLS and never holds Fly
# control or admission-signing credentials.
set -eu

caddy_pid=
renewer_pid=
origin_pid=

cleanup() {
  trap - EXIT
  for child_pid in "$origin_pid" "$renewer_pid" "$caddy_pid"; do
    [ -z "$child_pid" ] || kill "$child_pid" 2>/dev/null || true
  done
  for child_pid in "$origin_pid" "$renewer_pid" "$caddy_pid"; do
    [ -z "$child_pid" ] || wait "$child_pid" 2>/dev/null || true
  done
}

trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

fail() {
  printf '%s: %s\n' "$1" "$2" >&2
  exit 1
}

require_file() {
  [ -f "$1" ] || fail SNAPBACK_HOSTED_RELEASE_CLOSURE_MISSING "$1 is missing"
  [ ! -L "$1" ] || fail SNAPBACK_HOSTED_RELEASE_CLOSURE_UNSAFE "$1 is a symlink"
}

target_id="${SNAPBACK_HOSTED_TARGET_ID:-}"
deployment_id="${SNAPBACK_HOSTED_DEPLOYMENT_ID:-}"
machine_id="${FLY_MACHINE_ID:-}"
admission_path="${SNAPBACK_HOSTED_ADMISSION_PATH:-/data/control/admission.json}"
edge_config="${SNAPBACK_HOSTED_EDGE_CONFIG:-/app/etc/hosted-edge.json}"
startup_artifacts="${SNAPBACK_STARTUP_ARTIFACTS:-/app/etc/startup-artifacts.json}"

[ -n "$target_id" ] || fail SNAPBACK_HOSTED_TARGET_ID_MISSING "SNAPBACK_HOSTED_TARGET_ID is required"
[ -n "$deployment_id" ] || fail SNAPBACK_HOSTED_DEPLOYMENT_ID_MISSING "SNAPBACK_HOSTED_DEPLOYMENT_ID is required"
[ -n "$machine_id" ] || fail SNAPBACK_HOSTED_MACHINE_ID_MISSING "FLY_MACHINE_ID is required"
require_file /app/bin/snapback
require_file /app/bin/hermesc
require_file /app/lib/libhermesvm.so
require_file /app/etc/Caddyfile
require_file "$edge_config"
require_file "$startup_artifacts"
require_file /app/share/release-manifest.json

if [ "${SNAPBACK_HOSTED_PREFLIGHT_ONLY:-0}" = "1" ]; then
  # A non-routed candidate may prove its sealed native closure, but must not
  # contact the admission supervisor or claim served-path evidence.
  exec /app/bin/snapback build-identity
fi

mkdir -p /data/app /data/caddy /data/control /run/snapback
rm -f /run/snapback/admission-ready

caddy run --config /app/etc/Caddyfile --adapter caddyfile &
caddy_pid=$!

/app/bin/admission-renewer.sh &
renewer_pid=$!

waited=0
while [ ! -f /run/snapback/admission-ready ]; do
  if ! kill -0 "$renewer_pid" 2>/dev/null; then
    kill "$caddy_pid" 2>/dev/null || true
    wait "$caddy_pid" 2>/dev/null || true
    fail SNAPBACK_HOSTED_ADMISSION_INITIAL_FAILED "renewer exited before the first valid envelope"
  fi
  waited=$((waited + 1))
  [ "$waited" -lt 65 ] || {
    kill "$renewer_pid" "$caddy_pid" 2>/dev/null || true
    fail SNAPBACK_HOSTED_ADMISSION_INITIAL_TIMEOUT "no valid admission arrived within 64 seconds"
  }
  sleep 1
done

/app/bin/snapback start \
  --host 127.0.0.1 \
  --port 4287 \
  --db /data/app/hosted.sqlite3 \
  --ready-file /data/control/ready.json \
  --startup-artifacts "$startup_artifacts" \
  --auth-deployment hosted \
  --hosted-edge "$edge_config" \
  --hosted-admission "$admission_path" &
origin_pid=$!

exit_code=0
while :; do
  if ! kill -0 "$renewer_pid" 2>/dev/null; then
    printf '%s\n' "SNAPBACK_HOSTED_ADMISSION_RENEWER_STOPPED: withdrawing origin" >&2
    exit_code=75
    break
  fi
  if ! kill -0 "$origin_pid" 2>/dev/null; then
    wait "$origin_pid" || exit_code=$?
    break
  fi
  if ! kill -0 "$caddy_pid" 2>/dev/null; then
    printf '%s\n' "SNAPBACK_HOSTED_TLS_TERMINATOR_STOPPED: withdrawing origin" >&2
    exit_code=76
    break
  fi
  sleep 1
done

exit "$exit_code"
