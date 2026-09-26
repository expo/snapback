import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { createApp } from '../dist/app.js';
import { memorySessionStore } from '../dist/auth.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { ephemeralServer, device, api } from './helpers/ephemeral-server.mjs';

for (const tier of ['online', 'wasm', 'app-online', 'app-wasm']) test(`${tier}: ephemeral bypasses writes, admission and journals`, async t => {
  const { url } = await ephemeralServer(t), requests = [], calls = [];
  let down = false, storeWrites = 0;
  const underlying = device(), storage = memorySessionStore();
  const opener = { ...underlying, async open(...args) {
    const core = await underlying.open(...args);
    return { ...core, async call(request, ...rest) { calls.push(request.op); return core.call(request, ...rest); } };
  } };
  const fetch = async (url, init) => {
    if (down) throw Error('offline');
    requests.push({ path: new URL(url).pathname, body: init?.body && JSON.parse(init.body) });
    return defaultFetch(url, init);
  };
  let client, app;
  if (tier.startsWith('app')) {
    app = createApp({ url, fetch, ...(tier === 'app-wasm' ? { device: opener } : {}),
      sessionStore: { ...storage, async set(...args) { storeWrites++; return storage.set(...args); } } });
    t.after(() => app.close()); await app.ready; assert.equal((await app.auth.guest()).ok, true); client = app.client;
  } else {
    client = tier === 'wasm' ? await createLocalClient({ url, fetch, persona: 'alice', device: opener }) : createClient({ url, fetch, persona: 'alice' });
    t.after(() => client.close());
  }
  if (client.sync) await client.sync();
  await client.query(api.list, {}); // settle startup before counting custody.
  // Exercise the browser-only admission branches too: no journal or
  // synchronous session reader exists in this deliberately minimal fixture.
  const previousWindow = globalThis.window;
  globalThis.window = { location: { href: url } };
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  const written = [], storeBefore = storeWrites;
  client.onWrite(write => written.push(write)); calls.length = 0;
  const signal = await (app ?? client).mutate(api.setTyping, { room: 'room' });
  assert.equal(signal.state, 'sent', JSON.stringify(signal)); assert.equal('seq' in signal, false);
  assert.equal(await client.write(signal.id), undefined); assert.deepEqual(written, []);
  assert.ok(!calls.includes('admit')); assert.equal(storeWrites, storeBefore);
  const sent = requests.find(request => request.path === '/m/setTyping');
  assert.ok(sent); assert.equal('newIds' in sent.body, false); assert.equal('new_ids' in sent.body, false);
  // Losing a real request transitions the sender offline; subsequent calls do not dispatch.
  down = true;
  assert.equal((await client.mutate(api.stopTyping, { room: 'room' })).why.code, 'E_OFFLINE');
  const count = requests.length;
  assert.equal((await client.mutate(api.setTyping, { room: 'room' })).why.code, 'E_OFFLINE');
  assert.equal(requests.length, count); assert.deepEqual(written, []);
  assert.ok(!calls.includes('admit')); assert.equal(storeWrites, storeBefore);
});

for (const tier of ['app-online', 'app-wasm']) test(`${tier}: session storage waits stay inside the bounded lane`, async t => {
  const { url } = await ephemeralServer(t), storage = memorySessionStore();
  let hold, release, down = false;
  const fetch = (url, init) => { if (down) throw Error('offline'); return defaultFetch(url, init); };
  const app = createApp({ url, fetch, ...(tier === 'app-wasm' ? { device: device() } : {}),
    sessionStore: { ...storage, async get(key) { if (hold) await hold; return storage.get(key); } } });
  t.after(async () => { release?.(); await app.close(); });
  await app.ready; assert.equal((await app.auth.guest()).ok, true);
  if (app.client.sync) await app.client.sync();
  await app.client.query(api.list, {});
  hold = new Promise(resolve => { release = resolve; });
  const first = app.mutate(api.stopTyping, { room: 'r' });
  const waiting = Array.from({ length: 256 }, () => app.mutate(api.stopTyping, { room: 'r' }));
  let overflow;
  void app.mutate(api.stopTyping, { room: 'r' }).then(value => { overflow = value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(overflow?.why.code, 'E_RATE_LIMIT', 'no asynchronous queue before the lane');
  down = true; hold = undefined; release();
  assert.equal((await first).why.code, 'E_OFFLINE');
  assert.ok((await Promise.all(waiting)).every(value => value.why.code === 'E_OFFLINE'));
});
