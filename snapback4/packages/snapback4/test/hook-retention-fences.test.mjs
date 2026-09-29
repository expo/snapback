// @ref LLP 3000.029#7 — Astra's five adversarial checks, with real HTTP/device paths.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { answerObservation } from "../dist/read-observation.js";
import { assetRevoked, onAssetRevoked } from "../dist/asset-lifetime.js";
import { server, until, binary } from "./helpers/app-server.mjs";
const q = name => ({ kind: "query", name });
const m = name => ({ kind: "mutation", name });
const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const schema = `use personas alice, bob
table members:
  room: text <=40
  principal: principal
  unique room, principal
  immutable room, principal
  read <- exists members[.room, viewer]
  insert <- exists members[.room, viewer]
  delete <- allow
  sync to members[.room]
table secrets:
  room: text <=40
  body: text
  read <- exists members[.room, viewer]
  sync to members[.room]
query secret():
  return secrets['private']
query secretAlias():
  return { row: secrets['private'] }
table remote:
  read <- allow
  online only
query remoteSecret():
  require exists remote['flag'] else MISSING
  return secrets['private']
mutation kick():
  delete members[room = 'room', principal = 'dev:bob']
mutation restore():
  insert members { room: 'room', principal: 'dev:bob' }
table own:
  owner: principal
  body: text
  read <- .owner = viewer
  update <- allow
  sync to .owner
query list(a: int, b: int):
  return own where .owner = viewer first 100 by .id
mutation transfer():
  update own['A'] { owner: 'dev:alice' }
table notes:
  owner: principal
  body: text
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
mutation unrelated():
  insert notes { owner: viewer, body: 'unrelated' }
table photos:
  photo: image <=10000
  read <- allow
  insert <- allow
  delete <- allow
  sync public
mutation place(photo: image <=10000):
  return insert photos { photo }
mutation remove(id: photos):
  delete photos[id]
`;
async function fixture(t, source = schema, seed = source === schema) {
  const f = await server(t, undefined, source);
  f.post = (path, body, persona = "alice") => fetch(f.url + path, { method: "POST", headers: { "x-snapback-persona": persona }, body: JSON.stringify(body) }).then(r => r.json());
  if (seed) assert.equal((await f.post('/seed', [
    { table: 'remote', row: { id: 'flag' } },
    ...['alice','bob'].map(p => ({ table: 'members', row: { id: p, room: 'room', principal: 'dev:' + p } })),
    { table: 'secrets', row: { id: 'private', room: 'room', body: 'secret' } },
    ...['A','B'].map(id => ({ table: 'own', row: { id, owner: 'dev:bob', body: id } })),
  ])).seeded, 6);
  return f;
}
function parked(input, init) {
  if (new URL(input).pathname !== '/changes') return fetch(input, init);
  return new Promise((_, reject) => { const abort = () => reject(Error('closed')); if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true }); });
}
for (const tier of ['process','wasm']) test(`Astra 1 ${tier}: revoked rows cannot reappear during pending sync after unrelated prediction`, { timeout: 20000 }, async t => {
  const f = await fixture(t), sync = gate(), queryGate = gate();
  let hold = false, syncing = false, reads = 0;
  const device = tier === 'process' ? processDevice({ dir: join(f.dir, 'device'), binary }) : webDevice({ wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() });
  const client = await createLocalClient({ url: f.url, persona: 'bob', device, waitSeconds: 1, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (hold && path === '/sync') { syncing = true; await sync.promise; }
    if (hold && path === '/q/secret') { reads++; await queryGate.promise; }
    return fetch(input, init);
  } });
  const watch = client.observe(q('secret'), {}); watch.subscribe(() => {});
  t.after(async () => { sync.resolve(); queryGate.resolve(); watch.close(); await client.close(); });
  await client.sync(); await until(() => watch.getSnapshot().data?.body === 'secret', 'secret acquired');
  hold = true;
  assert.equal((await f.post('/m/kick', { id: 'kick', args: {} })).state, 'sent');
  await until(() => syncing, 'changes delivered before held sync');
  assert.equal(watch.getSnapshot().loading, true, 'the changes call itself must withdraw');
  assert.equal((await f.post('/q/secret', { args: {} }, 'bob')).data, null);
  const snapshots = []; watch.subscribe(() => snapshots.push(watch.getSnapshot()));
  const write = client.mutate(m('unrelated'), {}, { waitSeconds: 0 });
  await until(async () => (await client.pendingWrites()).some(w => w.predicted.length), 'unrelated prediction committed');
  const second = client.observe(q('secret'), {}, { keep: false }); second.subscribe(() => {});
  await delay(50);
  assert.ok(!snapshots.some(r => r.data?.body === 'secret'), 'prediction must not republish from stale replica');
  assert.notEqual(second.getSnapshot().data?.body, 'secret', 'new policy observation shares the fence');
  const direct = client.query(q('secret'), {});
  queryGate.resolve();
  assert.notEqual((await direct).data?.body, 'secret', 'direct reads share the fence');
  sync.resolve(); await write; await client.sync();
  await until(() => watch.getSnapshot().data === null, 'applied revocation'); second.close();
});

async function replacementClient(t, tier) {
  // Online-only inputs force an authoritative read on every host while the
  // real /changes feed is held, so peers cannot recover through a later poll.
  const f = await fixture(t, schema.replace(/\n  sync[^\n]+/g, '\n  online only'), true);
  const options = { url: f.url, persona: 'bob', fetch: parked };
  const client = tier === 'online' ? createClient(options) : await createLocalClient({ ...options,
    device: tier === 'process' ? processDevice({ dir: join(f.dir, 'device'), binary })
      : webDevice({ wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() }) });
  return { f, client };
}
for (const tier of ['online', 'process', 'wasm']) {
test(`Astra 2 ${tier}: keep:false authoritative null replaces every matching retained watch`, async t => {
  const { f, client } = await replacementClient(t, tier);
  const watch = client.observe(q('secret'), {}); watch.subscribe(() => {});
  t.after(async () => { watch.close(); await client.close(); });
  await until(() => watch.getSnapshot().data?.body === 'secret');
  await f.post('/m/kick', { id: 'kick', args: {} });
  const other = client.observe(q('secret'), {}, { keep: false }); other.subscribe(() => {});
  await until(() => other.getSnapshot().data === null);
  assert.equal(watch.getSnapshot().data, null); other.close();
});

test(`Astra 3 ${tier}: newer nonempty one-shot subset removes private row from retained watch`, async t => {
  const { f, client } = await replacementClient(t, tier);
  const watch = client.observe(q('list'), { a: 1, b: 2 }); watch.subscribe(() => {});
  t.after(async () => { watch.close(); await client.close(); });
  await until(() => watch.getSnapshot().data?.length === 2);
  await f.post('/m/transfer', { id: 'transfer', args: {} });
  assert.deepEqual((await client.query(q('list'), { b: 2, a: 1 })).data.map(r => r.id), ['B']);
  assert.deepEqual(watch.getSnapshot().data.map(r => r.id), ['B']);
});

}

for (const tier of ['online','process']) test(`Astra 4 ${tier}: asset refusal revokes existing grants and listeners; failures preserve grants`, async t => {
  const f = await fixture(t); let transport = false;
  const fetcher = (input, init) => transport && new URL(input).pathname.startsWith('/assets/') ? Promise.reject(Error('network')) : parked(input, init);
  const client = tier === 'online' ? createClient({ url: f.url, persona: 'bob', fetch: fetcher }) : await createLocalClient({ url: f.url, persona: 'bob', fetch: fetcher, device: processDevice({ dir: join(f.dir, 'device'), binary }) });
  t.after(() => client.close());
  const uploaded = await client.upload(png); assert.equal(uploaded.ok, true);
  const placed = await f.post('/m/place', { id: 'place', args: { photo: { id: uploaded.asset.id } } }, 'bob'); assert.equal(placed.state, 'sent', JSON.stringify(placed));
  const grant = await client.asset(uploaded.asset.id); assert.ok(grant.url);
  let notices = 0; onAssetRevoked(grant, () => { notices++; assert.equal(grant.url, ''); });
  transport = true; await client.asset(uploaded.asset.id); assert.equal(assetRevoked(grant), false); transport = false;
  if (tier !== 'online') await client.sync();
  await f.post('/m/remove', { id: 'remove', args: { id: placed.result.id } });
  const refused = await client.asset(uploaded.asset.id); assert.equal(refused.denied?.code, 'E_ASSET_UNKNOWN');
  assert.equal(assetRevoked(grant), true); assert.equal(grant.url, ''); assert.equal(notices, 1);
});

test('Grok: withheld reply cannot advance the retained body cut past a later changes revocation', { timeout: 15000 }, async t => {
  const f = await fixture(t), changes = gate(), sync = gate();
  let hold = false, requests = 0, withheld = false;
  const client = await createLocalClient({ url: f.url, persona: 'bob', waitSeconds: 1,
    device: { async open(...args) {
      const core = await processDevice({ dir: join(f.dir, 'device'), binary }).open(...args);
      return { ...core, async call(request, committed) {
        if (request.op === 'query' && request.name === 'secret') return { ok: { loading: true, unknown: true, tables: ['secrets', 'members'] } };
        return core.call(request, committed);
      } };
    } }, fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes') await changes.promise;
      if (hold && path === '/sync') await sync.promise;
      const response = await fetch(input, init);
      if (path !== '/q/secret') return response;
      const body = await response.json(); requests++;
      if (!hold) return Response.json({ ...body, refresh: 250 });
      withheld = true;
      return Response.json({ loading: true, seq: body.seq, tables: ['secrets', 'members'], refresh: 250 });
    } });
  const watch = client.observe(q('secret'), {}); watch.subscribe(() => {});
  t.after(async () => { changes.resolve(); sync.resolve(); watch.close(); await client.close(); });
  await client.sync(); await until(() => watch.getSnapshot().data?.body === 'secret');
  const owner = answerObservation(watch.getSnapshot()), displayedCut = owner.serverSeq;
  hold = true;
  await f.post('/m/kick', { id: 'kick', args: {} });
  await until(() => withheld && requests >= 2 && owner.presenceRefresh !== null);
  assert.equal(owner.serverSeq, displayedCut, "accepted withholding cannot recertify a displayed body");
  assert.equal(watch.getSnapshot().data?.body, 'secret', 'withholding alone carries no replacement');
  changes.resolve();
  await until(() => watch.getSnapshot().loading, 'change at the withheld cut still revokes the older body');
});

test('authoritative E_ASSET_VIEWED and HTTP transport failure preserve the already granted first view', async t => {
  const f = await fixture(t, schema.replace('photo: image <=10000\n', 'photo: image <=10000 once\n'));
  let failed = false;
  const client = createClient({ url: f.url, persona: 'bob', fetch: (input, init) => failed && new URL(input).pathname.startsWith('/assets/') ? Promise.resolve(new Response('gateway failure', { status: 503 })) : parked(input, init) });
  t.after(() => client.close());
  const uploaded = await client.upload(png); assert.equal(uploaded.ok, true);
  const placed = await f.post('/m/place', { id: 'once', args: { photo: { id: uploaded.asset.id } } }, 'bob'); assert.equal(placed.state, 'sent', JSON.stringify(placed));
  const grant = await client.asset(uploaded.asset.id); assert.ok(grant.url);
  assert.equal((await client.asset(uploaded.asset.id)).denied?.code, 'E_ASSET_VIEWED');
  assert.ok(grant.url); assert.equal(assetRevoked(grant), false);
  failed = true;
  assert.equal((await client.asset(uploaded.asset.id)).denied?.code, 'E_HTTP_RESPONSE');
  assert.ok(grant.url); grant.revoke();
});

for (const tier of ['online', 'process']) test(`${tier}: receipt after an unseen commit gap fences old authority`, { timeout: 15000 }, async t => {
  const f = await fixture(t), sync = gate(); let held = false;
  const fetcher = async (input, init) => { if (held && new URL(input).pathname === '/sync') await sync.promise; return parked(input, init); };
  const client = tier === 'online' ? createClient({ url: f.url, persona: 'bob', fetch: fetcher }) : await createLocalClient({ url: f.url, persona: 'bob', fetch: fetcher, device: processDevice({ dir: join(f.dir, 'device'), binary }) });
  const watch = client.observe(q('secret'), {}); watch.subscribe(() => {});
  t.after(async () => { sync.resolve(); watch.close(); await client.close(); });
  if (tier === 'process') await client.sync();
  await until(() => watch.getSnapshot().data?.body === 'secret');
  held = true;
  await f.post('/m/kick', { id: 'unseen-kick', args: {} });
  let receiptSnapshot;
  client.onWrite(write => { if (write.state === 'sent') receiptSnapshot = watch.getSnapshot(); });
  const write = await client.mutate(m('unrelated'), {}, { waitSeconds: 0 });
  await until(async () => (await client.write(write.id))?.state === 'sent', 'successful receipt durably received');
  receiptSnapshot ??= watch.getSnapshot();
  assert.notEqual(receiptSnapshot.data?.body, 'secret', 'a single-commit footprint cannot certify an unseen interval');
  assert.notEqual((await client.query(q('secret'), {})).data?.body, 'secret');
});

for (const tier of ['online', 'process']) test(`${tier}: public rule witnesses do not qualify as harmless profile puts`, { timeout: 15000 }, async t => {
  const f = await fixture(t, schema + `
table gates:
  enabled: bool
  read <- allow
  update <- allow
  sync public
query guarded():
  require gates['gate'].enabled = true else CLOSED
  return secrets['private']
mutation disable():
  update gates['gate'] { enabled: false }
`);
  await f.post('/seed', [
    { table: 'members', row: { id: 'bob', room: 'room', principal: 'dev:bob' } },
    { table: 'secrets', row: { id: 'private', room: 'room', body: 'secret' } },
    { table: 'gates', row: { id: 'gate', enabled: true } },
  ]);
  const sync = gate(), queries = gate(); let held = false, delivered = false;
  const fetcher = async (input, init) => {
    const path = new URL(input).pathname;
    if (held && path === '/sync') await sync.promise;
    if (held && path === '/q/guarded') await queries.promise;
    const response = await fetch(input, init);
    if (path === '/changes') { const body = await response.json(); if (held) delivered ||= body.tables.includes('gates'); return Response.json(body); }
    return response;
  };
  const client = tier === 'online' ? createClient({ url: f.url, persona: 'bob', fetch: fetcher, waitSeconds: 1 }) : await createLocalClient({ url: f.url, persona: 'bob', fetch: fetcher, waitSeconds: 1, device: processDevice({ dir: join(f.dir, 'device'), binary }) });
  const watch = client.observe(q('guarded'), {}); watch.subscribe(() => {});
  t.after(async () => { sync.resolve(); queries.resolve(); watch.close(); await client.close(); });
  if (tier === 'process') await client.sync();
  await until(() => watch.getSnapshot().data?.body === 'secret');
  held = true;
  assert.equal((await f.post('/m/disable', { id: 'disable', args: {} })).state, 'sent');
  await until(() => delivered);
  await until(() => watch.getSnapshot().loading);
  assert.notEqual(watch.getSnapshot().data?.body, 'secret');
});


for (const tier of ['online', 'process', 'wasm']) {
  test(`round 2 ${tier}: subset replacement withdraws different arguments`, async t => {
    const { f, client } = await replacementClient(t, tier);
    const matching = client.observe(q('list'), { a: 1, b: 2 }); matching.subscribe(() => {});
    const overlapping = client.observe(q('list'), { a: 2, b: 2 }); overlapping.subscribe(() => {});
    t.after(async () => { matching.close(); overlapping.close(); await client.close(); });
    await until(() => matching.getSnapshot().data?.length === 2 && overlapping.getSnapshot().data?.length === 2);
    await f.post('/m/transfer', { id: 'subset', args: {} });
    assert.deepEqual((await client.query(q('list'), { b: 2, a: 1 })).data.map(r => r.id), ['B']);
    assert.deepEqual(matching.getSnapshot().data.map(r => r.id), ['B']);
    assert.ok(!overlapping.getSnapshot().data?.some(row => row.id === 'A'), 'different arguments cannot retain A');
  });
  test(`round 2 ${tier}: null withdraws a differently shaped alias`, async t => {
    const { f, client } = await replacementClient(t, tier);
    const alias = client.observe(q('secretAlias'), {}); alias.subscribe(() => {});
    t.after(async () => { alias.close(); await client.close(); });
    await until(() => alias.getSnapshot().data?.row?.body === 'secret');
    await f.post('/m/kick', { id: 'alias-revoke', args: {} });
    assert.equal((await client.query(q('secret'), {})).data, null);
    assert.ok(!('data' in alias.getSnapshot()), 'alias must withdraw, not receive point-shaped null');
  });
}
for (const tier of ['process', 'wasm']) test(`round 2 ${tier}: remote null fences a new local alias until apply`, async t => {
  const f = await fixture(t), held = gate(); let hold = false;
  const device = tier === 'process' ? processDevice({ dir: join(f.dir, 'device'), binary })
    : webDevice({ wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() });
  const client = await createLocalClient({ url: f.url, persona: 'bob', device,
    fetch: async (input, init) => { if (hold && new URL(input).pathname === '/sync') await held.promise; return parked(input, init); } });
  t.after(async () => { held.resolve(); await client.close(); });
  await client.sync();
  assert.equal((await client.query(q('secret'), {})).data.body, 'secret');
  hold = true;
  await f.post('/m/kick', { id: 'new-alias-kick', args: {} });
  assert.equal((await client.query(q('remoteSecret'), {})).data, null);
  const answer = await client.query(q('secret'), {});
  assert.notEqual(answer.data?.body, 'secret', 'new local evaluation cannot cross remote evidence');
  hold = false; held.resolve(); await client.sync();
  assert.equal((await client.query(q('secret'), {})).data, null, 'fence recovers after apply');
});

for (const tier of ['online', 'process']) for (const order of ['old-refusal', 'old-grant']) test(`round 2 ${tier}: ${order} cannot overtake newer asset authority`, async t => {
  const f = await fixture(t, schema.replace('table photos:\n  photo:', 'table photos:\n  room: text <=40\n  photo:').replace('read <- allow\n  insert <- allow\n  delete <- allow\n  sync public', 'read <- exists members[.room, viewer]\n  insert <- allow\n  delete <- allow\n  sync to members[.room]').replace('insert photos { photo }', "insert photos { room: 'room', photo }"), true);
  const release = gate(); let mode = null, captured = false, offline = false;
  const fetcher = async (input, init) => {
    if (offline && new URL(input).pathname.startsWith('/assets/')) throw Error('offline');
    const response = await parked(input, init);
    if (mode && new URL(input).pathname.startsWith('/assets/')) { const expected = mode; mode = null;
      assert.equal(response.ok, expected === 'grant'); captured = true; await release.promise; }
    return response;
  };
  const options = { url: f.url, persona: 'bob', fetch: fetcher };
  const client = tier === 'online' ? createClient(options) : await createLocalClient({ ...options,
    assets: { keep: 'viewed', maxBytes: 10000 }, device: processDevice({ dir: join(f.dir, 'device'), binary }) });
  t.after(async () => { release.resolve(); await client.close(); });
  const uploaded = await client.upload(png); assert.equal(uploaded.ok, true);
  assert.equal((await f.post('/m/place', { id: 'place', args: { photo: { id: uploaded.asset.id } } }, 'bob')).state, 'sent');
  if (tier === 'process') await client.sync();
  if (order === 'old-refusal') await f.post('/m/kick', { id: 'kick', args: {} });
  mode = order === 'old-refusal' ? 'refusal' : 'grant';
  const old = client.asset(uploaded.asset.id); await until(() => captured);
  if (order === 'old-refusal') {
    await f.post('/m/restore', { id: 'restore', args: {} });
    if (tier === 'process') await client.sync();
    const grant = await client.asset(uploaded.asset.id); assert.ok(grant.url);
    release.resolve(); assert.equal((await old).denied?.code, 'E_ASSET_UNKNOWN');
    assert.ok(grant.url, 'older refusal cannot revoke newer authorized handle');
    if (tier === 'process') { offline = true; assert.ok((await client.asset(uploaded.asset.id)).url, 'older refusal cannot delete newer cached media'); }
  } else {
    await f.post('/m/kick', { id: 'kick', args: {} });
    assert.equal((await client.asset(uploaded.asset.id)).denied?.code, 'E_ASSET_UNKNOWN');
    release.resolve(); assert.equal((await old).denied?.code, 'E_ASSET_UNKNOWN', 'per-asset refusal must fence the older in-flight grant');
  }
});

// Round 6: admission has not evaluated row or asset authority.
// Round 7: neither a decoder diagnostic nor a transport refusal evaluated it.
// Round 9: native codes do not identify where a failure originated.
for (const tier of ['online', 'process', 'wasm']) for (const code of ['E_HTTP_RESPONSE', 'E_STORE_BUSY', 'E_OFFLINE']) test(`round 9 ${tier}: evaluated native ${code} withdraws retained authority`, { timeout: 120000 }, async t => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const f = await server(t, undefined, `use personas alice
table flags:
  read <- allow
  delete <- allow
  online only
table secrets:
  body: text
  read <- allow
  sync public
query nativeSecret(code: text): native
query secretAlias():
  return secrets['secret']
mutation revoke():
  delete flags['flag']
`, { startupTimeout: 90000, prepare(dir) {
    const native = join(dir, 'snapback/native');
    mkdirSync(join(native, 'src'), { recursive: true });
    writeFileSync(join(native, 'Cargo.toml'), readFileSync(join(root, 'native-fixtures/following/Cargo.toml'), 'utf8')
      .replace('sb4-fixture-following', 'sb4-fixture-retention-denials')
      .replace('../../crates/snapback4-native', join(root, 'crates/snapback4-native')));
    writeFileSync(join(native, 'src/lib.rs'), `use snapback4_native::{Ctx, Json, Result, Error};
snapback4_native::module! { reads: [nativeSecret] }
#[allow(non_snake_case)]
fn nativeSecret(ctx: &Ctx, args: &Json) -> Result<Json> {
    if ctx.get("flags", "flag")?.is_none() {
        return Err(Error::new(args["code"].as_str().unwrap(), "native authorization flag revoked"));
    }
    Ok(ctx.get("secrets", "secret")?.map(Json::Object).unwrap_or(Json::Null))
}
`);
    mkdirSync(join(dir, 'snapback/generated'), { recursive: true });
    mkdirSync(join(root, 'target/native-fixture'), { recursive: true });
    symlinkSync(join(root, 'target/native-fixture'), join(dir, 'snapback/generated/native-target'), 'dir');
  } });
  const post = (path, body) => fetch(f.url + path, { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: JSON.stringify(body) }).then(r => r.json());
  assert.equal((await post('/seed', [{ table: 'flags', row: { id: 'flag' } }, { table: 'secrets', row: { id: 'secret', body: 'secret' } }])).seeded, 2);
  const client = tier === 'online' ? createClient({ url: f.url, persona: 'alice', fetch: parked }) : await createLocalClient({ url: f.url, persona: 'alice', fetch: parked,
    device: tier === 'process' ? processDevice({ dir: join(f.dir, 'device'), binary }) : webDevice({ wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() }) });
  t.after(() => client.close());
  const op = q('nativeSecret'), args = { code }, watch = client.observe(op, args);
  watch.subscribe(() => {}); t.after(() => watch.close());
  await until(() => watch.getSnapshot().data?.body === 'secret');
  assert.equal((await post('/m/revoke', { id: 'revoke', args: {} })).state, 'sent');
  assert.equal(watch.getSnapshot().data?.body, 'secret', 'changes are held until direct evidence arrives');
  const read = await client.query(op, args);
  assert.equal(read.denied?.code, code);
  assert.equal(read.denied?.message, 'native authorization flag revoked');
  assert.equal(watch.getSnapshot().denied?.code, code, 'evaluated denial must replace the mounted secret before return');
  assert.equal(client.link(), 'online');
});

for (const code of ['E_HTTP_RESPONSE', 'E_STORE_BUSY', 'APP_DENIED', 'E_BOUND']) test(`round 10 process: device-evaluated ${code} replaces mounted peers without HTTP`, { timeout: 120000 }, async t => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const cutoff = Date.now() + 60_000;
  let now = cutoff - 1, httpQueries = 0, deviceDenials = 0;
  const f = await server(t, undefined, `use personas alice
table secrets:
  body: text
  read <- allow
  sync public
query nativeSecret(code: text, cutoff: time): native
`, { startupTimeout: 90000, prepare(dir) {
    const native = join(dir, 'snapback/native');
    mkdirSync(join(native, 'src'), { recursive: true });
    writeFileSync(join(native, 'Cargo.toml'), readFileSync(join(root, 'native-fixtures/following/Cargo.toml'), 'utf8')
      .replace('sb4-fixture-following', 'sb4-fixture-retention-device-denials')
      .replace('../../crates/snapback4-native', join(root, 'crates/snapback4-native')));
    writeFileSync(join(native, 'src/lib.rs'), `use snapback4_native::{Ctx, Json, Result, Error};
snapback4_native::module! { reads: [nativeSecret] }
#[allow(non_snake_case)]
fn nativeSecret(ctx: &Ctx, args: &Json) -> Result<Json> {
    if ctx.now()? >= args["cutoff"].as_i64().unwrap() {
        return Err(Error::new(args["code"].as_str().unwrap(), "native device cutoff reached"));
    }
    Ok(ctx.get("secrets", "secret")?.map(Json::Object).unwrap_or(Json::Null))
}
`);
    mkdirSync(join(dir, 'snapback/generated'), { recursive: true });
    mkdirSync(join(root, 'target/native-fixture'), { recursive: true });
    symlinkSync(join(root, 'target/native-fixture'), join(dir, 'snapback/generated/native-target'), 'dir');
  } });
  assert.equal((await fetch(f.url + '/seed', { method: 'POST', body: JSON.stringify([
    { table: 'secrets', row: { id: 'secret', body: 'secret' } },
  ]) }).then(r => r.json())).seeded, 1);
  const opener = processDevice({ dir: join(f.dir, 'device'), binary });
  const client = await createLocalClient({ url: f.url, persona: 'alice',
    device: { async open(...args) {
      const core = await opener.open(...args);
      return { ...core, async call(request, ...rest) {
        const query = request.op === 'query' && request.name === 'nativeSecret';
        const reply = await core.call(query ? { ...request, now } : request, ...rest);
        if (query && (reply.denied ?? reply.ok?.denied)?.code === code) deviceDenials++;
        return reply;
      } };
    } },
    fetch(input, init) { if (new URL(input).pathname.startsWith('/q/')) httpQueries++; return parked(input, init); },
  });
  t.after(() => client.close());
  await client.sync();
  const op = q('nativeSecret'), args = { code, cutoff };
  const watches = [undefined, false, true].map(keep => client.observe(op, args, { keep }));
  for (const watch of watches) { watch.subscribe(() => {}); t.after(() => watch.close()); }
  await until(() => watches.every(watch => watch.getSnapshot().data?.body === 'secret'));
  assert.equal(httpQueries, 0, 'the mounted secret was evaluated on the device');
  now = cutoff;
  const read = await client.query(op, args);
  assert.equal(read.denied?.code, code);
  assert.equal(read.denied?.message, 'native device cutoff reached');
  assert.ok(deviceDenials > 0, 'the actual native device returned the denial');
  assert.equal(httpQueries, 0, 'the denying call never used HTTP fallback');
  for (const watch of watches) assert.equal(watch.getSnapshot().denied?.code, code, 'device evidence replaces every policy before return');
});

for (const tier of ['online', 'process', 'wasm']) for (const failure of [200, 404, 'E_OFFLINE', 'E_STORE', 'E_STORE_BUSY', 'E_AUTH']) test(`round 7 ${tier}: ${typeof failure === 'number' ? `malformed HTTP ${failure}` : failure} preserves query authority and deadlines`, async t => {
  const f = await fixture(t); let malformed = false, offline = false, attempts = 0, aliasRequests = 0;
  const deadline = Date.now() + 60_000;
  const fetcher = async (input, init) => {
    const path = new URL(input).pathname;
    if (offline && path !== '/changes') throw Error('round 7 offline');
    if (path === '/q/secretAlias') aliasRequests++;
    if (path !== '/q/remoteSecret') return parked(input, init);
    attempts++;
    if (malformed) return typeof failure === 'number' ? new Response('{broken', { status: failure })
      : Response.json({ denied: { code: failure, family: failure === 'E_AUTH' ? 'auth' : failure === 'E_OFFLINE' ? 'link' : 'store', message: 'not evaluated', retryable: failure !== 'E_STORE_BUSY' } }, { status: 503 });
    const response = await fetch(input, init);
    return Response.json({ ...await response.json(), nextExpiry: deadline, refresh: 50 });
  };
  const client = tier === 'online' ? createClient({ url: f.url, persona: 'bob', fetch: fetcher }) : await createLocalClient({ url: f.url, persona: 'bob', fetch: fetcher,
    device: tier === 'process' ? processDevice({ dir: join(f.dir, 'device'), binary }) : webDevice({ wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() }) });
  t.after(() => client.close());
  if (tier !== 'online') await client.sync();
  const watch = client.observe(q('remoteSecret'), {}); watch.subscribe(() => {}); t.after(() => watch.close());
  await until(() => watch.getSnapshot().data?.body === 'secret');
  const owner = answerObservation(watch.getSnapshot()), deadlines = { ...owner.deadlines };
  assert.equal(deadlines.server, deadline);
  const snapshots = []; watch.subscribe(() => snapshots.push(watch.getSnapshot()));
  malformed = true;
  const read = await client.query(q('remoteSecret'), {});
  const code = typeof failure === 'number' ? 'E_HTTP_RESPONSE' : failure;
  assert.equal(read.denied?.code, code);
  if (typeof failure === 'number') assert.match(read.denied.message, new RegExp(`HTTP ${failure}`));
  assert.equal(client.link(), 'online', 'delivered refusal keeps FU link semantics');
  assert.equal(watch.getSnapshot().data?.body, 'secret', 'decoder failure is not replacement evidence');
  assert.deepEqual(owner.deadlines, deadlines, 'direct failure preserves the original deadlines');
  // A new opted-out owner receives its diagnostic without withdrawing its peer.
  const optOut = client.observe(q('remoteSecret'), {}, { keep: false }); optOut.subscribe(() => {}); t.after(() => optOut.close());
  await until(() => optOut.getSnapshot().denied?.code === code);
  const beforeRefresh = attempts;
  await until(() => attempts > beforeRefresh && watch.getSnapshot().revalidating, 'mounted background refresh attempted');
  assert.equal(watch.getSnapshot().data?.body, 'secret');
  assert.deepEqual(owner.deadlines, deadlines, 'background failure preserves the original deadlines');
  assert.ok(snapshots.every(read => read.data?.body === 'secret'), 'no loading or denied publication after data');
  optOut.close();
  if (tier !== 'online') {
    assert.equal((await client.query(q('secretAlias'), {})).data?.row?.body, 'secret');
    assert.equal(aliasRequests, 0, 'decoder failure installed no replica fence');
    offline = true;
    assert.equal((await client.query(q('remoteSecret'), {})).data?.body, 'secret', 'decoder failure did not delete remembered data');
  }
});

for (const tier of ['online', 'process', 'wasm']) for (const kind of ['asset', 'query']) test(`combined ${tier}: ${kind} overload preserves authority until real evidence`, async t => {
  const f = await fixture(t); let overload = false, attempts = 0;
  const why = { code: 'E_RATE_LIMIT', family: 'limit', message: 'busy', retryable: true };
  const fetcher = (input, init) => {
    const path = new URL(input).pathname;
    if (overload && (kind === 'asset' ? path.startsWith('/assets/') : path === '/q/remoteSecret')) {
      attempts++; return Promise.resolve(Response.json({ denied: why }, { status: 503, headers: { 'Retry-After': '11' } }));
    }
    return parked(input, init);
  };
  const client = tier === 'online' ? createClient({ url: f.url, persona: 'bob', fetch: fetcher }) : await createLocalClient({ url: f.url, persona: 'bob', fetch: fetcher,
    assets: { keep: 'viewed', maxBytes: 10000 }, device: tier === 'process' ? processDevice({ dir: join(f.dir, 'device'), binary }) : webDevice({ wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() }) });
  t.after(() => client.close());
  if (kind === 'query') {
    const watch = client.observe(q('remoteSecret'), {}); watch.subscribe(() => {}); t.after(() => watch.close());
    await until(() => watch.getSnapshot().data?.body === 'secret');
    overload = true;
    assert.deepEqual((await client.query(q('remoteSecret'), {})).denied, why);
    assert.equal(client.link(), 'online');
    assert.equal(watch.getSnapshot().data?.body, 'secret', 'admission did not evaluate authority');
    overload = false;
    await f.post('/m/kick', { id: 'kick', args: {} });
    assert.equal((await client.query(q('remoteSecret'), {})).data, null);
    assert.equal(watch.getSnapshot().data, null, 'real authority still reconciles');
    return;
  }
  const uploaded = await client.upload(png); assert.equal(uploaded.ok, true);
  const placed = await f.post('/m/place', { id: 'place', args: { photo: { id: uploaded.asset.id } } }, 'bob'); assert.equal(placed.state, 'sent');
  if (tier !== 'online') await client.sync();
  const grant = await client.asset(uploaded.asset.id); assert.ok(grant.url);
  let notices = 0; onAssetRevoked(grant, () => { notices++; assert.equal(grant.url, ''); });
  overload = true;
  assert.deepEqual((await client.asset(uploaded.asset.id)).denied, why);
  assert.equal(attempts, 1); assert.equal(client.link(), 'online');
  assert.ok(grant.url); assert.equal(assetRevoked(grant), false); assert.equal(notices, 0);
  overload = false;
  await f.post('/m/remove', { id: 'remove', args: { id: placed.result.id } });
  assert.equal((await client.asset(uploaded.asset.id)).denied?.code, 'E_ASSET_UNKNOWN');
  assert.equal(assetRevoked(grant), true); assert.equal(notices, 1);
});
