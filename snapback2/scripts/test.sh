#!/usr/bin/env bash
# Everything that blocks, in one run, reporting every failure (rules/RULES.md).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
status=0
# Snapback2 has no workerd tests competing for process slots. Eight lets the
# long owner journeys overlap while remaining overrideable on smaller hosts.
rust_test_threads="${SNAPBACK_RUST_TEST_THREADS:-8}"
nextest_bin="${SNAPBACK_CARGO_NEXTEST_BIN:-cargo-nextest}"
nextest_config="$(pwd)/../.config/nextest.toml"

echo "== bundle the compiler worker + client (the owner tests load dist/)"; (cd packages/snapback2 && node build.mjs >/dev/null) || status=1
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
echo "== compiler (TS subset -> IR, checked by the binary)"; (cd packages/compiler && bun run check && bun src/test.ts) || status=1
exit $status
