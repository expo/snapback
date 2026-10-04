import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate as tick } from 'node:timers/promises';
import { census, instrument, packageRoot, awaitBoundary, sharedAwaits, followSync, followRetry } from './delivery-fault-instrument.mjs';
import { recipe, fixtureIndex, required, absorbs } from './delivery-fault-recipes.mjs';
import { fixture, until, ok, original, gate } from './delivery-fault-fixture.mjs';
const directory = mkdtempSync(join(packageRoot, '.rg-matrix-'));
instrument(directory);
symlinkSync(join(packageRoot, 'node_modules'), join(directory, 'node_modules'), 'dir');
const stack = new AsyncLocalStorage();
let target, alias, direct = false, enabled = false, failures = 0, budget = Infinity;
let competing = false, competingStarts = 0, quiesced = 0, owned = 0;
const seen = new Set(), failed = new Set();
const error = new Error('RG injected await failure');
function fault() {
  if (enabled && failures < budget && (stack.getStore()?.includes(target) || (alias && stack.getStore()?.some(id=>id.includes(alias))))) { failures++; throw error; }
}
globalThis.__rgAwait = (id, body) => stack.run([...(stack.getStore() ?? []), id], async () => {
  if (enabled) seen.add(id);
  if(direct && id === target) fault();
  const operation = enabled && (id === target || (target === followRetry && id === followSync)) && sharedAwaits.get(id);
  const pending = operation === 'sync' ? () => globalThis.__rgClient.syncing : () => globalThis.__rgNativePending();
  if (operation) {
    if (competing) {
      // Astra's reproducer: the classified await would join this exact promise,
      // whose I/O has no target in its async context. Keep it in every retry.
      const other = stack.run([], () => operation === 'sync' ? globalThis.__rgClient.syncOnce() : globalThis.__rgClient.installNative());
      assert.equal(other, pending(), 'the competing call owns the shared promise');
      void other.catch(() => {});
      competingStarts++;
    }
    // Only scheduling changes. Do not throw at this await or replace its body:
    // its real sync/install must encounter the existing host/transport fault.
    // Recheck after every completion: another caller may have reserved work.
    while (pending()) { quiesced++; try { await pending(); } catch {} }
  }
  try {
    const work = body();
    if (operation) {
      assert.equal(work, pending(), 'the classified call owns the next real operation');
      owned++;
    }
    return await work;
  } catch (e) { if (e === error) failed.add(id); throw e; }
});
globalThis.__rgIO = async body => { fault(); return body(); };
globalThis.__rgIterate = async function* (id, iterable) {
  const iterator = iterable[Symbol.asyncIterator]();
  try { while(true) { const next = await globalThis.__rgAwait(id,()=>iterator.next()); if(next.done) return; yield next.value; } }
  finally { await iterator.return?.(); }
};
const { createLocalClient } = await import(pathToFileURL(join(directory, 'dist/local.js')));
const { webDevice } = await import(pathToFileURL(join(directory, 'dist/web.js')));
const sites = census();
const classified = JSON.parse(readFileSync(new URL('./delivery-fault-sites.json',import.meta.url),'utf8'));
const { resolveClosingWrites } = await import(pathToFileURL(join(directory, 'dist/local-receipts.js')));
const { MediaCache } = await import(pathToFileURL(join(directory, 'dist/local-assets.js')));
const { legacyInputRefusal, syncTransport } = await import(pathToFileURL(join(directory, 'dist/local-sync.js')));
const selected = process.env.RG_MATRIX_SITE === undefined ? sites : sites.filter((_, i) => process.env.RG_MATRIX_SITE.split(',').includes(String(i)));
const results = [];
const drain = async (n = 30) => { for (let i = 0; i < n; i++) await tick(); };
const op = { kind: 'mutation', name: 'send' };
test('every delivery await is explicitly classified',()=>{
  if(process.env.RG_MATRIX_CONTROL) return;
  assert.deepEqual(awaitBoundary(), JSON.parse(readFileSync(new URL('./delivery-await-boundary.json',import.meta.url),'utf8')), 'new or changed await needs delivery reachability classification, including outside existing helper scopes');
  assert.deepEqual(sites.map((s,index)=>({index,id:s.id,recipe:recipe(index),classification:required.has(fixtureIndex(index))?'required':'optional',absorbs:absorbs.has(fixtureIndex(index))})),classified,'new or changed awaited delivery site needs a classification and fault recipe');
});
const cases = selected.map(site => ({site, competing: false}));
// Run the complete delivery/recovery/FIFO assertions against the adversarial
// schedule too, including the nonrejecting follow timer's failed-sync input.
cases.push(...selected.filter(site => sharedAwaits.has(site.id) || site.id === followRetry).map(site => ({site, competing: true})));
for (const entry of cases) for (const mode of (process.env.RG_MATRIX_MODE ? [process.env.RG_MATRIX_MODE] : ['transient', 'persistent'])) {
  const {site} = entry;
  test(`${entry.competing ? 'competing sync/install: ' : ''}${sites.indexOf(site)} ${mode}: ${site.file}:${site.line} ${site.owner}`, async t => {
    enabled = false; target = site.id; failures = 0; budget = mode === 'transient' ? 1 : Infinity; seen.clear(); failed.clear();
    competing = entry.competing; competingStarts = quiesced = owned = 0;
    const index = fixtureIndex(sites.indexOf(site)), scenario = recipe(sites.indexOf(site));
    const syncFollow = target === followSync || target === followRetry;
    if (scenario === 'closing') {
      direct = false; alias = undefined;
      const f = await fixture(t, 1, {createLocalClient, webDevice, beforeCall() { fault(); }});
      await until(() => f.client.acquired);
      const write = await f.client.mutate(op, {conversationId:'c1',body:'confirmed'});
      assert.equal(write.state,'sent'); await drain();
      const api = globalThis.__rgClient, outcomes = [];
      const missing = '00000000000000000000000001';
      enabled = true;
      await resolveClosingWrites(async () => ok(await api.call({op:'queued'})), api.history,
        new Map([write.id,missing].map(id => [id,{resolve:w => outcomes.push(w)}])));
      enabled = false;
      assert.equal(outcomes[0].state,'sent','either correlated custody source retains known execution at close');
      assert.deepEqual(outcomes[1],{state:'pending',id:missing},'unknown custody is never invented as terminal');
      assert.equal(f.sends.length,1,'receipt recovery does not post');
      assert.ok(failures > 0,'the close read experienced the injected host fault');
      assert.ok(seen.has(site.id),'the close await was reached');
      results.push({index:sites.indexOf(site),id:site.id,mode,recipe:scenario,classification:'optional',injected:failures,reached:true});
      return;
    }
    direct = [11,18,26,27,35,42,50,72,156,157].includes(index);
    alias = [49,51,56].includes(index) ? 'local-exit.ts:exitTransport:response.json' : index === 106 ? 'local-exit-settlement.ts:exitRefusalSettlement:options.commit' : index === 138 ? 'changes.ts:changeFeed:doFetch' : undefined;
    let prepared = false, api, suspend, first, queueIds = [], once = false, queueRelease;
    const why = {code:'RG_KNOWN', family:'application', message:'known refusal'};
    const queryPlan = {table:'messages',index:'wordsAt',column:'at',kind:'Time',order:'Desc',limit:2,needle:'q',cursor:'c',variant:null};
    const ceilings = {examined:8192,index_entries:16384,rule_probes:8192,steps:1000000,heap_bytes:16<<20,output_bytes:1<<20,rows_written:1024};
    const counts = () => Object.fromEntries(Object.keys(ceilings).map(key=>[key,0]));
    const hooks = {
      createLocalClient, webDevice,
      ...(scenario === 'exit' ? {onSuspend(callback) { suspend = callback; return ()=>{}; }} : {}),
      async closing() { enabled = false; prepared = false; queueRelease?.(); for(let i=0;i<4;i++) { t.mock.timers.tick(5000); await drain(); } },
      beforeCall(request) { if(scenario === 'acknowledgement' && !queueIds.length && request.op === 'keep_write') throw Error('prepare acknowledgement'); fault();
        // Only the query host replies are scripted. The real wasm outbox and
        // all delivery host calls continue through the ordinary matrix fixture.
        if (scenario === 'search' && prepared && request.op === 'search_state') return {ok:{epoch:'matrix',delivery:'matrix',watermark:10,current:index===161?['departed']:['live'],left:['left'],ceilings,metered:request.spent ?? counts()}};
        if (scenario === 'search' && prepared && request.op === 'query' && request.name === 'matrixQuery') return {ok:{data:[],complete:index !== 153,unknown:index === 153,tables:[],metered:request.spent ?? counts()}};
        if(index === 98 && prepared && request.op === 'keep_write' && JSON.parse(request.value).id === first.id && !stack.getStore()?.includes(target)) throw Error('another path cannot repair the receipt before the target read'); },
      afterCall(request, reply) {
        if (!enabled) return;
        if (scenario === 'postcommit' && failures < budget) { failures++; throw error; }
        if (scenario === 'reset' && failures < budget && request.op === 'observe_store' && !reply.denied) reply.ok.reset = true;
      },
      fetch(path, init) {
        fault();
        if (prepared && enabled && ((index === 37 && path === '/probe') || (index === 44 && path === '/changes') || (index === 47 && path === '/sync' && stack.getStore()?.some(id=>id.startsWith('local.ts:follow:syncOnce')))) && failures < budget) { failures++; throw error; }
        if (path === '/probe') return index === 157 ? Response.json({denied:{code:'E_RATE_LIMIT',family:'limit',message:'busy',retryable:true}}, {status:503}) : Response.json({ok:true,store_id:'A',seq:11});
        if (scenario === 'acknowledgement' && queueIds.length && path === '/sync') return Response.json({snapshot:false,store_id:'A',generation:1,events:[],watermark:11,more:false});
        if (!prepared) return;
        if(scenario === 'search' && path === '/q/matrixQuery') return index === 141 ? new Response('invalid JSON') : Response.json({data:[],complete:true,store_id:'A',head:11,generation:1,searchScopes:['live'],searchCurrent:[]});
        if(index === 12 && path.startsWith('/q/')) return Response.json({data:'A',complete:true,store_id:'A',head:11});
        if(index === 137 && path === '/changes' && failures < budget) return {ok:true,status:200,headers:new Headers(),async json(){ fault();return {seq:11,store_id:'A'};}};
        if([42,156].includes(index) && path === '/changes' && failures < budget) return Response.json({denied:{...why,retryable:true}},{status:500});
        if(scenario === 'exit' && init.keepalive) return Response.json({state:'failed',why:{code:'E_STORE_REPLACED',family:'store',message:'replaced',retryable:[76,103].includes(index)}});
        if (scenario === 'native') {
          if(path === '/schema') return Response.json({...original,generation:1,native:{digest:'matrix'}});
          if(path === '/native.wasm') return new Response(new Uint8Array([0,97,115,109,1,0,0,0]));
        }
        if ((scenario === 'hold' || index === 64) && path.startsWith('/m/') && !once) { once=true; return Response.json({state:'failed',why:{...why,retryable:true}}); }
        if (index === 18 && path === '/sync') return Response.json({denied:{...why,retryable:true},store_id:'A',watermark:10,generation:1});
        if (index === 26 && path === '/schema' && failures < budget) return Response.json({denied:{code:'E_AUTH',family:'auth',message:'auth'}},{status:401});
        if (index === 27 && path === '/sync') return Response.json({denied:{code:'E_BOUND',family:'bound',message:'the HTTP JSON response exceeds 16 MiB; request a smaller page'},store_id:'A',watermark:10,generation:1});
        if (scenario === 'legacy' && path === '/sync' && Object.hasOwn(JSON.parse(init.body), 'generation')) return Response.json(legacyInputRefusal,{status:400});
      },
    };
    const f = await fixture(t, 1, hooks);
    api = globalThis.__rgClient;
    await until(() => f.client.acquired && f.changesWaiting);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const retryDelays = [], timeout = globalThis.setTimeout;
    t.mock.method(globalThis,'setTimeout',(callback, delay, ...args)=>{
      if(callback.toString().includes('void flush()')) retryDelays.push(delay);
      return timeout(callback,delay,...args);
    });
    const notices = [];
    f.client.onWrite(w => notices.push(w));
    first = await f.client.mutate(op, { conversationId: 'c1', body: 'head' });
    assert.equal(first.state, 'sent');
    await drain();
    assert.ok(ok(await f.core.call({op:'queued'})).some(e => e.id === first.id && (e.sent_seq === 11 || scenario === 'acknowledgement') && e.observed_seq == null));
    let release; const held = new Promise(r => { release = r; }); queueRelease = release;
    f.beforeCall(async request => { if (request.op === 'queued') await held; });
    const tails = ['tail1', 'tail2'].map(body => f.client.mutate(op, { conversationId: 'c1', body }, {waitSeconds:25}));
    await until(async () => ok(await f.core.call({op:'queued'})).length === 3);
    queueIds = ok(await f.core.call({op:'queued'})).map(e=>e.id);
    prepared = true;
    const sideWork = [];
    const run = body => { const p = Promise.resolve().then(body).catch(()=>{}); sideWork.push(p); };
    if (scenario === 'media') {
      api.media.options = {keep:'viewed',maxBytes:index === 113 ? 0 : 10};
      api.media.entries.set('asset', {id:'asset',bytes:1,used:0,confirmed:true,home:{store_id:'A',table:'messages',row:'A-0',column:'photo',generation:1,type:'image/png',expiresAt:null}});
      if (index === 113) hooks.beforeCall = request => { fault(); if(request.op==='asset_home') return {ok:{...api.media.entries.get('asset').home}}; };
      if(index === 155) api.media.store = new MediaCache({call: request=>api.media.core.call(request)},'dev:alice',api.media.options).store;
      const remove = api.media.store.remove.bind(api.media.store);
      api.media.store.remove = async id => { fault(); return remove(id); };
      api.setReconcile();
    }
    if (scenario === 'pending') {
      try { await api.history.keep({state:'sent',id:first.id,seq:11}); } catch {}
      api.history.unpersisted.set(first.id,{state:'sent',id:first.id,seq:11,replayed:true});
    }
    if (scenario === 'acknowledgement') {
      ok(await f.core.call({op:'apply',page:{snapshot:false,store_id:'A',events:[],watermark:11,more:false,acknowledged:{[first.id]:11},sent:{[first.id]:11}}}));
      if(index === 96) {
        api.history.unpersisted.delete(first.id);
        const read = api.history.storage.read;
        api.history.storage.read = async () => { const data = JSON.parse(await read() ?? '[]'); return JSON.stringify([...data.filter(w=>w.id!==first.id),{state:'failed',id:first.id,why:{code:'E_STORE_REPLACED',family:'store',message:'replacement'}}]); };
      }
    }
    if (scenario === 'recovery') f.beforeSend(async request => {
      if(request.id !== queueIds[1]) return;
      const receipt = {state:'sent',id:request.id,seq:11,replayed:true};
      ok(await f.core.call({op:'keep_write',value:JSON.stringify(receipt)}));
      return {ok:{receipt,qualified:true}};
    });
    if (scenario === 'early') {
      const before = hooks.beforeCall;
      hooks.beforeCall = request => {
        if(!once && (index === 66 ? request.op === 'keep_write' : request.op === 'begin_send') && index !== 64) {
          once = true;
          if(index === 63) return {denied:{code:'E_STORE',family:'store',message:'drive retry'}};
          throw Error('drive retry');
        }
        return before(request);
      };
    }
    if (scenario === 'search') api.queryFixture([148,149,152,153].includes(index) ? undefined : queryPlan,index === 148,index === 149,index === 161);
    enabled = true;
    if (scenario === 'search') run(()=>f.client.query({kind:'query',name:'matrixQuery'},{q:'coffee',c:null}));
    if(index === 118) await assert.doesNotReject(()=>syncTransport(async()=>new Response('invalid JSON',{status:400}))('http://matrix.test',{}, {generation:1}),'legacy discovery tolerates an unreadable error body');
    if(index === 13) {
      await api.syncOnce().catch(()=>{});
      assert.ok(api.retry,'pending receipt persistence guard schedules flush recovery');
    } else if (scenario === 'pending') run(()=> index === 5 ? api.call({op:'observe_store',page:{store_id:'A',generation:1,snapshot:false,events:[],watermark:10,more:false}}) : api.syncOnce());
    if (scenario === 'clock') { api.clock.sample(Date.now()+1000,Date.now(),Date.now(),'matrix:1'); run(()=>api.clock.persist()); }
    if (scenario === 'native') { api.nativeFixture(); await assert.doesNotReject(()=>api.installNative(),'optional native installation failure keeps the fallback'); }
    if (scenario === 'adoption' || index === 26) { f.updateBackend(); if(index === 22) await assert.doesNotReject(()=>f.client.sync(),'backend acquisition failure resolves sync for later dispatch'); else run(()=>f.client.sync()); }
    if(index === 16) await assert.doesNotReject(()=>f.client.sync(),'transport failure resolves sync for later dispatch');
    if(scenario === 'auth' && index !== 11) run(()=>f.client.sync());
    if (scenario === 'reset') run(()=>f.client.sync());
    if (scenario === 'probe') run(()=>api.probe());
    if (scenario === 'follow') {
      if([37,38].includes(index)) api.setOffline();
      if(index === 39) { api.setIdentity(false); run(()=>api.waitForChange()); }
      if (!syncFollow) run(()=>f.changed(11));
    }
    if (scenario === 'replay') run(()=>api.replayOnOpen());
    if (scenario === 'lookup') for(const id of [...queueIds,'missing']) run(()=>f.client.write(id));
      if (scenario === 'native') run(()=>api.installNative());
    if (scenario === 'queryDecode') await assert.doesNotReject(()=>api.sendPost('/q/remote',{},undefined,undefined,false,undefined,async response=>{ fault(); return response.json(); }),'optional search decoding does not reject dispatch transport');
    if (scenario === 'query') await assert.doesNotReject(()=>api.sendPost('/q/remote',{}),'optional query bookkeeping does not reject dispatch transport');
    if (scenario === 'exit') {
      const entry = ok(await f.core.call({op:'queued'})).find(e=>e.id === queueIds[1]);
      ok(await f.core.call({op:'begin_send',id:entry.id}));
      const work = globalThis.__rgExit([{id:entry.id,op:entry.op,args:entry.args,newIds:entry.new_ids,store_id:'A'}],{},()=>true);
      api.setExit(work);
      await drain(30);
    }
    release(); f.beforeCall(undefined);
    if (syncFollow) {
      // A prior long poll can have been invalidated by a write before changed()
      // resolves it. Drive the live follow loop to the sync boundary before
      // starting the eight retry epochs; immediate-turn counts are not a
      // witness that a real-time poll callback has resumed under CPU load.
      await until(async () => {
        if (seen.has(followSync)) return true;
        if (f.changesWaiting) await f.changed(11);
        await drain();
        t.mock.timers.tick(1000);
        return false;
      });
    }
    await drain(100);
    const initialPosts = f.sends.length;
    if(index === 132) assert.equal((await f.client.pendingWrites()).find(w=>w.id===queueIds[1])?.state,'held','failed hold metadata retains the retryable head reason');
    if(index === 68) assert.ok(api.retry,'final observation schedules flush retry');
    const initialFailures = failures, steadyRetryStart = retryDelays.length;
    await drain(100); assert.equal(failures, initialFailures, 'no retry spin while time is frozen');
    for (let n = 0; n < 8; n++) {
      t.mock.timers.tick(5000);
      if (['adoption','reset','legacy'].includes(scenario)) run(()=>f.client.sync());
      if (scenario === 'probe') run(()=>api.probe());
    if (scenario === 'follow') {
      if([37,38].includes(index)) api.setOffline();
      if(index === 39) { api.setIdentity(false); run(()=>api.waitForChange()); }
      if (syncFollow) { if (f.changesWaiting) await f.changed(11); }
      else run(()=>f.changed(11));
    }
      if (scenario === 'search') run(()=>f.client.query({kind:'query',name:'matrixQuery'},{q:'coffee',c:null}));
      if (scenario === 'replay') run(()=>api.replayOnOpen());
      if (scenario === 'lookup') for(const id of [...queueIds,'missing']) run(()=>f.client.write(id));
      if (scenario === 'native') run(()=>api.installNative());
      await drain(100);
    }
    const postedUnderFault = f.sends.length;
    const injected = failures;
    if (!required.has(index)) {
      assert.equal(new Set(f.sends.map(s=>s.id)).size,3,'optional awaited failure must not strand a healthy queued tail');
      assert.equal(f.sends.length,3,'optional awaited failure must not repost a healthy send');
      assert.equal(notices.length,3,'optional awaited failure must not suppress terminal delivery');
      for(const id of queueIds) await assert.doesNotReject(async()=>assert.equal((await f.client.write(id))?.state,notices.find(w=>w.id===id)?.state,'lookup agrees during optional failure'),'lookup survives optional receipt persistence failure');
    }
    assert.ok(retryDelays.every((delay,i)=>[250,500,1000,2000,4000,5000].includes(delay) && (i<=steadyRetryStart || delay >= retryDelays[i-1])), `flush retry backoff remains bounded and does not reset during repeated failure: ${retryDelays}`);
    assert.ok(failures <= 100, 'fault retries remain bounded over eight five-second advances');
    enabled = false; prepared = false;
    for (let n = 0; n < 3; n++) { t.mock.timers.tick(5000); await drain(100); }
    if (scenario === 'search') await Promise.all(sideWork);
    if(scenario === 'clock') await assert.doesNotReject(()=>api.clock.persist(),'clock persistence recovers after host recovery');
    if(scenario === 'media') await assert.doesNotReject(()=>api.media.reconcile(),'media recovers when its host recovers');
    const terminal = await Promise.all(tails);
    assert.equal(new Set(f.sends.map(s => s.id)).size, scenario === 'recovery' || notices.some(w=>w.state==='failed') ? 2 : 3, 'all healthy queued sends progress after required storage recovers');
    assert.deepEqual([...new Map(f.sends.map(s => [s.id, s.args.body])).values()], scenario === 'recovery' || notices.some(w=>w.state==='failed') ? ['head','tail2'] : ['head','tail1','tail2'], 'FIFO');
    for (const send of queueIds.map(id=>({id}))) {
      assert.equal(notices.filter(w => w.id === send.id).length, 1, 'exactly one onWrite per terminal outcome');
      assert.equal((await f.client.write(send.id))?.state, notices.find(w=>w.id===send.id)?.state);
    }
    assert.ok(terminal.every(w => ['sent','failed','pending'].includes(w.state)));
    if(!required.has(index)) assert.ok(terminal.every(w=>w.state==='sent'),'healthy callers receive terminal outcomes under optional failure');
    if(mode === 'transient') assert.ok(terminal.every(w=>w.state!=='pending'),'a transient fault recovers within the caller wait');
    const sentBeforeCollection = f.sends.length;
    for(const [i,body] of ['tail1','tail2'].entries()) {
      const collected = await f.client.mutate(op,{conversationId:'c1',body},{id:queueIds[i+1]});
      assert.equal(collected.state,notices.find(w=>w.id===queueIds[i+1])?.state,`same-id caller collection agrees with terminal notification: ${JSON.stringify(collected)}`);
    }
    assert.equal(f.sends.length,sentBeforeCollection,'caller collection never reposts');
    assert.equal(notices.length,3,'caller collection never emits another terminal outcome');
    results.push({index:sites.indexOf(site), id:site.id, mode, competing, competingStarts, quiesced, owned, recipe:scenario, classification:required.has(index)?'required':'optional', absorbed:absorbs.has(index), retryDelays, injected, initialPosts, postedUnderFault, postedAfterRecovery:f.sends.length, reached:seen.has(site.id), rejected:failed.has(site.id)});
    assert.ok(injected > 0, 'the classified await must actually experience an injected fault');
    assert.ok(seen.has(site.id), 'the classified await must be reached after arming its fault');
    if (competing) {
      assert.ok(competingStarts > 0, 'the competing operation actually started');
      assert.ok(quiesced >= competingStarts, 'every competing operation was drained');
      assert.ok(owned >= competingStarts, 'the target started its own operation after each competitor');
    }
  });
}
// Coverage above deliberately starts fresh work. These cases instead leave a
// real sync parked in host/transport I/O until follow has joined it. Keep the
// injector disabled: no drain, replacement operation, or target-thrown error.
if (selected.some(site => site.id === followSync)) for (const kind of ['host rejection', 'transport false']) {
  test(`joined follow sync propagates ${kind} and retries`, async t => {
    enabled = false;
    const held = gate(), outcomes = [];
    let armed = false, watching = false, io = 0, injected = 0, joined, retryWaits = 0;
    async function failSharedIO() {
      io++;
      await held.promise;
      injected++;
      throw error;
    }
    const f = await fixture(t, 1, {
      createLocalClient, webDevice,
      beforeCall(request) { if (armed && kind === 'host rejection' && request.op === 'state') return failSharedIO(); },
      fetch(path) { if (armed && kind === 'transport false' && path === '/sync') return failSharedIO(); },
      async closing() { armed = watching = false; held.resolve(); t.mock.timers.tick(1000); await drain(); },
    });
    const api = globalThis.__rgClient;
    await until(() => f.client.acquired && f.changesWaiting && !api.syncing);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const awaitCall = globalThis.__rgAwait;
    t.mock.method(globalThis, '__rgAwait', (id, body) => awaitCall(id, () => {
      if (watching && id === followRetry) retryWaits++;
      if (!watching || id !== followSync) return body();
      const active = api.syncing, work = body();
      joined ??= { active, work };
      return work.then(value => { outcomes.push({ value }); return value; },
        reason => { outcomes.push({ error: reason }); throw reason; });
    }));
    armed = true;
    const shared = stack.run([], () => api.syncOnce());
    const sharedOutcome = shared.then(value => ({ value }), reason => ({ error: reason }));
    await until(() => io === 1);
    watching = true;
    await f.changed(11);
    await until(() => joined);
    assert.equal(joined.active, shared, 'follow calls syncOnce while the original sync is still active');
    assert.equal(api.syncing, shared, 'joining does not start a replacement sync');
    assert.equal(outcomes.length, 0, 'the joined target remains pending at the held I/O');
    assert.equal(injected, 0, 'the fault is released only after the target joins');
    assert.equal(io, 1, 'one shared I/O operation is held');
    armed = false;
    held.resolve();
    const source = await sharedOutcome;
    await until(() => outcomes.length > 0);
    if (kind === 'host rejection') {
      assert.equal(source.error, error, 'the real host failure rejects the shared sync');
      assert.equal(outcomes[0].error, error, 'the joined follow await receives that same rejection');
    } else {
      assert.deepEqual(source, { value: false }, 'syncRound converts transport failure to false');
      assert.deepEqual(outcomes[0], { value: false }, 'the joined follow await receives false, never success');
    }
    assert.equal(joined.work, shared, 'the real join branch returned the original promise');
    assert.equal(injected, 1, 'the shared operation actually experienced the fault');
    await until(() => retryWaits === 1);
    t.mock.timers.tick(999); await drain();
    assert.equal(outcomes.length, 1, 'follow preserves its one-second failure backoff');
    t.mock.timers.tick(1);
    await until(() => outcomes.length === 2);
    assert.deepEqual(outcomes[1], { value: true }, 'follow recovers through a fresh healthy sync');
    assert.equal(retryWaits, 1, 'recovery needs no further failure wait');
  });
}
test.after(() => {
  enabled = false;
  if (process.env.RG_MATRIX_OUTPUT) writeFileSync(process.env.RG_MATRIX_OUTPUT, JSON.stringify(results, null, 2)+'\n');
  rmSync(directory, {recursive:true,force:true}); delete globalThis.__rgIO; delete globalThis.__rgAwait; delete globalThis.__rgIterate; delete globalThis.__rgClient; delete globalThis.__rgExit; delete globalThis.__rgNativePending;
});
