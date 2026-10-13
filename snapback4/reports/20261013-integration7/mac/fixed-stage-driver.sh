#!/bin/bash
set -u
export PATH=/opt/homebrew/bin:$HOME/.volta/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH
export PATH=$HOME/.volta/tools/image/node/24.19.0/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
export SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
ulimit -n 65536
cd "$HOME/projects/snapback-integ6/snapback4"
proof=target/integ7-proof/rerun1
failures=0
run(){ local name="$1";shift; "$@" > "$proof/$name.log" 2>&1;local result=$?;printf '%s %s\n' "$name" "$result"|tee -a "$proof/status.tsv";if [ "$result" != 0 ];then failures=$((failures+1));fi;}
: > "$proof/status.tsv"
git rev-parse HEAD > "$proof/source.txt"
node --version > "$proof/node.txt"
printf 'TMPDIR=%s\nFD_LIMIT=%s\n' "$TMPDIR" "$(ulimit -n)" > "$proof/environment.txt"
run swift-compile env SKIP_BUNDLING=1 xcodebuild -workspace apps/chat-expo/ios/Snapback4chat.xcworkspace -scheme Snapback4chat -configuration Release -destination 'generic/platform=iOS Simulator' ARCHS=arm64 -derivedDataPath target/integ6-expo CODE_SIGNING_ALLOWED=NO SKIP_BUNDLING=1 build
files=()
for file in packages/snapback4/test/*.test.mjs;do
case "$(basename "$file")" in app-session-model.test.mjs|online-client-model.test.mjs);;*)files+=("$file");;esac
done
cpus=$(node -p 'require("node:os").availableParallelism()');slots=$((cpus/3));if [ "$slots" -lt 1 ];then slots=1;fi;if [ "$slots" -gt 24 ];then slots=24;fi
printf 'CPUS=%s\nSLOTS=%s\nFILES=%s\n' "$cpus" "$slots" "${#files[@]}" >> "$proof/environment.txt"
run client-tests node scripts/run-client-tests.mjs "$slots" files "${files[@]}"
run client-models node scripts/run-client-tests.mjs 1 models packages/snapback4/test/app-session-model.test.mjs packages/snapback4/test/online-client-model.test.mjs
printf 'FINAL_FAILURES=%s\n' "$failures" > "$proof/result.txt"
[ "$failures" -eq 0 ]
