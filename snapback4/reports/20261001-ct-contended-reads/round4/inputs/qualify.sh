#!/bin/bash
# Run from snapback4 with Node 24 and pinned workspace dependencies.
set -u
r=reports/20261001-ct-contended-reads/round4/qualification
ulimit -n 4096
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
run() { local name=$1; shift; "$@" > "$r/$name.log" 2>&1; local status=$?; printf '%s\n' "$status" > "$r/$name.exit"; }
if [ "${1-}" != --after-server ]; then run affected-final cargo test -p snapback4 --bin snapback4; fi
run clock-lifecycle cargo test -p snapback4 --test clock --test replay --test latency --test lifecycle
run native cargo test -p snapback4-sim --test native
run core-recounts cargo test -p snapback4-core --lib engine::row_views
run guide cargo test -p snapback4-lang --test guide
run ka-transport node --test --test-concurrency=1 packages/snapback4/test/keepalive-retry.test.mjs packages/snapback4/test/keepalive-headers.test.mjs packages/snapback4/test/transport-http.test.mjs packages/snapback4/test/transport-outcomes.test.mjs packages/snapback4/test/keepalive-browser.test.mjs packages/snapback4/test/keepalive-reuse.test.mjs packages/snapback4/test/node-transport.test.mjs
run production cargo build --profile production
if [ "$(cat "$r/production.exit")" = 0 ]; then cp target/production/snapback4 target/ct-round4/paced; fi
