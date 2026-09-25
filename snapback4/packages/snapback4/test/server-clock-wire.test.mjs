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
const extraSource = readFileSync(new URL('./fixtures/server-clock.q', import.meta.url), 'utf8');

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

test('a real held heartbeat poll learns clock advance from its final body', async t => {
  const f = await devServer({ seed: [], extraSource }); t.after(() => f.close());
  const clock = new ServerClock(), aborter = new AbortController(); t.after(() => aborter.abort());
  const headers = { 'x-snapback-persona': 'alice' };
  const probe = await fetch(f.api + '/probe', { headers }).then(r => r.json());
  let headersReceived;
  const entered = new Promise(resolve => { headersReceived = resolve; });
  const transport = clock.wrap(async (...args) => { const r = await fetch(...args); headersReceived(); return r; });
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

for (const clockOffset of ['+25h', '-31d']) test(`native JSON bridge shares device time and restores offline (${clockOffset})`, async t => {
  const f = await devServer({ seed: [], extraSource, clockOffset }); t.after(() => f.close());
  const signed = await guest(f.api); assert.equal(signed.ok, true, JSON.stringify(signed));
  await member(f.api, signed.session.principal);
  const dir = mkdtempSync(join(tmpdir(), 'sb4-native-clock-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sessions = memorySessionStore(), observed = [];
  let offline = false, client, failClock = false, closedCores = 0;
  const device = processDevice({ dir, binary: binary() });
  const options = { url: f.api, session: signed.session, sessionStore: sessions, waitSeconds: 1,
    fetch: async (input, init) => {
      if (offline) throw Error('offline');
      if (new URL(input).pathname === '/changes') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true }));
      return fetch(input, init);
    },
    device: { async open(...args) {
      const core = await device.open(...args);
      return { ...core, call: (request, ...rest) => {
        if (failClock && request.op === 'set_meta' && request.key === 'server-clock') return Promise.reject(Error('clock storage unavailable'));
        if (typeof request.now === 'number') observed.push(request);
        return core.call(request, ...rest);
      }, close: async () => { closedCores++; await core.close(); } };
    } },
  };
  t.after(async () => { await client?.close(); });
  client = await createLocalClient(options);
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
