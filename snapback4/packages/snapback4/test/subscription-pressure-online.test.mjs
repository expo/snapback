// @ref LLP 3000.023#10 — ambiguous evidence gets the next slot, never a ninth one.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,open,source,q,until,parked,sdk} from './helpers/answers-stay.mjs';
const {ReadObservation,answerObservation}=await import(new URL('read-observation.js',sdk));
const {ReadWork}=await import(new URL('read-work.js',sdk));

test('online authorized sibling re-read jumps ordinary queued work after evidence',async t=>{
 const f=await fixture(t,source+`\nquery roomHistory(room: text):\n  return messages[room] first 100 by byRoom\n`);
 await f.post('/seed',[
  ...['alice','bob'].map(p=>({table:'members',row:{id:p+'2',room:'room2',principal:'dev:'+p}})),
  {table:'messages',row:{id:'item2',room:'room2',body:'permitted',at:1}},
 ]);
 const feed=Promise.withResolvers(),slots=Array.from({length:8},()=>Promise.withResolvers());
 let work, armed=false, delivered=false;const starts=[];
 const original=ReadWork.prototype.schedule;
 t.mock.method(ReadWork.prototype,'schedule',function(w,run){
  work=this;return original.call(this,w,async signal=>{if(armed)starts.push(w);return run(signal)});
 });
 t.after(()=>{feed.resolve({seq:0,tables:[]});slots.forEach(s=>s.resolve())});
 const client=await open(t,f,'online',{fetch:async(input,init)=>{
  if(new URL(input).pathname==='/changes'){
   if(delivered)return parked(init.signal);delivered=true;return Response.json(await feed.promise);
  }
  return fetch(input,init);
 }});
 const watch=client.observe(q('roomHistory'),{room:'room2'});watch.subscribe(()=>{});t.after(()=>watch.close());
 await until(()=>watch.getSnapshot().data?.length===1);
 const owner=answerObservation(watch.getSnapshot());
 await until(()=>!owner.inFlight);
 for(const slot of slots)work.schedule(Object.assign(new ReadObservation(),{op:q('held'),subscribers:new Set()}),()=>slot.promise);
 await until(()=>work.active.size===8);
 for(let i=0;i<40;i++)work.schedule(Object.assign(new ReadObservation(),{op:q('ordinary'),subscribers:new Set()}),()=>slots[1].promise);
 const removal=await f.post('/m/remove',{id:'remove',args:{}});
 feed.resolve({seq:removal.seq,tables:['messages','members']});
 await until(()=>work.state(owner)==='queued');
 const events=[];watch.subscribe(()=>events.push(watch.getSnapshot()));
 armed=true;slots[0].resolve();
 await until(()=>starts.length>0);
 assert.equal(starts[0],owner,'evidence goes before the forty ordinary queued reads');
 assert.ok(work.active.size<=8);
 await until(()=>watch.getSnapshot().data?.[0].id==='item2'&&!watch.getSnapshot().revalidating);
 assert.ok(events.every(r=>'data' in r),'authorized sibling completes without reaching its bound');
});

test('evidence priority survives an active attempt retiring into the queue',async t=>{
 const work=new ReadWork(), first=Promise.withResolvers(), held=Promise.withResolvers(), starts=[];
 const owner={};t.after(()=>{first.resolve();held.resolve();work.clear()});
 work.schedule(owner,async()=>{await first.promise;work.schedule(owner,async()=>{starts.push('evidence')})});
 for(let i=0;i<7;i++)work.schedule({},()=>held.promise);
 await until(()=>work.active.size===8);
 for(let i=0;i<20;i++)work.schedule({},async()=>{starts.push('ordinary');await held.promise});
 work.prioritize?.(owner);first.resolve();
 await until(()=>starts.length>0);
 assert.equal(starts[0],'evidence','dirty active work keeps priority when its old attempt settles');
});
