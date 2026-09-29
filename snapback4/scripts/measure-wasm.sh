#!/usr/bin/env bash
# The device core as wasm, measured on the pinned toolchain: the size-first
# profile, wasm-bindgen's web target, gzip-9 and brotli-11, one line to
# metrics/wasm.jsonl (LLP 3000 §7: one implementation; the web ships this).
set -euo pipefail
cd "$(dirname "$0")/.."
budget=$(node scripts/wasm-budget.mjs)
dirty=false
source_status=$(git -C .. status --porcelain -- snapback4/crates snapback4/scripts snapback4/Cargo.toml snapback4/Cargo.lock snapback4/rust-toolchain.toml snapback4/metrics/wasm-budget.json snapback4/package.json snapback4/bun.lock)
if [ -n "$source_status" ]; then
  dirty=true
  echo 'WARNING: measuring a dirty source tree; sha identifies the base, not the measured artifact (dirty=true).' >&2
fi
node scripts/attribute-wasm.mjs --check-families --check-absent >&2
# @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — publication hosts use the same portable, pinned optimizer; PATH is irrelevant.
optimizer=node_modules/binaryen/bin/wasm-opt
if [ ! -f "$optimizer" ]; then
  echo "wasm build: missing locked Binaryen; run bun install --frozen-lockfile in snapback4/" >&2
  exit 1
fi
node -e 'const wanted = require("./package.json").devDependencies.binaryen;
const installed = require("./node_modules/binaryen/package.json").version;
if (!/^\d+\.\d+\.\d+$/.test(wanted) || installed !== wanted) {
  throw new Error("wasm build: Binaryen differs from the exact workspace pin; run bun install --frozen-lockfile");
}
console.error(`Binaryen ${installed} (locked workspace dependency)`);'
cargo build -p snapback4-device --no-default-features --features web --profile wasm --target wasm32-unknown-unknown --quiet
out=$(mktemp -d)
wasm-bindgen --target web --out-dir "$out" target/wasm32-unknown-unknown/wasm/snapback4_device.wasm
wasm=$out/snapback4_device_bg.wasm
glue=$out/snapback4_device.js
optimized=false
node "$optimizer" -Os --enable-bulk-memory --enable-nontrapping-float-to-int -o "$out/os.wasm" "$wasm"
if [ "$(gzip -9 -c < "$out/os.wasm" | wc -c)" -lt "$(gzip -9 -c < "$wasm" | wc -c)" ]; then optimized=true; mv "$out/os.wasm" "$wasm"; else rm "$out/os.wasm"; fi
# @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — preserve Rust's size choices while sharing identical branch tails (also measured by HV).
# Compare identical gzip headers; temporary filenames must not buy bytes.
node "$optimizer" --code-folding --duplicate-function-elimination --dce --vacuum --enable-bulk-memory --enable-nontrapping-float-to-int -o "$out/fold.wasm" "$wasm"
if [ "$(gzip -9 -c < "$out/fold.wasm" | wc -c)" -lt "$(gzip -9 -c < "$wasm" | wc -c)" ]; then optimized=true; mv "$out/fold.wasm" "$wasm"; else rm "$out/fold.wasm"; fi
sizes() { printf '{"raw":%d,"gzip":%d,"brotli":%d}' "$(wc -c < "$1")" "$(gzip -9 -c "$1" | wc -c)" "$(brotli -c -q 11 "$1" | wc -c)"; }
over=$(( $(gzip -9 -c "$wasm" | wc -c) - budget ))
if [ "$over" -lt 0 ]; then over=0; fi
line=$(printf '{"at":"%s","sha":"%s","dirty":%s,"wasm":%s,"glue":%s,"wasmOpt":%s,"budget":%d,"over":%d}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git rev-parse --short HEAD)" "$dirty" "$(sizes "$wasm")" "$(sizes "$glue")" "$optimized" "$budget" "$over")
echo "$line" | tee -a metrics/wasm.jsonl
rm -rf "$out"
