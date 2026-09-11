#!/usr/bin/env bash
# Everything that blocks, in one run, reporting every failure (rules/RULES.md).
set -uo pipefail
script_path="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")/.." || exit 1

run_compiler_checks() {
  compiler_dir="$1"
  compiler_status=0
  echo "== compiler type checking"; (cd "$compiler_dir" && bun run check) || compiler_status=1
  echo "== compiler tests"; (cd "$compiler_dir" && bun src/test.ts) || compiler_status=1
  return "$compiler_status"
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
  SNAPBACK2_TEST_COMMAND_LOG="$command_log" PATH="$fixture/bin:$PATH" run_compiler_checks "$fixture/compiler"
  observed="$?"
  status=0
  [ "$observed" -eq 1 ] || status=1
  grep -qx 'run check' "$command_log" || status=1
  grep -qx 'src/test.ts' "$command_log" || status=1
  [ "$status" -eq 0 ] && echo "test script self-test ok"
  exit "$status"
fi

status=0
rust_test_threads="${SNAPBACK_RUST_TEST_THREADS:-$(node -e 'process.stdout.write(String(Math.max(8, Math.min(32, require("node:os").availableParallelism()))))' 2>/dev/null || printf '8\n')}"
# @ref LLP 1002#11-measured — bound owner-heavy test-file concurrency while preserving every original per-test deadline.
package_test_threads="${SNAPBACK_PACKAGE_TEST_THREADS:-$(node -e 'process.stdout.write(String(Math.max(2, Math.min(8, require("node:os").availableParallelism()))))' 2>/dev/null || printf '2\n')}"
nextest_bin="${SNAPBACK_CARGO_NEXTEST_BIN:-cargo-nextest}"
nextest_config="$(pwd)/../.config/nextest.toml"

run_package_checks() {
  package_dir="$1"
  (cd "$package_dir" && SNAPBACK2_TEST_REPOSITORY_ROOT="$repository_root" node --test --test-concurrency="$package_test_threads" --test-timeout=10000 tests/client.test.ts tests/assets.test.ts tests/client-regressions.test.ts tests/client-recovery.test.ts tests/channels.test.ts tests/client-sessions.test.ts tests/client-history.test.ts tests/inbox.test.ts tests/real-owner.test.ts tests/real-owner-assets.test.ts tests/real-owner-upload.test.ts tests/real-owner-media.test.ts tests/real-owner-session.test.ts tests/real-owner-successor.test.ts tests/real-owner-prediction.test.ts tests/effects-visibility.test.ts tests/asset-pending.test.ts tests/asset-pending-caps.test.ts tests/native-assets.test.ts tests/native-files.test.ts tests/native-custody.test.ts tests/expo-harness.test.ts tests/expo-witness.test.ts tests/offline-protocol.test.ts tests/offline-store.test.ts tests/offline-owner-custody.test.ts tests/offline-public-state.test.ts tests/store-review.test.ts tests/store-review-custody.test.ts tests/snapshot.test.ts tests/client-items.test.ts tests/mutation-targets.test.ts tests/tombstones.test.ts tests/local-data-recovery.test.ts tests/sqlite.test.ts tests/expo.test.ts tests/offline-bytes.test.ts tests/offline-view-once.test.ts tests/drain-admission.test.ts tests/offline-resume-tail.test.ts tests/outbox.test.ts tests/outbox-custody.test.ts tests/overlay-retirement.test.ts tests/twin.test.ts tests/supersession.test.ts tests/readiness.test.ts tests/chat-screens.test.ts tests/chat-screens-owner.test.ts tests/chat-screens-transition.test.ts tests/chat-screens-recovery.test.ts tests/chat-screens-refusal.test.ts tests/auth-restoration.test.ts tests/auth-ownership.test.ts)
}

run_evaluator_checks() {
  (cd packages/evaluator && bun src/test.ts)
}

run_native_checks() {
  if nextest_path="$(command -v -- "$nextest_bin" 2>/dev/null)"; then
    SNAPBACK2_TEST_PACKAGE_PREBUILT=1 NEXTEST_TEST_THREADS="$rust_test_threads" \
      "$nextest_path" nextest run \
      --config-file "$nextest_config" \
      --profile local-proof \
      --workspace \
      --no-fail-fast \
      --failure-output immediate-final \
      --status-level fail \
      --final-status-level fail
  else
    printf '%s\n' \
      'SNAPBACK_CARGO_NEXTEST_MISSING: cargo-nextest 0.9.143 is required for Rust tests.' >&2
    printf '%s\n' \
      'Install it with: cargo install cargo-nextest --version 0.9.143 --locked' >&2
    return 1
  fi
}

run_timed() {
  phase_name="$1"
  shift
  phase_started="$SECONDS"
  "$@"
  phase_status="$?"
  echo "== $phase_name finished in $((SECONDS - phase_started))s (status $phase_status)"
  return "$phase_status"
}

echo "== blocking script self-test"; "$script_path" --self-test || status=1
echo "== bundle the compiler worker + client (the owner tests load dist/)"; (cd packages/snapback2 && node build.mjs >/dev/null) || status=1
echo "== build the native owner and media helper before parallel package fixtures"; cargo build -p snapback2 -p snapback2-media || status=1
# The compiler's clean-build regressions use this target-scoped output instead
# of deleting dist while the package and native inventories consume it.
mkdir -p target
compiler_fixture="$(mktemp -d "$(pwd)/target/b2-compiler-package.XXXXXX")" || {
  echo "blocking test: cannot create compiler package fixture" >&2
  exit 1
}
trap 'rm -rf -- "$compiler_fixture"' EXIT
repository_root="$(cd .. && pwd)"
package_workspace="$compiler_fixture/package-workspace"
mkdir -p "$package_workspace/packages" "$package_workspace/target"
cp -R packages/snapback2 "$package_workspace/packages/snapback2"
ln -s "$(pwd)/node_modules" "$package_workspace/node_modules"
ln -s "$(pwd)/packages/compiler" "$package_workspace/packages/compiler"
ln -s "$(pwd)/packages/evaluator" "$package_workspace/packages/evaluator"
ln -s "$(pwd)/corpus" "$package_workspace/corpus"
# Package tests resolve repository fixtures four levels above their test files.
# In the isolated package copy that root is the compiler fixture, not the
# package-workspace directory itself.
ln -s "$(pwd)/benchmarks" "$compiler_fixture/benchmarks"
ln -s "$(pwd)/metrics" "$package_workspace/metrics"
ln -s "$(pwd)/scripts" "$package_workspace/scripts"
ln -s "$(pwd)/unicode" "$package_workspace/unicode"
ln -s "$(pwd)/target/debug" "$package_workspace/target/debug"

# @ref LLP 1002#11-measured — overlap complete independent inventories; the
# compiler's destructive package build is isolated and the shared dist is
# restored only after every reader has finished.
echo "== package offline protocol + store + bytes + outbox + twin + real owner"
run_timed package run_package_checks "$package_workspace/packages/snapback2" &
package_pid="$!"
echo "== cargo-nextest workspace tests (parallel, no fail-fast)"
run_timed native run_native_checks &
native_pid="$!"
echo "== cargo workspace doctests (no fail-fast)"
run_timed doctests cargo test --workspace --doc --no-fail-fast --quiet -- --test-threads "$rust_test_threads" &
doctest_pid="$!"
echo "== evaluator (IR twin vs corpus)"
run_timed evaluator run_evaluator_checks &
evaluator_pid="$!"
SNAPBACK2_TEST_PACKAGE_DIST="$compiler_fixture/dist" run_timed compiler run_compiler_checks packages/compiler &
compiler_pid="$!"

for phase_pid in "$package_pid" "$native_pid" "$doctest_pid" "$evaluator_pid" "$compiler_pid"; do
  wait "$phase_pid" || status=1
done

# A package fixture can exercise clean-dist recovery. Re-establish the artifact
# boundary after every concurrent consumer has released the checked-in package.
echo "== restore package artifacts after package fixtures"; (cd packages/snapback2 && node build.mjs >/dev/null) || status=1
exit $status
