import test from 'node:test';
import assert from 'node:assert/strict';
import { journalReader } from '../dist/app-journal.js';
import { onlineCustody } from '../dist/app-online.js';
import { memorySessionStore } from '../dist/auth.js';
import { mintId } from '../dist/client.js';
import { trackDispatch } from '../dist/online-dispatch.js';
import { storeKey } from '../dist/app-storage.js';

const url = 'https://settlement-receipt.invalid', owner = 'alice', key = storeKey('writes', url, owner);
const fail = error => { throw error; };
test('receipt: older-shape success and refusal still read without quarantine', async () => {
  const store = memorySessionStore(), receipts = [{ state: 'sent', id: mintId(), seq: 21, replayed: true },
    { state: 'failed', id: mintId(), why: { code: 'NO', family: 'input', message: 'write refused: NO' } }];
  const journal = { owner, backend: url, pending: [], receipts };
  await store.set(key, JSON.stringify(journal));
  assert.deepEqual(await journalReader(key, owner, url, store, fail, true)(), journal);
  assert.deepEqual(await journalReader(key, owner, url, store, fail)(), journal);
});

for (const state of ['sent', 'failed']) for (const metadata of ['known', 'intent-only'])
test(`receipt: ${state} ${metadata} metadata round-trips without disclosure`, async t => {
  const store = memorySessionStore(), id = mintId(), secret = 'never persist this payload';
  const outcome = state === 'sent' ? { state, id, seq: 21, result: { secret } }
    : { state, id, why: { code: 'NOT_ALLOWED', family: 'auth', message: secret, details: { secret }, rewrite: secret } };
  if (metadata === 'known') Object.assign(outcome, { store_id: 'execution-store', generation: 7, op: 'executed-op', preserved: ['items'], args: { secret } });
  const raw = { viewer: () => owner, onViewer: () => () => {}, onWrite: () => () => {},
    mutate: async () => outcome, write: async () => undefined, pendingWrites: async () => [], close: async () => {}, signOut: async () => {} };
  trackDispatch(raw, { store: 'intent-store' });
  const custody = await onlineCustody(raw, url, store, fail); t.after(() => custody.client.close());
  assert.equal(await custody.client.mutate({ kind: 'mutation', name: 'write' }, { secret }, { id }), outcome, 'owner still gets the complete live outcome');
  const expected = { ...(metadata === 'known' ? { storeId: 'execution-store', generation: 7, op: 'executed-op' } : { storeId: 'intent-store', op: 'write' }),
    ...(state === 'sent' ? { state, id, seq: 21, replayed: true } : { state, id, why: { code: 'NOT_ALLOWED', family: 'auth', message: 'write refused: NOT_ALLOWED' } }) };
  const saved = await journalReader(key, owner, url, store, fail, true)();
  assert.deepEqual(saved.receipts, [expected]); assert.deepEqual(saved.pending, []);
  assert.deepEqual((await custody.inspect()).receipts, [expected]);
  assert.deepEqual(await custody.client.write(id), expected);
  const reopened = await onlineCustody(raw, url, store, fail, false); t.after(() => reopened.client.close());
  assert.deepEqual((await reopened.inspect()).receipts, [expected]);
  assert.deepEqual(await reopened.client.write(id), expected);
  const text = await store.get(key);
  assert.equal(text.includes(secret), false);
  for (const forbidden of ['args', 'result', 'details', 'rewrite', 'preserved']) assert.equal(Object.hasOwn(saved.receipts[0], forbidden), false);
  assert.equal(JSON.stringify(saved.receipts[0]).includes('details'), false);
});
