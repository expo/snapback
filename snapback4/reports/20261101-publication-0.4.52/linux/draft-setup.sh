#!/bin/bash
set -euo pipefail
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_OPT_LEVEL=1
export LIBSQLITE3_FLAGS='-DHAVE_FDATASYNC=1 -USQLITE_ENABLE_MEMORY_MANAGEMENT -DSQLITE_DEFAULT_MEMSTATUS=0'
R=$HOME/sb4-pub-0452-records
trap 'echo $? > "$R/draft-setup.exit"' EXIT
cd "$HOME/sb4-pub-0441/snapback4"
bun install --frozen-lockfile
cargo build --locked -p snapback4
(cd editors/vscode && bun install --frozen-lockfile)
(cd editors/tree-sitter-quarry && bun install --frozen-lockfile)
node scripts/generate-editor-grammar.mjs
node scripts/check-editor-grammar.mjs
