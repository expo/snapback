#!/bin/bash
set -eu
K=$HOME/sb4-pub-0452-kit; R=$HOME/sb4-pub-0452-records; W=$HOME/sb4-pub-0441/snapback4
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.elan/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_OPT_LEVEL=1
export LIBSQLITE3_FLAGS='-DHAVE_FDATASYNC=1 -USQLITE_ENABLE_MEMORY_MANAGEMENT -DSQLITE_DEFAULT_MEMSTATUS=0'
ulimit -n 65536
until [ -s "$R/client-remainder-complete.json" ]; do sleep 15; done
[ "$(git -C "$W" rev-parse HEAD)" = "$(cat "$K/fixture-main-pushed.sha")" ]
cd "$W"
python3 "$K/log-status.py" 'Discovery collection complete. Repairing only our own wasm profile caches after the diagnostic 0.4.52 -> 0.4.50 checkout downgrade; no source change. Then isolate all discovery reds with verified matching engine/package versions.'
rm -rf "$W/target/wasm32-unknown-unknown/wasm" "$W/target/wasm"
bash scripts/build-wasm.sh > "$R/discovery-wasm-rebuild.log" 2>&1
bun run --cwd packages/snapback4 build > "$R/discovery-client-rebuild.log" 2>&1
node --input-type=module - <<'VERIFY_WASM'
import assert from 'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';import{execFileSync}from'node:child_process';
const stamp=JSON.parse(readFileSync('packages/snapback4/src/wasm/snapback4_device_bg.wasm.engine.json'));
const version=JSON.parse(readFileSync('packages/snapback4/package.json')).version;
const cli=execFileSync('./target/debug/snapback4',['--version'],{encoding:'utf8'}).trim();
assert.equal(stamp.version,version);assert.equal(cli,'snapback4 '+version);
writeFileSync('/home/ccheever/sb4-pub-0452-records/discovery-wasm-repaired.json',JSON.stringify({at:new Date().toISOString(),version,stamp,cli},null,2));
console.log('matching wasm, CLI and package: '+version);
VERIFY_WASM
for file in sync-generation upload-hooks asset-avatars social-browser; do
 O="$R/isolated/discovery-$file"; mkdir -p "$O"
 for i in 1 2 3 4 5 6; do
  if node scripts/run-client-tests.mjs 1 files "packages/snapback4/test/$file.test.mjs" > "$O/run-$i.log" 2>&1; then rc=0; else rc=$?; fi
  echo "$rc" > "$O/run-$i.exit"
  echo "$(date -u +%FT%TZ) $file run-$i rc=$rc"
  if [ "$rc" != 0 ]; then python3 "$K/log-status.py" "HOLD: matching-artifact alone $file run-$i red; no further isolation attempts before classification."; exit "$rc"; fi
 done
 python3 "$K/log-status.py" "Matching-artifact alone $file PASSED 6/6."
done
echo done > "$R/discovery-isolations.done"

