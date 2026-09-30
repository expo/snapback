// @ref LLP 3000.023#10 — epoch invalidation reevaluates; only intersecting cuts withhold.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,open,q,until,parked,sdk} from './helpers/answers-stay.mjs';
const {LocalReads,localWatch}=await import(new URL('local-reads.js',sdk));
for(const tier of ['wasm','process'])for(const intersects of [false,true])test(`${tier}: resumed handle inherits ${intersects?'intersecting':'unrelated'} notification`,async t=>{
 const f=await fixture(t),feed=Promise.withResolvers(),gate=Promise.withResolvers();let sent=false,hold=false,blocked=false;
 t.after(()=>{feed.resolve({seq:0,tables:[]});gate.resolve()});
 const client=await open(t,f,tier,{fetch:async(input,init)=>{
  const path=new URL(input).pathname;
  if(path==='/changes'){if(sent)return parked(init.signal);sent=true;return Response.json(await Promise.race([feed.promise,parked(init.signal)]))}
  if(path==='/sync'&&hold){blocked=true;await gate.promise}return fetch(input,init);
 }});
 const watch=client.observe(q('history'),{c:null});watch.subscribe(()=>{});t.after(()=>watch.close());
 await until(()=>watch.getSnapshot().data?.length===1);watch.close();
 hold=true;
 const change=intersects?await f.post('/m/edit',{id:'edit',args:{body:'replacement'}}):await f.post('/seed',[{table:'profiles',row:{id:'other',name:'Other'}}]);
 const head=intersects?change.seq:(await f.post('/q/profile',{args:{}})).seq;
 assert.ok(Number.isFinite(head));feed.resolve({seq:head,tables:[intersects?'messages':'profiles']});await until(()=>blocked);
 assert.ok(!('data' in watch.getSnapshot()),'epoch discards the saved answer even for unrelated evidence');
 const events=[];watch.subscribe(()=>events.push(watch.getSnapshot()));
 if(!intersects){
  assert.equal((await client.query(q('history'),{c:null})).data?.[0]?.body,'image-1');
  await until(()=>watch.getSnapshot().data?.[0]?.body==='image-1','unrelated notification permits local reevaluation before sync');
 }else{
  await delay(1250);assert.ok(!('data' in watch.getSnapshot()));
  assert.ok(events.every(read=>!('data' in read)),'older replica cannot recertify an intersecting answer');
 }
 gate.resolve();await client.sync();
 await until(()=>watch.getSnapshot().data?.[0]?.body===(intersects?'replacement':'image-1'));
});
test('notification cuts keep unknown dependencies conservative and forget applied tables',()=>{
 const reads=new LocalReads(),watch=tables=>Object.assign(localWatch(undefined,q('x'),{},'x',0,()=>false),{tables:new Set(tables)});
 const known=watch(['messages']),unknown=watch([]);reads.detach(known);reads.detach(unknown);
 reads.notified(['profiles'],2);reads.resume(known);reads.resume(unknown);
 assert.equal(known.changeCut,undefined);assert.equal(unknown.changeCut,2);
 reads.notified(undefined,3);reads.resume(known);assert.equal(known.changeCut,3);
 reads.applied([],2);reads.resume(unknown);assert.equal(unknown.changeCut,3);
 reads.applied([],3);const fresh=watch(['messages']);reads.detach(fresh);reads.resume(fresh);assert.equal(fresh.changeCut,undefined);
});
