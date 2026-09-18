// Whole-commit overflow through the real HTTP server, client, and both stores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { webDevice, memoryPersistence } from '../dist/web.js';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
const wasm = readFileSync(join(root, 'packages/snapback4/src/wasm/snapback4_device_bg.wasm'));
const source = `use personas alice
table members:
  room: text <=40
  principal: principal
  unique byRoomPrincipal: room, principal
  by byPrincipal: principal, room
  immutable room, principal
  read <- allow
  delete <- allow
  sync public
table history:
  room: text <=40
  body: text <=40
  by byRoom: room, id
  read <- exists members[.room, viewer]
  retain delivered-history
  sync to members[.room]
table items:
  body: text <=400000
  read <- allow
  sync public last 45 by byId
table held:
  body: text <=40
  read <- allow
  sync public last 2 by byId
query heldRows():
  return held last 10 by byId
query retained():
  return history['left'] first 10 by byRoom
query marker():
  return 1
query item(id: id):
  return items[id]
mutation leave():
  delete members['member']
`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  for (let i = 0; i < 1000; i++) { if (await check()) return; await pause(20); }
  assert.fail(message);
}
async function fixture(t, tier) {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-oversized-'));
  mkdirSync(join(dir, 'snapback'));
  writeFileSync(join(dir, 'snapback/schema.q'), source);
  const child = spawn(binary, ['dev', '--port', '0', ...(process.env.SB4_FILE_SERVER ? [] : ['--fresh'])], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = once(child, 'exit');
  let log = '', url, client, core, offline = false, intercept, backendRequired = false, snapshotRequired = false;
  child.stdout.on('data', b => { log += b; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  child.stderr.on('data', b => { log += b; });
  t.after(async () => {
    await client?.close();
    if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM');
    await exit; rmSync(dir, { recursive: true, force: true });
  });
  await until(() => { assert.equal(child.exitCode, null, log); return url; }, 'server startup');
  const post = async (path, body) => fetch(url + path, { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: JSON.stringify(body) }).then(r => r.json());
  const seed = async rows => assert.equal((await post('/seed', rows)).seeded, rows.length);
  await seed([
    { table: 'held', row: { id: 'p1', body: 'first' } },
    { table: 'held', row: { id: 'p2', body: 'second' } },
    { table: 'members', row: { id: 'member', room: 'left', principal: 'dev:alice' } },
    { table: 'history', row: { id: 'retained', room: 'left', body: 'keep this delivered history' } },
  ]);
  const opener = tier === 'wasm' ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, 'device') });
  const requests = [], replies = [], calls = [];
  const openClient = () => createLocalClient({ url, persona: 'alice', waitSeconds: 1,
    device: { open: async (...args) => {
      core = await opener.open(...args);
      return { close: () => core.close(), call: async request => { calls.push(request); const result = await core.call(request); if (request.op === 'sync_state' && result.ok) { if (backendRequired) result.ok.backend_required = true; if (snapshotRequired) result.ok.snapshot_required = true; } return result; } };
    } },
    fetch: async (input, init) => {
      if (offline) throw new TypeError('offline fixture');
      // Keep background polls inert; explicit client.sync drives each round.
      if (new URL(input).pathname === '/changes') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('closed')), { once: true }));
      const path = new URL(input).pathname;
      const body = init.body ? JSON.parse(init.body) : undefined;
      const response = await intercept?.(path, body, () => fetch(input, init)) ?? await fetch(input, init);
      if (path !== '/sync') return response;
      requests.push(body);
      const page = await response.clone().json(); replies.push(page);
      return response;
    },
  });
  client = await openClient();
  assert.equal((await post('/m/leave', { id: 'leave', args: {} })).state, 'sent');
  await client.sync();
  const before = (await core.call({ op: 'sync_state' })).ok;
  offline = true;
  assert.equal((await client.query({ kind: 'query', name: 'retained' }, {})).data?.[0]?.body, 'keep this delivered history');
  return { get client() { return client; }, get core() { return core; }, requests, replies, calls, before, seed, post, dir, url,
    reopen: async () => { await client.close(); client = await openClient(); },
    intercept: handler => { intercept = handler; },
    requireBackend: () => { backendRequired = true; },
    requireSnapshot: () => { snapshotRequired = true; },
    online: () => { offline = false; requests.length = 0; replies.length = 0; calls.length = 0; },
    adopt: async () => {
      const head = (await post('/sync', { metadata: true })).watermark;
      writeFileSync(join(dir, 'snapback/schema.q'), source.replace('return 1', 'return 2'));
      await until(async () => (await fetch(url + '/schema', { headers: { 'x-snapback-persona': 'alice' } }).then(r => r.json())).generation > before.generation, 'generation change');
      assert.equal((await post('/sync', { metadata: true })).watermark, head, 'program adoption preserves the global commit cursor');
    },
  };
}

for (const tier of ['wasm', 'process']) for (const changed of [true, false]) test(`${tier}: an enlarged whole commit recovers ${changed ? 'across a generation' : 'by snapshot in the same generation'}`, { timeout: 120000 }, async t => {
  const f = await fixture(t, tier);
  const rows = Array.from({ length: 48 }, (_, i) => ({ table: 'items', row: { id: `wide-${String(i).padStart(2, '0')}`, body: 'small' } }));
  await f.seed(rows); // One initially deliverable commit, unseen by the device.
  const small = await f.post('/sync', { from: f.before.watermark, limit: 1 });
  assert.equal(small.events.length, 48);
  assert.ok(Buffer.byteLength(JSON.stringify(small)) < 16 * 1024 * 1024);
  for (let i = 0; i < rows.length; i += 4) await f.seed(rows.slice(i, i + 4).map(({ table, row }) => ({ table, row: { ...row, body: 'PRIVATE-COMMIT-CONTENT:'.padEnd(400000, 'x') } })));
  if (changed) await f.adopt();
  const refused = await f.post('/sync', { from: f.before.watermark, limit: 1 });
  assert.equal(refused.denied?.code, 'E_BOUND');
  assert.ok(JSON.stringify(refused).length < 1000);
  assert.ok(!JSON.stringify(refused).includes('PRIVATE-COMMIT-CONTENT'));
  assert.equal(refused.events, undefined);
  assert.equal(refused.store_id, undefined);
  assert.equal(refused.generation, undefined);
  const metadata = await f.post('/sync', { metadata: true });
  assert.deepEqual(Object.keys(metadata).sort(), ['generation', 'metadata', 'store_id', 'watermark']);
  assert.ok(JSON.stringify(metadata).length < 200);
  const recovery = await f.post('/sync', { metadata: true, recover: true, store_id: metadata.store_id, generation: metadata.generation, from: f.before.watermark, limit: 1 });
  assert.deepEqual(recovery.recovery, { from: f.before.watermark, snapshot: true });
  assert.deepEqual(Object.keys(recovery).sort(), ['generation', 'metadata', 'recovery', 'store_id', 'watermark']);
  assert.ok(JSON.stringify(recovery).length < 300, 'recovery reveals no rows or historical keys');
  const caughtUp = await f.post('/sync', { metadata: true, recover: true, store_id: metadata.store_id, generation: metadata.generation, from: metadata.watermark, limit: 1 });
  assert.deepEqual(caughtUp.recovery, { from: metadata.watermark, snapshot: false }, 'the same store only grants recovery at an oversized position');
  assert.equal((await f.post('/sync', { metadata: true, store_id: 'another-store' })).denied?.code, 'E_INPUT');
  const unauthenticated = await fetch(f.url + '/sync', { method: 'POST', body: '{"metadata":true}' });
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).store_id, undefined);
  if (!changed) f.intercept((path, request) => {
    if (path === '/sync' && !request.metadata && request.from === 0 && !request.stream) throw new TypeError('interrupted recovery snapshot');
  });
  f.online(); await f.client.sync();
  if (!changed) {
    const interrupted = (await f.core.call({ op: 'sync_state' })).ok;
    assert.equal(interrupted.snapshot_required, true);
    assert.equal(interrupted.acquired, false);
    assert.equal(interrupted.watermark, f.before.watermark);
    assert.equal(f.client.acquired, false);
    await f.reopen();
    assert.deepEqual((await f.core.call({ op: 'sync_state' })).ok, interrupted, 'recovery obligation survives reopening the real device');
    assert.equal(f.client.acquired, false);
    f.intercept(undefined);
    await f.client.sync();
  }
  const after = (await f.core.call({ op: 'sync_state' })).ok;
  t.diagnostic(JSON.stringify({ tier, beforeGeneration: f.before.generation, afterGeneration: after.generation,
    limits: f.requests.filter(r => !r.metadata).map(r => r.limit), refusal: refused,
    snapshots: f.replies.filter(r => r.snapshot).length, watermark: after.watermark }));
  if (changed) assert.ok(after.generation > f.before.generation, 'device must learn the hidden generation and reacquire');
  else assert.equal(after.generation, f.before.generation);
  assert.ok(after.watermark > f.before.watermark);
  assert.equal(after.watermark, metadata.watermark, 'discovery must not skip the real acquisition');
  assert.equal(after.acquired, true);
  assert.ok(f.replies.some(r => r.snapshot));
  assert.ok(f.calls.some(r => r.op === 'apply' && r.page.acquisitions?.some(m => m.floor && m.floor !== 'whole')));
  const retained = await f.client.query({ kind: 'query', name: 'retained' }, {});
  // Program-only adoption's existing reset policy is a separate open ticket.
  if (changed) assert.deepEqual(retained.data, []);
  else assert.equal(retained.data?.[0]?.body, 'keep this delivered history');
  const row = (await f.core.call({ op: 'query', name: 'item', viewer: 'dev:alice', args: { id: 'wide-47' }, now: Date.now() })).ok;
  assert.equal(row.data?.body.length, 400000);
  const outside = (await f.core.call({ op: 'query', name: 'item', viewer: 'dev:alice', args: { id: 'wide-00' }, now: Date.now() })).ok;
  assert.equal(outside.data, null, 'snapshot recovery keeps the horizon boundary');
});

for (const tier of ['wasm', 'process']) test(`${tier}: many ordinary commits recover by halving without snapshot`, { timeout: 120000 }, async t => {
  const f = await fixture(t, tier);
  for (let i = 0; i < 48; i++) await f.seed([{ table: 'items', row: { id: `ordinary-${i}`, body: 'x'.repeat(400000) } }]);
  f.online(); await f.client.sync();
  const after = (await f.core.call({ op: 'sync_state' })).ok;
  assert.equal(after.generation, f.before.generation);
  assert.equal(after.watermark, (await f.post('/sync', { metadata: true })).watermark);
  assert.ok(f.replies.some(r => r.denied?.code === 'E_BOUND'));
  assert.ok(f.requests.some(r => r.metadata));
  assert.ok(f.requests.some(r => r.limit < 4000));
  assert.ok(f.requests.every(r => r.metadata || r.from > 0));
  assert.ok(f.replies.every(r => !r.snapshot));
  const row = (await f.core.call({ op: 'query', name: 'item', viewer: 'dev:alice', args: { id: 'ordinary-47' }, now: Date.now() })).ok;
  assert.equal(row.data?.body.length, 400000);
  assert.equal((await f.client.query({ kind: 'query', name: 'retained' }, {})).data[0].body, 'keep this delivered history');
});

const bound = { denied: { code: 'E_BOUND', family: 'bound', message: 'the HTTP JSON response exceeds 16 MiB; request a smaller page or return fewer values' } };
for (const tier of ['wasm', 'process']) for (const restore of [true, false]) test(`${tier}: older-generation metadata ${restore ? 'with a lower head stays obsolete' : 'cannot adopt a stale generation'}`, async t => {
  const f = await fixture(t, tier);
  await f.adopt();
  f.online(); await f.client.sync();
  const before = (await f.core.call({ op: 'sync_state' })).ok;
  assert.equal(before.generation, 2);
  f.intercept(async (path, request, send) => {
    if (path !== '/sync') return;
    if (!request.metadata) return Response.json(bound);
    const metadata = await send().then(r => r.json());
    return Response.json({ ...metadata, generation: 1, watermark: before.watermark - (restore ? 1 : 0) });
  });
  f.online(); await f.client.sync();
  const after = (await f.core.call({ op: 'sync_state' })).ok;
  assert.equal(after.store_id, before.store_id);
  assert.equal(after.watermark, before.watermark);
  assert.equal(after.generation, before.generation);
  assert.equal(after.restore_refusal, undefined);
  assert.equal(after.acquired, true);
  assert.ok(f.calls.every(r => r.op !== 'adopt' && r.op !== 'observe_store' && r.op !== 'apply'));
});
for (const tier of ['wasm', 'process']) for (const fault of ['unchanged', 'generic', 'foreign']) test(`${tier}: ${fault} metadata after bare refusals preserves held rows outside the horizon`, async t => {
  const f = await fixture(t, tier);
  await f.seed([{ table: 'held', row: { id: 'p3', body: 'third' } }]);
  f.online(); await f.client.sync();
  const rows = async () => (await f.core.call({ op: 'query', name: 'heldRows', viewer: 'dev:alice', args: {}, now: Date.now() })).ok.data.map(r => r.id);
  assert.deepEqual(await rows(), ['p3', 'p2', 'p1']);
  const before = (await f.core.call({ op: 'sync_state' })).ok;
  let discoveries = 0, refusals = 0;
  f.intercept(async (path, request, send) => {
    if (path !== '/sync') return;
    if (!request.metadata) return request.from > 0 && refusals++ < 12 ? Response.json(bound) : undefined;
    discoveries++;
    const metadata = await send().then(r => r.json());
    if (fault === 'foreign') metadata.store_id = 'another-authorized-store';
    if (fault === 'generic') delete metadata.recovery;
    return Response.json(metadata);
  });
  f.online(); await f.client.sync();
  const after = (await f.core.call({ op: 'sync_state' })).ok;
  t.diagnostic(JSON.stringify({ fault, before, after, discoveries, metadataRequests: f.requests.filter(r => r.metadata), rows: await rows() }));
  assert.deepEqual(await rows(), ['p3', 'p2', 'p1'], 'a refusal and metadata cannot evict previously acquired rows');
  assert.deepEqual(after, before);
  assert.ok(f.requests.filter(r => r.metadata).every(r => r.store_id === before.store_id), 'discovery must name its store');
  assert.ok(f.requests.every(r => r.metadata || r.from > 0), 'no snapshot without a recovery decision');
  assert.ok(f.calls.every(r => r.op !== 'observe_store' && r.op !== 'keep_write' && r.op !== 'adopt'), 'discovery cannot observe identity or retire receipts');
  f.intercept(undefined);
  await f.client.sync();
  assert.deepEqual(await rows(), ['p3', 'p2', 'p1'], 'a transient refusal leaves ordinary retry available');
});
for (const tier of ['wasm', 'process']) for (const fault of ['send', 'watermark', 'schema-watermark', 'refusal', 'bound', 'malformed', 'zero-generation', 'schema-generation']) test(`${tier}: ${fault} discovery cannot discard retained history`, async t => {
  const f = await fixture(t, tier);
  if (fault === 'schema-watermark') await f.adopt();
  let discoveries = 0;
  const advance = async () => {
    const reply = await f.core.call({ op: 'apply', page: { snapshot: false, events: [], watermark: f.before.watermark + 1, more: false, generation: f.before.generation, store_id: f.before.store_id } });
    assert.ok(!reply.denied, JSON.stringify(reply));
  };
  f.intercept(async (path, request, send) => {
    if (path === '/schema' && fault === 'schema-watermark') { const response = await send(); await advance(); return response; }
    if (path !== '/sync') return;
    if (!request.metadata) return Response.json({ ...bound, store_id: 'untrusted-error-store', generation: 999, watermark: 0 });
    discoveries++;
    if (fault === 'refusal') return Response.json({ denied: { code: 'E_TEST', family: 'input', retryable: true }, store_id: 'foreign', generation: 999, watermark: 0 });
    if (fault === 'bound') return Response.json(bound);
    const metadata = await send().then(r => r.json());
    if (fault === 'send') assert.ok(!(await f.core.call({ op: 'begin_send' })).denied);
    if (fault === 'watermark') await advance();
    if (fault === 'malformed') metadata.generation = '999';
    if (fault === 'zero-generation') metadata.generation = 0;
    if (fault === 'schema-generation') metadata.generation = 999;
    return Response.json(metadata);
  });
  f.online(); await f.client.sync();
  assert.equal(discoveries, 1);
  const after = (await f.core.call({ op: 'sync_state' })).ok;
  assert.equal(after.store_id, f.before.store_id);
  assert.equal(after.generation, f.before.generation);
  assert.equal(after.acquired, true);
  assert.equal(after.restore_refusal, undefined);
  const retained = await f.core.call({ op: 'query', name: 'retained', viewer: 'dev:alice', args: {}, now: Date.now() });
  assert.equal(retained.ok.data[0].body, 'keep this delivered history');
  assert.ok(f.calls.every(r => r.op !== 'apply'), 'metadata is never a stream page');
  assert.ok(f.calls.every(r => r.op !== 'observe_store' && r.op !== 'keep_write'), 'metadata cannot retire identity or receipts');
});

for (const tier of ['wasm', 'process']) test(`${tier}: G1 backend-required discovery cannot install metadata`, async t => {
  const f = await fixture(t, tier);
  f.requireBackend();
  const before = (await f.core.call({ op: 'sync_state' })).ok;
  assert.ok(before.watermark > 0);
  let discoveries = 0;
  // Inject one refusal, then leave only discovery available. Adoption may run,
  // but its next request must be a fresh ordinary page, never this metadata.
  let first = true;
  const metadataHandler = async (path, request, send) => {
    if (path !== '/sync') return;
    if (!request.metadata) {
      if (first) { first = false; return Response.json(bound); }
      throw new TypeError('stop before the ordinary acquisition');
    }
    discoveries++;
    return Response.json({ ...await send().then(r => r.json()), snapshot: true, events: [], commits: [], more: false });
  };
  f.intercept(metadataHandler);
  f.online(); await f.client.sync();
  assert.equal(discoveries, 1);
  assert.ok(f.calls.some(r => r.op === 'sync_metadata'));
  assert.ok(f.calls.every(r => r.op !== 'apply'), 'metadata must never enter row installation, including with backend_required');
  const after = (await f.core.call({ op: 'sync_state' })).ok;
  assert.equal(after.watermark, before.watermark);
  assert.equal((await f.core.call({ op: 'query', name: 'retained', viewer: 'dev:alice', args: {}, now: Date.now() })).ok.data[0].body, 'keep this delivered history');
});

for (const tier of ['wasm', 'process']) for (const change of [-1, 1]) test(`${tier}: G3 ${change < 0 ? 'obsolete' : 'successor'} generation with a lower head does not restore-refuse`, async t => {
  const f = await fixture(t, tier);
  await f.adopt(); f.online(); await f.client.sync();
  const before = (await f.core.call({ op: 'sync_state' })).ok;
  const capture = { store_id: before.store_id, generation: before.generation, send_revision: before.send_revision,
    captured_watermark: before.watermark, from: before.watermark, stream: false, recover: false };
  const result = await f.core.call({ op: 'sync_metadata', capture, metadata: {
    metadata: true, store_id: before.store_id, generation: before.generation + change, watermark: 0,
  } });
  assert.equal(result.denied?.code, change < 0 ? 'E_GENERATION' : undefined, JSON.stringify(result));
  assert.deepEqual((await f.core.call({ op: 'sync_state' })).ok, before, 'different-generation metadata cannot persist a restore halt');
  await f.reopen();
  assert.equal((await f.core.call({ op: 'sync_state' })).ok.restore_refusal, undefined);
  await f.client.sync();
  assert.equal(f.client.acquired, true);
});

for (const tier of ['wasm', 'process']) test(`${tier}: G2 measured reset retires known receipts after the fence`, async t => {
  const f = await fixture(t, tier);
  await f.seed([{ table: 'held', row: { id: 'unseen-write', body: 'committed' } }]);
  for (const [index, id] of ['known-receipt', 'unknown-receipt'].entries()) {
    const admitted = await f.core.call({ op: 'admit', entry: { id, seq: index + 1, op: 'leave', args: {}, viewer: 'dev:alice', now: Date.now(), predictable: false } });
    assert.ok(!admitted.denied, JSON.stringify(admitted));
  }
  assert.ok(!(await f.core.call({ op: 'settle', id: 'known-receipt', seq: f.before.watermark + 1 })).denied);
  const capture = (await f.core.call({ op: 'sync_state' })).ok;
  const queued = (await f.core.call({ op: 'queued' })).ok;
  assert.deepEqual(queued.map(r => r.id), ['known-receipt', 'unknown-receipt']);
  const stale = await f.core.call({ op: 'sync_metadata', metadata: { metadata: true, store_id: capture.store_id,
    generation: capture.generation, watermark: capture.watermark, recovery: { from: capture.watermark, snapshot: true } },
    capture: { ...capture, captured_watermark: capture.watermark, from: capture.watermark, stream: false, recover: true, send_revision: capture.send_revision + 1 } });
  assert.equal(stale.denied?.code, 'E_GENERATION');
  assert.deepEqual((await f.core.call({ op: 'queued' })).ok, queued);
  assert.deepEqual(JSON.parse((await f.core.call({ op: 'meta', key: 'write-history' })).ok ?? '[]'), []);
  let resetState, history, queue;
  f.intercept(async (path, request, send) => {
    if (path !== '/sync') return;
    if (!request.metadata) {
      if (request.from > 0) return Response.json(bound);
      resetState = (await f.core.call({ op: 'sync_state' })).ok;
      history = JSON.parse((await f.core.call({ op: 'meta', key: 'write-history' })).ok ?? '[]');
      queue = (await f.core.call({ op: 'queued' })).ok;
      throw new TypeError('interrupt before snapshot');
    }
    const metadata = await send().then(r => r.json());
    if (request.recover) metadata.recovery = { from: request.from, snapshot: true };
    return Response.json(metadata);
  });
  f.online(); await f.client.sync();
  assert.equal(resetState?.snapshot_required, true);
  assert.ok(history.some(r => r.id === 'known-receipt'), 'the fenced reset must durably preserve the known receipt before requesting a snapshot');
  assert.deepEqual(queue.map(r => r.id), ['unknown-receipt']);
  assert.ok(f.calls.findIndex(r => r.op === 'keep_write') > f.calls.findLastIndex(r => r.op === 'sync_metadata'), 'host receipt publication follows the device fence');
  await f.reopen();
  assert.ok(JSON.parse((await f.core.call({ op: 'meta', key: 'write-history' })).ok).some(r => r.id === 'known-receipt'));
});

if (process.env.SB4_CONTENTION) test('metadata measurement writer contention', { timeout: 240000 }, async t => {
  const f = await fixture(t, 'process');
  for (const count of [48, 192]) {
    const from = (await f.post('/sync', { metadata: true })).watermark;
    const rows = Array.from({ length: count }, (_, i) => ({ table: 'items', row: { id: `measure-${count}-${i}`, body: 'small' } }));
    await f.seed(rows);
    for (let i = 0; i < count; i += 4) await f.seed(rows.slice(i, i + 4).map(({ table, row }) => ({ table, row: { ...row, body: 'x'.repeat(400000) } })));
    const metadata = await f.post('/sync', { metadata: true });
    const request = { metadata: true, recover: true, store_id: metadata.store_id, generation: metadata.generation, from, limit: 1 };
    const baseline = [], samples = [];
    const write = async id => { const start = performance.now(); await f.seed([{ table: 'held', row: { id, body: 'writer' } }]); return performance.now() - start; };
    for (let n = 0; n < 5; n++) baseline.push(await write(`baseline-${count}-${n}`));
    for (let n = 0; n < 5; n++) {
      const start = performance.now();
      const measuring = f.post('/sync', request).then(reply => { assert.equal(reply.recovery?.snapshot, true); return performance.now() - start; });
      await pause(5);
      const writers = Promise.all(Array.from({ length: 3 }, (_, i) => write(`concurrent-${count}-${n}-${i}`)));
      samples.push({ measurementMs: await measuring, writerMs: await writers });
    }
    t.diagnostic(JSON.stringify({ count, materializedBytes: count * 400000, baselineWriterMs: baseline, samples }));
  }
});

for (const tier of ['wasm', 'process']) test(`${tier}: first overflow during staged catch-up owns a lease and can restart`, { timeout: 120000 }, async t => {
  const f = await fixture(t, tier);
  let enlarged = false;
  f.requireSnapshot();
  f.intercept(async (path, request, send) => {
    if (path !== '/sync' || request.metadata || request.from !== 0 || request.stream || enlarged) return;
    const page = await send();
    enlarged = true;
    // The first snapshot precedes the indivisible commit; the first catch-up
    // therefore overflows after apply established its private snapshot lease.
    const rows = Array.from({ length: 48 }, (_, i) => ({ table: 'items', row: { id: `catchup-${String(i).padStart(2, '0')}`, body: 'small' } }));
    await f.seed(rows);
    for (let i = 0; i < rows.length; i += 4) await f.seed(rows.slice(i, i + 4).map(({ table, row }) => ({ table, row: { ...row, body: 'x'.repeat(400000) } })));
    return page;
  });
  f.online(); await f.client.sync();
  const state = (await f.core.call({ op: 'sync_state' })).ok;
  assert.equal(state.acquired, true);
  assert.equal(state.snapshot_required, undefined);
  assert.equal(state.watermark, (await f.post('/sync', { metadata: true })).watermark);
  assert.ok(f.requests.some(r => r.metadata && r.stream && r.recover));
  assert.ok(f.replies.some(r => r.recovery?.snapshot === true));
  assert.ok(f.calls.some(r => r.op === 'sync_metadata' && r.capture.stream && r.metadata.recovery?.snapshot));
  assert.equal((await f.client.query({ kind: 'query', name: 'retained' }, {})).data[0].body, 'keep this delivered history');
});

for (const tier of ['wasm', 'process']) test(`${tier}: catch-up recovery rejects advanced positions and retires each lease once`, async t => {
  const f = await fixture(t, tier);
  const state = (await f.core.call({ op: 'sync_state' })).ok;
  let page = await f.post('/sync', { from: 0, limit: 100 });
  assert.equal(page.more, false);
  const stage = async () => assert.ok(!(await f.core.call({ op: 'apply', page: { ...page, stage_snapshot: true }, first: true })).denied);
  await stage();
  const capture = { store_id: state.store_id, generation: state.generation, send_revision: state.send_revision,
    captured_watermark: state.watermark, from: page.watermark, stream: true, recover: true };
  const metadata = { metadata: true, store_id: state.store_id, generation: state.generation, watermark: page.watermark + 1,
    recovery: { from: page.watermark, snapshot: true } };
  const recover = capture => f.core.call({ op: 'sync_metadata', capture, metadata });
  const advanced = { snapshot: false, events: [], store_id: state.store_id, generation: state.generation,
    watermark: page.watermark + 1, more: true, snapshot_catchup: true };
  assert.ok(!(await f.core.call({ op: 'apply', page: advanced })).denied);
  assert.equal((await recover(capture)).denied?.code, 'E_GENERATION');
  await stage();
  assert.equal((await recover(capture)).ok?.snapshot, true);
  assert.equal((await recover(capture)).denied?.code, 'E_GENERATION', 'old capture cannot reuse the retired lease');
  const current = (await f.core.call({ op: 'sync_state' })).ok;
  capture.send_revision = current.send_revision;
  assert.equal((await recover(capture)).denied?.code, 'E_GENERATION', 'current revision alone cannot create a lease');
  await stage();
  assert.equal((await recover(capture)).ok?.snapshot, true, 'a new first snapshot establishes the next lease');
});

for (const tier of ['wasm', 'process']) test(`${tier}: G1 backend-required metadata cannot clear an existing partition refusal`, async t => {
  const f = await fixture(t, tier);
  const refusal = { code: 'E_INPUT', family: 'input', message: 'partition unavailable', retryable: false };
  f.intercept(path => path === '/sync' ? Response.json({ denied: refusal }) : undefined);
  f.online(); await f.client.sync();
  assert.equal((await f.client.query({ kind: 'query', name: 'heldRows' }, {})).denied?.code, refusal.code);
  f.requireBackend();
  f.intercept(async (path, request, send) => {
    if (path === '/schema') throw new TypeError('backend temporarily unavailable');
    if (path !== '/sync') return;
    if (!request.metadata) return Response.json(bound);
    return send();
  });
  f.online(); await f.client.sync();
  assert.ok(f.calls.some(r => r.op === 'sync_metadata'));
  assert.ok(f.calls.every(r => r.op !== 'apply'));
  assert.equal((await f.client.query({ kind: 'query', name: 'heldRows' }, {})).denied?.code, refusal.code,
    'metadata and an unsuccessful adoption cannot bless a refused partition');
});

for (const tier of ['wasm', 'process']) test(`${tier}: G3 lower successor metadata adopts then acquires real pages`, async t => {
  const f = await fixture(t, tier);
  await f.adopt();
  let discovered = false;
  f.intercept(async (path, request, send) => {
    if (path !== '/sync') return;
    if (request.metadata) {
      discovered = true;
      return Response.json({ ...await send().then(r => r.json()), watermark: 0 });
    }
    if (!discovered) return Response.json(bound);
  });
  f.online(); await f.client.sync();
  const state = (await f.core.call({ op: 'sync_state' })).ok;
  assert.equal(state.generation, 2);
  assert.equal(state.restore_refusal, undefined);
  assert.equal(state.acquired, true);
  assert.equal(state.watermark, (await f.post('/sync', { metadata: true })).watermark);
  assert.ok(f.calls.some(r => r.op === 'adopt'));
  assert.ok(f.calls.some(r => r.op === 'apply' && r.page.snapshot));
  assert.ok(f.calls.every(r => r.op !== 'apply' || !r.page.metadata));
});
