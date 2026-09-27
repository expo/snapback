#!/usr/bin/env bash
# The device as wasm for the web (LLP 3000 §7, one implementation): the
# size-first profile, wasm-bindgen's web target, wasm-opt when it helps,
# into packages/snapback4/src/wasm/ — built, never committed; the package
# build carries it into dist/wasm/. `scripts/measure-wasm.sh` measures the same build.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/wasm-budget.mjs >/dev/null
out=packages/snapback4/src/wasm
cargo build -p snapback4-device --no-default-features --features web --profile wasm --target wasm32-unknown-unknown --quiet
rm -rf "$out"
wasm-bindgen --target web --out-dir "$out" --out-name snapback4_device target/wasm32-unknown-unknown/wasm/snapback4_device.wasm
wasm=$out/snapback4_device_bg.wasm
if command -v wasm-opt >/dev/null; then
  # Exact duplicate bodies need no distinct code. Unlike -Os, this pass keeps
  # LLVM's compression-friendly layout. Keep each candidate only if gzip wins.
  # @ref LLP 3000.022#5 — compiled delivery bindings must fit the existing device budget.
  wasm-opt --duplicate-function-elimination --enable-sign-ext --enable-bulk-memory --enable-nontrapping-float-to-int -o "$out/dedup.wasm" "$wasm"
  if [ "$(gzip -9 -c < "$out/dedup.wasm" | wc -c)" -lt "$(gzip -9 -c < "$wasm" | wc -c)" ]; then mv "$out/dedup.wasm" "$wasm"; else rm "$out/dedup.wasm"; fi
  wasm-opt -Os --enable-sign-ext --enable-bulk-memory --enable-nontrapping-float-to-int -o "$out/os.wasm" "$wasm"
  if [ "$(gzip -9 -c < "$out/os.wasm" | wc -c)" -lt "$(gzip -9 -c < "$wasm" | wc -c)" ]; then mv "$out/os.wasm" "$wasm"; else rm "$out/os.wasm"; fi
fi
rm -f "$out/.gitignore" "$out/package.json"
gzip_bytes=$(gzip -9 -c "$wasm" | wc -c | tr -d ' ')
status=$(node scripts/wasm-budget.mjs metrics/wasm-budget.json "$gzip_bytes")
printf 'wasm %s B raw, %s B gzip %s\n' "$(wc -c < "$wasm" | tr -d ' ')" "$gzip_bytes" "$status"
# @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — the budget is a ratchet (author ruling 2026-09-18): an overrun fails the build step.
case "$status" in *OVER*)
  echo "wasm budget: the web device exceeds metrics/wasm-budget.json. A landing that needs the bytes raises the budget in the same commit, with the reason in its why, the commit message and the journal (LLP 3000.002; issues/20260913-snapback4-wasm-device-diet.md)." >&2
  exit 1;;
esac
