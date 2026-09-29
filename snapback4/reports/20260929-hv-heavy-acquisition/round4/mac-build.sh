#!/bin/bash
set -euo pipefail
cd "$HOME/sb4-intent/hv-round4-wasm"
tar -xzf source.tar.gz
mkdir -p tools evidence
mv wasm-bindgen tools/wasm-bindgen
chmod +x tools/wasm-bindgen
curl -fsSLo tools/node.tar.gz https://nodejs.org/dist/v24.13.1/node-v24.13.1-darwin-arm64.tar.gz
curl -fsSLo tools/SHASUMS256.txt https://nodejs.org/dist/v24.13.1/SHASUMS256.txt
expected=$(awk '$2 == "node-v24.13.1-darwin-arm64.tar.gz" { print $1 }' tools/SHASUMS256.txt)
actual=$(shasum -a 256 tools/node.tar.gz | awk '{ print $1 }')
[ "$expected" = "$actual" ]
tar -xzf tools/node.tar.gz -C tools
export PATH="$PWD/tools/node-v24.13.1-darwin-arm64/bin:$PWD/tools:$HOME/.bun/bin:$HOME/.cargo/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export CARGO_BUILD_JOBS=4
{
 hostname; sw_vers; uname -m; uptime; node -v; bun --version
 rustup +1.97.0 target add wasm32-unknown-unknown
 rustc -Vv; wasm-bindgen --version
 printf 'PATH optimizer: '; command -v wasm-opt || true
} > evidence/toolchain.log 2>&1
/usr/bin/time -l bun install --frozen-lockfile > evidence/clean-install.log 2>&1
/usr/bin/time -l bash scripts/build-wasm.sh > evidence/build-1.log 2>&1
cp packages/snapback4/src/wasm/snapback4_device_bg.wasm evidence/build-1.wasm
/usr/bin/time -l bash scripts/build-wasm.sh > evidence/build-2.log 2>&1
cp packages/snapback4/src/wasm/snapback4_device_bg.wasm evidence/build-2.wasm
cmp evidence/build-1.wasm evidence/build-2.wasm
shasum -a 256 evidence/build-1.wasm evidence/build-2.wasm > evidence/hashes.txt
wc -c evidence/build-1.wasm > evidence/bytes.txt
gzip -9 -c packages/snapback4/src/wasm/snapback4_device_bg.wasm | wc -c >> evidence/bytes.txt
