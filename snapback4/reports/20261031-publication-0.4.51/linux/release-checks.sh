#!/bin/bash
set -u
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_OPT_LEVEL=1
export LIBSQLITE3_FLAGS='-DHAVE_FDATASYNC=1 -USQLITE_ENABLE_MEMORY_MANAGEMENT -DSQLITE_DEFAULT_MEMSTATUS=0'
ulimit -n 65536
cd "$HOME/sb4-pub-0441"
R=$HOME/sb4-pub-0451-records
node snapback4/scripts/affected.mjs --base origin/main --json > "$R/release-affected-plan.json"
timeout 10800s node snapback4/scripts/affected.mjs --base origin/main --run > "$R/release-affected.log" 2>&1
echo $? > "$R/release-affected.exit"
node scripts/check-inventories.mjs > "$R/release-inventories.log" 2>&1
echo $? > "$R/release-inventories.exit"
./ref-check > "$R/release-ref-check.log" 2>&1
echo $? > "$R/release-ref-check.exit"
