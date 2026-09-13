#!/usr/bin/env bash
# The device as wasm for the web (LLP 3000 §7, one implementation): the
# size-first profile, wasm-bindgen's web target, wasm-opt when it helps,
# into packages/snapback4/src/wasm/ — built, never committed; the package
# build carries it into dist/wasm/. `scripts/measure-wasm.sh` measures the same build.
set -euo pipefail
cd "$(dirname "$0")/.."
out=packages/snapback4/src/wasm
cargo build -p snapback4-device --no-default-features --features web --profile wasm --target wasm32-unknown-unknown --quiet
rm -rf "$out"
wasm-bindgen --target web --out-dir "$out" --out-name snapback4_device target/wasm32-unknown-unknown/wasm/snapback4_device.wasm
wasm=$out/snapback4_device_bg.wasm
if command -v wasm-opt >/dev/null; then
  wasm-opt -Os --enable-bulk-memory --enable-nontrapping-float-to-int -o "$out/os.wasm" "$wasm"
  if [ "$(gzip -9 -c "$out/os.wasm" | wc -c)" -lt "$(gzip -9 -c "$wasm" | wc -c)" ]; then mv "$out/os.wasm" "$wasm"; else rm "$out/os.wasm"; fi
fi
rm -f "$out/.gitignore" "$out/package.json"
printf 'wasm %s B raw, %s B gzip\n' "$(wc -c < "$wasm" | tr -d ' ')" "$(gzip -9 -c "$wasm" | wc -c | tr -d ' ')"
