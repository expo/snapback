import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {fixture,open,opener,q,until,parked,sdk} from '../../../packages/snapback4/test/helpers/answers-stay.mjs';
const {answerObservation}=await import(new URL('read-observation.js',sdk));
const {READ_WORK_LIFETIME}=await import(new URL('read-work.js',sdk));
for(const tier of ['wasm','process'])test(`${tier}: expired resumed watermark must not keep running latched`,async t=>{
const f=await fixture(t),base=opener(tier,join(f.dir,'wrapped')),gate=Promise.withResolvers();
let hold=false,blocked=false,queries=0;
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
await new Promise(r=>setTimeout(r,READ_WORK_LIFETIME+100));
const current=watch.getSnapshot();t.diagnostic(JSON.stringify({current,running:owner.running,dirty:owner.dirty,detachedEpoch:owner.detachedEpoch,changeCut:owner.changeCut,queries}));
assert.equal(current.data?.[0]?.body,'replacement','an expired metadata response must release running and allow a fresh attempt');
});
