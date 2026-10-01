import { waitFor as awaitState } from './helpers/wait.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {localDelivery} from '../dist/local-delivery.js';
import {deliveryCommit} from '../dist/local-device.js';
// Real wasm: debt shares the publication's host persistence batch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptManifest,emptyDelivery} from '../dist/delivery-state.js';
import {webDevice,memoryPersistence} from '../dist/web.js';
import {wasm,backend,snapshot} from './helpers/delivery-fixture.mjs';
const ok=r=>{assert.ok(!r.denied,JSON.stringify(r));return r.ok;};
const debt=async core=>JSON.parse(ok(await core.call({op:'delivery',viewer:'dev:alice',action:'read'})).value);
const owed=s=>Object.values(s.groups).map(g=>g.owed);

test('wasm publication and delivery meta persist atomically, including a failed save',async t=>{
 const memory=memoryPersistence();let fail=false;const batches=[];
 const persist={...memory,async save(name,changes){batches.push(changes);if(fail){fail=false;throw Error('interrupted publication');}await memory.save(name,changes);}};
 const opener=webDevice({wasm,persist});let core=await opener.open('delivery-web',backend);t.after(()=>core.close());
 await debt(core);fail=true;await assert.rejects(core.call(snapshot),/interrupted/);
 assert.deepEqual(owed(await debt(core)),[]);
 ok(await core.call(snapshot));assert.deepEqual(owed(await debt(core)),[[[41,41]]]);
 assert.ok(batches.some(batch=>batch.some(c=>c.s==='r')&&batch.some(c=>c.s==='m'&&c.k.startsWith('device:delivery:'))));
 await core.close();core=await opener.open('delivery-web',null);assert.deepEqual(owed(await debt(core)),[[[41,41]]]);
});

test('wasm activation excludes predictions and withdrawal persists only restored ids',async t=>{
 const opener=webDevice({wasm,persist:memoryPersistence()});const core=await opener.open('delivery-web-prediction',backend);t.after(()=>core.close());
 ok(await core.call(snapshot));ok(await core.call({op:'predict',name:'edit',viewer:'dev:alice',args:{messageId:'m',body:'pending'},now:100}));
 ok(await core.call({op:'delivery',viewer:'dev:alice',action:'enumerate',now:100}));assert.deepEqual(owed(await debt(core)),[]);
 ok(await core.call({op:'withdraw',predicted:['messages/m']}));assert.deepEqual(owed(await debt(core)),[[[41,41]]]);
});

for(const older of [false,true])test(`client manifest-only binding keeps its fallback debt through device adoption (older binding: ${older})`,async t=>{
 const initial=structuredClone(backend);if(older)initial.schema.delivery[0].fingerprint='older';else initial.schema.delivery=[];
 const core=await webDevice({wasm,persist:memoryPersistence()}).open('manifest-adoption',initial);t.after(()=>core.close());
 const read=ok(await core.call({op:'delivery',viewer:'dev:alice',action:'read'}));
 const state=emptyDelivery();acceptManifest(state,[{...backend.schema.delivery[0],rows:[['c1',41]]}],4096);
 assert.equal(state.bindings[0].group,undefined,'the manifest representation has no compiled columns');
 ok(await core.call({op:'delivery',viewer:'dev:alice',action:'write',expected:read.value,value:JSON.stringify(state)}));
 assert.deepEqual((await debt(core)).groups,state.groups,'older-schema reads preserve manifest-only debt');
 const publication=structuredClone(snapshot);for(const e of publication.page.events)if(e.table==='messages')e.data.at=43;
 ok(await core.call(publication));
 assert.deepEqual((await debt(core)).groups,state.groups,'old compiled rows cannot enter new manifest debt');
 ok(await core.call({op:'adopt',backend}));
 const adopted=await debt(core);assert.deepEqual(adopted.groups,state.groups);
 assert.equal(adopted.bindings[0].group,'conversationId');
 ok(await core.call({...snapshot,page:{...snapshot.page,events:[]}}));
 assert.deepEqual((await debt(core)).groups,state.groups);
 ok(await core.call({op:'adopt',backend:initial}));
 assert.deepEqual((await debt(core)).groups,{},'removal after compiled adoption drops the debt');
});

test('a failed wasm activation save retries the device cursor without skipping its page',async t=>{
 const memory=memoryPersistence();let fail=false,failedCursor;
 const persist={...memory,async save(name,changes){
  const saved=changes.find(c=>c.s==='m'&&c.k.startsWith('device:delivery:'));
  if(fail&&saved){fail=false;failedCursor=JSON.parse(saved.v).cursors;throw Error('failed after cursor advanced');}
  return memory.save(name,changes);
 }};
 const core=await webDevice({wasm,persist}).open('cursor-failure',backend);t.after(()=>core.close());
 const sample=snapshot.page.events.find(e=>e.table==='messages');
 const events=[...snapshot.page.events.filter(e=>e.table!=='messages'),...Array.from({length:501},(_,i)=>({
  ...sample,id:`row${i}`,data:{...sample.data,id:`row${i}`,at:i+1},
 }))];
 ok(await core.call({...snapshot,page:{...snapshot.page,events}}));
 // No registered viewer during publication: the cursor is the only collector.
 const enumerate={op:'delivery',viewer:'dev:alice',action:'enumerate',now:100};
 fail=true;await assert.rejects(core.call(enumerate),/failed after cursor advanced/);
 assert.ok(Object.values(failedCursor).some(c=>c.after&&c.done===false),'failure follows the actual device cursor advance');
 const rolledBack=await debt(core);assert.deepEqual(rolledBack.cursors,{});assert.deepEqual(owed(rolledBack),[]);
 ok(await core.call(enumerate));assert.deepEqual(owed(await debt(core)),[[[1,500]]]);
 ok(await core.call(enumerate));assert.deepEqual(owed(await debt(core)),[[[1,501]]]);
 assert.equal(ok(await core.call(enumerate)).more,false);
});

test('a JSON-normalizing adapter cannot strip the conditional host commit guard',async t=>{
 const memory=memoryPersistence();let release,started;
 const held=new Promise(r=>release=r),writing=new Promise(r=>started=r);
 const isDebt=changes=>changes.some(c=>c.s==='m'&&c.k.startsWith('device:delivery:')&&c.v&&Object.keys(JSON.parse(c.v).groups).length);
 const persist={...memory,
  async save(name,changes){if(isDebt(changes)){started();await held;}return memory.save(name,changes);},
  async saveIfCurrent(name,changes,current){started();await held;return memory.saveIfCurrent(name,changes,current);},
 };
 const core=await webDevice({wasm,persist}).open('normalized-guard',backend);
 t.after(async()=>{release();await core.close();});
 const adapter={...core,call:request=>core.call(JSON.parse(JSON.stringify(request)))};
 const read=ok(await adapter.call({op:'delivery',viewer:'dev:alice',action:'read'}));
 const state=emptyDelivery();acceptManifest(state,[{...backend.schema.delivery[0],rows:[['c1',41]]}],4096);
 let current=true;
 const write=adapter[deliveryCommit]({op:'delivery',viewer:'dev:alice',action:'write',expected:read.value,value:JSON.stringify(state)},()=>current);
 await writing;current=false;release();await write;
 assert.deepEqual(owed(await debt(core)),[]);
});


test('local activation resumes a real blocked wasm page after reports free capacity and collects the rest',async t=>{
 const core=await webDevice({wasm,persist:memoryPersistence()}).open('blocked-activation',backend);
 const sample=snapshot.page.events.find(e=>e.table==='messages');
 const events=[...snapshot.page.events.filter(e=>e.table!=='messages'),...Array.from({length:300},(_,i)=>({
  ...sample,id:`row${i}`,data:{...sample.data,id:`row${i}`,at:(i+1)*2},
 }))];
 // Publish before registering a delivery viewer: activation must collect these.
 ok(await core.call({...snapshot,page:{...snapshot.page,events}}));
 let release;const held=new Promise(r=>release=r),reports=[],pages=[];
 const q=localDelivery({viewer:'dev:alice',url:'http://x',backend:()=>backend,
  ready:()=>true,current:()=>true,credentials:()=>({headers:{},revision:0}),refresh:()=>null,
  capture:async()=>({watermark:1,send_revision:0,store_id:'S'}),witness:async()=>false,restored:()=>false,replaced:()=>{},auth:async()=>{},now:()=>100,
  call:async r=>{const reply=await core.call(r);if(r.action==='enumerate')pages.push(ok(reply));return reply;},
  collect:(r,current)=>core[deliveryCommit](r,current),
  fetch:async(_,init)=>{reports.push(JSON.parse(init.body).args);if(reports.length===1)await held;return Response.json({state:'sent',head:1,store_id:'S'});},
 });
 t.after(async()=>{release();await q.stop();await core.close();});
 const until=async fn=>{ return awaitState(fn); };
 await q.open();await until(()=>reports.length===1);
 assert.ok(pages.some(p=>p.blocked===true));assert.equal(reports[0].from,2);
 release();await until(()=>reports.length===300&&pages.at(-1)?.more===false);
 assert.deepEqual(reports.map(r=>[r.from,r.through]),Array.from({length:300},(_,i)=>[(i+1)*2,(i+1)*2]));
 assert.ok(pages.length>1,'a blocked page cannot complete activation');
});

test('memory conditional commit stays in the passing fence turn when its next microtask invalidates it',async()=>{
 const persist=memoryPersistence();let current=true,checks=0,atFlip;
 const accepted=await persist.saveIfCurrent('commit-gap',[{s:'m',k:'delivery',v:'debt'}],()=>{
  checks++;queueMicrotask(()=>{atFlip=persist.stores.get('commit-gap')?.get('m delivery')?.v;current=false;});return current;
 });
 assert.equal(checks,1);assert.equal(current,false);
 assert.equal(atFlip,'debt','memory commit must precede the queued fence change');assert.equal(accepted,true);
 assert.equal(await persist.saveIfCurrent('commit-gap',[{s:'m',k:'delivery',v:'stale'}],()=>current),false);
 assert.equal(await persist.read('commit-gap','m','delivery'),'debt');
});
