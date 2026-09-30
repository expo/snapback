import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,open,opener,source,q,until,parked,sdk} from './helpers/answers-stay.mjs';
import {join} from 'node:path';
const {ReadObservation,answerObservation}=await import(new URL('read-observation.js',sdk));
const {ReadWork}=await import(new URL('read-work.js',sdk));
const twoRooms=source+`
query roomHistory(room: text):
  return messages[room] first 100 by byRoom
query mixedRoom(room: text):
  profile = profiles['bob']
  rows = messages[room] first 100 by byRoom
  return { profile, rows }
`;
async function seedRoom2(f){assert.equal((await f.post('/seed',[
 ...['alice','bob'].map(p=>({table:'members',row:{id:p+'2',room:'room2',principal:'dev:'+p}})),
 {table:'messages',row:{id:'item2',room:'room2',body:'permitted room2',at:1}}
])).seeded,3);}
for(const tier of ['wasm','process'])for(const staged of [false,true])test(`${tier}: ${staged?'staged':'published'} removal preserves server-backed sibling`,{timeout:20000},async t=>{
 const f=await fixture(t,twoRooms);await seedRoom2(f);
 const slots=Promise.withResolvers(),continuation=Promise.withResolvers();let work,cut=false,released=false;
 t.after(()=>{slots.resolve();released=true;continuation.resolve()});
 const original=ReadWork.prototype.schedule;
 t.mock.method(ReadWork.prototype,'schedule',function(w,run){work=this;return original.call(this,w,run)});
 const raw=opener(tier,join(f.dir,'server-scopes'));
 const client=await open(t,f,tier,{fetch:async(input,init)=>{
  const path=new URL(input).pathname;
  if(path==='/changes')return parked(init.signal);
  if(path==='/sync'&&cut&&!released)await continuation.promise;
  return fetch(input,init);
 },device:{async open(...args){const core=await raw.open(...args);return {...core,async call(request,committed){
  if(staged&&!released&&request.op==='apply'&&request.page.events.some(e=>e.kind==='scope')){
   cut=true;const reply={ok:{touched:[],published:false}};committed?.(reply);return reply;
  }
  return core.call(request,committed);
 }}}}});
 const watches=['room','room2'].map(room=>client.observe(q('mixedRoom'),{room}));
 watches.forEach(w=>w.subscribe(()=>{}));t.after(()=>watches.forEach(w=>w.close()));
 await until(()=>watches.every(w=>w.getSnapshot().data?.profile?.name==='Bob'));
 assert.equal(answerObservation(watches[1].getSnapshot()).serverOnly,true,'whole server fallback');
 const events=watches.map(()=>[]);watches.forEach((w,i)=>w.subscribe(()=>events[i].push(w.getSnapshot())));
 for(let i=0;i<8;i++)work.schedule(Object.assign(new ReadObservation(),{op:q('held'),subscribers:new Set()}),()=>slots.promise);
 await until(()=>work.active.size===8);
 await f.post('/m/remove',{id:'remove',args:{}});const syncing=client.sync();
 if(staged)await until(()=>cut);else await syncing;
 assert.ok(!('data' in watches[0].getSnapshot()),'affected server-backed answer withdraws immediately');
 assert.equal(watches[1].getSnapshot().data?.rows[0].id,'item2','still-authorized room2 stays visible');
 assert.ok(events[1].every(r=>'data' in r),'no transient sibling withdrawal');
 if(staged){
  assert.ok(!('data' in await client.query(q('mixedRoom'),{room:'room'})),'one-shot server fallback respects pending scope cut');
  assert.equal((await client.query(q('mixedRoom'),{room:'room2'})).data?.rows[0].id,'item2');
 }
});

const combinedSource = twoRooms + `
table archive:
  room: text <=40
  body: text <=200
  at: int
  by byRoom: room, at, id
  read <- exists members[.room, viewer]
  retain delivered-history
  sync to members[.room]
query combinedRoom(room: text):
  profile = profiles['bob']
  rows = messages[room] first 100 by byRoom
  past = archive['past'] first 100 by byRoom
  return { profile, rows, past }
mutation leavePast():
  delete members[room = 'past', principal = 'dev:bob']
query scopeBranches(room: text, choose: bool):
  if choose:
    return messages[room] first 100 by byRoom
  return messages['room2'] first 100 by byRoom
query hiddenPoint():
  return messages['item']
query unscopedPoint():
  profile = profiles['bob']
  row = messages['item2']
  return { profile, row }
`;
for (const tier of ['wasm','process']) test(`${tier}: combined retained/server scopes preserve the authorized room`,async t=>{
 const f=await fixture(t,combinedSource);await seedRoom2(f);
 await f.post('/seed',[
  ...['alice','bob'].map(p=>({table:'members',row:{id:p+'past',room:'past',principal:'dev:'+p}})),
  {table:'archive',row:{id:'archived',room:'past',body:'delivered',at:1}},
 ]);
 let work;const original=ReadWork.prototype.schedule;
 t.mock.method(ReadWork.prototype,'schedule',function(w,run){work=this;return original.call(this,w,run)});
 const slots=Promise.withResolvers();t.after(()=>slots.resolve());
 const client=await open(t,f,tier,{fetch:(input,init)=>new URL(input).pathname==='/changes'?parked(init.signal):fetch(input,init)});
 await f.post('/m/leavePast',{id:'past',args:{}});await client.sync();
 const watches=['room','room2'].map(room=>client.observe(q('combinedRoom'),{room}));
 watches.forEach(w=>w.subscribe(()=>{}));t.after(()=>watches.forEach(w=>w.close()));
 await until(()=>watches.every(w=>w.getSnapshot().data?.past.length===1));
 assert.equal(watches[1].getSnapshot().fresh,false,'the answer actually composes retained and server fields');
 for(let i=0;i<8;i++)work.schedule(Object.assign(new ReadObservation(),{op:q('held'),subscribers:new Set()}),()=>slots.promise);
 await until(()=>work.active.size===8);
 const events=[];watches[1].subscribe(()=>events.push(watches[1].getSnapshot()));
 await f.post('/m/remove',{id:'remove',args:{}});await client.sync();
 assert.ok(!('data' in watches[0].getSnapshot()));
 assert.equal(watches[1].getSnapshot().data?.rows[0].id,'item2');
 assert.ok(events.every(r=>'data' in r),'no temporary sibling withdrawal');
});

test('server audience metadata uses all public branches; unknown point selectors stay conservative',async t=>{
 const f=await fixture(t,combinedSource);await seedRoom2(f);
 const a=await f.post('/q/scopeBranches',{args:{room:'room',choose:true}},'bob');
 const b=await f.post('/q/scopeBranches',{args:{room:'room',choose:false}},'bob');
 assert.deepEqual(a.scopes,b.scopes,'no execution-branch disclosure');
 assert.deepEqual(a.scopes.messages.map(s=>s['0']).sort(),['room','room2']);
 const point=await f.post('/q/unscopedPoint',{args:{}},'bob');
 assert.deepEqual(point.scopes.messages,[{}],'by-id fallback has no public audience prefix');
 const visible=await f.post('/q/hiddenPoint',{args:{}},'bob');
 await f.post('/m/remove',{id:'hide-point',args:{}});
 const hidden=await f.post('/q/hiddenPoint',{args:{}},'bob');
 assert.equal(visible.data.id,'item');assert.equal(hidden.data,null);
 assert.deepEqual(hidden.scopes,visible.scopes,'a hidden point cannot disclose its audience in metadata');
});
