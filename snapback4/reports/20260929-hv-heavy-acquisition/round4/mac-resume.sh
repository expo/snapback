#!/bin/bash
set -euo pipefail
cd "$HOME/sb4-intent/hv-round4-wasm"
export PATH="$PWD/tools/node-v24.13.1-darwin-arm64/bin:$PWD/tools:$HOME/.bun/bin:$HOME/.cargo/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export CARGO_BUILD_JOBS=4
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
mv evidence/build-1.log evidence/build-xcode-license.log
{
 printf 'Retry with process-local DEVELOPER_DIR=%s\n' "$DEVELOPER_DIR"
 cc --version
} >> evidence/toolchain.log
/usr/bin/time -l bash scripts/build-wasm.sh > evidence/build-1.log 2>&1
cp packages/snapback4/src/wasm/snapback4_device_bg.wasm evidence/build-1.wasm
/usr/bin/time -l bash scripts/build-wasm.sh > evidence/build-2.log 2>&1
cp packages/snapback4/src/wasm/snapback4_device_bg.wasm evidence/build-2.wasm
cmp evidence/build-1.wasm evidence/build-2.wasm
shasum -a 256 evidence/build-1.wasm evidence/build-2.wasm > evidence/hashes.txt
wc -c evidence/build-1.wasm > evidence/bytes.txt
gzip -9 -c packages/snapback4/src/wasm/snapback4_device_bg.wasm | wc -c >> evidence/bytes.txt
