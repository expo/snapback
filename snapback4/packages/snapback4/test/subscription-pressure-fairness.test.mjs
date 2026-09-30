import test from 'node:test';import assert from 'node:assert/strict';
import {sdk,until,q,parked} from './helpers/answers-stay.mjs';
const {createClient}=await import(new URL('client.js',sdk));
const {ReadWork}=await import(new URL('read-work.js',sdk));
const {answerObservation}=await import(new URL('read-observation.js',sdk));
test('online disjoint ordinary revalidation progresses during continuous hot-table evidence',async t=>{
 const coldRuns=new Map();let seq=1,block=false,work,coldRereads=0,hotStarts=0,starts=0;
 const feed=[],waiting=[],coldStarts=[];const original=ReadWork.prototype.schedule;
 t.mock.method(ReadWork.prototype,'schedule',function(w,run){work=this;if(w.op.name==='cold')coldRuns.set(w,run);return original.call(this,w,run)});
 const client=createClient({url:'http://priority.test',persona:'bob',fetch:async(input,init)=>{
  const path=new URL(input).pathname;
  if(path==='/changes'){const gate=Promise.withResolvers();feed.push(gate);return Response.json(await Promise.race([gate.promise,parked(init.signal)]))}
  if(path==='/probe')return parked(init.signal);
  if(path==='/q/hot'&&block){hotStarts++;starts++;const gate=Promise.withResolvers();waiting.push(gate);await Promise.race([gate.promise,parked(init.signal)])}
  if(path==='/q/cold'&&block){coldRereads++;coldStarts.push(++starts)};
  return Response.json({data:'allowed',complete:true,seq,tables:[path==='/q/cold'?'cold':'hot']});
 }});
 t.after(async()=>{block=false;waiting.splice(0).forEach(g=>g.resolve());feed.splice(0).forEach(g=>g.resolve({seq,tables:[]}));await client.close()});
 const hot=Array.from({length:8},(_,n)=>client.observe(q('hot'),{n}));const cold=Array.from({length:5},(_,n)=>client.observe(q('cold'),{n}));
 for(const w of [...hot,...cold])w.subscribe(()=>{});
 await until(()=>[...hot,...cold].every(w=>w.getSnapshot().data==='allowed')&&work.active.size===0);
 const owners=hot.map(w=>answerObservation(w.getSnapshot()));block=true;
 async function change(){await until(()=>feed.length);seq++;feed.shift().resolve({seq,tables:['hot']});}
 await change();await until(()=>waiting.length===8);
 starts=0;for(const watch of cold){const owner=answerObservation(watch.getSnapshot());owner.reload();work.schedule(owner,coldRuns.get(owner));}
 for(let round=0;round<20;round++){
  await change();await until(()=>owners.every(w=>w.dirty));
  waiting.splice(0).forEach(g=>g.resolve());await until(()=>waiting.length===8);
 }
 t.diagnostic(JSON.stringify({hotStarts,coldRereads,cold:cold.map(w=>w.getSnapshot()),coldStarts,pending:work.pending.size,active:work.active.size}));
 assert.equal(coldRereads,5,'every waiting ordinary revalidation starts');
 coldStarts.forEach((start,index)=>assert.ok(start<=9*(index+1),`ordinary ${index} starts at ${start}, bound ${9*(index+1)}`));
});
