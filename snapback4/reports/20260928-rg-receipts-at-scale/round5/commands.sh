#!/usr/bin/env bash
# From snapback4/. No scripts/test.sh invocation.
set -u
export CARGO_BUILD_JOBS=8 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
ulimit -n 65536
out=reports/20260928-rg-receipts-at-scale/round5
run() {
  local name="$1"
  shift
  "$@" > "$out/$name.log" 2>&1
  local result=$?
  printf '%s %s\n' "$name" "$result" | tee -a "$out/check-exits.txt"
  return "$result"
}
case "${1:-audit}" in
rust)
run native-build cargo build -p snapback4
run guide cargo test -p snapback4-lang --test guide --no-fail-fast
run rust-receipts-delivery cargo test -p snapback4-lang --test receipt_gaps --test delivery --test delivery_clause --test delivery_integration --test delivery_replay_conversion --no-fail-fast
;;
audit)
run client-build bun run --cwd packages/snapback4 build || exit 1
run typecheck bun run --cwd packages/snapback4 typecheck
run audit node --test --test-reporter=tap packages/snapback4/test/store-reset-review.test.mjs
run clock-pending node --test --test-reporter=tap --test-concurrency=4 packages/snapback4/test/react.test.mjs packages/snapback4/test/server-clock.test.mjs packages/snapback4/test/server-clock-recovery.test.mjs packages/snapback4/test/server-clock-regressions.test.mjs packages/snapback4/test/pending-writes.test.mjs
;;
integration)
run receipts-delivery node --test --test-reporter=tap --test-concurrency=4 packages/snapback4/test/*receipt*.test.mjs packages/snapback4/test/delivery*.test.mjs packages/snapback4/test/timeline-delivery.test.mjs
run settlement node --test --test-reporter=tap --test-concurrency=4 packages/snapback4/test/local-e2e.test.mjs packages/snapback4/test/app-store-replacement.test.mjs packages/snapback4/test/transport-outcomes.test.mjs packages/snapback4/test/store-reset-reconnect.test.mjs packages/snapback4/test/sync-generation.test.mjs
run media node --test --test-reporter=tap --test-concurrency=4 packages/snapback4/test/asset-blob-lifecycle.test.mjs packages/snapback4/test/asset-lists.test.mjs packages/snapback4/test/expo-media-storage.test.mjs
run transport node --test --test-reporter=tap packages/snapback4/test/transport-http.test.mjs
run web-admission node --test --test-reporter=tap packages/snapback4/test/web-admission-review.test.mjs
;;
esac
