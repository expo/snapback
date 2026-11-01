#!/bin/bash
set -euo pipefail
K=$HOME/sb4-pub-0452-kit; R=$HOME/sb4-pub-0452-records; W=$HOME/sb4-pub-0441
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_OPT_LEVEL=1 SNAPBACK4_REQUIRE_LEAN=1
export LIBSQLITE3_FLAGS='-DHAVE_FDATASYNC=1 -USQLITE_ENABLE_MEMORY_MANAGEMENT -DSQLITE_DEFAULT_MEMSTATUS=0'
trap 'echo $? > "$R/release-final-doc-checks.exit"' EXIT
until [ -e "$R/publication-source-preflight-prepare.exit" ]; do sleep 15; done
[ "$(cat "$R/publication-source-preflight-prepare.exit")" = 0 ]
bash "$K/publication-source-audit.sh"
cd "$W/snapback4"
for n in 1 2 3; do node scripts/run-client-tests.mjs 1 files packages/snapback4/test/wave12-surface.test.mjs > "$R/guide-flag-owner/final-wave12-$n.log" 2>&1; done
cd "$W"
timeout 10800s node "$K/final-doc-scope.mjs" > "$R/release-final-scope.log" 2>&1
git rev-parse HEAD > "$R/release-final-checks-source.sha"
node scripts/check-inventories.mjs > "$R/release-inventories.log" 2>&1
echo 0 > "$R/release-inventories.exit"
./ref-check > "$R/release-ref-check.log" 2>&1
echo 0 > "$R/release-ref-check.exit"
