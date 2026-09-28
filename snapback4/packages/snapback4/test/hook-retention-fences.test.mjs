// @ref LLP 3000.029#7 — Astra's five adversarial checks, with real HTTP/device paths.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
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
  delete <- allow
  sync to members[.room]
table secrets:
  room: text <=40
  body: text
  read <- exists members[.room, viewer]
  sync to members[.room]
query secret():
  return secrets['private']
mutation kick():
  delete members[room = 'room', principal = 'dev:bob']
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
    ...['alice','bob'].map(p => ({ table: 'members', row: { id: p, room: 'room', principal: 'dev:' + p } })),
    { table: 'secrets', row: { id: 'private', room: 'room', body: 'secret' } },
    ...['A','B'].map(id => ({ table: 'own', row: { id, owner: 'dev:bob', body: id } })),
  ])).seeded, 5);
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
  assert.equal((await client.asset(uploaded.asset.id)).denied?.code, 'E_OFFLINE');
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
