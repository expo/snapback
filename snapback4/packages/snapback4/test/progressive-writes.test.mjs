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
import { OnlineCapture } from '../dist/online-capture.js';
import { pendingIntentAccess } from '../dist/pending-items.js';
import { QueryCustody } from '../dist/query-custody.js';
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
  backend=schema, failure, badEngine=false, wrapCore=core=>core, queryReply, receiptReply, syncHead, syncWait, authority, report=console.error, basePath=''}={}) {
  const url='https://progressive-writes.invalid'+basePath, release=gate(), posted=gate(), coreGate=gate();
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
    if(path==='/probe')return Response.json({ok:true,viewer:'alice',scope:'full',store_id:storeId,seq:head,generation:1});
    if(path==='/sync'){await syncWait?.promise;if(failSync)return Response.json({denied:failSync},{status:409});return Response.json({generation:1,store_id:storeId,snapshot:!JSON.parse(init.body).stream,watermark:syncHead??head,images_at:syncHead??head,events:[],committed_above:{},more:false});}
    if(path==='/changes')return new Promise((resolve,reject)=>{changes.push(body=>resolve(Response.json(body)));if(init.signal.aborted)reject(init.signal.reason);else init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});
    if(path==='/auth/login')return Response.json({ok:true,session:{token:'bob-token',principal:'bob',kind:'user',expiresAt:Date.now()+7*86400000}});
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
  const options={url,sessionStore:store,startup:'progressive',device:{...device,async open(...args){const core=await device.open(...args);return {...core,onClient(client){local=client;}};}},fetch};
  let app;
  if(raw){prepareProgressiveWrites(options,{store,report,authority});const prepared=await prepareClient(options,()=>createLocalClient(options));local=prepared.client;app={client:local,mutate:local.mutate,close:local.close,ready:Promise.resolve({ok:true})};progressiveWriteCustody(local)?.start();await prepared.start();}
  else app=createApp(options);
  t.after(async()=>{release.resolve();coreGate.resolve();syncWait?.resolve();await app.close();});
  return {app,store,url,requests,executions,posted,release,coreGate,reads:()=>reads,coreOpens:()=>coreOpens,local:()=>local,
    journal:async()=>JSON.parse(await store.get(storeKey('writes',url,'alice'))??'null'), change:body=>{const next=changes.shift();next?.(body);return !!next;}, fail:why=>{failStore=why;}, failSync:why=>{failSync=why;}, replace:id=>{storeId=id;head=0;}, head:value=>{head=value;}, offline:value=>{offline=value;}, revokes:()=>revokes};
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
  assert.equal((await f.app.client.query(query,{})).data,'local');assert.equal((await f.app.mutate(mutation,{})).why.code,'E_ADMISSION');assert.ok(warnings.length);
  assert.equal(changes,0,'decision is non-mutating');assert.deepEqual(f.requests,[]);
});

regression('outbox-owned reads do not perform journal I/O or start a journal transport',async t=>{
  const memory=memorySessionStore();let reads=0;
  const store={...memory,async get(key){if(key.includes('writes'))reads++;return memory.get(key);}};
  const f=await fixture(t,{store,custody:'present',raw:true,hold:false});const openedReads=reads;
  for(let n=0;n<5;n++){assert.ok('data' in await f.app.client.query(query,{}));await f.app.client.pendingWrites();}
  assert.equal(reads,openedReads);assert.equal((await f.journal()),null);
});

regression('device plus progressive refuses writes online with a rewrite',async()=>{
  const app=createApp({url:'https://progressive-writes.invalid',device:{custody:async()=> 'none',open(){throw Error('must not open');}},startup:'progressive',writes:'online'});
  const result=await app.ready;assert.equal(result.ok,false);assert.equal(result.why.code,'E_CLIENT');assert.match(result.why.rewrite,/omit writes/);await app.close();
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
