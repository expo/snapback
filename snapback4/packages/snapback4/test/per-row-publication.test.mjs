import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createLocalClient} from '../dist/local.js';
import {webDevice,memoryPersistence} from '../dist/web.js';
import {processDevice} from '../dist/native.js';
import {server,binary,until} from './helpers/app-server.mjs';
for(const tier of ['wasm','process']) test(`${tier}: unknown apply refresh drains after the watermark`,async t=>{
 const {url,dir}=await server(t,'',readFileSync(new URL('../../../witness/per-row.q',import.meta.url),'utf8'));
 await fetch(url+'/seed',{method:'POST',body:JSON.stringify([{table:'cards',row:{id:'c0',slot:0,owner:'dev:alice',label:'original'}}])});
 let releaseChange, omit=false, applied=false, queries=0, holdState=false, stateHeld=false;
 const gate=Promise.withResolvers();
 const base=tier==='process'?processDevice({binary,dir:join(dir,'device')}):webDevice({wasm:readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm',import.meta.url)),persist:memoryPersistence()});
 const client=await createLocalClient({url,persona:'alice',device:{async open(...args){const core=await base.open(...args);return {...core,async call(request,commit){
  const strip=r=>{if(!omit||request.op!=='apply'||!r.ok)return r;const {touched,...ok}=r.ok;return {...r,ok};};
  const result=strip(await core.call(request,r=>commit?.(strip(r))));
  if(omit&&request.op==='apply'){applied=true;holdState=true;}
  if(holdState&&request.op==='sync_state'&&request.capture===false){holdState=false;stateHeld=true;await gate.promise;}return result;
 }}}},fetch:async(input,init)=>{
  const path=new URL(input).pathname;
  if(path==='/changes')return new Promise((resolve,reject)=>{releaseChange=json=>resolve(Response.json(json));init.signal.addEventListener('abort',()=>reject(Error('closed')),{once:true});});
  const response=await fetch(input,init);
  if(omit&&path.startsWith('/q/')){queries++;const json=await response.json();delete json.data;return Response.json({...json,loading:true});}
  return response;
 }});
 t.after(async()=>{gate.resolve();await client.close()});await client.sync();
 const w=client.observe({kind:'query',name:'point'},{id:'c0'},{keep:false});w.subscribe(()=>{});t.after(()=>w.close());
 await until(()=>w.getSnapshot().data?.label==='original'&&!w.getSnapshot().revalidating);
 const changed=await fetch(url+'/m/edit',{method:'POST',headers:{'x-snapback-persona':'alice'},body:JSON.stringify({id:crypto.randomUUID(),args:{id:'c0',label:'changed'}})}).then(r=>r.json());
 omit=true;releaseChange({seq:changed.seq,generation:1,tables:['cards']});
 await until(()=>applied,'apply');
 await until(()=>stateHeld,'watermark publication held');
 const oldPoll=releaseChange;gate.resolve();await until(()=>releaseChange!==oldPoll,'sync completed and next change poll began');
 await until(()=>w.getSnapshot().data?.label==='changed','owner refresh after watermark publication');
 const after=w.getSnapshot();
 assert.equal((await client.query({kind:'query',name:'point'},{id:'c0'})).data?.label,'changed','device is current');
 assert.equal(after.data?.label,'changed','sync must refresh the owner after clearing the remote fence');
});

import { ReadObservation } from '../dist/read-observation.js';
import { createClient } from '../dist/client.js';
const pause = () => new Promise(resolve => setImmediate(resolve));
for (const tier of ['online', 'wasm', 'process']) for (const keep of [undefined, false, true]) {
 test(`${tier} keep=${keep}: a pre-reset attempt reaches final publication without replacing the reset`, async t => {
  const {url,dir}=await server(t,'',`use personas alice
table rows:
  value: int
  read <- allow
  online only
query remote():
  return rows['r']
`);
  await fetch(url+'/seed',{method:'POST',body:JSON.stringify([{table:'rows',row:{id:'r',value:7}}])});
  const gate=Promise.withResolvers(); let resetOwner, armed=false, queries=0;
  const original=ReadObservation.prototype.fetch;
  t.mock.method(ReadObservation.prototype,'fetch',async function(...args) {
    const result=await original.apply(this,args);
    // The completed fetch has passed its own revision check. Reset immediately
    // before the client continuation that owns final publication, independently
    // of credential, store and commit revisions so those cannot mask the fence.
    if(armed&&!resetOwner&&result.read.data) { resetOwner=this; this.reset({loading:true}); }
    return result;
  });
  const options={url,persona:'alice',fetch:async(input,init)=>{
    const path=new URL(input).pathname;
    if(path==='/changes')return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('closed')),{once:true}));
    if(path.startsWith('/q/')&&armed&&++queries>1) await gate.promise;
    return fetch(input,init);
  }};
  let client;
  if(tier==='online') client=createClient(options);
  else client=await createLocalClient({...options,device:tier==='process'?processDevice({binary,dir:join(dir,'device')}):webDevice({wasm:readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm',import.meta.url)),persist:memoryPersistence()})});
  t.after(async()=>{gate.resolve();await client.close()});
  if(client.sync)await client.sync(); else await client.query({kind:'query',name:'remote'},{});
  armed=true;
  const watch=client.observe({kind:'query',name:'remote'},{},{keep});
  const published=[]; watch.subscribe(()=>published.push(watch.getSnapshot())); t.after(()=>watch.close());
  await until(()=>resetOwner,'pre-reset fetch completed');
  // The replacement crosses the device process before reaching this held
  // transport. Event-loop turns in the parent do not measure child progress.
  await until(()=>queries>=2,'post-reset replacement reached the transport');
  assert.deepEqual(watch.getSnapshot(),{loading:true});
  assert.ok(published.every(read=>!('data' in read)),'the pre-reset result never reaches a subscriber');
  assert.equal(queries,2,'the reset retires the completed attempt and queues one replacement');
  gate.resolve(); await until(()=>watch.getSnapshot().data?.value===7,'post-reset attempt publishes');
 });
}

for (const tier of ['online', 'wasm', 'process']) for (const keep of [undefined, false, true]) {
 test(`${tier} keep=${keep}: a floor-rejected completion cannot publish loading over a newer answer`, async t => {
  const {url,dir}=await server(t,'',`use personas alice
table rows:
  value: int
  read <- allow
  online only
query remote():
  return rows['r']
`);
  await fetch(url+'/seed',{method:'POST',body:JSON.stringify([{table:'rows',row:{id:'r',value:7}}])});
  const deadline=Date.now()+3600000; let armed=false, owner, returned=0;
  const original=ReadObservation.prototype.fetch;
  t.mock.method(ReadObservation.prototype,'fetch',async function(...args) {
    const result=await original.apply(this,args);
    if(armed&&!owner&&result.read.data) {
      owner=this;
      // Model a held answer's withdrawn floor plus a newer publication in the
      // final continuation gap. Neither is a scope reset; resetVersion cannot
      // supply the protection this case is intended to check.
      this.expiredServerDeadline=deadline;
      this.publish({data:{value:8},complete:true,cut:null,fresh:true});
      returned++;
    }
    return result;
  });
  const options={url,persona:'alice',fetch:async(input,init)=>{
    const path=new URL(input).pathname;
    if(path==='/changes')return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('closed')),{once:true}));
    const reply=await fetch(input,init);
    if(path.startsWith('/q/')) return Response.json({...await reply.json(),nextExpiry:deadline});
    return reply;
  }};
  const client=tier==='online'?createClient(options):await createLocalClient({...options,device:tier==='process'?processDevice({binary,dir:join(dir,'device')}):webDevice({wasm:readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm',import.meta.url)),persist:memoryPersistence()})});
  t.after(()=>client.close());
  if(client.sync)await client.sync(); else await client.query({kind:'query',name:'remote'},{});
  armed=true;
  const watch=client.observe({kind:'query',name:'remote'},{},{keep}); watch.subscribe(()=>{});t.after(()=>watch.close());
  await until(()=>returned===1,'old body reaches publication gap');
  for(let i=0;i<60;i++)await pause();
  assert.equal(owner.resetVersion,0,'scope reset did not mask the floor check');
  assert.equal(watch.getSnapshot().data?.value,8,'newer answer survives the rejected body');
  assert.equal(watch.getSnapshot().revalidating,undefined);
 });
}
