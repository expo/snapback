import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLocal } from '../dist/local-query.js';
import { LocalReads, localWatch } from '../dist/local-reads.js';

function fixture(composed = false) {
  const op = { kind: 'query', name: 'page' }, args = {};
  const reads = new LocalReads();
  reads.queued([]);
  const watch = localWatch(undefined, op, args, 'page:{}', 0, tables => reads.pending(tables));
  let attached = composed, publishedOnce = false, requests = 0, watermark = 10;
  const env = {
    backend: { generation: 1, store_id: 'same-store',
      programs: [{ name: 'page', body: [{ table: 'rows' }] }],
      schema: { tables: { rows: { sync: {}, leave: composed ? 'delivered-history' : 'until-revoked' } } } },
    incarnation: 0, credentialRevision: 0, get authority() { return reads.revision; },
    get partitionCurrent() { return attached; }, nativeReady: true,
    principal: 'bob', link: 'online', caughtUp: false, identityChecked: true,
    refreshing: null, partitionDenied: null, lastSyncAt: 1,
    signal: new AbortController().signal,
    unavailable: () => null, deviceNow: () => 1, serverNow: () => 1,
    queued: async () => [], pending: (tables, predictions) => reads.pending(tables, predictions),
    call: async request => {
      if (request.op === 'state') return { ok: { watermark } };
      assert.equal(request.op, 'query');
      assert.equal(attached, true, 'the online phase never evaluates in the device');
      return { ok: { data: [watermark < 20 ? 'older-local' : 'caught-up-local'], unknown: composed && !publishedOnce, complete: !composed || publishedOnce,
        tables: ['rows'], watermark } };
    },
    post: async () => {
      requests++;
      return { ok: true, obsoleteAuth: false, json: { data: ['newer-server'],
        tables: ['rows'], complete: true, seq: 20, store_id: 'same-store', generation: 1 } };
    },
    notify() {}, offline: () => ({ code: 'E_OFFLINE', family: 'link', message: 'offline' }),
  };
  async function run() {
    const version = watch.changeVersion, authority = reads.revision;
    return evaluateLocal({ ...env, get authority() { return reads.revision; },
      current: () => watch.changeVersion === version,
      serverCurrent: reads.serverCurrent(watch), inputsCurrent: reads.inputsCurrent(watch),
      retainedCurrent: reads.retainedCurrent(), serverAnswers: reads.serverAnswers.view(),
    }, op, args, 0, authority, watch);
  }
  async function onlineThenAttach() {
    const server = await run();
    assert.deepEqual(server.read.data, ['newer-server']);
    assert.equal(server.seq, 20);
    assert.equal(reads.current(watch, server), true);
    watch.tables = server.tables;
    watch.serverRead = server.served;
    watch.serverOnly = server.serverOnly;
    watch.publish(server.read);
    reads.displayed(watch, server);
    assert.equal(server.publicationCurrent(), true, 'displayed floor cannot revoke its own accepted publication');
    publishedOnce = true;
    // A held acquisition can publish its older cut after the foreground reply.
    // Use the actual sync publication bookkeeping, including cache retirement.
    reads.applied([watch], 10);
    attached = true;
    return server;
  }
  return { reads, watch, env, run, onlineThenAttach, requests: () => requests, apply: cut => { watermark = cut; reads.applied([watch], cut); } };
}

for (const composed of [false, true]) test(`displayed ${composed ? 'composed' : 'server'} cut 20 fences local watermark 10 until sync reaches 20`, async () => {
  const f = fixture(composed);
  await f.onlineThenAttach();
  const candidate = await f.run();
  assert.deepEqual(candidate.read.data, ['older-local']);
  assert.equal(f.reads.current(f.watch, candidate), false);
  assert.deepEqual(f.watch.snapshot.data, ['newer-server']);
  assert.equal(f.watch.displayedCut, 20);
  assert.equal(f.watch.changeCut, undefined);
  assert.equal(f.reads.deferUntilSync(f.watch, true, f.env.backend, null), false);
  assert.equal(f.watch.waitingForSync, undefined, 'displayed basis alone does not park sync');
  assert.equal(f.watch.scopeCut, undefined);
  for (const cut of [20, 21]) {
    f.apply(cut);
    const current = await f.run();
    assert.equal(f.reads.current(f.watch, current), true);
    f.watch.publish(current.read);
    assert.deepEqual(f.watch.snapshot.data, ['caught-up-local']);
  }
  assert.equal(f.requests(), 1);
});

test('displayed cut leaves retention and scope-loss deadlines unchanged', async () => {
  const f = fixture(); await f.onlineThenAttach();
  f.watch.reload(true);
  const before = f.watch.snapshot;
  const { episodeDeadline } = await import('../dist/read-episode.js');
  const deadline = episodeDeadline(before);
  assert.ok(deadline);
  f.watch.scopeCut = 30;
  f.reads.displayed(f.watch, {read:before,tables:new Set(['rows']),served:true,seq:25});
  assert.equal(episodeDeadline(f.watch.snapshot),deadline);
  assert.equal(f.watch.snapshot,before); assert.equal(f.watch.scopeCut,30); assert.equal(f.watch.displayedCut,25);
  assert.equal(f.watch.changeCut,undefined);
});

test('a displayed cut belongs to its watch, not other observations of those tables', async () => {
  const f = fixture(); await f.onlineThenAttach();
  f.reads.displayed(f.watch, { read: f.watch.snapshot, tables: new Set(['rows', 'more']), served: true, seq: 20 });
  const resumed = localWatch(undefined, {kind:'query',name:'more'}, {}, 'more:{}', 0, tables => f.reads.pending(tables));
  resumed.tables = new Set(['more']); resumed.detachedEpoch = f.reads.revision;
  f.reads.resume(resumed);
  assert.equal(resumed.changeCut, undefined, 'a publication does not impersonate a table change notification');
  f.reads.notified(['more'], 21); f.reads.resume(resumed);
  assert.equal(resumed.changeCut, 21, 'actual change notifications still reach resumed watches');
  assert.equal(resumed.scopeCut, undefined);
});

test('server continuation memory keeps the observation key and expires through that watch', async () => {
  const f = fixture(true), args = { c: 'sb4-server:opaque' }, op = {kind:'query',name:'page'};
  f.env.backend.programs[0].args = {c:{Optional:'Cursor'}};
  f.env.call = async () => { throw Error('a server continuation cannot enter the device'); };
  f.env.post = async (_path, body) => {
    assert.deepEqual(body.args,{c:'opaque'},'only the wire sees the unwrapped cursor');
    return {ok:true,obsoleteAuth:false,json:{data:['page'],complete:true,tables:['rows'],seq:20,nextExpiry:10}};
  };
  const key = `page:${JSON.stringify(args)}`;
  const watch = localWatch(undefined,op,args,key,0,tables=>f.reads.pending(tables));
  const result = await evaluateLocal({...f.env,serverCursorAffinity:true,serverAnswers:f.reads.serverAnswers.view()},op,args,0,f.reads.revision,watch);
  assert.deepEqual(result.read.data,['page']);
  assert.ok(f.reads.serverAnswers.view().get(key),'remembered answer uses the public observation identity');
  watch.publish(result.read); f.reads.expire(watch,true,10);
  assert.equal(f.reads.serverAnswers.view().get(key),undefined);
});

import { createLocalClient } from '../dist/local.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { readFileSync } from 'node:fs';
const wasm = new WebAssembly.Module(readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)));
const tick = () => new Promise(resolve=>setTimeout(resolve,5));
async function until(check) { for(let i=0;i<1000;i++){if(await check())return;await tick();} assert.fail('publication did not arrive'); }
async function liveFixture(t, composed=false) {
  let localKnown=false, watermark=10, serverHead=20, holdSync=false, change, localReads=0, serverReads=0;
  let localValue='history-10', wholeServer=false;
  const syncRelease=Promise.withResolvers();
  const backend={generation:1,store_id:'basis',schema:{tables:{}},programs:[{name:'page',kind:'Query',args:{},body:[{Return:{Literal:{String:'fixture'}}}]}]};
  const inner=webDevice({wasm,persist:memoryPersistence()});
  const client=await createLocalClient({url:'https://basis.invalid',persona:'bob',device:{async open(...args){
    const core=await inner.open(...args); return {...core, async call(request,...rest){
      if(request.op==='query') {localReads++; return {ok:composed ? {data:{kept:[localValue],live:[]},unknown:true,complete:false,
        ...(!wholeServer?{components:{kept:{retained:true,complete:true},live:{unknown:true,complete:false}}}:{}),tables:['rows'],watermark} :
        {data:[watermark<20?'older-local':'caught-up-local'],unknown:!localKnown,complete:localKnown,tables:['rows'],watermark}};}
      return core.call(request,...rest);
    }};
  }},fetch:async(input,init)=>{
    const path=new URL(input).pathname;
    if(path==='/schema')return Response.json(backend);
    if(path==='/changes')return new Promise((resolve,reject)=>{change=value=>resolve(Response.json(value));init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});
    if(path==='/sync'){
      if(holdSync)await Promise.race([syncRelease.promise,new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}))]);
      return Response.json({generation:1,store_id:'basis',snapshot:!JSON.parse(init.body).stream,watermark,images_at:watermark,events:[],committed_above:{},more:false});
    }
    if(path==='/probe')return Response.json({ok:true,store_id:'basis',seq:serverHead,generation:1});
    serverReads++;
    return Response.json({data:composed?{kept:wholeServer?['server-history-21']:[],live:[`server-${serverHead}`]}:['newer-server'],complete:true,tables:['rows'],seq:serverHead,store_id:'basis',generation:1});
  }});
  t.after(()=>client.close());
  await until(()=>client.acquired);
  const watch=client.observe({kind:'query',name:'page'},{}); t.after(()=>watch.close()); watch.subscribe(()=>{});
  return {client,watch,localReads:()=>localReads,serverReads:()=>serverReads,
    wholeServer(){wholeServer=true;},
    async apply(cut){watermark=cut;localValue=`history-${cut}`;localKnown=true;holdSync=false;syncRelease.resolve();await client.sync();},
    async commit(){await until(()=>!!change);holdSync=true;serverHead=21;localValue='changed-local-at-10';change({seq:21,store_id:'basis',generation:1,tables:['rows']});}};
}

test('createLocalClient publication keeps the server row at 20 over local watermark 10 until applied(20)', async t=>{
  const f=await liveFixture(t);
  await until(()=>f.watch.getSnapshot().data?.[0]==='newer-server');
  const before=f.localReads(); await f.apply(10);
  await until(()=>f.localReads()>before); await tick();
  assert.deepEqual(f.watch.getSnapshot().data,['newer-server'],'publication recorded its displayed basis');
  await f.apply(20); await until(()=>f.watch.getSnapshot().data?.[0]==='caught-up-local');
});

for (const replacement of ['whole server', 'applied(21)']) test(`mixed watch keeps composition 20 through change 21 until ${replacement}`, async t=>{
  const f=await liveFixture(t,true);
  await until(()=>f.watch.getSnapshot().data?.live?.[0]==='server-20');
  const shown={kept:['history-10'],live:['server-20']};
  assert.deepEqual(f.watch.getSnapshot().data,shown);
  const publications=[]; f.watch.subscribe(()=>publications.push(f.watch.getSnapshot()));
  const requests=f.serverReads();
  await f.commit();
  await until(()=>f.serverReads()>requests); await tick();
  assert.deepEqual(f.watch.getSnapshot().data,shown,'the changed local component at watermark 10 cannot publish with server cut 21');
  assert.ok(publications.every(read=>!read.data || JSON.stringify(read.data)===JSON.stringify(shown)));
  if(replacement==='whole server') f.wholeServer(); else await f.apply(21);
  await until(()=>f.watch.getSnapshot().data?.live?.[0]==='server-21');
  assert.deepEqual(f.watch.getSnapshot().data.kept,[replacement==='whole server'?'server-history-21':'history-21']);
  assert.ok(publications.every(read=>!read.data?.kept.includes('changed-local-at-10')),'no stale composition ever reaches a subscriber');
});
