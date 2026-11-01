#!/bin/bash
set -u
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_OPT_LEVEL=1
export LIBSQLITE3_FLAGS='-DHAVE_FDATASYNC=1 -USQLITE_ENABLE_MEMORY_MANAGEMENT -DSQLITE_DEFAULT_MEMSTATUS=0'
ulimit -n 65536
R=$HOME/sb4-pub-0452-records
cd "$HOME/sb4-pub-0441"
node snapback4/scripts/affected.mjs --base origin/main --json > "$R/opening-affected-plan.json"
timeout 10800s node snapback4/scripts/affected.mjs --base origin/main --run > "$R/opening-affected.log" 2>&1
rc=$?; echo "$rc" > "$R/opening-affected.exit"
exit "$rc"
