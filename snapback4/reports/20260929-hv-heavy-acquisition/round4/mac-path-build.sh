#!/bin/bash
set -euo pipefail
cd "$HOME/sb4-intent/hv-round4-wasm"
mkdir -p tools/path-optimizer
printf '#!/bin/sh\necho unexpected-PATH-optimizer >&2\nexit 91\n' > tools/path-optimizer/wasm-opt
chmod +x tools/path-optimizer/wasm-opt
export PATH="$PWD/tools/path-optimizer:$PWD/tools/node-v24.13.1-darwin-arm64/bin:$PWD/tools:$HOME/.bun/bin:$HOME/.cargo/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export CARGO_BUILD_JOBS=4 DEVELOPER_DIR=/Library/Developer/CommandLineTools
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS
command -v wasm-opt > evidence/build-with-path.log
bash scripts/build-wasm.sh >> evidence/build-with-path.log 2>&1
cp packages/snapback4/src/wasm/snapback4_device_bg.wasm evidence/build-with-path.wasm
cmp evidence/build-1.wasm evidence/build-with-path.wasm
shasum -a 256 evidence/build-with-path.wasm >> evidence/build-with-path.log
