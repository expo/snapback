#!/bin/bash
set -euo pipefail
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_OPT_LEVEL=1
export CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 SNAPBACK4_REQUIRE_LEAN=1
export LIBSQLITE3_FLAGS='-DHAVE_FDATASYNC=1 -USQLITE_ENABLE_MEMORY_MANAGEMENT -DSQLITE_DEFAULT_MEMSTATUS=0'
ulimit -n 65536
R=$HOME/sb4-pub-0452-records
cd "$HOME/sb4-records-0452"
test "$(git rev-parse HEAD)" = "$(cat "$R/records-commit.sha")"
test -z "$(git status --porcelain)"
test "$(cat "$R/records-setup.exit")" = 0
test "$(cat "$R/records-inventories.exit")" = 0
test "$(cat "$R/records-ref-check.exit")" = 0
BASE=$(cat "$R/records-affected-base.sha")
node snapback4/scripts/affected.mjs --base "$BASE" --json > "$R/records-affected-plan-final.json"
set +e
timeout 10800s node snapback4/scripts/affected.mjs --base "$BASE" --run > "$R/records-affected.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$R/records-affected.exit"
exit "$rc"
