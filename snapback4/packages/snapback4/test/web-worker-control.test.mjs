import test from 'node:test';
import assert from 'node:assert/strict';
import { PageDeviceControl, coldReadControl, coldSnapshot, coldReplyMatches } from '../dist/device-control.js';
import { evaluateLocal } from '../dist/local-query.js';
import { RememberedAnswers } from '../dist/local-reads.js';
import { EphemeralReads } from '../dist/ephemeral-reads.js';

const snapshot = (changes = {}) => ({ store_id: 'store', transfer_store_id: 'store', generation: 1,
  acquired: false, acquisition: 1, queuedRevision: 0, issuedFloor: 10, predictions: [],
  watermark: 4, restore_watermark: 4, restore_images_at: 5, send_revision: 0, ...changes });
function fixture(changes = {}) {
  const page = new PageDeviceControl(); page.publish(snapshot(changes));
  const counters = { posts: 0, calls: 0 };
  const env = { backend: { programs: [], schema: { operations: {}, tables: {} } },
    coldRead: coldReadControl(() => page.read(), page.read()),
    ephemeralReads: new EphemeralReads(new AbortController().signal),
    partitionDenied: null, credentialRevision: 0, incarnation: 0, authority: 0, refreshing: null,
    link: 'online', caughtUp: false, identityChecked: true, lastSyncAt: 0, principal: 'alice',
    partitionCurrent: true, nativeReady: false, signal: new AbortController().signal,
    unavailable: () => null, queued: async () => { throw Error('queued behind busy Worker'); },
    call: async () => { counters.calls++; throw Error('call behind busy Worker'); },
    post: async () => { counters.posts++; return { ok: true, obsoleteAuth: false, json: { data: ['live'], seq: 5 } }; },
    installNative: async () => false, notify() {}, offline: () => ({ code: 'E_OFFLINE' }),
    deviceNow: () => 10, serverNow: () => 10, serverAnswers: new RememberedAnswers().view() };
  return { page, env, counters, run: () => evaluateLocal(env, { name: 'read', kind: 'query' }, {}, 0, 0) };
}
test('cold server watch bypasses a busy VM at dispatch and delivery', async () => {
  const f = fixture();
  assert.deepEqual((await f.run()).read.data, ['live']);
  assert.equal(f.counters.posts, 1); assert.equal(f.counters.calls, 0);
});
test('synchronous admission blocks before transfer; an older completion cannot clear it', async () => {
  const f = fixture(); f.page.capture('new'); f.page.publish(snapshot());
  assert.equal(f.page.read().predictions, null);
  assert.deepEqual((await f.run()).read, { loading: true });
  assert.equal(f.counters.posts, 0);
  f.page.admitted('older'); assert.equal(f.page.read().predictions, null);
  f.page.admitted('new'); assert.deepEqual(f.page.read().predictions, []);
});
for (const [name, change] of Object.entries({ unknown: { predictions: null }, prediction: { predictions: ['messages'] } })) {
  test(`${name} prediction blocks opaque reads`, async () => {
    const f = fixture(change); assert.deepEqual((await f.run()).read, { loading: true }); assert.equal(f.counters.posts, 0);
  });
}
test('held queries stay loading without local composition or a server call', async () => {
  const f = fixture(); f.env.backend.schema.operations.read = { held: true };
  assert.deepEqual((await f.run()).read, { loading: true }); assert.equal(f.counters.posts, 0);
});
for (const [name, change] of Object.entries({ store: { store_id: 'other' }, generation: { generation: 2 },
  acquisition: { acquisition: 2 }, publication: { acquired: true }, queue: { queuedRevision: 1 },
  send: { send_revision: 1 }, clock: { issuedFloor: 11 }, backend: { backend_required: true } })) {
  test(`${name} fences a delayed server answer`, async () => {
    const f = fixture(); f.env.post = async () => { f.page.publish(snapshot(change)); return { ok: true, json: { data: ['stale'] } }; };
    assert.deepEqual((await f.run()).read, { loading: true });
  });
}
test('expiry withdraws a server response and a 503 leaves the next refresh runnable', async () => {
  const f = fixture(); const ordinary = f.env.post;
  f.env.post = async () => ({ ok: true, json: { data: ['expired'], nextExpiry: 9 } });
  assert.deepEqual((await f.run()).read, { loading: true });
  f.env.post = async () => ({ ok: false }); assert.deepEqual((await f.run()).read, { loading: true });
  f.env.post = ordinary; assert.deepEqual((await f.run()).read.data, ['live']);
});
test('credentials and authority still fence delayed bypass responses', async () => {
  for (const key of ['credentialRevision', 'authority', 'incarnation']) {
    const f = fixture(); f.env.post = async () => { f.env[key]++; return { ok: true, json: { data: ['stale'] } }; };
    if (key === 'credentialRevision') {
      // A rotation retries with the new credential; stop the subsequent request.
      let n = 0; f.env.post = async () => { if (n++) return { ok: false }; f.env[key]++; return { ok: true, json: { data: ['stale'] } }; };
    }
    assert.deepEqual((await f.run()).read, { loading: true });
  }
});
test('only eligible cold watches receive the capability; restart cannot revive an old revision', () => {
  const page = new PageDeviceControl(); page.publish(snapshot()); const before = page.read();
  assert.equal(coldSnapshot(() => before, false, 1), undefined);
  assert.equal(coldSnapshot(() => before, true, 2), undefined);
  page.discard(); page.publish(snapshot()); assert.equal(coldReadControl(() => page.read(), before).current(), false);
});
test('transport keeps store and retained-image floors and omits supplementary manifests', () => {
  for (const body of [{ store_id: 'other', head: 10 }, { store_id: 'store', head: 4 }, { store_id: 'store' }]) assert.equal(coldReplyMatches(snapshot(), body), false);
  const body = { store_id: 'store', head: 5, delivery: {} };
  assert.equal(coldReplyMatches(snapshot(), body), true); assert.equal(body.delivery, undefined);
});
test('a transient Worker fence withholds cold fallback without queueing a VM read', async () => {
  const f = fixture(); const unblock = f.page.block();
  const blocked = coldSnapshot(() => f.page.read(), true, 1);
  assert.ok(blocked, 'keep the cold path while authority is unknown');
  assert.equal(blocked.snapshot.predictions, null);
  f.env.coldRead = blocked.control;
  assert.deepEqual((await f.run()).read, { loading: true });
  assert.equal(f.counters.calls, 0); assert.equal(f.counters.posts, 0);
  unblock(); assert.equal(blocked.control.current(), false);
  f.env.coldRead = coldSnapshot(() => f.page.read(), true, 1).control;
  assert.deepEqual((await f.run()).read.data, ['live']);
});
