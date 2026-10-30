import test from 'node:test';
import assert from 'node:assert/strict';
import { localStatus } from '../dist/app.js';
import { memorySessionStore } from '../dist/auth.js';
import { mintId } from '../dist/client.js';
import { storeKey } from '../dist/app-storage.js';
import { journalReader } from '../dist/app-journal.js';
import { ProgressiveWrites, progressiveWriteCustody } from '../dist/progressive-writes.js';
import { journalChanges } from '../dist/journal-changes.js';
import { QueryCuts } from '../dist/query-dependencies.js';
import { episodeDeadline } from '../dist/read-episode.js';
import { fixture, gate, tick, until, mutation, query, schema } from './helpers/progressive-writes.mjs';
const regression = (name, work) => test(name, { timeout: 20_000 }, work);
const other = { kind: 'query', name: 'other' };
function track(t) {
  const owners = [], install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', async function(...args) {
    const result = await install.apply(this,args); if (!owners.includes(this)) owners.push(this); return result;
  });
  return owners;
}

for (const failed of [false,true]) regression(`E10 peer ${failed?'validation failure':'sent receipt'} leaves disjoint offline reads usable`, async t => {
  const owners=track(t),store=memorySessionStore(),cuts=[],change=QueryCuts.prototype.change;
  t.mock.method(QueryCuts.prototype,'change',function(...args){cuts.push(args);return change.apply(this,args);});
  const backend=structuredClone(schema);let evaluations=0;
  const a=await fixture(t,{raw:true,store,backend,syncHead:20,wrapCore:core=>({...core,async call(request,...args){if(request.op==='query')evaluations++;return core.call(request,...args);}})});await until(()=>localStatus(a.app.client).getSnapshot().state==='ready');
  const watch=a.app.client.observe(other,{}),seen=[];watch.subscribe(()=>seen.push(watch.getSnapshot()));t.after(()=>watch.close());
  await until(()=>watch.getSnapshot().data==='other');
  const b=await fixture(t,{raw:true,store,mutationRefusal:failed?{code:'E_VALIDATE',family:'input',message:'validation failed'}:undefined});
  const id=mintId(),writing=b.app.client.mutate(mutation,{}, {id,waitSeconds:5});await b.posted.promise;
  await until(()=>!owners[0].uncertain&&owners[0].current().some(write=>write.id===id));
  if(failed){backend.generation=2;await a.app.client.sync();await until(()=>watch.getSnapshot().data==='other');}
  a.offline(true);cuts.length=0;seen.length=0;const before=evaluations;b.release.resolve();
  assert.equal((await writing).state,failed?'failed':'sent');
  await until(()=>!owners[0].uncertain&&!owners[0].current().some(write=>write.id===id));
  await tick();await tick();
  if(failed){assert.equal(b.executions.size,0,'validation did not execute a write');assert.equal(evaluations,before,'failed peer settlement must not reload disjoint watches');}
  else assert.ok(cuts.some(([cut,writes])=>cut===21&&writes?.items===null),'same-generation inspection retains its footprint');
  assert.equal((await a.app.client.query(other,{})).data,'other');
  assert.equal(watch.getSnapshot().data,'other');
  assert.equal(seen.some(read=>read.loading||read.denied),false,'failure did not reload a disjoint retained answer');
  assert.deepEqual(a.requests,[]);
});

regression('E10 public pending writes omit internal store bindings while inspection retains them', async t => {
  const owners=track(t),f=await fixture(t,{raw:true});
  const id=mintId(),writing=f.app.client.mutate(mutation,{}, {id,waitSeconds:5});await f.posted.promise;
  await until(()=>!owners[0].uncertain&&owners[0].current().some(write=>write.id===id));
  const custody=progressiveWriteCustody(f.app.client);
  assert.equal((await custody.inspect()).pending.find(write=>write.id===id).storeId,'A');
  for(const client of [f.app.client,custody.client]) {
    const pending=(await client.pendingWrites()).find(write=>write.id===id);
    assert.ok(pending);assert.equal(Object.hasOwn(pending,'storeId'),false);
    assert.deepEqual(Object.keys(pending).sort(),['args','id','op','predicted','state']);
  }
  f.release.resolve();assert.equal((await writing).state,'sent');
});

regression('E10 opening quarantine warns once per failed preservation streak and reports the side key', async t => {
  const owners=track(t),memory=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice'),warnings=[];
  await memory.set(key,'damaged opening');let fail=true,side;
  const store={...memory,async set(k,value){if(k.startsWith(`${key}.damaged.`)){if(fail)throw Error('preservation blocked');side=k;}return memory.set(k,value);}};
  await fixture(t,{raw:true,store,report:error=>warnings.push(error)});warnings.length=0;
  for(let n=0;n<3;n++)await owners[0].pending();
  assert.equal(warnings.filter(error=>error.why.message.includes('could not be preserved')).length,1);
  assert.equal(await memory.get(key),'damaged opening');fail=false;await owners[0].pending();
  assert.ok(warnings.some(error=>error.why.rewrite.includes(side)));assert.equal(await memory.get(side),'damaged opening');
  // A later healthy read ends the streak for this journal reader.
  const read=journalReader(key,'alice',url,store,error=>warnings.push(error));
  for(let streak=0;streak<2;streak++) {
    await memory.set(key,'damaged again');fail=true;
    for(let n=0;n<2;n++)await assert.rejects(read(true),/preservation blocked/);
    fail=false;await read(true);
  }
  assert.equal(warnings.filter(error=>error.why.message.includes('could not be preserved')).length,3);
});

regression('E10 inspected same-store receipt retains displayed data beyond one second',async t=>{
  const owners=track(t),store=memorySessionStore(),backend=structuredClone(schema),cover=gate(),entered=gate(),seen=[];
  let held=false;
  t.after(()=>cover.resolve());
  const f=await fixture(t,{store,backend,queryReply:async()=>{if(held){entered.resolve();await cover.promise;}return {data:held?'covered':'displayed',complete:true,tables:['items'],scopes:{items:[{}]},seq:held?21:20,store_id:'A',generation:backend.generation};}});
  await f.app.ready;
  const watch=f.app.client.observe(query,{});watch.subscribe(()=>seen.push(watch.getSnapshot()));t.after(()=>watch.close());
  await until(()=>watch.getSnapshot().data==='displayed');
  const key=storeKey('writes',f.url,'alice'),id=mintId(),events=journalChanges(key,()=>{});t.after(()=>events.close());
  await store.set(key,JSON.stringify({owner:'alice',backend:f.url,pending:[{owner:'alice',id,op:'write',args:{},storeId:'A'}],receipts:[]}));events.notify();
  await until(()=>!owners[0].uncertain&&owners[0].current().some(write=>write.id===id));
  held=true;seen.length=0;
  await store.set(key,JSON.stringify({owner:'alice',backend:f.url,pending:[],receipts:[{state:'sent',id,seq:21,replayed:true}]}));events.notify();
  await until(()=>!owners[0].uncertain&&!owners[0].current().some(write=>write.id===id));await entered.promise;
  await new Promise(resolve=>setTimeout(resolve,1150));
  assert.equal(watch.getSnapshot().data,'displayed','inspection supplies no revocation evidence');
  assert.equal(episodeDeadline(watch.getSnapshot()),undefined);
  assert.equal(seen.some(read=>read.loading||read.denied||episodeDeadline(read)!==undefined),false);
  cover.resolve();await until(()=>watch.getSnapshot().data==='covered');
});

regression('E10 awaited same-store adoption advances the online generation before a new receipt',async t=>{
  const backend=structuredClone(schema),store=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice'),id=mintId();
  await store.set(key,JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id,op:'write',args:{},storeId:'A'}],receipts:[]}));
  let observed=0;
  const f=await fixture(t,{raw:true,startup:'awaited',journal:true,backend,store,hold:false,receiptReply:receipt=>({...receipt,generation:backend.generation}),wrapCore:core=>({...core,async call(request,...args){if(request.op==='observe_store')observed++;return core.call(request,...args);}})});
  await until(async()=>(await f.app.client.write(id))?.state==='sent');
  backend.generation=2;await f.app.client.sync();
  // A disjoint watch exposes an unnecessary incarnation reset caused by generation 2.
  const watch=f.app.client.observe(other,{}),seen=[];watch.subscribe(()=>seen.push(watch.getSnapshot()));t.after(()=>watch.close());
  await until(()=>watch.getSnapshot().data==='other');seen.length=0;const before=observed;
  assert.equal((await f.app.client.mutate(mutation,{}, {waitSeconds:5})).state,'sent');
  await until(async()=>!(await f.app.client.pendingWrites()).length);
  assert.equal(observed,before,'the adopted generation needs no new store observation');
  assert.equal(seen.length,0,'same-generation receipt does not reset disjoint watches');
});

for(const method of ['close','signOut'])regression(`E10 ${method} retires recovery when nested custody installation fails`,async t=>{
  const memory=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice'),entered=gate(),release=gate();
  await memory.set(key,'damaged opening');let installs=0,fail=false,progressive,journalReads=0;
  const store={...memory,async get(k){if(k===key)journalReads++;if(k===key&&fail){fail=false;entered.resolve();await release.promise;throw Error('nested custody failed after close');}return memory.get(k);}};
  const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(...args){progressive=this;if(++installs===2)fail=true;return install.apply(this,args);});
  t.after(()=>release.resolve());const f=await fixture(t,{raw:true,store,hold:false,report:()=>{}});
  const recovering=progressive.pending();await entered.promise;
  const ending=f.app.client[method]();release.resolve();await recovering;await ending;const before=installs,readsBefore=journalReads;
  assert.equal((await f.app.client.query(query,{})).denied?.code,'E_CLOSED');
  const write=await f.app.client.mutate(mutation,{}, {waitSeconds:0});
  assert.equal(write.state,'failed');await progressive.pending();await tick();
  assert.equal(installs,before,'closed read/click cannot re-arm nested recovery or install custody');
  assert.equal(journalReads,readsBefore,'closed reads and clicks do not retry the journal opening');
  assert.equal(progressive.custody,undefined);assert.deepEqual(f.requests,[]);
  assert.deepEqual((await f.journal()).pending,[]);assert.deepEqual((await f.journal()).receipts,[]);
});

regression('E10 nested transport preparation failure retains typed admission refusal until custody exists',async t=>{
  const store=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice');await store.set(key,'damaged opening');
  let installs=0,progressive,broken=true,session;
  const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(local,...args){
    progressive=this;
    if(++installs===2){session=local.session;t.mock.method(local,'session',()=>{if(broken)throw Error('transport preparation failed');return session();});}
    return install.call(this,local,...args);
  });
  const f=await fixture(t,{raw:true,store,hold:false,report:()=>{}});
  await progressive.pending();assert.equal(progressive.inspectionFailure?.code,'E_ADMISSION');
  assert.equal((await f.app.client.query(query,{})).denied?.code,'E_ADMISSION','failed nested preparation must not strand reads in uncertain loading');
  assert.equal((await f.app.client.mutate(mutation,{}, {waitSeconds:0})).why?.code,'E_ADMISSION');
  broken=false;await progressive.pending();assert.equal(progressive.inspectionFailure,undefined);
  assert.equal((await f.app.client.mutate(mutation,{}, {waitSeconds:5})).state,'sent');
});
