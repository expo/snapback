#!/bin/bash
set -euo pipefail
K=$HOME/sb4-pub-0452-kit; R=$HOME/sb4-pub-0452-records; W=$HOME/sb4-pub-0452-fixtures
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_OPT_LEVEL=1
export LIBSQLITE3_FLAGS='-DHAVE_FDATASYNC=1 -USQLITE_ENABLE_MEMORY_MANAGEMENT -DSQLITE_DEFAULT_MEMSTATUS=0'
trap 'echo $? > "$R/default-contract-main-affected.exit"' EXIT
# Avoid a builder alongside the existing full client pool.
until [ -e "$R/release-ref-check.exit" ]; do sleep 20; done
cd "$W"
(cd snapback4 && bun install --frozen-lockfile) > "$R/default-contract-main-install.log" 2>&1
timeout 10800s node snapback4/scripts/affected.mjs --base origin/main --run > "$R/default-contract-main-affected.log" 2>&1
for n in 1 2 3; do node --test snapback4/packages/snapback4/test/default-startup-contract.test.mjs > "$R/default-contract-main-exact-$n.log" 2>&1; done
