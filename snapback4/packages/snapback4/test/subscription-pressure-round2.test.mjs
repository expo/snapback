import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,open,opener,q,until,parked,sdk} from './helpers/answers-stay.mjs';
const {ReadObservation,answerObservation}=await import(new URL('read-observation.js',sdk));
const {peekObservation}=await import(new URL('observe-watch.js',sdk));
const {guardClient}=await import(new URL('app-client.js',sdk));
const {LocalReads}=await import(new URL('local-reads.js',sdk));
const {ReadWork}=await import(new URL('read-work.js',sdk));
for(const tier of ['wasm','process'])for(const staged of [false,true])for(const keep of [undefined,true,false])test(`${tier}: reuse closed handle after ${staged?'staged':'published'} revocation, keep=${keep}`,{timeout:20000},async t=>{
 const f=await fixture(t), raw=opener(tier,join(f.dir,'reuse'));
 const slots=Promise.withResolvers(),continuation=Promise.withResolvers();let work,cut=false,release=false;
 t.after(()=>{slots.resolve();release=true;continuation.resolve()});
 const original=ReadWork.prototype.schedule;
 t.mock.method(ReadWork.prototype,'schedule',function(w,run){work=this;return original.call(this,w,run)});
 const client=await open(t,f,tier,{fetch:async(input,init)=>{
  const path=new URL(input).pathname;
  if(path==='/changes')return parked(init.signal);
  if(path==='/sync'&&cut&&!release)await continuation.promise;
  return fetch(input,init);
 },device:{async open(...args){const core=await raw.open(...args);return {...core,async call(request,committed){
  if(staged&&!release&&request.op==='apply'&&request.page.events.some(e=>e.kind==='scope')){cut=true;const reply={ok:{touched:[],published:false}};committed?.(reply);return reply}
  return core.call(request,committed);
 }}}}});
 const watch=client.observe(q('history'),{c:null},{keep});watch.subscribe(()=>{});t.after(()=>watch.close());
 await until(()=>watch.getSnapshot().data?.length===1); const owner=answerObservation(watch.getSnapshot());
 watch.close();
 for(let i=0;i<8;i++)work.schedule(Object.assign(new ReadObservation(),{op:q('held'),subscribers:new Set()}),()=>slots.promise);
 await until(()=>work.active.size===8);
 await f.post('/m/remove',{id:'revoked',args:{}});const syncing=client.sync();
 if(staged)await until(()=>cut);else await syncing;
 const closed=structuredClone(watch.getSnapshot());
 const events=[];watch.subscribe(()=>events.push(watch.getSnapshot()));
 const immediate=watch.getSnapshot();
 const peek=peekObservation(client,q('history'),{c:null},{keep});
 const facade=guardClient(client,async()=>true,()=>true,()=>({code:'E_AUTH',family:'auth',message:'ended'}));
 const view=facade.client.observe(q('history'),{c:null},{keep});view.subscribe(()=>{});
 t.after(()=>{view.close();facade.fence()()});
 await delay(1200);
 assert.ok(!('data' in peek),'peek sees withdrawal before queue service');
 assert.ok(!('data' in view.getSnapshot()),'facade cannot approve the saved revoked answer');
 if(staged) assert.ok(!('data' in await client.query(q('history'),{c:null})),'one-shot fallback is fenced before returning');
 const reopened=structuredClone(watch.getSnapshot());
 t.diagnostic(JSON.stringify({tier,staged,closed,reopened,pending:work.pending.has(owner),active:work.active.size}));
 assert.ok(!('data' in immediate),'no saved data is visible synchronously after resubscribe');
 assert.ok(events.every(r=>!('data' in r)),'subscribers never receive the revoked saved answer');
 assert.ok(!('data'in reopened),'revoked answer must not return when old handle is reused');
});

// Even without a live watch, staged/published losses retire recovery memory.
test('scope loss fences remembered server answers without a mounted owner',()=>{
 const reads=new LocalReads(), cache=reads.serverAnswers.view();
 const answer=room=>({read:{data:[room],fresh:true,complete:true,cut:null},at:0,nextExpiry:null,tables:new Set(['messages']),scopes:{messages:[{'0':room}]}});
 cache.set('lost',answer('room'),1);cache.set('sibling',answer('room2'),1);
 reads.withdrawScopes([],{watermark:2,events:[{kind:'scope',table:'messages',data:['room']}]},false)?.();
 assert.equal(reads.serverAnswers.get('lost'),undefined);
 assert.equal(reads.serverAnswers.get('sibling').read.data[0],'room2');
 cache.set('lost',answer('room'),3);
 assert.equal(reads.serverAnswers.get('lost'),undefined,'pre-cut attempts cannot repopulate memory');
});

for(const tier of ['wasm','process'])test(`${tier}: a dormant local handle checks terminal refusal before reuse`,async t=>{
 const f=await fixture(t),feed=Promise.withResolvers(),slots=Promise.withResolvers();let work,delivered=false;
 t.after(()=>{feed.resolve();slots.resolve()});
 const original=ReadWork.prototype.schedule;
 t.mock.method(ReadWork.prototype,'schedule',function(w,run){work=this;return original.call(this,w,run)});
 const client=await open(t,f,tier,{fetch:async(input,init)=>{
  if(new URL(input).pathname==='/changes'){
   await feed.promise;delivered=true;return Response.json({denied:{code:'E_TEST_TERMINAL',family:'rule',message:'terminal'}});
  }
  return fetch(input,init);
 }});
 const watch=client.observe(q('history'),{c:null});watch.subscribe(()=>{});t.after(()=>watch.close());
 await until(()=>watch.getSnapshot().data?.length===1);watch.close();
 const sentinel=client.observe(q('profile'),{});sentinel.subscribe(()=>{});t.after(()=>sentinel.close());
 await until(()=>sentinel.getSnapshot().data?.name==='Bob');
 const approval=Promise.withResolvers();let checks=0,checking=false;
 const facade=guardClient(client,async()=>{if(++checks===2){checking=true;await approval.promise}return true},()=>true,()=>({code:'E_AUTH',family:'auth',message:'ended'}));
 t.after(()=>{approval.resolve();facade.fence()()});
 const saved=facade.client.query(q('history'),{c:null});await until(()=>checking);
 for(let i=0;i<8;i++)work.schedule(Object.assign(new ReadObservation(),{op:q('held'),subscribers:new Set()}),()=>slots.promise);
 await until(()=>work.active.size===8);feed.resolve();
 await until(()=>delivered&&sentinel.getSnapshot().denied?.code==='E_TEST_TERMINAL');
 watch.subscribe(()=>{});
 assert.equal(watch.getSnapshot().denied?.code,'E_TEST_TERMINAL');
 approval.resolve();assert.ok(!('data' in await saved),'one-shot facade cannot approve data across a terminal refusal');
 assert.equal(work.active.size,8);
});
