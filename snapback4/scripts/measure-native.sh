#!/usr/bin/env bash
# The native module as an iOS app links it: the production profile, the
# device target, the dynamic library stripped, its text segment — one line
# to metrics/native.jsonl beside the wasm and TypeScript numbers.
set -euo pipefail
cd "$(dirname "$0")/.."
target=${1:-aarch64-apple-ios}
cargo build -p snapback4-device --profile production --target "$target" --quiet
dylib=target/$target/production/libsnapback4_device.dylib
tmp=$(mktemp)
cp "$dylib" "$tmp" && strip -x "$tmp"
text=$(xcrun size -m "$tmp" | awk '/^Segment __TEXT/ {gsub(":", "", $3); print $3}')
line=$(printf '{"at":"%s","sha":"%s","target":"%s","dylib":%d,"text":%s,"staticlib":%d}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git rev-parse --short HEAD)" "$target" "$(wc -c < "$tmp")" "${text:-0}" "$(wc -c < target/$target/production/libsnapback4_device.a)")
echo "$line" | tee -a metrics/native.jsonl
rm -f "$tmp"
