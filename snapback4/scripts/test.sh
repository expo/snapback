#!/usr/bin/env bash
# The blocking suite. Every step runs; every failure is reported; exit 1 if any failed.
# Budget: 60 s total (rules/RULES.md, adopted by LLP 3000 §4).
set -u
cd "$(dirname "$0")/.."
failures=()
child_pids=()
client_test_serial=0
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

run_logged() {
  local key="$1" name="$2" elapsed=$SECONDS
  shift 2
  {
    echo "== $name"
    if "$@"; then
      echo "-- ok: $name ($((SECONDS - elapsed)) s)"
      printf 'ok\n' >"$parallel_dir/$key.status"
    else
      echo "-- FAIL: $name ($((SECONDS - elapsed)) s)"
      printf 'fail\n' >"$parallel_dir/$key.status"
    fi
  } >"$parallel_dir/$key.log" 2>&1
}

run_host_tests() {
  local host_test_status=0 path target
  local host_targets=()
  # Discover every integration target except lifecycle from the conventional
  # Cargo layout. This keeps new host targets in the blocking suite while the
  # subprocess/listener-heavy lifecycle target runs at one harness thread.
  for path in crates/snapback4/tests/*.rs; do
    target=$(basename "$path" .rs)
    [ "$target" = lifecycle ] || host_targets+=(--test "$target")
  done
  cargo test -p snapback4 "${host_targets[@]}" --no-fail-fast --quiet || host_test_status=1
  # The binary and lifecycle targets open real listeners and subprocess pipes.
  # Keep concurrency inside each test, but serialize the harness across these
  # targets so Darwin's default 256-descriptor process limit is sufficient.
  cargo test -p snapback4 --bins --test lifecycle --no-fail-fast --quiet -- --test-threads=1 || host_test_status=1
  return "$host_test_status"
}

run_rust_tests() {
  local rust_test_status=0 key package path pid status target
  local rust_pids=()
  local rust_keys=()

  rust_cleanup() {
    local cleanup_status=$?
    trap - EXIT INT TERM
    for pid in "${rust_pids[@]:-}"; do
      [ -n "$pid" ] || continue
      kill "$pid" 2>/dev/null || true
    done
    for pid in "${rust_pids[@]:-}"; do
      [ -n "$pid" ] || continue
      wait "$pid" 2>/dev/null || true
    done
    exit "$cleanup_status"
  }
  trap rust_cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  run_rust_lane() {
    local key="$1"
    shift
    (
      if "$@"; then
        printf 'ok\n' >"$parallel_dir/rust-$key.status"
      else
        printf 'fail\n' >"$parallel_dir/rust-$key.status"
      fi
    ) >"$parallel_dir/rust-$key.log" 2>&1 &
    rust_pids+=("$!")
    rust_keys+=("$key")
  }

  # These crates and the host target have disjoint test processes. Cargo
  # otherwise waits for every test binary in one crate before starting the
  # next crate, leaving most cores idle during the large lowering census.
  for package in snapback4-core snapback4-native snapback4-sim; do
    run_rust_lane "$package" cargo test -p "$package" --no-fail-fast --quiet
  done
  # Cargo otherwise runs a package's integration binaries one after another.
  # Keep every device target, but let the independent binaries overlap. The
  # optimized production-scale fixtures need more than Rust's 2 MiB default
  # test-thread stack; eight 32 MiB stacks are a bounded 256 MiB ceiling.
  run_rust_lane snapback4-device-lib env RUST_MIN_STACK=33554432 cargo test -p snapback4-device --lib --quiet
  run_rust_lane snapback4-device-doc env RUST_MIN_STACK=33554432 cargo test -p snapback4-device --doc --quiet
  for path in crates/snapback4-device/tests/*.rs; do
    target=$(basename "$path" .rs)
    run_rust_lane "snapback4-device-$target" env RUST_MIN_STACK=33554432 cargo test -p snapback4-device --test "$target" --quiet -- --test-threads=8
  done
  # The baseline census is independently reproducible. Run it beside the
  # rest of the language crate while keeping every other lowering assertion.
  run_rust_lane snapback4-lang-golden cargo test -p snapback4-lang --test lowering baseline_golden_and_ownership_switch_agree_byte_for_byte --quiet
  run_rust_lane snapback4-lang-rest cargo test -p snapback4-lang --no-fail-fast --quiet -- --skip baseline_golden_and_ownership_switch_agree_byte_for_byte
  run_rust_lane snapback4-host run_host_tests

  for pid in "${rust_pids[@]}"; do
    wait "$pid" || true
  done
  rust_pids=()
  for key in "${rust_keys[@]}"; do
    cat "$parallel_dir/rust-$key.log"
    status=$(cat "$parallel_dir/rust-$key.status" 2>/dev/null || printf 'missing\n')
    [ "$status" = ok ] || rust_test_status=1
  done
  return "$rust_test_status"
}

run_client_tests() {
  if [ "$client_test_serial" = 1 ]; then
    echo "-- loaded host: client test files run serially"
    node --test --test-concurrency=1 'packages/snapback4/test/*.test.mjs'
  else
    node --test 'packages/snapback4/test/*.test.mjs'
  fi
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
run "package typecheck" bun run --cwd packages/snapback4 typecheck
run "package build" bun run --cwd packages/snapback4 build
run "chat app check" bash -c 'cd apps/chat && ../../target/debug/snapback4 check'
if [ "${SNAPBACK4_TEST_SERIAL_CLIENT_FILES:-0}" = 1 ]; then
  client_test_serial=1
elif node -e 'const os = require("node:os"); const load = os.loadavg()[0], cpus = os.cpus().length; console.log(`-- host load: ${load.toFixed(2)} across ${cpus} CPUs`); process.exit(load >= cpus ? 0 : 1)'; then
  client_test_serial=1
fi

(run_logged "cargo-test" "cargo test" run_rust_tests) &
child_pids+=("$!")
(run_logged "fixture-tests" "fixture wrapper tests" node --test fixtures/) &
child_pids+=("$!")
(
  run_logged "chat-typecheck" "chat app typecheck" bun run --cwd apps/chat typecheck
  run_logged "expo-typecheck" "expo app typecheck" bun run --cwd apps/chat-expo typecheck
  # Loaded hosts run files serially; each file retains its intended internal
  # concurrency. Idle qualification hosts keep the blocking-suite budget.
  run_logged "client-tests" "client tests" run_client_tests
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
collect "client-tests" "client tests"
end=$(date +%s)
echo "== ${#failures[@]} failure(s) in $((end - start)) s"
for f in "${failures[@]:-}"; do [ -n "$f" ] && echo "   $f"; done
[ ${#failures[@]} -eq 0 ]
