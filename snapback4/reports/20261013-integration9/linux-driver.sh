#!/bin/bash
set -u
unset SNAPBACK4_BIN
export PATH=/home/ccheever/.bun-1.4.2/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
cd /home/ccheever/projects/snapback-sb4loop/snapback4
proof=target/integ9-proof
failures=0
run(){ local name="$1"; shift; "$@" > "$proof/$name.log" 2>&1; local result=$?; printf '%s %s\n' "$name" "$result" | tee -a "$proof/linux-status.tsv"; if [ "$result" != 0 ]; then failures=$((failures+1)); fi; }
# Drain the preceding discovery and repair runs before final qualification.
while [ ! -f "$proof/rust.exit" ] || [ ! -f "$proof/rust-repaired.exit" ] || [ ! -f "$proof/rust-host-final.exit" ] || [ ! -f "$proof/readme-final.exit" ]; do sleep 5; done
: > "$proof/linux-status.tsv"
git rev-parse HEAD > "$proof/linux-source.txt"
run rust-final env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p snapback4-core -p snapback4-lang -p snapback4-device -p snapback4-sim -p snapback4 --no-fail-fast
run package-typecheck bun run --cwd packages/snapback4 typecheck
run package-build bun run --cwd packages/snapback4 build
run chat-check bash -c 'cd apps/chat && ../../target/debug/snapback4 check'
run chat-typecheck bun run --cwd apps/chat typecheck
run expo-typecheck bun run --cwd apps/chat-expo typecheck
run fixture-tests node scripts/run-client-tests.mjs 1 files fixtures/
files=()
for path in packages/snapback4/test/*.test.mjs; do
 case "$(basename "$path")" in app-session-model.test.mjs|online-client-model.test.mjs) ;; *) files+=("$path");; esac
done
slots=$(node -p 'Math.max(1,Math.min(24,Math.floor(require("node:os").availableParallelism()/3)))')
printf 'FILES=%s SLOTS=%s\n' "${#files[@]}" "$slots" > "$proof/linux-client-inventory.txt"
run client-tests node scripts/run-client-tests.mjs "$slots" files "${files[@]}"
run client-models node scripts/run-client-tests.mjs 1 models packages/snapback4/test/app-session-model.test.mjs packages/snapback4/test/online-client-model.test.mjs
run docs-budget env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 node scripts/docs-budget.mjs
run ref-check ../ref-check
printf 'FINAL_FAILURES=%s\n' "$failures" > "$proof/linux-result.txt"
[ "$failures" -eq 0 ]
