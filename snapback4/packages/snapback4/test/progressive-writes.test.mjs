import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp, localStatus } from '../dist/app.js';
import { memorySessionStore, sessionKey } from '../dist/auth.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { mintId } from '../dist/client.js';
import { storeKey, storeLock } from '../dist/app-storage.js';
import { createLocalClient } from '../dist/local.js';
import { prepareClient } from '../dist/client-start.js';
import { ProgressiveWrites, progressiveWriteCustody, prepareProgressiveWrites } from '../dist/progressive-writes.js';
import { journalChanges } from '../dist/journal-changes.js';
import { OnlineCapture } from '../dist/online-capture.js';
import { pendingIntentAccess } from '../dist/pending-items.js';
import { QueryCustody } from '../dist/query-custody.js';
import { evaluateLocal } from '../dist/local-query.js';
import { LocalReads } from '../dist/local-reads.js';
import { mutationEntry } from '../dist/admission.js';
import { DeviceVersionError } from '../dist/device-version.js';
import { deviceControl } from '../dist/device-control.js';
import { deviceRestore } from '../dist/device-restore.js';
import { episodeDeadline } from '../dist/read-episode.js';
const wasm = new WebAssembly.Module(readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)));
const gate = () => Promise.withResolvers();
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(fn) { for (let n=0;n<1000;n++) { if(await fn()) return; await tick(); } assert.fail('condition did not arrive'); }
const mutation = {kind:'mutation',name:'write'}, query = {kind:'query',name:'read'};
const schema = {generation:1,store_id:'A',schema:{tables:{}},programs:[
  {name:'read',kind:'Query',args:{},body:[{Return:{Literal:{String:'local'}}}],settlement:{reads:{items:null},writes:{}}},
  {name:'write',kind:'Mutation',args:{},body:[{Return:{Literal:{String:'written'}}}],settlement:{reads:{},writes:{items:null}}},
  {name:'other',kind:'Query',args:{},body:[{Return:{Literal:{String:'other'}}}],settlement:{reads:{other:null},writes:{}}},
  {name:'constant',kind:'Query',args:{},body:[{Return:{Literal:{String:'constant'}}}],settlement:{reads:{},writes:{}}},
]};
async function fixture(t, {hold=true, drop=false, custody='none', store=memorySessionStore(), persist=memoryPersistence(), raw=false,
  backend=schema, failure, badEngine=false, wrapCore=core=>core, queryReply, receiptReply, refreshReply, syncHead, syncWait, authority, report=console.error, basePath='', startup='progressive', persona=false}={}) {
  const url=(persona?'http://127.0.0.1:4400':'https://progressive-writes.invalid')+basePath, release=gate(), posted=gate(), coreGate=gate();
  let head=20, requests=[], executions=new Map(), reads=0, failStore, coreOpens=0, offline=false, revokes=0, failSync, storeId='A',changes=[];
  await store.set(sessionKey(url),JSON.stringify({token:'token',principal:'alice',kind:'user',expiresAt:Date.now()+7*86400000}));
  if(raw)coreGate.resolve();
  const inner=webDevice({wasm,persist});
  const device={custody:async()=>custody,async open(...args){coreOpens++;await coreGate.promise;if(failure)throw failure;const core=await inner.open(...args);
    return wrapCore({...core,call:(request,...rest)=>badEngine&&request.op==='engine_info'?Promise.resolve({ok:{format:0}}):core.call(request,...rest)});}};
  const fetch=async(input,init)=>{
    const path=new URL(input).pathname.slice(basePath.length);
    if(offline)throw new TypeError('offline witness');
    if(path==='/schema')return Response.json({...backend,store_id:storeId});
    if(path==='/probe')return Response.json({ok:true,viewer:'alice',scope:'full',store_id:storeId,seq:head,generation:backend.generation});
    if(path==='/sync'){await syncWait?.promise;if(failSync)return Response.json({denied:failSync},{status:409});return Response.json({generation:backend.generation,store_id:storeId,snapshot:!JSON.parse(init.body).stream,watermark:syncHead??head,images_at:syncHead??head,events:[],committed_above:{},more:false});}
    if(path==='/changes')return new Promise((resolve,reject)=>{changes.push(body=>resolve(Response.json(body)));if(init.signal.aborted)reject(init.signal.reason);else init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});
    if(path==='/auth/login')return Response.json({ok:true,session:{token:'bob-token',principal:'bob',kind:'user',expiresAt:Date.now()+7*86400000}});
    if(path==='/auth/refresh'&&refreshReply)return refreshReply();
    if(path.startsWith('/auth/')){revokes++;return Response.json({ok:true,revoked:1});}
    if(path.startsWith('/m/')){
      const body=JSON.parse(init.body);requests.push(body.id);
      if(failStore)return Response.json({denied:failStore},{status:409});
      const replayed=executions.has(body.id);
      if(!replayed)executions.set(body.id,++head);
      posted.resolve(); if(drop){drop=false;throw Error('response lost after commit');}
      if(hold)await release.promise;
      const receipt={state:'sent',seq:executions.get(body.id),head,store_id:storeId,generation:1,replayed};
      return Response.json(receiptReply?.(receipt)??receipt);
    }
    reads++;return Response.json(await queryReply?.(path,head)??{data:'server',complete:true,tables:path.endsWith('/constant')?[]:path.endsWith('/other')?['other']:['items'],seq:head,store_id:storeId,generation:1});
  };
  let local;
  const options={url,sessionStore:store,...(startup?{startup}:{}),...(persona?{persona:"alice"}:{}),device:{...device,async open(...args){const core=await device.open(...args);return {...core,onClient(client){local=client;}};}},fetch};
  let app;
  if(raw){if(startup!=='awaited')prepareProgressiveWrites(options,{store,report,authority});const prepared=await prepareClient(options,()=>createLocalClient(options));local=prepared.client;app={client:local,mutate:local.mutate,close:local.close,ready:Promise.resolve({ok:true})};progressiveWriteCustody(local)?.start();await prepared.start();}
  else app=createApp(options);
  t.after(async()=>{release.resolve();coreGate.resolve();syncWait?.resolve();await app.close();});
  return {app,store,url,requests,executions,posted,release,coreGate,reads:()=>reads,coreOpens:()=>coreOpens,local:()=>local,
    device:options.device, reopen:async(overrides)=>{await app.close();app=createApp({...options,...overrides});return app;},
    journal:async()=>JSON.parse(await store.get(storeKey('writes',url,persona?'dev:alice':'alice'))??'null'), change:body=>{const next=changes.shift();next?.(body);return !!next;}, fail:why=>{failStore=why;}, failSync:why=>{failSync=why;}, replace:id=>{storeId=id;head=0;}, head:value=>{head=value;}, offline:value=>{offline=value;}, revokes:()=>revokes};
}

test('journal keeps its id, pending surfaces and receipt owner after attachment; no outbox admission',async t=>{
  const f=await fixture(t);assert.equal((await f.app.ready).ok,true);
  const id=mintId(), receipts=[];f.app.client.onWrite(w=>receipts.push(w));
  const writing=f.app.mutate(mutation,{}, {id}); await f.posted.promise;
  assert.deepEqual((await f.app.client.pendingWrites()).map(w=>w.id),[id]);
  assert.deepEqual((await pendingIntentAccess(f.app.client).read()).map(w=>w.write.id),[id]);
  f.coreGate.resolve();await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  assert.equal(f.requests.length,1);assert.equal((await f.journal()).pending[0].id,id);
  f.release.resolve();assert.equal((await writing).state,'sent');
  await until(()=>receipts.length===1);assert.equal(receipts[0].id,id);
  assert.equal((await f.app.client.write(id)).state,'sent');assert.equal(f.executions.size,1);
  const second=await f.app.mutate(mutation,{});assert.equal(second.state,'sent');
  assert.ok((await f.journal()).receipts.some(w=>w.id===second.id),'attachment did not change owner');
});

test('lost response retries the original id once committed, with one receipt',async t=>{
  const f=await fixture(t,{hold:false,drop:true});await f.app.ready;
  const id=mintId(),receipts=[];f.app.client.onWrite(w=>receipts.push(w));
  await f.app.mutate(mutation,{}, {id,waitSeconds:0});
  await until(async()=> (await f.app.client.write(id))?.state==='sent');
  assert.ok(f.requests.length>=2);assert.deepEqual([...new Set(f.requests)],[id]);
  assert.equal(f.executions.size,1);assert.deepEqual(receipts.map(w=>w.id),[id]);
});

test('server and local dependent reads wait on journal custody; disjoint read proceeds',async t=>{
  const f=await fixture(t);await f.app.ready;
  const writing=f.app.mutate(mutation,{});await f.posted.promise;
  const waiting=[];const blocked=QueryCustody.prototype.wait;
  t.mock.method(QueryCustody.prototype,'wait',function(...args){waiting.push(args[0]);return blocked.apply(this,args);});
  let answered=false;const read=f.app.client.query(query,{}).then(value=>{answered=true;return value;});
  await until(()=>waiting.length>0);assert.equal(answered,false);
  const disjoint=await f.app.client.query({kind:'query',name:'other'},{});assert.equal(disjoint.data,'server',JSON.stringify(disjoint));
  f.coreGate.resolve();await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  await tick();assert.equal(answered,false);
  f.release.resolve();assert.equal((await writing).state,'sent');
  assert.ok('data' in await read);
});

test('empty journal permits reads before and after attachment; custody revalidation retains displayed data',async t=>{
  const f=await fixture(t);await f.app.ready;
  assert.equal((await f.app.client.query(query,{})).data,'server');
  const observed=f.app.client.observe(query,{}), seen=[];
  const stop=observed.subscribe(()=>seen.push(observed.getSnapshot()));
  t.after(()=>{stop();observed.close();});
  await until(()=>observed.getSnapshot().data==='server');
  const first=seen.findIndex(read=>'data' in read);
  const writing=f.app.mutate(mutation,{});await f.posted.promise;
  assert.equal(observed.getSnapshot().data,'server');
  f.coreGate.resolve();await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  // Let the attachment and journal notifications finish their read attempts.
  await until(()=>!('loading' in observed.getSnapshot())&&observed.getSnapshot().revalidating);
  assert.equal(observed.getSnapshot().data,'server','no local prediction of journal intent');
  assert.equal(seen.slice(first).some(read=>'loading' in read),false,JSON.stringify(seen));
  f.release.resolve();assert.equal((await writing).state,'sent');
  assert.ok('data' in await f.app.client.query(query,{}),'empty settled journal must not park a new read');
});

test('outbox decision is monotonic and refuses journal captures with typed rewrite',async t=>{
  const f=await fixture(t,{custody:'present',hold:false,raw:true});f.coreGate.resolve();await f.app.ready;
  await until(()=>f.local());const owner=progressiveWriteCustody(f.local());assert.ok(owner);
  const first=await f.app.mutate(mutation,{});assert.equal(first.state,'sent');
  owner.start();const denied=await owner.client.mutate(mutation,{}, {id:mintId()});
  assert.equal(denied.state,'failed');assert.equal(denied.why.code,'E_ADMISSION');assert.match(denied.why.rewrite,/app.mutate/);
  assert.equal(f.requests.length,1);assert.equal((await f.journal())?.pending.length??0,0);
  assert.equal((await f.journal())?.receipts.some(write=>write.id===first.id)??false,false,'the app write used the outbox');
});

for(const dispatched of [false,true]) test(`reopen sees ${dispatched?'issued/unknown':'pending'} journal intent and preserves id despite existing device`,async t=>{
  const store=memorySessionStore(),id=mintId(),url='https://progressive-writes.invalid';
  await store.set(storeKey('writes',url,'alice'),JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id,op:'write',args:{},storeId:'A',dispatched}],receipts:[]}));
  const f=await fixture(t,{store,custody:'present',hold:false});assert.equal((await f.app.ready).ok,true);
  assert.equal((await f.app.client.query({kind:'query',name:'constant'},{})).data,'server','authenticated read with a proven empty footprint answers while WASM is held');
  assert.deepEqual(f.requests,[],'journal sending still waits for the device prefix');
  f.coreGate.resolve();
  await until(async()=> (await f.app.client.write(id))?.state==='sent');
  assert.deepEqual(f.requests,[id]);assert.equal(f.executions.size,1);
});

for(const attached of [false,true]) test(`logout fences journal dispatch and recovery (attached=${attached})`,async t=>{
  const f=await fixture(t);await f.app.ready;if(attached){f.coreGate.resolve();await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');}
  const view=f.app.client,id=mintId();const writing=f.app.mutate(mutation,{}, {id,waitSeconds:0});await f.posted.promise;
  const logout=f.app.auth.logout();f.release.resolve();await logout;await writing;
  assert.equal(f.app.auth.state,'signed-out');assert.deepEqual(await view.pendingWrites(),[]);
  const late=await view.mutate(mutation,{});assert.equal(late.state,'failed');assert.equal(f.requests.length,1);
});

for(const boundary of ['switch','global logout']) test(`${boundary} fences held journal result and old client before attachment`,async t=>{
  const f=await fixture(t);await f.app.ready;
  const old=f.app.client;const writing=f.app.mutate(mutation,{}, {waitSeconds:0});await f.posted.promise;
  const ending=boundary==='switch'?f.app.auth.login('bob','password'):f.app.auth.logoutEverywhere();
  f.release.resolve();assert.equal((await ending).ok,true);await writing;
  assert.equal(f.app.auth.viewer,boundary==='switch'?'bob':null);
  const late=await old.mutate(mutation,{});assert.equal(late.state,'failed');assert.equal(late.why.code,'E_AUTH');
  assert.deepEqual(await old.pendingWrites(),[]);assert.equal(f.requests.length,1);
});

for(const code of ['E_STORE_REPLACED','E_STORE_RESTORE']) test(`${code} retires journal custody without replay through attached device`,async t=>{
  const f=await fixture(t,{hold:false});await f.app.ready;
  f.fail({code,family:'store',message:'store changed'});
  const old=f.app.client;
  const write=await f.app.mutate(mutation,{});assert.equal(write.state,'failed');assert.equal(write.why.code,code);
  f.coreGate.resolve();await tick();
  const late=await old.mutate(mutation,{});assert.equal(late.state,'failed');
  assert.ok('denied' in await old.query(query,{}),'the local reader is fenced even without a store/head envelope');
  assert.equal(f.requests.length,1);assert.equal((await f.journal()).pending.length,0);
  assert.equal((await f.journal()).receipts.find(w=>w.id===write.id)?.why.code,code);
});

test('open-time decision waits on the journal lock then observes its committed pending intent',async t=>{
  const store=memorySessionStore(),id=mintId(),url='https://progressive-writes.invalid',entered=gate(),release=gate();
  const lock=storeLock(storeKey('writes',url,'alice'),async()=>{entered.resolve();await release.promise;await store.set(storeKey('writes',url,'alice'),JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id,op:'write',args:{},storeId:'A'}],receipts:[]}));});
  await entered.promise;const f=await fixture(t,{store,custody:'present',hold:false});f.coreGate.resolve();
  let ready=false;void f.app.ready.then(()=>{ready=true;});await tick();assert.equal(ready,false);
  release.resolve();await lock;await f.app.ready;
  await until(async()=> (await f.app.client.write(id))?.state==='sent');assert.deepEqual(f.requests,[id]);
});

test('pre-progressive reader accepts journal writes and receipts without quarantine or ownership fields',async t=>{
  const {journalReader}=await import('./fixtures/pre-progressive-app-journal.mjs');
  const f=await fixture(t);await f.app.ready;const id=mintId();const writing=f.app.mutate(mutation,{}, {id});await f.posted.promise;
  const warnings=[],read=journalReader(storeKey('writes',f.url,'alice'),'alice',f.url,f.store,error=>warnings.push(error));
  let old=await read(true);assert.equal(old.pending[0].id,id);assert.deepEqual(Object.keys(old.pending[0]).sort(),['args','dispatched','id','op','owner','statusRevision','storeId']);
  f.release.resolve();assert.equal((await writing).state,'sent');old=await read(true);
  assert.equal(old.pending.length,0);assert.equal(old.receipts[0].id,id);assert.deepEqual(warnings,[]);
});

const regression = (name, work) => test(name, { timeout: 20_000 }, work);
async function seedOutbox(persist,id,basePath='') {
  const name=`snapback4-${encodeURIComponent('https://progressive-writes.invalid'+basePath+':alice')}`;
  const core=await webDevice({wasm,persist}).open(name,{initial_backend:schema});
  assert.equal((await core.call({op:'apply',first:true,page:{generation:1,store_id:'A',snapshot:true,watermark:20,images_at:20,events:[],more:false}})).denied,undefined);
  const admitted=await core.call({op:'admit',entry:mutationEntry(id,1,'write',{},'alice',Date.now(),schema,true)});
  assert.equal(admitted.denied,undefined,JSON.stringify(admitted));
  await core.close();
}
for(const basePath of ['', '/api'])for(const adopted of [false,true])regression(`journal dispatch waits behind ${adopted?'orphan-adopted':'previous-session'} outbox custody at ${basePath||'/'}`,async t=>{
  const persist=memoryPersistence(),store=memorySessionStore(),ordinary=mintId(),journal=mintId();
  const url='https://progressive-writes.invalid'+basePath;
  if(!adopted)await seedOutbox(persist,ordinary,basePath);
  if(!adopted)await store.set(storeKey('writes',url,'alice'),JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id:journal,op:'write',args:{},storeId:'A'}],receipts:[]}));
  let core,notify;
  const f=await fixture(t,{persist,store,basePath,custody:adopted?'none':'present',wrapCore:opened=>{core=opened;return {...opened,onOutbox(listener){notify=listener;return ()=>{};}};}});
  f.coreGate.resolve();await until(()=>f.app.auth.state==='signed-in');
  if(adopted)await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  if(adopted){const reply=await core.call({op:'admit',entry:mutationEntry(ordinary,1,'write',{},'alice',Date.now(),schema,true)});assert.equal(reply.denied,undefined);notify(Date.now(),[reply.ok]);}
  await until(()=>f.requests.includes(ordinary));
  if(adopted)await f.app.mutate(mutation,{}, {id:journal,waitSeconds:0});
  await until(async()=> (await f.journal())?.pending.some(write=>write.id===journal));
  assert.deepEqual(f.requests,[ordinary]);
  let answered=false;const read=f.app.client.query(query,{}).then(value=>{answered=true;return value;});
  await tick();assert.equal(answered,false);
  f.release.resolve();await until(()=>f.requests.includes(journal));
  assert.deepEqual(f.requests,[ordinary,journal]);
  assert.ok('data' in await read);assert.equal((await f.app.client.write(ordinary)).state,'sent');
  assert.equal((await f.app.client.write(journal)).state,'sent');
});

for(const failure of [new Error('cached engine unavailable'),new DeviceVersionError({code:'E_DEVICE_VERSION',family:'device-version',message:'cached engine incompatible'}),'handshake'])regression(`present custody keeps session and journals after ${String(failure)}`,async t=>{
  const f=await fixture(t,{custody:'present',hold:false,...(failure==='handshake'?{badEngine:true}:{failure})});
  f.coreGate.resolve();assert.equal((await f.app.ready).ok,true);const client=f.app.client;
  await until(()=>localStatus(client).getSnapshot().state==='unavailable');
  if(failure==='handshake') {
    const read=await client.query(query,{});assert.equal(read.data,'server',JSON.stringify(read));
    const write=await f.app.mutate(mutation,{});assert.equal(write.state,'sent');
    assert.ok((await f.journal()).receipts.some(receipt=>receipt.id===write.id));
  } else {
    assert.equal((await client.query(query,{})).denied?.code,localStatus(client).getSnapshot().why.code);
    const write=await f.app.mutate(mutation,{}, {waitSeconds:0});assert.equal(write.state,'pending');
    await tick();assert.deepEqual(f.requests,[]);
    assert.ok((await f.journal()).pending.some(intent=>intent.id===write.id));
    const item=(await pendingIntentAccess(client).read()).find(item=>item.write.id===write.id);
    assert.equal(item.phase,'held');assert.equal(item.write.reason,`${localStatus(client).getSnapshot().why.code}: ${localStatus(client).getSnapshot().why.message}`);
  }
  assert.equal(f.app.auth.state,'signed-in');assert.equal(f.revokes(),0);
});

for(const failure of ['open','handshake','healthy'])regression(`unlisted previous-session O1 holds J1 through ${failure}`,async t=>{
  const persist=memoryPersistence(),store=memorySessionStore(),ordinary=mintId(),journal=mintId(),listed=gate(),list=gate();
  await seedOutbox(persist,ordinary);
  // A journal intent selects the online owner; the queue must still be listed.
  await store.set(storeKey('writes','https://progressive-writes.invalid','alice'),JSON.stringify({owner:'alice',backend:'https://progressive-writes.invalid',pending:[{owner:'alice',id:journal,op:'write',args:{},storeId:'A'}],receipts:[]}));
  const f=await fixture(t,{persist,store,custody:'present',failure:failure==='open'?Error('open failed'):undefined,badEngine:failure==='handshake',wrapCore:core=>({...core,async call(request,...rest){if(request.op==='queued'){listed.resolve();await list.promise;}return core.call(request,...rest);}})});
  t.after(()=>list.resolve());f.coreGate.resolve();
  if(failure==='healthy') {await listed.promise;assert.deepEqual(f.requests,[]);list.resolve();}
  else if(failure==='handshake') {await listed.promise;assert.deepEqual(f.requests,[]);list.resolve();}
  assert.equal((await f.app.ready).ok,true);
  if(failure!=='healthy')await until(()=>localStatus(f.app.client).getSnapshot().state==='unavailable');
  const retry=await f.app.mutate(mutation,{}, {id:ordinary,waitSeconds:0});
  assert.notEqual(retry.state,'sent');assert.equal((await f.journal()).pending.some(w=>w.id===ordinary),false);
  if(failure==='open')assert.equal((await f.app.client.query(query,{})).denied?.code,localStatus(f.app.client).getSnapshot().why.code);
  else {let answered=false;void f.app.client.query(query,{}).then(()=>{answered=true;});await tick();assert.equal(answered,false);}
  if(failure==='healthy') {
    await until(()=>f.requests.includes(ordinary));assert.deepEqual(f.requests,[ordinary]);
    f.release.resolve();await until(()=>f.requests.includes(journal));assert.deepEqual(f.requests,[ordinary,journal]);
  } else {assert.deepEqual(f.requests,[]);assert.ok((await f.journal()).pending.some(w=>w.id===journal));}
});

for(const kind of ['retired','receipt','marker'])regression(`outbox ownership recovers a prior journal ${kind} without dispatch`,async t=>{
  const store=memorySessionStore(),id=mintId(),url='https://progressive-writes.invalid';
  await store.set(storeKey('writes',url,'alice'),JSON.stringify({owner:'alice',backend:url,pending:[],receipts:kind==='receipt'?[{state:'sent',id,seq:18,replayed:true}]:[],...(kind==='retired'?{retired:[id],firstStore:'old',changedStore:true}:kind==='marker'?{captured:[`${id}:${mintId()}`]}:{})}));
  const f=await fixture(t,{store,custody:'present',hold:false,raw:true});
  const result=await f.app.mutate(mutation,{}, {id});
  assert.equal(result.state,kind==='receipt'?'sent':'failed');
  if(kind!=='receipt')assert.equal(result.why.code,'E_WRITE_RECEIPT_EXPIRED');
  assert.deepEqual(f.requests,[]);assert.equal((await f.app.client.write(id)).state,result.state);
});

regression('journal owner retries an existing device id through its original receipt',async t=>{
  const persist=memoryPersistence(),id=mintId();await seedOutbox(persist,id);
  const f=await fixture(t,{persist,hold:false});await f.app.ready;f.coreGate.resolve();await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  await until(async()=> (await f.app.client.write(id))?.state==='sent');
  assert.equal((await f.app.mutate(mutation,{}, {id})).state,'sent');
  assert.deepEqual(f.requests,[id]);assert.equal((await f.journal())?.receipts.some(w=>w.id===id)??false,false);
});

regression('journal commit leaves a disjoint served watch and its offline fallback untouched',async t=>{
  const backend=structuredClone(schema);backend.programs.find(p=>p.name==='other').settlement.reads={members:null};
  const f=await fixture(t,{backend,queryReply:(path,head)=>({data:'server',complete:true,tables:path.endsWith('/other')?['members']:['items'],seq:path.endsWith('/other')?20:head,head,store_id:'A',generation:1})});
  await f.app.ready;const watch=f.app.client.observe({kind:'query',name:'other'},{}),seen=[];watch.subscribe(()=>seen.push(watch.getSnapshot()));t.after(()=>watch.close());
  await until(()=>watch.getSnapshot().data==='server');const before=f.reads(),first=seen.length;
  const writing=f.app.mutate(mutation,{});await f.posted.promise;f.release.resolve();assert.equal((await writing).state,'sent');
  await tick();assert.equal(f.reads(),before);assert.equal(watch.getSnapshot().revalidating,undefined);assert.equal(watch.getSnapshot().data,'server');
  assert.equal(seen.slice(first).some(read=>'loading' in read),false);
  f.offline(true);await f.app.client.query({kind:'query',name:'other'},{});assert.equal(watch.getSnapshot().data,'server',JSON.stringify({snapshot:watch.getSnapshot(),seen}));
});

regression('field-disjoint final publication: items.count reads past pending items.title',async t=>{
  const backend=structuredClone(schema);backend.programs.find(p=>p.name==='read').settlement.reads={items:['count']};backend.programs.find(p=>p.name==='write').settlement.writes={items:['title']};
  const f=await fixture(t,{backend});await f.app.ready;const writing=f.app.mutate(mutation,{});await f.posted.promise;
  assert.equal((await f.app.client.query(query,{})).data,'server');
  f.release.resolve();assert.equal((await writing).state,'sent');
});

regression('journal response arriving during public close reaches its invocation',async t=>{
  const cleaning=gate(),cleanup=gate();let armed=false;
  const f=await fixture(t,{wrapCore:core=>({...core,async close(){if(armed){cleaning.resolve();await cleanup.promise;}await core.close();}})});
  t.after(()=>cleanup.resolve());await f.app.ready;f.coreGate.resolve();await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  const writing=f.app.mutate(mutation,{});await f.posted.promise;armed=true;let done=false;
  const closing=f.app.close().then(()=>{done=true;});await cleaning.promise;
  f.release.resolve();await tick();assert.equal(done,false);cleanup.resolve();await closing;
  assert.equal((await writing).state,'sent');
});

for(const failure of ['damaged','read','capture'])regression(`journal ${failure} inspection failure keeps the client open with admission refused`,async t=>{
  const memory=memorySessionStore(),key=storeKey('writes','https://progressive-writes.invalid','alice'),warnings=[];let changes=0;
  if(failure==='damaged')await memory.set(key,'broken journal');
  const store={...memory,get:async keyIn=>{if(failure==='read'&&keyIn===key)throw Error('storage disabled');return memory.get(keyIn);},set:async(keyIn,value)=>{if(keyIn.startsWith(key)){changes++;throw Error('cannot preserve');}return memory.set(keyIn,value);}};
  const f=await fixture(t,{store,custody:'present',raw:true,authority:failure==='capture'?{capture:()=>({key:'session',epoch:'epoch',principal:'alice',source:'browser'}),recheck(){}}:undefined,report:error=>warnings.push(error)});
  assert.equal(changes,0,'opening decision is non-mutating');
  assert.equal((await f.app.client.query(query,{})).denied?.code,'E_ADMISSION');assert.equal((await f.app.mutate(mutation,{})).why.code,'E_ADMISSION');assert.ok(warnings.length);
  assert.equal(changes,failure==='damaged'?1:0,'dependent read attempts recovery without replacing unpreserved bytes');assert.deepEqual(f.requests,[]);
});

regression('outbox-owned reads do not perform journal I/O or start a journal transport',async t=>{
  const memory=memorySessionStore();let reads=0;
  const store={...memory,async get(key){if(key.includes('writes'))reads++;return memory.get(key);}};
  const f=await fixture(t,{store,custody:'present',raw:true,hold:false});const openedReads=reads;
  for(let n=0;n<5;n++){assert.ok('data' in await f.app.client.query(query,{}));await f.app.client.pendingWrites();}
  assert.equal(reads,openedReads);assert.equal((await f.journal()),null);
});

for(const startup of [undefined,'progressive','awaited']) regression(`device startup ${startup??'default'} refuses writes online with a rewrite`,async()=>{
  const app=createApp({url:'https://progressive-writes.invalid',device:{custody:async()=> 'none',open(){throw Error('must not open');}},...(startup?{startup}:{}),writes:'online'});
  const result=await app.ready;assert.equal(result.ok,false);assert.equal(result.why.code,'E_CLIENT');assert.match(result.why.rewrite,/omit writes/);assert.doesNotMatch(result.why.rewrite,/startup:/);await app.close();
});

regression('a disjoint local read remains available offline below a journal receipt cut',async t=>{
  const f=await fixture(t);await f.app.ready;f.coreGate.resolve();await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  assert.equal((await f.app.client.query({kind:'query',name:'other'},{})).data,'other');
  const writing=f.app.mutate(mutation,{});await f.posted.promise;f.release.resolve();assert.equal((await writing).state,'sent');
  f.offline(true);assert.equal((await f.app.client.query({kind:'query',name:'other'},{})).data,'other');
});

regression('an intersecting served answer below the journal receipt cut retains displayed data',async t=>{
  let served=20;
  const f=await fixture(t,{queryReply:(_path,head)=>({data:'server',complete:true,tables:['items'],seq:served,store_id:'A',generation:1,head})});await f.app.ready;
  const watch=f.app.client.observe(query,{}),seen=[];watch.subscribe(()=>seen.push(watch.getSnapshot()));t.after(()=>watch.close());
  await until(()=>watch.getSnapshot().data==='server');const first=seen.length;
  const writing=f.app.mutate(mutation,{});await f.posted.promise;f.release.resolve();assert.equal((await writing).state,'sent');
  await until(()=>watch.getSnapshot().revalidating===true);await tick();
  assert.equal(watch.getSnapshot().data,'server');assert.equal(seen.slice(first).some(read=>'loading' in read),false);
  served=21;assert.equal((await f.app.client.query(query,{})).data,'server');
});

regression('a replayed journal receipt without head does not report a restore',async t=>{
  const f=await fixture(t,{hold:false,queryReply:()=>({data:'server',complete:true,tables:['other'],seq:20,store_id:'A',generation:1})});await f.app.ready;
  // The replay retains an older receipt cut while no current head is supplied.
  const response=Response.json.bind(Response);
  t.mock.method(Response,'json',(body,...args)=>response(body?.state==='sent'?{...body,replayed:true,head:undefined,seq:10}:body,...args));
  const write=await f.app.mutate(mutation,{});assert.equal(write.state,'sent');
  assert.equal((await f.app.client.query({kind:'query',name:'other'},{})).data,'server');assert.equal(f.app.auth.state,'signed-in');
});

regression('provisional cold restore then obsolete resumes the app without retiring journal intent',async t=>{
  const syncWait=gate();let control,available=true,armed=false,validate;
  const f=await fixture(t,{syncWait,wrapCore:core=>{
    control={store_id:'A',watermark:100,send_revision:0,generation:1,acquired:false,acquisition:1,queuedRevision:0,issuedFloor:0,predictions:[]};
    return {...core,[deviceControl]:()=>available?control:undefined,[deviceRestore]:async(_proof,callback)=>{validate=callback;}};
  },queryReply:(_path,head)=>{if(armed)available=false;return {data:'server',complete:true,tables:['other'],seq:head,store_id:'A',generation:1,refresh:250};}});
  await f.app.ready;const client=f.app.client,watch=client.observe({kind:'query',name:'other'},{});watch.subscribe(()=>{});t.after(()=>watch.close());
  await until(()=>watch.getSnapshot().data==='server');
  const id=mintId();await f.app.mutate(mutation,{}, {id,waitSeconds:0});await f.posted.promise;
  armed=true;f.coreGate.resolve();await until(()=>validate);
  assert.equal((await client.query(query,{})).denied?.code,'E_STORE_RESTORE');
  assert.ok((await f.journal()).pending.some(write=>write.id===id));assert.equal((await f.journal()).receipts.length,0);
  armed=false;available=true;validate({status:'obsolete'});syncWait.resolve();f.release.resolve();
  await until(()=>localStatus(client).getSnapshot().state==='ready');
  await until(async()=> (await client.write(id))?.state==='sent');
  assert.equal(f.app.client,client);assert.equal(f.app.auth.state,'signed-in');assert.ok('data' in await client.query({kind:'query',name:'other'},{}));
  assert.equal(f.revokes(),0);assert.equal(f.requests.filter(request=>request===id).length,1);
});

regression('ownership rechecks journal custody after a held compatible engine opens',async t=>{
  const f=await fixture(t,{custody:'present',hold:false});await until(()=>f.coreOpens()>0);
  const id=mintId();await f.store.set(storeKey('writes',f.url,'alice'),JSON.stringify({owner:'alice',backend:f.url,pending:[{owner:'alice',id,op:'write',args:{},storeId:'A'}],receipts:[]}));
  f.coreGate.resolve();assert.equal((await f.app.ready).ok,true);
  await until(async()=> (await f.app.client.write(id))?.state==='sent');
  const fresh=await f.app.mutate(mutation,{});assert.equal(fresh.state,'sent');
  assert.ok((await f.journal()).receipts.some(write=>write.id===fresh.id),'the journal admitted during opening keeps ownership');
});

for(const code of ['E_STORE_REPLACED','E_DEV_RESET','E_STORE_RESTORE'])regression(`journal ${code} withdraws an attached local observation without an envelope`,async t=>{
  const f=await fixture(t,{raw:true,hold:false});await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  const watch=f.app.client.observe(query,{});watch.subscribe(()=>{});t.after(()=>watch.close());await until(()=>watch.getSnapshot().data==='local');
  f.fail({code,family:'store',message:'terminal store refusal'});
  const write=await f.app.mutate(mutation,{});assert.equal(write.state,'failed');assert.equal(write.why.code,code);
  await until(()=>watch.getSnapshot().denied?.code===code);
  assert.equal((await f.app.client.query(query,{})).denied?.code,code);assert.equal((await f.journal()).pending.length,0);
});

regression('journal E_GENERATION settles only that write and keeps attachment and later writes usable',async t=>{
  const f=await fixture(t,{hold:false});await f.app.ready;
  f.fail({code:'E_GENERATION',family:'generation',message:'not an operation of this generation'});
  const refused=await f.app.mutate(mutation,{});assert.equal(refused.state,'failed');assert.equal(refused.why.code,'E_GENERATION');
  f.fail(undefined);f.coreGate.resolve();await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  assert.ok('data' in await f.app.client.query(query,{}));
  assert.equal((await f.app.mutate(mutation,{})).state,'sent');
  assert.equal((await f.app.mutate(mutation,{}, {id:refused.id})).why.code,'E_GENERATION');
  assert.equal((await f.journal()).retired?.includes(refused.id)??false,false);
});

regression('adopted device custody keeps J1 held after a version refusal',async t=>{
  let core,notify;
  const f=await fixture(t,{raw:true,wrapCore:opened=>{core=opened;return {...opened,onOutbox(listener){notify=listener;return ()=>{};}};}});
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  const ordinary=mintId(),journal=mintId();
  const admitted=await core.call({op:'admit',entry:mutationEntry(ordinary,1,'write',{},'alice',Date.now(),schema,true)});
  assert.equal(admitted.denied,undefined);notify(Date.now(),[admitted.ok]);
  await f.app.mutate(mutation,{}, {id:journal,waitSeconds:0});
  await until(async()=> (await f.journal()).pending.some(w=>w.id===journal));await until(()=>f.requests.includes(ordinary));assert.deepEqual(f.requests,[ordinary]);
  await until(()=>f.change({denied:{code:'E_DEVICE_VERSION',family:'device-version',message:'engine retired'}}));
  await until(()=>localStatus(f.app.client).getSnapshot().state==='unavailable');
  await tick();assert.deepEqual(f.requests,[ordinary]);assert.ok((await f.journal()).pending.some(w=>w.id===journal));
});

regression('field-disjoint receipt keeps remembered count through offline attachment',async t=>{
  const backend=structuredClone(schema);
  backend.programs.find(p=>p.name==='read').settlement.reads={items:['count']};
  backend.programs.find(p=>p.name==='write').settlement.writes={items:['title']};
  const f=await fixture(t,{backend,wrapCore:core=>({...core,call(request,...rest){if(request.op==='query')return Promise.resolve({ok:{data:null,complete:false,unknown:true,speculative:true,tables:['items']}});return core.call(request,...rest);}})});
  await f.app.ready;const watch=f.app.client.observe(query,{}),seen=[];watch.subscribe(()=>seen.push(watch.getSnapshot()));t.after(()=>watch.close());
  await until(()=>watch.getSnapshot().data==='server');const first=seen.length;
  const writing=f.app.mutate(mutation,{});await f.posted.promise;f.release.resolve();assert.equal((await writing).state,'sent');
  f.offline(true);await f.app.client.query({kind:'query',name:'other'},{});
  f.coreGate.resolve();await until(()=>localStatus(f.app.client).getSnapshot().executable);
  await until(()=>watch.getSnapshot().fresh===false);
  assert.equal(watch.getSnapshot().data,'server');assert.equal(seen.slice(first).some(read=>'loading' in read),false,JSON.stringify(seen));
});

regression('journal revocation receipt withdraws within the original one-second episode',async t=>{
  const held=gate(),queried=gate();let revoke=false;
  const f=await fixture(t,{receiptReply:receipt=>({...receipt,preserved:[]}),queryReply:async(_path,head)=>{if(revoke){queried.resolve();await held.promise;}return {data:'authorized',complete:true,tables:['items'],scopes:{items:[{}]},seq:head,store_id:'A',generation:1};}});
  t.after(()=>held.resolve());await f.app.ready;
  const watch=f.app.client.observe(query,{});watch.subscribe(()=>{});t.after(()=>watch.close());
  await until(()=>watch.getSnapshot().data==='authorized');revoke=true;
  const writing=f.app.mutate(mutation,{});await f.posted.promise;f.release.resolve();assert.equal((await writing).state,'sent');
  await queried.promise;await until(()=>episodeDeadline(watch.getSnapshot())!==undefined);
  const deadline=episodeDeadline(watch.getSnapshot());assert.ok(deadline-Date.now()<=1000);
  // Another receipt cannot renew the episode while the replacement is held.
  assert.equal((await f.app.mutate(mutation,{})).state,'sent');
  assert.equal(episodeDeadline(watch.getSnapshot()),deadline);
  await until(()=>!('data' in watch.getSnapshot()));assert.ok(Date.now()<=deadline+250);
  assert.equal(f.coreOpens(),1,'the background engine is still held');
});

regression('in-place store replacement clears old journal cuts',async t=>{
  const f=await fixture(t,{raw:true,hold:false});await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  f.head(49);assert.equal((await f.app.mutate(mutation,{})).seq,50);
  f.replace('B');await f.app.client.sync();
  assert.ok('data' in await f.app.client.query(query,{}));
  const watch=f.app.client.observe(query,{});watch.subscribe(()=>{});t.after(()=>watch.close());
  await until(()=> 'data' in watch.getSnapshot());assert.equal(watch.getSnapshot().data,'local');
});

regression('offline below an unapplied journal cut retains displayed data without loading',async t=>{
  const f=await fixture(t,{raw:true,syncHead:20});await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  const watch=f.app.client.observe(query,{}),seen=[];watch.subscribe(()=>seen.push(watch.getSnapshot()));t.after(()=>watch.close());
  await until(()=>watch.getSnapshot().data==='local');const first=seen.length;
  const writing=f.app.mutate(mutation,{});await f.posted.promise;f.offline(true);f.release.resolve();assert.equal((await writing).state,'sent');
  await f.app.client.query({kind:'query',name:'other'},{});await f.app.client.sync();
  await until(()=>watch.getSnapshot().fresh===false);
  assert.equal(watch.getSnapshot().data,'local');assert.equal(seen.slice(first).some(read=>'loading' in read),false,JSON.stringify(seen));
});

regression('legacy unsequenced server replies revalidate after a journal cut without parking forever',async t=>{
  let value='before';const f=await fixture(t,{hold:false,queryReply:()=>({data:value,complete:true,tables:['items']})});await f.app.ready;
  const watch=f.app.client.observe(query,{});watch.subscribe(()=>{});t.after(()=>watch.close());await until(()=>watch.getSnapshot().data==='before');
  value='after';assert.equal((await f.app.mutate(mutation,{})).state,'sent');
  await until(()=>watch.getSnapshot().data==='after');assert.equal((await f.app.client.query(query,{})).data,'after');
});

for(const failed of [false,true])regression(`recovered browser capture fences dependent publication during ${failed?'failed':'held'} inspection`,async t=>{
  const entries=new Map(),storage={get length(){return entries.size;},key:i=>[...entries.keys()][i]??null,getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,String(value)),removeItem:key=>entries.delete(key)};
  for(const [name,value] of Object.entries({window:Object.assign(new EventTarget(),{location:{href:'https://app.invalid'}}),localStorage:storage})) {
    const before=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{configurable:true,value});
    t.after(()=>before?Object.defineProperty(globalThis,name,before):delete globalThis[name]);
  }
  const url='https://progressive-writes.invalid',key=sessionKey(url),store=memorySessionStore(),id=mintId(),inspecting=gate(),inspectGate=gate(),warnings=[];
  const authority={capture:()=>({key,epoch:'1',principal:'alice',source:'browser'}),read:async requested=>requested===key?JSON.stringify({principal:'alice',snapback4Epoch:'1'}):'1',recheck(){}};
  await store.set(storeKey('writes',url,'alice'),JSON.stringify({owner:'alice',backend:url,pending:[],receipts:[]}));
  const capture=new OnlineCapture(url,'alice',authority);await capture.ready;
  assert.equal(capture.capture(id,'write',{},'A').id,id);capture.close();
  let blocked=true;const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(local,...args){
    await install.call(this,local,...args);const custody=progressiveWriteCustody(local),inspect=custody.inspect;
    custody.inspect=async()=>{if(blocked){inspecting.resolve();if(failed)throw Error('inspect failed after recovery');await inspectGate.promise;}return inspect();};
  });
  t.after(()=>{blocked=false;inspectGate.resolve();});
  const f=await fixture(t,{raw:true,store,authority,report:error=>warnings.push(error)});
  await inspecting.promise;
  await until(async()=> (await f.journal()).pending.some(w=>w.id===id));
  let answered=false;const reading=f.app.client.query(query,{}).then(value=>{answered=true;return value;});
  await tick();assert.equal(answered,false,'the prior empty snapshot is not settled custody');
  blocked=false;inspectGate.resolve();await f.posted.promise;await tick();assert.equal(answered,false,'listed recovered custody still awaits settlement');
  f.release.resolve();await until(async()=> (await f.app.client.write(id))?.state==='sent');assert.ok('data' in await reading);
  if(failed)assert.ok(warnings.some(error=>String(error).includes('inspect failed')));
});

for(const attached of [false,true])regression(`inspection completion wakes a disjoint rooms watch (attached=${attached})`,async t=>{
  const inspecting=gate(),release=gate();let armed=false,custody,roomEvaluations=0;
  const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(local,...args){
    await install.call(this,local,...args);custody=progressiveWriteCustody(local);const inspect=custody.inspect;
    custody.inspect=async()=>{if(armed){inspecting.resolve();await release.promise;}return inspect();};
  });
  t.after(()=>{armed=false;release.resolve();});
  const backend=structuredClone(schema);
  backend.programs.find(p=>p.name==='read').settlement.reads={messages:null};
  backend.programs.find(p=>p.name==='write').settlement.writes={messages:null};
  backend.programs.find(p=>p.name==='other').settlement.reads={rooms:null};
  const f=await fixture(t,{backend,queryReply:(path,head)=>{if(path.endsWith('/other'))roomEvaluations++;return {data:'server',complete:true,tables:path.endsWith('/constant')?[]:path.endsWith('/other')?['rooms']:['messages'],seq:head};},
    wrapCore:core=>({...core,call(request,...rest){if(request.op==='query'&&request.name==='other')roomEvaluations++;return core.call(request,...rest);}})});
  await f.app.ready;if(attached){f.coreGate.resolve();await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');}
  armed=true;const writing=f.app.mutate(mutation,{}, {waitSeconds:0});await inspecting.promise;
  const watch=f.app.client.observe({kind:'query',name:'other'},{});watch.subscribe(()=>{});t.after(()=>watch.close());
  await until(()=>roomEvaluations>0);await tick();assert.deepEqual(watch.getSnapshot(),{loading:true});
  assert.ok('data' in await f.app.client.query({kind:'query',name:'constant'},{}),'proven table-free query does not wait for inspection');
  armed=false;release.resolve();
  await until(()=>watch.getSnapshot().data===(attached?'other':'server'));
  assert.ok((await f.app.client.pendingWrites()).length,'disjoint publication precedes messages receipt');
  f.release.resolve();await writing;
});

for(const failure of ['open','unlistable handshake'])regression(`permanent ${failure} failure denies unknown-custody watches and holds intents; empty and server-only reads proceed`,async t=>{
  const backend=structuredClone(schema);backend.schema.tables.remote={columns:{},sync:null};
  backend.programs.find(p=>p.name==='other').settlement.reads={remote:null};
  const f=await fixture(t,{backend,custody:'present',failure:failure==='open'?Error('persistent engine-open failure'):undefined,badEngine:failure!=='open',
    wrapCore:core=>({...core,call:(request,...rest)=>request.op==='queued'?Promise.reject(Error('outbox storage unavailable')):core.call(request,...rest)}),
    queryReply:(path,head)=>({data:'server',complete:true,tables:path.endsWith('/constant')?[]:path.endsWith('/other')?['remote']:['items'],seq:head})});
  f.coreGate.resolve();await f.app.ready;await until(()=>localStatus(f.app.client).getSnapshot().state==='unavailable');
  const why=localStatus(f.app.client).getSnapshot().why;
  const watch=f.app.client.observe(query,{});watch.subscribe(()=>{});t.after(()=>watch.close());
  await until(()=>watch.getSnapshot().denied);assert.deepEqual(watch.getSnapshot().denied,why);
  assert.deepEqual((await f.app.client.query(query,{})).denied,why);
  assert.equal(f.reads(),0,'impossible-custody refusal does not await a server query');
  assert.equal((await f.app.client.query({kind:'query',name:'constant'},{})).data,'server');
  assert.deepEqual((await f.app.client.query({kind:'query',name:'other'},{})).denied,why,'online-only tables can still have unknown outbox writes');
  assert.equal((await f.app.online.query(query,{})).data,'server','the explicit online arm remains available');
  const write=await f.app.mutate(mutation,{}, {waitSeconds:0});assert.equal(write.state,'pending');
  const item=(await pendingIntentAccess(f.app.client).read()).find(item=>item.write.id===write.id);
  assert.equal(item.phase,'held');assert.equal(item.write.reason,`${why.code}: ${why.message}`);
  assert.equal((await f.app.client.pendingWrites()).find(item=>item.id===write.id).state,'held');assert.deepEqual(f.requests,[]);
});

regression('a failed final receipt inspection retries on the next dependent read without further notifications',async t=>{
  const failed=gate(),warnings=[];let fail=false,inspections=0,failedAt=0,progressive;
  const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(local,...args){
    await install.call(this,local,...args);progressive=this;const custody=progressiveWriteCustody(local),inspect=custody.inspect;
    custody.inspect=async()=>{inspections++;const value=await inspect();if(fail&&value.receipts.length){fail=false;failedAt=inspections;failed.resolve();throw Error('one final receipt inspection failed');}return value;};
  });
  const f=await fixture(t,{report:error=>warnings.push(error)});await f.app.ready;
  const writing=f.app.mutate(mutation,{});await f.posted.promise;fail=true;f.release.resolve();await writing;await failed.promise;
  await tick();
  assert.ok('data' in await f.app.client.query(query,{}));
  assert.ok(inspections>failedAt);assert.equal(progressive.uncertain,false);
});

regression('pending inspection recovers after storage is restored with no new journal notifications',async t=>{
  let failing=false,failures=0,inspections=0;
  const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(local,...args){
    await install.call(this,local,...args);const custody=progressiveWriteCustody(local),inspect=custody.inspect;
    custody.inspect=async()=>{inspections++;const snapshot=await inspect();if(failing&&snapshot.receipts.length){failures++;throw Error('receipt inspection storage unavailable');}return snapshot;};
  });
  const f=await fixture(t);await f.app.ready;const writing=f.app.mutate(mutation,{});await f.posted.promise;
  failing=true;f.release.resolve();await writing;await until(()=>failures>0);await tick();
  const before=inspections;failing=false;
  assert.ok('data' in await f.app.client.query(query,{}));assert.ok(inspections>before);
});

for(const fail of [false,true])regression(`E1 outbox delta does not list O1 during held attachment (failure=${fail})`,async t=>{
  const persist=memoryPersistence(),store=memorySessionStore(),o1=mintId(),o2=mintId(),j1=mintId(),entered=gate(),release=gate();
  await seedOutbox(persist,o1);
  const url='https://progressive-writes.invalid';
  await store.set(storeKey('writes',url,'alice'),JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id:j1,op:'roomsWrite',args:{},storeId:'A'}],receipts:[]}));
  const backend=structuredClone(schema);backend.programs.push({name:'roomsWrite',kind:'Mutation',args:{},body:[],settlement:{reads:{},writes:{rooms:null}}});
  let armed=false,lists=0;
  t.after(()=>release.resolve());
  const f=await fixture(t,{persist,store,backend,custody:'present',wrapCore:core=>({...core,
    onOutbox(listener){listener(Date.now(),[mutationEntry(o2,2,'roomsWrite',{},'alice',Date.now(),backend,true)]);armed=true;return()=>{};},
    async call(request,...rest){if(request.op==='queued')lists++;if(armed){armed=false;entered.resolve();await release.promise;if(fail)throw Error('attachment failed after orphan delta');}return core.call(request,...rest);}})});
  await f.app.ready;f.coreGate.resolve();await entered.promise;
  let answered=false;const reading=f.app.client.query(query,{}).then(read=>{answered=true;return read;});
  await new Promise(resolve=>setTimeout(resolve,50));assert.equal(answered,false,'O2 says nothing about unlisted O1');
  release.resolve();await until(()=>lists>0);
  if(fail){await until(()=>localStatus(f.app.client).getSnapshot().state==='unavailable');assert.ok((await f.app.client.pendingWrites()).some(w=>w.id===o1),'failure recovery must enumerate O1');}
  else {await until(()=>f.requests.includes(o1));f.release.resolve();assert.ok('data' in await reading);}
});

regression('E1 unreadable opening journal refuses dependent reads without forgetting prior W',async t=>{
  const memory=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice'),id=mintId();
  const bytes=JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id,op:'write',args:{},storeId:'A'}],receipts:[]});await memory.set(key,bytes);
  const store={...memory,get:async name=>{if(name===key)throw Error('opening journal unreadable');return memory.get(name);}};
  const f=await fixture(t,{store,report:()=>{}});await f.app.ready;
  const read=await f.app.client.query(query,{});assert.equal(read.denied?.code,'E_ADMISSION',JSON.stringify(read));assert.equal(f.reads(),0);
  const watch=f.app.client.observe(query,{});watch.subscribe(()=>{});t.after(()=>watch.close());await until(()=>watch.getSnapshot().denied);
  assert.equal(watch.getSnapshot().denied.code,'E_ADMISSION');assert.equal((await f.app.client.query({kind:'query',name:'constant'},{})).data,'server');
  assert.equal(await memory.get(key),bytes);assert.deepEqual(f.requests,[]);
});

for(const kind of ['store','generation'])regression(`E1 late journal response cannot roll back adopted ${kind}`,async t=>{
  let receiptStore='A',receiptGeneration=1,adopted=0,core;
  const backend=structuredClone(schema);
  const f=await fixture(t,{raw:true,backend,receiptReply:receipt=>({...receipt,store_id:receiptStore,generation:receiptGeneration}),
    wrapCore:opened=>{core=opened;return {...opened,async call(request,...rest){const reply=await opened.call(request,...rest);if(request.op==='adopt'&&!reply.denied)adopted++;return reply;}};}});
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');const receipts=[];f.app.client.onWrite(write=>receipts.push(write));
  const writing=f.app.mutate(mutation,{}, {waitSeconds:5});await f.posted.promise;
  if(kind==='store')f.replace('B');else backend.generation=2;
  // Existing sync adoption, under the same credential revision.
  if(kind==='generation')await until(()=>f.change({generation:2,store_id:'A',head:21,seq:21,tables:[]}));
  await f.app.client.sync();await until(()=>adopted>0);
  const before=adopted;f.release.resolve();assert.equal((await writing).state,'sent');await until(()=>receipts.length>0);
  assert.equal((await core.call({op:'sync_state',capture:false})).ok.store_id,kind==='store'?'B':'A');
  assert.equal((await core.call({op:'state'})).ok.generation,kind==='generation'?2:1);
  assert.equal(adopted,before,'old response did not schedule another adoption');
  const read=await f.app.client.query(query,{});assert.equal(read.data,'local',JSON.stringify(read));
});

for(const failure of [false,true])regression(`E1 journal-known retry preserves J1 while device is unlisted (open failure=${failure})`,async t=>{
  const store=memorySessionStore(),id=mintId(),url='https://progressive-writes.invalid';
  await store.set(storeKey('writes',url,'alice'),JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id,op:'write',args:{},storeId:'A'}],receipts:[]}));
  const f=await fixture(t,{store,custody:'present',hold:false,failure:failure?Error('engine unavailable'):undefined});await f.app.ready;
  if(failure){f.coreGate.resolve();await until(()=>localStatus(f.app.client).getSnapshot().state==='unavailable');}
  let outcome;const retry=f.app.mutate(mutation,{}, {id,waitSeconds:0}).then(write=>outcome=write);await tick();
  assert.notEqual(outcome?.state,'failed',JSON.stringify(outcome));
  assert.equal((await f.journal()).pending.filter(w=>w.id===id).length,1);assert.deepEqual(f.requests,[]);
  if(!failure){f.coreGate.resolve();await retry;await until(async()=> (await f.app.client.write(id))?.state==='sent');assert.equal(outcome.state,'sent');assert.deepEqual(f.requests,[id]);}
  else {await retry;assert.equal(outcome.state,'pending');}
});

regression('E1 a peer device id newer than journal open cannot enter an unlisted journal',async t=>{
  const store=memorySessionStore(),persist=memoryPersistence(),url='https://progressive-writes.invalid',j1=mintId(),listed=gate(),release=gate();
  await store.set(storeKey('writes',url,'alice'),JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id:j1,op:'write',args:{},storeId:'A'}],receipts:[]}));
  t.after(()=>release.resolve());
  const f=await fixture(t,{store,persist,custody:'present',wrapCore:core=>({...core,async call(request,...rest){if(request.op==='queued'){listed.resolve();await release.promise;}return core.call(request,...rest);}})});
  await f.app.ready;await tick();
  // A second document admits after ProgressiveWrites construction, before listing.
  const peer=await fixture(t,{raw:true,custody:'present',persist});await until(()=>localStatus(peer.app.client).getSnapshot().state==='ready');
  const id=mintId();assert.equal((await peer.app.mutate(mutation,{}, {id,waitSeconds:0})).state,'pending');
  f.coreGate.resolve();await listed.promise;
  const retry=await f.app.mutate(mutation,{}, {id,waitSeconds:0});assert.equal(retry.why?.code,'E_ADMISSION',JSON.stringify(retry));
  assert.equal((await f.journal()).pending.some(w=>w.id===id),false);release.resolve();peer.release.resolve();f.release.resolve();
});

for(const peer of [false,true])regression(`E1 surviving capture remains uncertain through ${peer?'pre-start peer broadcast':'failed recovery save and query inspection'}`,async t=>{
  const entries=new Map(),storage={get length(){return entries.size;},key:i=>[...entries.keys()][i]??null,getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,String(value)),removeItem:key=>entries.delete(key)};
  for(const [name,value] of Object.entries({window:Object.assign(new EventTarget(),{location:{href:'https://app.invalid'}}),localStorage:storage})) {
    const before=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{configurable:true,value});t.after(()=>before?Object.defineProperty(globalThis,name,before):delete globalThis[name]);
  }
  const url='https://progressive-writes.invalid',key=sessionKey(url),journalKey=storeKey('writes',url,'alice'),memory=memorySessionStore(),id=mintId();
  const authority={capture:()=>({key,epoch:'1',principal:'alice',source:'browser'}),read:async requested=>requested===key?JSON.stringify({principal:'alice',snapback4Epoch:'1'}):'1',recheck(){}};
  const capture=new OnlineCapture(url,'alice',authority);await capture.ready;capture.capture(id,'write',{},'A');capture.close();
  let fail=!peer,failures=0,progressive,inspections=0,uncertainAtBroadcast;const install=ProgressiveWrites.prototype.install;
  const store={...memory,async set(key,value){if(fail&&key===journalKey&&JSON.parse(value).pending.some(w=>w.id===id)){failures++;throw Error('recovery save failed');}return memory.set(key,value);}};
  t.mock.method(ProgressiveWrites.prototype,'install',async function(local,...args){await install.call(this,local,...args);progressive=this;const custody=progressiveWriteCustody(local),inspect=custody.inspect;custody.inspect=async()=>{inspections++;return inspect();};
    if(peer){const events=journalChanges(journalKey,()=>{});events.notify();await until(()=>inspections>0);await tick();events.close();uncertainAtBroadcast=this.uncertain;}});
  t.after(()=>{fail=false;});
  const f=await fixture(t,{raw:true,store,authority,report:()=>{}});
  if(peer)assert.equal(uncertainAtBroadcast,true,'peer inspection cannot certify a surviving capture');
  if(!peer){await until(()=>failures>0);let answered=false;const reading=f.app.client.query(query,{}).then(read=>{answered=true;return read;});
    await until(()=>inspections>0);await new Promise(resolve=>setTimeout(resolve,150));assert.equal(progressive.uncertain,true);assert.equal(answered,false,'successful empty inspection cannot publish pre-capture data');
    fail=false;await f.posted.promise;f.release.resolve();assert.ok('data' in await reading);
  }else {await f.posted.promise;f.release.resolve();await until(async()=> (await f.app.client.write(id))?.state==='sent');}
});

for(const failures of [1,2])regression(`E1 one notify heals already waiting reads and retained watches after ${failures} inspection failures`,async t=>{
  const release=gate(),entered=gate(),inspectionRelease=gate(),waiting=gate();let armed=false,failed=0,inspections=0,otherReads=0,progressive;
  const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(local,...args){await install.call(this,local,...args);progressive=this;const custody=progressiveWriteCustody(local),inspect=custody.inspect;
    custody.inspect=async()=>{inspections++;if(armed&&failed<failures){failed++;await inspectionRelease.promise;throw Error('single broadcast storage failure');}return inspect();};});
  const wait=QueryCustody.prototype.wait;t.mock.method(QueryCustody.prototype,'wait',function(...args){waiting.resolve();return wait.apply(this,args);});
  t.after(()=>{release.resolve();inspectionRelease.resolve();});
  let hold=false,value='before';
  const f=await fixture(t,{report:()=>{},queryReply:async(path,head)=>{if(path.endsWith('/other'))otherReads++;if(hold){entered.resolve();await release.promise;}return {data:value,complete:true,tables:path.endsWith('/other')?['other']:['items'],seq:head};}});
  t.after(()=>release.resolve());await f.app.ready;
  const watch=f.app.client.observe({kind:'query',name:'other'},{});watch.subscribe(()=>{});t.after(()=>watch.close());await until(()=>watch.getSnapshot().data==='before');
  hold=true;value='after';await until(()=>f.change({store_id:'A',generation:1,seq:20,head:20,tables:['other']}));await entered.promise;
  const reading=f.app.client.query(query,{});
  const loading=f.app.client.observe(query,{second:true});loading.subscribe(()=>{});t.after(()=>loading.close());await tick();
  armed=true;const events=journalChanges(storeKey('writes',f.url,'alice'),()=>{});t.after(()=>events.close());events.notify();await until(()=>failed>0);
  release.resolve();await waiting.promise;await tick();assert.equal(watch.getSnapshot().data,'before');const deadline=episodeDeadline(watch.getSnapshot());
  inspectionRelease.resolve();
  assert.equal((await reading).data,'after');await until(()=>watch.getSnapshot().data==='after'&&loading.getSnapshot().data==='after');
  assert.equal(failed,failures);assert.ok(inspections>failures);assert.equal(progressive.uncertain,false);assert.ok(otherReads>=2);
  if(deadline!==undefined)assert.ok(episodeDeadline(watch.getSnapshot())===undefined||episodeDeadline(watch.getSnapshot())<=deadline,'wake did not renew retention');
});

regression('E1 inspection completion does not reschedule an unrelated in-flight loading watch',async t=>{
  const release=gate(),entered=gate();let calls=0,progressive;
  const install=ProgressiveWrites.prototype.install;t.mock.method(ProgressiveWrites.prototype,'install',async function(...args){await install.apply(this,args);progressive=this;});
  const f=await fixture(t,{queryReply:async()=>{calls++;entered.resolve();await release.promise;return {data:'answer',complete:true,tables:['other'],seq:20};}});t.after(()=>release.resolve());await f.app.ready;
  const watch=f.app.client.observe({kind:'query',name:'other'},{});watch.subscribe(()=>{});t.after(()=>watch.close());await entered.promise;
  const events=journalChanges(storeKey('writes',f.url,'alice'),()=>{});t.after(()=>events.close());events.notify();await until(()=>!progressive.uncertain);
  release.resolve();await until(()=>watch.getSnapshot().data==='answer');await new Promise(resolve=>setTimeout(resolve,100));assert.equal(calls,1);
});

regression('E1 awaited mode keeps a notified change cut against an unsequenced server reply',async t=>{
  let value='before',calls=0;
  const f=await fixture(t,{raw:true,startup:'awaited',syncHead:20,queryReply:()=>{calls++;return {data:value,complete:true,tables:['items']};},
    wrapCore:core=>({...core,call:(request,...rest)=>request.op==='query'?Promise.resolve({ok:{loading:true,unknown:true,tables:['items']}}):core.call(request,...rest)})});
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  const watch=f.app.client.observe(query,{});watch.subscribe(()=>{});t.after(()=>watch.close());await until(()=>watch.getSnapshot().data==='before');
  const before=calls;value='after';await until(()=>f.change({store_id:'A',generation:1,seq:21,head:21,tables:['items']}));await until(()=>calls>before);
  await new Promise(resolve=>setTimeout(resolve,100));assert.notEqual(watch.getSnapshot().data,'after','unsequenced reply cannot prove ordinary changeCut coverage');
});


for (const persona of [false, true]) test(`default → awaited preserves journal custody and fences later writes (persona=${persona})`, {timeout: 15000}, async t => {
  const f = await fixture(t, {startup: null, persona});
  assert.equal((await f.app.ready).ok, true);
  f.coreGate.resolve(); await until(() => localStatus(f.app.client).getSnapshot().state === 'ready');
  f.offline(true);
  const a = await f.app.mutate(mutation, {}, {waitSeconds: 0});
  assert.equal(a.state, 'pending');
  assert.equal((await f.journal()).pending[0].id, a.id);
  const reopened = await f.reopen({startup: 'awaited'});
  assert.equal((await reopened.ready).ok, true);
  assert.ok((await reopened.client.pendingWrites()).some(write => write.id === a.id));
  const waiting = [], wait = QueryCustody.prototype.wait;
  t.mock.method(QueryCustody.prototype, 'wait', function(...args) { waiting.push(args[0]); return wait.apply(this, args); });
  // Reconnect only after custody has been recovered from durable storage.
  f.offline(false); await reopened.client.sync();
  await f.posted.promise;
  let answered = false;
  const read = reopened.client.query(query, {}).then(value => { answered = true; return value; });
  await until(() => waiting.length > 0);
  assert.equal(answered, false, 'dependent reads cannot pass unsettled A');
  const b = await reopened.mutate(mutation, {}, {waitSeconds: 0});
  assert.equal(b.state, 'pending');
  await until(async () => (await reopened.client.pendingWrites()).some(write => write.id === b.id));
  assert.deepEqual((await reopened.client.pendingWrites()).map(write => write.id), [a.id, b.id]);
  assert.deepEqual(f.requests, [a.id], 'fresh device-app write B cannot overtake A');
  f.release.resolve();
  await until(async () => (await reopened.client.write(b.id))?.state === 'sent');
  assert.deepEqual(f.requests, [a.id, b.id]);
  assert.ok('data' in await read);
  assert.equal((await reopened.client.write(a.id)).state, 'sent');
  // Once the journal drains, the next default open may choose the outbox.
  const outbox = await f.reopen({startup: undefined, device: {...f.device, custody: async () => 'present'}});
  assert.equal((await outbox.ready).ok, true);
  const c = await outbox.mutate(mutation, {});
  assert.equal(c.state, 'sent');
  assert.equal((await f.journal()).receipts.some(write => write.id === c.id), false, 'next-open write uses outbox');
  assert.deepEqual(f.requests, [a.id, b.id, c.id]);
});

for (const attach of [false, true]) test(`default device mutation without options returns pending after four seconds (attach=${attach})`, {timeout: 12000}, async t => {
  const f = await fixture(t, {startup: null}); await f.app.ready;
  const began = performance.now(), writing = f.app.mutate(mutation, {});
  await f.posted.promise;
  if (attach) { f.coreGate.resolve(); await until(() => localStatus(f.app.client).getSnapshot().state === 'ready'); }
  const result = await writing, elapsed = performance.now() - began;
  assert.equal(result.state, 'pending');
  assert.ok(elapsed >= 3800 && elapsed < 6000, `default mutation waited ${elapsed} ms`);
  assert.equal((await f.journal()).pending[0].id, result.id, 'timeout preserves durable custody');
  assert.equal(f.requests.length, 1);
});

for (const waitSeconds of [0, 1, 5]) test(`journal device mutation honors explicit waitSeconds=${waitSeconds}`, {timeout: 12000}, async t => {
  const f = await fixture(t, {startup: null}); await f.app.ready;
  const began = performance.now();
  const result = await f.app.mutate(mutation, {}, {waitSeconds});
  const elapsed = performance.now() - began;
  assert.equal(result.state, 'pending');
  assert.ok(elapsed >= waitSeconds * 1000 - 100 && elapsed < waitSeconds * 1000 + 1500, `explicit wait took ${elapsed} ms`);
});

regression('E3 terminal journal E_AUTH ends the unchanged credential after generation adoption',async t=>{
  const backend=structuredClone(schema);let core;
  const denied={code:'E_AUTH',family:'auth',message:'session revoked',retryable:false};
  const f=await fixture(t,{backend,wrapCore:opened=>{core=opened;return opened;},receiptReply:()=>({denied})});
  await f.app.ready;f.coreGate.resolve();await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  const client=f.app.client;
  await f.app.mutate(mutation,{}, {waitSeconds:0});await f.posted.promise;
  backend.generation=2;await until(()=>f.change({generation:2,store_id:'A',head:21,seq:21,tables:[]}));await client.sync();
  assert.equal((await core.call({op:'state'})).ok.generation,2);
  assert.equal(client.session().token,'token');
  f.release.resolve();await until(()=>f.app.auth.state==='signed-out');
  assert.equal(client.session(),null);
});

regression('E3 transient refresh failure preserves a held successful journal write cut',async t=>{
  let core;
  const f=await fixture(t,{raw:true,syncHead:20,wrapCore:opened=>{core=opened;return opened;},receiptReply:receipt=>({...receipt,generation:2}),
    refreshReply:()=>Response.json({ok:false,why:{code:'E_OVERLOADED',family:'availability',message:'try later',retryable:true}},{status:503})});
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  assert.equal((await f.app.client.query(query,{})).data,'local');
  const writing=f.app.mutate(mutation,{}, {waitSeconds:5});await f.posted.promise;
  const refreshed=await f.app.client.refreshSession();assert.equal(refreshed.ok,false);assert.equal(refreshed.why.retryable,true);
  assert.equal(f.app.client.session().token,'token');
  f.release.resolve();assert.equal((await writing).state,'sent');
  await until(async()=>!(await f.app.client.pendingWrites()).length);
  const read=await f.app.client.query(query,{});assert.equal(read.data,'server',JSON.stringify(read));
  assert.equal((await core.call({op:'state'})).ok.generation,1,'obsolete response metadata did not adopt its generation');
});

regression('E3 receipt store binding is rechecked after a held journal save',async t=>{
  const memory=memorySessionStore(),entered=gate(),save=gate(),id=mintId();let armed=false,core;
  const store={...memory,async set(key,value){if(armed&&key===storeKey('writes','https://progressive-writes.invalid','alice')&&JSON.parse(value).receipts?.some(w=>w.id===id)){entered.resolve();await save.promise;}return memory.set(key,value);}};
  t.after(()=>save.resolve());
  const f=await fixture(t,{raw:true,hold:false,store,wrapCore:opened=>{core=opened;return opened;},receiptReply:receipt=>({...receipt,store_id:'A'})});
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');armed=true;
  const writing=f.app.mutate(mutation,{}, {id,waitSeconds:5});await entered.promise;
  f.replace('B');await f.app.client.sync();await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  assert.equal((await core.call({op:'sync_state',capture:false})).ok.store_id,'B');
  f.offline(true);save.resolve();assert.equal((await writing).state,'sent');
  await until(async()=>!(await f.app.client.pendingWrites()).length);
  const read=await f.app.client.query(query,{});assert.equal(read.data,'local',JSON.stringify(read));
});

regression('E3 journal retry recognizes a peer receipt learned after opening with device unlisted',async t=>{
  const store=memorySessionStore(),id=mintId(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice');
  await store.set(key,JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id,op:'write',args:{},storeId:'A'}],receipts:[]}));
  let progressive;const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(...args){await install.apply(this,args);progressive=this;});
  const f=await fixture(t,{store,custody:'present'});await f.app.ready;
  assert.equal(progressive.current().some(write=>write.id===id),true);
  // A peer's committed settlement, published through the real journal channel.
  const receipt={state:'sent',id,seq:21,replayed:true};
  await storeLock(key,()=>store.set(key,JSON.stringify({owner:'alice',backend:url,pending:[],receipts:[receipt]})));
  const events=journalChanges(key,()=>{});t.after(()=>events.close());events.notify();
  await until(()=>!progressive.uncertain&&!progressive.current().some(write=>write.id===id));
  assert.deepEqual(await f.app.client.write(id),receipt);
  const retry=await f.app.mutate(mutation,{}, {id,waitSeconds:0});assert.deepEqual(retry,receipt);
  assert.equal(f.local(),undefined,'the device is still unopened');assert.deepEqual(f.requests,[]);
});

regression('E3 surviving live capture is recovered automatically after its peer dies',async t=>{
  const entries=new Map(),storage={get length(){return entries.size;},key:i=>[...entries.keys()][i]??null,getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,String(value)),removeItem:key=>entries.delete(key)};
  for(const [name,value] of Object.entries({window:Object.assign(new EventTarget(),{location:{href:'https://app.invalid'}}),localStorage:storage})){
    const before=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{configurable:true,value});t.after(()=>before?Object.defineProperty(globalThis,name,before):delete globalThis[name]);
  }
  const url='https://progressive-writes.invalid',key=sessionKey(url),id=mintId();
  const authority={capture:()=>({key,epoch:'1',principal:'alice',source:'browser'}),read:async requested=>requested===key?JSON.stringify({principal:'alice',snapback4Epoch:'1'}):'1',recheck(){}};
  const capture=new OnlineCapture(url,'alice',authority);await capture.ready;capture.capture(id,'write',{},'A');t.after(()=>capture.close());
  let inspections=0;const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(local,...args){await install.call(this,local,...args);const custody=progressiveWriteCustody(local),inspect=custody.inspect;custody.inspect=async()=>{inspections++;return inspect();};});
  const f=await fixture(t,{raw:true,authority,hold:false});
  await until(()=>inspections>=2);assert.deepEqual(f.requests,[],'a living peer keeps its capture');
  capture.close();
  // No query, mutation, pending read or peer notification kicks recovery.
  await until(()=>f.requests.includes(id));
  await until(async()=> (await f.journal()).receipts.some(write=>write.id===id));
  assert.deepEqual(f.requests,[id]);assert.equal(f.executions.size,1);
});

regression('E4 unsequenced retained-history server bytes cannot inherit local evaluation coverage',async t=>{
  const backend=structuredClone(schema);
  backend.schema.tables.items={columns:{},indexes:{},rules:{read:'Allow',insert:'Allow',update:'Allow',delete:'Allow'},sync:{audience:'Public'},leave:'delivered-history'};
  let incomplete=false,serverReads=0;
  const kept=[{id:'kept'}],remote=[{id:'unsequenced'}];
  const f=await fixture(t,{raw:true,backend,syncHead:21,hold:false,
    wrapCore:core=>({...core,call(request,...rest){
      if(request.op==='query'&&request.name==='read')return Promise.resolve({ok:{data:kept,tables:['items'],watermark:23,complete:!incomplete,unknown:incomplete}});
      return core.call(request,...rest);
    }}),queryReply:()=>{serverReads++;return {data:remote,complete:true,tables:['items']};}});
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  const watch=f.app.client.observe(query,{}),seen=[];watch.subscribe(()=>seen.push(watch.getSnapshot()));t.after(()=>watch.close());
  await until(()=>watch.getSnapshot().data?.[0]?.id==='kept');
  f.head(21);incomplete=true;
  assert.equal((await f.app.mutate(mutation,{})).seq,22);
  await until(()=>serverReads>0);await new Promise(resolve=>setTimeout(resolve,100));
  assert.deepEqual(watch.getSnapshot().data,kept,'custodyWaiting retains displayed rows below the receipt cut');
  assert.equal(seen.some(read=>read.data?.[0]?.id==='unsequenced'),false);
});

regression('E4 opening pending J1 stays journal-owned when the first inspection fails',async t=>{
  const memory=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice'),id=mintId();
  await memory.set(key,JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id,op:'write',args:{},storeId:'A'}],receipts:[]}));
  let reads=0,progressive,installing=false,fail=true;
  const store={...memory,async get(k){if(installing&&k===key&&++reads>=2)throw Error('first inspect failed');return memory.get(k);}};
  const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(local,...args){installing=true;await install.call(this,local,...args);installing=false;progressive=this;const custody=progressiveWriteCustody(local),inspect=custody.inspect;custody.inspect=()=>fail?Promise.reject(Error('inspection still unavailable')):inspect();});
  const listing=gate();t.after(()=>listing.resolve());
  const f=await fixture(t,{raw:true,store,custody:'present',report:()=>{},wrapCore:core=>({...core,async call(request,...args){if(request.op==='queued')await listing.promise;return core.call(request,...args);}})});await f.app.ready;
  assert.equal(progressive.uncertain,true);assert.deepEqual(progressive.current(),[]);
  // start() already reserved J1 for replay, before the device lists its outbox.
  let outcome;const retry=f.app.mutate(mutation,{}, {id,waitSeconds:0}).then(write=>outcome=write);
  await tick();assert.notEqual(outcome?.state,'failed',JSON.stringify(outcome));
  assert.equal((await f.journal()).pending.filter(w=>w.id===id).length,1);
  fail=false;listing.resolve();f.coreGate.resolve();f.release.resolve();await retry;
  await until(async()=> (await f.app.client.write(id))?.state==='sent');
  assert.deepEqual(f.requests,[id]);
});

regression('E4 a live receipt binding routes same-id recovery before inspection learns it',async t=>{
  let progressive,custody;const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(local,...args){await install.call(this,local,...args);progressive=this;custody=progressiveWriteCustody(local);});
  const store=memorySessionStore(),url='https://progressive-writes.invalid',opening=mintId();
  await store.set(storeKey('writes',url,'alice'),JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id:opening,op:'write',args:{},storeId:'A'}],receipts:[]}));
  const listing=gate();t.after(()=>listing.resolve());
  const f=await fixture(t,{raw:true,store,custody:'present',wrapCore:core=>({...core,async call(request,...args){if(request.op==='queued')await listing.promise;return core.call(request,...args);}})});await f.app.ready;
  const snapshot=await custody.inspect();t.mock.method(custody,'inspect',async()=>snapshot);
  const id=mintId();
  // Isolate the third positive-ownership source: dispatch has reported the
  // receipt binding, but its asynchronous journal save/inspection has not run.
  progressive.receipt(id,{store:'A',generation:1,preserved:[],authorityCurrent:()=>true});
  const receipt={state:'sent',id,seq:21,replayed:true};
  await f.store.set(storeKey('writes',f.url,'alice'),JSON.stringify({owner:'alice',backend:f.url,pending:[],receipts:[receipt]}));
  assert.equal(progressive.current().some(write=>write.id===id),false);
  assert.deepEqual(await f.app.mutate(mutation,{}, {id,waitSeconds:0}),receipt);
  assert.deepEqual(f.requests,[]);
});

function browserCapture(t) {
  const entries=new Map(),storage={get length(){return entries.size;},key:i=>[...entries.keys()][i]??null,getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,String(value)),removeItem:key=>entries.delete(key)};
  for(const [name,value] of Object.entries({window:Object.assign(new EventTarget(),{location:{href:'https://app.invalid'}}),localStorage:storage})) {
    const before=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{configurable:true,value});
    t.after(()=>before?Object.defineProperty(globalThis,name,before):delete globalThis[name]);
  }
  const url='https://progressive-writes.invalid',key=sessionKey(url);
  return {storage,authority:{capture:()=>({key,epoch:'1',principal:'alice',source:'browser'}),read:async requested=>requested===key?JSON.stringify({principal:'alice',snapback4Epoch:'1'}):'1',recheck(){}}};
}

regression('E4 an ordinary live click allows a disjoint read while its journal commit is held',async t=>{
  const {authority}=browserCapture(t),memory=memorySessionStore(),entered=gate(),release=gate();let hold=false;
  const store={...memory,async set(key,value){if(hold&&key===storeKey('writes','https://progressive-writes.invalid','alice')&&JSON.parse(value).pending.length){entered.resolve();await release.promise;}return memory.set(key,value);}};
  t.after(()=>release.resolve());
  const f=await fixture(t,{raw:true,store,authority});await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  hold=true;const writing=f.app.client.mutate(mutation,{}, {waitSeconds:0});await entered.promise;
  let intersected=false;const dependent=f.app.client.query(query,{}).then(read=>{intersected=true;return read;});
  const watch=f.app.client.observe({kind:'query',name:'other'},{});watch.subscribe(()=>{});t.after(()=>watch.close());
  await until(()=>watch.getSnapshot().data==='other');assert.equal(intersected,false);
  hold=false;release.resolve();await writing;await f.posted.promise;f.release.resolve();assert.ok('data' in await dependent);
});

regression('E4 a live peer capture parks intersecting reads until its runtime dies',async t=>{
  const {authority}=browserCapture(t),id=mintId(),capture=new OnlineCapture('https://progressive-writes.invalid','alice',authority);
  await capture.ready;capture.capture(id,'write',{},'A');t.after(()=>capture.close());
  const f=await fixture(t,{raw:true,authority});await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  let answered=false;const reading=f.app.client.query(query,{}).then(read=>{answered=true;return read;});
  assert.equal((await f.app.client.query({kind:'query',name:'other'},{})).data,'other');
  assert.equal(answered,false);assert.deepEqual(f.requests,[]);
  capture.close();await f.posted.promise;assert.equal(answered,false);f.release.resolve();assert.ok('data' in await reading);
});

regression('E4 failed capture removal keeps the recovery fence until removal succeeds',async t=>{
  const {authority,storage}=browserCapture(t);let fail=false,progressive;
  const remove=storage.removeItem;t.mock.method(storage,'removeItem',key=>{if(fail)throw Error('remove blocked');return remove(key);});
  const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(...args){await install.apply(this,args);progressive=this;});
  const f=await fixture(t,{raw:true,authority,hold:false});await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  fail=true;await f.app.client.mutate(mutation,{});
  await until(()=>progressive.uncertain);
  let answered=false;const reading=f.app.client.query({kind:'query',name:'other'},{}).then(read=>{answered=true;return read;});
  await tick();assert.equal(answered,false);fail=false;
  assert.ok('data' in await reading);assert.equal(progressive.uncertain,false);
});

regression('E4 inspection storage failures back off, report once per streak and reset on success',async t=>{
  let failing=false;const memory=memorySessionStore(),warnings=[],scheduled=[];
  const store={...memory,async get(key){if(failing&&key.includes('writes'))throw Error('IndexedDB unavailable');return memory.get(key);}};
  const f=await fixture(t,{raw:true,store,report:error=>warnings.push(error)});
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  const native=setTimeout;
  t.mock.method(globalThis,'setTimeout',(fn,delay,...args)=>{
    if(new Error().stack.includes('/dist/progressive-writes.js')){scheduled.push({fn,delay});return {unref(){}};}
    return native(fn,delay,...args);
  });
  const events=journalChanges(storeKey('writes',f.url,'alice'),()=>{});t.after(()=>events.close());
  failing=true;events.notify();await until(()=>scheduled.length===1);
  for(let i=0;i<7;i++){const timer=scheduled[i];assert.ok(timer.delay>=Math.min(100*2**i,3200)-20&&timer.delay<=Math.min(100*2**i,3200),`retry ${i}: ${timer.delay}`);timer.fn();await until(()=>scheduled.length===i+2);}
  assert.equal(warnings.length,1,'one problem publication for the storage failure streak');
  failing=false;scheduled.at(-1).fn();await tick();await tick();
  const before=scheduled.length;failing=true;events.notify();await until(()=>scheduled.length>before);
  assert.equal(warnings.length,2);assert.ok(scheduled.at(-1).delay<=100,'successful inspection resets the delay');
  failing=false;
});

for(const raw of [true,false])regression(`E4 opening damage retries quarantine under both locks and recovers without reload (raw=${raw})`,async t=>{
  const memory=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice'),warnings=[];
  await memory.set(key,'damaged journal bytes');let failures=0,quarantined,held;
  const store={...memory,async set(k,value){if(k.startsWith(`${key}.damaged.`)){held=await navigator.locks.query();if(failures++===0)throw Error('quarantine unavailable once');quarantined=value;}return memory.set(k,value);}};
  const f=await fixture(t,{raw,store,report:error=>warnings.push(error),hold:false});await f.app.ready;
  const receipts=[];const stop=f.app.client.onWrite(write=>receipts.push(write));t.after(stop);
  assert.equal((await f.app.client.query(query,{})).denied?.code,'E_ADMISSION');
  assert.equal(await memory.get(key),'damaged journal bytes');
  assert.equal((await f.app.client.mutate(mutation,{})).why?.code,'E_ADMISSION');
  const recovered=await f.app.client.query(query,{});assert.ok('data' in recovered,JSON.stringify(recovered));
  assert.equal(quarantined,'damaged journal bytes');
  assert.ok(held.held.some(lock=>lock.name.includes(key)));assert.ok(held.held.some(lock=>lock.name.includes(sessionKey(url))));
  assert.equal((await f.app.client.mutate(mutation,{})).state,'sent');assert.equal(f.requests.length,1);
  await until(()=>receipts.length===1);assert.equal(receipts[0].state,'sent');
});

regression('E4 inspection-learned peer receipt owns an id absent from opening pending and live bindings',async t=>{
  const store=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice'),opening=mintId(),id=mintId();
  await store.set(key,JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id:opening,op:'write',args:{},storeId:'A'}],receipts:[]}));
  let progressive,inspected=false;const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(local,...args){await install.call(this,local,...args);progressive=this;const custody=progressiveWriteCustody(local),inspect=custody.inspect;
    custody.inspect=async()=>{const snapshot=await inspect();if(snapshot.receipts.some(w=>w.id===id))inspected=true;return snapshot;};});
  const f=await fixture(t,{store,custody:'present'});await f.app.ready;
  const receipt={state:'failed',id,why:{code:'APP_REFUSED',family:'app',message:'write refused: APP_REFUSED'}};
  await storeLock(key,()=>store.set(key,JSON.stringify({owner:'alice',backend:url,pending:[],receipts:[receipt]})));
  const events=journalChanges(key,()=>{});t.after(()=>events.close());events.notify();
  await until(()=>inspected&&!progressive.uncertain);
  assert.equal(progressive.current().some(w=>w.id===id),false);assert.equal(progressive.receipts.has(id),false);
  assert.deepEqual(await f.app.mutate(mutation,{}, {id,waitSeconds:0}),receipt);
  assert.equal(f.local(),undefined);assert.deepEqual(f.requests,[]);
});

for(const remote of [[],{rows:[]},[{id:'server'}]])regression(`E4 provisional watermark certifies only its bytes (${Array.isArray(remote)?remote.length?'array':'empty':'structured'} server reply)`,async()=>{
  const reads=new LocalReads(),data=[{id:'local'}];
  const env={backend:{generation:1,schema:{tables:{items:{sync:{},leave:'delivered-history'}}},programs:[{name:'read',body:[{table:'items'}]}]},
    incarnation:0,credentialRevision:0,authority:0,partitionCurrent:true,nativeReady:true,principal:'alice',link:'online',caughtUp:false,identityChecked:true,
    refreshing:null,partitionDenied:null,lastSyncAt:1,signal:new AbortController().signal,unavailable:()=>null,deviceNow:()=>1,serverNow:()=>1,
    queued:async()=>[],pending:()=>false,receiptCurrent:watermark=>watermark>=22,
    call:async request=>({ok:request.op==='state'?{watermark:21}:{data,unknown:true,complete:false,tables:['items'],watermark:23}}),
    post:async()=>({ok:true,obsoleteAuth:false,json:{data:remote,tables:['items'],complete:true}}),
    notify(){},offline:()=>({code:'E_OFFLINE',family:'link',message:'offline'}),serverAnswers:reads.serverAnswers.view()};
  const candidate=await evaluateLocal(env,query,{},0,0);
  const replaced=Array.isArray(remote)&&remote.length>0;
  assert.deepEqual(candidate.read.data,replaced?remote:data);assert.equal(candidate.evaluationWatermark,replaced?undefined:23);assert.equal(candidate.seq,undefined);assert.equal(candidate.served,true);
  assert.equal((candidate.seq??candidate.evaluationWatermark??21)>=22,!replaced,'only the local published bytes cover the receipt cut');
});
