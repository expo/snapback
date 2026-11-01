#!/bin/bash
set -eu
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.cargo/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
export LIBSQLITE3_FLAGS='-DHAVE_FDATASYNC=1 -USQLITE_ENABLE_MEMORY_MANAGEMENT -DSQLITE_DEFAULT_MEMSTATUS=0'
W=$HOME/sb4-pub-0441/snapback4; R=$HOME/sb4-pub-0452-records; K=$HOME/sb4-pub-0452-kit
cd "$W"
bun install --frozen-lockfile
cargo build --locked -p snapback4
# Preflight preparation is separate from the canonical native-qualified Mac bytes.
node scripts/publish.mjs --prepare-client
mv target/publication/client-0.4.52 "$R/preflight-client-0.4.52"
node "$K/audit-fast.mjs" "$W" "$R/preflight-client-0.4.52" "$R/audit-linux-preflight"
