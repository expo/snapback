#!/bin/bash
set -u
cd /home/ccheever/sb4-intent/lane-ct/snapback4
r=reports/20261001-ct-contended-reads/round3/qualification
while [ ! -f "$r/test-sh.exit" ] || [ ! -f target/ct-round3/final-ready ]; do sleep 5; done
ulimit -n 4096
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
cargo test -p snapback4 --test clock --test replay --test latency --test lifecycle > "$r/post-suite-timing.log" 2>&1
status=$?
printf '%s\n' "$status" > "$r/post-suite-timing.exit"
if [ "$status" = 0 ] && [ "$(cat "$r/affected-final.exit")" = 0 ]; then touch target/ct-round3/post-suite-ready; fi
exit "$status"
