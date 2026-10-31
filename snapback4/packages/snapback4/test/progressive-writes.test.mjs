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
import { pendingItemsSource } from '../dist/react-pending-items.js';
import { pendingIntentAccess } from '../dist/pending-items.js';
import { QueryCustody } from '../dist/query-custody.js';
import { evaluateLocal } from '../dist/local-query.js';
import { LocalReads } from '../dist/local-reads.js';
import { mutationEntry } from '../dist/admission.js';
import { DeviceVersionError } from '../dist/device-version.js';
import { deviceControl } from '../dist/device-control.js';
import { deviceRestore } from '../dist/device-restore.js';
import { episodeDeadline } from '../dist/read-episode.js';
import { QueryCuts } from '../dist/query-dependencies.js';
import { fixture, wasm, gate, tick, until, mutation, query, schema } from './helpers/progressive-writes.mjs';

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
  let openingChanges; const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(...args){
    await install.apply(this,args); openingChanges??=changes;
  });
  const f=await fixture(t,{store,custody:'present',raw:true,authority:failure==='capture'?{capture:()=>({key:'session',epoch:'epoch',principal:'alice',source:'browser'}),recheck(){}}:undefined,report:error=>warnings.push(error)});
  assert.equal(openingChanges,0,'opening inspection is non-mutating before start retries recovery');
  assert.equal((await f.app.client.query(query,{})).denied?.code,'E_ADMISSION');assert.equal((await f.app.mutate(mutation,{})).why.code,'E_ADMISSION');assert.ok(warnings.length);
  if(failure==='damaged'){assert.ok(changes>=1,'start and dependent reads attempt recovery');assert.equal(await memory.get(key),'broken journal','failed preservation never replaces the original bytes');}
  else assert.equal(changes,0);
  assert.deepEqual(f.requests,[]);
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

for(const [peer,inspectionLag] of [[false,0],[false,1100],[true,0]])regression(`E1 surviving capture remains uncertain through ${peer?'pre-start peer broadcast':'failed recovery save and query inspection'} (inspection lag=${inspectionLag})`,async t=>{
  const entries=new Map(),storage={get length(){return entries.size;},key:i=>[...entries.keys()][i]??null,getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,String(value)),removeItem:key=>entries.delete(key)};
  for(const [name,value] of Object.entries({window:Object.assign(new EventTarget(),{location:{href:'https://app.invalid'}}),localStorage:storage})) {
    const before=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{configurable:true,value});t.after(()=>before?Object.defineProperty(globalThis,name,before):delete globalThis[name]);
  }
  const url='https://progressive-writes.invalid',key=sessionKey(url),journalKey=storeKey('writes',url,'alice'),memory=memorySessionStore(),id=mintId();
  const authority={capture:()=>({key,epoch:'1',principal:'alice',source:'browser'}),read:async requested=>requested===key?JSON.stringify({principal:'alice',snapback4Epoch:'1'}):'1',recheck(){}};
  const capture=new OnlineCapture(url,'alice',authority);await capture.ready;capture.capture(id,'write',{},'A');capture.close();
  let fail=!peer,failures=0,firstFailure,progressive,inspections=0,uncertainAtBroadcast,retryFired=false,retryDelay,secondAfterTimer;const install=ProgressiveWrites.prototype.install;
  const timer=setTimeout;t.mock.method(globalThis,'setTimeout',(fn,delay,...args)=>{
    if(new Error().stack.includes('scheduleRecovery')){retryDelay??=delay;return timer(()=>{retryFired=true;fn(...args);},delay);}
    return timer(fn,delay,...args);
  });
  const store={...memory,async set(key,value){if(fail&&key===journalKey&&JSON.parse(value).pending.some(w=>w.id===id)){firstFailure??=performance.now();if(++failures===2)secondAfterTimer=retryFired;throw Error('recovery save failed');}return memory.set(key,value);}};
  t.mock.method(ProgressiveWrites.prototype,'install',async function(local,...args){await install.call(this,local,...args);progressive=this;const custody=progressiveWriteCustody(local),inspect=custody.inspect;custody.inspect=async()=>{inspections++;return inspect();};
    if(peer){const events=journalChanges(journalKey,()=>{});events.notify();await until(()=>inspections>0);await tick();events.close();uncertainAtBroadcast=this.uncertain;}});
  t.after(()=>{fail=false;});
  const f=await fixture(t,{raw:true,store,authority,report:()=>{}});
  if(!peer){await until(()=>failures>0);assert.equal(failures,1,'the first failed save precedes any inspection delay');}
  if(inspectionLag){await new Promise(resolve=>setTimeout(resolve,inspectionLag));await until(()=>failures>=2);assert.equal(retryDelay,1000);assert.equal(secondAfterTimer,true,'the second save follows the one-second retry timer');}
  if(peer)assert.equal(uncertainAtBroadcast,true,'peer inspection cannot certify a surviving capture');
  if(!peer){await until(()=>failures>0);let answered=false;const reading=f.app.client.query(query,{}).then(read=>{answered=true;return read;});
    await until(()=>inspections>0);await new Promise(resolve=>setTimeout(resolve,100));assert.equal(progressive.uncertain,true);assert.equal(answered,false,'successful empty inspection cannot publish pre-capture data');
    if(performance.now()-firstFailure<900)assert.equal(failures,1,'inspection must leave the failed recovery to its one-second backoff');
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

for(const startup of ['progressive','awaited'])regression(`E3 receipt store binding is rechecked after a held journal save (${startup})`,async t=>{
  const memory=memorySessionStore(),entered=gate(),save=gate(),id=mintId();let armed=false,core;
  const url='https://progressive-writes.invalid';
  await memory.set(storeKey('writes',url,'alice'),JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id:mintId(),op:'write',args:{},storeId:'A'}],receipts:[]}));
  const store={...memory,async set(key,value){if(armed&&key===storeKey('writes','https://progressive-writes.invalid','alice')&&JSON.parse(value).receipts?.some(w=>w.id===id)){entered.resolve();await save.promise;}return memory.set(key,value);}};
  t.after(()=>save.resolve());
  const f=await fixture(t,{raw:true,startup,journal:true,hold:false,store,wrapCore:opened=>{core=opened;return opened;},receiptReply:receipt=>({...receipt,store_id:'A'})});
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');await until(async()=>!(await f.app.client.pendingWrites()).length);armed=true;
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
  await memory.set(key,'damaged journal bytes');let repaired=false,quarantined,held;
  const store={...memory,async set(k,value){if(k.startsWith(`${key}.damaged.`)){held=await navigator.locks.query();if(!repaired)throw Error('quarantine unavailable until repaired');quarantined=value;}return memory.set(k,value);}};
  const f=await fixture(t,{raw,store,report:error=>warnings.push(error),hold:false});await f.app.ready;
  const receipts=[];const stop=f.app.client.onWrite(write=>receipts.push(write));t.after(stop);
  assert.equal((await f.app.client.query(query,{})).denied?.code,'E_ADMISSION');
  assert.equal(await memory.get(key),'damaged journal bytes');
  assert.equal((await f.app.client.mutate(mutation,{})).why?.code,'E_ADMISSION');
  repaired=true;
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

regression('E5 inspected peer receipt recovers without a fresh capture on exhausted storage',async t=>{
  const {storage,authority}=browserCapture(t),store=memorySessionStore(),id=mintId();
  let inspected=false;const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(local,...args){await install.call(this,local,...args);const custody=progressiveWriteCustody(local),inspect=custody.inspect;
    custody.inspect=async()=>{const snapshot=await inspect();if(snapshot.receipts.some(write=>write.id===id))inspected=true;return snapshot;};});
  const f=await fixture(t,{raw:true,authority,store});await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  const receipt={state:'sent',id,seq:21,replayed:true},key=storeKey('writes',f.url,'alice');
  await storeLock(key,()=>store.set(key,JSON.stringify({owner:'alice',backend:f.url,pending:[],receipts:[receipt]})));
  const events=journalChanges(key,()=>{});t.after(()=>events.close());events.notify();await until(()=>inspected);
  let captures=0;t.mock.method(storage,'setItem',()=>{captures++;throw new DOMException('full','QuotaExceededError');});
  // No write(id) lookup has taught MutationIds about this peer's id.
  assert.deepEqual(await f.app.mutate(mutation,{}, {id,waitSeconds:0}),receipt);
  assert.equal(captures,0);assert.deepEqual(f.requests,[]);
  await f.app.close();
});

regression('E8 same-store generation adoption retains an unknown receipt cut until reads cover it',async t=>{
  const backend=structuredClone(schema),cuts=[],cover=gate();let core;
  const change=QueryCuts.prototype.change;
  t.mock.method(QueryCuts.prototype,'change',function(...args){cuts.push(args);return change.apply(this,args);});
  t.after(()=>cover.resolve());
  const f=await fixture(t,{raw:true,backend,syncHead:20,wrapCore:opened=>{core=opened;return opened;},
    queryReply:async path=>{await cover.promise;return {data:'covered',complete:true,tables:path.endsWith('/other')?['other']:['items'],seq:21,store_id:'A',generation:2};}});
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  const writing=f.app.mutate(mutation,{}, {waitSeconds:5});await f.posted.promise;
  backend.generation=2;await f.app.client.sync();assert.equal((await core.call({op:'state'})).ok.generation,2);
  cuts.length=0;f.release.resolve();assert.equal((await writing).state,'sent');await until(async()=>!(await f.app.client.pendingWrites()).length);
  assert.ok(cuts.some(([cut,writes])=>cut===21&&writes===undefined),'same-store sequences remain comparable; old execution metadata is unknown');
  const answers=[];
  const reads=[query,{kind:'query',name:'other'}].map(op=>f.app.client.query(op,{}).then(read=>{answers.push(read);return read;}));
  await until(()=>f.reads()>=2);assert.deepEqual(answers,[],'neither dependent nor apparently disjoint stale local data is fresh');
  cover.resolve();for(const read of await Promise.all(reads))assert.equal(read.data,'covered',JSON.stringify(read));
});

regression('E5 receipt A settling inside replacement adoption cannot write its seq into B cuts',async t=>{
  const memory=memorySessionStore(),saveEntered=gate(),save=gate(),adopting=gate(),adopt=gate(),id=mintId(),cuts=[];
  let armed=false,core,progressive,observation;const change=QueryCuts.prototype.change,install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(...args){progressive=this;observation=args[6];return install.apply(this,args);});
  t.mock.method(QueryCuts.prototype,'change',function(...args){cuts.push(args);return change.apply(this,args);});
  const store={...memory,async set(key,value){if(armed&&key===storeKey('writes','https://progressive-writes.invalid','alice')&&JSON.parse(value).receipts?.some(write=>write.id===id)){saveEntered.resolve();await save.promise;}return memory.set(key,value);}};
  t.after(()=>{save.resolve();adopt.resolve();});
  const f=await fixture(t,{raw:true,hold:false,store,wrapCore:opened=>{core=opened;return {...opened,async call(request,...args){
    if(armed&&request.op==='adopt'&&request.backend.store_id==='B'){adopting.resolve();await adopt.promise;}
    return opened.call(request,...args);
  }};},receiptReply:receipt=>({...receipt,store_id:'A'})});
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');armed=true;
  const writing=f.app.mutate(mutation,{}, {id,waitSeconds:5});await saveEntered.promise;
  f.replace('B');const syncing=f.app.client.sync();await adopting.promise;
  // Settle in the reset/adoption window: the device identity is B but
  // onlineStore is A. The store check must reject A's otherwise valid cut.
  const current=observation(),receipt=progressive.receipts.get(id);
  assert.equal(current.store,'B');assert.equal(receipt.store,'A');assert.equal(receipt.authorityCurrent(),false);
  assert.equal(Object.hasOwn(receipt,'incarnation'),false,'authority lives in the dispatch predicate, not an unread stamp');
  cuts.length=0;save.resolve();assert.equal((await writing).state,'sent');await until(async()=>!(await f.app.client.pendingWrites()).length);
  assert.deepEqual(cuts,[],'storeIdentity is B while onlineStore still names A');
  adopt.resolve();await syncing;await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  assert.equal((await core.call({op:'sync_state',capture:false})).ok.store_id,'B');f.offline(true);
  const read=await f.app.client.query(query,{});assert.equal(read.data,'local',JSON.stringify(read));
});

regression('E5 mismatched receipt settlement wakes a watch parked by journal intersection',async t=>{
  const memory=memorySessionStore(),entered=gate(),save=gate(),id=mintId();let armed=false,evaluations=0,progressive;
  const install=ProgressiveWrites.prototype.install;t.mock.method(ProgressiveWrites.prototype,'install',async function(local,...args){await install.call(this,local,...args);progressive=this;
    const custody=progressiveWriteCustody(local),inspect=custody.inspect;
    // Keep the last committed pending snapshot readable while the receipt save
    // is held, isolating journalIntersects from the separate uncertainty wake.
    custody.inspect=()=>armed?Promise.resolve({pending:[{id,op:'write',args:{},state:'sent',predicted:[]}],receipts:[]}):inspect();});
  const store={...memory,async set(key,value){if(armed&&key===storeKey('writes','https://progressive-writes.invalid','alice')&&JSON.parse(value).receipts?.some(write=>write.id===id)){entered.resolve();await save.promise;}return memory.set(key,value);}};
  t.after(()=>save.resolve());
  const f=await fixture(t,{raw:true,hold:false,store,wrapCore:core=>({...core,async call(request,...args){if(request.op==='query')evaluations++;return core.call(request,...args);}})});
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');armed=true;
  const writing=f.app.mutate(mutation,{}, {id,waitSeconds:5});await entered.promise;f.replace('B');await f.app.client.sync();
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready'&&!progressive.uncertain);
  const before=evaluations,watch=f.app.client.observe(query,{});watch.subscribe(()=>{});t.after(()=>watch.close());
  await until(()=>evaluations>before);await tick();assert.equal(watch.getSnapshot().loading,true);assert.equal(progressive.uncertain,false);
  armed=false;save.resolve();assert.equal((await writing).state,'sent');
  // Settlement must wake it now, before the unrelated five-second read poll.
  for(let n=0;n<100&&watch.getSnapshot().data!=='local';n++)await tick();
  assert.equal(watch.getSnapshot().data,'local','settlement wakes the parked watch without a later poll');
});

regression('E5 a receipt that adopts its own authority still plants its cut',async t=>{
  const cuts=[],change=QueryCuts.prototype.change;
  t.mock.method(QueryCuts.prototype,'change',function(...args){cuts.push(args);return change.apply(this,args);});
  const backend=structuredClone(schema);
  const f=await fixture(t,{raw:true,backend,receiptReply:receipt=>({...receipt,generation:2})});
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  const writing=f.app.mutate(mutation,{}, {waitSeconds:5});await f.posted.promise;backend.generation=2;cuts.length=0;f.release.resolve();
  assert.equal((await writing).state,'sent');await until(async()=>!(await f.app.client.pendingWrites()).length);
  assert.ok(cuts.some(([seq,writes])=>seq===21&&writes===undefined),'retain an unknown cut until the executed program metadata arrives');
});

for (const coalesced of [true, false]) regression(`E6 peer journal notification retains its fence with an own capture (coalesced=${coalesced})`, async t => {
  let progressive;
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', async function(...args) { await install.apply(this,args); progressive=this; });
  const f = await fixture(t,{raw:true}); await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  const custody=progressiveWriteCustody(f.app.client), own={id:mintId(),op:'write',args:{},state:'queued',predicted:[]};
  const scanning=gate(), scanRelease=gate(), inspecting=gate(), inspectRelease=gate();
  t.after(()=>{scanRelease.resolve();inspectRelease.resolve();});
  let scans=0, inspections=0, peer=false;
  t.mock.method(custody,'captures',()=>[own]);
  t.mock.method(custody,'captureState',async()=>{if(++scans===2&&coalesced){scanning.resolve();await scanRelease.promise;}return {unsettled:false,peers:[]};});
  const inspect=custody.inspect;
  t.mock.method(custody,'inspect',async()=>{if(++inspections===2){inspecting.resolve();await inspectRelease.promise;}return inspect();});
  const events=journalChanges(storeKey('writes',f.url,'alice'),()=>{});t.after(()=>events.close());
  events.notify();
  if(coalesced) await scanning.promise; else await until(()=>scans>=2&&!progressive.uncertain);
  // The peer commits W after the previous journal read, then drops its capture
  // before the next scan. Only its journal notification can keep W fenced.
  const key=storeKey('writes',f.url,'alice'), id=mintId();
  await f.store.set(key,JSON.stringify({owner:'alice',backend:f.url,pending:[{owner:'alice',id,op:'peerWrite',args:{},storeId:'A'}],receipts:[]}));
  peer=true;events.notify();await tick();scanRelease.resolve();await inspecting.promise;
  let answer;
  const reading=f.app.client.query({kind:'query',name:'other'},{}).then(value=>answer=value);
  await tick();await tick();
  assert.equal(peer,true);assert.equal(answer,undefined,'no pre-W disjoint-to-own-capture local data publishes');
  assert.equal(progressive.uncertain,true,'the peer notification needs a covering inspection');
  await f.store.set(key,JSON.stringify({owner:'alice',backend:f.url,pending:[],receipts:[]}));
  inspectRelease.resolve();await reading;
});

regression('E6 opening replay receipt installs cut 22 despite inspections failing through settlement', async t => {
  const {authority}=browserCapture(t), store=memorySessionStore(), id=mintId(), url='https://progressive-writes.invalid';
  await store.set(storeKey('writes',url,'alice'),JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id,op:'write',args:{},storeId:'A'}],receipts:[]}));
  let fail=true, inspections=0;
  const inspect=OnlineCapture.prototype.inspect;
  t.mock.method(OnlineCapture.prototype,'inspect',function(...args){if(fail){inspections++;return Promise.reject(Error('inspection unavailable'));}return inspect.apply(this,args);});
  const f=await fixture(t,{raw:true,store,authority,report:()=>{},syncHead:21,receiptReply:receipt=>({...receipt,seq:22,head:22})});
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');await f.posted.promise;
  const receipts=[];f.app.client.onWrite(write=>receipts.push(write));f.head(22);f.release.resolve();
  await until(()=>receipts.some(write=>write.id===id));assert.ok(inspections>0);
  fail=false;const events=journalChanges(storeKey('writes',url,'alice'),()=>{});t.after(()=>events.close());events.notify();
  const answer=await f.app.client.query(query,{});
  assert.equal(answer.data,'server','complete local watermark 21 cannot satisfy receipt 22');
});

regression('E6 existing facade and hook retain journal selections through opening recovery', async t => {
  const store=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice');
  await store.set(key,'damaged opening');
  const f=await fixture(t,{store});await f.app.ready;
  const access=pendingIntentAccess(f.app.client), hook=pendingItemsSource(f.app.client);
  const stop=hook.subscribe(()=>{},write=>write.op==='write');t.after(stop);
  assert.ok('data' in await f.app.client.query(query,{}));
  const writing=f.app.mutate(mutation,{}, {waitSeconds:0});await f.posted.promise;await writing;
  const id=f.requests[0];
  assert.ok((await access.read()).some(item=>item.write.id===id),'previously captured facade provider sees journal intent');
  await until(()=>hook.getSnapshot().some(item=>item.write.id===id));
  f.release.resolve();await until(()=>hook.getSnapshot().some(item=>item.write.id===id&&item.phase==='settling'));
  assert.equal(hook.getSnapshot().find(item=>item.write.id===id).receipt.seq,21,'selection registered before recovery retains settlement');
});

regression('E6 recovery and inspection share one failure streak until both succeed', async t => {
  const {authority}=browserCapture(t),memory=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice');
  const id=mintId(),capture=new OnlineCapture(url,'alice',authority);await capture.ready;capture.capture(id,'write',{},'A');capture.close();
  let failing=true,saves=0;const warnings=[],recoveryTimers=[],inspectionTimers=[];
  const store={...memory,async set(k,value){if(failing&&k===key&&JSON.parse(value).pending.some(write=>write.id===id)){saves++;throw Error('journal storage unavailable');}return memory.set(k,value);}};
  const native=setTimeout;
  t.mock.method(globalThis,'setTimeout',(fn,delay,...args)=>{
    const stack=new Error().stack;
    if(stack.includes('scheduleRecovery')){recoveryTimers.push({fn,delay});return {unref(){}};}
    if(stack.includes('/dist/progressive-writes.js')){inspectionTimers.push({fn,delay});return {unref(){}};}
    return native(fn,delay,...args);
  });
  const f=await fixture(t,{raw:true,store,authority,report:error=>warnings.push(error),hold:false});
  await until(()=>recoveryTimers.length===1);assert.equal(warnings.length,1);
  for(let n=0;n<4;n++){
    const before=inspectionTimers.length;inspectionTimers.at(-1).fn();await until(()=>inspectionTimers.length>before);
    assert.equal(saves,n+1,'inspection does not bypass armed recovery timer');
    recoveryTimers[n].fn();await until(()=>recoveryTimers.length===n+2);
  }
  assert.equal(warnings.length,1,'one report includes failed capture recovery and successful-but-uncertain inspections');
  failing=false;recoveryTimers.at(-1).fn();await f.posted.promise;
  const events=journalChanges(key,()=>{});t.after(()=>events.close());events.notify();await tick();await tick();
  const custody=progressiveWriteCustody(f.app.client);
  t.mock.method(custody,'inspect',async()=>{throw Error('next inspection streak');});events.notify();
  await until(()=>warnings.length===2);assert.equal(warnings.length,2);
});

regression('E6 live capture polling backs off to 3.2 seconds and resets after drainage', async t => {
  const f=await fixture(t,{raw:true,report:()=>{}});await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  const custody=progressiveWriteCustody(f.app.client),timers=[],native=setTimeout;
  let live=true,fail=false;
  t.mock.method(custody,'captureState',async()=>({unsettled:false,peers:live?[{id:'peer',op:'write',args:{},state:'queued',predicted:[]}]:[]}));
  const inspect=custody.inspect;t.mock.method(custody,'inspect',()=>fail?Promise.reject(Error('new streak')):inspect());
  t.mock.method(globalThis,'setTimeout',(fn,delay,...args)=>{if(new Error().stack.includes('/dist/progressive-writes.js')){timers.push({fn,delay});return {unref(){}};}return native(fn,delay,...args);});
  const events=journalChanges(storeKey('writes',f.url,'alice'),()=>{});t.after(()=>events.close());events.notify();await until(()=>timers.length===1);
  for(let n=0;n<7;n++){
    const expected=Math.min(100*2**n,3200);assert.ok(timers[n].delay>=expected-20&&timers[n].delay<=expected,`capture retry ${n}: ${timers[n].delay}`);
    timers[n].fn();await until(()=>timers.length===n+2);
  }
  live=false;timers.at(-1).fn();await tick();await tick();
  fail=true;const before=timers.length;events.notify();await until(()=>timers.length>before);
  assert.ok(timers.at(-1).delay<=100,'drained successful inspection resets backoff');fail=false;
});

for(const action of ['pause','retire']) regression(`E6 opening-recovery custody handle follows app ${action}`, async t => {
  const store=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice');
  await store.set(key,'damaged opening');let handle,localClient;
  const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(local,...args){await install.call(this,local,...args);localClient=local;handle??=progressiveWriteCustody(local);});
  const f=await fixture(t,{store});await f.app.ready;assert.ok(handle,'the facade can capture a stable handle before recovery');
  assert.ok('data' in await f.app.client.query(query,{}));
  assert.ok(handle===progressiveWriteCustody(localClient),'opening recovery preserves the handle captured by the facade');
  let calls=0;
  const method=action==='pause'?'pause':'refuseStore',original=handle[method];
  t.mock.method(handle,method,(...args)=>{calls++;return original(...args);});
  if(action==='pause') await f.app.auth.logout();
  else {
    f.fail({code:'E_STORE_REPLACED',family:'store',message:'replacement'});
    await f.app.mutate(mutation,{}, {waitSeconds:0});await until(()=>calls>0);
  }
  assert.ok(calls>0,`app ${action} reaches the custody installed after recovery`);
});

regression('E6 a hook captured during opening failure sees later held journal intent', async t => {
  const store=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice');
  await store.set(key,'damaged opening');
  let progressive;const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(...args){await install.apply(this,args);progressive=this;});
  const f=await fixture(t,{store,custody:'present',failure:Error('engine unavailable')});f.coreGate.resolve();await f.app.ready;
  const access=pendingIntentAccess(f.app.client),hook=pendingItemsSource(f.app.client),stop=hook.subscribe(()=>{},write=>write.op==='write');t.after(stop);
  await progressive.pending();
  f.coreGate.resolve();await until(()=>localStatus(f.app.client).getSnapshot().state==='unavailable');
  const write=await f.app.mutate(mutation,{}, {waitSeconds:0});assert.equal(write.state,'pending');
  assert.equal((await access.read()).find(item=>item.write.id===write.id)?.phase,'held');
  await until(()=>hook.getSnapshot().some(item=>item.write.id===write.id&&item.phase==='held'));
  assert.deepEqual(f.requests,[]);
});


for(const custody of ['present','unknown','none']) regression(`E7 opening recovery keeps one admission owner and retryable ids (${custody})`,async t=>{
  const store=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice');
  await store.set(key,'damaged opening');
  const entered=gate(),release=gate();let installs=0,progressive,original,core;
  const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(local,...args){
    progressive=this;
    if(++installs===1)original=local.mutate;
    if(installs===2){entered.resolve();await release.promise;assert.equal(args[6]?.mutate,original,'nested install retains the device method snapshot');}
    return install.call(this,local,...args);
  });
  t.after(()=>release.resolve());
  const f=await fixture(t,{raw:true,store,custody,hold:false,wrapCore:opened=>{core=opened;return opened;}});await f.app.ready;
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  if(custody==='none')await core.close();
  const recovering=progressive.pending();await entered.promise;
  const id=mintId(),write=await f.app.client.mutate(mutation,{}, {id,waitSeconds:0});
  assert.equal(write.why?.code,'E_ADMISSION','the closed/unopened core cannot admit or emit E_STORE during recovery');
  assert.deepEqual(f.requests,[]);assert.equal((await f.journal()).pending.length,0);
  release.resolve();await recovering;
  const retry=await f.app.client.mutate(mutation,{}, {id,waitSeconds:5});
  assert.equal(retry.state,custody==='none'?'pending':'sent','refused id reaches the journal on retry');
  const journal=await f.journal();assert.equal([...journal.pending,...journal.receipts].filter(write=>write.id===id).length,1);
  if(custody!=='none')assert.deepEqual(f.requests,[id]);
});

regression('E7 close during nested opening install pauses custody without retiring unsent replay (raw=false)',async t=>{
  const store=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice'),id=mintId();
  await store.set(key,'damaged opening');
  const entered=gate(),release=gate();let installs=0,progressive,local;
  const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(client,...args){local=client;progressive=this;if(++installs===2){entered.resolve();await release.promise;}return install.call(this,client,...args);});
  t.after(()=>release.resolve());
  const f=await fixture(t,{raw:false,store,hold:false});await f.app.ready;
  const recovering=progressive.pending();await entered.promise;
  await store.set(key,JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id,op:'write',args:{},storeId:'A'}],receipts:[]}));
  const closing=f.app.close();await tick();release.resolve();await recovering;await closing;
  const handle=progressiveWriteCustody(local);handle.start();await tick();await tick();
  assert.deepEqual(f.requests,[]);assert.ok((await f.journal()).pending.some(write=>write.id===id));assert.deepEqual((await f.journal()).receipts,[]);
  assert.deepEqual(await handle.inspect(),{pending:[],receipts:[]},'closed custody stays paused');
});

regression('E7 an onlineCustody failure during nested install re-arms opening recovery',async t=>{
  const memory=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice');
  await memory.set(key,'damaged opening');let installs=0,fail=false,progressive;
  const store={...memory,async get(k){if(k===key&&fail){fail=false;throw Error('nested custody open failed');}return memory.get(k);}};
  const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(...args){progressive=this;if(++installs===2)fail=true;return install.apply(this,args);});
  const f=await fixture(t,{raw:true,store,hold:false,report:()=>{}});await f.app.ready;
  await progressive.pending();assert.equal((await f.app.client.mutate(mutation,{})).why?.code,'E_ADMISSION');
  await progressive.pending();assert.equal((await f.app.client.mutate(mutation,{})).state,'sent');assert.equal(f.requests.length,1);
});

regression('E7 recovery reports failed preservation and the successful quarantine side key',async t=>{
  const memory=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice'),warnings=[];
  await memory.set(key,'damaged opening');let fail=true,side,progressive;
  const store={...memory,async set(k,value){if(k.startsWith(`${key}.damaged.`)){if(fail)throw Error('preservation blocked');side=k;}return memory.set(k,value);}};
  const install=ProgressiveWrites.prototype.install;t.mock.method(ProgressiveWrites.prototype,'install',async function(...args){progressive=this;return install.apply(this,args);});
  const f=await fixture(t,{raw:true,store,report:error=>warnings.push(error)});await f.app.ready;warnings.length=0;
  await progressive.pending();assert.ok(warnings.some(error=>error.why.message.includes('could not be preserved')));
  assert.equal(await memory.get(key),'damaged opening');warnings.length=0;fail=false;await progressive.pending();
  assert.ok(warnings.some(error=>error.why.rewrite.includes(side)),'the app receives the preserved-byte location');
  assert.equal(await memory.get(side),'damaged opening');
});

regression('E7 unknown executed generation fences newly written other after credential-only rotation',async t=>{
  const backend=structuredClone(schema),cuts=[],change=QueryCuts.prototype.change;let core;
  t.mock.method(QueryCuts.prototype,'change',function(...args){cuts.push(args);return change.apply(this,args);});
  const f=await fixture(t,{raw:true,backend,syncHead:20,syncGeneration:1,wrapCore:opened=>{core=opened;return opened;},receiptReply:receipt=>({...receipt,generation:2}),
    refreshReply:()=>Response.json({ok:false,why:{code:'E_OVERLOADED',family:'availability',message:'try later',retryable:true}},{status:503})});
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  assert.equal((await f.app.client.query({kind:'query',name:'other'},{})).data,'other');
  const writing=f.app.client.mutate(mutation,{}, {waitSeconds:5});await f.posted.promise;
  backend.generation=2;backend.programs.find(op=>op.name==='write').settlement.writes.other=null;
  assert.equal((await f.app.client.refreshSession()).ok,false);assert.equal((await f.app.client.query({kind:'query',name:'other'},{})).data,'other','disjoint local read remains available before settlement');cuts.length=0;f.release.resolve();assert.equal((await writing).state,'sent');
  await until(async()=>!(await f.app.client.pendingWrites()).length);
  assert.equal((await core.call({op:'state'})).ok.generation,1,'receipt metadata was not adopted');
  assert.ok(cuts.some(([cut,writes])=>cut===21&&writes===undefined),'unknown execution footprint retains a conservative cut');
  assert.equal((await f.app.client.query({kind:'query',name:'other'},{})).data,'server','no pre-mutation other value');
});

for(const bound of [true,false]) regression(`E7 inspected peer settlement cannot borrow replacement store authority (bound=${bound})`,async t=>{
  const store=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice'),id=mintId();
  let progressive;const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(...args){await install.apply(this,args);progressive=this;});
  const f=await fixture(t,{raw:true,store,hold:false});await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  await store.set(key,JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id,op:'write',args:{},...(bound?{storeId:'A'}:{})}],receipts:[]}));
  const events=journalChanges(key,()=>{});t.after(()=>events.close());events.notify();await until(()=>!progressive.uncertain&&progressive.current().some(write=>write.id===id));
  f.replace('B');await f.app.client.sync();await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  const receipt={state:'sent',id,seq:21,replayed:true};await store.set(key,JSON.stringify({owner:'alice',backend:url,pending:[],receipts:[receipt]}));events.notify();
  await until(()=>!progressive.uncertain&&!progressive.current().some(write=>write.id===id));
  assert.deepEqual(await f.app.client.write(id),receipt,'terminal outcome remains recoverable');
  f.offline(true);
  assert.equal((await f.app.client.query(query,{})).data,'local','inspection must not install A sequence 21 in B');
});

regression('E7 inspections coalesce with a held recovery save that subsequently fails',async t=>{
  const {authority}=browserCapture(t),memory=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice');
  const id=mintId(),capture=new OnlineCapture(url,'alice',authority);await capture.ready;capture.capture(id,'write',{},'A');capture.close();
  const entered=gate(),release=gate(),timers=[];let saves=0,fail=true,progressive;
  const store={...memory,async set(k,value){if(k===key&&JSON.parse(value).pending.some(write=>write.id===id)){saves++;if(fail){entered.resolve();await release.promise;throw Error('held recovery save failed');}}return memory.set(k,value);}};
  const native=setTimeout;t.mock.method(globalThis,'setTimeout',(fn,delay,...args)=>{if(new Error().stack.includes('scheduleRecovery')){timers.push({fn,delay});return {unref(){}};}return native(fn,delay,...args);});
  const install=ProgressiveWrites.prototype.install;t.mock.method(ProgressiveWrites.prototype,'install',async function(...args){await install.apply(this,args);progressive=this;});
  t.after(()=>release.resolve());const f=await fixture(t,{raw:true,store,authority,hold:false,report:()=>{}});await entered.promise;
  const events=journalChanges(key,()=>{});t.after(()=>events.close());events.notify();await tick();await tick();
  const custody=progressiveWriteCustody(f.app.client),first=custody.recover(),second=custody.recover();
  assert.equal(first,second,'in-flight recoveries share their completion');
  release.resolve();await first;await until(()=>timers.length===1);await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(saves,1,'no recovery queued behind the failed save');assert.equal(progressive.uncertain,true);assert.deepEqual(f.requests,[]);
  fail=false;timers[0].fn();await f.posted.promise;await until(async()=>(await f.journal()).receipts.some(write=>write.id===id));assert.deepEqual(f.requests,[id]);
});

regression('E8 skipped foreign-store receipt retains a displayed answer and retires an in-flight evaluation',async t=>{
  let changed,observation,held=false,calls=0;
  const entered=gate(),release=gate(),seen=[],install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(...args){changed=args[3];observation=args[6];return install.apply(this,args);});
  t.after(()=>release.resolve());
  const f=await fixture(t,{queryReply:async()=>{
    const attempt=held?++calls:0;
    if(attempt===1){entered.resolve();await release.promise;}
    return {data:attempt===1?'obsolete':attempt?'current':'displayed',complete:true,tables:['items'],scopes:{items:[{}]},seq:20,store_id:'A',generation:1};
  }});
  await f.app.ready;const watch=f.app.client.observe(query,{});watch.subscribe(()=>seen.push(watch.getSnapshot()));t.after(()=>watch.close());
  await until(()=>watch.getSnapshot().data==='displayed');assert.equal(episodeDeadline(watch.getSnapshot()),undefined);held=true;
  const foreign={...observation(),store:'retired',generation:1};
  changed('write',21,foreign);await entered.promise;
  changed('write',22,foreign);
  assert.equal(watch.getSnapshot().data,'displayed','a skipped receipt has no authority to withdraw this answer');
  assert.equal(episodeDeadline(watch.getSnapshot()),undefined,'unknown preserved scopes do not start a revocation episode');
  release.resolve();await until(()=>watch.getSnapshot().data==='current');
  assert.equal(seen.some(read=>read.data==='obsolete'),false,'changed=true retires the evaluation begun before settlement');
  assert.equal(seen.some(read=>episodeDeadline(read)!==undefined),false);
});

regression('E8 awaited journal receipt does not repeat a replacement already adopted by sync',async t=>{
  const changes=[],store=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice'),id=mintId();
  await store.set(key,JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id,op:'write',args:{},storeId:'A'}],receipts:[]}));
  const f=await fixture(t,{raw:true,startup:'awaited',journal:true,store,hold:false,onStoreChange:why=>changes.push(why)});
  await until(async()=>(await f.app.client.write(id))?.state==='sent');
  f.replace('B');await f.app.client.sync();
  const before=changes.length;
  const write=await f.app.client.mutate(mutation,{}, {waitSeconds:5});
  // The transport remains bound to A and correctly refuses reuse in B. The
  // Local authority already adopted B: recover the retired dispatcher without
  // fencing B's reads or mistaking A's old head for a restore of B.
  assert.equal(write.state,'failed',JSON.stringify(write));assert.equal(write.why.code,'E_STORE_REPLACED');
  assert.equal((await f.journal()).receipts.some(receipt=>receipt.id===write.id),true);
  assert.equal(changes.length,before+1,'the retired dispatcher requests recovery on the already adopted store B');
  f.offline(true);assert.equal((await f.app.client.query(query,{})).data,'local','B remains usable after the real server refusal');
});

regression('E8 seeded opening intent parks dependent reads until its settlement cut is covered',async t=>{
  const store=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice'),id=mintId(),admissions=[];
  await store.set(key,JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id,op:'write',args:{},storeId:'A'}],receipts:[]}));
  const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(...args){const changed=args[3];args[3]=(op,cut,...rest)=>{if(op&&cut===undefined)admissions.push(op);return changed(op,cut,...rest);};return install.apply(this,args);});
  const f=await fixture(t,{raw:true,store,syncHead:20});await f.posted.promise;
  const waits=[],wait=QueryCustody.prototype.wait;
  t.mock.method(QueryCustody.prototype,'wait',function(...args){waits.push(args);return wait.apply(this,args);});
  let answer;const reading=f.app.client.query(query,{}).then(read=>answer=read);
  await until(()=>waits.length>0);assert.equal(answer,undefined);assert.deepEqual(admissions,[],'seeded ids do not emit a separate admission barrier');
  assert.equal((await f.app.client.query({kind:'query',name:'other'},{})).data,'other');
  f.release.resolve();await reading;assert.equal(answer.data,'server','the settled cut prevents local watermark 20 from appearing fresh');
  assert.equal((await f.app.client.write(id)).state,'sent');
});

regression('E8 inspected peer receipt keeps its same-store cut across generation adoption',async t=>{
  const store=memorySessionStore(),backend=structuredClone(schema),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice'),id=mintId(),cuts=[];
  let progressive;const install=ProgressiveWrites.prototype.install,change=QueryCuts.prototype.change;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(...args){await install.apply(this,args);progressive=this;});
  t.mock.method(QueryCuts.prototype,'change',function(...args){cuts.push(args);return change.apply(this,args);});
  const f=await fixture(t,{raw:true,store,backend,syncHead:20,queryReply:()=>({data:'covered',complete:true,tables:['other'],seq:21,store_id:'A',generation:2})});
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  await store.set(key,JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id,op:'write',args:{},storeId:'A'}],receipts:[]}));
  const events=journalChanges(key,()=>{});t.after(()=>events.close());events.notify();await until(()=>!progressive.uncertain&&progressive.current().some(write=>write.id===id));
  backend.generation=2;await f.app.client.sync();cuts.length=0;
  const receipt={state:'sent',id,seq:21,replayed:true};await store.set(key,JSON.stringify({owner:'alice',backend:url,pending:[],receipts:[receipt]}));events.notify();
  await until(()=>!progressive.uncertain&&!progressive.current().some(write=>write.id===id));
  assert.deepEqual(await f.app.client.write(id),receipt);
  assert.ok(cuts.some(([cut,writes])=>cut===21&&writes===undefined),'inspection cannot qualify execution generation, while same-store sequence numbers remain comparable');
  assert.equal((await f.app.client.query({kind:'query',name:'other'},{})).data,'covered');
});

regression('E9 a peer settles this tab\'s live capture before its held response without losing the same-store cut',async t=>{
  const {authority}=browserCapture(t),received=gate();let progressive;
  const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(...args){await install.apply(this,args);progressive=this;});
  const receipt=ProgressiveWrites.prototype.receipt;
  t.mock.method(ProgressiveWrites.prototype,'receipt',function(...args){receipt.apply(this,args);received.resolve();});
  const f=await fixture(t,{raw:true,authority,syncHead:20});
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  assert.equal((await f.app.client.query(query,{})).data,'local');
  const id=mintId(),writing=f.app.client.mutate(mutation,{}, {id,waitSeconds:0});await f.posted.promise;await writing;
  assert.equal((await f.journal()).pending.find(write=>write.id===id).storeId,'A');
  const key=storeKey('writes',f.url,'alice'),events=journalChanges(key,()=>{});t.after(()=>events.close());
  await storeLock(key,async()=>{const journal=await f.journal();journal.pending=[];journal.receipts.push({state:'sent',id,seq:21,replayed:true});await f.store.set(key,JSON.stringify(journal));});events.notify();
  await until(()=>!progressive.uncertain&&!progressive.current().some(write=>write.id===id));
  assert.equal((await f.app.client.write(id)).seq,21);
  assert.equal((await f.app.client.query(query,{})).data,'server','peer settlement must fence the pre-write local value at watermark 20');
  f.release.resolve();await received.promise;
  assert.equal(progressive.receipts.has(id),false,'a late own response after peer settlement retains no orphan receipt');
  assert.equal((await f.app.client.query(query,{})).data,'server','the eventual original response must retain the established cut');
  assert.deepEqual(f.requests,[id]);
});

for(const method of ['close','signOut']) regression(`E9 raw ${method} immediately fences actions during held nested recovery`,async t=>{
  const store=memorySessionStore(),url='https://progressive-writes.invalid',key=storeKey('writes',url,'alice'),id=mintId();
  await store.set(key,'damaged opening');
  const entered=gate(),release=gate(),reports=[];let installs=0,progressive;
  const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(...args){progressive=this;if(++installs===2){entered.resolve();await release.promise;}return install.apply(this,args);});
  t.after(()=>release.resolve());
  const f=await fixture(t,{raw:true,store,hold:false,report:error=>reports.push(error)}),action={kind:'action',name:'perform'};
  assert.equal((await f.app.client.act(action,{})).state,'done');assert.equal(f.actions.length,1);
  const recovering=progressive.pending();await entered.promise;
  reports.length=0;
  await store.set(key,JSON.stringify({owner:'alice',backend:url,pending:[{owner:'alice',id,op:'write',args:{},storeId:'A'}],receipts:[]}));
  let ended=false;const ending=f.app.client[method]().then(()=>{ended=true;});
  try {
    const refused=await f.app.client.act(action,{});
    assert.equal(refused.denied?.code,method==='close'?'E_CLOSED':'E_AUTH');
    assert.equal(f.actions.length,1,'the original transport must not send a second action');assert.equal(ended,false,'cleanup still waits for nested recovery');
  } finally { release.resolve();await recovering;await ending; }
  assert.deepEqual(reports,[],'a retired nested install must not report a storage failure');
  assert.equal(progressive.custody,undefined,'a retired nested install must not open custody');
  assert.equal((await f.app.client.mutate(mutation,{})).why?.code,method==='signOut'?'E_AUTH':'E_CLOSED');
  const custody=progressiveWriteCustody(f.app.client);custody.start();await tick();
  assert.deepEqual(await custody.inspect(),{pending:[],receipts:[]});assert.deepEqual(f.requests,[]);
  assert.ok((await f.journal()).pending.some(write=>write.id===id));assert.deepEqual((await f.journal()).receipts,[]);
});
