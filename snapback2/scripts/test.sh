#!/usr/bin/env bash
# Everything that blocks, in one run, reporting every failure (rules/RULES.md).
set -uo pipefail
cd "$(dirname "$0")/.."
status=0
echo "== bundle the compiler worker + client (the owner tests load dist/)"; (cd packages/snapback2 && node build.mjs >/dev/null) || status=1
# Not a pipe: a test-spawned child that inherits stdout would hold `tail` open forever.
cargo_log="$(mktemp -t snapback2-cargo-test)"
echo "== cargo test --workspace"; cargo test --workspace --quiet > "$cargo_log" 2>&1 || status=1; tail -20 "$cargo_log"; rm -f "$cargo_log"
echo "== evaluator (IR twin vs corpus)"; (cd packages/evaluator && bun src/test.ts) || status=1
echo "== compiler (TS subset -> IR, checked by the binary)"; (cd packages/compiler && bun run check && bun src/test.ts) || status=1
exit $status
