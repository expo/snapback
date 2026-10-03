import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../dist/client.js';
import { onlineCustody } from '../dist/app-online.js';
import { memorySessionStore } from '../dist/auth.js';
import { identifyDispatch } from '../dist/online-dispatch.js';
import { pendingIntentAccess, pendingState, observeIntents } from '../dist/pending-items.js';
import { pendingItemsSource } from '../dist/react-pending-items.js';
import { waitFor } from './helpers/wait.mjs';

const send = { kind: 'mutation', name: 'send' }, query = { kind: 'query', name: 'read' };
const url = 'https://round2.invalid';
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const list = client => pendingIntentAccess(client).read();
function wire() {
  let seq = 0;
  const state = { viewer: 'alice', hold: false, gates: [],
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/probe') return Response.json({ ok: true, store_id: 'A', seq });
      if (path === '/changes') return new Promise(() => {});
      if (path === '/q/read') return Response.json({ data: [], complete: true, seq, viewer: state.viewer });
      if (path === '/m/send') {
        if (state.hold) { const gate = deferred(); state.gates.push(gate); return gate.promise; }
        return Response.json({ state: 'sent', seq: ++seq });
      }
      throw Error(path);
    },
  };
  return state;
}
function raw(t, transport, options = { session: { token: 'alice-token', principal: 'alice', kind: 'password', expiresAt: Date.now() + 7 * 86400000 } }) {
  const client = createClient({ url, ...options, fetch: transport.fetch });
  t.after(() => client.close()); return client;
}
function mount(t, client) {
  const source = pendingItemsSource(client), stop = source.subscribe(() => {});
  t.after(stop); return source;
}
async function custody(t, transport, store = memorySessionStore(), report = e => { throw e; }) {
  const client = raw(t, transport), owned = (await onlineCustody(client, url, store, report, false)).client;
  t.after(() => owned.close()); await identifyDispatch(client); return owned;
}
async function viewerRead(t, client, viewer) {
  const watch = client.observe(query, { viewer }), stop = watch.subscribe(() => {});
  t.after(() => { stop(); watch.close(); });
  await waitFor(() => client.viewer() === viewer, 'response installs viewer');
}

test('round2: raw viewer change retires queued arguments, including a late receipt and a return to Alice', async t => {
  const transport = wire(); transport.hold = true;
  const client = raw(t, transport), source = mount(t, client);
  const first = await client.mutate(send, { text: 'queued secret' }, { waitSeconds: 0 });
  await waitFor(() => transport.gates.length === 1 && source.getSnapshot().length === 1, 'held send visible');
  assert.equal((await list(client))[0].write.args.text, 'queued secret');
  transport.viewer = 'bob'; await viewerRead(t, client, 'bob');
  assert.deepEqual(await list(client), [], 'Bob cannot present Alice queue arguments');
  assert.deepEqual(await client.pendingWrites(), [], 'usePendingWrites shares the fence');
  assert.deepEqual(source.getSnapshot(), [], 'mounted source withdraws synchronously');
  transport.gates[0].resolve(Response.json({ state: 'sent', seq: 1 }));
  await waitFor(async () => (await client.write(first.id))?.state === 'sent', 'old send completes');
  assert.deepEqual(await list(client), [], 'late receipt cannot copy old args under Bob');
  transport.viewer = 'alice';
  await client.query(query, { again: true });
  assert.deepEqual(await list(client), [], 'account retirement is permanent');
});

test('round2: custody account retirement stays fenced after a return to the original viewer', async t => {
  const transport = wire(); transport.hold = true;
  const client = await custody(t, transport), source = mount(t, client);
  await client.mutate(send, { text: 'custody secret' }, { waitSeconds: 0 });
  await waitFor(() => transport.gates.length === 1 && source.getSnapshot().length === 1, 'owned queue visible');
  transport.viewer = 'bob'; await viewerRead(t, client, 'bob');
  assert.deepEqual(await list(client), []);
  transport.viewer = 'alice'; await viewerRead(t, client, 'alice');
  assert.deepEqual(await list(client), [], 'retired custody cannot reactivate its old presentation');
  assert.deepEqual(await client.pendingWrites(), [], 'retired custody cannot republish old pending arguments');
  transport.gates[0].resolve(Response.json({ state: 'sent', seq: 1 }));
});

test('round2: token-only initial viewer assignment preserves its own queued arguments', async t => {
  const transport = wire(); transport.hold = true;
  const client = raw(t, transport, { token: 'initial' }); mount(t, client);
  await client.mutate(send, { text: 'startup' }, { waitSeconds: 0 });
  await waitFor(() => transport.gates.length === 1, 'send held before identity');
  await viewerRead(t, client, 'alice');
  assert.equal((await list(client))[0]?.write.args.text, 'startup');
  transport.gates[0].resolve(Response.json({ state: 'sent', seq: 1 }));
});

for (const [count, size] of [[256, 8], [12, 100 * 1024]]) test(`round2: success survives ${count} held journal rows of ${size} bytes`, async t => {
  const transport = wire(), client = await custody(t, transport); mount(t, client);
  const success = await client.mutate(send, { text: 'keep me' });
  const original = (await list(client))[0];
  assert.equal(original.phase, 'settling');
  transport.hold = true;
  for (let i = 0; i < count; i++) await client.mutate(send, { text: 'x'.repeat(size) }, { waitSeconds: 0 });
  await waitFor(() => transport.gates.length === 1, 'head dispatched');
  const items = await list(client), pending = await client.pendingWrites();
  assert.equal(items.find(i => i.write.id === success.id), original, 'backlog cannot evict or recopy the successful reference');
  assert.equal(items.length, count + 1);
  assert.equal(new Set(items.map(i => i.write.id)).size, count + 1, 'no duplicate pending copies');
  const bytes = Buffer.byteLength(JSON.stringify(items));
  assert.ok(bytes < Buffer.byteLength(JSON.stringify(pending)) + count * 50 + 512, 'read holds only custody payload plus bounded terminal overhead');
  assert.equal((await list(client))[0], original, 'repeated reads reuse the terminal payload');
  t.diagnostic(`${count} pending: ${bytes} serialized read bytes; terminal ${Buffer.byteLength(JSON.stringify(original))} bytes`);
});

test('round2: shared journal merges pending and settling in admission order before selecting set-state', async t => {
  const transportA = wire(), transportB = wire(), store = memorySessionStore(); transportA.hold = true;
  const A = await custody(t, transportA, store), B = await custody(t, transportB, store);
  mount(t, B);
  const a = await A.mutate(send, { label: 'first', set: false }, { waitSeconds: 0 });
  await waitFor(() => transportA.gates.length === 1, 'first held');
  await list(B);
  const b = await B.mutate(send, { label: 'second', set: true });
  const items = await list(B);
  assert.equal(pendingState(items, send, { scope: () => true, current: false, value: a => a.set }).value, true, 'newer success wins over older pending value');
  assert.deepEqual(items.map(i => [i.write.id, i.phase]), [[a.id, 'unknown'], [b.id, 'settling']]);
  transportA.gates[0].resolve(Response.json({ state: 'sent', seq: 2 }));
  await waitFor(async () => (await B.write(a.id))?.state === 'sent', 'older receipt arrives later');
  const settled = await list(B);
  assert.deepEqual(settled.map(i => [i.write.id, i.phase]), [[a.id, 'settling'], [b.id, 'settling']], 'late receipt retains original admission ordinal');
  assert.equal(pendingState(settled, send, { scope: () => true, current: false, value: a => a.set }).value, true);
});

test('round2: observation survives failed receipt saves, recapture, remount and settlement retries', async t => {
  const store = memorySessionStore(), save = store.set.bind(store); let failing = true, errors = 0, last;
  store.set = async (key, value) => {
    if (failing && JSON.parse(value).receipts?.length) throw Error('receipt save unavailable');
    last = JSON.parse(value); return save(key, value);
  };
  const client = await custody(t, wire(), store, () => { errors++; });
  const source = pendingItemsSource(client); let stop = source.subscribe(() => {}); t.after(() => stop());
  const write = await client.mutate(send, { id: 'row', text: 'hello' });
  assert.equal(write.state, 'sent'); assert.ok(errors > 0);
  assert.equal(last.pending.length, 1, 'known success still has outstanding durable custody');
  assert.equal((await list(client))[0]?.phase, 'settling');
  observeIntents(client, [write.id]);
  assert.deepEqual(await list(client), [], 'read cannot resurrect observed success');
  stop(); stop = source.subscribe(() => {});
  for (let i = 0; i < 3; i++) {
    assert.equal((await client.write(write.id)).state, 'sent');
    assert.equal((await client.mutate(send, { id: 'row', text: 'hello' }, { id: write.id })).state, 'sent');
    assert.deepEqual(await list(client), [], 'failed settlement retries cannot recreate retired presentation');
  }
  failing = false;
  assert.equal((await client.write(write.id)).state, 'sent');
  assert.equal(last.pending.length, 0, 'successful retry retires custody');
  assert.deepEqual(await list(client), [], 'custody retirement does not resurrect the reference');
});
