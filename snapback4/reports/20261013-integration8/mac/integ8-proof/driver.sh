#!/bin/bash
set -u
export PATH=/opt/homebrew/bin:$HOME/.volta/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH
export PATH=$HOME/.volta/tools/image/node/24.19.0/bin:$PATH
export SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
ulimit -n 65536
cd "$HOME/projects/snapback-integ6/snapback4"
proof=target/integ8-proof
mkdir -p "$proof"
failures=0
run(){ local name="$1"; shift; "$@" > "$proof/$name.log" 2>&1; local result=$?; printf '%s %s\n' "$name" "$result" | tee -a "$proof/status.tsv"; if [ "$result" != 0 ]; then failures=$((failures+1)); fi; }
: > "$proof/status.tsv"
git rev-parse HEAD > "$proof/source.txt"
node --version > "$proof/node.txt"
printf 'TMPDIR=%s\nFD_LIMIT=%s\n' "$TMPDIR" "$(ulimit -n)" > "$proof/environment.txt"
run install bun install --frozen-lockfile
run cli-build env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo build -p snapback4
run wasm-build env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 bash scripts/build-wasm.sh
run package-build bun run --cwd packages/snapback4 build
run xcframework env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 bash scripts/build-xcframework.sh
run stamp-inspection python3 -c 'from pathlib import Path; import subprocess
for lib in sorted(Path("packages/snapback4-expo/ios/Snapback4Device.xcframework").glob("**/*.a")):
    symbols=subprocess.check_output(["nm", "-g", str(lib)],stderr=subprocess.DEVNULL).decode()
    assert "_sb4_engine_info" in symbols, str(lib)
    load=subprocess.check_output(["otool", "-l", str(lib)],stderr=subprocess.DEVNULL).decode()
    assert "snapback4.engine" not in load, str(lib)
    assert b"snapback4.engine" not in lib.read_bytes(), str(lib)
    print(str(lib)+": sb4_engine_info exported; wasm-only custom section correctly absent")'
run swift-compile env SKIP_BUNDLING=1 xcodebuild -workspace apps/chat-expo/ios/Snapback4chat.xcworkspace -scheme Snapback4chat -configuration Release -destination 'generic/platform=iOS Simulator' ARCHS=arm64 -derivedDataPath target/integ6-expo CODE_SIGNING_ALLOWED=NO SKIP_BUNDLING=1 build
run cargo-cli env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p snapback4
run client-tests env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 node scripts/run-client-tests.mjs 3 files packages/snapback4/test/device-version.test.mjs packages/snapback4/test/external-device.test.mjs packages/snapback4/test/init-typecheck.test.mjs packages/snapback4/test/package-typecheck.test.mjs packages/snapback4/test/schema-capabilities.test.mjs packages/snapback4/test/worker-regressions.test.mjs
printf 'FINAL_FAILURES=%s\n' "$failures" > "$proof/result.txt"
[ "$failures" -eq 0 ]
