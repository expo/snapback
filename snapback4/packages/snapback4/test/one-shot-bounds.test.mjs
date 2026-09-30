import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { setup, q, m, until } from './helpers/one-shot.mjs';
import { QUERY_LIFETIME, QUERY_ROUNDS } from '../dist/query-settlement.js';

const tiers = ['online', 'wasm', 'process', 'app-online', 'app-wasm', 'app-process'];
// Exercise the actual deadline callback quickly, asserting its production delay.
// The independent 2s watchdog never calls the SDK's timer or resolves its query.
function accelerate(t) {
  assert.equal(QUERY_LIFETIME, 30_000); assert.equal(QUERY_ROUNDS, 4);
  const set = globalThis.setTimeout; let count = 0;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => {
    if (ms === QUERY_LIFETIME) { count++; return set(fn, 80, ...args); }
    return set(fn, ms, ...args);
  });
  return () => count;
}
async function bounded(work) {
  const controller = new AbortController();
  try {
    return await Promise.race([work, delay(2000, undefined, { signal: controller.signal }).then(() => { throw Error('independent one-shot watchdog'); })]);
  } finally { controller.abort(); }
}

for (const tier of tiers) {
  test(`${tier}: four retired publications refuse with a retryable code`, async t => {
    const f = await setup(t, tier); let rounds = 0;
    f.controls.boundary = async () => {
      rounds++;
      await f.client.mutate(m('edit'), { body: `round-${rounds}` });
    };
    const read = await bounded(f.client.query(q('item'), {}));
    assert.equal(rounds, 4); assert.equal(read.denied?.code, 'E_QUERY_RETRY');
    assert.equal(read.denied.retryable, true);
  });
  test(`${tier}: ignored transport abort still settles and fences the late answer`, async t => {
    const gate = Promise.withResolvers(); let block = false, started = false, signal;
    t.after(() => gate.resolve());
    const f = await setup(t, tier, { fetch: async (path, init, send) => {
      if (block && path === '/q/profile') {
        started = true; signal = init.signal;
        const response = await send(); await gate.promise; return response;
      }
      return send();
    } });
    const timers = accelerate(t); block = true;
    const read = await bounded(f.client.query(q('profile'), {}));
    assert.ok(started); assert.equal(timers(), 1, 'facade and raw client share one timer');
    assert.equal(read.denied?.code, 'E_QUERY_RETRY'); assert.equal(read.denied.retryable, true);
    assert.equal(signal.aborted, true);
    gate.resolve(); block = false; await delay(20);
    assert.equal((await f.client.query(q('profile'), {})).data?.name, 'Bob');
  });
  for (const end of ['close', 'signOut']) test(`${tier}: ${end} settles an outstanding one-shot without waiting for transport`, async t => {
    const gate = Promise.withResolvers(); let block = false, started = false;
    t.after(() => gate.resolve());
    const f = await setup(t, tier, { fetch: async (path, init, send) => {
      if (block && path === '/q/profile') { started = true; await gate.promise; }
      return send();
    } });
    block = true; const query = f.client.query(q('profile'), {});
    await until(() => started);
    const ending = end === 'close' ? (f.app ?? f.client).close() : f.client.signOut();
    const read = await bounded(query);
    assert.ok(['E_CLOSED', 'E_AUTH'].includes(read.denied?.code), JSON.stringify(read));
    gate.resolve(); await ending;
  });
}

for (const tier of ['wasm', 'process', 'app-wasm', 'app-process']) {
  test(`${tier}: device queue wait behind observations is inside the one-shot deadline`, async t => {
    const gate = Promise.withResolvers(); let blocked = false, starts = 0;
    const watches = [];
    t.after(() => { blocked = false; gate.resolve(); watches.forEach(w => w.close()); });
    const f = await setup(t, tier, { device: core => ({ ...core, async call(request, commit) {
      // Model an occupied host IPC/persistence queue with real device replies.
      if (blocked && request.op === 'query') { starts++; await gate.promise; }
      return core.call(request, commit);
    } }) });
    blocked = true;
    for (let n = 0; n < 32; n++) { const w = f.client.observe(q('keyed'), { tag: n }); w.subscribe(() => {}); watches.push(w); }
    await until(() => starts >= 8);
    accelerate(t);
    const read = await bounded(f.client.query(q('item'), {}));
    assert.equal(read.denied?.code, 'E_QUERY_RETRY');
    assert.equal(starts, 9, 'one-shot uses the same host while the observation slots remain occupied');
    blocked = false; gate.resolve();
  });
  test(`${tier}: an unexpired permitted remembered answer still serves offline`, async t => {
    const f = await setup(t, tier);
    assert.equal((await f.client.query(q('profile'), {})).data?.name, 'Bob');
    await f.offline();
    const read = await f.client.query(q('profile'), {});
    assert.equal(read.data?.name, 'Bob'); assert.equal(read.fresh, false);
  });
}

for (const tier of ['app-online', 'app-wasm', 'app-process']) test(`${tier}: blocked facade authority shares the same deadline`, async t => {
  const f = await setup(t, tier), gate = Promise.withResolvers();
  t.after(() => gate.resolve());
  const timers = accelerate(t);
  f.controls.authority = () => gate.promise;
  const read = await bounded(f.client.query(q('item'), {}));
  assert.equal(read.denied?.code, 'E_QUERY_RETRY'); assert.equal(timers(), 1);
  gate.resolve(); delete f.controls.authority;
});
