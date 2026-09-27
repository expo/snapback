import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { DeliveryQueue, memoryDelivery } from '../dist/delivery.js';
import { acceptManifest, deliveryKey, emptyDelivery } from '../dist/delivery-state.js';
const binding={table:'messages',mutation:'delivered',args:['conversation','from','through']};
const manifest=(rows,b=binding)=>[{...b,rows}];
const ok={accepted:true,json:{state:'sent',seq:10,head:10,store_id:'S'}};
const deferred=()=>{let resolve; const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function settle(){for(let i=0;i<8;i++)await turn();}
let minted=0;
function harness(t,{send=async()=>ok,local=false,storage=memoryDelivery()}={}){
 const calls=[],refused=[];let time=0,id=0,ready=true;
 const q=new DeliveryQueue({storage,local,mint:()=>`id${++minted}`,now:()=>time,jitter:()=>0,ready:()=>ready,
  send:async(mutation,body,signal)=>{calls.push({mutation,...body,signal});return send(calls.at(-1));},onRefused:e=>refused.push(e)});
 t.after(()=>q.stop());return {q,calls,refused,storage,advance:n=>{time+=n;},ready:b=>{ready=b;},state:()=>storage.update(s=>structuredClone(s)),async flush(){await q.pump();await settle();}};
}
const groups=s=>Object.values(s.groups);
test('maximal exact runs, binding identity and named arguments',async t=>{
 const h=harness(t);await h.q.accept([...manifest([['c',41],['c',43],['c',42],['c',47]]),...manifest([['c',41]],{table:'photos',mutation:'deliveredPhoto',args:['room','lo','hi']})]);
 await h.flush();await h.flush();assert.deepEqual(h.calls.map(c=>[c.mutation,c.args]).sort(),[
 ['delivered',{conversation:'c',from:41,through:43}],['delivered',{conversation:'c',from:47,through:47}],['deliveredPhoto',{room:'c',lo:41,hi:41}]].sort());
 await h.q.accept(manifest([['c',41],['c',42]]));await h.flush();assert.equal(h.calls.length,3);
});
for(const envelope of ['why','denied'])for(const code of ['RUNS_FULL','NOT_MEMBER','NOT_FOUND','NOT_A_RUN','PAST_LAST_MESSAGE','E_INPUT','E_OP','NEW_CODE','E_AUTH','E_OFFLINE'])test(`${envelope}: ${code}`,async t=>{
 const h=harness(t,{send:async()=>({accepted:true,json:{head:10,[envelope]:{code}}})});await h.q.accept(manifest([['c',1]]));await h.flush();const g=groups(await h.state())[0];
 if(['NOT_MEMBER','NOT_FOUND'].includes(code))assert.equal(g,undefined);
 else if(['NOT_A_RUN','PAST_LAST_MESSAGE'].includes(code)){assert.deepEqual(g.refused,[[1,1]]);assert.equal(h.refused.length,1);}
 else if(code==='RUNS_FULL')assert.equal(g.parked[0].kind,'full');
 else if(['E_INPUT','E_OP','NEW_CODE'].includes(code)){assert.equal(g.parked[0].kind,'start');assert.equal(h.refused.length,1);}
 else assert.deepEqual(g.owed,[[1,1]]);
});
test('RUNS_FULL continues; coalesced wakes retry one after 30 seconds',async t=>{
 const h=harness(t,{send:async c=>c.args.from===1?{accepted:true,json:{head:10,why:{code:'RUNS_FULL'}}}:ok});
 await h.q.accept(manifest([['c',1],['c',3]]));await h.flush();await h.flush();assert.deepEqual(h.calls.map(c=>c.args.from),[1,3]);
 for(let i=0;i<10;i++)await h.q.accept(manifest([['c',3]]));h.advance(29999);await h.flush();assert.equal(h.calls.length,2);
 h.advance(1);await h.flush();assert.equal(h.calls.length,3);assert.notEqual(h.calls[0].id,h.calls[2].id);
 h.advance(60000);await h.flush();assert.equal(h.calls.length,3);await h.q.wake('timer');await h.flush();assert.equal(h.calls.length,4);
});
test('four slots, one per group, longest waiter precedes busy group',async t=>{
 const waiting=[];const h=harness(t,{send:()=>{const d=deferred();waiting.push(d);return d.promise;}});
 await h.q.accept(manifest([['a',1],['a',3],['b',1],['c',1],['d',1],['e',1]]));await h.flush();assert.deepEqual(h.calls.map(c=>c.args.conversation),['a','b','c','d']);
 waiting[0].resolve(ok);await settle();await h.flush();assert.equal(h.calls[4].args.conversation,'e');for(const d of waiting)d.resolve(ok);
});
test('uncertain retry id persists across restart; recorded conflict uses a new id',async t=>{
 const storage=memoryDelivery(),a=harness(t,{storage,send:async()=>{throw Error('lost');}});await a.q.accept(manifest([['c',1]]));await a.flush();assert.equal(groups(await a.state())[0].attempt.readyAt,1000);await a.q.stop();
 const b=harness(t,{storage,send:async()=>({accepted:true,json:{head:10,state:'failed',why:{code:'E_CONFLICT',retryable:true}}})});b.advance(1000);await b.q.start();await b.flush();assert.equal(b.calls[0].id,a.calls[0].id);assert.notEqual(groups(await b.state())[0].attempt.id,b.calls[0].id);
});
test('missing head is uncertain; obsolete auth retries same id; current auth pauses',async t=>{
 let n=0;const h=harness(t,{send:async()=>++n===1?{accepted:true,json:{state:'sent',seq:10}}:{accepted:false,obsoleteAuth:n===2,json:{denied:{code:'E_AUTH'}}}});
 await h.q.accept(manifest([['c',1]]));await h.flush();h.advance(1000);await h.flush();await h.flush();assert.equal(h.calls.length,3);assert.equal(new Set(h.calls.map(c=>c.id)).size,1);
 await h.q.accept(manifest([['d',2]]));await h.flush();assert.equal(h.calls.length,3);
});
test('refused manifests and eviction cannot recreate debt; saturation survives restart',async t=>{
 const storage=memoryDelivery(),h=harness(t,{storage,send:async()=>({accepted:true,json:{head:10,why:{code:'NOT_A_RUN'}}})});await h.q.accept(manifest([['c',1]]));await h.flush();await h.q.accept(manifest([['c',1]]));await h.flush();assert.equal(h.calls.length,1);
 const state=emptyDelivery(),key=deliveryKey(binding,'c');acceptManifest(state,manifest([['c',1]]),1);state.groups[key].refused=[[1,1]];state.groups[key].saturated=true;acceptManifest(state,manifest([['d',2],['c',1],['c',5]]),1);assert.equal(state.groups[key].saturated,true);assert.deepEqual(state.groups[key].owed,[]);
 await storage.update(s=>{const g=groups(s)[0];g.refused=Array.from({length:63},(_,i)=>[i*2+1,i*2+1]);g.owed=[[129,129]];});await h.flush();assert.equal(groups(await h.state())[0].saturated,true);
 await h.q.stop();const reopened=harness(t,{storage});await reopened.q.start();await reopened.q.accept(manifest([['c',1000]]));await reopened.flush();assert.equal(reopened.calls.length,0);
});
test('stale group callback releases slot and cannot erase rejoin',async t=>{
 const pending=deferred(),h=harness(t,{local:true,send:async()=>pending.promise});await h.q.accept(manifest([['c',1]]));await h.flush();await h.storage.update(s=>{delete s.groups[deliveryKey(binding,'c')];});await h.q.accept(manifest([['c',3]]));pending.resolve({accepted:true,json:{head:10,why:{code:'NOT_MEMBER'}}});await settle();assert.deepEqual(groups(await h.state())[0].owed,[[3,3]]);await h.flush();assert.equal(h.calls.length,2);
});
test('online membership refusal preserves post-dispatch collections',async t=>{
 const pending=deferred(),h=harness(t,{send:async()=>pending.promise});await h.q.accept(manifest([['c',1]]));await h.flush();await h.q.accept(manifest([['c',3]]));pending.resolve({accepted:true,json:{head:10,denied:{code:'NOT_MEMBER'}}});await settle();assert.deepEqual(groups(await h.state())[0].owed,[[3,3]]);
});
test('generation and viewer fences reject callbacks',async t=>{
 const pending=deferred(),h=harness(t,{send:async()=>pending.promise});await h.q.accept(manifest([['c',1]]));await h.flush();await h.q.reset(true);await h.q.accept(manifest([['c',2]],{...binding,table:'photos'}));pending.resolve(ok);await settle();assert.deepEqual(groups(await h.state())[0].owed,[[2,2]]);
});
test('deadline frees slot with same attempt id',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=harness(t,{send:async()=>new Promise(()=>{})});await h.q.accept(manifest([['c',1]]));await h.flush();h.advance(15000);t.mock.timers.tick(15000);await settle();assert.equal(h.calls[0].signal.aborted,true);h.advance(1000);await h.flush();assert.equal(h.calls.length,2);assert.equal(h.calls[0].id,h.calls[1].id);
});
test('offline spends no retries; outbox dispatch gate sends nothing',async t=>{
 const h=harness(t,{send:async()=>({accepted:false,json:{denied:{code:'E_OFFLINE'}}})});h.ready(false);await h.q.accept(manifest([['c',1]]));await h.flush();assert.equal(h.calls.length,0);h.ready(true);await h.flush();assert.equal(groups(await h.state())[0].attempt.retries,0);h.advance(100000);await h.flush();assert.equal(h.calls.length,1);await h.q.reconnect();await h.flush();assert.equal(h.calls.length,2);
});
test('eight uncertain retries park until reconnect and preserve each exhausted id',async t=>{
 const h=harness(t,{send:async()=>{throw Error('lost');}});
 await h.q.accept(manifest([['c',1],['c',3]]));
 for(let i=0;i<9;i++){await h.flush();h.advance(60001);}
 await h.flush();
 for(let i=0;i<8;i++){h.advance(60001);await h.flush();}
 const before=await h.state(),parked=groups(before)[0].parked;
 assert.equal(parked.length,2);assert.equal(h.calls.length,18);
 const ids=parked.map(p=>p.attempt.id);await h.q.reconnect();await h.flush();assert.equal(h.calls.at(-1).id,ids[0]);
 for(let i=0;i<8;i++){h.advance(60001);await h.flush();}
 await h.flush();assert.equal(h.calls.at(-1).id,ids[1]);
});
test('the slow timer wakes a RUNS_FULL run while home remains mounted',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=harness(t,{send:async()=>({accepted:true,json:{head:10,why:{code:'RUNS_FULL'}}})});
 await h.q.start();await h.q.accept(manifest([['c',1]]));await h.flush();assert.equal(h.calls.length,1);
 h.advance(600000);t.mock.timers.tick(600000);await settle();await h.flush();assert.equal(h.calls.length,2);
});
test('new owed work in any group precedes a parked retry',async t=>{
 const h=harness(t,{send:async c=>c.args.conversation==='a'?{accepted:true,json:{head:10,why:{code:'RUNS_FULL'}}}:ok});
 await h.q.accept(manifest([['a',1]]));await h.flush();h.advance(30000);await h.q.wake('timer');await h.q.accept(manifest([['b',9]]));await h.flush();
 assert.equal(h.calls[1].args.conversation,'b');
});
