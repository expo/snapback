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

test('client manifest-only binding keeps its fallback debt through device adoption',async t=>{
 const initial=structuredClone(backend);initial.schema.delivery=[];
 const core=await webDevice({wasm,persist:memoryPersistence()}).open('manifest-adoption',initial);t.after(()=>core.close());
 const read=ok(await core.call({op:'delivery',viewer:'dev:alice',action:'read'}));
 const state=emptyDelivery();acceptManifest(state,[{...backend.schema.delivery[0],rows:[['c1',41]]}],4096);
 assert.equal(state.bindings[0].group,undefined,'the manifest representation has no compiled columns');
 ok(await core.call({op:'delivery',viewer:'dev:alice',action:'write',expected:read.value,value:JSON.stringify(state)}));
 ok(await core.call({op:'adopt',backend}));
 const adopted=await debt(core);assert.deepEqual(adopted.groups,state.groups);
 assert.equal(adopted.bindings[0].group,'conversationId');
 ok(await core.call({...snapshot,page:{...snapshot.page,events:[]}}));
 assert.deepEqual((await debt(core)).groups,state.groups);
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
