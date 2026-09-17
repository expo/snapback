#!/usr/bin/env bash
# The device core as wasm, measured on the pinned toolchain: the size-first
# profile, wasm-bindgen's web target, gzip-9 and brotli-11. This isolated
# D2 copy writes target/d2/LABEL/size.json, never metrics/wasm.jsonl.
set -euo pipefail
cd "$(dirname "$0")/../.."
cargo build -p snapback4-device --no-default-features --features web --profile wasm --target wasm32-unknown-unknown --quiet
out="target/d2/$1"
mkdir -p "$out"
wasm-bindgen --target web --out-dir "$out" target/wasm32-unknown-unknown/wasm/snapback4_device.wasm
wasm=$out/snapback4_device_bg.wasm
glue=$out/snapback4_device.js
if command -v wasm-opt >/dev/null; then
  wasm-opt -Os --enable-bulk-memory --enable-nontrapping-float-to-int -o "$out/os.wasm" "$wasm"
  # Keep whichever compresses smaller: -Oz has been seen to inflate the gzip.
  if [ "$(gzip -9 -c "$out/os.wasm" | wc -c)" -lt "$(gzip -9 -c "$wasm" | wc -c)" ]; then wasm=$out/os.wasm; fi
fi
sizes() { printf '{"raw":%d,"gzip":%d,"brotli":%d}' "$(wc -c < "$1")" "$(gzip -9 -c "$1" | wc -c)" "$(brotli -c -q 11 "$1" | wc -c)"; }
line=$(printf '{"at":"%s","sha":"%s","wasm":%s,"glue":%s,"wasmOpt":%s}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git rev-parse --short HEAD)" "$(sizes "$wasm")" "$(sizes "$glue")" "$( [ "$wasm" != "$out/snapback4_device_bg.wasm" ] && echo true || echo false )")
echo "$line" | tee "$out/size.json"
