import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { proofFailure, startDev } from '../dist/proof.js';
import { proofRole, observeProofReply } from '../dist/proof-observation.js';
import { createClient } from '../dist/client.js';
import { binary } from './helpers/app-server.mjs';

function directory(t) {
 const dir=mkdtempSync(join(tmpdir(),'calls1-proof-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true})); mkdirSync(join(dir,'snapback'));
 writeFileSync(join(dir,'snapback/schema.q'),`use personas customer, staff
query amount(n: int):
  return n
`); return dir;
}
// Wave 34 Muse ERR_ASSERTION/E_INPUT/E_ASSET_UNKNOWN/E_AUTH/E_ADMISSION:
// report refusal content without exposing request arguments or credentials.
for(const code of ['E_INPUT','E_ASSET_UNKNOWN','E_AUTH','E_ADMISSION']) test(`wave34 Muse assertion: ${code} leads with operation, role, field and fix`,()=>{
 proofRole('PRIVATE-TOKEN','staff');
 observeProofReply('http://127.0.0.1:4400/m/approve',{authorization:'Bearer PRIVATE-TOKEN'}, {why:{code,site:'args.evidence',message:'PRIVATE-ROW'}});
 const error=new assert.AssertionError({actual:{state:'failed',why:{code}},expected:{state:'sent'},operator:'deepStrictEqual'});
 const original={stack:error.stack,message:error.message,actual:error.actual};
 const summary=proofFailure(error);
 assert.match(summary,new RegExp(`operation approve; role staff; ${code}; field args.evidence`));
 assert.match(summary,/likely fix:/); assert.doesNotMatch(summary,/PRIVATE-/);
 assert.equal(error.stack,original.stack);assert.equal(error.message,original.message);assert.equal(error.actual,original.actual);
});

test('wave34 acceptance uncoded red: real E_INPUT request remains visible before the native assertion diff', t=>{
 const cwd=directory(t), proof=new URL('../dist/proof.js',import.meta.url).href, client=new URL('../dist/client.js',import.meta.url).href;
 const source=`import assert from 'node:assert/strict';
import {startDev} from ${JSON.stringify(proof)};
import {createClient} from ${JSON.stringify(client)};
const host=await startDev({cwd:${JSON.stringify(cwd)},env:{...process.env,SNAPBACK4_BIN:${JSON.stringify(binary)}},args:['--memory','--no-watch']});
const c=createClient({url:host.url,persona:'customer'});
try { const result=await c.query({name:'amount'},{n:null}); assert.equal(result.data,7); }
finally {c.close();await host.stop();}
`;
 const file=join(cwd,'red.mjs');writeFileSync(file,source);
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,[file],{cwd,env,encoding:'utf8',timeout:30000});
 assert.equal(result.status,1,result.stdout+result.stderr);
 const output=result.stderr;
 assert.match(output,/proof refusal \(nearest observed request\): operation amount; role customer; E_INPUT/);
 assert.ok(output.indexOf('proof refusal')<output.indexOf('AssertionError'),output);
 assert.match(output,/likely fix:/);assert.match(output,/AssertionError/);
});

test('wave34 nearest-event summary identifies an observed request without claiming it caused the assertion',async t=>{
 const cwd=directory(t), host=await startDev({cwd,env:{...process.env,SNAPBACK4_BIN:binary},args:['--memory','--no-watch']});
 const c=createClient({url:host.url,persona:'customer'});
 t.after(async()=>{c.close();await host.stop();});
 const read=await c.query({name:'amount'},{n:null});assert.equal(read.denied.code,'E_INPUT');
 const error=new assert.AssertionError({actual:0,expected:1,operator:'strictEqual'});
 assert.match(proofFailure(error),/nearest observed request.*operation amount; role customer; E_INPUT/);
});

test('matching codes alone do not establish the operation or field that failed',()=>{
 const error = new assert.AssertionError({actual:{why:{code:'E_INPUT'}},expected:1,operator:'strictEqual'});
 const summary=proofFailure(error,[{operation:'unrelated',role:'other',code:'E_INPUT',field:'other.field'}]);
 assert.match(summary,/nearest observed request/);
});

test('device admission refusal keeps its operation and persona before a state-only assertion', async t=>{
 const {createLocalClient}=await import('../dist/local.js');
 const {processDevice}=await import('../dist/native.js');
 const cwd=directory(t);
 writeFileSync(join(cwd,'snapback/schema.q'),`use personas customer
 tablePlaceholder`.replace(' tablePlaceholder',`table notes:
  owner: principal
  n: int
  by byOwner: owner, id
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
mutation put(n: int):
  require n > 0 else POSITIVE
  return insert notes {owner: viewer, n}
query list():
  return notes[viewer] first 10 by byOwner
`));
 const host=await startDev({cwd,env:{...process.env,SNAPBACK4_BIN:binary},args:['--memory','--no-watch']});
 const c=await createLocalClient({url:host.url,persona:'customer',device:processDevice({binary,dir:join(cwd,'device')})});
 t.after(async()=>{await c.close();await host.stop();});
 await c.sync();
 const write=await c.mutate({name:'put'},{n:-1});
 assert.equal(write.state,'failed',JSON.stringify(write));assert.equal(write.why.code,'POSITIVE');
 const error=new assert.AssertionError({actual:write,expected:{state:'sent'},operator:'deepStrictEqual'});
 const summary=proofFailure(error);
 assert.match(summary,/operation put; role customer; POSITIVE/);
 assert.match(summary,/snapback4 why POSITIVE/);
 assert.doesNotMatch(summary,/nearest observed request/,'the actual refusal object carries request correlation');
});

test('wave34 Codex 003/004/007: init owns the frontend install and preserves npm failure without polling', {skip:process.platform==='win32'},async t=>{
 const {chmodSync}=await import('node:fs');
 const cwd=mkdtempSync(join(tmpdir(),'calls1-init-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 const bin=join(cwd,'bin');mkdirSync(bin);
 writeFileSync(join(bin,'npm'),'#!/bin/sh\necho PRIVATE_NPM_PROGRESS\nsleep 0.2\nexit 17\n');chmodSync(join(bin,'npm'),0o755);
 // Defer schema-specific proofs but exercise the real generated installer.
 const {cli}=await import('../dist/proof.js');
 const result=await cli(['init','--web','--online','--password'],{cwd,env:{...process.env,PATH:`${bin}:${process.env.PATH}`,SNAPBACK4_BIN:binary,SNAPBACK4_INIT_INSTALL:'1'}});
 assert.equal(result.code,17,result.stderr+result.stdout);
 assert.match(result.stdout,/installing frontend dependencies/);
 assert.doesNotMatch(result.stdout+result.stderr,/PRIVATE_NPM_PROGRESS|still running/);
 const {readFileSync}=await import('node:fs');
 const state=JSON.parse(readFileSync(join(cwd,'.snapback4/install.json'),'utf8'));
 assert.equal(state.state,'finished');assert.equal(state.code,17);
 assert.match(readFileSync(join(cwd,'.snapback4/install.log'),'utf8'),/PRIVATE_NPM_PROGRESS/);
});


test('a reused local refusal object cannot correlate two different operations',async()=>{
 const {observeRefusal}=await import('../dist/proof-observation.js');
 const why={code:'E_STORE_RESTORE',site:'store'};
 observeRefusal('firstOperation','customer',why);observeRefusal('secondOperation','customer',why);
 const error=new assert.AssertionError({actual:{why},expected:1,operator:'strictEqual'});
 assert.match(proofFailure(error),/nearest observed request/);
});
