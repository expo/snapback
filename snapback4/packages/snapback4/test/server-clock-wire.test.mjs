import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { devServer, binary } from '../../../witness/lib.mjs';
import { guest, memorySessionStore } from '../dist/auth.js';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { ServerClock } from '../dist/clock.js';
import { changeFeed } from '../dist/changes.js';
import { modelBackend } from './helpers/app-model-device.mjs';
import { memoryPersistence, webDevice } from '../dist/web.js';
const extraSource = readFileSync(new URL('./fixtures/server-clock.q', import.meta.url), 'utf8');
const wasm = readFileSync(new URL('../dist/wasm/snapback4_device_bg.wasm', import.meta.url));

async function post(url, path, body = {}, token) {
  const response = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}
async function member(url, principal) {
  const seeded = await post(url, '/seed', [
    { table: 'conversations', row: { id: 'room', title: 'Clock', creatorId: principal } },
    { table: 'memberships', row: { id: 'member', conversationId: 'room', principal, role: 'admin', joinedAt: 1 } },
  ]);
  assert.equal(seeded.body.seeded, 2);
}

test('wire stamps successes and refusals on sync, changes, query, mutation and session endpoints', async t => {
  const f = await devServer({ seed: [], extraSource, clockOffset: '+25h' }); t.after(() => f.close());
  let revision;
  const stamped = response => {
    const at = Number(response.headers.get('x-snapback-time'));
    assert.ok(Number.isSafeInteger(at) && Math.abs(at - Date.now() - 90_000_000) < 1000, `${response.url}: ${at}`);
    revision ??= response.headers.get('x-snapback-clock');
    assert.equal(response.headers.get('x-snapback-clock'), revision);
    assert.match(response.headers.get('access-control-expose-headers'), /X-Snapback-Time/);
  };
  const signed = await post(f.api, '/auth/guest'); stamped(signed.response);
  let token = signed.body.session.token;
  await member(f.api, signed.body.session.principal);
  for (const [path, body] of [
    ['/sync', { from: 0 }], ['/q/media.latestClock', { args: { conversationId: 'room' } }],
    ['/m/media.sendClock', { id: 'clock-wire', args: { conversationId: 'room', body: 'server stamp' }, now: 1 }],
    ['/q/missing', { args: {} }], ['/m/missing', { id: 'missing', args: {} }],
    ['/sync', { from: -1 }],
  ]) stamped((await post(f.api, path, body, token)).response);
  const rows = (await post(f.api, '/q/media.latestClock', { args: { conversationId: 'room' } }, token)).body.data;
  const sent = rows.find(row => row.body === 'server stamp');
  assert.ok(sent, 'read back the committed mutation row');
  assert.notEqual(sent.at, 1, 'the client-supplied mutation now is never authoritative');
  assert.ok(Math.abs(sent.at - Date.now() - 90_000_000) < 1000);
  stamped(await fetch(f.api + '/changes?wait=0', { headers: { authorization: `Bearer ${token}` } }));
  for (const path of ['/sync', '/q/media.latestClock', '/m/media.sendClock', '/auth/refresh', '/auth/logout-all'])
    stamped((await post(f.api, path, {}, 'invalid')).response);
  stamped(await fetch(f.api + '/changes?wait=0'));
  const rotated = await post(f.api, '/auth/refresh', {}, token); stamped(rotated.response); token = rotated.body.session.token;
  stamped((await post(f.api, '/auth/logout-all', {}, token)).response);
  stamped((await post(f.api, '/auth/logout', {}, token)).response);
  // Password disabled is still a stamped session endpoint response.
  for (const path of ['/auth/signup', '/auth/login']) stamped((await post(f.api, path, { email: 'clock@example.com', password: 'clock-password' })).response);
});

for (const tier of ['web', 'native']) test(`${tier}: a legacy admission keeps its floor through upgrade, retirement and rollback`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-legacy-clock-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const persist = memoryPersistence();
  const raw = tier === 'web' ? webDevice({ wasm, persist }) : processDevice({ dir, binary: binary() });
  const device = raw;
  let wall = 1_004_000, core = await device.open('legacy-clock', { initial_backend: modelBackend });
  t.after(() => core.close());
  await core.close();
  // Build the old persisted shape directly: current enqueue must write a floor.
  const entry = { id: 'legacy', seq: 1, op: 'write', args: { hiddenHandle: false, refuse: false },
    viewer: 'alice', now: wall, new_ids: [], predicted: [], predictable: false };
  if (tier === 'web') await persist.save('legacy-clock', [{ s: 'o', k: entry.id, v: JSON.stringify(entry) }]);
  else {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(dir, 'legacy-clock.sqlite'));
    try { db.prepare('INSERT INTO _device_outbox (seq, id, entry) VALUES (?, ?, ?)').run(entry.seq, entry.id, JSON.stringify(entry)); }
    finally { db.close(); }
  }
  core = await device.open('legacy-clock', null);
  assert.equal((await core.call({ op: 'meta', key: 'server-clock-floor' })).ok, null, 'legacy admission has no floor record');
  const upgraded = new ServerClock(() => wall); await upgraded.attach(core);
  assert.equal((await core.call({ op: 'meta', key: 'server-clock-floor' })).ok, '1004000', 'attach commits the backfill before retirement');
  assert.equal((await core.call({ op: 'settle', id: 'legacy' })).denied, undefined);
  assert.deepEqual((await core.call({ op: 'queued' })).ok, []);
  await core.close(); // No clock.detach(): only committed device transactions survive.
  wall -= 4000;
  core = await device.open('legacy-clock', null);
  const reopened = new ServerClock(() => wall); await reopened.attach(core);
  assert.equal(reopened.issuedDeviceNow(), 1_004_000, 'retirement cannot erase the legacy admission floor');
});

test('web orphan recovery after attachment preserves its admission floor through settlement and rollback', async t => {
  const name = 'late-clock', orphan = `${name}:tab-old`, persist = memoryPersistence(), batches = [];
  const entry = { id: 'orphan', seq: 1, op: 'write', args: { hiddenHandle: false, refuse: false },
    viewer: 'alice', now: 1_002_000, new_ids: [], predicted: [], predictable: false };
  const later = { ...entry, id: 'orphan-later', seq: 2, now: 1_004_000 };
  await persist.save(orphan, [{ s: 'm', k: 'device:store_id', v: 'clock-store' },
    ...[entry, later].map(e => ({ s: 'o', k: e.id, v: JSON.stringify(e) }))]);
  const held = await persist.claim(orphan, false); t.after(() => held.release());
  const device = webDevice({ wasm, persist: { ...persist, async save(store, changes) {
    batches.push({ store, changes }); await persist.save(store, changes);
  } } });
  let wall = 1_000_000, core = await device.open(name, { initial_backend: modelBackend }); t.after(() => core.close());
  const observe = { op: 'observe_store', page: { snapshot: false, generation: 1, events: [], watermark: 0, more: false, store_id: 'clock-store', requested_watermark: 0 } };
  assert.equal((await core.call(observe)).denied, undefined);
  await core.call({ op: 'set_meta', key: 'server-clock-floor', value: '1002000' });
  const clock = new ServerClock(() => wall); await clock.attach(core);
  core.onOutbox(time => clock.raiseIssued(time));
  assert.equal(clock.issuedDeviceNow(), 1_002_000);
  assert.deepEqual((await core.call({ op: 'queued' })).ok, []);
  assert.equal((await core.call({ op: 'meta', key: 'server-clock-floor' })).ok, '1002000');
  await held.release();
  assert.equal((await core.call(observe)).denied, undefined); // Normal orphan recovery, after attach.
  assert.equal(await persist.has(orphan), false);
  assert.deepEqual((await core.call({ op: 'queued' })).ok.map(e => e.now), [entry.now, later.now]);
  assert.equal(clock.issuedDeviceNow(), later.now, 'the existing live clock adopts the maximum, without reopening');
  assert.equal((await core.call({ op: 'meta', key: 'server-clock-floor' })).ok, String(later.now));
  assert.ok(batches.some(({ store, changes }) => store === name
    && changes.some(c => c.s === 'o' && c.k === entry.id && c.v)
    && changes.some(c => c.s === 'o' && c.k === later.id && c.v)
    && changes.some(c => c.s === 'm' && c.k === 'client:server-clock-floor' && c.v === String(later.now))), 'both transfers and the maximum floor share the durable batch');
  for (const e of [entry, later]) assert.equal((await core.call({ op: 'settle', id: e.id })).denied, undefined);
  assert.deepEqual((await core.call({ op: 'queued' })).ok, []);
  await core.close(); // No clock flush can preserve the retired timestamp.
  wall -= 4000;
  core = await device.open(name, null);
  const reopened = new ServerClock(() => wall); await reopened.attach(core);
  assert.equal(reopened.issuedDeviceNow(), later.now);
});

test('a DeviceCore backfill refusal blocks startup without sending or retiring entries, then retries', async t => {
  const f = await devServer({ seed: [], extraSource }); t.after(() => f.close());
  await member(f.api, 'dev:alice');
  const persist = memoryPersistence(), device = webDevice({ wasm, persist }), requests = [], retirements = [];
  const name = `snapback4-${encodeURIComponent(`${f.api}:dev:alice`)}`;
  let failBackfill = false, core, client, refusals = 0;
  const options = { url: f.api, persona: 'alice', device: { async open(...args) {
    core = await device.open(...args);
    return { ...core, call(request, ...rest) {
      if (request.op === 'queued' && request.restore_clock_floor && failBackfill) {
        refusals++;
        return Promise.resolve({ denied: { code: 'E_STORE', family: 'storage', message: 'injected backfill refusal', retryable: true } });
      }
      if (['apply', 'settle', 'dequeue'].includes(request.op)) retirements.push(request.op);
      return core.call(request, ...rest);
    } };
  } }, fetch: (input, init) => {
    const path = new URL(input).pathname;
    if (path.startsWith('/m/')) requests.push(path);
    if (path === '/changes') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true }));
    return fetch(input, init);
  } };
  t.after(async () => { await client?.close(); });
  client = await createLocalClient(options); await client.close(); client = undefined;
  const entry = { id: 'legacy-refusal', seq: 1, op: 'media.sendClock', args: { conversationId: 'room', body: 'recovered after refusal' },
    viewer: 'dev:alice', now: Date.now() + 4000, new_ids: [], predicted: [], predictable: false };
  await persist.save(name, [{ s: 'o', k: entry.id, v: JSON.stringify(entry) }]);
  failBackfill = true; requests.length = 0; retirements.length = 0;
  await assert.rejects(createLocalClient(options).then(opened => { client = opened; return opened; }), /injected backfill refusal/);
  assert.equal(refusals, 1);
  assert.deepEqual(requests, [], 'failed attachment cannot send an admission');
  assert.deepEqual(retirements, [], 'failed attachment cannot retire an admission');
  const saved = await persist.load(name);
  assert.equal(saved.find(c => c.s === 'o' && c.k === entry.id)?.v, JSON.stringify(entry));
  assert.equal(saved.find(c => c.s === 'm' && c.k === 'client:server-clock-floor')?.v, undefined);
  failBackfill = false;
  client = await createLocalClient(options);
  for (let n = 0; n < 100; n++) {
    await client.sync();
    if (!(await core.call({ op: 'queued' })).ok.length) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(requests.length, 1, 'retry sends the preserved admission once');
  assert.deepEqual((await core.call({ op: 'queued' })).ok, []);
  assert.equal((await core.call({ op: 'meta', key: 'server-clock-floor' })).ok, String(entry.now));
  assert.ok(client.now() >= entry.now);
});

test('native offline reopen restores legacy offset without issuedOffset or admissions and retains the session', async t => {
  const f = await devServer({ seed: [], extraSource, clockOffset: '-31d' }); t.after(() => f.close());
  const signed = await guest(f.api); assert.equal(signed.ok, true);
  const dir = mkdtempSync(join(tmpdir(), 'sb4-legacy-offset-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const device = processDevice({ dir, binary: binary() }), sessions = memorySessionStore();
  let offline = false, core, client, deletions = 0, onlineCalls = 0;
  const remove = sessions.delete;
  sessions.delete = async key => { deletions++; await remove(key); };
  const options = { url: f.api, sessionStore: sessions, device: { async open(...args) { core = await device.open(...args); return core; } },
    fetch: async (input, init) => {
      if (offline) throw Error('offline');
      onlineCalls++;
      if (new URL(input).pathname === '/changes') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true }));
      return fetch(input, init);
    },
  };
  t.after(async () => { await client?.close(); });
  client = await createLocalClient({ ...options, session: signed.session });
  assert.deepEqual((await core.call({ op: 'queued' })).ok, []);
  assert.equal((await core.call({ op: 'meta', key: 'server-clock-floor' })).ok, null);
  await client.close(); client = undefined;
  // Write the old serialized shape only after close has flushed new metadata.
  core = await device.open(`snapback4-${encodeURIComponent(`${f.api}:${signed.session.principal}`)}`, null);
  assert.equal((await core.call({ op: 'set_meta', key: 'server-clock', value: JSON.stringify({
    offset: -31 * 86_400_000, last: Date.now() + 120_000,
  }) })).denied, undefined);
  await core.close();
  const before = onlineCalls; offline = true;
  client = await createLocalClient(options);
  assert.equal(onlineCalls, before, 'offline reopen cannot obtain a sample');
  assert.equal(deletions, 0, 'the valid thirty-day session survives the legacy offline clock');
  assert.ok(client.now() < signed.session.expiresAt);
  assert.ok(Math.abs(client.now() - Date.now() + 31 * 86_400_000) < 1000);
});

test('a real held heartbeat poll learns clock advance from its final body', async t => {
  const f = await devServer({ seed: [], extraSource }); t.after(() => f.close());
  const clock = new ServerClock(), aborter = new AbortController(); t.after(() => aborter.abort());
  const headers = { 'x-snapback-persona': 'alice' };
  const probe = await fetch(f.api + '/probe', { headers }).then(r => r.json());
  let headersReceived;
  const entered = new Promise(resolve => { headersReceived = resolve; });
  const transport = clock.wrap(async (...args) => {
    const r = await fetch(...args);
    assert.equal(r.headers.get('x-snapback-time'), null, 'streaming time is stamped in the final body, not early headers');
    headersReceived(); return r;
  });
  const changes = changeFeed(transport, f.api, aborter.signal, () => {}, () => {});
  const pending = changes(probe.seq, 25, headers, probe.store_id);
  await entered;
  const old = clock.issuedDeviceNow();
  assert.equal((await post(f.api, '/dev/clock/advance', { duration: '2m' })).body.advancedMs, 120000);
  const answer = await pending;
  assert.ok(answer.json.serverNow >= old + 119000, JSON.stringify(answer.json));
  assert.ok(clock.issuedDeviceNow() >= old + 119000, 'final response advances the client, without a second request');
  assert.ok(Math.abs(clock.issuedDeviceNow() - answer.json.serverNow) < 1000, 'a held poll must not issue half its wait into the future');
  const short = await clock.wrap(fetch)(f.api + '/q/media.clockTime', { method: 'POST', headers, body: JSON.stringify({ args: {} }) }).then(r => r.json());
  assert.ok(Math.abs(clock.issuedDeviceNow() - short.data.at) < 1000, 'the following short reply cannot leave a frozen overshoot');
});

for (const [clockOffset, staleLast] of [['+25h', false], ['-31d', false], ['-31d', true]]) test(`native JSON bridge shares device time and restores offline (${clockOffset}${clockOffset === '-31d' ? ', 1500ms startup responses' : ''}${staleLast ? ', non-admission last' : ''})`, async t => {
  const f = await devServer({ seed: [], extraSource, clockOffset }); t.after(() => f.close());
  const signed = await guest(f.api); assert.equal(signed.ok, true, JSON.stringify(signed));
  await member(f.api, signed.session.principal);
  if (clockOffset === '-31d') assert.ok(signed.session.expiresAt < Date.now(), 'wall time alone would falsely expire this valid session');
  const dir = mkdtempSync(join(tmpdir(), 'sb4-native-clock-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sessions = memorySessionStore(), observed = [], slowPaths = [];
  let deletions = 0;
  const removeSession = sessions.delete;
  sessions.delete = async key => { deletions++; await removeSession(key); };
  let offline = false, client, failClock = false, closedCores = 0, seededLast = false;
  const device = processDevice({ dir, binary: binary() });
  const options = { url: f.api, session: signed.session, sessionStore: sessions, waitSeconds: 1,
    fetch: async (input, init) => {
      if (offline) throw Error('offline');
      if (new URL(input).pathname === '/changes') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true }));
      const path = new URL(input).pathname;
      if (clockOffset === '-31d' && ['/auth/refresh', '/schema'].includes(path)) {
        // Simulate request/processing latency; the real server stamps after it.
        await new Promise(resolve => setTimeout(resolve, 1500));
        slowPaths.push(path);
      }
      return fetch(input, init);
    },
    device: { async open(...args) {
      const core = await device.open(...args);
      if (staleLast && !seededLast) {
        assert.deepEqual(slowPaths, ['/auth/refresh', '/schema'], 'the live slow samples precede attach');
        assert.deepEqual((await core.call({ op: 'queued' })).ok, []);
        assert.equal((await core.call({ op: 'meta', key: 'server-clock-floor' })).ok, null);
        const result = await core.call({ op: 'set_meta', key: 'server-clock', value: JSON.stringify({
          offset: -31 * 86_400_000, issuedOffset: 0, last: Date.now() - 5000,
        }) });
        assert.equal(result.denied, undefined);
        seededLast = true;
      }
      return { ...core, call: (request, ...rest) => {
        if (failClock && request.op === 'set_meta' && request.key === 'server-clock') return Promise.reject(Error('clock storage unavailable'));
        if (typeof request.now === 'number') observed.push(request);
        return core.call(request, ...rest);
      }, close: async () => { closedCores++; await core.close(); } };
    } },
  };
  t.after(async () => { await client?.close(); });
  client = await createLocalClient(options);
  if (clockOffset === '-31d') assert.deepEqual(slowPaths, ['/auth/refresh', '/schema']);
  assert.equal(deletions, 0, 'valid thirty-day credentials survive slow negative-offset startup');
  assert.equal(seededLast, staleLast);
  offline = true; await client.sync();
  const expected = clockOffset === '+25h' ? 90_000_000 : -31 * 86_400_000;
  assert.ok(Math.abs(client.now() - Date.now() - expected) < 1000);
  const op = { kind: 'mutation', name: 'media.sendClock' }, query = { kind: 'query', name: 'media.heldClock' };
  assert.equal((await client.mutate(op, { conversationId: 'room', body: 'native offline' })).state, 'pending');
  const first = await client.query(query, { conversationId: 'room' });
  assert.equal(first.data[0].body, 'native offline'); assert.equal(first.data[0].pending, true);
  assert.ok(observed.filter(r => ['query', 'admit'].includes(r.op)).every(r => Math.abs(r.now - Date.now() - expected) < 2000));
  const issued = client.now(); await client.close();
  const { session: _, ...reopen } = options;
  client = await createLocalClient(reopen);
  assert.ok(client.now() >= issued);
  assert.ok(Math.abs(client.now() - Date.now() - expected) < 1000);
  const cold = await client.query(query, { conversationId: 'room' });
  assert.equal(cold.data[0].at, first.data[0].at); assert.equal(cold.data[0].pending, true);
  failClock = true;
  await client.close();
  client = undefined;
  assert.equal(closedCores, 2, 'a failed final clock save must still close the native device');
});
