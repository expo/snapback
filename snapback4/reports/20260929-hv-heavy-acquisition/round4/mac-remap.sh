#!/bin/bash
set -euo pipefail
cd "$HOME/sb4-intent/hv-round4-wasm"
export PATH="$PWD/tools/node-v24.13.1-darwin-arm64/bin:$PWD/tools:$HOME/.bun/bin:$HOME/.cargo/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export CARGO_BUILD_JOBS=4
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
export RUSTFLAGS="--remap-path-prefix=$(rustc --print sysroot)=/rust-toolchain --remap-path-prefix=$HOME/.cargo=/cargo --remap-path-prefix=$PWD=/snapback4"
bash scripts/build-wasm.sh > evidence/remap-build.log 2>&1
cp packages/snapback4/src/wasm/snapback4_device_bg.wasm evidence/remap.wasm
shasum -a 256 evidence/remap.wasm
