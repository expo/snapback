#!/bin/bash
set -u
unset SNAPBACK4_BIN
export PATH=/opt/homebrew/bin:$HOME/.volta/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH
export PATH=$HOME/.volta/tools/image/node/24.19.0/bin:$HOME/.elan/bin:$PATH
export SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
ulimit -n 65536
cd "$HOME/projects/snapback-integ6/snapback4"
proof=target/integ9-proof
mkdir -p "$proof"
failures=0
run(){ local name="$1"; shift; "$@" > "$proof/$name.log" 2>&1; local result=$?; printf '%s %s\n' "$name" "$result" | tee -a "$proof/status.tsv"; if [ "$result" != 0 ]; then failures=$((failures+1)); fi; }
: > "$proof/status.tsv"
git rev-parse HEAD > "$proof/source.txt"
node --version > "$proof/node.txt"
printf 'TMPDIR=%s\nFD_LIMIT=%s\n' "$TMPDIR" "$(ulimit -n)" > "$proof/environment.txt"
run install bun install --frozen-lockfile
run build env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo build --workspace --quiet
run wasm-build env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 bash scripts/build-wasm.sh
run docs-budget env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 node scripts/docs-budget.mjs
run release-guard env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 bash scripts/check-release-guard.sh
run package-typecheck bun run --cwd packages/snapback4 typecheck
run package-build bun run --cwd packages/snapback4 build
run chat-check bash -c 'cd apps/chat && ../../target/debug/snapback4 check'
run lean-setup bash -c 'cd lean && lake build quarry-oracle'
run cargo-test env SNAPBACK4_REQUIRE_LEAN=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 node scripts/run-rust-tests.mjs
run fixture-tests node scripts/run-client-tests.mjs 1 files fixtures/
run chat-typecheck bun run --cwd apps/chat typecheck
run expo-typecheck bun run --cwd apps/chat-expo typecheck
files=()
for path in packages/snapback4/test/*.test.mjs; do
 case "$(basename "$path")" in app-session-model.test.mjs|online-client-model.test.mjs) ;; *) files+=("$path");; esac
done
cpus=$(node -p 'require("node:os").availableParallelism()')
slots=$((cpus/3)); [ "$slots" -lt 1 ] && slots=1; [ "$slots" -gt 24 ] && slots=24
printf 'FILES=%s CPUS=%s SLOTS=%s\n' "${#files[@]}" "$cpus" "$slots" > "$proof/client-inventory.txt"
run client-tests node scripts/run-client-tests.mjs "$slots" files "${files[@]}"
run client-models node scripts/run-client-tests.mjs 1 models packages/snapback4/test/app-session-model.test.mjs packages/snapback4/test/online-client-model.test.mjs
run wasm-measure env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 bash scripts/measure-wasm.sh
run wasm-budget-check node -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync("metrics/wasm.jsonl","utf8").trim().split("\n").at(-1));console.log(JSON.stringify(m));if(m.over)process.exit(1)'
run xcframework env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 bash scripts/build-xcframework.sh
run swift-compile env SKIP_BUNDLING=1 xcodebuild -workspace apps/chat-expo/ios/Snapback4chat.xcworkspace -scheme Snapback4chat -configuration Release -destination 'generic/platform=iOS Simulator' ARCHS=arm64 -derivedDataPath target/integ6-expo CODE_SIGNING_ALLOWED=NO SKIP_BUNDLING=1 build
printf 'FINAL_FAILURES=%s\n' "$failures" > "$proof/result.txt"
[ "$failures" -eq 0 ]
