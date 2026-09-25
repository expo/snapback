import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalClient } from '../dist/local.js';
import { mintId } from '../dist/client.js';
import { memoryPersistence, webDevice } from '../dist/web.js';
import { modelBackend, modelPage } from './helpers/app-model-device.mjs';

const wasm = readFileSync(new URL('../dist/wasm/snapback4_device_bg.wasm', import.meta.url));
const write = { kind: 'mutation', name: 'write' }, args = { hiddenHandle: false, refuse: false };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

for (const phase of ['first observation', 'after attach']) test(`live orphan time reaches the clock and next admission: ${phase}`, { timeout: 10_000 }, async t => {
  t.mock.method(Date, 'now', () => 1_000_000);
  const values = new Map(), originals = ['window', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key),
  } });
  t.after(() => { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const url = 'http://clock.invalid', name = `snapback4-${encodeURIComponent(`${url}:dev:alice`)}`, orphan = `${name}:tab-old`;
  const persist = memoryPersistence(), transferEntered = deferred(), releaseTransfer = deferred(), captured = deferred();
  const waitingId = mintId(), laterId = mintId();
  const entries = [1_002_000, 1_004_000].map((now, index) => ({ id: `orphan-${index}`, seq: index + 1, op: 'write', args,
    viewer: 'dev:alice', now, new_ids: [], predicted: [], predictable: false }));
  await persist.save(orphan, [{ s: 'm', k: 'device:store_id', v: 'session-model-store' },
    ...entries.map(e => ({ s: 'o', k: e.id, v: JSON.stringify(e) }))]);
  const held = await persist.claim(orphan, false);
  let holdTransfer = false, firstObservation = true, offline = false, core, client;
  const device = webDevice({ wasm, persist: { ...persist, async save(store, changes) {
    if (holdTransfer && store === name && changes.some(c => c.s === 'o' && c.k === entries[1].id && c.v)) {
      transferEntered.resolve(); await releaseTransfer.promise;
    }
    await persist.save(store, changes);
  } } });
  t.after(async () => { releaseTransfer.resolve(); await held.release(); await client?.close(); });
  client = await createLocalClient({ url, persona: 'alice', device: { async open(...opening) {
    core = await device.open(...opening);
    return { ...core, call(request, ...rest) {
      if (request.op === 'observe_store' && firstObservation) {
        firstObservation = false;
        // This is the first post-attach observation, before start() completes.
        if (phase === 'first observation') return held.release().then(() => core.call(request, ...rest));
      }
      const answer = core.call(request, ...rest);
      if (request.op === 'admit' && request.entry.id === waitingId) captured.resolve(request.entry.now);
      return answer;
    } };
  } }, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (offline || path.startsWith('/m/')) throw Error('offline');
    if (path === '/changes') return new Promise((_, reject) => {
      if (init.signal.aborted) reject(init.signal.reason);
      else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
    if (path === '/schema') return Response.json(modelBackend);
    if (path === '/probe') return Response.json({ ok: true, seq: 0, store_id: 'session-model-store' });
    if (path === '/sync') return Response.json(modelPage(0, JSON.parse(init.body)));
    throw Error(`unexpected path: ${path}`);
  } });
  offline = true; await client.sync();
  if (phase === 'after attach') {
    assert.equal(client.now(), 1_000_000);
    assert.deepEqual((await core.call({ op: 'queued' })).ok, []);
    holdTransfer = true; await held.release();
    const recovering = core.call({ op: 'observe_store', page: { ...modelPage(0, { stream: true }), requested_watermark: 0 } });
    await transferEntered.promise;
    const waiting = client.mutate(write, args, { id: waitingId });
    assert.equal(await captured.promise, 1_000_000, 'the admission was captured while recovery held the device chain');
    assert.ok([...values.values()].some(text => JSON.parse(text).entry?.id === waitingId), 'journal custody is synchronous, before recovery can commit');
    releaseTransfer.resolve();
    assert.equal((await recovering).denied, undefined);
    assert.equal((await waiting).state, 'pending');
    assert.ok((await core.call({ op: 'queued' })).ok.find(e => e.id === waitingId).now >= 1_004_000, 'an already-waiting admission is stamped after recovered time');
  }
  assert.equal(await persist.has(orphan), false);
  assert.ok(client.now() >= 1_004_000, 'the live clock adopts the recovered maximum without a reopen');
  const result = await client.mutate(write, args, { id: laterId });
  assert.equal(result.state, 'pending', JSON.stringify(result));
  const later = (await core.call({ op: 'queued' })).ok.find(e => e.id === laterId);
  assert.ok(later.now >= 1_004_000, 'a subsequent admission cannot precede the recovered row');
});
