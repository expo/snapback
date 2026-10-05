#!/usr/bin/env bash
# Isolated round-0 source/artifacts, entirely inside this worktree's target/.
set -euo pipefail
root=$(cd "$(dirname "$0")/../../../.." && pwd)
dest="$root/snapback4/target/rh-round0-src"
mkdir -p "$dest"
git -C "$root" archive 0094fe7fd7 snapback4/crates snapback4/apps snapback4/packages snapback4/vendor snapback4/Cargo.toml snapback4/Cargo.lock snapback4/rust-toolchain.toml snapback4/scripts snapback4/metrics/wasm-budget.json snapback4/package.json | tar -x -C "$dest"
if [ ! -e "$dest/snapback4/node_modules" ]; then ln -s "$root/snapback4/node_modules" "$dest/snapback4/node_modules"; fi
cd "$dest/snapback4"
export CARGO_BUILD_JOBS=6 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0
cargo build -p snapback4 --quiet
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
