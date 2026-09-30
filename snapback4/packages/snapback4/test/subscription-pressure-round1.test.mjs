// @ref LLP 3000.023#10 — group-specific withdrawal and staged-publication fences.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, open, opener, source, q, until, parked, sdk } from './helpers/answers-stay.mjs';
const { ReadObservation, answerObservation } = await import(new URL('read-observation.js', sdk));
const { ReadWork } = await import(new URL('read-work.js', sdk));
const { ObservationWork, inspect } = await import(new URL('observation-work.js', sdk));
const { LocalReads, localWatch } = await import(new URL('local-reads.js', sdk));
const ready = data => ({ data, fresh: true, complete: true, cut: null });
const drain = async () => { for (let n=0;n<40;n++) await Promise.resolve(); };

test('unused inspection records no timings and allocates no withdrawal callbacks', async t => {
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const clock = t.mock.method(performance,'now',()=>0), work = new ObservationWork();
  const watches = new Map(), client = {observe(){}}; work.bind(client,watches);
  for (let i=0;i<1000;i++) {
    const watch = Object.assign(new ReadObservation(),{op:q('history'),subscribers:new Set()});
    watch.publish(ready([i]));
    watches.set(i,watch); work.schedule(watch,async()=>{});
  }
  for (let i=0;i<130;i++) { t.mock.timers.tick(1); await drain(); }
  assert.equal(clock.mock.callCount(),0,'no diagnostic clock before opt-in');
  assert.ok([...watches.values()].every(w=>!w.hasAnswered),'no diagnostic answer history before opt-in');
  assert.ok([...watches.values()].every(w=>w.withdrawal === undefined),'no per-watch diagnostic closures');
  assert.equal(inspect(client).latency.samples,0,'no pre-opt-in records');
  work.clear();
});

test('compound scope matching skips disjoint groups and watches with no tables', () => {
  const reads = new LocalReads(), make = (group,tables=['items']) => {
    const w=localWatch(undefined,q('history'),{},'',0,()=>false);
    w.tables=new Set(tables); w.scopes={items:[{'0':group,'1':7}]}; w.publish(ready([group])); return w;
  };
  const hit=make('room1'), other=make('room2'), empty=make('room1',[]), wrongNumber=make('room1');
  wrongNumber.scopes.items[0]['1']='7';
  const cache=reads.serverAnswers.view();
  const notify=reads.withdrawScopes([hit,other,empty,wrongNumber],{watermark:9,events:[{kind:'scope',table:'items',data:['room1',7]}]},false);
  notify?.();
  cache.set('history:{}',{read:ready(['protected']),at:0,nextExpiry:null,tables:new Set(['items'])},10);
  assert.equal(reads.serverAnswers.get('history:{}'),undefined,'pre-removal memory writes remain fenced');
  assert.equal(hit.snapshot.loading,true); for(const w of [other,empty,wrongNumber]) assert.ok('data' in w.snapshot);
  assert.equal(reads.current(hit,{read:ready(['old']),serverOnly:true,seq:10}),false,'even new server data waits for staged publication');
  assert.deepEqual(reads.applied([hit],8),[]);
  assert.deepEqual(reads.applied([hit],9),[hit],'empty publication footprint still resumes');
});

test('a pending group removal fences an initial observation until actual publication', () => {
  const reads=new LocalReads();
  reads.withdrawScopes([],{watermark:9,events:[{kind:'scope',table:'items',data:['room1',7]}]},false)?.();
  const watch=localWatch(undefined,q('history'),{},'',0,()=>false);
  const result={read:ready(['protected']),tables:new Set(['items']),scopes:{items:[{'0':'room1','1':7}]}};
  assert.equal(reads.current(watch,result),false,'a cut survives even when no watch existed at removal');
  assert.equal(reads.blocked({...result,scopes:{items:[{'0':'room2','1':7}]}}),undefined);
  assert.equal(reads.blocked(result),9);
  assert.deepEqual(reads.applied([watch],8),[]);
  assert.equal(reads.current(watch,result),false);
  assert.deepEqual(reads.applied([watch],9),[watch]);
  assert.equal(reads.current(watch,result),true);
});

const twoRooms = source + `
query roomHistory(room: text):
  return messages[room] first 100 by byRoom
query roomBodies(room: text):
  return messages[room] first 100 by byRoom { body: .body }
query roomCount(room: text):
  return count(messages[room] by byRoom)
query constant():
  return 'constant'
query decoration(id: int):
  return messages['item']
`;
for (const tier of ['wasm','process']) for (const staging of ['published','staged','offline','offline-before']) test(`${tier}: ${staging} removal only withdraws its room and resumes`, {timeout:30000}, async t => {
  const f=await fixture(t,twoRooms);
  assert.equal((await f.post('/seed',[
    ...['alice','bob'].map(p=>({table:'members',row:{id:p+'2',room:'room2',principal:'dev:'+p}})),
    {table:'messages',row:{id:'item2',room:'room2',body:'still permitted',at:1}},
  ])).seeded,3);
  const raw=opener(tier,join(f.dir,'scope-pressure')), slots=Promise.withResolvers(), continuation=Promise.withResolvers();
  let armed=false, staged=false, resumed=false, disconnected=false, forceOffline=false, applied, core;
  const owners=[], workByOwner=new WeakMap(), original=ReadWork.prototype.schedule;
  t.mock.method(ReadWork.prototype,'schedule',function(w,run){workByOwner.set(w,this); return original.call(this,w,run);});
  t.after(()=>{slots.resolve(); continuation.resolve();});
  const client=await open(t,f,tier,{fetch:async(input,init)=>{
    const path=new URL(input).pathname;
    if(path==='/changes') return parked(init.signal);
    if(path==='/q/profile' && forceOffline) throw Error('offline before staged callback');
    if(path==='/sync'&&staged&&!resumed) { await continuation.promise; if(disconnected) throw Error('offline after staged removal'); }
    return fetch(input,init);
  },device:{async open(...args){
    core=await raw.open(...args); return {...core,async call(request,committed){
      if(armed&&request.op==='query'&&request.name==='decoration') await slots.promise;
      if(staging!=='published'&&!resumed&&request.op==='apply'&&request.page.events.some(e=>e.kind==='scope')) {
        applied=structuredClone(request);
        if(staging==='offline-before') { forceOffline=true; await client.query(q('profile'),{}); assert.equal(client.link(),'offline'); }
        const reply={ok:{touched:[],published:false}}; committed?.(reply); staged=true; return reply;
      }
      return core.call(request,committed);
    }};
  }}});
  const one=['roomHistory','roomBodies','roomCount'].map(name=>client.observe(q(name),{room:'room'}));
  const two=['roomHistory','roomBodies','roomCount'].map(name=>client.observe(q(name),{room:'room2'}));
  const constant=client.observe(q('constant'),{}), all=[...one,...two,constant];
  all.forEach(w=>w.subscribe(()=>{})); t.after(()=>all.forEach(w=>w.close()));
  await until(()=>all.every(w=>'data' in w.getSnapshot()));
  const notifications=one.map(()=>[]), others=two.map(()=>[]);
  one.forEach((w,i)=>{owners.push(answerObservation(w.getSnapshot())); w.subscribe(()=>notifications[i].push(structuredClone(w.getSnapshot())));});
  two.forEach((w,i)=>w.subscribe(()=>others[i].push(structuredClone(w.getSnapshot()))));
  armed=true;
  const blockers=Array.from({length:8},(_,id)=>client.observe(q('decoration'),{id}));
  blockers.forEach(w=>{w.subscribe(()=>{}); all.push(w);});
  const work=workByOwner.get(owners[0]); await until(()=>work.active.size===8);
  assert.equal((await f.post('/m/edit',{id:'queue-rooms',args:{body:'before removal'}})).state,'sent');
  await client.sync(); await until(()=>owners.every(w=>work.pending.has(w)));
  notifications.forEach(events=>events.length=0);
  assert.equal((await f.post('/m/remove',{id:'lose-one',args:{}})).state,'sent');
  const syncing=client.sync();
  if(staging==='published') await syncing; else await until(()=>staged);
  assert.ok(notifications.every(events=>events.some(r=>'loading' in r || staging==='offline-before' && 'denied' in r)),'raw subscribers receive scope withdrawal even with no published footprint');
  assert.ok(one.every(w=>!('data' in w.getSnapshot())));
  assert.ok(two.every(w=>'data' in w.getSnapshot()),'other room must remain mounted while eight slots are occupied');
  assert.equal(constant.getSnapshot().data,'constant');
  assert.ok(others.every(events=>events.every(r=>'data' in r)),'other room never transiently blanks');
  slots.resolve();
  if(staging!=='published') {
    await delay(80);
    // Previously queued histories now run against the still-old device.
    assert.ok(one.every(w=>!('data' in w.getSnapshot())),'queued work cannot resurrect older replica rows');
    assert.ok(notifications.every(events=>events.slice(events.findIndex(r=>!('data' in r))).every(r=>!('data' in r))),'no protected republish after withdrawal');
    if(staging==='staged') {
      one[0].close();
      one[0]=client.observe(q('roomHistory'),{room:'room'}); all.push(one[0]);
      const remounted=[]; one[0].subscribe(()=>remounted.push(structuredClone(one[0].getSnapshot())));
      await delay(100);
      assert.ok(!('data' in one[0].getSnapshot()),'a new owner is also fenced by the unpublished group removal');
      assert.ok(remounted.every(r=>!('data' in r)),'no transient protected data on remount');
      assert.ok(!('data' in await client.query(q('roomHistory'),{room:'room'})),'one-shot read is fenced too');
      assert.equal((await client.query(q('roomCount'),{room:'room2'})).data,1,'the pending group cut is precise for new reads');
    }
    if(staging==='offline') { disconnected=true; continuation.resolve(); await syncing; await until(()=>client.link()==='offline');
      assert.ok(one.every(w=>'denied' in w.getSnapshot()),'staged watch has a transport refusal offline, not stranded loading');
    }
    if(staging==='offline-before') assert.ok(one.every(w=>'denied' in w.getSnapshot()),'a late staged commit cannot strand an already offline watch');
    resumed=true; disconnected=false; forceOffline=false; continuation.resolve(); await syncing; await client.sync();
  }
  await until(()=>one.every(w=>'data' in w.getSnapshot()));
  assert.deepEqual(one[0].getSnapshot().data,[]); assert.deepEqual(one[1].getSnapshot().data,[]); assert.equal(one[2].getSnapshot().data,0);
  assert.ok(two.every(w=>'data' in w.getSnapshot()));
});

for (const tier of ['wasm','process']) test(`${tier}: terminal change-feed refusal bypasses eight occupied slots`, {timeout:20000},async t=>{
  const f=await fixture(t), feed=Promise.withResolvers(), slots=Promise.withResolvers();
  let armed=false, seen=false;
  const raw=opener(tier,join(f.dir,'terminal'));
  t.after(()=>{feed.resolve();slots.resolve();});
  const client=await open(t,f,tier,{fetch:async(input,init)=>{
    if(new URL(input).pathname==='/changes'){seen=true; await feed.promise; return Response.json({denied:{code:'E_TEST_TERMINAL',family:'rule',message:'terminal'}});}
    return fetch(input,init);
  }});
  const history=client.observe(q('history'),{c:null}); history.subscribe(()=>{}); t.after(()=>history.close());
  await until(()=>history.getSnapshot().data?.length===1&&seen);
  const owner=answerObservation(history.getSnapshot());
  // Occupy the same scheduler without changing the mounted answer.
  let work; const orig=ReadWork.prototype.schedule;
  t.mock.method(ReadWork.prototype,'schedule',function(w,run){work=this;return orig.call(this,w,run);});
  const sibling=client.observe(q('item'),{}); sibling.subscribe(()=>{}); t.after(()=>sibling.close());
  await until(()=>work&&'data' in sibling.getSnapshot());
  for(let i=0;i<8;i++)work.schedule(Object.assign(new ReadObservation(),{op:q('held'),subscribers:new Set()}),()=>slots.promise);
  await until(()=>work.active.size===8);
  const events=[]; history.subscribe(()=>events.push(history.getSnapshot())); feed.resolve();
  await until(()=>events.some(r=>'denied' in r));
  assert.equal(history.getSnapshot().denied?.code,'E_TEST_TERMINAL');
  assert.equal(work.active.size,8); slots.resolve(); await delay(50);
  assert.equal(history.getSnapshot().denied?.code,'E_TEST_TERMINAL','old queued work cannot restore data');
});

test('online scope-ambiguous change evidence expires while waiting for capacity', {timeout:15000},async t=>{
  const f=await fixture(t), feed=Promise.withResolvers(), slots=Promise.withResolvers(); let changed=false;
  t.after(()=>{feed.resolve();slots.resolve();});
  const client=await open(t,f,'online',{fetch:async(input,init)=>{
    if(new URL(input).pathname==='/changes'){await feed.promise; if(changed)return parked(init.signal); changed=true;return Response.json({seq:100,tables:['messages','members']});}
    return fetch(input,init);
  }});
  let work; const orig=ReadWork.prototype.schedule;
  t.mock.method(ReadWork.prototype,'schedule',function(w,run){work=this;return orig.call(this,w,run);});
  const history=client.observe(q('history'),{c:null}); history.subscribe(()=>{});t.after(()=>history.close());
  await until(()=>history.getSnapshot().data?.length===1);
  const owner=answerObservation(history.getSnapshot()), events=[]; history.subscribe(()=>events.push(history.getSnapshot()));
  for(let i=0;i<8;i++)work.schedule(Object.assign(new ReadObservation(),{op:q('held'),subscribers:new Set()}),()=>slots.promise);
  await until(()=>work.active.size===8);
  await f.post('/m/remove',{id:'online-removal',args:{}}); feed.resolve();
  await until(()=>work.pending.has(owner));
  await until(()=>history.getSnapshot().loading===true);
  assert.ok(events.some(r=>'loading' in r)); assert.equal(work.active.size,8); assert.ok(work.pending.has(owner));
});

test('online viewer replacement is inspected as viewer, not schema reset',async t=>{
  const f=await fixture(t); let switchViewer=false;
  const client=await open(t,f,'online',{fetch:async(input,init)=>{
    const path=new URL(input).pathname;
    if(path==='/changes')return parked(init.signal);
    const response=await fetch(input,init);
    if(switchViewer&&path==='/q/profile')return Response.json({...await response.json(),viewer:'dev:alice'});
    return response;
  }});
  const watch=client.observe(q('history'),{c:null});watch.subscribe(()=>{});t.after(()=>watch.close());
  await until(()=>watch.getSnapshot().data?.length===1); inspect(client);
  switchViewer=true; await client.query(q('profile'),{});
  assert.ok(inspect(client).recentWithdrawals.some(e=>e.query==='history'&&e.cause==='viewer'));
});
