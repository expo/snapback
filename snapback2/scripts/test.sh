#!/usr/bin/env bash
# Everything that blocks, in one run, reporting every failure (rules/RULES.md).
set -uo pipefail
cd "$(dirname "$0")/.."
status=0
echo "== cargo test --workspace"; cargo test --workspace --quiet 2>&1 | tail -20 || status=1
echo "== evaluator (IR twin vs corpus)"; (cd packages/evaluator && bun src/test.ts) || status=1
echo "== compiler (TS subset -> IR, checked by the binary)"; (cd packages/compiler && bun run check && bun src/test.ts) || status=1
exit $status
