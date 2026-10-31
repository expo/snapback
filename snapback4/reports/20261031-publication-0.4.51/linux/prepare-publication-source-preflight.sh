#!/bin/bash
set -euo pipefail
K=$HOME/sb4-pub-0451-kit; R=$HOME/sb4-pub-0451-records; W=$HOME/sb4-pub-0441/snapback4
trap 'rc=$?; echo "$rc" > "$R/publication-source-preflight-prepare.exit"' EXIT
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_OPT_LEVEL=1
export LIBSQLITE3_FLAGS='-DHAVE_FDATASYNC=1 -USQLITE_ENABLE_MEMORY_MANAGEMENT -DSQLITE_DEFAULT_MEMSTATUS=0'
if systemctl --user is-active --quiet sb4-pub51-opening-broad; then echo 'refuse: opening checks still active'; exit 75; fi
cd "$W"
[ -z "$(git status --porcelain)" ]
node -e 'if(require("./packages/snapback4/package.json").version!=="0.4.51")process.exit(1)'
# Clear only these owned profiles: checkout version changes previously reused a stale un-hashed wasm artifact.
rm -rf "$W/target/wasm32-unknown-unknown/wasm" "$W/target/wasm"
rm -f "$W/target/debug/snapback4"
cargo build --locked -p snapback4 > "$R/publication-source-preflight-cli-build.log" 2>&1
node scripts/publish.mjs --prepare-client --prepare-directory "$R/preflight-publication-source-client-0.4.51" > "$R/publication-source-preflight-prepare.log" 2>&1
node --input-type=module - "$W" "$R" <<'VERSIONS'
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [w,r]=process.argv.slice(2), source=execFileSync('git',['rev-parse','HEAD'],{cwd:w,encoding:'utf8'}).trim();
const prepare=JSON.parse(readFileSync(r+'/preflight-publication-source-client-0.4.51/prepare.json'));
assert.equal(prepare.source,source);
const cli=execFileSync(w+'/target/debug/snapback4',['--version'],{encoding:'utf8'}).trim();
assert.equal(cli,'snapback4 0.4.51');
const wasm=[];
for(const directory of ['src','dist']){
 const bytes=readFileSync(w+'/packages/snapback4/'+directory+'/wasm/snapback4_device_bg.wasm');
 const sections=WebAssembly.Module.customSections(new WebAssembly.Module(bytes),'snapback4.engine');
 assert.equal(sections.length,1);
 const stamp=JSON.parse(new TextDecoder().decode(sections[0]));assert.equal(stamp.version,'0.4.51');
 wasm.push({directory,stamp,sha256:createHash('sha256').update(bytes).digest('hex')});
}
assert.equal(wasm[0].sha256,wasm[1].sha256);
writeFileSync(r+'/publication-source-preflight-versions.json',JSON.stringify({source,cli,wasm,prepare},null,2)+'\n');
console.log('CLI, package and both actual embedded WASM stamps agree at 0.4.51; source '+source);
VERSIONS
