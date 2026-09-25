import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalClient } from '../dist/local.js';
import { createClient } from '../dist/client.js';
import { processDevice } from '../dist/native.js';
import { memorySessionStore } from '../dist/auth.js';
const binary = process.env.SNAPBACK4_BIN ?? resolve(import.meta.dirname, '../../../target/debug/snapback4');
const query = name => ({ kind: 'query', name });
const until = async (read, label) => {
  for (let n = 0; n < 500; n++) { if (await read()) return; await delay(10); }
  assert.fail(`timed out: ${label}`);
};
const blocked = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(Error('closed'));
  else signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
});

async function fixture(t, online = false) {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-authority-'));
  mkdirSync(join(dir, 'snapback'));
  writeFileSync(join(dir, 'snapback/schema.q'), readFileSync(new URL('./fixtures/page-authority.q', import.meta.url)));
  const host = spawn(binary, ['dev', '--port', '0', '--no-watch'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => host.once('exit', resolve));
  let log = '', client, core, held = false, release, entered = false, offline = false, failServer = false, serverLoading = false, failApply = false, holdWrites = false;
  const requests = [];
  host.stdout.on('data', b => { log += b; }); host.stderr.on('data', b => { log += b; });
  t.after(async () => { release?.(); await client?.close(); host.kill('SIGTERM'); await exited; rmSync(dir, { recursive: true, force: true }); });
  await until(() => { assert.equal(host.exitCode, null, log); return log.match(/http:\/\/127\.0\.0\.1:\d+/); }, 'server');
  const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  let serial = 0;
  const post = async (path, args = {}) => (await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-snapback-persona': 'bob' }, body: JSON.stringify({ args, id: `authority-${++serial}` }) })).json();
  assert.equal((await post('/m/setup')).state, 'sent');
  const device = processDevice({ dir: join(dir, 'device'), binary });
  const options = { url, persona: 'alice', sessionStore: memorySessionStore(), device: { async open(...args) {
    core = await device.open(...args);
    return { ...core, async call(request, committed) {
      const reply = await core.call(request);
      committed?.(reply);
      if (failApply && request.op === 'apply' && reply.ok?.published && request.page.events.some(event => event.kind !== 'put')) {
        failApply = false; throw Error('fallible work after committed revocation');
      }
      return reply;
    } };
  } }, fetch: async (input, init) => {
    const path = new URL(input).pathname; requests.push(path);
    if (path === '/changes') return blocked(init.signal);
    if (holdWrites && path.startsWith('/m/')) throw Error('controlled pending write');
    if (offline || (failServer && path === '/q/serverPage')) throw Error('offline');
    const response = await fetch(input, init);
    if (serverLoading && path === '/q/serverPage') {
      return Response.json({ ...await response.json(), loading: true, data: null, complete: false }, { headers: response.headers });
    }
    if (path === `/q/${held}`) {
      held = false; entered = true;
      await new Promise(resolve => { release = resolve; });
    }
    return response;
  } };
  client = online ? createClient(options) : await createLocalClient(options);
  if (!online) await client.sync();
  return { client, post, requests, core: () => core, hold: (name = 'serverPage') => { held = name; entered = false; }, entered: () => entered, release: () => release?.(), offline: () => { offline = true; }, failServer: value => { failServer = value; }, loadingServer: () => { serverLoading = true; }, failAfterApply: () => { failApply = true; }, holdWrites: () => { holdWrites = true; } };
}

test('a loading server reply cannot replace the local prefix on a later transport failure', async t => {
  const f = await fixture(t);
  assert.equal((await f.client.query(query('serverPage'), {})).data[0].body, 'private');
  // Change only the query response: no replica commit may clear the cache
  // for us, and no observer or background invalidation is needed.
  f.loadingServer();
  assert.deepEqual(await f.client.query(query('serverPage'), {}), { loading: true });
  f.failServer(true);
  const unavailable = await f.client.query(query('serverPage'), {});
  assert.equal(unavailable.data[0].body, 'private', 'failed fallback keeps the available local prefix');
  assert.equal(unavailable.complete, false);
});

for (const postCommitFailure of [false, true]) test(`applied revocation clears kept and remembered answers and fences in-flight server publications (post-commit failure: ${postCommitFailure})`, { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const page = f.client.observe(query('privatePage'), {}), server = f.client.observe(query('serverPage'), {});
  await until(() => page.getSnapshot().data?.[0]?.body === 'private' && server.getSnapshot().data?.[0]?.body === 'private', 'published private rows');
  // Capture an authorized HTTP response, but deliver it only after revocation.
  f.hold(); await f.post('/m/setCost', { grow: false }); await f.client.sync();
  await until(f.entered, 'old server answer held');
  await f.post('/m/setCost', { grow: true }); await f.client.sync();
  await until(() => page.getSnapshot().loading, 'heap abort settles as unavailable');
  assert.deepEqual(server.getSnapshot(), { loading: true }, 'server-run queries retain nothing');
  if (postCommitFailure) f.failAfterApply();
  await f.post('/m/revoke');
  if (postCommitFailure) await assert.rejects(f.client.sync(), /fallible work after committed revocation/);
  else await f.client.sync();
  assert.deepEqual((await f.core().call({ op: 'query', name: 'visible', viewer: 'dev:alice', args: {}, now: Date.now() })).ok.data, []);
  assert.equal((await f.post('/q/privatePage')).loading, true);
  assert.deepEqual(page.getSnapshot(), { loading: true }, 'revocation clears the retained private row');
  assert.deepEqual(server.getSnapshot(), { loading: true }, 'revocation clears every observation before reruns');
  f.release();
  await until(() => f.requests.filter(p => p === '/q/serverPage').length >= 3, 'stale in-flight publication retried');
  await delay(50);
  assert.deepEqual(server.getSnapshot(), { loading: true }, 'old HTTP response cannot republish revoked data');
  f.offline();
  const remembered = await f.client.query(query('serverPage'), {});
  assert.ok(!('data' in remembered), 'old HTTP response cannot refill the remembered cache');
  page.close(); server.close();
});

test('an unavailable held rerun clears its answer without a server fallback', { timeout: 30_000 }, async t => {
  const f = await fixture(t), watch = f.client.observe(query('heldPage'), {});
  await until(() => watch.getSnapshot().data?.[0]?.body === 'private', 'held answer');
  await f.post('/m/setCost', { grow: true }); await f.client.sync();
  await until(() => watch.getSnapshot().loading, 'held unavailable rerun');
  assert.equal(f.client.link(), 'online');
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  assert.equal(f.requests.filter(path => path === '/q/heldPage').length, 0);
  watch.close();
});

test('transport failures are loading and an explained server refusal lasts until the next result', async t => {
  for (const transport of [true, false]) {
    let reads = 0;
    const client = createClient({ url: 'http://refusal.test', persona: 'alice', fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes') return blocked(init.signal);
      if (path.startsWith('/m/')) return Response.json({ state: 'sent', id: JSON.parse(init.body).id, seq: 1, result: null });
      if (++reads === 1) {
        if (transport) throw Error('transport failed');
        return Response.json({ denied: { code: 'E_OFFLINE', family: 'rule', message: 'explicit refusal' } });
      }
      return Response.json({ loading: true, seq: 1, nextExpiry: Date.now() + 25 });
    } });
    t.after(() => client.close());
    const watch = client.observe(query('page'), {});
    await until(() => reads === 1, 'first request');
    await delay(0); // Let the controlled response settle before checking its observation.
    if (transport) assert.deepEqual(watch.getSnapshot(), { loading: true });
    else await until(() => watch.getSnapshot().denied?.code === 'E_OFFLINE', 'explained refusal');
    await client.mutate({ kind: 'mutation', name: 'retry' }, {});
    await until(() => reads > 2, 'successful loading reruns');
    assert.deepEqual(watch.getSnapshot(), { loading: true });
    watch.close();
  }
});


test('a local observation has no remembered answer after a failed replacing fetch', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const watch = f.client.observe(query('serverPage'), {});
  await until(() => watch.getSnapshot().data?.[0]?.body === 'private', 'initial server answer');
  f.failServer(true);
  await f.post('/m/setCost', { grow: true }); await f.client.sync();
  await until(() => watch.getSnapshot().loading, 'failed replacing fetch cannot remember private data');
  f.failServer(false);
  f.offline(); await f.client.sync();
  assert.deepEqual(watch.getSnapshot(), { loading: true }, 'offline cannot restore a remembered server answer');
  watch.close();
});

test('a server-class observation uses ordinary device-fallback retention during HTTP', { timeout: 30_000 }, async t => {
  const f = await fixture(t), watch = f.client.observe(query('serverPage'), {});
  await until(() => watch.getSnapshot().data?.[0]?.body === 'private', 'initial server answer');
  f.hold(); watch.close(); watch.subscribe(() => {});
  await until(f.entered, 'server rerun without a local commit');
  assert.equal(watch.getSnapshot().data[0].body, 'private', 'local-first fallback may retain an answer during transport');
  assert.equal(watch.getSnapshot().fresh, false);
  f.release();
  await until(() => watch.getSnapshot().data?.[0]?.body === 'private', 'replacement server answer');
  watch.close();
});

test('a predicted membership removal clears a kept private answer before the pending send', { timeout: 30_000 }, async t => {
  const f = await fixture(t), watch = f.client.observe(query('privatePage'), {});
  await until(() => watch.getSnapshot().data?.[0]?.body === 'private', 'private answer');
  f.hold('privatePage');
  await f.post('/m/setCost', { grow: true }); await f.client.sync();
  await until(f.entered, 'replacing fetch');
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  f.offline(); await f.client.sync();
  const write = await f.client.mutate({ kind: 'mutation', name: 'revoke' }, {});
  assert.equal(write.state, 'pending');
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  assert.ok((await f.core().call({ op: 'queued' })).ok.find(entry => entry.id === write.id).predicted.some(row => row.startsWith('members/')), 'membership deletion was predicted');
  watch.close();
});


for (const operation of ['expireSecret', 'expireMember'])
  test(`predicted ${operation}: every commit clears the pending observation`, { timeout: 30_000 }, async t => {
    const f = await fixture(t), watch = f.client.observe(query('privatePage'), {});
    await until(() => watch.getSnapshot().data?.[0]?.body === 'private', 'private answer');
    const id = watch.getSnapshot().data[0].id;
    f.hold('privatePage');
    await f.post('/m/setCost', { grow: true }); await f.client.sync();
    await until(f.entered, 'unavailable replacing fetch held');
    assert.deepEqual(watch.getSnapshot(), { loading: true });
    f.holdWrites();
    const write = await f.client.mutate({ kind: 'mutation', name: operation }, { ...(operation === 'expireSecret' ? { id } : {}), at: Date.now() - 1000 });
    assert.equal(write.state, 'pending');
    assert.ok((await f.core().call({ op: 'queued' })).ok.find(entry => entry.id === write.id).predicted.length, 'real expiry prediction');
    assert.deepEqual(watch.getSnapshot(), { loading: true }, 'every local prediction clears pending observations');
    f.release();
    await until(() => watch.getSnapshot().loading, 'one unavailable fetch clears the private row');
    f.offline(); await f.client.sync();
    await delay(20);
    assert.deepEqual(watch.getSnapshot(), { loading: true }, 'no remembered answer returns on the offline rerun');
    watch.close();
  });

test('online client drops a heap-aborted private answer within one fetch, including after revoke', { timeout: 30_000 }, async t => {
  const f = await fixture(t, true), watch = f.client.observe(query('privatePage'), {});
  await until(() => watch.getSnapshot().data?.[0]?.body === 'private', 'online private answer');
  f.hold('privatePage');
  await f.client.mutate({ kind: 'mutation', name: 'setCost' }, { grow: true });
  await until(f.entered, 'online replacement fetch');
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  f.release();
  await until(() => watch.getSnapshot().loading, 'heap abort ends retention');
  await f.client.mutate({ kind: 'mutation', name: 'revoke' }, {});
  assert.deepEqual((await f.client.query(query('visible'), {})).data, []);
  await until(() => watch.getSnapshot().loading, 'revoked unavailable read stays loading');
  await delay(20);
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  watch.close();
});

test('online revoke fences an already authorized HTTP response held across its commit', { timeout: 30_000 }, async t => {
  const f = await fixture(t, true), watch = f.client.observe(query('privatePage'), {}), values = [];
  watch.subscribe(() => values.push(watch.getSnapshot()));
  await until(() => watch.getSnapshot().data?.[0]?.body === 'private', 'initial authorized answer');
  f.hold('privatePage');
  await f.client.mutate({ kind: 'mutation', name: 'setCost' }, { grow: false });
  await until(f.entered, 'authorized response held in transport');
  assert.equal((await f.client.mutate({ kind: 'mutation', name: 'revoke' }, {})).state, 'sent');
  values.length = 0;
  f.release();
  await until(() => watch.getSnapshot().data?.length === 0, 'post-revocation answer');
  assert.ok(values.every(read => !read.data?.some(row => row.body === 'private')), 'revoked row must never reappear, even transiently');
  assert.ok(f.requests.filter(path => path === '/q/privatePage').length >= 3, 'old response was refetched');
  watch.close();
});

test('an unavailable HTTP response predating a cost-reducing write must refetch', { timeout: 30_000 }, async t => {
  const f = await fixture(t, true);
  await f.post('/m/setCost', { grow: true });
  f.hold('privatePage');
  const read = f.client.query(query('privatePage'), {});
  await until(f.entered, 'heap-aborted response held in transport');
  assert.equal((await f.client.mutate({ kind: 'mutation', name: 'setCost' }, { grow: false })).state, 'sent');
  f.release();
  assert.equal((await read).data?.[0]?.body, 'private', 'stale loading is refetched just like stale ready data');
  assert.equal(f.requests.filter(path => path === '/q/privatePage').length, 2);
});
