import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {DeliveryQueue, memoryDelivery} from '../dist/delivery.js';
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
 assert.equal((await h.group()).attempt.bound.retries,8);assert.equal((await h.group()).attempt.bound.wakes,2);
});
test('E_BOUND wake cap survives restart, surfaces one refusal and stops minting even on later wakes',async t=>{
 const h=fixture(t,()=>bound);await exhaust(h);
 for(let n=1;n<=8;n++){
  h.advance(30000);await h.q.wake(n%2?'reconnect':'start');await h.flush();
  h.advance(1000);await h.flush();
  assert.equal(new Set(h.calls.map(c=>c.id)).size,9+n);
  assert.equal(h.refused.length,n===8?1:0);
 }
 assert.equal((await h.group()).parked[0]?.kind,'stopped');
 assert.deepEqual(h.refused.map(e=>[e.why.code,e.from,e.through]),[['E_BOUND',41,41]]);
 const count=h.calls.length;await h.q.stop();
 // New queue over the same serialized state, with its own minting counter.
 let saved;await h.storage.update(s=>{saved=JSON.stringify(s);});
 let state=JSON.parse(saved);const storage={async update(edit){const result=edit(state);state=JSON.parse(JSON.stringify(state));return result;},async clear(){throw Error('unexpected clear');}};
 const resumed=new DeliveryQueue({storage,local:true,mint:()=>{assert.fail('wake cap must persist');},ready:()=>true,send:()=>{assert.fail('stopped debt must not dispatch');},now:()=>1e9});
 t.after(()=>resumed.stop());await resumed.start();await resumed.reconnect();await resumed.wake('timer');await resumed.accept([{...binding,rows:[['c',41]]}]);await resumed.pump();await settle();
 assert.equal(h.calls.length,count);assert.equal((await storage.update(s=>Object.values(s.groups)[0])).parked[0]?.kind,'stopped');
});


test('restarting a parked E_BOUND resumes only one wake and preserves the burst count',async t=>{
 let state={serial:0,groups:{},retired:{}};
 const storage={async update(edit){const result=edit(state);state=JSON.parse(JSON.stringify(state));return result;},async clear(){throw Error('unexpected clear');}};
 const h=fixture(t,()=>bound,storage);await exhaust(h);const count=h.calls.length;
 h.advance(30000);await h.restart();await h.flush();
 assert.equal(h.calls.length,count+1);assert.equal((await h.group()).attempt.bound.retries,8);
 assert.equal((await h.group()).attempt.bound.wakes,1);
 h.advance(1000);await h.flush();assert.equal((await h.group()).parked[0]?.kind,'bound');
 h.advance(60000);await h.flush();assert.equal(h.calls.length,count+2,'start did not grant another burst');
});
test('the actual ten-minute timer wakes an exhausted E_BOUND interval',async t=>{
 const h=fixture(t,()=>bound);await exhaust(h);const count=h.calls.length;
 h.advance(600000);t.mock.timers.tick(600000);await settle();await h.flush();
 assert.equal(h.calls.length,count+1);assert.equal((await h.group()).attempt.bound.wakes,1);
});

test('one bound wake is consumed once even when its success or new manifests wake the group again',async t=>{
 const h=fixture(t,()=>success);await h.collect();
 await h.storage.update(s=>{const g=Object.values(s.groups)[0];g.owed=[];g.parked=[41,43].map(n=>({
  run:[n,n],kind:'bound',at:0,attempt:{id:`old-${n}`,run:[n,n],retries:0,readyAt:0,bound:{retries:8,wakes:0,replay:true}},
 }));});
 h.advance(30000);await h.q.wake('timer');await h.flush();await h.flush();
 assert.equal(h.calls.length,1,'a success cannot spend the same bound wake twice');
 await h.q.accept([{...binding,rows:[['c',43]]}]);await h.flush();assert.equal(h.calls.length,1,'neither can a later manifest');
 await h.q.wake('timer');await h.flush();assert.equal(h.calls.length,2);
});
