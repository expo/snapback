#!/usr/bin/env bash
# The blocking suite. Every step runs; every failure is reported; exit 1 if any failed.
# Budget: 60 s total (rules/RULES.md, adopted by LLP 3000 §4).
set -u
cd "$(dirname "$0")/.."
failures=()
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
start=$(date +%s)
run "cargo build" cargo build --workspace --quiet
run "cargo test" cargo test --workspace --no-fail-fast --quiet
run "wasm build" bash scripts/build-wasm.sh
run "package typecheck" bun run --cwd packages/snapback4 typecheck
run "package build" bun run --cwd packages/snapback4 build
run "chat app check" bash -c 'cd apps/chat && ../../target/debug/snapback4 check'
run "chat app typecheck" bun run --cwd apps/chat typecheck
run "expo app typecheck" bun run --cwd apps/chat-expo typecheck
run "fixture wrapper tests" node --test fixtures/
run "client tests" node --test 'packages/snapback4/test/*.test.mjs'
end=$(date +%s)
echo "== ${#failures[@]} failure(s) in $((end - start)) s"
for f in "${failures[@]:-}"; do [ -n "$f" ] && echo "   $f"; done
[ ${#failures[@]} -eq 0 ]
