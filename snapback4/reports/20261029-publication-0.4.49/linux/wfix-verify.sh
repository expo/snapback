#!/bin/bash
# Verify the srv1-lifetime test 21 fixture fix in ~/sb4-pub-0449-kit/wfix (own target): direct child-script reproduction
# (old stub vs /proc-only stub) under node 24.13.1 (Linux suite) and 24.18.0 (Mac dry run), then the whole file alone x3 each.
export PATH=$HOME/.elan/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
ulimit -n 65536
W=~/sb4-pub-0449-kit/wfix/snapback4; O=~/sb4-pub-0449-kit/isolated/wfix; mkdir -p $O; cd $W
N13=$HOME/.local/node-v24.13.1-linux-x64/bin; N18=$HOME/.local/node-v24.18.0-linux-x64/bin
s=$(date +%s); bun install --frozen-lockfile > $O/bun.log 2>&1 && (cd .. && bun install --frozen-lockfile > $O/bun-root.log 2>&1) && bash scripts/build-wasm.sh > $O/wasm.log 2>&1 && bun run --cwd packages/snapback4 build > $O/pkg.log 2>&1 && nice -n 5 cargo build --locked --profile test --workspace -j 32 > $O/cargo.log 2>&1; echo "build rc=$? $(( $(date +%s)-s )) s"
U=file://$W/packages/snapback4/dist/parent-lifetime.js
OLD="fs.readFileSync=()=>{throw Object.assign(Error('no proc'),{code:'ENOENT'});};"
NEW="const readFile=fs.readFileSync;fs.readFileSync=(file,...rest)=>{if(String(file).startsWith('/proc/'))throw Object.assign(Error('no proc'),{code:'ENOENT'});return readFile.call(fs,file,...rest);};"
for N in $N13 $N18; do for stub in OLD NEW; do
  src="import fs from 'node:fs';import assert from 'node:assert/strict';import{syncBuiltinESMExports}from'node:module';Object.defineProperty(process,'platform',{value:'linux'});let parent=12345;Object.defineProperty(process,'ppid',{get:()=>parent});${!stub}process.kill=()=>true;syncBuiltinESMExports();const {watchParent}=await import('$U');let lost=false;const stop=watchParent(()=>lost=true);await new Promise(r=>setTimeout(r,300));assert.equal(lost,false);parent=1;await new Promise(r=>setTimeout(r,300));stop();assert.equal(lost,true);"
  out=$($N/node --input-type=module -e "$src" 2>&1); echo "direct $($N/node -v) stub=$stub rc=$? $(echo "$out" | grep -m1 -oE "Error: [^\n]{0,60}|AssertionError[^\n]{0,60}")"
done; done
for N in $N13 $N18; do for i in 1 2 3; do
  s=$(date +%s); env -u SNAPBACK4_BIN PATH=$N:$PATH timeout 1500 $N/node scripts/run-client-tests.mjs 1 files packages/snapback4/test/srv1-lifetime.test.mjs > $O/srv1-$($N/node -v)-$i.log 2>&1
  echo "srv1-lifetime alone $($N/node -v) #$i rc=$? $(( $(date +%s)-s )) s $(grep -E '^-- client files:' $O/srv1-$($N/node -v)-$i.log | tail -1 | cut -c1-120) $(grep -E '^not ok' $O/srv1-$($N/node -v)-$i.log | cut -c1-90 | tr '\n' ' ')"
done; done
git -C ~/sb4-pub-0449-kit/wfix status --porcelain | head -5; echo verify-done
