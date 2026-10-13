#!/bin/bash
set -u
export PATH=/home/ccheever/.bun-1.4.2/bin:/tmp/sb4-integ8-tools/unpack/usr/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
cd /home/ccheever/projects/snapback-sb4loop/snapback4
proof=reports/20261013-integration8/linux
failures=0
run(){ local name="$1"; shift; "$@" > "$proof/$name.log" 2>&1; local result=$?; printf '%s %s\n' "$name" "$result" | tee -a "$proof/status.tsv"; if [ "$result" != 0 ]; then failures=$((failures+1)); fi; }
: > "$proof/status.tsv"
while [ ! -f "$proof/cargo-five.exit" ]; do sleep 5; done
if [ "$(cat "$proof/cargo-five.exit")" != 0 ]; then failures=$((failures+1)); fi
run wasm-measure env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 bash scripts/measure-wasm.sh
run authoring-census env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p snapback4-device --test readauth census::authoring_census -- --exact --nocapture
run difftest env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo run --release -p snapback4-difftest -- run --seed 0 --cases 20000 --workers 8 --out target/integ8-difftest
files=()
for file in packages/snapback4/test/*.test.mjs; do
  case "$(basename "$file")" in app-session-model.test.mjs|online-client-model.test.mjs);;*)files+=("$file");;esac
done
cpus=$(node -p 'require("node:os").availableParallelism()'); slots=$((cpus / 3)); if [ "$slots" -lt 1 ]; then slots=1; fi; if [ "$slots" -gt 24 ]; then slots=24; fi
printf 'CPUS=%s\nSLOTS=%s\nFILES=%s\nFD_LIMIT=%s\n' "$cpus" "$slots" "${#files[@]}" "$(ulimit -n)" > "$proof/client-environment.txt"
run client-tests node scripts/run-client-tests.mjs "$slots" files "${files[@]}"
run client-models node scripts/run-client-tests.mjs 1 models packages/snapback4/test/app-session-model.test.mjs packages/snapback4/test/online-client-model.test.mjs
printf 'FINAL_FAILURES=%s\n' "$failures" > "$proof/result.txt"
[ "$failures" -eq 0 ]
