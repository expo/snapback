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
  initdb -D "$eval_dir/data" -U sb4_eval --auth-local=trust --auth-host=reject --encoding=UTF8 --no-locale >/dev/null
  cleanup() {
    pg_ctl -D "$eval_dir/data" -m fast -w stop >/dev/null || true
    echo "Evaluation cluster stopped; data retained at $eval_dir" >&2
  }
  trap cleanup EXIT
  pg_ctl -D "$eval_dir/data" -l "$eval_dir/server.log" -o "-k $eval_dir -c listen_addresses= -p 55439" -w start >/dev/null
  export SNAPBACK4_EVAL_POSTGRES="host=$eval_dir port=55439 user=sb4_eval dbname=postgres"
fi
cargo test --locked --manifest-path experiments/postgres/Cargo.toml -- --include-ignored --nocapture
if [[ "${1:-}" == "--bench" ]]; then
  cargo run --locked --release --manifest-path experiments/postgres/Cargo.toml -- "${SNAPBACK4_EVAL_ITERATIONS:-200}"
fi
