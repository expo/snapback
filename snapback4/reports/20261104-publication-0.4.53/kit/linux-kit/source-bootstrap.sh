#!/bin/bash
# Frozen-source prerequisites only; prepared tarballs and official qualification follow later.
set -euo pipefail
B=$HOME/sb4-intent/0453
export ROOT=$B/source/snapback4 REP=$B/records ATTEMPT=1
export CARGO_TARGET_DIR=$ROOT/target
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
unset SNAPBACK4_BIN NPM_TOKEN NODE_AUTH_TOKEN
[ "$(git -C "$ROOT" rev-parse HEAD)" = 9da2c76fdf32b20f985c85fe6d33b507c09edd25 ]
[ -z "$(git -C "$ROOT" status --porcelain)" ]
[ ! -e "$REP/source-bootstrap.exit" ] || exit 98
trap 'rc=$?; echo "$rc" > "$REP/source-bootstrap.exit"' EXIT
cd "$B/kit"
./step.sh linux-source-install . bun install --frozen-lockfile
./step.sh linux-source-build . env LIBSQLITE3_FLAGS='-DHAVE_FDATASYNC=1 -USQLITE_ENABLE_MEMORY_MANAGEMENT -DSQLITE_DEFAULT_MEMSTATUS=0' cargo build --locked -p snapback4
