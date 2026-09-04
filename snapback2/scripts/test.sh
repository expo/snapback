#!/usr/bin/env bash
# Everything that blocks, in one run, reporting every failure (rules/RULES.md).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

run_compiler_checks() {
  compiler_dir="$1"
  echo "== compiler type checking"; (cd "$compiler_dir" && bun run check) || status=1
  echo "== compiler tests"; (cd "$compiler_dir" && bun src/test.ts) || status=1
}

if [ "${1:-}" = "--self-test" ]; then
  fixture="$(mktemp -d -t snapback2-test-script.XXXXXX)" || {
    echo "test script self-test: cannot create fixture" >&2
    exit 1
  }
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
# Snapback2 has no workerd tests competing for process slots. Eight lets the
# long owner journeys overlap while remaining overrideable on smaller hosts.
rust_test_threads="${SNAPBACK_RUST_TEST_THREADS:-8}"
nextest_bin="${SNAPBACK_CARGO_NEXTEST_BIN:-cargo-nextest}"
nextest_config="$(pwd)/../.config/nextest.toml"

echo "== blocking script self-test"; "$0" --self-test || status=1
echo "== bundle the compiler worker + client (the owner tests load dist/)"; (cd packages/snapback2 && node build.mjs >/dev/null) || status=1
echo "== package offline protocol + store + bytes + outbox + twin (non-owner)"; (cd packages/snapback2 && node --test --test-timeout=10000 tests/offline-protocol.test.ts tests/offline-store.test.ts tests/offline-bytes.test.ts tests/offline-view-once.test.ts tests/offline-resume-tail.test.ts tests/outbox.test.ts tests/outbox-custody.test.ts tests/twin.test.ts tests/chat-screens.test.ts) || status=1
if nextest_path="$(command -v -- "$nextest_bin" 2>/dev/null)"; then
    echo "== cargo-nextest workspace tests (parallel, no fail-fast)"
    NEXTEST_TEST_THREADS="$rust_test_threads" \
        "$nextest_path" nextest run \
        --config-file "$nextest_config" \
        --profile local-proof \
        --workspace \
        --no-fail-fast \
        --failure-output immediate-final \
        --status-level fail \
        --final-status-level fail || status=1
else
    printf '%s\n' \
        'SNAPBACK_CARGO_NEXTEST_MISSING: cargo-nextest 0.9.143 is required for Rust tests.' >&2
    printf '%s\n' \
        'Install it with: cargo install cargo-nextest --version 0.9.143 --locked' >&2
    status=1
fi
# cargo-nextest 0.9.143 does not execute doctests. Keep them explicit and let
# Cargo continue across every workspace crate even when one doctest target fails.
echo "== cargo workspace doctests (no fail-fast)"
cargo test --workspace --doc --no-fail-fast --quiet -- \
    --test-threads "$rust_test_threads" || status=1
echo "== evaluator (IR twin vs corpus)"; (cd packages/evaluator && bun src/test.ts) || status=1
run_compiler_checks packages/compiler
exit $status
