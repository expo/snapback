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
    # The broad fixtures can leave a large checkpoint; wait for this owned
    # cluster to finish it before independently checking that it stopped.
    pg_ctl -D "$eval_dir/data" -m fast -t 180 -w stop >/dev/null || stop_status=$?
    pg_ctl -D "$eval_dir/data" status >/dev/null 2>&1 || status_status=$?
    if [[ "$stop_status" != 0 || "$status_status" != 3 || -e "$eval_dir/data/postmaster.pid" ]]; then
      echo "Evaluation cluster stop NOT confirmed: $eval_dir (stop=$stop_status status=$status_status)" >&2
      exit 1
    fi
    echo "Evaluation cluster stopped and confirmed (status=3, no postmaster.pid); data retained at $eval_dir" >&2
  }
  trap cleanup EXIT
  pg_ctl -D "$eval_dir/data" -l "$eval_dir/server.log" -o "-k $eval_dir -c listen_addresses= -c max_connections=400 -p 55439" -w start >/dev/null
  echo "Evaluation cluster PID $(head -n 1 "$eval_dir/data/postmaster.pid"); directory $eval_dir" >&2
  export SNAPBACK4_EVAL_POSTGRES="host=$eval_dir port=55439 user=sb4_eval dbname=postgres"
fi
# Report every stage even when an earlier fixture fails. In particular, an
# experiment failure must not silently leave the gated family contracts unrun.
status=0
# @ref LLP 3000.009.001.000#3.4 — a shared target must not carry path-crate identities between the two workspaces.
refresh_shared_target() {
  if [[ -n "${CARGO_TARGET_DIR:-}" ]]; then
    echo "Cleaning core/lang/device debug artifacts at a shared-target manifest handoff" >&2
    cargo clean --manifest-path "$1" --profile dev -p snapback4-core -p snapback4-lang -p snapback4-device
  fi
}
refresh_shared_target experiments/postgres/Cargo.toml || status=1
# Keep later evaluator integration targets running after a conformance red.
# include-ignored enables private-cluster fixtures, but must not re-enable the
# ticketed heap regressions or the additional retained Serializable race.
# Keep the original evaluator stress case running: its inherited 40001 is
# reported independently, never converted to a successful qualification.
cargo test --locked --no-fail-fast --manifest-path experiments/postgres/Cargo.toml -- --include-ignored --nocapture \
  --skip prefetch_complete_fixture_queries_mutations_and_hidden_rows \
  --skip unified_add_spare_capacity_meter_overlap_regression \
  --skip evaluator_racing_refused_operations_replay_one_receipt_without_advancing_head || status=1
refresh_shared_target Cargo.toml || status=1
cargo test --locked -p snapback4-core --features postgres --lib engine::postgres::tests -- --include-ignored --nocapture --skip plan_hygiene::log_plan_hygiene_cold_backend_tail_scan_witness || status=1
# The cold-plan witness observes cluster-wide plan/statistics state; run it alone.
cargo test --locked -p snapback4-core --features postgres --lib engine::postgres::tests::plan_hygiene::log_plan_hygiene_cold_backend_tail_scan_witness -- --include-ignored --nocapture --test-threads 1 || status=1
cargo test --locked -p snapback4-core --features postgres --lib change_evidence -- --include-ignored --nocapture || status=1
cargo test --locked -p snapback4-core --features postgres --lib engine::postgres::literal_tests -- --include-ignored --nocapture || status=1
cargo test --locked -p snapback4-core --features postgres --lib engine::postgres::ownership::tests -- --include-ignored --nocapture || status=1
cargo test --locked -p snapback4-core --features postgres --test postgres_evolution -- --include-ignored --nocapture || status=1
cargo test --locked -p snapback4-core --features postgres --test store_handle_traits || status=1
cargo test --locked -p snapback4-core --features postgres --doc || status=1
cargo test --locked -p snapback4-core --features postgres --lib engine::committer::postgres_tests -- --include-ignored --nocapture || status=1
cargo test --locked -p snapback4-core --features postgres --lib engine::committer::maintained_members -- --include-ignored --nocapture || status=1
cargo test --locked -p snapback4-core --features postgres --lib engine::command::tests -- --include-ignored --nocapture || status=1
cargo test --locked -p snapback4 --features postgres --bin snapback4 s10c_postgres_internal_http_host_witness -- --include-ignored --nocapture || status=1
cargo test --locked -p snapback4 --features postgres --bin snapback4 change_evidence_changes_snapshot -- --include-ignored --nocapture || status=1
cargo test --locked -p snapback4 --features postgres --bin snapback4 postgres_startup_renewal_error_releases_committed_claim -- --include-ignored --nocapture || status=1
cargo test --locked -p snapback4 --features postgres --bin snapback4 round_trips_postgres -- --include-ignored --nocapture || status=1
cargo test --locked -p snapback4 --features postgres --bin snapback4 postgres_bearer_is_checked_after_durable_and_ephemeral_mutation_lock_gaps -- --include-ignored --nocapture || status=1
cargo test --locked -p snapback4 --features postgres --bin snapback4 rt3b_ -- --include-ignored --nocapture || status=1
SNAPBACK4_CORPUS_OVERLAP=1 cargo test --locked -p snapback4-core --features postgres --test corpus -- --include-ignored --nocapture || status=1
# Exercise migrated preludes, snapshot resets, replay and explicit unsupported accounting.
cargo test --locked -p snapback4-difftest --features postgres --no-fail-fast --lib --test stores -- --nocapture || status=1
# Public serving is a separate CLI process over its own private cluster, never
# the evaluator's namespace/connection. Build the shipped default CLI first.
cargo build --locked -p snapback4 || status=1
python3 scripts/test-postgres-serve.py || status=1
if [[ "${1:-}" == "--bench" ]]; then
  cargo run --locked --release --manifest-path experiments/postgres/Cargo.toml -- "${SNAPBACK4_EVAL_ITERATIONS:-200}" || status=1
fi
exit "$status"
