#!/bin/bash
set -u
root=/Users/ccheever/projects/snapback-integ22
export PATH=$root/integration22-tools/node-v24.13.1-darwin-arm64/bin:/opt/homebrew/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:$PATH
export SNAPBACK_NODE=$root/integration22-tools/node-v24.13.1-darwin-arm64/bin/node
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_OPT_LEVEL=1 CARGO_BUILD_JOBS=4 LIBTEST_THREADS=8
export SNAPBACK4_BIN=$root/snapback4/target/debug/snapback4 CI=1 EXPO_NO_TELEMETRY=1
cd "$root/snapback4" || exit 1
status=0
timeout 7200s cargo test -p snapback4-lang --test security --test security_histories --test security_sec5_output --test wave12_rule_recipes --no-fail-fast > "$root/integration22-logs/final-extra-lang.log" 2>&1
result=$?; echo "$result" > "$root/integration22-logs/final-extra-lang.status"; test "$result" = 0 || status=1
timeout 7200s cargo test -p snapback4 --test init --test day5_starters --no-fail-fast > "$root/integration22-logs/final-extra-starters.log" 2>&1
result=$?; echo "$result" > "$root/integration22-logs/final-extra-starters.status"; test "$result" = 0 || status=1
exit "$status"
