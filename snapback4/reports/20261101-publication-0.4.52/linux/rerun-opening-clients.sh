#!/bin/bash
set -euo pipefail
R=$HOME/sb4-pub-0452-records
trap 'rc=$?; echo "$rc" > "$R/opening-client-full-rerun.exit"' EXIT
! systemctl --user is-active --quiet sb4-pub52-opening-broad
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_OPT_LEVEL=1
export LIBSQLITE3_FLAGS='-DHAVE_FDATASYNC=1 -USQLITE_ENABLE_MEMORY_MANAGEMENT -DSQLITE_DEFAULT_MEMSTATUS=0'
ulimit -n 65536
node "$HOME/sb4-pub-0452-kit/rerun-opening-clients.mjs"
