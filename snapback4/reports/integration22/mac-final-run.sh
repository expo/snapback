#!/bin/bash
set -eu
root=/Users/ccheever/projects/snapback-integ22
export PATH=$root/integration22-tools/node-v24.13.1-darwin-arm64/bin:/opt/homebrew/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:$PATH
export SNAPBACK_NODE=$root/integration22-tools/node-v24.13.1-darwin-arm64/bin/node
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_OPT_LEVEL=1 CARGO_BUILD_JOBS=4 LIBTEST_THREADS=8
export SNAPBACK4_BIN=$root/snapback4/target/debug/snapback4 CI=1 EXPO_NO_TELEMETRY=1
cd "$root/snapback4"
timeout 10s node --version
timeout 10s test "$(timeout 10s node --version)" = v24.13.1
runlog() { local key="$1"; shift; set +e; timeout 14400s "$@" > "$root/integration22-logs/final-$key.log" 2>&1; local result=$?; echo "$result" > "$root/integration22-logs/final-$key.status"; echo "$key exit $result"; set -e; return "$result"; }
runlog build cargo build -p snapback4
runlog client-build bun run --cwd packages/snapback4 build
runlog compatibility node --test packages/snapback4/test/proof-contract.test.mjs packages/snapback4/test/package-require.test.mjs
runlog core cargo test -p snapback4-core --lib
runlog lang cargo test -p snapback4-lang --lib --test security_sec6 --test security_sec7 --test security_sec7_day2 --test guide
runlog device cargo test -p snapback4-device --lib --test readauth
runlog cli cargo test -p snapback4 --bin snapback4 --test clock --test check --test check_notes --test security_reviews --test store_port_ratchet --test committer_ratchet
runlog sim cargo test -p snapback4-sim
runlog clients node ../integration22-final-clients.mjs
