#!/usr/bin/env bash
# The blocking suite. Every step runs; every failure is reported; exit 1 if any failed.
# Budget: 60 s total (rules/RULES.md, adopted by LLP 3000 §4).
set -u
cd "$(dirname "$0")/.."
failures=()
child_pids=()
client_test_concurrency=1
parallel_dir=$(mktemp -d "${TMPDIR:-/tmp}/snapback4-test.XXXXXX")

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  for pid in "${child_pids[@]:-}"; do
    [ -n "$pid" ] || continue
    kill "$pid" 2>/dev/null || true
  done
  for pid in "${child_pids[@]:-}"; do
    [ -n "$pid" ] || continue
    wait "$pid" 2>/dev/null || true
  done
  rm -rf "$parallel_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

run() {
  local name="$1" elapsed=$SECONDS
  shift
  echo "== $name"
  if "$@"; then
    echo "-- ok: $name ($((SECONDS - elapsed)) s)"
  else
    echo "-- FAIL: $name ($((SECONDS - elapsed)) s)"
    failures+=("$name")
  fi
}

stop_logged_command() {
  local signal="$1" status="$2"
  trap '' INT TERM
  kill -s "$signal" "$command_pid" 2>/dev/null || true
  wait "$command_pid" 2>/dev/null || true
  exit "$status"
}

run_logged() {
  local key="$1" name="$2" elapsed=$SECONDS command_pid command_status=0
  shift 2
  echo "== $name" >"$parallel_dir/$key.log"
  "$@" >>"$parallel_dir/$key.log" 2>&1 &
  command_pid=$!
  trap 'stop_logged_command INT 130' INT
  trap 'stop_logged_command TERM 143' TERM
  wait "$command_pid" || command_status=$?
  trap - INT TERM
  if [ "$command_status" = 0 ]; then
    echo "-- ok: $name ($((SECONDS - elapsed)) s)" >>"$parallel_dir/$key.log"
    printf 'ok\n' >"$parallel_dir/$key.status"
  else
    echo "-- FAIL: $name ($((SECONDS - elapsed)) s)" >>"$parallel_dir/$key.log"
    printf 'fail\n' >"$parallel_dir/$key.status"
  fi
}

stop_client_commands() {
  local signal="$1" status="$2" pid
  trap '' INT TERM
  for pid in "${client_pids[@]:-}"; do
    [ -n "$pid" ] || continue
    kill -s "$signal" "$pid" 2>/dev/null || true
  done
  for pid in "${client_pids[@]:-}"; do
    [ -n "$pid" ] || continue
    wait "$pid" 2>/dev/null || true
  done
  exit "$status"
}

run_client_tests() {
  local client_status=0 path pid
  local client_files=()
  local client_pids=()
  trap 'stop_client_commands INT 130' INT
  trap 'stop_client_commands TERM 143' TERM
  for path in packages/snapback4/test/*.test.mjs; do
    case "$(basename "$path")" in
      app-session-model.test.mjs|online-client-model.test.mjs) ;;
      *) client_files+=("$path") ;;
    esac
  done
  echo "-- client test files: ${#client_files[@]}; concurrency: $client_test_concurrency"
  # Independent per-file watchdog: 15-minute base; named long files add
  # aggregate inner guards + 25% (run-client-tests.mjs), also in serial mode.
  # Cleanup verifies group membership after TERM/KILL, including reparenting.
  node scripts/run-client-tests.mjs "$client_test_concurrency" files "${client_files[@]}" &
  client_pids+=("$!")
  for pid in "${client_pids[@]}"; do
    wait "$pid" || client_status=1
  done
  trap - INT TERM
  return "$client_status"
}

collect() {
  local key="$1" name="$2" status
  if [ -f "$parallel_dir/$key.log" ]; then
    cat "$parallel_dir/$key.log"
  fi
  if [ -f "$parallel_dir/$key.status" ]; then
    status=$(cat "$parallel_dir/$key.status")
  else
    status=missing
    echo "== $name"
    echo "-- FAIL: $name (parallel worker ended before reporting)"
  fi
  if [ "$status" != ok ]; then
    failures+=("$name")
  fi
}

start=$(date +%s)
run "cargo build" cargo build --workspace --quiet
run "wasm build" bash scripts/build-wasm.sh
run "docs budget" node scripts/docs-budget.mjs
run "release guard" bash scripts/check-release-guard.sh
run "package typecheck" bun run --cwd packages/snapback4 typecheck
run "package build" bun run --cwd packages/snapback4 build
run "chat app check" bash -c 'cd apps/chat && ../../target/debug/snapback4 check'

(run_logged "cargo-test" "cargo test" node scripts/run-rust-tests.mjs) &
child_pids+=("$!")
(run_logged "fixture-tests" "fixture wrapper tests" node scripts/run-client-tests.mjs 1 files fixtures/) &
child_pids+=("$!")
(
  run_logged "chat-typecheck" "chat app typecheck" bun run --cwd apps/chat typecheck
  run_logged "expo-typecheck" "expo app typecheck" bun run --cwd apps/chat-expo typecheck
) &
child_pids+=("$!")

for index in "${!child_pids[@]}"; do
  wait "${child_pids[$index]}" || true
  unset 'child_pids[index]'
done
child_pids=()

collect "cargo-test" "cargo test"
collect "chat-typecheck" "chat app typecheck"
collect "expo-typecheck" "expo app typecheck"
collect "fixture-tests" "fixture wrapper tests"
# @ref LLP 3000#publication-suite-on-small-hosts — a file also owns servers,
# device processes and browser renderers. Budget three available CPUs per slot;
# every client file shares this pool, with no extra shards outside the limit.
# availableParallelism respects affinity; host-wide load does not describe it.
# Rust's compiler and test processes have already drained before clients start.
client_test_cpus=$(node -p 'require("node:os").availableParallelism()')
if [ "${SNAPBACK4_TEST_SERIAL_CLIENT_FILES:-0}" != 1 ]; then
  client_test_concurrency=$((client_test_cpus / 3))
  if [ "$client_test_concurrency" -lt 1 ]; then client_test_concurrency=1; fi
  if [ "$client_test_concurrency" -gt 24 ]; then client_test_concurrency=24; fi
fi
echo "-- available CPUs: $client_test_cpus; client file concurrency: $client_test_concurrency"
(run_logged "client-tests" "client tests" run_client_tests) &
child_pids+=("$!")
wait "${child_pids[0]}" || true
child_pids=()
collect "client-tests" "client tests"
# The two seeded models keep full counts and aggregate hang guards. Give them a
# serial slot after Rust compilation/tests and every other client file finish.
# Named aggregate guards plus 25% and 900 s also apply to these model files.
run "client models" node scripts/run-client-tests.mjs 1 models \
  packages/snapback4/test/app-session-model.test.mjs \
  packages/snapback4/test/online-client-model.test.mjs
end=$(date +%s)
echo "== ${#failures[@]} failure(s) in $((end - start)) s"
for f in "${failures[@]:-}"; do [ -n "$f" ] && echo "   $f"; done
[ ${#failures[@]} -eq 0 ]
