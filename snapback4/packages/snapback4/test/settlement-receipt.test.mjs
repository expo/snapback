import test from 'node:test';
import assert from 'node:assert/strict';
import { journalReader } from '../dist/app-journal.js';
import { onlineCustody } from '../dist/app-online.js';
import { memorySessionStore } from '../dist/auth.js';
import { mintId } from '../dist/client.js';
import { trackDispatch } from '../dist/online-dispatch.js';
import { ProgressiveWrites, prepareProgressiveWrites } from '../dist/progressive-writes.js';
import { fixture, until, mutation } from './helpers/progressive-writes.mjs';
import { journalChanges } from '../dist/journal-changes.js';
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
  const notifications = []; custody.client.onWrite(write => notifications.push(write));
  assert.equal(await custody.client.mutate({ kind: 'mutation', name: 'write' }, { secret }, { id }), outcome, 'owner still gets the complete live outcome');
  assert.equal(notifications.length, 1);
  for (const field of ['storeId', 'store_id', 'generation', 'op']) assert.equal(Object.hasOwn(notifications[0], field), false);
  const expected = { ...(metadata === 'known' ? { storeId: 'execution-store', generation: 7, op: 'executed-op' } : { storeId: 'intent-store', op: 'write' }),
    ...(state === 'sent' ? { state, id, seq: 21, replayed: true } : { state, id, why: { code: 'NOT_ALLOWED', family: 'auth', message: 'write refused: NOT_ALLOWED' } }) };
  const saved = await journalReader(key, owner, url, store, fail, true)();
  assert.deepEqual(saved.receipts, [expected]); assert.deepEqual(saved.pending, []);
  assert.deepEqual((await custody.inspect()).receipts, [expected]);
  const { storeId: _store, generation: _generation, op: _op, ...publicExpected } = expected;
  assert.deepEqual(await custody.client.write(id), publicExpected);
  assert.deepEqual(await custody.client.mutate({ kind: 'mutation', name: 'write' }, { secret }, { id }), publicExpected);
  const reopened = await onlineCustody(raw, url, store, fail, false); t.after(() => reopened.client.close());
  assert.deepEqual((await reopened.inspect()).receipts, [expected]);
  assert.deepEqual(await reopened.client.write(id), publicExpected);
  assert.deepEqual(await reopened.client.mutate({ kind: 'mutation', name: 'write' }, { secret }, { id }), publicExpected);
  const text = await store.get(key);
  assert.equal(text.includes(secret), false);
  for (const forbidden of ['args', 'result', 'details', 'rewrite', 'preserved']) assert.equal(Object.hasOwn(saved.receipts[0], forbidden), false);
  assert.equal(JSON.stringify(saved.receipts[0]).includes('details'), false);
});

test('S2a 15: progressive outbox recovers an initial journal receipt without internal metadata', async () => {
  const store = memorySessionStore(), id = mintId(), options = {};
  const receipt = { state: 'sent', id, seq: 21, replayed: true, storeId: 'A', generation: 7, op: 'write' };
  await store.set(key, JSON.stringify({ owner, backend: url, pending: [], receipts: [receipt] }));
  prepareProgressiveWrites(options, { store, report: fail });
  const writes = ProgressiveWrites.for(options, url, owner);
  await writes.decide('receipt-session', async () => 'present'); await writes.compatible();
  assert.equal(writes.owner, 'outbox');
  const unexpected = () => { throw Error('must recover recorded journal receipt'); };
  const local = { viewer: () => owner, onViewer: () => () => {}, onWrite: () => () => {},
    mutate: unexpected, write: unexpected, pendingWrites: async () => [], close: async () => {}, signOut: async () => {} };
  await writes.install(local, 'A', unexpected, () => {}, () => false);
  const expected = { state: 'sent', id, seq: 21, replayed: true };
  assert.deepEqual(await local.write(id), expected);
  assert.deepEqual(await local.mutate(mutation, {}, { id }), expected);
  assert.deepEqual(JSON.parse(await store.get(key)).receipts, [receipt]);
});

test('S2a 15: progressive inspection learns a peer receipt but public lookup and same-id recovery strip bindings', async t => {
  const f = await fixture(t); await f.app.ready;
  const id = mintId(); await f.app.mutate(mutation, {}, { id, waitSeconds: 0 }); await f.posted.promise;
  const saved = await f.journal(), receipt = { state: 'sent', id, seq: 21, replayed: true, storeId: 'A', generation: 7, op: 'write' };
  saved.pending = []; saved.receipts = [receipt];
  await f.store.set(storeKey('writes', f.url, 'alice'), JSON.stringify(saved));
  const changes = journalChanges(storeKey('writes', f.url, 'alice')); changes.notify(); t.after(() => changes.close());
  await until(async () => (await f.app.client.pendingWrites()).length === 0);
  const expected = { state: 'sent', id, seq: 21, replayed: true };
  assert.deepEqual(await f.app.client.write(id), expected);
  assert.deepEqual(await f.app.mutate(mutation, {}, { id }), expected);
  assert.deepEqual((await f.journal()).receipts, [receipt]);
});
