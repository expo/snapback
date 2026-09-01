#!/usr/bin/env bash
# Everything that blocks, in one run, reporting every failure (rules/RULES.md).
set -uo pipefail
cd "$(dirname "$0")/.."

run_compiler_checks() {
  compiler_dir="$1"
  echo "== compiler type checking"; (cd "$compiler_dir" && bun run check) || status=1
  echo "== compiler tests"; (cd "$compiler_dir" && bun src/test.ts) || status=1
}

if [ "${1:-}" = "--self-test" ]; then
  fixture="$(mktemp -d -t snapback2-test-script)"
  trap 'rm -rf "$fixture"' EXIT
  mkdir -p "$fixture/bin" "$fixture/compiler"
  command_log="$fixture/commands"
  printf '%s\n' '#!/bin/sh' 'printf "%s\n" "$*" >> "$SNAPBACK2_TEST_COMMAND_LOG"' 'exit 1' > "$fixture/bin/bun"
  chmod +x "$fixture/bin/bun"
  status=0
  SNAPBACK2_TEST_COMMAND_LOG="$command_log" PATH="$fixture/bin:$PATH" run_compiler_checks "$fixture/compiler"
  observed="$status"
  status=0
  [ "$observed" -eq 1 ] || status=1
  grep -qx 'run check' "$command_log" || status=1
  grep -qx 'src/test.ts' "$command_log" || status=1
  [ "$status" -eq 0 ] && echo "test script self-test ok"
  exit "$status"
fi

status=0
echo "== blocking script self-test"; "$0" --self-test || status=1
echo "== bundle the compiler worker + client (the owner tests load dist/)"; (cd packages/snapback2 && node build.mjs >/dev/null) || status=1
# Not a pipe: a test-spawned child that inherits stdout would hold `tail` open forever.
cargo_log="$(mktemp -t snapback2-cargo-test)"
echo "== cargo test --workspace"; cargo test --workspace --quiet > "$cargo_log" 2>&1 || status=1; tail -20 "$cargo_log"; rm -f "$cargo_log"
echo "== evaluator (IR twin vs corpus)"; (cd packages/evaluator && bun src/test.ts) || status=1
run_compiler_checks packages/compiler
exit $status
