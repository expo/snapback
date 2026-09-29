#!/bin/bash
set -euo pipefail
cd "$HOME/sb4-intent/hv-round4-wasm"
export PATH="$PWD/tools/node-v24.13.1-darwin-arm64/bin:/usr/bin:/bin"
mkdir -p common-input
cp linux-bindgen.wasm common-input/snapback4_device_bg.wasm
optimizer=node_modules/binaryen/bin/wasm-opt
wasm=common-input/snapback4_device_bg.wasm
node "$optimizer" -Os --enable-bulk-memory --enable-nontrapping-float-to-int -o common-input/os.wasm "$wasm"
if [ "$(gzip -9 -c < common-input/os.wasm | wc -c)" -lt "$(gzip -9 -c < "$wasm" | wc -c)" ]; then mv common-input/os.wasm "$wasm"; fi
node "$optimizer" --code-folding --duplicate-function-elimination --dce --vacuum --enable-bulk-memory --enable-nontrapping-float-to-int -o common-input/fold.wasm "$wasm"
if [ "$(gzip -9 -c < common-input/fold.wasm | wc -c)" -lt "$(gzip -9 -c < "$wasm" | wc -c)" ]; then mv common-input/fold.wasm "$wasm"; fi
shasum -a 256 linux-bindgen.wasm "$wasm"
wc -c "$wasm"
gzip -9 -c "$wasm" | wc -c
