import '../../../scripts/test-npm-cache.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
const source=resolve(import.meta.dirname,'../../../crates/snapback4/src/verbs/init');
test('a single verify invocation reports progress during a quiet phase and finishes with a bounded summary',{timeout:15000},async t=>{
 const cwd=mkdtempSync(join(tmpdir(),'starter2-verify-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 mkdirSync(join(cwd,'scripts'));mkdirSync(join(cwd,'bin'));
 for(const name of ['verify.mjs','verify-parent.mjs','verify-cache.mjs'])copyFileSync(join(source,name),join(cwd,'scripts',name));
 writeFileSync(join(cwd,'bin/npm'),'#!/bin/sh\nif [ "$3" = check ]; then sleep 5.2; fi\necho "$3" >> phases\n',{mode:0o755});
 const child=spawn(process.execPath,['scripts/verify.mjs'],{cwd,env:{...process.env,PATH:join(cwd,'bin')+':'+process.env.PATH}});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 assert.equal(await new Promise(r=>child.on('exit',r)),0,stderr);
 assert.match(stderr,/verify: running check; 5s elapsed/);
 assert.equal(stdout.trim().split('\n').length,3);
 assert.match(stdout,/passed; 4\/4 phases/);
 assert.equal(readFileSync(join(cwd,'phases'),'utf8'),'check\nacceptance\nfrontend:proof\nprobe:check\n');
});

test('verify retains browser repair guidance in its bounded first-red summary',async t=>{
 const cwd=mkdtempSync(join(tmpdir(),'starter2-selector-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 mkdirSync(join(cwd,'scripts'));mkdirSync(join(cwd,'bin'));
 for(const name of ['verify.mjs','verify-parent.mjs','verify-cache.mjs'])copyFileSync(join(source,name),join(cwd,'scripts',name));
 const proof=readFileSync(resolve(source,'../../../../../packages/snapback4/src/proof.ts'),'utf8');
 const hint=proof.match(/console\.error\("(likely fix: browser controls:[^"]+)"\)/)[1];
 writeFileSync(join(cwd,'bin/npm'),'#!/usr/bin/env node\nprocess.stderr.write('+JSON.stringify('proof failed: no backend refusal\n'+hint+'\nTimeoutError: waiting for exact select\n')+');process.exit(17);\n',{mode:0o755});
 const child=spawn(process.execPath,['scripts/verify.mjs'],{cwd,env:{...process.env,PATH:join(cwd,'bin')+':'+process.env.PATH}});
 let stdout='';child.stdout.on('data',b=>stdout+=b);child.stderr.resume();
 assert.equal(await new Promise(r=>child.on('exit',r)),17);
 assert.match(stdout,/likely fix: browser controls:.*wrapping labels/);
 assert.ok(stdout.trim().split('\n').length<=9,stdout);
});
