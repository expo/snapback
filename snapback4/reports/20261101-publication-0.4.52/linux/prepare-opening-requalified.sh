#!/bin/bash
set -euo pipefail
K=$HOME/sb4-pub-0452-kit; R=$HOME/sb4-pub-0452-records; W=$HOME/sb4-pub-0441/snapback4
trap 'rc=$?; echo "$rc" > "$R/opening-requalified-preflight-prepare.exit"' EXIT
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_OPT_LEVEL=1
export LIBSQLITE3_FLAGS='-DHAVE_FDATASYNC=1 -USQLITE_ENABLE_MEMORY_MANAGEMENT -DSQLITE_DEFAULT_MEMSTATUS=0'
ulimit -n 65536
cd "$W"
[ -z "$(git status --porcelain)" ]
cargo build --locked -p snapback4 > "$R/opening-requalified-preflight-cli-build.log" 2>&1
node scripts/publish.mjs --prepare-client --prepare-directory "$R/preflight-opening-requalified-client-0.4.50" > "$R/opening-requalified-preflight-prepare.log" 2>&1
node --input-type=module - "$R" <<'JS'
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const r=process.argv[2],source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const prepare=JSON.parse(readFileSync(r+'/preflight-opening-requalified-client-0.4.50/prepare.json'));
assert.equal(prepare.source,source);
const cli=execFileSync('target/debug/snapback4',['--version'],{encoding:'utf8'}).trim();assert.equal(cli,'snapback4 0.4.50');
const wasm=[];
for(const directory of ['src','dist']){
 const bytes=readFileSync('packages/snapback4/'+directory+'/wasm/snapback4_device_bg.wasm');
 const sections=WebAssembly.Module.customSections(new WebAssembly.Module(bytes),'snapback4.engine');assert.equal(sections.length,1);
 const stamp=JSON.parse(new TextDecoder().decode(sections[0]));assert.equal(stamp.version,'0.4.50');
 wasm.push({directory,stamp,sha256:createHash('sha256').update(bytes).digest('hex')});
}
assert.equal(wasm[0].sha256,wasm[1].sha256);
writeFileSync(r+'/opening-requalified-preflight-versions.json',JSON.stringify({source,cli,wasm,prepare},null,2)+'\n');
console.log('Current-source CLI and both WASM stamps agree at 0.4.50; preflight only, not publication bytes.');
JS
