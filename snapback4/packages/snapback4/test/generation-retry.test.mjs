import test from 'node:test';
import assert from 'node:assert/strict';
import { readWithAdmissionRetry } from '../dist/http-response.js';

const why = { code: 'E_GENERATION', family: 'generation', message: 'retry current admission', retryable: true };
function clock(t) {
  const delays = [];
  t.mock.method(Math, 'random', () => 0.5);
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => { delays.push(delay); queueMicrotask(fn); return 0; });
  return delays;
}
test('a safe read recovers from a retryable generation 503 after Retry-After', async t => {
  const delays = clock(t); let calls = 0;
  const result = await readWithAdmissionRetry(async () => ++calls === 1
    ? Response.json({ denied: why }, { status: 503, headers: { 'Retry-After': '1' } })
    : Response.json({ data: 7, complete: true }), () => true);
  assert.equal(calls, 2); assert.deepEqual(delays, [1125]); assert.equal(result.json.data, 7);
});
test('persistent generation refusal stops after four attempts', async t => {
  const delays = clock(t); let calls = 0;
  const result = await readWithAdmissionRetry(async () => {
    calls++; return Response.json({ denied: why }, { status: 503, headers: { 'Retry-After': '1' } });
  }, () => true);
  assert.equal(calls, 4); assert.deepEqual(delays, [1125, 1125, 1125]); assert.deepEqual(result.json.denied, why);
});
test('generation retries share the ten-second cumulative wait limit', async t => {
  const delays = clock(t); let calls = 0;
  await readWithAdmissionRetry(async () => {
    calls++; return Response.json({ denied: why }, { status: 503, headers: { 'Retry-After': '6' } });
  }, () => true);
  assert.equal(calls, 2); assert.deepEqual(delays, [6750]);
});
for (const [status, retryable] of [[503, false], [401, true], [200, true]]) test(`generation ${status}/${retryable} does not retry`, async t => {
  const delays = clock(t); let calls = 0;
  await readWithAdmissionRetry(async () => {
    calls++; return Response.json({ denied: { ...why, retryable } }, { status });
  }, () => true);
  assert.equal(calls, 1); assert.deepEqual(delays, []);
});
test('credential invalidation during the pause stops generation retries', async t => {
  t.mock.method(Math, 'random', () => 0.5); let current = true, calls = 0;
  t.mock.method(globalThis, 'setTimeout', fn => { current = false; queueMicrotask(fn); return 0; });
  await readWithAdmissionRetry(async () => {
    calls++; return Response.json({ denied: why }, { status: 503 });
  }, () => current);
  assert.equal(calls, 1);
});

import { createClient } from '../dist/client.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { server } from './helpers/app-server.mjs';
test('public bearer query retries a generation 503 and preserves its session', async t => {
  const { url } = await server(t, undefined, 'use identity\nquery count():\n  return 7\n');
  const issued = await (await defaultFetch(`${url}/auth/guest`, { method: 'POST', body: '{}' })).json();
  let calls = 0; const credentials = [];
  const client = createClient({ url, session: issued.session, fetch: async (input, init) => {
    if (new URL(input).pathname === '/q/count') {
      credentials.push(new Headers(init.headers).get('authorization'));
      if (++calls === 1) return Response.json({ denied: why }, { status: 503, headers: { 'Retry-After': '1' } });
    }
    return defaultFetch(input, init);
  } });
  t.after(() => client.close());
  const result = await client.query({ kind: 'query', name: 'count', runs: 'server' }, {});
  assert.equal(result.data, 7, JSON.stringify(result)); assert.equal(calls, 2);
  assert.equal(credentials[0], `Bearer ${issued.session.token}`); assert.equal(credentials[1], credentials[0]);
  assert.equal(client.link(), 'online');
});

import { changeFeed } from '../dist/changes.js';
import { postForCaller } from '../dist/request-wait.js';
function changesClock(t) {
  const original = globalThis.setTimeout;
  const delays = [];
  t.mock.method(Math, 'random', () => 0.5);
  t.mock.method(globalThis, 'setTimeout', (fn, delay, ...args) => {
    if (delay === 4000) return original(fn, delay, ...args); // real byte watchdog
    delays.push(delay); queueMicrotask(fn); return 0;
  });
  return delays;
}
const chunk = (denied, ms = 1000) => new Response(new ReadableStream({ start(controller) {
  controller.enqueue(new TextEncoder().encode('\n')); // an already delivered heartbeat
  controller.enqueue(new TextEncoder().encode(JSON.stringify({ denied: { ...denied, retryAfterMs: ms } })));
  controller.close();
} }), { status: 200 });
for (const streamed of [false, true]) test(`changes retries ${streamed ? 'streamed 200' : '503'} generation with identical cursor and credential`, async t => {
  const delays = changesClock(t), lifetime = new AbortController(); t.after(() => lifetime.abort());
  const sent = []; let offline = 0;
  const feed = changeFeed(async (url, init) => {
    sent.push({ url, headers: { ...init.headers } });
    if (sent.length === 1) return streamed ? chunk(why) : Response.json({ denied: why }, { status: 503, headers: { 'Retry-After': '1' } });
    return Response.json({ seq: 7, tables: [], generation: 1, store_id: 'store' });
  }, 'http://localhost', lifetime.signal, () => offline++, () => {});
  const result = await feed(7, 25, { authorization: 'Bearer same' }, 'store');
  assert.equal(result.json.seq, 7); assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]);
  assert.deepEqual(delays, [1125]); assert.equal(offline, 0);
});
for (const [ms, attempts, waits] of [[1000, 4, [1125, 1125, 1125]], [6000, 2, [6750]]]) test(`streamed generation keeps retry bound at floor ${ms}`, async t => {
  const delays = changesClock(t), lifetime = new AbortController(); t.after(() => lifetime.abort()); let calls = 0;
  const feed = changeFeed(async () => { calls++; return chunk(why, ms); }, 'http://localhost', lifetime.signal, () => {}, () => {});
  const result = await feed(7, 25, { authorization: 'Bearer same' });
  assert.equal(result.json.denied.code, 'E_GENERATION'); assert.equal(calls, attempts); assert.deepEqual(delays, waits);
});
for (const denied of [{ ...why, retryable: false }, { ...why, code: 'E_AUTH', retryable: false }]) test(`streamed ${denied.code}/${denied.retryable} is terminal`, async t => {
  const delays = changesClock(t), lifetime = new AbortController(); t.after(() => lifetime.abort()); let calls = 0;
  const feed = changeFeed(async () => { calls++; return chunk(denied); }, 'http://localhost', lifetime.signal, () => {}, () => {});
  assert.equal((await feed(7, 25, {})).json.denied.code, denied.code); assert.equal(calls, 1); assert.deepEqual(delays, []);
});
test('streamed generation retry stops when the credential owner aborts', async t => {
  const original = globalThis.setTimeout, lifetime = new AbortController(), revision = new AbortController(); t.after(() => lifetime.abort());
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => {
    if (delay === 4000) return original(fn, delay);
    queueMicrotask(() => { revision.abort(); fn(); }); return 0;
  });
  let calls = 0;
  const feed = changeFeed(async () => { calls++; return chunk(why); }, 'http://localhost', lifetime.signal, () => {}, () => {});
  await feed(7, 25, {}, undefined, undefined, revision.signal).catch(() => {});
  assert.equal(calls, 1);
});
test('local Following transport retries generation with the same controller request', async t => {
  const delays = clock(t); let calls = 0; const sent = [], controller = new AbortController();
  const fetch = async (url, init) => {
    calls++; sent.push({ url, headers: init.headers, body: init.body });
    return calls === 1 ? Response.json({ denied: why }, { status: 503, headers: { 'Retry-After': '1' } }) : Response.json({ phase: 'restart' });
  };
  const result = await postForCaller(fetch, 'http://localhost', '/following/cards', { authorization: 'Bearer same' }, { action: 'unit', opening: 'same' }, controller.signal);
  assert.equal(result.json.phase, 'restart'); assert.equal(calls, 2); assert.deepEqual(sent[0], sent[1]); assert.deepEqual(delays, [1125]);
});

import { followingRequest } from '../dist/following-transport.js';
test('online Following retries generation and keeps the controller and bearer', async t => {
  const { url } = await server(t, undefined, 'use identity\nquery count():\n  return 7\n');
  const issued = await (await defaultFetch(`${url}/auth/guest`, { method: 'POST', body: '{}' })).json();
  const sent = [];
  const client = createClient({ url, session: issued.session, fetch: async (input, init) => {
    if (new URL(input).pathname === '/following/cards') {
      sent.push({ body: init.body, credential: new Headers(init.headers).get('authorization') });
      return sent.length === 1 ? Response.json({ denied: why }, { status: 503, headers: { 'Retry-After': '1' } }) : Response.json({ phase: 'restart' });
    }
    return defaultFetch(input, init);
  } });
  t.after(() => client.close());
  assert.equal((await client.query({ kind: 'query', name: 'count', runs: 'server' }, {})).data, 7);
  const result = await followingRequest(client, { name: 'cards' }, {}, { action: 'unit', opening: 'same' });
  assert.equal(result?.phase, 'restart'); assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]);
  assert.equal(sent[0].credential, `Bearer ${issued.session.token}`); assert.equal(client.link(), 'online');
});
