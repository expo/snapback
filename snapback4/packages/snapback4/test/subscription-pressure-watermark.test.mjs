import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {fixture,open,opener,q,until,parked,sdk} from './helpers/answers-stay.mjs';
const {answerObservation}=await import(new URL('read-observation.js',sdk));
const {READ_WORK_LIFETIME}=await import(new URL('read-work.js',sdk));
for(const tier of ['wasm','process'])for(const expires of [false,true])test(`${tier}: ${expires?'expired':'cancelled'} resumed watermark releases running`,async t=>{
const f=await fixture(t),base=opener(tier,join(f.dir,'wrapped')),gate=Promise.withResolvers();
let hold=false,blocked=false,queries=0;
const deadlines=[],later=globalThis.setTimeout;
t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>{
 const timer=later(fn,ms,...args);
 if(ms===READ_WORK_LIFETIME)deadlines.push(()=>{clearTimeout(timer);fn(...args)});
 return timer;
});
t.after(()=>gate.resolve());
const client=await open(t,f,tier,{fetch:(input,init)=>new URL(input).pathname==='/changes'?parked(init.signal):fetch(input,init),device:{async open(...args){
 const core=await base.open(...args);return {...core,async call(req,commit){
  const result=await core.call(req,commit);
  if(req.op==='query')queries++;
  if(hold&&req.op==='sync_state'){hold=false;blocked=true;await gate.promise}
  return result;
 }};
}}});
const watch=client.observe(q('history'),{c:null});watch.subscribe(()=>{});t.after(()=>watch.close());
await until(()=>watch.getSnapshot().data?.length===1);const owner=answerObservation(watch.getSnapshot());watch.close();
await f.post('/m/edit',{id:'edit',args:{body:'replacement'}});await client.sync();
hold=true;watch.subscribe(()=>{});await until(()=>blocked);
if(expires){assert.equal(READ_WORK_LIFETIME,30000);deadlines.at(-1)()}else{watch.close();watch.subscribe(()=>{})}
await until(()=>watch.getSnapshot().data?.[0]?.body==='replacement','replacement attempt after cancelled/expired metadata response');
const current=watch.getSnapshot();t.diagnostic(JSON.stringify({current,running:owner.running,dirty:owner.dirty,detachedEpoch:owner.detachedEpoch,changeCut:owner.changeCut,queries}));
assert.equal(current.data?.[0]?.body,'replacement','a new subscription should recover without waiting for the cancelled metadata response');
});
