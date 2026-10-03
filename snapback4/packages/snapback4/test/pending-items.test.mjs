import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitFor } from './helpers/wait.mjs';
import { createMockClient } from '../dist/mock.js';
import { createLocalClient } from '../dist/local.js';
import { createClient, mintId } from '../dist/client.js';
import { processDevice } from '../dist/native.js';
import { memoryPersistence, webDevice } from '../dist/web.js';
import { prepareClient } from '../dist/client-start.js';
import { guardClient } from '../dist/app-client.js';
import { pendingItems, pendingState, pendingIntentAccess, registerPendingIntents, observeIntents } from '../dist/pending-items.js';
import { pendingItemsSource } from '../dist/react-pending-items.js';
import { registerLocalPendingIntents } from '../dist/pending-writes.js';
import { WriteHistory } from '../dist/writes.js';

const binary = process.env.SNAPBACK4_BIN ?? new URL('../../../target/debug/snapback4', import.meta.url).pathname;
const wasm = readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url));
const op = name => ({ kind: 'mutation', name });
const query = name => ({ kind: 'query', name });
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const send = op('send'), media = op('sendMedia'), set = op('set');
const schema = `use personas alice, bob
 table unused:
  value: text
  public 'fixture'
  insert <- allow
  online only
`.replace(' table', 'table') + `table messages:
  conversation: text
  text: text
  photo: image <=10000000 ?
  public 'fixture'
  insert <- allow
  sync public
mutation send(id: id, conversation: text, text: text):
  return insert messages { id, conversation, text, photo: null }
mutation sendMedia(id: id, conversation: text, text: text, photo: image <=10000000 ?):
  return insert messages { id, conversation, text, photo }
mutation noPrediction(id: id, text: text):
  return insert unused { id, value: text }
mutation refuse():
  require false else NO
query messages():
  return messages[] first 100 by byId
`;
async function fixture(t, tier) {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-pending-items-'));
  mkdirSync(join(dir, 'snapback')); writeFileSync(join(dir, 'snapback/schema.q'), schema);
  let server = spawn(binary, ['dev', '--port', '0', '--no-watch'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = once(server, 'exit'); let log = '', url;
  for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { log += chunk; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  const clients = [], cores = [], gates = [], posts = [];
  let offline = false, gateWrites = true, blockSync = false;
  const persistence = memoryPersistence();
  const opener = tier === 'process' ? processDevice({ dir: join(dir, 'devices'), binary }) : webDevice({ wasm, persist: persistence });
  const device = { async open(...args) { const core = await opener.open(...args); cores.push(core); return core; } };
  t.after(async () => { for (const c of clients) await c.close(); server.kill(); await exited; rmSync(dir, { recursive: true, force: true }); });
  await waitFor(() => { if (server.exitCode != null) throw Error(log); return url; }, 'server startup');
  const transport = async (input, init) => {
    const path = new URL(input).pathname;
    if (offline || blockSync && path === '/sync') throw new TypeError('offline');
    if (path.startsWith('/m/')) {
      posts.push(JSON.parse(init.body));
      if (gateWrites) { const gate = deferred(); gates.push({ ...gate, input, init }); return gate.promise; }
    }
    return fetch(input, init);
  };
  const open = async (prepared = false, persona = 'alice') => {
    const options = { url, persona, fetch: transport, device };
    const opening = await prepareClient(options, () => tier === 'online' ? createClient(options) : createLocalClient(options));
    clients.push(opening.client);
    if (!prepared) { await opening.start(); if (tier !== 'online') await opening.client.sync(); }
    return opening;
  };
  return { open, cores, posts, gates, async replaceBackend() {
    server.kill(); await exited;
    server = spawn(binary, ['dev', '--fresh', '--port', new URL(url).port, '--no-watch'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    exited = once(server, 'exit'); let ready = false, output = '';
    for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { output += chunk; ready ||= /http:\/\/127\.0\.0\.1:\d+/.test(output); });
    await waitFor(() => { if (server.exitCode != null) throw Error(output); return ready; }, 'replacement server');
  }, offline(v) { offline = v; }, blockSync(v) { blockSync = v; }, pass() { gateWrites = false; },
    async release(index) { const gate = gates[index]; gate.resolve(await fetch(gate.input, gate.init)); } };
}
const list = client => pendingIntentAccess(client).read();
const options = rows => ({ writes: [send, media], scope: w => w.args.conversation === 'a', rows, rowKey: r => r.id, intentKey: w => w.args.id });

for (const tier of ['process', 'wasm']) {
  test(`${tier}: reply before sync, refused tail, media, and observed retirement keep sole FIFO custody`, async t => {
    const f = await fixture(t, tier), { client } = await f.open();
    const source = pendingItemsSource(client), stop = source.subscribe(() => {}); t.after(stop);
    const ids = [mintId(), mintId(), mintId()], row = mintId();
    await client.mutate(send, { id: row, conversation: 'a', text: 'text' }, { id: ids[0], waitSeconds: 0 });
    await waitFor(() => f.gates.length === 1, 'first dispatch');
    const asset = await client.upload(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64")); assert.equal(asset.ok, true);
    await client.mutate(media, { id: mintId(), conversation: 'a', text: 'photo', photo: { id: asset.asset.id } }, { id: ids[1], waitSeconds: 0 });
    await client.mutate(op('refuse'), {}, { id: ids[2], waitSeconds: 0 });
    assert.deepEqual((await list(client)).map(i => i.write.id), ids);
    assert.equal(pendingItems(await list(client), options([{ id: row, pending: true }])).filter(i => i.kind === 'intent').length, 1, 'predicted duplicate suppressed, media still shown');
    assert.equal(pendingItems(await list(client), options([])).filter(i => i.kind === 'intent').length, 2, 'withdrawn prediction reappears as intent');
    assert.equal(pendingItems(await list(client), options([{ id: row, pending: true }])).filter(i => i.kind === 'intent').length, 1, 'reappearing prediction suppresses the same intent again');
    f.blockSync(true);
    await f.release(0); await waitFor(() => f.gates.length === 2, 'media follows terminal text without intermediate sync');
    await f.release(1); await waitFor(() => f.gates.length === 3, 'refused tail dispatched'); await f.release(2);
    await waitFor(async () => (await client.write(ids[2]))?.state === 'failed', 'refused tail');
    assert.deepEqual(await client.pendingWrites(), [], 'public list cannot represent settlement');
    await waitFor(() => source.getSnapshot().length === 2 && source.getSnapshot().every(i => i.phase === 'settling'), 'presentation retains unobserved successes');
    assert.deepEqual(source.getSnapshot().map(i => i.write.id), ids.slice(0, 2));
    assert.equal(source.getSnapshot()[1].write.args.photo.id, asset.asset.id);
    assert.equal('url' in source.getSnapshot()[1].write.args.photo, false, 'arguments are not media handles');
    assert.equal(source.getSnapshot()[0].write.id === row, false, 'write and row identities are distinct');
    // No presentation-owned send, prediction, receipt accounting, or retirement.
    assert.deepEqual(f.posts.map(p => p.id), ids);
    f.blockSync(false); await client.sync();
    await waitFor(async () => (await list(client)).length === 0, 'existing observed-write retirement');
    const rows = await client.query(query('messages'), {});
    assert.equal(rows.data.length, 2); assert.ok(rows.data.every(row => !row.pending));
  });

  test(`${tier}: offline restart preserves no-prediction and successful-unobserved facts; accounts stay separate`, async t => {
    const f = await fixture(t, tier), { client } = await f.open();
    const first = await client.mutate(op('noPrediction'), { id: mintId(), text: 'private' }, { waitSeconds: 0 });
    await waitFor(() => f.gates.length === 1, 'dispatch');
    assert.deepEqual((await list(client))[0].write.predicted, []);
    f.blockSync(true); await f.release(0);
    await waitFor(async () => (await list(client))[0]?.phase === 'settling', 'terminal interval');
    const second = await client.mutate(op('noPrediction'), { id: mintId(), text: 'unknown' }, { waitSeconds: 0 });
    await waitFor(() => f.gates.length === 2, 'unknown second dispatch');
    f.offline(true); await client.close();
    const reopened = await f.open(true);
    assert.equal((await list(reopened.client))[0].write.id, first.id);
    assert.equal((await list(reopened.client))[0].phase, 'settling');
    assert.equal((await list(reopened.client))[1].phase, 'unknown');
    assert.equal((await list(reopened.client))[1].write.id, second.id);
    f.offline(false); const other = await f.open(true, 'bob');
    assert.deepEqual(await list(other.client), []);
    await reopened.client.signOut(); assert.deepEqual(await list(reopened.client), []);
  });
}

test('latest set-state is FIFO, not lexical ID order; saving never overrides custody; no query rows are invented', () => {
  const writes = [true, false, true].map((value, n) => ({ phase: n === 2 ? 'saving' : 'queued', write: { id: String(3 - n), op: 'set', args: { resource: 'a', value }, state: 'queued', predicted: [] } }));
  const selected = pendingState(writes, set, { scope: w => w.args.resource === 'a', current: true, value: a => a.value });
  assert.equal(selected.value, false); assert.equal(selected.intent.write.id, '2');
  assert.equal(pendingState(writes, set, { scope: w => w.args.resource === 'b', current: true, value: a => a.value }).intent, undefined);
  const rows = [{ id: 'original', ordinal: 5 }];
  const combined = pendingItems([{ ...writes[0], write: { ...writes[0].write, op: 'send', args: { id: 'x', conversation: 'a' } } }], options(rows));
  assert.equal(combined[0].row, rows[0]); assert.equal('ordinal' in combined[1], false); assert.equal('row' in combined[1], false);
});

test('receipt before admission release wins; read-only receipt view does not resave; terminal refusal retires', async () => {
  const history = new WriteHistory(); const receipt = { state: 'sent', id: 'a', seq: 7 }; history.remember(receipt);
  const client = {}, waiting = { pending: () => [{ id: 'a', op: 'send', args: { secret: 'a' }, predicted: [], state: 'held' }] };
  let entries = [], scope = 'a';
  registerLocalPendingIntents(client, async () => entries, history, waiting, { reasons: async () => new Map() }, () => scope, () => true);
  assert.deepEqual(await list(client), [], 'released outbox receipt suppresses still-saving caller');
  const saving = {};
  registerLocalPendingIntents(saving, async () => [], new WriteHistory(), waiting, { reasons: async () => new Map() }, () => scope, () => false);
  assert.equal((await list(saving))[0].phase, 'saving', 'identification is not custody');
  entries = [{ id: 'a', op: 'send', args: {}, predicted: [], seq: 1 }];
  assert.equal((await list(client))[0].phase, 'settling');
  history.remember({ state: 'failed', id: 'a', why: { code: 'NO', family: 'input', message: 'no' } });
  assert.deepEqual(await list(client), []);
  history.remember({ state: 'pending', id: 'b' });
  assert.equal((await history.presentationReceipts()).has('b'), false);
});

test('source snapshots fence synchronously, reject late reads and share subscription through remount', async () => {
  const listeners = new Set(), gate = deferred(); let scope = 'alice:A', reads = 0;
  const raw = { viewer: () => 'alice', onLink: () => () => {}, onSession: () => () => {}, onViewer: () => () => {}, onPendingWrites: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
  const intent = { phase: 'queued', write: { id: 'x', op: 'send', args: { secret: true }, predicted: [], state: 'queued' } };
  registerPendingIntents(raw, { scope: () => scope, read: async () => ++reads === 2 ? gate.promise : [intent] });
  const source = pendingItemsSource(raw); assert.equal(source, pendingItemsSource(raw));
  const a = source.subscribe(() => {}), b = source.subscribe(() => {});
  await waitFor(() => source.getSnapshot().length === 1, 'first snapshot'); assert.equal(listeners.size, 1);
  listeners.forEach(f => f()); scope = 'bob:B';
  assert.deepEqual(source.getSnapshot(), [], 'retired arguments hidden even before callback or failed refresh');
  gate.resolve([intent]); await new Promise(r => setImmediate(r)); assert.deepEqual(source.getSnapshot(), []);
  a(); b(); assert.equal(listeners.size, 0);
  scope = undefined; const c = source.subscribe(() => {}); assert.deepEqual(source.getSnapshot(), []); c();
});

test('facade retirement exposes zero arguments while its authority check is pending', async () => {
  const gate = deferred(), listeners = new Set(); let valid = true;
  const raw = { viewer: () => 'alice', onLink: () => () => {}, onSession: () => () => {}, onViewer: () => () => {}, onPendingWrites: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
  registerPendingIntents(raw, { scope: () => 'alice:A', read: async () => [{ phase: 'queued', write: { args: { secret: true } } }] });
  const guarded = guardClient(raw, () => gate.promise, () => valid, () => ({ code: 'E_AUTH' }));
  const reading = list(guarded.client); valid = false; guarded.fence()(); gate.resolve(true);
  assert.deepEqual(await reading, []); assert.equal(pendingIntentAccess(guarded.client).scope(), undefined);
});

test('online: late-mounted presentation covers terminal-to-row interval without changing the pending list', async t => {
  const f = await fixture(t, 'online'), { client } = await f.open();
  const write = await client.mutate(send, { id: mintId(), conversation: 'a', text: 'online' }, { waitSeconds: 0 });
  await waitFor(() => f.gates.length, 'dispatch'); await f.release(0);
  await waitFor(async () => (await list(client))[0]?.phase === 'settling', 'success view');
  assert.deepEqual(await client.pendingWrites(), []);
  observeIntents(client, [write.id]); assert.deepEqual(await list(client), []);
  assert.equal(f.posts.length, 1);
});

for (const tier of ['process', 'wasm']) test(`${tier}: backend replacement retires success arguments before publishing a new scope`, async t => {
  const f = await fixture(t, tier), { client } = await f.open();
  const source = pendingItemsSource(client), stop = source.subscribe(() => {}); t.after(stop);
  const write = await client.mutate(send, { id: mintId(), conversation: 'a', text: 'old backend secret' }, { waitSeconds: 0 });
  await waitFor(() => f.gates.length, 'dispatch'); f.blockSync(true); await f.release(0);
  await waitFor(() => source.getSnapshot()[0]?.phase === 'settling', 'settling old store');
  const oldScope = pendingIntentAccess(client).scope();
  let crossed = false;
  const off = client.onPendingWrites(() => {
    if (pendingIntentAccess(client).scope() !== oldScope) {
      crossed = true; assert.deepEqual(source.getSnapshot(), [], 'old snapshot is inaccessible at reset notification');
    }
  }); t.after(off);
  await f.replaceBackend(); f.blockSync(false); await client.sync();
  await waitFor(() => crossed, 'scope retirement notification');
  assert.deepEqual(await list(client), []);
  assert.equal((await client.write(write.id))?.state, 'sent', 'known success remains receipt truth');
  assert.equal(f.posts.length, 1, 'presentation never resends a retired success');
});

test('a failed presentation read retains same-scope facts but cannot cross retirement; no receipt save occurs', async () => {
  let scope = 'first', fail = false, writes = 0;
  const history = new WriteHistory({ read: async () => { if (fail) throw Error('read failed'); return null; }, save: async () => { writes++; } });
  const listeners = new Set();
  const client = { onLink: () => () => {}, onSession: () => () => {}, onViewer: () => () => {}, onPendingWrites: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
  registerLocalPendingIntents(client, async () => [{ id: 'one', op: 'send', args: { secret: true }, predicted: [] }], history,
    { pending: () => [] }, { reasons: async () => new Map() }, () => scope, () => true);
  const source = pendingItemsSource(client), stop = source.subscribe(() => {});
  try {
    await waitFor(() => source.getSnapshot().length, 'initial read');
    fail = true; listeners.forEach(fn => fn()); await new Promise(r => setImmediate(r));
    assert.equal(source.getSnapshot().length, 1);
    scope = 'next'; assert.deepEqual(source.getSnapshot(), []);
    listeners.forEach(fn => fn()); await new Promise(r => setImmediate(r)); assert.deepEqual(source.getSnapshot(), []);
    assert.equal(writes, 0, 'presentation never refreshes or persists receipts');
  } finally { stop(); }
});

test('only a store-qualified observed sequence proves success; legacy/mismatched acknowledgement stays unknown', async () => {
  const client = {}, entry = { id: 'x', op: 'send', args: {}, predicted: [], observed_seq: 7 };
  registerLocalPendingIntents(client, async () => [entry], new WriteHistory(), { pending: () => [] },
    { reasons: async () => new Map() }, () => 'live', () => true);
  assert.equal((await list(client))[0].phase, 'unknown');
  entry.receipt_store = { success_seq: 6 }; assert.equal((await list(client))[0].phase, 'unknown');
  entry.dispatch = 'E_AUTH_RETRY'; assert.equal((await list(client))[0].phase, 'held');
  assert.equal((await list(client))[0].write.reason, 'E_AUTH_RETRY');
  entry.receipt_store.success_seq = 7; assert.equal((await list(client))[0].phase, 'settling');
  assert.deepEqual((await list(client))[0].receipt, { state: 'sent', id: 'x', seq: 7, replayed: true });
});

test('mock close also fences the current presentation synchronously', async () => {
  const client = createMockClient({ viewer: 'alice', link: 'offline', tables: {}, ops: { queries: {}, mutations: { send: () => [] } } });
  await client.mutate(send, { secret: 'mock' }, { waitSeconds: 0 });
  const source = pendingItemsSource(client), stop = source.subscribe(() => {});
  try {
    await waitFor(() => source.getSnapshot().length, 'mock custody');
    const closed = client.close(); assert.deepEqual(source.getSnapshot(), []); await closed;
  } finally { stop(); }
});
