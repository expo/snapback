import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, mintId } from '../dist/client.js';
import { onlineCustody } from '../dist/app-online.js';
import { memorySessionStore } from '../dist/auth.js';
import { identifyDispatch } from '../dist/online-dispatch.js';
import { pendingIntentAccess, observeIntents } from '../dist/pending-items.js';
import { pendingItemsSource } from '../dist/react-pending-items.js';
import { registerLocalPendingIntents } from '../dist/pending-writes.js';
import { WriteHistory } from '../dist/writes.js';
import { waitFor } from './helpers/wait.mjs';

const send = { kind: 'mutation', name: 'send' };
const query = { kind: 'query', name: 'read' };
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function wire() {
  let seq = 0;
  const polls = [], reads = [], mutations = [];
  const session = { token: 'one', principal: 'alice', expiresAt: Date.now() + 7 * 86400000, kind: 'password' };
  const state = { holdProbe: undefined, holdWrites: false, holdReads: false, polls, reads, mutations, session,
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/probe') { if (state.holdProbe) await state.holdProbe.promise; return Response.json({ ok: true, store_id: 'A', seq }); }
      if (path === '/auth/refresh') return Response.json({ ok: true, session: { ...session, token: 'two' } });
      if (path === '/auth/logout') return Response.json({ ok: true });
      if (path === '/schema') return Response.json({ generation: 1, schema: { tables: {}, operations: {} }, programs: [] });
      if (path === '/changes') { const gate = deferred(); polls.push(gate); return gate.promise; }
      if (path === '/q/read') { const gate = deferred(); reads.push(gate); return state.holdReads ? gate.promise : Response.json({ data: false, seq, complete: true }); }
      if (path === '/m/send') {
        const gate = deferred(); mutations.push(gate);
        if (state.holdWrites) return gate.promise;
        return Response.json({ state: 'sent', seq: ++seq });
      }
      throw Error(path);
    },
  };
  return state;
}
function raw(t, transport) {
  const client = createClient({ url: 'https://round1.invalid', session: transport.session, fetch: transport.fetch });
  t.after(() => client.close()); return client;
}
const list = client => pendingIntentAccess(client).read();
function mount(t, client) { const source = pendingItemsSource(client), stop = source.subscribe(() => {}); t.after(stop); return { source, stop }; }

// Each case reproduces a blind-review finding on 80ec6b66dd.
test('round1: 1000 unowned online successes retain no payload bytes', async t => {
  const client = raw(t, wire());
  for (let i = 0; i < 1000; i++) assert.equal((await client.mutate(send, { text: 'x'.repeat(1024) })).state, 'sent');
  const items = await list(client);
  assert.equal(items.length, 0, 'unmounted presentations own no terminal payloads');
  assert.equal(Buffer.byteLength(JSON.stringify(items)), 2);
  t.diagnostic(`1000 unowned completions: ${items.length} entries, ${Buffer.byteLength(JSON.stringify(items))} serialized bytes`);
});

test('round1: owned success retention evicts oldest at 256 without claiming observation or cloning reads', async t => {
  const client = raw(t, wire()), { stop } = mount(t, client);
  const first = await client.mutate(send, { text: 'first' });
  const original = (await list(client))[0];
  for (let i = 0; i < 999; i++) await client.mutate(send, { text: 'x'.repeat(1024) });
  const items = await list(client);
  assert.equal(items.length, 256);
  assert.equal(original.phase, 'evicted');
  assert.equal(items.some(i => i.write.id === first.id), false);
  assert.ok(Buffer.byteLength(JSON.stringify(items)) < 350000);
  t.diagnostic(`1000 owned completions: ${items.length} entries, ${Buffer.byteLength(JSON.stringify(items))} serialized bytes`);
  assert.equal((await list(client))[0], items[0], 'reads reuse immutable payload references');
  for (let i = 0; i < 16; i++) await client.mutate(send, { text: 'b'.repeat(100000) });
  assert.ok(Buffer.byteLength(JSON.stringify(await list(client))) < 1100000, 'owned bytes are bounded independently of count');
  stop(); assert.deepEqual(await list(client), [], 'last unmount drops all terminal payloads');
  const other = pendingItemsSource(client).subscribe(() => {}, write => write.op === 'other');
  await client.mutate(send, { text: 'unowned operation' });
  assert.deepEqual(await list(client), [], 'a mounted unrelated presentation owns no payload'); other();
});

test('round1: same-principal bearer refresh and generation reset preserve settling text and reject old reads', async t => {
  const transport = wire(), client = raw(t, transport); mount(t, client);
  await client.mutate(send, { text: 'keep me' });
  const oldScope = pendingIntentAccess(client).scope();
  transport.holdReads = true;
  const watch = client.observe(query, {}), unwatch = watch.subscribe(() => {}); t.after(() => { unwatch(); watch.close(); });
  await waitFor(() => transport.reads.length && transport.polls.length, 'initial read and poll');
  transport.polls[0].resolve(Response.json({ seq: 1, generation: 1, tables: [] }));
  await waitFor(() => transport.polls.length === 2, 'generation initialized');
  assert.equal((await client.refreshSession()).ok, true);
  assert.equal((await list(client))[0]?.write.args.text, 'keep me', 'refresh must retain success');
  transport.polls[1].resolve(Response.json({ seq: 1, generation: 2, tables: [] }));
  await waitFor(() => transport.polls.length >= 3, 'generation reset');
  assert.equal(pendingIntentAccess(client).scope(), oldScope);
  assert.equal((await list(client))[0]?.write.args.text, 'keep me', 'generation must retain success');
  transport.reads[0].resolve(Response.json({ data: 'obsolete', seq: 1 }));
  await waitFor(() => transport.reads.length >= 2, 'replacement read');
  assert.equal('data' in watch.getSnapshot(), false, 'old read cannot cross refresh/reset');
});

test('round1: peer journal success preserves the same settling interval and arguments', async t => {
  const transport = wire(); transport.holdWrites = true;
  const store = memorySessionStore(), a = raw(t, transport), b = raw(t, transport);
  const A = (await onlineCustody(a, 'https://round1.invalid', store, e => { throw e; }, false)).client;
  const B = (await onlineCustody(b, 'https://round1.invalid', store, e => { throw e; }, false)).client;
  t.after(() => A.close()); t.after(() => B.close());
  await identifyDispatch(a); await identifyDispatch(b);
  const sa = mount(t, A).source, sb = mount(t, B).source;
  const write = await A.mutate(send, { text: 'peer secret', id: 'row' }, { waitSeconds: 0 });
  await waitFor(() => sb.getSnapshot()[0]?.write.id === write.id && transport.mutations.length, 'B observes A custody');
  transport.mutations[0].resolve(Response.json({ state: 'sent', seq: 1 }));
  await waitFor(async () => (await B.write(write.id))?.state === 'sent', 'shared terminal receipt');
  await waitFor(() => sa.getSnapshot()[0]?.phase === 'settling', 'A settling');
  assert.deepEqual((await list(B)).map(i => [i.phase, i.write.args.text]), [['settling', 'peer secret']]);
  observeIntents(B, [write.id]); assert.deepEqual(await list(B), []);
  assert.equal((await list(A))[0].phase, 'settling', 'B observation does not fabricate A observation');
});

test('round1: journal A precedes pre-identification saving B', async t => {
  const transport = wire(); transport.holdWrites = true;
  const store = memorySessionStore(), a = raw(t, transport);
  const A = (await onlineCustody(a, 'https://round1.invalid', store, e => { throw e; }, false)).client;
  t.after(() => A.close()); await identifyDispatch(a);
  const first = await A.mutate(send, { text: 'A' }, { waitSeconds: 0 });
  const secondWire = wire(); secondWire.holdProbe = deferred();
  const b = raw(t, secondWire), B = (await onlineCustody(b, 'https://round1.invalid', store, e => { throw e; }, false)).client;
  t.after(() => B.close());
  const id = mintId(), sending = B.mutate(send, { text: 'B' }, { id, waitSeconds: 0 });
  await waitFor(async () => (await list(B)).length === 2, 'identification waiting next to journal');
  assert.deepEqual((await list(B)).map(i => [i.write.id, i.phase]), [[first.id, 'unknown'], [id, 'saving']]);
  await B.close(); await sending;
});


test('round1: local routine reset rejects in-flight presentation reads without withdrawing settled text', async () => {
  let revision = 0, held = false;
  const gate = deferred(), listeners = new Set(), client = {
    onPendingWrites: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    onViewer: () => () => {}, onSession: () => () => {}, onLink: () => () => {},
  };
  const entry = { id: 'local', op: 'send', args: { text: 'local text' }, predicted: [], observed_seq: 1, receipt_store: { success_seq: 1 } };
  registerLocalPendingIntents(client, () => held ? gate.promise : Promise.resolve([entry]), new WriteHistory(),
    { pending: () => [] }, { reasons: async () => new Map() }, () => 'alice:A', () => true, () => revision);
  const source = pendingItemsSource(client), stop = source.subscribe(() => {});
  try {
    await waitFor(() => source.getSnapshot()[0]?.phase === 'settling', 'local initial success');
    held = true; const reading = list(client); listeners.forEach(fn => fn()); revision++;
    assert.equal(source.getSnapshot()[0].write.args.text, 'local text');
    gate.resolve([{ ...entry, args: { text: 'obsolete read' } }]);
    assert.deepEqual(await reading, [], 'same principal/store revision still rejects old reads');
    await new Promise(r => setImmediate(r));
    assert.equal(source.getSnapshot()[0].write.args.text, 'local text');
  } finally { stop(); }
});
