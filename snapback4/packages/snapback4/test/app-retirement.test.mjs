import test from 'node:test';
import assert from 'node:assert/strict';
import { onlineCustody } from '../dist/app-online.js';
import { memorySessionStore } from '../dist/auth.js';
import { storeKey } from '../dist/app-storage.js';
import { RETIRED_ID_LIMIT } from '../dist/app-journal.js';
import { WRITE_HISTORY_LIMIT } from '../dist/writes.js';

const url = 'https://retirement.invalid', viewer = 'alice', key = storeKey('writes', url, viewer);
const id = n => String(n).padStart(26, '0'), op = { kind: 'mutation', name: 'charge' };
const why = code => ({ code, family: 'store', message: 'store changed; outcome unknown' });
const failed = (n, code = 'E_STORE_REPLACED') => ({ state: 'failed', id: id(n), why: why(code) });
const sent = n => ({ state: 'sent', id: id(n), seq: n, replayed: true });
const intent = n => ({ owner: viewer, id: id(n), op: op.name, args: {} });
function transport(result) {
  const posts = [];
  return { posts, raw: { viewer: () => viewer, onWrite: () => () => {}, close: async () => {}, write: async () => undefined,
    async mutate(_op, _args, { id }) { posts.push(id); return result(id); } } };
}

for (const code of ['E_STORE_REPLACED', 'E_STORE_RESTORE']) test(`settle pins ${code}, then compacts its id across normal receipt churn and reopen`, async () => {
  const store = memorySessionStore();
  await store.set(key, JSON.stringify({ owner: viewer, backend: url, pending: [], receipts: Array.from({ length: 256 }, (_, i) => sent(i + 1)) }));
  const wire = transport(value => value === id(1000) ? { ...failed(1000, code) } : { state: 'sent', id: value, seq: 300 });
  const peer = await onlineCustody(wire.raw, url, store, error => { throw error; }); // Open before the retired id exists.
  let custody = await onlineCustody(wire.raw, url, store, error => { throw error; });
  assert.equal((await custody.client.mutate(op, {}, { id: id(1000) })).why.code, code);
  assert.equal(JSON.parse(await store.get(key)).receipts.at(-1).id, id(1000));
  await custody.client.close(); custody = await onlineCustody(wire.raw, url, store, error => { throw error; });
  assert.equal((await custody.client.mutate(op, {}, { id: id(1000) })).why.code, code);
  for (let n = 2000; n < 2260; n++) await custody.client.mutate(op, {}, { id: id(n) });
  const saved = JSON.parse(await store.get(key));
  assert.equal(saved.receipts.length, WRITE_HISTORY_LIMIT);
  assert.ok(saved.retired.includes(id(1000)), 'receipt churn must keep the retired id');
  assert.ok(saved.retired.includes(id(1)), 'settlement of a store failure must preserve the sent id it displaced');
  assert.ok(!saved.retired.includes(id(2)), 'ordinary successful-write history keeps its existing eviction policy');
  assert.ok(!saved.receipts.some(write => write.id === id(1000)), 'the regression reaches body eviction');
  await custody.client.close(); custody = await onlineCustody(wire.raw, url, store, error => { throw error; });
  assert.equal((await custody.client.write(id(1000))).why.code, 'E_WRITE_RECEIPT_EXPIRED');
  assert.equal((await custody.client.mutate(op, {}, { id: id(1000) })).why.code, 'E_WRITE_RECEIPT_EXPIRED');
  assert.equal((await peer.client.mutate(op, {}, { id: id(1000) })).why.code, 'E_WRITE_RECEIPT_EXPIRED', 'another open owner checks durable retirement at admission');
  await peer.client.close();
  assert.equal(wire.posts.filter(value => value === id(1000)).length, 1, 'the retired charge never replays');
  await custody.client.close();
});

test('bulk retirement larger than the receipt window preserves every id on reopen', async () => {
  const store = memorySessionStore(), pending = Array.from({ length: 300 }, (_, n) => intent(n + 1000));
  await store.set(key, JSON.stringify({ owner: viewer, backend: url, pending, receipts: [] }));
  const wire = transport(value => ({ state: 'pending', id: value }));
  const custody = await onlineCustody(wire.raw, url, store, error => { throw error; });
  await custody.refuseStore(why('E_STORE_REPLACED')); await custody.client.close();
  const saved = JSON.parse(await store.get(key));
  assert.deepEqual(saved.pending, []); assert.equal(saved.receipts.length, 256); assert.equal(saved.retired.length, 44);
  const posts = wire.posts.length, reopened = await onlineCustody(wire.raw, url, store, error => { throw error; });
  for (const entry of pending) assert.equal((await reopened.client.mutate(op, {}, { id: entry.id })).state, 'failed');
  assert.equal(wire.posts.length, posts, 'even ids whose bodies never fit cannot replay');
  await reopened.client.close();
});

for (const sentHistory of [false, true]) test(`retirement saturation fences new admissions durably; displaced sent id: ${sentHistory}`, async () => {
  const store = memorySessionStore(), retired = Array.from({ length: RETIRED_ID_LIMIT }, (_, i) => id(10_000 + i));
  await store.set(key, JSON.stringify({ owner: viewer, backend: url, retired,
    pending: [intent(1000)], receipts: Array.from({ length: 256 }, (_, i) => sentHistory ? sent(i + 1) : failed(i + 1)) }));
  const wire = transport(value => ({ state: 'pending', id: value }));
  const custody = await onlineCustody(wire.raw, url, store, error => { throw error; });
  await custody.refuseStore(why('E_STORE_RESTORE')); await custody.client.close();
  const saved = JSON.parse(await store.get(key));
  assert.equal(saved.retirementFull, true); assert.deepEqual(saved.retired, retired);
  assert.equal(saved.receipts.length, 256); assert.deepEqual(saved.pending, []);
  const posts = wire.posts.length, reopened = await onlineCustody(wire.raw, url, store, error => { throw error; });
  for (const value of [id(1), retired[0], id(999_999)]) {
    assert.equal((await reopened.client.mutate(op, {}, { id: value })).why.code, 'E_WRITE_RECEIPT_EXPIRED');
  }
  assert.equal((await reopened.client.mutate(op, {}, { id: id(1000) })).why.code, 'E_STORE_RESTORE');
  assert.equal(wire.posts.length, posts, 'saturation cannot dispatch either an old or an unprovable new id');
  assert.deepEqual(JSON.parse(await store.get(key)).pending, []);
  await reopened.client.close();
});


test('a saturated journal recovers an already-admitted intent as pending while its delivery is held', async () => {
  const store = memorySessionStore(), pending = intent(1000);
  await store.set(key, JSON.stringify({ owner: viewer, backend: url, retirementFull: true,
    retired: Array.from({ length: RETIRED_ID_LIMIT }, (_, n) => id(10_000 + n)), pending: [pending], receipts: [] }));
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const wire = transport(async value => { await held; return { state: 'pending', id: value }; });
  const custody = await onlineCustody(wire.raw, url, store, error => { throw error; });
  try {
    assert.deepEqual(await custody.client.write(pending.id), { state: 'pending', id: pending.id });
    assert.equal(wire.posts.length, 1, 'the held request belongs to the durable intent admitted before saturation');
    const duplicate = custody.client.mutate(op, {}, { id: pending.id });
    release();
    assert.equal((await duplicate).state, 'pending', 'recovery must not replace a pending intent with receipt expiry');
    assert.deepEqual(JSON.parse(await store.get(key)).pending, [pending]);
    assert.equal((await custody.client.mutate(op, {}, { id: id(9999) })).why.code, 'E_WRITE_RECEIPT_EXPIRED');
    assert.equal(wire.posts.length, 1, 'saturation still blocks new admissions');
  } finally { release(); await custody.client.close(); }
});
