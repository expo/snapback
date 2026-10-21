#!/usr/bin/env bash
# Evaluation only. When no connection is provided, start a private socket-only
# cluster, stop precisely that cluster on exit, and leave its data for inspection.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" != "" && "${1:-}" != "--bench" ]]; then
  echo "usage: bash scripts/test-postgres.sh [--bench]" >&2
  exit 2
fi
if [[ -z "${SNAPBACK4_EVAL_POSTGRES:-}" ]]; then
  for tool in initdb pg_ctl; do
    command -v "$tool" >/dev/null || { echo "Install PostgreSQL 16+ ($tool must be on PATH), or set SNAPBACK4_EVAL_POSTGRES to an isolated local database." >&2; exit 1; }
  done
  eval_dir="$(mktemp -d /tmp/sb4-pg-eval.XXXXXX)"
  locale_args=(--no-locale)
  if [[ -n "${SNAPBACK4_PG_LOCALE:-}" ]]; then
    locale_args=(--locale="$SNAPBACK4_PG_LOCALE")
  fi
  # Extracted PostgreSQL packages can carry share files outside initdb's
  # compiled-in prefix. The ordinary installed/default path stays unchanged.
  share_args=()
  if [[ -n "${SNAPBACK4_PG_SHARE:-}" ]]; then
    share_args=(-L "$SNAPBACK4_PG_SHARE")
  fi
  echo "Evaluation cluster locale: ${SNAPBACK4_PG_LOCALE:-C (--no-locale)}" >&2
  initdb -D "$eval_dir/data" -U sb4_eval --auth-local=trust --auth-host=reject --encoding=UTF8 "${locale_args[@]}" "${share_args[@]}" >/dev/null
  cleanup() {
    local stop_status=0 status_status=0
    pg_ctl -D "$eval_dir/data" -m fast -w stop >/dev/null || stop_status=$?
    pg_ctl -D "$eval_dir/data" status >/dev/null 2>&1 || status_status=$?
    if [[ "$stop_status" != 0 || "$status_status" != 3 || -e "$eval_dir/data/postmaster.pid" ]]; then
      echo "Evaluation cluster stop NOT confirmed: $eval_dir (stop=$stop_status status=$status_status)" >&2
      exit 1
    fi
    echo "Evaluation cluster stopped and confirmed (status=3, no postmaster.pid); data retained at $eval_dir" >&2
  }
  trap cleanup EXIT
  pg_ctl -D "$eval_dir/data" -l "$eval_dir/server.log" -o "-k $eval_dir -c listen_addresses= -c max_connections=400 -p 55439" -w start >/dev/null
  export SNAPBACK4_EVAL_POSTGRES="host=$eval_dir port=55439 user=sb4_eval dbname=postgres"
fi
# Report every stage even when an earlier fixture fails. In particular, an
# experiment failure must not silently leave the gated family contracts unrun.
status=0
cargo test --locked --manifest-path experiments/postgres/Cargo.toml -- --include-ignored --nocapture || status=1
cargo test --locked -p snapback4-core --features postgres --lib engine::postgres::tests -- --include-ignored --nocapture || status=1
cargo test --locked -p snapback4-core --features postgres --test corpus -- --nocapture || status=1
if [[ "${1:-}" == "--bench" ]]; then
  cargo run --locked --release --manifest-path experiments/postgres/Cargo.toml -- "${SNAPBACK4_EVAL_ITERATIONS:-200}" || status=1
fi
exit "$status"
