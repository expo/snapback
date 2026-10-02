#!/bin/bash
set -u
cd /home/ccheever/sb4-intent/lane-ct/snapback4
r=reports/20261001-ct-contended-reads/round3/qualification
ulimit -n 4096
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
run() { local name=$1; shift; "$@" > "$r/$name.log" 2>&1; local status=$?; printf '%s\n' "$status" > "$r/$name.exit"; return "$status"; }
run schedules cargo test -p snapback4-lang --test schedule_durations || exit
run maintenance-core cargo test -p snapback4-lang --test timeline_background --test row_keyed_views || exit
run clock cargo test -p snapback4 --test clock --test replay || exit
run lifecycle cargo test -p snapback4 --test lifecycle || exit
run guide cargo test -p snapback4-lang --test guide || exit
run production cargo build --profile production || exit
cp target/production/snapback4 target/ct-round3/split
run ka-transport node --test --test-concurrency=1 packages/snapback4/test/keepalive-retry.test.mjs packages/snapback4/test/keepalive-headers.test.mjs packages/snapback4/test/transport-http.test.mjs packages/snapback4/test/transport-outcomes.test.mjs packages/snapback4/test/keepalive-browser.test.mjs packages/snapback4/test/keepalive-reuse.test.mjs packages/snapback4/test/node-transport.test.mjs
