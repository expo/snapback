#!/bin/bash
set -u
unset SNAPBACK4_BIN
export PATH=/home/ccheever/.bun-1.4.2/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
cd /home/ccheever/projects/snapback-sb4loop/snapback4
proof=target/integ9-proof
failures=0
run(){ local name="$1"; shift; "$@" > "$proof/$name.log" 2>&1; local result=$?; printf '%s %s\n' "$name" "$result" | tee -a "$proof/linux-client-final-status.tsv"; if [ "$result" != 0 ]; then failures=$((failures+1)); fi; }
: > "$proof/linux-client-final-status.tsv"
git rev-parse HEAD > "$proof/linux-client-final-source.txt"
files=()
for path in packages/snapback4/test/*.test.mjs; do
 case "$(basename "$path")" in app-session-model.test.mjs|online-client-model.test.mjs) ;; *) files+=("$path");; esac
done
run linux-client-final node scripts/run-client-tests.mjs 24 files "${files[@]}"
run linux-models-final node scripts/run-client-tests.mjs 1 models packages/snapback4/test/app-session-model.test.mjs packages/snapback4/test/online-client-model.test.mjs
run linux-fixtures-final node scripts/run-client-tests.mjs 1 files fixtures/
run linux-docs-final node scripts/docs-budget.mjs
run linux-refs-final bash -c 'cd .. && ./ref-check'
printf 'FINAL_FAILURES=%s\n' "$failures" > "$proof/linux-client-final-result.txt"
[ "$failures" -eq 0 ]
