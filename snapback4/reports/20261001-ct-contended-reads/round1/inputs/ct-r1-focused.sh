#!/usr/bin/env bash
cd /home/ccheever/sb4-intent/lane-ct/snapback4
q=reports/20261001-ct-contended-reads/round1/qualification
while [ ! -f "$q/test-sh.exit" ]; do sleep 10; done
ulimit -n 4096
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
cargo test -p snapback4 --bin snapback4 changes_refresh_is_engine_work_but_poll_sleep_is_not -- --test-threads=1 > "$q/unloaded-latency.log" 2>&1
printf '%s\n' "$?" > "$q/unloaded-latency.exit"
cargo test -p snapback4-lang --test guide > "$q/guide.log" 2>&1
printf '%s\n' "$?" > "$q/guide.exit"
node --test --test-concurrency=1 packages/snapback4/test/keepalive-retry.test.mjs packages/snapback4/test/keepalive-headers.test.mjs packages/snapback4/test/transport-http.test.mjs packages/snapback4/test/transport-outcomes.test.mjs packages/snapback4/test/keepalive-browser.test.mjs packages/snapback4/test/keepalive-reuse.test.mjs packages/snapback4/test/node-transport.test.mjs > "$q/ka-transport.log" 2>&1
printf '%s\n' "$?" > "$q/ka-transport.exit"
