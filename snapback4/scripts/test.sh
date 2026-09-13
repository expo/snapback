#!/usr/bin/env bash
# The blocking suite. Every step runs; every failure is reported; exit 1 if any failed.
# Budget: 60 s total (rules/RULES.md, adopted by LLP 3000 §4).
set -u
cd "$(dirname "$0")/.."
failures=()
child_pids=()
parallel_dir=$(mktemp -d "${TMPDIR:-/tmp}/snapback4-test.XXXXXX")

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  for pid in "${child_pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  for pid in "${child_pids[@]}"; do
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

(run_logged "cargo-test" "cargo test" cargo test --workspace --no-fail-fast --quiet) &
child_pids+=("$!")
(run_logged "fixture-tests" "fixture wrapper tests" node --test fixtures/) &
child_pids+=("$!")
(
  run_logged "chat-typecheck" "chat app typecheck" bun run --cwd apps/chat typecheck
  run_logged "expo-typecheck" "expo app typecheck" bun run --cwd apps/chat-expo typecheck
  run_logged "client-tests" "client tests" node --test 'packages/snapback4/test/*.test.mjs'
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
