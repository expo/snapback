#!/bin/bash
set -euo pipefail
K=$HOME/sb4-pub-0452-kit; R=$HOME/sb4-pub-0452-records; W=$HOME/sb4-pub-0441
trap 'rc=$?; echo "$rc" > "$R/selector-fixture-checks.exit"' EXIT
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_OPT_LEVEL=1
export LIBSQLITE3_FLAGS='-DHAVE_FDATASYNC=1 -USQLITE_ENABLE_MEMORY_MANAGEMENT -DSQLITE_DEFAULT_MEMSTATUS=0'
ulimit -n 65536
mkdir -p "$R/selector-fixture-three"
cd "$W"
for i in $(seq 1 3); do
 node --test snapback4/scripts/affected.test.mjs snapback4/scripts/affected-replay.test.mjs > "$R/selector-fixture-three/unit-$i.log" 2>&1
 cd "$W/snapback4"
 set +e
 cargo run --release -p snapback4-difftest -- run-lean --seed 0 --cases 2000 --workers 2 --out "$R/selector-fixture-three/campaign-$i" > "$R/selector-fixture-three/campaign-$i.log" 2>&1
 raw=$?; echo "$raw" > "$R/selector-fixture-three/campaign-$i.exit"
 set -e
 node --input-type=module - "$R/selector-fixture-three/campaign-$i/report.json" "$raw" <<'JS' > "$R/selector-fixture-three/classification-$i.json"
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {classifyLeanCampaign} from './scripts/affected.mjs';
const report=JSON.parse(readFileSync(process.argv[2]));
const classification=classifyLeanCampaign(report,2000,0,Number(process.argv[3]));
console.log(JSON.stringify(classification,null,2));assert.equal(classification.ok,true);
JS
 echo 0 > "$R/selector-fixture-three/run-$i.exit"
 cd "$W"
done
./ref-check > "$R/selector-fixture-ref-check.log" 2>&1
