#!/bin/bash
set -u
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
ulimit -n 65536
cd "$HOME/sb4-pub-0441/snapback4"
O=$HOME/sb4-pub-0451-records/diagnosis/per-row-v50
for i in 1 2 3; do
 node scripts/run-client-tests.mjs 1 files "$O/package/test/per-row-inflight.test.mjs" > "$O/run-$i.log" 2>&1
 rc=$?; echo "$rc" > "$O/run-$i.exit"; echo "$(date -u +%FT%TZ) run-$i rc=$rc"
done
