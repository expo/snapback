// @ref LLP 3000.023#10 — detached reuse must account for all evidence, including staged publication.
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,source,open,opener,q,until,parked,sdk} from './helpers/answers-stay.mjs';
const {answerObservation}=await import(new URL('read-observation.js',sdk));
for (const tier of ['wasm','process']) for(const mounted of [false,true]) test(`${tier}: detached handle must respect notified cut before sync, mounted control=${mounted}`,async t=>{
 const f=await fixture(t),feed=Promise.withResolvers(),syncGate=Promise.withResolvers();let sent=false,holdSync=false,blocked=false;
 t.after(()=>{feed.resolve({seq:0,tables:[]});syncGate.resolve()});
 const client=await open(t,f,tier,{fetch:async(input,init)=>{
  const path=new URL(input).pathname;
  if(path==='/changes'){if(sent)return parked(init.signal);sent=true;return Response.json(await feed.promise)}
  if(path==='/sync'&&holdSync){blocked=true;await syncGate.promise;}
  return fetch(input,init);
 }});
 const old=client.observe(q('history'),{c:null});old.subscribe(()=>{});t.after(()=>old.close());
 await until(()=>old.getSnapshot().data?.length===1);old.close();
 const sentinel=mounted?client.observe(q('item'),{}):undefined;
 if(sentinel){sentinel.subscribe(()=>{});t.after(()=>sentinel.close());await until(()=>sentinel.getSnapshot().data?.id==='item')}
 holdSync=true;const removal=await f.post('/m/remove',{id:'remove',args:{}});
 feed.resolve({seq:removal.seq,tables:['members','messages']});await until(()=>blocked);
 const before=old.getSnapshot();const events=[];old.subscribe(()=>events.push(old.getSnapshot()));
 await delay(1250);const after=old.getSnapshot();
 t.diagnostic(JSON.stringify({before,after,events,sentinel:sentinel?.getSnapshot()}));
 assert.ok(!('data' in before),'closed getter withdraws before subscription');
 assert.ok(events.every(r=>!('data' in r)),'no callback may recertify the old replica');
 syncGate.resolve();await client.sync();await until(()=>old.getSnapshot().data?.length===0);
 assert.ok(!('data' in after),'a saved pre-notification answer must not be recertified by the older replica');
});
for(const tier of ['wasm','process'])for(const retain of [false,true])test(`${tier}: closed snapshot read during stage must recover after publication, retained=${retain}`,async t=>{
 const program=retain ? source.replace('  sync to members[.room]\ntable profiles:', '  retain delivered-history\n  sync to members[.room]\ntable profiles:') : source;
 const f=await fixture(t,program),raw=opener(tier,join(f.dir,'stage-resume')),gate=Promise.withResolvers();let staged=false,released=false;
 t.after(()=>{released=true;gate.resolve()});
 const client=await open(t,f,tier,{fetch:async(input,init)=>{
  const p=new URL(input).pathname;if(p==='/changes')return parked(init.signal);
  if(p==='/sync'&&staged&&!released)await gate.promise;return fetch(input,init);
 },device:{async open(...args){const core=await raw.open(...args);return {...core,async call(req,committed){
  if(req.op==='apply'&&!released&&req.page.events.some(e=>e.kind==='scope')){staged=true;const result={ok:{touched:[],published:false}};committed?.(result);return result}
  return core.call(req,committed);
 }}}}});
 const watch=client.observe(q('history'),{c:null});watch.subscribe(()=>{});t.after(()=>watch.close());
 await until(()=>watch.getSnapshot().data?.length===1);const owner=answerObservation(watch.getSnapshot());watch.close();
 await f.post('/m/remove',{id:'remove',args:{}});const syncing=client.sync();await until(()=>staged);
 const during=watch.getSnapshot();released=true;gate.resolve();await syncing;
 assert.ok(!('data' in during),'getter withdraws at the staged epoch');
 const direct=await client.query(q('history'),{c:null});watch.subscribe(()=>{});await until(()=> 'data' in watch.getSnapshot());
 t.diagnostic(JSON.stringify({during,direct,after:watch.getSnapshot(),scopeCut:owner.scopeCut,changeCut:owner.changeCut,waiting:owner.waitingForSync,running:owner.running}));
 assert.equal(direct.data.length,retain?1:0,'engine authorizes retained history only');
 assert.deepEqual(watch.getSnapshot().data,direct.data,'published replica must deliver the authorized answer');
});
