#!/bin/bash
set -u
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
proof=target/integ10-proof
while [ ! -f "$proof/rust.exit" ] || [ ! -f "$proof/difftest-tests.exit" ] || [ ! -f "$proof/run.exit" ] || [ ! -f "$proof/run-devices.exit" ] || [ ! -f "$proof/run-lean.exit" ]; do sleep 5; done
unset SNAPBACK4_BIN
files=()
for path in packages/snapback4/test/*.test.mjs; do
 case "$(basename "$path")" in app-session-model.test.mjs|online-client-model.test.mjs) ;; *) files+=("$path");; esac
done
slots=$(node -p 'Math.max(1,Math.min(24,Math.floor(require("node:os").availableParallelism()/3)))')
printf 'FILES=%s SLOTS=%s\n' "${#files[@]}" "$slots" > "$proof/client-inventory.txt"
node scripts/run-client-tests.mjs "$slots" files "${files[@]}" > "$proof/client-tests.log" 2>&1
echo $? > "$proof/client-tests.exit"
node scripts/run-client-tests.mjs 1 models packages/snapback4/test/app-session-model.test.mjs packages/snapback4/test/online-client-model.test.mjs > "$proof/client-models.log" 2>&1
echo $? > "$proof/client-models.exit"
node scripts/run-client-tests.mjs 1 files fixtures/ > "$proof/fixtures.log" 2>&1
echo $? > "$proof/fixtures.exit"
