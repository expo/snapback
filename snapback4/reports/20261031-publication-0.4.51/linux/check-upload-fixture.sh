#!/bin/bash
set -eu
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_OPT_LEVEL=1
export LIBSQLITE3_FLAGS='-DHAVE_FDATASYNC=1 -USQLITE_ENABLE_MEMORY_MANAGEMENT -DSQLITE_DEFAULT_MEMSTATUS=0'
ulimit -n 65536
R=$HOME/sb4-pub-0451-records
cd "$HOME/sb4-pub-0441"
node snapback4/scripts/affected.mjs --base origin/main --json > "$R/upload-fixture-affected-plan.json"
set +e
timeout 10800s node snapback4/scripts/affected.mjs --base origin/main --run > "$R/upload-fixture-affected.log" 2>&1
rc=$?; echo "$rc" > "$R/upload-fixture-affected.exit"
exit "$rc"
