#!/usr/bin/env bash
# The device core as wasm, measured on the pinned toolchain: the size-first
# profile, wasm-bindgen's web target, gzip-9 and brotli-11, one line to
# metrics/wasm.jsonl (LLP 3000 §7: one implementation; the web ships this).
set -euo pipefail
cd "$(dirname "$0")/.."
budget=$(node scripts/wasm-budget.mjs)
dirty=false
source_status=$(git -C .. status --porcelain -- snapback4/crates snapback4/scripts snapback4/Cargo.toml snapback4/Cargo.lock snapback4/rust-toolchain.toml snapback4/metrics/wasm-budget.json)
if [ -n "$source_status" ]; then
  dirty=true
  echo 'WARNING: measuring a dirty source tree; sha identifies the base, not the measured artifact (dirty=true).' >&2
fi
node scripts/attribute-wasm.mjs --check-families --check-absent >&2
cargo build -p snapback4-device --no-default-features --features web --profile wasm --target wasm32-unknown-unknown --quiet
out=$(mktemp -d)
wasm-bindgen --target web --out-dir "$out" target/wasm32-unknown-unknown/wasm/snapback4_device.wasm
wasm=$out/snapback4_device_bg.wasm
glue=$out/snapback4_device.js
if command -v wasm-opt >/dev/null; then
  wasm-opt -Os --enable-bulk-memory --enable-nontrapping-float-to-int -o "$out/os.wasm" "$wasm"
  # Keep whichever compresses smaller: -Oz has been seen to inflate the gzip.
  if [ "$(gzip -9 -c "$out/os.wasm" | wc -c)" -lt "$(gzip -9 -c "$wasm" | wc -c)" ]; then wasm=$out/os.wasm; fi
fi
sizes() { printf '{"raw":%d,"gzip":%d,"brotli":%d}' "$(wc -c < "$1")" "$(gzip -9 -c "$1" | wc -c)" "$(brotli -c -q 11 "$1" | wc -c)"; }
over=$(( $(gzip -9 -c "$wasm" | wc -c) - budget ))
if [ "$over" -lt 0 ]; then over=0; fi
line=$(printf '{"at":"%s","sha":"%s","dirty":%s,"wasm":%s,"glue":%s,"wasmOpt":%s,"budget":%d,"over":%d}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git rev-parse --short HEAD)" "$dirty" "$(sizes "$wasm")" "$(sizes "$glue")" "$( [ "$wasm" != "$out/snapback4_device_bg.wasm" ] && echo true || echo false )" "$budget" "$over")
echo "$line" | tee -a metrics/wasm.jsonl
rm -rf "$out"
