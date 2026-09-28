import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { ephemeralServer, device, api, until } from './helpers/ephemeral-server.mjs';

for (const tier of ['online', 'wasm']) test(`${tier}: lane order, renewal suppression, refusals, bound and offline waiting`, async t => {
  const { url } = await ephemeralServer(t), calls = [], events = [];
  let admissions = 0;
  const underlying = device();
  const opener = { ...underlying, async open(...args) {
    const core = await underlying.open(...args);
    return { ...core, async call(request, ...rest) { if (request.op === 'admit') admissions++; return core.call(request, ...rest); } };
  } };
  const fetch = async (input, init) => {
    if (!new URL(input).pathname.startsWith('/m/')) return defaultFetch(input, init);
    return new Promise((resolve, reject) => calls.push({ name: input.split('/m/')[1], body: JSON.parse(init.body),
      sent: () => resolve(Response.json({ state: 'sent', result: null })),
      failed: code => resolve(Response.json({ state: 'failed', why: { code, family: 'auth', message: 'refused', retryable: true } })), reject }));
  };
  const client = tier === 'online' ? createClient({ url, persona: 'alice', fetch })
    : await createLocalClient({ url, persona: 'alice', fetch, device: opener });
  t.after(() => client.close());
  if (client.sync) await client.sync(); client.onWrite(write => events.push(write));
  const set = () => client.mutate(api.setTyping, { room: 'r' });
  const stop = () => client.mutate(api.stopTyping, { room: 'r' });
  const first = set(), replaced = set(), replacement = set(), stopped = stop();
  assert.equal(calls.length, 1); calls[0].sent(); await first;
  await until(() => calls.length === 2); assert.equal(calls[1].name, 'setTyping'); calls[1].sent();
  assert.deepEqual(await replaced, await replacement);
  await until(() => calls.length === 3); assert.equal(calls[2].name, 'stopTyping'); calls[2].sent(); await stopped;
  const afterStop = set(), dequeue = set(); assert.equal(calls.length, 4); calls[3].sent();
  const success = await afterStop;
  assert.deepEqual(await dequeue, success, 'dequeue window suppresses renewal');
  assert.deepEqual(await set(), success, 'call-time window suppresses renewal');
  assert.equal(calls.length, 4);
  const stop1 = stop(), stop2 = stop(); calls[4].sent(); await stop1;
  await until(() => calls.length === 6); calls[5].sent(); await stop2;
  for (const code of ['E_RATE_LIMIT', 'E_EPHEMERAL_FULL']) {
    const result = stop(); calls.at(-1).failed(code); assert.equal((await result).why.code, code);
    assert.equal(client.link(), 'online');
  }
  const inFlight = stop(), waiting = Array.from({ length: 256 }, stop);
  assert.equal((await stop()).why.code, 'E_RATE_LIMIT');
  const count = calls.length; calls.at(-1).reject(Error('lost transport'));
  assert.equal((await inFlight).why.code, 'E_OFFLINE');
  assert.ok((await Promise.all(waiting)).every(result => result.why.code === 'E_OFFLINE'));
  assert.equal((await set()).why.code, 'E_OFFLINE'); assert.equal(calls.length, count);
  assert.deepEqual(events, []); assert.equal(admissions, 0);
  assert.equal(await client.write(success.id), undefined);
});
