import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';

test('killed wasm host retains publication debt and the uncertain attempt id', {timeout:15000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'sb4-delivery-crash-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 async function capture(mode){
  const child=fork(new URL('./helpers/delivery-crash-worker.mjs',import.meta.url),[directory,mode],{stdio:['ignore','ignore','pipe','ipc']});
  let errors='';child.stderr.on('data',chunk=>errors+=chunk);
  const closed=once(child,'exit');
  try{return await Promise.race([once(child,'message').then(([message])=>message),closed.then(([code,signal])=>{throw Error(`worker exited ${code}/${signal}: ${errors}`);})]);}
  finally{child.kill('SIGKILL');await closed;}
 }
 const first=await capture('write');
 assert.equal(first.body.id,'write-attempt');assert.deepEqual(first.body.args,{conversation:'c1',from:41,through:41});
 const persisted=JSON.parse(await readFile(join(directory,'crash.json'),'utf8'));
 assert.ok(persisted.some(c=>c.s==='r'&&c.v.includes('confirmed')));
 assert.ok(persisted.some(c=>c.s==='m'&&c.k.startsWith('device:delivery:')&&c.v.includes('write-attempt')));
 const second=await capture('read');assert.deepEqual(second.body,first.body);
 assert.deepEqual(Object.values(second.state.groups)[0].owed,[[41,41]]);
});
