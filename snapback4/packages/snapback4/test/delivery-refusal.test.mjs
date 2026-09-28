import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {DeliveryQueue, memoryDelivery} from '../dist/delivery.js';
import {acceptManifest, deliveryKey} from '../dist/delivery-state.js';
import {webDevice, memoryPersistence} from '../dist/web.js';
import {wasm, backend, snapshot} from './helpers/delivery-fixture.mjs';
const binding={fingerprint:'fixture:messages',table:'messages',mutation:'delivered',args:['conversation','from','through']};
const success={accepted:true,json:{state:'sent',head:10,store_id:'S'}};
const manifest=(positions,b=binding)=>[{...b,rows:positions.map(n=>['c',n])}];
const settle=async()=>{for(let i=0;i<8;i++)await turn();};
function fixture(t,reply,storage=memoryDelivery()) {
 t.mock.timers.enable({apis:['setTimeout']});
 const calls=[],refused=[];let now=0,minted=0,outcome=reply;
 const open=()=>new DeliveryQueue({storage,local:true,now:()=>now,jitter:()=>0,ready:()=>true,mint:()=>`report-${++minted}`,
  send:async(_,body)=>{calls.push(body);return body.args.from===41?outcome:success;},onRefused:e=>refused.push(e)});
 let q=open();t.after(()=>q.stop());
 return {get q(){return q;},calls,refused,storage,succeed(){outcome=success;},
  async restart(){await q.stop();q=open();await q.start();},
  async flush(){await q.pump();await settle();},
  async tick(ms){now+=ms;t.mock.timers.tick(ms);await settle();await q.pump();await settle();},
  group:()=>storage.update(s=>structuredClone(s.groups[deliveryKey(binding,'c')])),
  collect:(positions=[41])=>q.accept(manifest(positions))};
}
const replies={
 why:{accepted:true,json:{state:'failed',why:{code:'E_BOUND'},head:10,store_id:'S'}},
 denied:{accepted:true,json:{denied:{code:'E_BOUND'},head:10,store_id:'S'}},
 headless:{accepted:false,json:{denied:{code:'E_BOUND'}}},
};
for(const [envelope,reply] of Object.entries(replies)) {
 test(`${envelope}: E_BOUND parks until start and calls onDeliveryRefused exactly once`,async t=>{
  const h=fixture(t,reply);await h.collect();await h.flush();
  const group=await h.group();assert.deepEqual(group.parked.map(p=>[p.kind,p.run]),[['start',[41,41]]]);
  assert.equal(group.attempt,undefined);assert.deepEqual(group.owed,[]);assert.deepEqual(group.refused,[]);
  assert.deepEqual(h.refused,[{...binding,group:'c',from:41,through:41,why:{code:'E_BOUND'}}]);
  await h.collect();await h.flush();assert.equal(h.refused.length,1);assert.equal(h.calls.length,1);
 });
 test(`${envelope}: next start sends the refused report with a new id and succeeds`,async t=>{
  const h=fixture(t,reply);await h.collect();await h.flush();h.succeed();
  await h.restart();await h.flush();assert.equal(h.calls.length,2);assert.notEqual(h.calls[0].id,h.calls[1].id);
  assert.deepEqual(h.calls[0].args,h.calls[1].args);assert.deepEqual((await h.group()).reported,[[41,41]]);
  assert.deepEqual((await h.group()).parked,[]);assert.equal(h.refused.length,1);
 });
 test(`${envelope}: no E_BOUND retry during the session on time, reconnect, publication or recollection`,async t=>{
  const h=fixture(t,reply);await h.collect();await h.flush();
  for(let n=0;n<3;n++){
   await h.tick(660000);await h.q.reconnect();h.q.available();h.q.published();await h.collect();await h.flush();
  }
  assert.equal(h.calls.length,1);assert.equal(h.refused.length,1);
 });
 for(const pressure of ['interval','group'])test(`${envelope}: multi-position refusal survives ${pressure} eviction with adjacent clean coverage`,async t=>{
  const h=fixture(t,reply);await h.collect([41,42,43]);await h.flush();
  assert.deepEqual(h.calls.map(c=>c.args),[{conversation:'c',from:41,through:43}]);
  assert.deepEqual(h.refused,[{...binding,group:'c',from:41,through:43,why:{code:'E_BOUND'}}]);
  if(pressure==='interval'){
   await h.collect(Array.from({length:256},(_,i)=>100+i*2));
   assert.deepEqual((await h.group()).parked,[],'the whole refused park was evicted');
   for(let n=0;n<256;n++)await h.flush();
  } else {
   await h.storage.update(s=>acceptManifest(s,[{...binding,rows:[['other',1]]}],1));
   assert.equal(await h.group(),undefined,'the whole refused group was evicted');
   await h.flush();
  }
  const before=h.calls.length;
  await h.collect([41,42,43,44]);await h.flush();await h.flush();
  assert.deepEqual(h.calls.slice(before).map(c=>c.args),[{conversation:'c',from:44,through:44}],
   'only adjacent clean coverage may send before start');
  assert.deepEqual((await h.group()).parked.map(p=>[p.kind,p.run]),[['start',[41,43]]]);
  assert.deepEqual((await h.group()).refused,[]);assert.equal(h.refused.length,1);
  h.succeed();await h.q.start();await h.flush();
  assert.deepEqual(h.calls.at(-1).args,{conversation:'c',from:41,through:43});
  assert.notEqual(h.calls.at(-1).id,h.calls[0].id);assert.equal(h.refused.length,1);
  assert.deepEqual((await h.group()).parked,[]);
 });
 test(`${envelope}: reset(false) preserves refusal suppression until start`,async t=>{
  const h=fixture(t,reply);await h.collect();await h.flush();
  await h.q.reset(false);
  await h.storage.update(s=>acceptManifest(s,[{...binding,rows:[['other',1]]}],1));
  assert.equal(await h.group(),undefined,'recollection cannot rely on the persisted park');
  await h.flush();const before=h.calls.length;
  await h.collect([41,42]);await h.flush();await h.flush();
  assert.deepEqual(h.calls.slice(before).map(c=>c.args),[{conversation:'c',from:42,through:42}]);
  assert.equal(h.refused.length,1);h.succeed();await h.q.start();await h.flush();
  assert.deepEqual(h.calls.at(-1).args,{conversation:'c',from:41,through:41});
  assert.notEqual(h.calls.at(-1).id,h.calls[0].id);assert.equal(h.refused.length,1);
  assert.deepEqual((await h.group()).parked,[]);
 });
 for(const pressure of ['interval','group'])test(`${envelope}: ${pressure} eviction and recollection cannot resend before start`,async t=>{
  const h=fixture(t,reply);await h.collect();await h.flush();
  if(pressure==='interval'){
   await h.collect(Array.from({length:256},(_,i)=>100+i*2));
   assert.deepEqual((await h.group()).parked,[],'the start park was actually evicted');
   // Drain pressure through successful reports; do not hide collection behavior.
   for(let n=0;n<256;n++)await h.flush();
  } else {
   await h.storage.update(s=>{
    acceptManifest(s,[{...binding,rows:[['other',1]]}],1);
    assert.equal(s.groups[deliveryKey(binding,'c')],undefined,'the whole group was actually evicted');
    acceptManifest(s,manifest([41]),1);
   });
  }
  await h.collect([41,42]);await h.flush();await h.flush();
  assert.equal(h.calls.filter(c=>c.args.from===41).length,1,'recollection must not resend the refused interval');
  assert.ok(h.calls.some(c=>c.args.from===42&&c.args.through===42),'adjacent clean coverage still reports');
  assert.equal(h.refused.length,1);assert.deepEqual((await h.group()).refused,[]);
  h.succeed();await h.restart();await h.flush();
  const attempts=h.calls.filter(c=>c.args.from===41);assert.equal(attempts.length,2);assert.notEqual(attempts[0].id,attempts[1].id);
  assert.deepEqual((await h.group()).owed,[]);assert.deepEqual((await h.group()).parked,[]);
 });
}

test('ordinary E_INPUT refusal has the same eviction and next-start behavior',async t=>{
 const h=fixture(t,{accepted:true,json:{state:'failed',why:{code:'E_INPUT'},head:10}});
 await h.collect();await h.flush();
 await h.storage.update(s=>{acceptManifest(s,[{...binding,rows:[['other',1]]}],1);acceptManifest(s,manifest([41]),1);});
 await h.flush();assert.equal(h.calls.length,1);assert.equal(h.refused.length,1);
 h.succeed();await h.q.start();await h.flush();assert.equal(h.calls.length,2);assert.notEqual(h.calls[0].id,h.calls[1].id);
});

test('wasm publication eviction and recollection preserve the start-only refusal',async t=>{
 const core=await webDevice({wasm,persist:memoryPersistence()}).open('start-refusal',backend);t.after(()=>core.close());
 const ok=r=>{assert.ok(!r.denied,JSON.stringify(r));return r.ok;};
 ok(await core.call(JSON.parse(JSON.stringify(snapshot).replaceAll('"c1"','"c"'))));
 const storage={async update(edit){
  const read=ok(await core.call({op:'delivery',viewer:'dev:alice',action:'read'}));
  const state=JSON.parse(read.value),result=edit(state);
  assert.equal(ok(await core.call({op:'delivery',viewer:'dev:alice',action:'write',expected:read.value,value:JSON.stringify(state)})),true);
  return result;
 },async clear(){assert.fail('unexpected clear');}};
 const sample=snapshot.page.events.find(e=>e.table==='messages');let seq=1;
 const publish=async positions=>ok(await core.call({op:'apply',first:false,page:{snapshot:false,watermark:++seq,more:false,
  events:positions.map(n=>({...sample,id:`pressure-${n}`,data:{...sample.data,id:`pressure-${n}`,conversationId:'c',at:n}})),
 }}));
 const h=fixture(t,replies.why,storage);await h.collect();await h.flush();
 await publish(Array.from({length:256},(_,i)=>100+i*2));assert.deepEqual((await h.group()).parked,[]);
 for(let n=0;n<256;n++)await h.flush();
 await publish([41,42]);h.q.published();await h.flush();await h.flush();
 assert.equal(h.calls.filter(c=>c.args.from===41).length,1);assert.equal(h.refused.length,1);
 assert.ok(h.calls.some(c=>c.args.from===42));h.succeed();await h.restart();await h.flush();
 assert.equal(h.calls.filter(c=>c.args.from===41).length,2);assert.deepEqual((await h.group()).owed,[]);assert.deepEqual((await h.group()).parked,[]);
});

test('a retried refusal CAS notifies once after commit',async t=>{
 let state={serial:0,groups:{},retired:{}};
 const storage={async update(edit){edit(structuredClone(state));return edit(state);},async clear(){state={serial:0,groups:{},retired:{}};}};
 const h=fixture(t,replies.why,storage);await h.collect();await h.flush();assert.equal(h.calls.length,1);assert.equal(h.refused.length,1);
});

test('start-only suppression is scoped by fingerprint, group and store',async t=>{
 const h=fixture(t,replies.why);await h.collect();await h.flush();h.succeed();
 await h.q.accept([{...binding,rows:[['other',41]]}]);await h.flush();assert.equal(h.calls.at(-1).args.conversation,'other');
 await h.q.accept(manifest([41],{...binding,fingerprint:'new-definition'}));await h.flush();
 assert.equal(h.calls.at(-1).delivery.fingerprint,'new-definition');
 await h.q.reset(true);await h.collect();await h.flush();assert.equal(h.calls.length,4);
});

for(const code of ['E_STORE_RESTORE','E_STORE_REPLACED'])test(`${code} takes precedence over a report's original refusal`,async t=>{
 const h=fixture(t,{accepted:false,json:{state:'failed',why:{code:'E_BOUND'},denied:{code},head:1}});
 await h.collect();await h.flush();assert.equal(await h.group(),undefined);assert.equal(h.refused.length,0);
});
