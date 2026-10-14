#!/bin/bash
set -u
unset SNAPBACK4_BIN
export PATH=/home/ccheever/.bun-1.4.2/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
cd /home/ccheever/projects/snapback-sb4loop/snapback4
proof=target/integ9-proof
failures=0
run(){ local name="$1"; shift; "$@" > "$proof/$name.log" 2>&1; local result=$?; printf '%s %s\n' "$name" "$result" | tee -a "$proof/version-status.tsv"; if [ "$result" != 0 ]; then failures=$((failures+1)); fi; }
: > "$proof/version-status.tsv"
git rev-parse HEAD > "$proof/version-source.txt"
run version-install bun install --frozen-lockfile
run version-build env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo build -p snapback4
run version-wasm env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 bash scripts/build-wasm.sh
run version-package-build bun run --cwd packages/snapback4 build
run version-cli-tests env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p snapback4 --test init --test cli_friction
run version-cli-unit env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p snapback4 --bin snapback4 version_is_the_workspace_version
run version-engine-protocol env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p snapback4-core --lib device_protocol::tests
run version-native-identity env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p snapback4-device --lib ffi::
run version-guide-tests env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p snapback4-lang --test guide wave10_dx
run version-difftest-smoke env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p snapback4-difftest --test smoke
files=(packages/snapback4/test/{device-version,sync-generation,schema-capabilities,periphery,qualify-linux,publish-signing,package-require,witness-preparation,export-native,wave10-upgrade,export-native-round2,wave9-dx,linux-package}.test.mjs)
run version-client-tests node scripts/run-client-tests.mjs 24 files "${files[@]}"
run version-wasm-measure env PATH=/tmp/sb4-integration5-brotli/usr/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 bash scripts/measure-wasm.sh
run version-docs-budget env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 node scripts/docs-budget.mjs
printf 'FINAL_FAILURES=%s\n' "$failures" > "$proof/version-result.txt"
[ "$failures" -eq 0 ]
