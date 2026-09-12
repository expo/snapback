#!/usr/bin/env bash
# The blocking suite. Every step runs; every failure is reported; exit 1 if any failed.
# Budget: 60 s total (rules/RULES.md, adopted by LLP 3000 §4).
set -u
cd "$(dirname "$0")/.."
failures=()
run() { local name="$1"; shift; echo "== $name"; if "$@"; then echo "-- ok: $name"; else echo "-- FAIL: $name"; failures+=("$name"); fi; }
start=$(date +%s)
run "cargo test" cargo test --workspace --quiet
run "package typecheck" bun run --cwd packages/snapback4 typecheck
run "chat app typecheck" bun run --cwd apps/chat typecheck
end=$(date +%s)
echo "== ${#failures[@]} failure(s) in $((end - start)) s"
for f in "${failures[@]:-}"; do [ -n "$f" ] && echo "   $f"; done
[ ${#failures[@]} -eq 0 ]
