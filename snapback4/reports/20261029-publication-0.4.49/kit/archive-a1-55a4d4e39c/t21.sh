#!/bin/bash
# Reproduce srv1-lifetime test 21's child script directly (read-only), with full stack, under the dry run's node.
export PATH=/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/usr/bin:/bin
cd $HOME/sb4-pub-0444-wt/snapback4
U=file://$PWD/packages/snapback4/dist/parent-lifetime.js
node -v
node --stack-trace-limit=50 --input-type=module -e "import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';Object.defineProperty(process,'platform',{value:'linux'});let parent=12345;Object.defineProperty(process,'ppid',{get:()=>parent});const orig=fs.readFileSync;fs.readFileSync=(...a)=>{console.error('readFileSync called with',String(a[0]).slice(0,120));console.error(new Error('trace').stack.split('\n').slice(1,12).join('\n'));throw Object.assign(Error('no proc'),{code:'ENOENT'});};process.kill=()=>true;syncBuiltinESMExports();try{const m=await import('$U');console.error('import ok', typeof m.watchParent);}catch(e){console.error('import failed', e.message);}" 2>&1 | head -40
