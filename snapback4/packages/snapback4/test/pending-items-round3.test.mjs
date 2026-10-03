import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient, mintId } from '../dist/client.js';
import { onlineCustody } from '../dist/app-online.js';
import { storeKey } from '../dist/app-storage.js';
import { memorySessionStore } from '../dist/auth.js';
import { identifyDispatch } from '../dist/online-dispatch.js';
import { pendingIntentAccess, pendingItems, pendingState, observeIntents } from '../dist/pending-items.js';
import { pendingItemsSource } from '../dist/react-pending-items.js';
import { waitFor } from './helpers/wait.mjs';

const send = { kind: 'mutation', name: 'send' }, set = { kind: 'mutation', name: 'set' };
const query = { kind: 'query', name: 'read' }, url = 'https://round3.invalid';
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const list = client => pendingIntentAccess(client).read();
function wire() {
  let seq = 0;
  const state = { viewer: 'alice', hold: false, gates: [],
    fetch: async input => {
      const path = new URL(input).pathname;
      if (path === '/probe') return Response.json({ ok: true, store_id: 'A', seq });
      if (path === '/changes') return new Promise(() => {});
      if (path === '/q/read') return Response.json({ data: [], complete: true, seq, viewer: state.viewer });
      if (path === '/m/send' || path === '/m/set') {
        if (state.hold) { const gate = deferred(); state.gates.push(gate); return gate.promise; }
        return Response.json({ state: 'sent', seq: ++seq });
      }
      throw Error(path);
    },
  };
  return state;
}
function raw(t, transport) {
  const client = createClient({ url, session: { token: 'alice-token', principal: 'alice', kind: 'password', expiresAt: Date.now() + 7 * 86400000 }, fetch: transport.fetch });
  t.after(() => client.close()); return client;
}
function mount(t, client, select) {
  const source = pendingItemsSource(client), stop = source.subscribe(() => {}, select);
  t.after(stop); return source;
}
async function custody(t, transport, store) {
  const client = raw(t, transport), owned = (await onlineCustody(client, url, store, e => { throw e; }, false)).client;
  t.after(() => owned.close()); await identifyDispatch(client); return owned;
}
async function viewerRead(client, transport, viewer) {
  transport.viewer = viewer;
  await client.query(query, { viewer });
  assert.equal(client.viewer(), viewer);
}

for (const [count, bytes] of [[2, 600_000], [256, 1]]) test(`round3: ${count} settled sends of ${bytes} bytes cannot revive an older pending toggle`, async t => {
  const store = memorySessionStore(), ta = wire(), tb = wire(); ta.hold = true;
  const A = await custody(t, ta, store), B = await custody(t, tb, store);
  const source = mount(t, B, write => write.args.resource === 'post' || write.op === 'send');
  const options = { scope: w => w.args.resource === 'post', current: 'CURRENT', value: args => args.set };
  const older = await A.mutate(set, { resource: 'post', set: false }, { waitSeconds: 0 });
  await waitFor(() => ta.gates.length === 1, 'older toggle held');
  await list(B);
  const newer = await B.mutate(set, { resource: 'post', set: true, secret: 'evicted-toggle-payload' });
  const original = (await list(B)).find(i => i.write.id === newer.id);
  assert.equal(pendingState(await list(B), set, options).value, true);
  for (let i = 0; i < count; i++) assert.equal((await B.mutate(send, { text: 'x'.repeat(bytes) })).state, 'sent');
  const items = await list(B);
  assert.deepEqual(pendingState(items, set, options), { value: 'CURRENT', intent: undefined }, 'evicted newer success clears the older pending selection');
  assert.equal(original.phase, 'evicted');
  const marker = items.find(i => i.write.id === newer.id);
  assert.equal(marker?.phase, 'evicted', 'admission order retains an eviction marker');
  assert.equal(marker.write.args, undefined, 'marker retains no argument payload');
  assert.ok(items.findIndex(i => i.write.id === older.id) < items.indexOf(marker));
  assert.equal(JSON.stringify(items).includes('evicted-toggle-payload'), false);
  const cards = pendingItems(items, { writes: [set], rows: [], scope: options.scope, rowKey: r => r.id, intentKey: w => w.id });
  assert.deepEqual(cards.map(i => i.write.id), [older.id], 'eviction metadata is not an intent card');
  await waitFor(() => source.getSnapshot().some(i => i.phase === 'evicted'), 'mounted snapshot keeps the barrier');
  assert.equal(pendingState(source.getSnapshot(), set, options).value, 'CURRENT');
  t.diagnostic(`${count} settles: ${items.filter(i => i.phase === 'settling').length} terminal payloads, ${Buffer.byteLength(JSON.stringify(items))} total serialized bytes`);
  ta.gates[0].resolve(Response.json({ state: 'sent', seq: 300 }));
  await waitFor(async () => (await B.write(older.id))?.state === 'sent', 'older toggle settles after eviction');
  assert.equal(pendingState(await list(B), set, options).value, 'CURRENT', 'late settlement cannot pass the admission barrier');
  const later = await B.mutate(set, { resource: 'post', set: 'LATER' });
  assert.equal(pendingState(await list(B), set, options).intent?.write.id, later.id, 'later non-evicted match overrides the barrier');
  observeIntents(B, [older.id, later.id]);
  assert.equal((await list(B)).some(i => i.phase === 'evicted'), false, 'markers release when no older owned intent remains');
});

test('round3: a viewer round trip during the opening journal read permanently retires custody', async t => {
  const store = memorySessionStore(), key = storeKey('writes', url, 'alice');
  await store.set(key, JSON.stringify({ owner: 'alice', backend: url, receipts: [], pending: [
    { owner: 'alice', id: mintId(), op: 'send', args: { text: 'startup-secret' }, storeId: 'A', dispatched: false },
  ] }));
  const entered = deferred(), release = deferred(), get = store.get.bind(store);
  let first = true, resolved = false;
  store.get = async name => { if (name === key && first) { first = false; entered.resolve(); await release.promise; } return get(name); };
  t.after(() => release.resolve());
  const transport = wire(), client = raw(t, transport);
  const opening = onlineCustody(client, url, store, e => { throw e; }, false).then(value => { resolved = true; return value; });
  await entered.promise;
  await viewerRead(client, transport, 'bob');
  await viewerRead(client, transport, 'alice');
  assert.equal(resolved, false, 'the whole round trip precedes custody initialization');
  release.resolve();
  const owned = (await opening).client; t.after(() => owned.close());
  const source = mount(t, owned);
  assert.deepEqual(await list(owned), [], 'startup-secret cannot be republished by retired custody');
  assert.deepEqual(await owned.pendingWrites(), []);
  assert.deepEqual(source.getSnapshot(), []);
  assert.equal(JSON.parse(await get(key)).pending[0].args.text, 'startup-secret', 'presentation retirement does not erase durable custody');
});

test('round3: raw Alice to Bob to Alice stays empty before and after the held reply settles', async t => {
  const transport = wire(); transport.hold = true;
  const client = raw(t, transport), source = mount(t, client);
  const write = await client.mutate(send, { text: 'raw-roundtrip-secret' }, { waitSeconds: 0 });
  await waitFor(() => transport.gates.length === 1 && source.getSnapshot().length === 1, 'held raw send visible');
  await viewerRead(client, transport, 'bob');
  await viewerRead(client, transport, 'alice');
  const empty = async when => {
    assert.deepEqual(await list(client), [], `presentation ${when}`);
    assert.deepEqual(await client.pendingWrites(), [], `ordinary pending list ${when}`);
    assert.deepEqual(source.getSnapshot(), [], `mounted snapshot ${when}`);
  };
  await empty('before settlement');
  transport.gates[0].resolve(Response.json({ state: 'sent', seq: 1 }));
  await waitFor(async () => (await client.write(write.id))?.state === 'sent', 'held reply settles after return to Alice');
  await empty('after settlement');
});

test('round3: the client guide distinguishes prediction withdrawal from confirmed retirement', () => {
  const guide = readFileSync(new URL('../CLIENT-AND-OPERATIONS.md', import.meta.url), 'utf8');
  const paragraph = guide.slice(guide.indexOf('Items are `{ kind: "row"'), guide.indexOf('Phases: `saving`'));
  assert.match(paragraph, /Withdrawing a prediction reveals the intent again; a confirmed row retires it\./);
});
