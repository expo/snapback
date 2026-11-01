#!/bin/bash
set -euo pipefail
R=$HOME/sb4-pub-0452-records; W=$HOME/sb4-records-0452
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_OPT_LEVEL=1 CARGO_BUILD_JOBS=8
export LIBSQLITE3_FLAGS='-DHAVE_FDATASYNC=1 -USQLITE_ENABLE_MEMORY_MANAGEMENT -DSQLITE_DEFAULT_MEMSTATUS=0'
trap 'echo $? > "$R/records-setup-and-prechecks.exit"' EXIT
cd "$W/snapback4"
bun install --frozen-lockfile
cargo build --locked -p snapback4
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
(cd lean && lake build quarry-oracle)
cd "$W"
bun install --frozen-lockfile
node scripts/ensure-workspace-hoist.mjs
bash scripts/check-generated-artifacts
echo 0 > "$R/records-setup.exit"
node scripts/check-inventories.mjs > "$R/records-inventories.log" 2>&1
echo 0 > "$R/records-inventories.exit"
./ref-check > "$R/records-ref-check.log" 2>&1
echo 0 > "$R/records-ref-check.exit"
