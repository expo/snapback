#!/usr/bin/env bash
# Everything that blocks, in one run, reporting every failure (rules/RULES.md).
set -uo pipefail
cd "$(dirname "$0")/.."
status=0
echo "== cargo test --workspace"; cargo test --workspace --quiet 2>&1 | tail -20 || status=1
echo "== evaluator (IR twin vs corpus)"; (cd packages/evaluator && bun src/test.ts) || status=1
echo "== compiler (TS subset -> IR, checked by the binary)"; (cd packages/compiler && bun run check && bun src/test.ts) || status=1

# LLP 1003's engine proof is useful on prepared machines, but Hermes is not a
# dependency of the five blocking checks. Keep failures visible and non-blocking.
arch="$(uname -m)"; case "$arch" in arm64|aarch64) arch=arm64;; *) arch=x64;; esac
hermes_dir="${IBEX2_VANILLA_HERMES_DIR:-${HOME}/projects/ibex/ios/Frameworks-vanilla}"
hermesc="${IBEX2_HERMESC:-${HOME}/projects/ibex/tools/hermes-vanilla/hermesc-macos-${arch}}"
if [ -d "$hermes_dir" ] && [ -x "$hermesc" ]; then
  echo "== effects engine (NON-BLOCKING: Ibex 2 + vanilla Hermes)"
  scripts/hermes test -p snapback2-effects --quiet || echo "!! effects engine test FAILED (non-blocking; blocking checks continue)" >&2
else
  echo "== effects engine SKIPPED LOUDLY (non-blocking): vanilla Hermes is not prepared" >&2
  echo "   expected IBEX2_VANILLA_HERMES_DIR=$hermes_dir" >&2
  echo "   expected IBEX2_HERMESC=$hermesc" >&2
fi
exit $status
