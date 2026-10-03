import test from 'node:test';
import assert from 'node:assert/strict';
import { SeenOwner } from '../dist/seen-progress.js';

const family = { name: 'chat', fingerprint: 'binding', member: {kind:'query',name:'member'}, seen: {kind:'mutation',name:'seen'},
  scopeArgument:'room',throughArgument:'to',mapping:{floor:'joined',seen:'viewed'} };
const ready = data => ({data, complete:true, fresh:true, cut:null, since:0, existence:data ? 'present':'absent'});
const member = (seen=0,id='b',floor=0) => ready({id,joined:floor,viewed:seen});
const tick = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };
const failed = code => ({state:'failed',id:'failure',why:{code,family:'store',message:code}});
const sent = id => ({state:'sent',id,seq:1});
function fixture() {
  let value=member(),viewer='bob'; const events={viewer:new Set(),session:new Set(),link:new Set(),write:new Set()};
  const observations=[], calls=[], receipts=new Map();
  const listen=kind=>fn=>{events[kind].add(fn);return()=>events[kind].delete(fn);};
  const emit=(kind,value)=>{for(const fn of events[kind])fn(value);};
  const client={viewer:()=>viewer,onViewer:listen('viewer'),onSession:listen('session'),onLink:listen('link'),onWrite:listen('write'),
    write:async id=>receipts.get(id),
    observe(op,args){const subs=new Set();const obs={op,args,closed:false,listenerCount:()=>subs.size,getSnapshot:()=>value,subscribe(fn){subs.add(fn);return()=>subs.delete(fn);},close(){obs.closed=true;subs.clear();},set(next){value=next;for(const fn of subs)fn();}}; observations.push(obs);return obs;},
    mutate(op,args,options){return new Promise((resolve,reject)=>calls.push({op,args,options,resolve,reject}));}
  };
  return {client,calls,observations,emit,receipts,set(next){value=next;for(const obs of observations.filter(o=>!o.closed))obs.set(next);},
    listenerCount:()=>Object.values(events).reduce((sum,listeners)=>sum+listeners.size,0)+observations.reduce((sum,obs)=>sum+obs.listenerCount(),0),
    viewer(next){viewer=next;emit('viewer',next);},
    owner(scope='c',binding=family){const owner=new SeenOwner(client,binding,scope);const stop=owner.subscribe(()=>{});return {owner,stop,show:(through,active=true)=>owner.update(through,active)};}};
}
test('two screens coalesce confirmed visible progress; hidden pages never page or report delivery',async()=>{
 const f=fixture(),a=f.owner(),b=f.owner();
 assert.equal(f.listenerCount(),5,'shared member and four client subscriptions');
 a.show(4);b.show(9);await tick();assert.equal(f.observations.length,1);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].args,{room:'c',to:9});
 a.show(30,false);b.show(7);await tick();assert.equal(f.calls.length,1);
 f.calls[0].resolve(sent('one'));await tick();assert.equal(f.calls.length,1);
 b.show(10);await tick();assert.equal(f.calls.length,2);assert.equal(f.calls[1].options.waitSeconds,0);assert.equal(f.calls[1].options.id.length,26);
 a.stop();await tick();assert.equal(f.listenerCount(),5);b.stop();await tick();assert.equal(f.listenerCount(),0);assert.ok(f.observations.every(o=>o.closed));assert.deepEqual(f.calls.map(c=>c.op.name),['seen','seen']);
});
test('pending custody deduplicates until terminal outcome, including settlement before admission resolution',async()=>{
 const f=fixture(),a=f.owner();a.show(5);await tick();f.calls[0].resolve({state:'pending',id:'one'});await tick();
 a.show(8);await tick();assert.equal(f.calls.length,1);assert.equal(a.owner.getSnapshot().state,'pending');
 f.emit('write',sent('one'));await tick();assert.equal(f.calls.length,2);
 f.receipts.set('two',sent('two'));f.emit('write',sent('two'));f.calls[1].resolve({state:'pending',id:'two'});await tick();
 assert.equal(a.owner.getSnapshot().state,'idle');a.show(8);await tick();assert.equal(f.calls.length,2);a.stop();await tick();
});
test('known admission failures retry with bounded backoff, explicit repair and hidden-screen suppression',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const code of ['E_ADMISSION','E_ADMISSION_STORE','E_ADMISSION_TIMEOUT']){
  const f=fixture(),a=f.owner();a.show(5);await tick();f.calls[0].resolve(failed(code));await tick();
  assert.equal(a.owner.getSnapshot().state,'retrying');t.mock.timers.tick(999);await tick();assert.equal(f.calls.length,1);
  a.show(50,false);t.mock.timers.tick(1);await tick();assert.equal(f.calls.length,1);
  a.show(5);await tick();assert.equal(f.calls.length,2);f.calls[1].resolve(failed(code));await tick();
  a.owner.retry();await tick();assert.equal(f.calls.length,3);assert.equal(f.calls[2].args.to,5);
  f.calls[2].resolve(sent('ok'));await tick();assert.equal(a.owner.getSnapshot().state,'idle');a.stop();await tick();
 }
});
test('eight retries park; reconnect can wake known admission failures, terminal and thrown outcomes cannot',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(),a=f.owner();a.show(5);await tick();
 for(let i=0;i<9;i++){assert.equal(f.calls.length,i+1);f.calls[i].resolve(failed('E_ADMISSION'));await tick();t.mock.timers.tick(60_000);await tick();}
 assert.equal(f.calls.length,9);assert.equal(a.owner.getSnapshot().state,'failed');
 a.show(5);await tick();assert.equal(f.calls.length,9,'a render cannot bypass the failed guard after exhausted admission retries');
 f.emit('link','online');await tick();assert.equal(f.calls.length,10);
 f.calls[9].resolve(failed('NOT_MEMBER'));await tick();a.owner.retry();f.emit('link','online');t.mock.timers.tick(60_000);await tick();assert.equal(f.calls.length,10);a.stop();await tick();
 const g=fixture(),b=g.owner();b.show(8);await tick();g.calls[0].reject(Error('unknown'));await tick();assert.equal(b.owner.getSnapshot().why.code,'E_CLIENT');b.owner.retry();await tick();assert.equal(g.calls.length,1);b.stop();await tick();
});
test('terminal refusals discard the rejected target and accept a different fresh visible position',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const code of ['PAST_LAST_MESSAGE','NOT_MEMBER','E_CLIENT']){
  const f=fixture();f.set(member(20,'b',10));const a=f.owner();
  a.show(100);await tick();assert.deepEqual(f.calls[0].args,{room:'c',to:100});
  a.show(120);await tick();assert.equal(f.calls.length,1,'later input waits behind the flight');
  if(code==='E_CLIENT')f.calls[0].reject(Error('unknown'));else f.calls[0].resolve(failed(code));
  await tick();assert.equal(a.owner.getSnapshot().state,'failed');assert.equal(a.owner.getSnapshot().why.code,code);
  assert.equal(a.owner.getSnapshot().through,20,'terminal failure resets target to covered progress');
  a.owner.retry();f.emit('link','online');t.mock.timers.tick(60_000);await tick();
  for(const n of [100,20,10,null,NaN,Infinity,40.5,Number.MAX_SAFE_INTEGER+1])a.show(n);
  a.show(40,false);await tick();assert.equal(f.calls.length,1);assert.equal(a.owner.getSnapshot().state,'failed');
  a.show(40);await tick();assert.deepEqual(f.calls.map(c=>c.args.to),[100,40]);
  f.calls[1].resolve(sent('forty'));await tick();a.owner.retry();a.show(100);await tick();
  assert.deepEqual(f.calls.map(c=>c.args.to),[100,40],'neither retry nor a repeated view resubmits the rejected position');
  f.set({loading:true});f.set(member(0,'new',30));a.show(100);await tick();
  assert.deepEqual(f.calls.map(c=>c.args.to),[100,40,100],'membership reset clears the rejected position');
  a.stop();await tick();assert.equal(f.listenerCount(),0);
 }
});
test('member withdrawal, replacement, join floor and client/session fences discard old progress and late callbacks',async()=>{
 for(const fence of ['loading','denied','absent','pending','rejoin','viewer','session','signed-out']){
  const f=fixture(),a=f.owner();a.show(10);await tick();
  if(fence==='loading')f.set({loading:true});
  if(fence==='denied')f.set({denied:{code:'NOT_MEMBER'}});
  if(fence==='absent')f.set(ready(null));
  if(fence==='pending')f.set(ready({id:'b',joined:0,viewed:0,pending:true}));
  if(fence==='rejoin')f.set(member(0,'new',20));
  if(fence==='viewer')f.viewer('alice');
  if(fence==='session')f.emit('session',{token:'rotated'});
  if(fence==='signed-out')f.emit('link','signed-out');
  assert.equal(a.owner.getSnapshot().through,0,fence);f.calls[0].resolve(failed('E_ADMISSION'));await tick();
  assert.equal(a.owner.getSnapshot().state,'idle',fence);f.set(member(0,'new',20));await tick();assert.equal(f.calls.length,1,fence);
  a.show(19);await tick();assert.equal(f.calls.length,1);a.show(20);await tick();assert.equal(f.calls.length,1,'join floor is already covered');a.show(21);await tick();assert.equal(f.calls.length,2);a.stop();await tick();
 }
});
test('same-turn Strict Mode replay shares flight; remount, scope, family and client replacement do not inherit debt',async()=>{
 const f=fixture(),a=f.owner();a.show(4);await tick();a.stop();const b=f.owner();b.show(4);await tick();assert.equal(f.calls.length,1);assert.equal(f.listenerCount(),5);b.stop();await tick();assert.equal(f.listenerCount(),0,'final Strict Mode unmount releases every listener');
 const c=f.owner();c.show(0);await tick();assert.equal(f.calls.length,1);const d=f.owner('other');d.show(0);const e=f.owner('c',{...family,fingerprint:'new'});e.show(0);await tick();assert.equal(f.calls.length,1);
 const g=fixture(),other=g.owner();other.show(0);await tick();assert.equal(g.calls.length,0);
 f.calls[0].resolve(sent('old'));await tick();assert.equal(c.owner.getSnapshot().through,0);[c,d,e,other].forEach(x=>x.stop());await tick();
 assert.equal(f.listenerCount(),0);assert.equal(g.listenerCount(),0);
});
test('invalid positions and provisional visible rows never report; current seen and floors suppress duplicates',async()=>{
 const f=fixture(),a=f.owner();for(const n of [null,-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])a.show(n);await tick();assert.equal(f.calls.length,0);
 const visible=[{ordinal:80,pending:true},{ordinal:7}];a.show(Math.max(0,...visible.filter(m=>!m.pending).map(m=>m.ordinal)));await tick();assert.equal(f.calls[0].args.to,7);
 f.calls[0].resolve(sent('seven'));await tick();f.set(member(9));a.show(9);await tick();assert.equal(f.calls.length,1);a.stop();await tick();
});

test('a terminal notification before admission resolution survives even when receipt storage is unavailable',async()=>{
 const f=fixture(),a=f.owner();a.show(5);await tick();const id=f.calls[0].options.id;
 f.client.write=async()=>{throw Error('storage unavailable');};f.emit('write',sent(id));
 f.calls[0].resolve({state:'pending',id});await tick();assert.equal(a.owner.getSnapshot().state,'idle');
 a.show(6);await tick();assert.equal(f.calls.length,2);a.stop();await tick();
});
