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
  const child = spawn(binary, ['dev', '--port', '0', '--fresh'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = once(child, 'exit');
  let log = '', url, client, core, offline = false, intercept;
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
    { table: 'members', row: { id: 'member', room: 'left', principal: 'dev:alice' } },
    { table: 'history', row: { id: 'retained', room: 'left', body: 'keep this delivered history' } },
  ]);
  const opener = tier === 'wasm' ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, 'device') });
  const requests = [], replies = [], calls = [];
  client = await createLocalClient({ url, persona: 'alice', waitSeconds: 1,
    device: { open: async (...args) => {
      core = await opener.open(...args);
      return { close: () => core.close(), call: async request => { calls.push(request); return core.call(request); } };
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
  assert.equal((await post('/m/leave', { id: 'leave', args: {} })).state, 'sent');
  await client.sync();
  const before = (await core.call({ op: 'sync_state' })).ok;
  offline = true;
  assert.equal((await client.query({ kind: 'query', name: 'retained' }, {})).data?.[0]?.body, 'keep this delivered history');
  return { client, core, requests, replies, calls, before, seed, post, dir, url,
    intercept: handler => { intercept = handler; },
    online: () => { offline = false; requests.length = 0; replies.length = 0; calls.length = 0; },
    adopt: async () => {
      writeFileSync(join(dir, 'snapback/schema.q'), source.replace('return 1', 'return 2'));
      await until(async () => (await fetch(url + '/schema', { headers: { 'x-snapback-persona': 'alice' } }).then(r => r.json())).generation > before.generation, 'generation change');
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
  const unauthenticated = await fetch(f.url + '/sync', { method: 'POST', body: '{"metadata":true}' });
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).store_id, undefined);
  f.online(); await f.client.sync();
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
for (const tier of ['wasm', 'process']) for (const fault of ['send', 'watermark', 'schema-watermark', 'refusal', 'malformed']) test(`${tier}: ${fault} discovery cannot discard retained history`, async t => {
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
    const metadata = await send().then(r => r.json());
    if (fault === 'send') assert.ok(!(await f.core.call({ op: 'begin_send' })).denied);
    if (fault === 'watermark') await advance();
    if (fault === 'send' || fault === 'watermark') Object.assign(metadata, { store_id: 'delayed-foreign-store', generation: 999 });
    if (fault === 'malformed') metadata.generation = '999';
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
});
