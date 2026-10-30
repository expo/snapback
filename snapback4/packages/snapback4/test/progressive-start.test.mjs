import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp, localStatus } from '../dist/app.js';
import { memorySessionStore, sessionKey } from '../dist/auth.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { createLocalClient } from '../dist/local.js';
import { storeLock } from '../dist/app-storage.js';
import { DeviceVersionError } from '../dist/device-version.js';
const wasm = new WebAssembly.Module(readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)));
const gate = () => Promise.withResolvers();
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(fn) { for (let n = 0; n < 1000; n++) { if (await fn()) return; await tick(); } assert.fail('condition did not arrive'); }
const q = { kind: 'query', name: 'read' };
const backend = { generation: 1, store_id: 'store', schema: { tables: {} }, programs: [{ name: 'read', kind: 'Query', args: {}, body: [{ Return: { Literal: { String: 'local' } } }] }] };
async function fixture(t, { custody = 'none', failure, heldRead = false, startup = 'progressive', includeProbe = true, persona = false, change, alterReply, badEngine = false, heldHandshake = false, raw = false, backend: givenBackend = backend, queryReply, wrapCore, persist = memoryPersistence() } = {}) {
  const url = persona ? 'http://127.0.0.1:4400' : 'https://progressive.invalid', sessions = memorySessionStore();
  await sessions.set(sessionKey(url), JSON.stringify({ token: 'token', principal: 'alice', kind: 'user', expiresAt: Date.now() + 7 * 86400000 }));
  const opened = gate(), release = gate(), readRelease = gate(), inner = webDevice({ wasm, persist });
  if(raw && startup !== 'progressive') release.resolve();
  let probes = 0, opens = 0, queryCount = 0, closedCores = 0, coreCalls = 0, syncFailure, server = structuredClone(givenBackend), head = 20, openedAt;
  const pendingChanges = []; let poll; const polls = [], changeRequests = [], operations = [];
  const changeRelease = gate();
  const handshake = gate(), handshakeRelease = gate();
  const options = { url, sessionStore: sessions, ...(startup ? { startup } : {}), ...(persona ? {persona: 'alice'} : {}), device: {
    ...(includeProbe ? { custody: async () => { probes++; if (custody instanceof Error) throw custody; return custody; } } : {}),
    async open(...args) { opens++; openedAt ??= performance.now(); opened.resolve(); await release.promise; if (failure) throw failure; let core = await inner.open(...args); if (wrapCore) core = wrapCore(core); return { ...core, async call(request, ...rest) { coreCalls++; operations.push(request.op); if (heldHandshake && request.op !== 'engine_info' && operations.includes('engine_info')) await handshakeRelease.promise; if (request.op === 'engine_info') { handshake.resolve(); if (heldHandshake) await handshakeRelease.promise; if (badEngine) return {ok:{format:0,version:"old",capabilities:[]}}; } return core.call(request,...rest); }, async close() { closedCores++; await core.close(); } }; },
  }, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/changes' && change) { await Promise.race([changeRelease.promise, new Promise(resolve=>init.signal.addEventListener('abort',resolve,{once:true}))]); return Response.json(change); }
    if (path === '/changes') {
      changeRequests.push(String(input));
      if (pendingChanges.length) return Response.json(pendingChanges.shift());
      return new Promise((resolve, reject) => { const respond = value => { if (poll === respond) poll = undefined; polls.splice(polls.indexOf(respond) >>> 0, 1); resolve(Response.json(value)); }; poll = respond; polls.push(respond);
        const abort = () => { if (poll === respond) poll = undefined; polls.splice(polls.indexOf(respond) >>> 0, 1); reject(init.signal.reason); };
        if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, {once:true}); });
    }
    if (path === '/schema') return Response.json(server);
    if (path === '/sync') { if (syncFailure) return Response.json({denied:syncFailure}, {status:409}); const req = JSON.parse(init.body); return Response.json({ generation: server.generation, store_id: server.store_id, snapshot: !req.stream, watermark: head, images_at: head, events: [], committed_above: {}, more: false }); }
    if (path === '/probe') return Response.json({ ok: true, viewer: 'alice', scope: 'full', store_id: server.store_id, seq: head, generation: server.generation });
    if (path.startsWith('/m/')) return Response.json({ state: 'sent', seq: head, store_id: server.store_id, replayed: false });
    if (path.startsWith('/auth/')) return Response.json({ ok: true });
    queryCount++; if (heldRead) await readRelease.promise;
    return Response.json(alterReply?.(queryCount) ?? { data: 'server', complete: true, tables: [], seq: head, store_id: server.store_id, generation: server.generation, ...queryReply?.() });
  }};
  const app = raw ? { client: await createLocalClient(options), close() { return this.client.close(); } } : createApp(options);
  t.after(async () => { release.resolve(); readRelease.resolve(); changeRelease.resolve(); handshakeRelease.resolve(); await app.close(); });
  return { app, sessions, opened, release, readRelease, changeRelease, handshake, handshakeRelease, probes: () => probes, opens: () => opens, queryCount: () => queryCount, closedCores: () => closedCores,
    coreCalls: () => coreCalls, failSync: why => {syncFailure=why;}, operations, changeRequests, openedAt: () => openedAt,
    change: value => { if (poll) poll(value); else pendingChanges.push(value); },
    changeOldest: value => { const respond = polls[0]; if (respond) respond(value); else pendingChanges.push(value); }, heldPolls: () => polls.length,
    server: (updates, seq = head) => { server = {...server,...updates}; head = seq; } };
}

test('progressive publishes signed-in client and server data before core; attaches without replacing watch', async t => {
  const f = await fixture(t);
  assert.equal((await f.app.ready).ok, true); assert.equal(f.app.auth.state, 'signed-in');
  const client = f.app.client, status = localStatus(client);
  assert.equal(f.opens(), 0, 'usable client precedes even invocation of the device opener');
  assert.equal(status.getSnapshot().state, 'loading'); assert.equal(client.acquired, false);
  const watch = client.observe(q, {}); t.after(() => watch.close());
  const snapshots = []; watch.subscribe(() => snapshots.push(watch.getSnapshot()));
  await until(() => watch.getSnapshot().data === 'server'); await f.opened.promise;
  assert.equal(client.acquired, false); assert.equal(status.getSnapshot().state, 'opening');
  const first = snapshots.findIndex(s => s.data === 'server');
  f.release.resolve();
  await until(() => status.getSnapshot().state === 'ready');
  await until(() => watch.getSnapshot().data === 'local');
  assert.equal(f.app.client, client); assert.equal(client.acquired, true);
  assert.ok(snapshots.slice(first).every(s => !('loading' in s)), JSON.stringify(snapshots));
});

for (const custody of ['present', 'unknown', new Error('unreadable')]) test(`custody ${custody}: await ordinary device recovery`, async t => {
  const f = await fixture(t, { custody }); let ready = false; void f.app.ready.then(() => { ready = true; });
  await f.opened.promise; await tick(); assert.equal(ready, false); assert.equal(f.queryCount(), 0);
  f.release.resolve(); assert.equal((await f.app.ready).ok, true);
});
for (const persona of [false, true]) test(`default web startup publishes ready before opening and reads the server with the opener held (persona: ${persona})`, {timeout: 10_000}, async t => {
  let opensAtReply;
  const f = await fixture(t, { startup: null, persona, queryReply: () => { opensAtReply = f.opens(); return {}; } });
  assert.equal((await f.app.ready).ok, true);
  assert.equal(f.probes(), 1); assert.equal(f.opens(), 0);
  assert.equal(localStatus(f.app.client).getSnapshot().state, 'loading');
  assert.equal((await f.app.client.query(q, {})).data, 'server');
  assert.equal(opensAtReply, 0, 'the server answers before the opener is invoked');
  assert.equal(f.coreCalls(), 0, 'the read completes while the device opener is held');
  await f.opened.promise; f.release.resolve();
  await until(() => localStatus(f.app.client).getSnapshot().state === 'ready');
});
for (const options of [{ includeProbe: false, startup: null }, { includeProbe: false }, { includeProbe: false, persona: true }, { startup: 'awaited' }, { startup: 'awaited', persona: true }]) test(`native/awaited startup preserves awaited opening ${JSON.stringify(options)}`, async t => {
  const f = await fixture(t, options); let ready = false; void f.app.ready.then(() => { ready = true; });
  await f.opened.promise; assert.equal(ready, false); assert.equal(f.probes(), options.includeProbe === false ? 0 : 1); assert.equal(f.queryCount(), 0);
  f.release.resolve(); assert.equal((await f.app.ready).ok, true);
  assert.equal(localStatus(f.app.client).getSnapshot().executable, true);
  assert.equal((await f.app.client.query(q, {})).data, 'local');
});
test('awaited web startup keeps device-opening failure on the ready barrier', async t => {
  const f = await fixture(t, { startup: 'awaited', failure: new Error('device open failed') });
  await f.opened.promise; f.release.resolve();
  const result = await f.app.ready;
  assert.equal(result.ok, false); assert.equal(result.why.code, 'E_CLIENT');
  assert.match(result.why.message, /device open failed/);
  assert.equal(f.app.auth.state, 'signed-out'); assert.equal(f.probes(), 1);
});
for (const failure of [new Error('download failed'), new DeviceVersionError({ code: 'E_DEVICE_VERSION', family: 'device-version', message: 'incompatible device' })]) test(`failed engine keeps server reads and signed-in scope: ${failure.message}`, async t => {
  const f = await fixture(t, { failure }); await f.app.ready;
  const client = f.app.client;
  assert.equal((await client.query(q, {})).data, 'server'); f.release.resolve();
  await until(() => localStatus(client).getSnapshot().state === 'unavailable');
  assert.equal((await client.query(q, {})).data, 'server'); assert.equal(f.app.auth.state, 'signed-in'); assert.equal(f.app.client, client);
  assert.equal(localStatus(client).getSnapshot().why.code, failure instanceof DeviceVersionError ? 'E_DEVICE_VERSION' : 'E_STORE');
  assert.equal((await client.mutate({ kind: 'mutation', name: 'write' }, {})).state, 'sent');
});
test('first pending read has priority; bounded fallback starts the held engine', async t => {
  const f = await fixture(t, { heldRead: true }); await f.app.ready;
  const started = performance.now();
  const read = f.app.client.query(q, {}); await until(() => f.queryCount() === 1);
  await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(f.opens(), 0);
  await f.opened.promise; assert.equal(f.app.client.acquired, false);
  assert.ok(f.openedAt() - started <= 1500 + 250, `fallback exceeded PREPARE_FALLBACK_MS plus 250ms scheduling allowance: ${f.openedAt() - started}`);
  f.readRelease.resolve(); assert.equal((await read).data, 'server');
});
test('no foreground read starts preparation after publication', async t => {
  const f = await fixture(t); await f.app.ready; assert.equal(f.opens(), 0, 'publication turn does not open');
  const publishedAt=performance.now();
  await f.opened.promise; assert.equal(f.opens(), 1, 'the post-publication timer starts preparation'); assert.equal(f.app.auth.state, 'signed-in');
  assert.ok(f.openedAt()-publishedAt<250, `publication timer exceeded 250ms: ${f.openedAt()-publishedAt}`);
});
test('close during held open fences late attachment and closes the returned core', async t => {
  const f = await fixture(t); await f.app.ready; const client = f.app.client;
  await f.opened.promise; await f.app.close(); f.release.resolve();
  await until(() => f.closedCores() === 1);
  assert.equal(client.acquired, false); assert.equal(localStatus(client).getSnapshot().state, 'unavailable');
});
for (const startup of ['progressive', 'awaited']) test(`${startup} without device is a typed configuration refusal with rewrite`, async () => {
  const app = createApp({ url: 'https://progressive.invalid', sessionStore: memorySessionStore(), startup });
  const result = await app.ready; assert.equal(result.ok, false); assert.equal(result.why.code, 'E_CLIENT'); assert.match(result.why.rewrite, /webDevice/); assert.doesNotMatch(result.why.rewrite, /startup:/); await app.close();
});

for (const opening of [false, true]) test(`logout fences held online phase and late core (opening: ${opening})`, async t => {
  const f = await fixture(t, { heldRead: !opening }); await f.app.ready;
  const client = f.app.client, watch = client.observe(q, {}); t.after(() => watch.close());
  if (opening) { await until(() => watch.getSnapshot().data === 'server'); await f.opened.promise; }
  else await until(() => f.queryCount() > 0);
  const snapshots = []; watch.subscribe(() => snapshots.push(watch.getSnapshot()));
  assert.equal((await f.app.auth.logout()).ok, true);
  f.readRelease.resolve(); f.release.resolve();
  await tick(); await tick();
  assert.equal(f.app.auth.state, 'signed-out'); assert.equal(client.acquired, false);
  assert.ok(!('data' in watch.getSnapshot()));
  assert.ok(!snapshots.some(read => 'data' in read), JSON.stringify(snapshots));
  if (opening) await until(() => f.closedCores() === 1);
});

test('mutation before core uses journal and settles without waiting for attachment', async t => {
  const f = await fixture(t); await f.app.ready;
  const result = await f.app.mutate({kind:'mutation',name:'write'}, {});
  assert.equal(result.state,'sent');
  assert.equal(localStatus(f.app.client).getSnapshot().executable, false);
  assert.equal(f.app.auth.state,'signed-in');
});

test('an opened but incompatible core stays fenced while online reads remain usable', async t => {
  const f = await fixture(t,{badEngine:true}); await f.app.ready;
  const client=f.app.client; assert.equal((await client.query(q,{})).data,'server'); f.release.resolve();
  await until(()=>localStatus(client).getSnapshot().state==='unavailable');
  assert.equal(localStatus(client).getSnapshot().why.code,'E_DEVICE_VERSION');
  assert.equal(client.deviceVersion().state,'incompatible');
  assert.equal((await client.query(q,{})).data,'server'); assert.equal(f.app.auth.state,'signed-in');
});

test('logout during the opened core handshake fences its completion', async t => {
  const f = await fixture(t,{heldHandshake:true}); await f.app.ready;
  const client=f.app.client; await client.query(q,{}); f.release.resolve(); await f.handshake.promise;
  const logout=f.app.auth.logout(); await until(()=>localStatus(client).getSnapshot().state==='unavailable');
  f.handshakeRelease.resolve(); assert.equal((await logout).ok,true);
  assert.equal(client.acquired,false); assert.equal(f.app.auth.state,'signed-out');
  assert.equal(localStatus(client).getSnapshot().state,'unavailable');
});

test('version refusal after acquisition fences all local calls while keeping the server route', async t => {
  const f = await fixture(t); await f.app.ready;
  const client=f.app.client; await client.query(q,{}); f.release.resolve();
  await until(()=>localStatus(client).getSnapshot().state==='ready');
  f.failSync({code:'E_DEVICE_VERSION',family:'device-version',message:'engine retired'});
  await client.sync(); await until(()=>localStatus(client).getSnapshot().state==='unavailable');
  const calls=f.coreCalls();
  assert.equal((await client.asset('a')).denied.code,'E_DEVICE_VERSION');
  assert.equal((await client.mutate({kind:'mutation',name:'write'},{})).state,'sent');
  assert.equal((await client.query(q,{})).data,'server');
  assert.equal(f.coreCalls(),calls); assert.equal(f.app.auth.state,'signed-in');
});

for (const via of ['changes', 'query']) test(`generation 2 on ${via} adopts and the same watch continues through attachment`, async t => {
  const f = await fixture(t); await f.app.ready;
  const client = f.app.client, watch = client.observe(q, {}); t.after(() => watch.close());
  await until(() => watch.getSnapshot().data === 'server');
  f.server({generation:2, programs:[{...backend.programs[0], body:[{Return:{Literal:{String:'generation 2'}}}]}]}, 21);
  if (via === 'changes') { const polls=f.changeRequests.length; f.change({seq:21,store_id:'store',generation:2,tables:[]}); await until(()=>f.changeRequests.length>polls); }
  assert.equal((await client.query(q, {})).data, 'server');
  f.release.resolve(); await until(() => localStatus(client).getSnapshot().state === 'ready');
  await until(() => watch.getSnapshot().data === 'generation 2');
  assert.equal(f.app.client, client); assert.ok(f.operations.includes('adopt'));
});

for (const handshake of [false, true]) test(`store replacement uses app recovery (held handshake: ${handshake})`, async t => {
  const f = await fixture(t, {heldHandshake:handshake}); await f.app.ready;
  const old = f.app.client; assert.equal((await old.query(q,{})).data,'server');
  if (handshake) { f.release.resolve(); await f.handshake.promise; }
  f.server({store_id:'replacement'},21);
  f.change({seq:21,store_id:'replacement',generation:1,tables:[]});
  await until(() => f.app.auth.state === 'restoring' || f.app.client !== old);
  f.release.resolve(); f.handshakeRelease.resolve();
  await until(() => f.app.client !== old);
  await until(() => f.app.auth.state === 'signed-in');
  assert.ok('data' in await f.app.client.query(q,{}));
  await until(() => localStatus(f.app.client).getSnapshot().state === 'ready');
  assert.equal(localStatus(old).getSnapshot().executable,false);
});

for (const via of ['query', 'changes', 'initial sync']) test(`same-store rollback below online head is witnessed through ${via}`, async t => {
  let core;
  const f = await fixture(t,{queryReply:via==='query'?undefined:()=>({seq:20}),wrapCore:value=>(core=value)}); await f.app.ready;
  const client = f.app.client; assert.equal((await client.query(q,{})).data,'server');
  f.server({},10);
  if (via === 'changes') {
    // The first poll predates head 20; answer it at 20, then shrink a new poll.
    f.change({seq:20,store_id:'store',generation:1,tables:[]});
    await until(() => f.changeRequests.length >= 2);
    f.change({seq:10,store_id:'store',generation:1,tables:[]});
    await tick();
  }
  if (via === 'initial sync') { f.release.resolve(); await until(() => f.operations.includes('sync_state')); await client.sync(); }
  const result = await client.query(q,{});
  assert.equal(result.denied?.code,'E_STORE_RESTORE',JSON.stringify(result));
  assert.match(result.denied.message,/restored or shrank/);
  if(via==='initial sync') assert.equal((await core.call({op:'sync_state',capture:false})).ok.restore_refusal?.code,'E_STORE_RESTORE','a core present at the first sync must persist the proof too');
  assert.equal(f.app.auth.state,'signed-in');
});

test('a serialized worker handshake cannot block a foreground server-route read', async t => {
  const f = await fixture(t,{heldHandshake:true}); await f.app.ready;
  const client=f.app.client; await client.query(q,{}); f.release.resolve(); await f.handshake.promise;
  const calls=f.coreCalls(); let result;
  const read=client.query(q,{}).then(value => {result=value;});
  await until(() => result !== undefined);
  assert.equal(result.data,'server'); assert.equal(f.coreCalls(),calls,'foreground reads never queue behind handshake');
  f.handshakeRelease.resolve(); await read;
});

test('ordinary startup version refusal publishes unavailable local status', async t => {
  const f = await fixture(t, { startup: 'awaited', custody: 'present' }); f.release.resolve(); await f.app.ready;
  const client=f.app.client; await until(()=>localStatus(client).getSnapshot().state==='ready');
  f.failSync({code:'E_DEVICE_VERSION',family:'device-version',message:'engine retired'});
  await client.sync(); await until(()=>localStatus(client).getSnapshot().state==='unavailable');
  assert.equal(localStatus(client).getSnapshot().why.code,'E_DEVICE_VERSION');
  assert.equal(localStatus(client).getSnapshot().executable,false);
  assert.equal(client.acquired,false);
});

test('a device version refusal on the last pre-attachment poll still retires the engine after attachment', async t => {
  const f = await fixture(t); await f.app.ready;
  const client=f.app.client; await client.query(q,{});
  await until(()=>f.heldPolls()>=1);
  f.release.resolve(); await until(()=>localStatus(client).getSnapshot().state==='ready');
  f.changeOldest({denied:{code:'E_DEVICE_VERSION',family:'device-version',message:'engine retired'}});
  await until(()=>localStatus(client).getSnapshot().state==='unavailable');
  assert.equal(localStatus(client).getSnapshot().why.code,'E_DEVICE_VERSION');
  assert.equal((await client.query(q,{})).data,'server');
});

test('a terminal auth refusal on the last pre-attachment poll still ends the session after attachment', async t => {
  const f = await fixture(t); await f.app.ready;
  const client=f.app.client; await client.query(q,{});
  await until(()=>f.heldPolls()>=1);
  f.release.resolve(); await until(()=>localStatus(client).getSnapshot().state==='ready');
  // The pre-attachment poll is still held; answer it after attachment completed.
  f.changeOldest({denied:{code:'E_AUTH',family:'auth',message:'revoked'}});
  await until(()=>f.app.auth.state!=='signed-in');
  const read=await client.query(q,{});
  assert.ok(read.denied, JSON.stringify(read));
});

test('a same-store shrink on the last pre-attachment poll is fenced after attachment', async t => {
  const f = await fixture(t); await f.app.ready;
  const client=f.app.client; await client.query(q,{});
  // Retire the first poll (dispatched before any head was witnessed); the second
  // pre-attachment poll is dispatched with the witnessed online head (20).
  await until(()=>f.heldPolls()>=1); f.change({seq:20,store_id:'store',generation:1,tables:[]});
  await until(()=>f.changeRequests.length>=2&&f.heldPolls()>=1);
  f.release.resolve(); await until(()=>localStatus(client).getSnapshot().state==='ready');
  // That poll is still held across attachment; it answers below the witnessed head.
  f.changeOldest({seq:10,store_id:'store',generation:1,tables:[]});
  await until(async()=>(await client.query(q,{})).denied?.code==='E_STORE_RESTORE');
  assert.equal((await client.mutate({kind:'mutation',name:'write'},{})).why?.code,'E_STORE_RESTORE');
});

test('change evidence on the last pre-attachment poll reaches the watches after attachment', async t => {
  const f = await fixture(t); await f.app.ready;
  const client=f.app.client, watch=client.observe(q,{}); t.after(()=>watch.close());
  await until(()=>watch.getSnapshot().data==='server');
  await until(()=>f.heldPolls()>=1); f.change({seq:20,store_id:'store',generation:1,tables:[]});
  await until(()=>f.changeRequests.length>=2&&f.heldPolls()>=1);
  f.release.resolve(); await until(()=>localStatus(client).getSnapshot().state==='ready');
  await until(()=>watch.getSnapshot().data==='local');
  // The held pre-attachment poll reports a newer cut for this watch's table after attachment.
  f.changeOldest({seq:21,store_id:'store',generation:1,tables:['rows'],preserved:[]});
  // The local answer at 20 is no longer current; the watch re-reads rather than keeping it.
  await until(()=>f.changeRequests.length>=3);
  assert.ok(f.operations.filter(op=>op==='query').length>=1);
});

test('a post-attachment changes poll below the witnessed online head is a fenced shrink', async t => {
  const f = await fixture(t); await f.app.ready;
  const client=f.app.client; await client.query(q,{}); f.release.resolve();
  await until(()=>localStatus(client).getSnapshot().state==='ready');
  // Retire the pre-attachment poll, then witness a newer online head than the replica (20).
  f.change({seq:20,store_id:'store',generation:1,tables:[]});
  await until(()=>f.changeRequests.length>=2);
  f.server({},30); assert.equal((await client.query({kind:'query',name:'online'},{})).data,'server');
  // Retire the poll dispatched before the head was witnessed; the next poll carries it.
  f.change({seq:20,store_id:'store',generation:1,tables:[]});
  await until(()=>f.changeRequests.length>=3&&f.heldPolls()>=1);
  f.change({seq:25,store_id:'store',generation:1,tables:[]});
  await until(async()=>(await client.query(q,{})).denied?.code==='E_STORE_RESTORE');
  assert.equal((await client.mutate({kind:'mutation',name:'write'},{})).why?.code,'E_STORE_RESTORE');
});

test('/changes version refusal disables the engine and keeps polling and server-route watches', async t => {
  const f=await fixture(t); await f.app.ready;
  const client=f.app.client, watch=client.observe(q,{}); t.after(()=>watch.close());
  await until(()=>watch.getSnapshot().data==='server'); f.release.resolve();
  await until(()=>localStatus(client).getSnapshot().state==='ready');
  // Retire a pre-attachment poll, then deliver the refusal on the core poll.
  f.change({seq:20,store_id:'store',generation:1,tables:[]});
  await until(()=>f.changeRequests.length>=2);
  f.change({denied:{code:'E_DEVICE_VERSION',family:'device-version',message:'engine retired'}});
  await until(()=>localStatus(client).getSnapshot().state==='unavailable');
  await until(()=>watch.getSnapshot().data==='server');
  const requests=f.changeRequests.length;
  f.server({},21); f.change({seq:21,store_id:'store',generation:1,tables:[]});
  await until(()=>f.changeRequests.length>requests);
  assert.equal((await client.query(q,{})).data,'server'); assert.equal(f.app.auth.state,'signed-in');
});

for (const composed of [false, true]) test(`held ${composed?'mixed':'local'} device response crossing changes version refusal uses the server`, async t => {
  const entered=gate(), releaseRead=gate(); let hold=false;
  const f=await fixture(t,{wrapCore:core=>({...core,async call(request,...rest){
    const result=await core.call(request,...rest);
    if(hold && request.op==='query') {
      entered.resolve(); await releaseRead.promise;
      if(composed) return {ok:{data:{kept:['rejected-engine'],live:[]},unknown:true,complete:false,
        components:{kept:{retained:true,complete:true},live:{unknown:true,complete:false}},tables:[],watermark:20}};
    }
    return result;
  }})});
  t.after(()=>releaseRead.resolve());
  await f.app.ready; const client=f.app.client; await client.query(q,{}); f.release.resolve();
  await until(()=>localStatus(client).getSnapshot().state==='ready');
  f.change({seq:20,store_id:'store',generation:1,tables:[]});
  await until(()=>f.changeRequests.length>=2);
  hold=true; const reading=client.query(q,{}); await entered.promise;
  f.change({denied:{code:'E_DEVICE_VERSION',family:'device-version',message:'engine retired'}});
  await until(()=>localStatus(client).getSnapshot().state==='unavailable');
  const calls=f.coreCalls(), requests=f.queryCount(); releaseRead.resolve();
  assert.equal((await reading).data,'server','the held response cannot publish from the rejected engine');
  assert.ok(f.queryCount()>requests,'the same one-shot retries through the server');
  assert.equal(f.coreCalls(),calls,'fallback makes no further device calls');
});

test('progressive sync rollback remains refused after close, server refill and device reopen', async t => {
  const persist=memoryPersistence(); let core;
  const f=await fixture(t,{persist,wrapCore:value=>(core=value)}); await f.app.ready;
  const client=f.app.client; await client.query(q,{}); f.release.resolve();
  await until(()=>localStatus(client).getSnapshot().state==='ready');
  assert.equal((await core.call({op:'sync_state',capture:false})).ok.watermark,20);
  // Witness a newer online head than the published replica, then contradict it.
  f.server({},30); assert.equal((await client.query({kind:'query',name:'online'},{})).data,'server');
  f.server({},25); await client.sync();
  assert.equal((await client.query(q,{})).denied?.code,'E_STORE_RESTORE');
  assert.equal((await core.call({op:'sync_state',capture:false})).ok.restore_refusal?.code,'E_STORE_RESTORE');
  await f.app.close(); f.server({},40);
  // An ordinary reopen must recover the durable refusal even with a higher server head.
  const reopened=await createLocalClient({url:'https://progressive.invalid',sessionStore:f.sessions,
    device:webDevice({wasm,persist}),fetch:async input=>{
      const path=new URL(input).pathname;
      if(path==='/schema')return Response.json(backend);
      if(path==='/probe')return Response.json({ok:true,store_id:'store',seq:40,generation:1});
      assert.fail(`a durably refused device must not sync or replay: ${path}`);
    }});
  t.after(()=>reopened.close());
  assert.equal((await reopened.query(q,{})).denied?.code,'E_STORE_RESTORE');
  assert.equal((await reopened.mutate({kind:'mutation',name:'write'},{})).why?.code,'E_STORE_RESTORE');
});

test('ephemeral typing changes before attachment at an unchanged durable head', async t => {
  let epoch=1, data=[];
  const f=await fixture(t,{backend:{...backend,schema:{tables:{typing:{ephemeral:{}}},operations:{read:{ephemeralReads:['typing']}}}},
    queryReply:()=>({data,tables:['typing'],ephemeral:{epoch,incarnation:'typing-server'}})});
  await f.app.ready; const watch=f.app.client.observe(q,{}); t.after(()=>watch.close());
  await until(()=>Array.isArray(watch.getSnapshot().data));
  await until(()=>f.changeRequests.some(url=>new URL(url).searchParams.get('ephTables')==='typing'));
  epoch=2; data=['alice'];
  f.change({seq:20,store_id:'store',generation:1,tables:[],ephemeral:{epoch,incarnation:'typing-server',tables:['typing']}});
  await until(()=>watch.getSnapshot().data?.[0]==='alice');
  assert.equal(f.app.client.acquired,false);
});

test('outbox commit deltas retain A after B and an engine failure; A still blocks its query', async t => {
  const entry = (id,op,seq) => ({id,op,seq,args:{},new_ids:[],predicted:[],viewer:'alice',now:1,predictable:false});
  const f=await fixture(t,{raw:true,backend:{...backend,programs:[
    {...backend.programs[0],settlement:{reads:{rows:null},writes:{}}},
    {name:'A',kind:'Mutation',args:{},body:[],settlement:{reads:{},writes:{rows:null}}},
    {name:'B',kind:'Mutation',args:{},body:[],settlement:{reads:{},writes:{other:null}}}]},
    wrapCore:core=>({...core,onOutbox(listener){listener(1,[entry('a','A',1)]); listener(2,[entry('b','B',2)]); return ()=>{};},
      call(request,...rest){
        if(request.op==='next_submission') throw Error('recovery failed');
        // The notifications describe durable entries. Full recovery must see
        // those same entries; a synthetic empty listing would retire the debt.
        if(request.op==='queued')return Promise.resolve({ok:[entry('a','A',1),entry('b','B',2)]});
        return core.call(request,...rest);}})});
  const client=f.app.client; await client.query(q,{}); f.release.resolve();
  await until(()=>localStatus(client).getSnapshot().state==='unavailable');
  assert.deepEqual((await client.pendingWrites()).map(w=>w.id).sort(),['a','b']);
  let settled=false; const read=client.query(q,{}).then(result=>{settled=true;return result;});
  await new Promise(resolve=>setTimeout(resolve,100)); assert.equal(settled,false,'A custody withholds the dependent server answer');
  await client.close(); assert.equal((await read).denied?.code,'E_CLOSED');
});

for (const startup of ['progressive', 'awaited']) test(`auth refusal after ready never publishes executable status (${startup})`, async t => {
  let denied=false;
  const f=await fixture(t,{raw:true,startup,queryReply:()=>denied?{denied:{code:'E_AUTH',family:'auth',message:'expired'},data:undefined}:{}});
  const client=f.app.client; await client.query(q,{}); f.release.resolve();
  await until(()=>localStatus(client).getSnapshot().state==='ready');
  const status=localStatus(client), snapshots=[]; status.subscribe(()=>snapshots.push(status.getSnapshot()));
  // A server-only operation forces the authenticated route after acquisition.
  denied=true; await client.query({kind:'query',name:'online'},{});
  assert.equal(status.getSnapshot().state,'unavailable');
  assert.ok(snapshots.every(s=>!s.executable));
});

test('custody decision waits for the session admission lock and reads newly committed journal keys', async t => {
  const url='https://custody-lock.invalid', name=`snapback4-${encodeURIComponent(`${url}:alice`)}`;
  const storage=new Map(), entered=gate(), commit=gate();
  for(const [key,value] of Object.entries({indexedDB:{databases:async()=>[]},localStorage:{get length(){return storage.size;},key:i=>[...storage.keys()][i]??null},navigator:{locks:{query:async()=>({held:[],pending:[]}),request:async(_key,work)=>work()}}})) {
    const old=Object.getOwnPropertyDescriptor(globalThis,key); Object.defineProperty(globalThis,key,{configurable:true,value});
    t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});
  }
  const sessions=memorySessionStore(); await sessions.set(sessionKey(url),JSON.stringify({token:'t',principal:'alice',kind:'user',expiresAt:Date.now()+7*86400000}));
  const admission=storeLock(sessionKey(url),async()=>{entered.resolve();await commit.promise;storage.set(`snapback4-admission:${encodeURIComponent(name)}:A`,'{}');});
  await entered.promise;
  let probed=false, opened=false;
  const device=webDevice();
  const opening=createLocalClient({url,sessionStore:sessions,startup:'progressive',device:{custody:async name=>{probed=true;return device.custody(name);},open:async()=>{opened=true;throw Error('ordinary recovery selected');}},fetch:async()=>Response.json(backend)});
  await tick(); assert.equal(probed,false,'the probe cannot pass an admission holding the lock');
  commit.resolve(); await admission;
  await assert.rejects(opening,/ordinary recovery selected/); assert.equal(opened,true);
});
