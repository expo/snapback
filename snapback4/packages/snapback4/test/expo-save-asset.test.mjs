import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'sb4-save-'));
let source=readFileSync(new URL('../../snapback4-expo/src/save-asset.ts',import.meta.url),'utf8');
source=source.replace('from "snapback4/local"',`from "${new URL('../dist/local.js',import.meta.url)}"`);
writeFileSync(join(dir,'save.mjs'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
const {saveWithHost}=await import(pathToFileURL(join(dir,'save.mjs')));test.after(()=>rmSync(dir,{recursive:true,force:true}));
for(const completed of [true,false])test(`Expo save: private selected bytes, filename and handle disposal (completed=${completed})`,async()=>{
  let revoked=0;const shown=[];
  const client={asset:async()=>({url:'file:///owned/private',type:'audio/wav',bytes:3,name:'../../clip.wav',revoke(){revoked++;}})};
  const result=await saveWithHost(client,'a',undefined,async(hex,name)=>{shown.push({hex,name});return completed;},async()=>new Response(new Uint8Array([1,2,3])));
  assert.deepEqual(shown,[{hex:'010203',name:'clip.wav'}]);assert.equal(revoked,1);
  assert.equal(result.ok,completed);if(!result.ok)assert.equal(result.why.code,'E_CANCELLED');
});
test('Expo save refuses missing module and denied reads; failures always release handles',async()=>{
  let reads=0,revoked=0;
  const client={asset:async()=>{reads++;return {url:'data:application/pdf;base64,eA==',type:'application/pdf',bytes:1,revoke(){revoked++;}};}};
  assert.equal((await saveWithHost(client,'a',undefined,undefined)).why.code,'E_CLIENT');assert.equal(reads,0);
  const failed=await saveWithHost(client,'a','a.pdf',async()=>{throw Error('native sheet failed');},async()=>new Response('x'));
  assert.equal(failed.why.code,'E_CLIENT');assert.equal(revoked,1);
  const denied=await saveWithHost({asset:async()=>({denied:{code:'E_ASSET_UNKNOWN',family:'asset',message:'denied'}})},'a',undefined,async()=>true);
  assert.equal(denied.why.code,'E_ASSET_UNKNOWN');
});
