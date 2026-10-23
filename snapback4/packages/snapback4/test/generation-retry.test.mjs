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
