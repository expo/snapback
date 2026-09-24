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

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-authority-'));
  mkdirSync(join(dir, 'snapback'));
  writeFileSync(join(dir, 'snapback/schema.q'), readFileSync(new URL('./fixtures/page-authority.q', import.meta.url)));
  const host = spawn(binary, ['dev', '--port', '0', '--no-watch'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => host.once('exit', resolve));
  let log = '', client, core, held = false, release, entered = false, offline = false, failServer = false, failApply = false;
  const requests = [];
  host.stdout.on('data', b => { log += b; }); host.stderr.on('data', b => { log += b; });
  t.after(async () => { release?.(); await client?.close(); host.kill('SIGTERM'); await exited; rmSync(dir, { recursive: true, force: true }); });
  await until(() => { assert.equal(host.exitCode, null, log); return log.match(/http:\/\/127\.0\.0\.1:\d+/); }, 'server');
  const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  let serial = 0;
  const post = async (path, args = {}) => (await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-snapback-persona': 'bob' }, body: JSON.stringify({ args, id: `authority-${++serial}` }) })).json();
  assert.equal((await post('/m/setup')).state, 'sent');
  const device = processDevice({ dir: join(dir, 'device'), binary });
  client = await createLocalClient({ url, persona: 'alice', sessionStore: memorySessionStore(), device: { async open(...args) {
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
    if (offline || (failServer && path === '/q/serverPage')) throw Error('offline');
    const response = await fetch(input, init);
    if (path === '/q/serverPage' && held) {
      held = false; entered = true;
      await new Promise(resolve => { release = resolve; });
    }
    return response;
  } });
  await client.sync();
  return { client, post, requests, core: () => core, hold: () => { held = true; }, entered: () => entered, release: () => release?.(), offline: () => { offline = true; }, failServer: value => { failServer = value; }, failAfterApply: () => { failApply = true; } };
}

for (const postCommitFailure of [false, true]) test(`applied revocation clears kept and remembered answers and fences in-flight server publications (post-commit failure: ${postCommitFailure})`, { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const page = f.client.observe(query('privatePage'), {}), server = f.client.observe(query('serverPage'), {});
  await until(() => page.getSnapshot().data?.[0]?.body === 'private' && server.getSnapshot().data?.[0]?.body === 'private', 'published private rows');
  // Capture an authorized HTTP response, but deliver it only after revocation.
  f.hold(); await f.post('/m/setCost', { grow: false }); await f.client.sync();
  await until(f.entered, 'old server answer held');
  await f.post('/m/setCost', { grow: true }); await f.client.sync();
  await until(() => page.getSnapshot().fresh === false, 'heap abort retains authorized answer');
  assert.equal(page.getSnapshot().data[0].body, 'private');
  const since = page.getSnapshot().since; assert.ok(Number.isFinite(since));
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

test('an online unavailable held rerun keeps its answer without a server fallback', { timeout: 30_000 }, async t => {
  const f = await fixture(t), watch = f.client.observe(query('heldPage'), {});
  await until(() => watch.getSnapshot().data?.[0]?.body === 'private', 'held answer');
  await f.post('/m/setCost', { grow: true }); await f.client.sync();
  await until(() => watch.getSnapshot().fresh === false, 'held unavailable rerun');
  assert.equal(f.client.link(), 'online');
  assert.equal(watch.getSnapshot().data[0].body, 'private');
  assert.ok(Number.isFinite(watch.getSnapshot().since));
  assert.equal(f.requests.filter(path => path === '/q/heldPage').length, 0);
  watch.close();
});

test('successful loading replaces a transport refusal, but not a server refusal with the same code', async t => {
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
      return Response.json({ loading: true, nextExpiry: Date.now() + 25 });
    } });
    t.after(() => client.close());
    const watch = client.observe(query('page'), {});
    await until(() => watch.getSnapshot().denied, 'initial refusal');
    assert.equal(watch.getSnapshot().denied.code, 'E_OFFLINE');
    await client.mutate({ kind: 'mutation', name: 'retry' }, {});
    await until(() => reads > 2, 'successful loading reruns');
    if (transport) assert.deepEqual(watch.getSnapshot(), { loading: true });
    else assert.equal(watch.getSnapshot().denied.message, 'explicit refusal');
    watch.close();
  }
});


test('a local observation recovers from transport refusal to successful loading', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  f.failServer(true);
  const watch = f.client.observe(query('serverPage'), {});
  await until(() => watch.getSnapshot().denied?.code === 'E_OFFLINE', 'transport refusal');
  f.failServer(false);
  await f.post('/m/setCost', { grow: true }); await f.client.sync();
  await until(() => watch.getSnapshot().loading === true, 'successful unavailable response replaces transport refusal');
  watch.close();
});

test('a predicted membership removal clears a kept private answer before the pending send', { timeout: 30_000 }, async t => {
  const f = await fixture(t), watch = f.client.observe(query('privatePage'), {});
  await until(() => watch.getSnapshot().data?.[0]?.body === 'private', 'private answer');
  await f.post('/m/setCost', { grow: true }); await f.client.sync();
  await until(() => watch.getSnapshot().fresh === false, 'kept answer');
  f.offline(); await f.client.sync();
  const write = await f.client.mutate({ kind: 'mutation', name: 'revoke' }, {});
  assert.equal(write.state, 'pending');
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  assert.ok((await f.core().call({ op: 'queued' })).ok.find(entry => entry.id === write.id).predicted.some(row => row.startsWith('members/')), 'membership deletion was predicted');
  watch.close();
});
