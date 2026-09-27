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
function fixture(t,send,storage=memoryDelivery(),local=true) {
 t.mock.timers.enable({apis:['setTimeout']});
 const calls=[],refused=[];let now=0,minted=0;
 const open=()=>new DeliveryQueue({storage,local,now:()=>now,jitter:()=>0,ready:()=>true,mint:()=>`bound-${++minted}`,
  send:async(_,body)=>{calls.push(body);return send(body);},onRefused:e=>refused.push(e)});
 let q=open();t.after(()=>q.stop());
 return {get q(){return q;},async restart(){await q.stop();q=open();await q.start();},calls,refused,storage,get minted(){return minted;},get now(){return now;},advance:n=>{now+=n;},async flush(){await q.pump();await settle();},
  group:()=>storage.update(s=>structuredClone(Object.values(s.groups)[0])),
  collect:()=>q.accept([{...binding,rows:[['c',41]]}])};
}
async function exhaust(h) {
 await h.collect();await h.flush();
 for(let n=0;n<40&&(await h.group()).attempt;n++){h.advance(60000);await h.flush();}
 assert.equal((await h.group()).parked[0]?.kind,'start','spent groups wait for the next session');
 assert.equal(h.refused.length,0);
 assert.deepEqual((await h.group()).refused,[]);
 assert.equal(new Set(h.calls.map(c=>c.id)).size,9,'initial id plus eight replacement ids');
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
test('a recorded conflict after a bound replay resets replay-first for the replacement id',async t=>{
 const replies=[denied,{accepted:true,json:{state:'failed',why:{code:'E_CONFLICT',retryable:true},head:10}},bound,success];
 const h=fixture(t,()=>{assert.ok(replies.length);return replies.shift();});
 await h.collect();await h.flush();h.advance(60000);await h.flush();
 assert.equal(h.minted,2,'the recorded conflict reserves id 2');
 h.advance(60000);await h.flush();assert.equal(h.minted,2,'id 2 must replay its own first bound result');
 h.advance(60000);await h.flush();
 assert.deepEqual(h.calls.map(c=>c.id),['bound-1','bound-1','bound-2','bound-2']);
 assert.deepEqual((await h.group()).reported,[[41,41]]);assert.deepEqual(h.refused,[]);
});
for(const timing of ['outstanding','headless'])for(const pressure of ['interval','group'])
 test(`bound replay marker survives ${pressure} eviction with ${timing} response`,async t=>{
  const receipts=new Map(),held=[];let recovered=false;
  const h=fixture(t,body=>{
   if(receipts.has(body.id))return receipts.get(body.id);
   receipts.set(body.id,success); // The report committed before its oversized answer.
   if(recovered)return success;
   return new Promise(resolve=>held.push(resolve));
  });
  for(let cycle=0;cycle<25;cycle++){
   await h.collect();await h.flush();
   if(timing==='headless'&&held.length){held.shift()({accepted:false,json:{denied:{code:'E_BOUND'}}});await settle();}
   if(pressure==='interval')await h.q.accept([{...binding,rows:Array.from({length:256},(_,i)=>['c',100+cycle*1000+i*2])}]);
   else await h.storage.update(s=>{
    acceptManifest(s,[{...binding,rows:[['other',1]]}],1);
    acceptManifest(s,[{...binding,rows:[['c',41]]}],1);
   });
   assert.equal((await h.group()).attempt,undefined,'collection pressure evicted the outstanding attempt');
   if(timing==='outstanding'&&held.length){
    const newer=await h.group();held.shift()(denied);await settle();
    assert.deepEqual(await h.group(),newer,'a stale bound outcome must not edit newer debt');
   }
   // Remove only the pressure fixture's debt so 41 can be recollected next turn.
   await h.storage.update(s=>{s.groups[deliveryKey(binding,'c')].owed=[];});
   h.advance(60000);
  }
  assert.equal(h.minted,1,'losing the required replay cannot issue fresh initial ids');
  assert.equal(new Set(h.calls.map(c=>c.id)).size,1);
  assert.equal(receipts.size,1,'only one report executed, with a success receipt available for replay');
  assert.deepEqual((await h.group()).refused,[]);assert.deepEqual(h.refused,[]);
  recovered=true;await h.collect();await h.restart();await h.flush();
  assert.deepEqual((await h.group()).reported,[[41,41]],'a new session recovers recollected debt');
 });
for(const fence of ['deadline','reset'])test(`a bound arriving after ${fence} still marks this session without editing newer debt`,async t=>{
 let finish;const h=fixture(t,()=>new Promise(resolve=>{finish=resolve;}));
 await h.collect();await h.flush();
 if(fence==='deadline'){h.advance(15000);t.mock.timers.tick(15000);await settle();}
 else {await h.q.reset(false);await settle();}
 await h.storage.update(s=>{
  acceptManifest(s,[{...binding,rows:[['other',1]]}],1);
  acceptManifest(s,[{...binding,rows:[['c',41]]}],1);
 });
 const newer=await h.group();finish(denied);await settle();
 assert.deepEqual(await h.group(),newer,'late transport observes only the session marker');
 h.advance(60000);await h.flush();assert.equal(h.minted,1);
 assert.deepEqual((await h.group()).parked.map(p=>[p.kind,p.run]),[['start',[41,41]]]);
 assert.deepEqual((await h.group()).refused,[]);assert.deepEqual(h.refused,[]);
});
test('the eighth replacement still replays a hidden committed success after the group allowance is spent',async t=>{
 const receipts=new Map();let executions=0;
 const h=fixture(t,body=>{
  if(receipts.has(body.id))return receipts.get(body.id);
  executions++;receipts.set(body.id,executions===9?success:bound);
  return executions===9?denied:bound;
 });
 await h.collect();await h.flush();
 for(let n=0;n<40&&(await h.group()).attempt;n++){h.advance(60000);await h.flush();}
 assert.equal(executions,9);assert.equal(h.minted,9);assert.deepEqual((await h.group()).reported,[[41,41]]);
 assert.equal(h.calls.at(-1).id,h.calls.at(-2).id,'spent allowance cannot block the required replay');
 assert.deepEqual((await h.group()).parked,[]);assert.equal(h.refused.length,0);
});
for(const reply of [denied,{accepted:true,json:{why:{code:'E_BOUND',retryable:true},head:10}}])
 test(`E_BOUND without a failed receipt stays uncertain (${reply.json.denied?'denied':'bare why'})`,async t=>{
  const h=fixture(t,()=>reply);await h.collect();
  for(let n=0;n<9;n++){await h.flush();h.advance(60000);}
  assert.equal(h.calls.length,9);assert.equal(new Set(h.calls.map(c=>c.id)).size,1);
  assert.equal((await h.group()).parked[0]?.kind,'retry');assert.equal(h.refused.length,0);
  await h.q.reconnect();await h.flush();assert.equal(h.calls.at(-1).id,h.calls[0].id);
 });
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


for(const local of [true,false])test(`${local?'local':'online'}: eight replacement ids per session, no bound refusal, restart grants a fresh allowance`,async t=>{
 let state={serial:0,groups:{},retired:{}};
 const storage={async update(edit){const result=edit(state);state=JSON.parse(JSON.stringify(state));return result;},async clear(){state={serial:0,groups:{},retired:{}};}};
 const h=fixture(t,()=>bound,storage,local);await exhaust(h);
 const count=h.calls.length;assert.equal(h.minted,9);
 assert.ok(!JSON.stringify(state).includes('"bound":'),'there is no persisted budget');
 for(const wake of ['reconnect','timer','start']){
  h.advance(600000);await h.q.wake(wake);await h.collect();await h.flush();
  assert.equal(h.calls.length,count,'wakes on this queue cannot replenish the allowance');
 }
 await h.restart();await h.flush();assert.equal(h.minted,10,'new session starts the parked interval');
 h.advance(1000);await h.flush();assert.equal(h.minted,11,'a recorded replay grants a new replacement');
 assert.equal(h.refused.length,0);assert.deepEqual((await h.group()).refused,[]);
});

for(const collector of ['manifest','device'])test(`eviction before the first bound replay cannot mint around the session limit (${collector})`,async t=>{
 const device=collector==='device'?await deviceStorage(t):null;
 const h=fixture(t,body=>body.args.from===41?bound:success,device?.storage);
 await h.collect();await h.flush();const first=h.calls[0].id;
 for(let cycle=0;cycle<25;cycle++){
  const positions=Array.from({length:256},(_,i)=>100+cycle*1000+i*2);
  if(device)await device.collect(positions);else await h.q.accept([{...binding,rows:positions.map(n=>['c',n])}]);
  assert.equal((await h.group()).attempt,undefined,'real interval pressure evicted the held replay');
  h.advance(60000);await h.flush();
  if(device)await device.collect([41]);else await h.collect();
  await h.flush();
 }
 assert.equal(h.minted,1,'losing a required replay delays this session instead of issuing a fresh initial id');
 assert.equal(h.calls[0].id,first);assert.equal(h.refused.length,0);assert.deepEqual((await h.group()).refused,[]);
 await h.restart();await h.flush();assert.equal(h.minted,2,'restart can try the delayed coverage again');
});

for(const pressure of ['interval','group'])test(`spent session survives ${pressure} eviction and delays merged clean coverage without refusing it`,async t=>{
 let backlog=true;const h=fixture(t,()=>backlog?bound:success);await exhaust(h);const count=h.calls.length;
 if(pressure==='interval')await h.q.accept([{...binding,rows:Array.from({length:256},(_,i)=>['c',100+i*2])}]);
 else await h.storage.update(s=>{acceptManifest(s,[{...binding,rows:[['other',1]]}],1);acceptManifest(s,[{...binding,rows:[['c',41]]}],1);});
 await h.storage.update(s=>{const g=s.groups[deliveryKey(binding,'c')];g.owed=[];g.parked=[];});
 await h.q.accept([{...binding,rows:[['c',41],['c',42]]}]);await h.flush();
 assert.equal(h.calls.length,count,'spent group delays merged coverage without transport');
 assert.deepEqual((await h.group()).parked.map(p=>[p.kind,p.run]),[['start',[41,42]]]);
 assert.deepEqual((await h.group()).refused,[]);assert.equal(h.refused.length,0);
 backlog=false;await h.restart();await h.flush();
 assert.deepEqual((await h.group()).reported,[[41,42]],'both delayed positions succeed after restart');assert.equal(h.refused.length,0);
});

test('whole-group eviction before a replay retains the session delay but no tombstone',async t=>{
 const h=fixture(t,()=>bound);await h.collect();await h.flush();
 await h.storage.update(s=>{acceptManifest(s,[{...binding,rows:[['other',1]]}],1);acceptManifest(s,[{...binding,rows:[['c',41]]}],1);assert.deepEqual(s.retired,{});});
 h.advance(60000);await h.flush();assert.equal(h.minted,1);assert.equal((await h.group()).parked[0].kind,'start');assert.equal(h.refused.length,0);
});

test('success, full/start parks, and resets never replenish a session counter',async t=>{
 let outcome=bound;const h=fixture(t,()=>outcome);
 for(let n=0;n<8;n++){
  const position=41+n*2;
  outcome=bound;await h.q.accept([{...binding,rows:[['c',position]]}]);await h.flush();
  h.advance(60000);await h.flush(); // replay confirmed: one replacement
  outcome=n%3===0?{accepted:true,json:{state:'failed',why:{code:'RUNS_FULL'},head:10}}
   :n%3===1?{accepted:true,json:{state:'failed',why:{code:'E_INPUT'},head:10}}:success;
  h.advance(60000);await h.flush();
  // Retire only the fixture's parked debt, preserving the live queue's counter.
  await h.storage.update(s=>{const g=Object.values(s.groups)[0];g.parked=[];g.owed=[];});
  if(n===3)await h.q.reset(false);
 }
 const count=h.minted;
 await h.q.accept([{...binding,rows:[['c',99]]}]);await h.flush();assert.equal(h.minted,count);
 assert.equal((await h.group()).parked[0].kind,'start');assert.ok(h.refused.every(e=>e.why.code==='E_INPUT'));
});

test('transport retry preserves its id and cannot replenish the bound allowance',async t=>{
 let lost=false;const h=fixture(t,()=>{if(lost)throw Error('offline');return bound;});
 await h.collect();await h.flush();h.advance(1000);await h.flush();assert.equal(h.minted,2);
 const held=(await h.group()).attempt.id;lost=true;
 for(let n=0;n<9;n++){h.advance(60000);await h.flush();}
 assert.equal((await h.group()).parked[0].kind,'retry');
 lost=false;await h.q.reconnect();await h.flush();assert.equal(h.calls.at(-1).id,held);
 for(let n=0;n<40&&(await h.group()).attempt;n++){h.advance(60000);await h.flush();}
 assert.equal(h.minted,9);assert.equal((await h.group()).parked[0].kind,'start');assert.equal(h.refused.length,0);
});

for(const wake of ['reconnect','start','timer'])test(`a due full park cannot replace a held bound replay on ${wake}`,async t=>{
 const h=fixture(t,()=>success);await h.collect();
 const attempt={id:'committed-1',run:[1,1],retries:1,readyAt:61000,boundReplay:true};
 await h.storage.update(s=>{const g=Object.values(s.groups)[0];g.owed=[[1,1]];g.attempt=structuredClone(attempt);g.parked=[{kind:'full',run:[41,41],at:0}];});
 h.advance(60000);await h.q.wake(wake);await h.flush();assert.equal(h.calls.length,0);assert.deepEqual((await h.group()).attempt,attempt);
 h.advance(1000);await h.flush();assert.equal(h.calls[0].id,'committed-1');await h.flush();assert.equal(h.calls[1].args.from,41);
});

test('an older online membership retry never turns delayed bound coverage into a refusal',async t=>{
 let older=false;const h=fixture(t,body=>{
  if(body.args.from===1){if(!older)throw Error('lost');return {accepted:true,json:{state:'failed',why:{code:'NOT_MEMBER'},head:10}};}
  return bound;
 },undefined,false);
 await h.q.accept([{...binding,rows:[['c',1]]}]);
 for(let n=0;n<9;n++){await h.flush();h.advance(60000);}
 await h.collect();await h.flush();
 for(let n=0;n<40&&(await h.group()).attempt;n++){h.advance(60000);await h.flush();}
 assert.equal(h.refused.length,0);older=true;await h.q.reconnect();await h.flush();await h.flush();
 assert.deepEqual((await h.group()).refused,[]);assert.equal(h.refused.length,0);
 assert.equal(new Set(h.calls.filter(c=>c.args.from===41).map(c=>c.id)).size,9);
});

test('the bound allowance is scoped by both fingerprint and group and is not cleared by success',async t=>{
 const h=fixture(t,()=>bound);await exhaust(h);
 await h.q.accept([{...binding,rows:[['other',41]]}]);await h.flush();
 assert.equal(h.calls.at(-1).args.conversation,'other');
 const newBinding={...binding,fingerprint:'new-definition'};
 await h.q.accept([{...newBinding,rows:[['c',41]]}]);await h.flush();
 assert.equal(h.calls.at(-1).delivery.fingerprint,'new-definition');assert.equal(h.calls.at(-1).args.conversation,'c');assert.equal(h.refused.length,0);
});

test('a retried storage CAS debits and mints a recorded bound replacement only once',async t=>{
 let state={serial:0,groups:{},retired:{}},repeat=false;
 const storage={async update(edit){if(repeat)edit(structuredClone(state));return edit(state);},async clear(){assert.fail('unexpected clear');}};
 const h=fixture(t,()=>bound,storage);await h.collect();await h.flush();repeat=true;
 h.advance(1000);await h.flush();assert.equal(h.minted,2,'CAS retries share one replacement reservation');
 repeat=false;
 for(let n=0;n<40&&(await h.group()).attempt;n++){h.advance(60000);await h.flush();}
 assert.equal(h.minted,9);assert.equal((await h.group()).parked[0].kind,'start');assert.equal(h.refused.length,0);
});

test('continuously recollected spent debt yields to another ready group',async t=>{
 let yielded=0,otherAt;
 const h=fixture(t,body=>{if(body.args.conversation==='other'){otherAt=yielded;return success;}return bound;});
 await exhaust(h);
 h.q.options.onSettled=()=>{
  if(++yielded<20)void h.storage.update(s=>acceptManifest(s,[{...binding,rows:[['c',1000+yielded*2]]}],4096));
 };
 await h.q.accept([{...binding,rows:[['c',99],['other',1]]}]);await h.flush();
 assert.equal(yielded,1,'parking yields the pump before the live producer finishes');await h.flush();
 assert.equal(otherAt,1,'a spent group cannot monopolize the pump as new rows arrive');
 assert.equal(h.refused.length,0);
});
