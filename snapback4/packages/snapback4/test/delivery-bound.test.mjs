import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {DeliveryQueue, memoryDelivery} from '../dist/delivery.js';
import {acceptManifest, deliveryKey} from '../dist/delivery-state.js';
import {webDevice, memoryPersistence} from '../dist/web.js';
import {wasm, backend, snapshot} from './helpers/delivery-fixture.mjs';
const binding={fingerprint:'fixture:messages',table:'messages',mutation:'delivered',args:['conversation','from','through']};
const success={accepted:true,json:{state:'sent',head:10}};
const bound={accepted:true,json:{state:'failed',why:{code:'E_BOUND'},head:10}};
const denied={accepted:true,json:{denied:{code:'E_BOUND'},head:10}};
const settle=async()=>{for(let i=0;i<8;i++)await turn();};
function fixture(t,send,storage=memoryDelivery()) {
 t.mock.timers.enable({apis:['setTimeout']});
 const calls=[],refused=[];let now=0,minted=0;
 const open=()=>new DeliveryQueue({storage,local:true,now:()=>now,jitter:()=>0,ready:()=>true,mint:()=>`bound-${++minted}`,
  send:async(_,body)=>{calls.push(body);return send(body);},onRefused:e=>refused.push(e)});
 let q=open();t.after(()=>q.stop());
 return {get q(){return q;},async restart(){await q.stop();q=open();await q.start();},calls,refused,storage,get now(){return now;},advance:n=>{now+=n;},async flush(){await q.pump();await settle();},
  group:()=>storage.update(s=>structuredClone(Object.values(s.groups)[0])),
  collect:()=>q.accept([{...binding,rows:[['c',41]]}])};
}
async function exhaust(h) {
 await h.collect();await h.flush();
 for(let n=0;n<40&&(await h.group()).attempt;n++){h.advance(60000);await h.flush();}
 assert.equal((await h.group()).parked[0]?.kind,'bound','exhaustion parks without application refusal');
 assert.equal(h.refused.length,0);
 assert.equal(new Set(h.calls.map(c=>c.id)).size,9,'initial id plus eight new-id retries');
}
test('E_BOUND backlog fails twice then succeeds on the third id, after same-id replays and backoff',async t=>{
 const ids=new Set();const h=fixture(t,body=>{ids.add(body.id);return ids.size<3?bound:success;});
 await h.collect();await h.flush();assert.equal((await h.group()).attempt.readyAt,1000);
 h.advance(999);await h.flush();assert.equal(h.calls.length,1);
 h.advance(1);await h.flush();assert.equal(h.calls[1].id,h.calls[0].id,'first failure is replayed');
 assert.equal((await h.group()).attempt.readyAt,h.now+1000);
 h.advance(1000);await h.flush();assert.notEqual(h.calls[2].id,h.calls[0].id);
 h.advance(1000);await h.flush();assert.equal(h.calls[3].id,h.calls[2].id);
 assert.equal((await h.group()).attempt.readyAt,h.now+2000);
 h.advance(1999);await h.flush();assert.equal(h.calls.length,4);
 h.advance(1);await h.flush();assert.equal(ids.size,3);assert.deepEqual((await h.group()).reported,[[41,41]]);
 assert.deepEqual(h.refused,[]);
});
test('a committed report answered denied E_BOUND replays its receipt without a second execution',async t=>{
 const receipts=new Map();let executions=0;
 const h=fixture(t,body=>{if(receipts.has(body.id))return receipts.get(body.id);executions++;receipts.set(body.id,success);return denied;});
 await h.collect();await h.flush();h.advance(1000);await h.flush();
 assert.equal(executions,1);assert.equal(h.calls.length,2);assert.equal(h.calls[0].id,h.calls[1].id);
 assert.deepEqual((await h.group()).reported,[[41,41]]);assert.equal((await h.group()).attempt,undefined);
});
for(const reply of [denied,{accepted:true,json:{why:{code:'E_BOUND',retryable:true},head:10}}])
 test(`E_BOUND without a failed receipt stays uncertain (${reply.json.denied?'denied':'bare why'})`,async t=>{
  const h=fixture(t,()=>reply);await h.collect();
  for(let n=0;n<9;n++){await h.flush();h.advance(60000);}
  assert.equal(h.calls.length,9);assert.equal(new Set(h.calls.map(c=>c.id)).size,1);
  assert.equal((await h.group()).parked[0]?.kind,'retry');assert.equal(h.refused.length,0);
  await h.q.reconnect();await h.flush();assert.equal(h.calls.at(-1).id,h.calls[0].id);
 });
test('E_BOUND burst parks; one new id per coalesced wake, at least 30 seconds apart, without resetting the burst',async t=>{
 const h=fixture(t,()=>bound);await exhaust(h);const count=h.calls.length;
 await h.q.reconnect();await h.q.reconnect();h.advance(29999);await h.flush();assert.equal(h.calls.length,count);
 h.advance(1);await h.flush();assert.equal(h.calls.length,count+1);assert.notEqual(h.calls.at(-1).id,h.calls[count-1].id);
 h.advance(1000);await h.flush();assert.equal(h.calls.at(-1).id,h.calls[count].id);
 assert.equal((await h.group()).parked[0]?.kind,'bound');assert.equal(h.refused.length,0);
 h.advance(60000);await h.collect();await h.flush();assert.equal(h.calls.length,count+2,'a manifest does not restart the burst');
 await h.q.wake('timer');await h.flush();assert.equal(h.calls.length,count+3);
 assert.equal((await h.group()).bound.retries,8);assert.equal((await h.group()).bound.wakes,2);
});
for(const collector of ['manifest','device'])test(`E_BOUND wake cap survives ${collector} eviction, recollection and restart with one refusal`,async t=>{
 const device=collector==='device'?await deviceStorage(t):null;
 const h=fixture(t,body=>body.args.from===41?bound:success,device?.storage);await exhaust(h);
 for(let n=1;n<=8;n++){
  h.advance(30000);await h.q.wake(n%2?'reconnect':'start');await h.flush();
  h.advance(1000);await h.flush();
  assert.equal(new Set(h.calls.map(c=>c.id)).size,9+n);
  assert.equal(h.refused.length,n===8?1:0);
 }
 assert.equal((await h.group()).parked[0]?.kind,'stopped');
 assert.deepEqual(h.refused.map(e=>[e.why.code,e.from,e.through]),[['E_BOUND',41,41]]);
 assert.deepEqual((await h.group()).refused,[[41,41]],'terminal suppression is outside the evictable debt');
 const pressure=Array.from({length:256},(_,i)=>100+i*2);
 if(device)await device.collect(pressure);else await h.q.accept([{...binding,rows:pressure.map(n=>['c',n])}]);
 assert.equal((await h.group()).parked.length,0,'the stopped park is evicted');
 for(let n=0;n<256;n++)await h.flush();
 assert.deepEqual((await h.group()).owed,[],'newer runs drain successfully');
 if(device)await device.collect([41]);else await h.collect();
 await h.flush();
 assert.deepEqual((await h.group()).owed,[],'recollection cannot start another bound budget');
 assert.equal(new Set(h.calls.filter(c=>c.args.from===41).map(c=>c.id)).size,17);
 assert.equal(h.refused.length,1);
 // Whole-group pressure also keeps suppression. The device's own group cap
 // is covered on both native stores in delivery.rs.
 await h.storage.update(s=>{acceptManifest(s,[{...binding,rows:[['other',1]]}],1);acceptManifest(s,[{...binding,rows:[['c',41]]}],1);});
 assert.deepEqual((await h.group()).refused,[[41,41]]);
 const count=h.calls.length;await h.q.stop();
 // New queue over the same serialized state, with its own minting counter.
 let saved;await h.storage.update(s=>{saved=JSON.stringify(s);});
 let state=JSON.parse(saved);const storage={async update(edit){const result=edit(state);state=JSON.parse(JSON.stringify(state));return result;},async clear(){throw Error('unexpected clear');}};
 const resumed=new DeliveryQueue({storage,local:true,mint:()=>{assert.fail('wake cap must persist');},ready:()=>true,send:()=>{assert.fail('stopped debt must not dispatch');},now:()=>1e9});
 t.after(()=>resumed.stop());await resumed.start();await resumed.reconnect();await resumed.wake('timer');await resumed.accept([{...binding,rows:[['c',41]]}]);await resumed.pump();await settle();
 assert.equal(h.calls.length,count);assert.deepEqual((await storage.update(s=>Object.values(s.groups)[0])).refused,[[41,41]]);
});


test('restarting a parked E_BOUND resumes only one wake and preserves the burst count',async t=>{
 let state={serial:0,groups:{},retired:{}};
 const storage={async update(edit){const result=edit(state);state=JSON.parse(JSON.stringify(state));return result;},async clear(){throw Error('unexpected clear');}};
 const h=fixture(t,()=>bound,storage);await exhaust(h);const count=h.calls.length;
 h.advance(30000);await h.restart();await h.flush();
 assert.equal(h.calls.length,count+1);assert.equal((await h.group()).bound.retries,8);
 assert.equal((await h.group()).bound.wakes,1);
 h.advance(1000);await h.flush();assert.equal((await h.group()).parked[0]?.kind,'bound');
 h.advance(60000);await h.flush();assert.equal(h.calls.length,count+2,'start did not grant another burst');
});
test('the actual ten-minute timer wakes an exhausted E_BOUND interval',async t=>{
 const h=fixture(t,()=>bound);await exhaust(h);const count=h.calls.length;
 h.advance(600000);t.mock.timers.tick(600000);await settle();await h.flush();
 assert.equal(h.calls.length,count+1);assert.equal((await h.group()).bound.wakes,1);
});

test('one bound wake is consumed once even when its success or new manifests wake the group again',async t=>{
 const h=fixture(t,()=>success);await h.collect();
 await h.storage.update(s=>{const g=Object.values(s.groups)[0];g.bound={retries:8,wakes:0,runs:[[41,41],[43,43]],at:0};g.owed=[];g.parked=[41,43].map(n=>({
  run:[n,n],kind:'bound',at:0,attempt:{id:`old-${n}`,run:[n,n],retries:0,readyAt:0,boundReplay:true},
 }));});
 h.advance(30000);await h.q.wake('timer');await h.flush();await h.flush();
 assert.equal(h.calls.length,1,'a success cannot spend the same bound wake twice');
 await h.q.accept([{...binding,rows:[['c',43]]}]);await h.flush();assert.equal(h.calls.length,1,'neither can a later manifest');
 h.advance(30000);await h.q.wake('timer');await h.flush();assert.equal(h.calls.length,2);
});

// Real device publication exercises Rust's interval trim, using the queue's
// own persisted terminal state rather than a hand-authored stopped fixture.
async function deviceStorage(t) {
 const core=await webDevice({wasm,persist:memoryPersistence()}).open('bound-lifetime',backend);
 t.after(()=>core.close());
 const ok=r=>{assert.ok(!r.denied,JSON.stringify(r));return r.ok;};
 ok(await core.call(JSON.parse(JSON.stringify(snapshot).replaceAll('"c1"','"c"'))));
 const storage={async update(edit){
  const read=ok(await core.call({op:'delivery',viewer:'dev:alice',action:'read'}));
  const state=JSON.parse(read.value),result=edit(state);
  assert.equal(ok(await core.call({op:'delivery',viewer:'dev:alice',action:'write',expected:read.value,value:JSON.stringify(state)})),true);
  return result;
 },async clear(){assert.fail('unexpected clear');}};
 const sample=snapshot.page.events.find(e=>e.table==='messages');let seq=1;
 return {storage,async collect(positions){ok(await core.call({op:'apply',first:false,page:{
  snapshot:false,watermark:++seq,more:false,events:positions.map(n=>({...sample,id:`pressure-${n}`,data:{...sample.data,id:`pressure-${n}`,conversationId:'c',at:n}})),
 }}));}};
}

for(const wake of ['reconnect','start','timer'])test(`a due bound park cannot replace an attempt in backoff on ${wake}`,async t=>{
 const h=fixture(t,()=>success);await h.collect();
 const attempt={id:'committed-1',run:[1,1],retries:1,readyAt:61000,boundReplay:true};
 await h.storage.update(s=>{const g=Object.values(s.groups)[0];g.owed=[[1,1]];g.attempt=structuredClone(attempt);g.bound={retries:2,wakes:0,runs:[[1,1],[41,41]],at:0};
  g.parked=[{kind:'bound',run:[41,41],at:0,attempt:{id:'old-41',run:[41,41],retries:0,readyAt:0,boundReplay:true}}];});
 h.advance(60000);if(wake==='start')await h.q.start();else if(wake==='reconnect')await h.q.reconnect();else await h.q.wake('timer');
 await h.flush();assert.equal(h.calls.length,0,'the due park waits behind the held replay');
 assert.deepEqual((await h.group()).attempt,attempt);
 assert.equal((await h.group()).parked[0].ready,true);
 h.advance(1000);await h.flush();assert.equal(h.calls[0].id,'committed-1');
 await h.flush();assert.equal(h.calls[1].args.from,41);
 assert.notEqual(h.calls[1].id,'old-41');assert.deepEqual((await h.group()).reported,[[1,1],[41,41]]);
});

test('transport exhaustion and serialized restart retain a partially spent bound budget and cumulative id cap',async t=>{
 let state={serial:0,groups:{},retired:{}},transport=false;
 const storage={async update(edit){const result=edit(state);state=JSON.parse(JSON.stringify(state));return result;},async clear(){assert.fail('unexpected clear');}};
 const h=fixture(t,()=>{if(transport)throw Error('lost transport');return bound;},storage);
 await h.collect();await h.flush();
 // Spend three burst ids, without exhausting the burst.
 for(let n=0;((await h.group()).bound?.retries??0)<3&&n<20;n++){h.advance(60000);await h.flush();}
 assert.equal((await h.group()).bound.retries,3);
 transport=true;
 for(let n=0;(await h.group()).attempt&&n<10;n++){h.advance(60000);await h.flush();}
 let park=(await h.group()).parked[0];assert.equal(park.kind,'retry');
 assert.equal((await h.group()).bound.retries,3);const heldId=park.attempt.id;
 transport=false;await h.restart();await h.flush();
 assert.equal(h.calls.at(-1).id,heldId,'uncertain transport keeps its id');
 assert.equal((await h.group()).bound.retries,3,'start cannot replenish the burst');
 for(let n=0;(await h.group()).attempt&&n<40;n++){h.advance(60000);await h.flush();}
 assert.equal((await h.group()).parked[0].kind,'bound');
 // Spend two wakes, then lose transport on the third. Both counters must
 // survive this distinct retry park, too.
 for(let n=0;n<2;n++){h.advance(30000);await h.q.reconnect();await h.flush();h.advance(1000);await h.flush();}
 transport=true;h.advance(30000);await h.q.reconnect();await h.flush();
 for(let n=0;(await h.group()).attempt&&n<10;n++){h.advance(60000);await h.flush();}
 park=(await h.group()).parked[0];assert.equal(park.kind,'retry');assert.equal((await h.group()).bound.wakes,3);
 const wakeId=park.attempt.id;transport=false;await h.restart();await h.flush();
 assert.equal(h.calls.at(-1).id,wakeId);assert.equal((await h.group()).bound.wakes,3);
 h.advance(1000);await h.flush();
 for(let n=4;n<=8;n++){h.advance(30000);await h.q.reconnect();await h.flush();h.advance(1000);await h.flush();}
 assert.equal((await h.group()).parked[0].kind,'stopped');assert.equal(h.refused.length,1);
 assert.equal(new Set(h.calls.map(c=>c.id)).size,17,'transport/restart adds no bound ids');
 await h.restart();await h.collect();h.advance(600000);await h.q.wake('timer');await h.flush();
 assert.equal(new Set(h.calls.map(c=>c.id)).size,17);assert.equal(h.refused.length,1);
});

for(const location of ['attempt','bound','retry'])for(const pressure of ['interval','group'])
 test(`eviction preserves the group budget through ${location} (${pressure})`,async t=>{
 const h=fixture(t,()=>bound);await h.collect();
 await h.storage.update(s=>{const g=Object.values(s.groups)[0];g.bound={retries:2,wakes:1,runs:[[41,41]],at:0};
  const attempt={id:'held',run:[41,41],retries:2,readyAt:1e9,boundReplay:true};
  if(location==='attempt')g.attempt=attempt;else{g.owed=[];g.parked=[{run:[41,41],kind:location,at:0,attempt}];}
  if(pressure==='interval')acceptManifest(s,[{...binding,rows:Array.from({length:256},(_,i)=>['c',100+i*2])}],4096);
  else{acceptManifest(s,[{...binding,rows:[['other',1]]}],1);assert.equal(s.retired[deliveryKey(binding,'c')].fingerprint,binding.fingerprint);acceptManifest(s,[{...binding,rows:[['c',41]]}],1);}
 });
 assert.equal((await h.group()).saturated,false);
 assert.deepEqual((await h.group()).bound,{retries:2,wakes:1,runs:[[41,41]],at:0});
 // Remove only unrelated pressure debt, as successful reports would. The
 // budget's interval was evicted and is now recollected with its allowance.
 await h.storage.update(s=>{Object.values(s.groups)[0].owed=[];});
 await h.restart();await h.collect();h.advance(1e9);await h.flush();
 assert.equal((await h.group()).bound.retries,3,'recollection debits the existing group budget');
 for(let n=0;(await h.group()).attempt&&n<40;n++){h.advance(60000);await h.flush();}
 for(let n=2;n<=8;n++){h.advance(30000);await h.q.reconnect();await h.flush();h.advance(1000);await h.flush();}
 assert.equal(new Set(h.calls.map(c=>c.id)).size,13,'only the remaining six burst and seven wake ids');
 assert.equal(h.refused.length,1);
});


test('the terminal bound refusal obeys refused capacity and saturates without another callback',async t=>{
 const h=fixture(t,()=>bound);await h.collect();
 await h.storage.update(s=>{const g=Object.values(s.groups)[0];g.refused=Array.from({length:63},(_,i)=>[100+i*2,100+i*2]);
  g.bound={retries:8,wakes:8,runs:[[41,41]],at:0};g.attempt={id:'last',run:[41,41],retries:0,readyAt:0,boundReplay:true};});
 await h.flush();assert.equal((await h.group()).saturated,true);assert.equal((await h.group()).refused.length,64);
 assert.deepEqual((await h.group()).parked,[]);assert.equal(h.refused.length,1);
 await h.restart();await h.collect();await h.flush();assert.equal(h.calls.length,1);assert.equal(h.refused.length,1);
});

function serializedStorage() {
 let state={serial:0,groups:{},retired:{}};
 return {async update(edit){const result=edit(state);state=JSON.parse(JSON.stringify(state));return result;},async clear(){assert.fail('unexpected clear');}};
}
for(const kind of ['full','start'])test(`E_BOUND budget survives ${kind} cycles and serialized restart with at most 17 ids and one callback`,async t=>{
 let mode='bound';
 const h=fixture(t,()=>mode==='bound'?bound:{accepted:true,json:{state:'failed',why:{code:kind==='full'?'RUNS_FULL':'E_INPUT'},head:10}},serializedStorage());
 await exhaust(h);
 for(let cycle=0;cycle<10&&!h.refused.length;cycle++){
  mode=kind;h.advance(30000);await h.q.reconnect();await h.flush();
  if(h.refused.length)break;
  assert.equal((await h.group()).parked[0].kind,kind);
  const spent=(await h.group()).bound;
  assert.equal(spent?.retries,8);assert.equal(spent.wakes,cycle*2+1);
  mode='bound';await h.restart();await h.flush();
  assert.deepEqual((await h.group()).bound,spent,'start cannot replenish a parked budget');
  h.advance(30000);await h.flush();
  h.advance(1000);await h.flush();
 }
 assert.equal(new Set(h.calls.map(c=>c.id)).size,17);
 assert.deepEqual(h.refused.map(e=>[e.why.code,e.from,e.through]),[['E_BOUND',41,41]]);
 assert.deepEqual((await h.group()).refused,[[41,41]]);
 const count=h.calls.length;await h.restart();await h.collect();h.advance(600000);await h.q.wake('timer');await h.flush();
 assert.equal(h.calls.length,count);assert.equal(h.refused.length,1);
});
for(const code of ['E_CONFLICT','E_BUSY'])test(`E_BOUND to recorded ${code} to E_BOUND preserves and debits the group budget`,async t=>{
 let mode='bound';
 const h=fixture(t,()=>mode==='bound'?bound:{accepted:true,json:{state:'failed',why:{code,retryable:true},head:10}},serializedStorage());
 await h.collect();await h.flush();
 for(let n=0;((await h.group()).bound?.retries??0)<3&&n<20;n++){h.advance(60000);await h.flush();}
 assert.equal((await h.group()).bound.retries,3);
 mode='retryable';h.advance(60000);await h.flush();
 assert.equal((await h.group()).bound?.retries,4,'changing refusal type cannot discard the spent allowance');
 assert.equal((await h.group()).attempt.boundReplay,false,'a different id must establish its own replay');
 mode='bound';h.advance(60000);await h.flush();
 assert.equal((await h.group()).bound?.retries,4,'first E_BOUND on this id only replays');
 for(let n=0;(await h.group()).attempt&&n<40;n++){h.advance(60000);await h.flush();}
 for(let n=1;n<=8;n++){h.advance(30000);await h.q.reconnect();await h.flush();h.advance(1000);await h.flush();}
 assert.equal(new Set(h.calls.map(c=>c.id)).size,17);assert.equal(h.refused.length,1);
});
test('group accounting survives merge, split and unrelated success; only spending coverage clears it',async t=>{
 const h=fixture(t,()=>success,serializedStorage());await h.collect();
 await h.storage.update(s=>{const g=Object.values(s.groups)[0];g.bound={retries:3,wakes:2,runs:[[41,43]],at:0};g.owed=[[1,1],[41,43]];});
 await h.flush();assert.deepEqual((await h.group()).bound,{retries:3,wakes:2,runs:[[41,43]],at:0},'unrelated success cannot replenish');
 // The group's owed work can split while its accounting stays with the group.
 await h.storage.update(s=>{Object.values(s.groups)[0].owed=[[41,41],[43,43]];});
 h.advance(30000);await h.flush();
 assert.equal((await h.group()).bound.retries,4);assert.deepEqual((await h.group()).bound.runs,[[42,43]]);
 // A later collection merges the remainder. Only its successful coverage
 // finishes the spending interval and removes the record.
 await h.q.accept([{...binding,rows:[['c',42]]}]);await h.flush();
 assert.equal((await h.group()).bound,undefined);assert.deepEqual((await h.group()).reported,[[1,1],[41,43]]);
});
test('success after retired-budget restoration cannot resurrect a stale tombstone',async t=>{
 const h=fixture(t,()=>success,serializedStorage());await h.collect();
 await h.storage.update(s=>{Object.values(s.groups)[0].bound={retries:3,wakes:1,runs:[[41,41]],at:0};
  acceptManifest(s,[{...binding,rows:[['other',1]]}],1);acceptManifest(s,[{...binding,rows:[['c',41]]}],1);});
 h.advance(30000);await h.flush();assert.equal((await h.group()).bound,undefined);
 await h.storage.update(s=>{acceptManifest(s,[{...binding,rows:[['other',1]]}],1);acceptManifest(s,[{...binding,rows:[['c',43]]}],1);});
 assert.equal((await h.group()).bound,undefined,'successful budget is gone from the tombstone too');
});
for(const code of ['NOT_MEMBER','NOT_FOUND','NOT_A_RUN','PAST_LAST_MESSAGE'])test(`${code} cannot replenish a spent group budget`,async t=>{
 const h=fixture(t,()=>({accepted:true,json:{state:'failed',why:{code},head:10}}),serializedStorage());await h.collect();
 const budget={retries:3,wakes:1,runs:[[41,41]],at:0};
 await h.storage.update(s=>{const g=Object.values(s.groups)[0];g.bound=budget;g.attempt={id:'held',run:[41,41],retries:0,readyAt:0};});
 await h.flush();
 if(code==='NOT_MEMBER'||code==='NOT_FOUND')await h.collect();
 assert.deepEqual((await h.group()).bound,budget);
});

test('a second interval shares the exhausted burst and wake allowance',async t=>{
 const h=fixture(t,()=>bound,serializedStorage());await exhaust(h);
 await h.q.accept([{...binding,rows:[['c',43]]}]);await h.flush();h.advance(1000);await h.flush();
 assert.equal((await h.group()).bound.retries,8);assert.equal((await h.group()).bound.wakes,0);
 assert.deepEqual((await h.group()).bound.runs,[[41,41],[43,43]]);
 for(let n=1;n<=8;n++){
  h.advance(30000);await h.q.reconnect();await h.flush();h.advance(1000);await h.flush();
  assert.equal((await h.group()).bound.wakes,n,'both intervals debit the same wake count');
 }
 h.advance(30000);await h.q.reconnect();await h.flush();
 assert.equal(new Set(h.calls.map(c=>c.id)).size,18,'two initial ids and sixteen shared replacements');
 assert.deepEqual((await h.group()).refused,[[41,41],[43,43]]);assert.equal(h.refused.length,2,'one terminal callback per spending interval');
});

for(const kind of ['full','start'])test(`the last wake ending in ${kind} refuses immediately without waiting for another wake`,async t=>{
 let mode='bound';const h=fixture(t,()=>mode==='bound'?bound:{accepted:true,json:{state:'failed',why:{code:kind==='full'?'RUNS_FULL':'E_INPUT'},head:10}},serializedStorage());
 await exhaust(h);
 for(let n=1;n<8;n++){h.advance(30000);await h.q.reconnect();await h.flush();h.advance(1000);await h.flush();}
 mode=kind;h.advance(30000);await h.q.reconnect();await h.flush();
 assert.equal(new Set(h.calls.map(c=>c.id)).size,17);assert.equal(h.refused.length,1);
 assert.equal(h.refused[0].why.code,'E_BOUND');assert.deepEqual((await h.group()).refused,[[41,41]]);
 assert.equal((await h.group()).parked[0].kind,'stopped');
 await h.restart();await h.collect();h.advance(600000);await h.q.wake('timer');await h.flush();
 assert.equal(new Set(h.calls.map(c=>c.id)).size,17);assert.equal(h.refused.length,1);
});
