// @ref LLP 3000.019#3.3 — watches stay live while the partition is still private.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalClient } from '../dist/local.js';
import { createClient, mintId } from '../dist/client.js';
import { prepareClient } from '../dist/client-start.js';
import { memoryPersistence, webDevice } from '../dist/web.js';
import { server, until } from './helpers/app-server.mjs';

const source = `use personas alice, bob
table messages:
  body: text <=100
  at: int
  public 'scale watch fixture'
  insert <- allow
  delete <- allow
  sync last 500 by .at
query history():
  return messages last 20 by .at
mutation send(id: id, body: text <=100, at: int):
  insert messages { id, body, at }
mutation remove(id: messages):
  delete messages[id]
`;
const history = { kind: 'query', name: 'history' };
const wasm = readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url));
async function fixture(t) {
  const { url } = await server(t, '', source);
  const online = createClient({ url, persona: 'alice' });
  let blocked = true, released;
  const barrier = new Promise(resolve => { released = resolve; });
  let queries = 0, catchups = 0, publications = 0, active = 0, peak = 0;
  let failNext, failures = 0, fenced = 0, openedCore;
  const core = webDevice({ wasm, persist: memoryPersistence() });
  const options = { url, persona: 'bob', device: { async open(...args) {
    const opened = await core.open(...args);
    openedCore = opened;
    return { ...opened, async call(request, committed) {
      const result = await opened.call(request, committed);
      if (request.op === 'apply' && result.ok?.published) publications++;
      if (request.op === 'queued' && result.ok?.some(entry => entry.predictable && entry.predicted?.length)) fenced++;
      return result;
    } };
  } }, async fetch(input, init) {
    const path = new URL(input).pathname;
    if (path === '/sync' && JSON.parse(init.body).stream) {
      catchups++;
      if (blocked) await Promise.race([barrier, new Promise((_, reject) => {
        if (init.signal.aborted) reject(init.signal.reason);
        else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      })]);
    }
    if (path.startsWith('/q/')) { queries++; active++; peak = Math.max(peak, active); }
    try {
      if (path.startsWith('/q/') && failNext) {
        const fault = failNext;
        failNext = undefined; failures++;
        if (fault === '503') return new Response('temporarily unavailable', { status: 503 });
        const response = await fetch(input, init);
        return Response.json({ ...await response.json(), nextExpiry: Date.now() - 1000 });
      }
      return await fetch(input, init);
    }
    finally { if (path.startsWith('/q/')) active--; }
  } };
  const prepared = await prepareClient(options, () => createLocalClient(options));
  const client = prepared.client, acquiring = prepared.start();
  t.after(async () => { blocked = false; released(); await client.close(); await acquiring; await online.close(); });
  await until(() => catchups === 1, 'snapshot staged and catch-up blocked');
  const observed = client.observe(history, {});
  const unsubscribe = observed.subscribe(() => {});
  t.after(() => { unsubscribe(); observed.close(); });
  await until(() => observed.getSnapshot().data?.length === 0, 'initial server fallback');
  return { client, observed, acquiring, release() { blocked = false; released(); },
    counts: () => ({ queries, catchups, publications, peak, failures, fenced }),
    failRefresh(fault) { failNext = fault; },
    // A persisted prediction from another owner can fence this reader without
    // rerunning its watch. Exercise the real outbox, independently of admission.
    async prediction(pending) {
      const result = await openedCore.call(pending ? { op: 'enqueue', entry: {
        id: 'peer-prediction', seq: 1, op: 'send', viewer: 'dev:bob', now: Date.now(),
        args: { id: 'predicted', body: 'pending', at: 100 }, new_ids: [],
        predictable: true, predicted: ['messages/predicted'],
      } } : { op: 'dequeue', id: 'peer-prediction' });
      assert.equal(result.denied, undefined, JSON.stringify(result));
    },
    async send(n) {
      const id = mintId();
      const write = await online.mutate({ kind: 'mutation', name: 'send' }, { id, body: `message ${n}`, at: n });
      assert.equal(write.state, 'sent', JSON.stringify(write));
      return id;
    }, async remove(id) {
      const write = await online.mutate({ kind: 'mutation', name: 'remove' }, { id });
      assert.equal(write.state, 'sent', JSON.stringify(write));
    } };
}

test('live fallback receives consecutive sends and deletion while snapshot publication is blocked', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  for (let n = 1; n <= 3; n++) {
    const id = await f.send(n);
    await until(() => f.observed.getSnapshot().data?.some(row => row.id === id), 'live message before publication');
    assert.equal(f.client.acquired, false);
    assert.equal(f.counts().publications, 0);
    if (n === 3) {
      await f.remove(id);
      await until(() => f.observed.getSnapshot().data?.length === 2, 'deletion before publication');
    }
  }
  assert.equal(f.counts().catchups, 1, 'no extra sync was needed for live answers');
  assert.ok(f.counts().queries < 20, 'background refresh is paced');
  f.release(); await f.acquiring;
  assert.equal(f.client.acquired, true);
  await until(() => f.observed.getSnapshot().data?.length === 2, 'published partition');
  // Let one already-armed callback settle, then establish that local reads
  // returned to the change feed without a standing query polling interval.
  await delay(350);
  const queries = f.counts().queries;
  await delay(650);
  assert.equal(f.counts().queries, queries);
});

for (const fault of ['503', 'prediction', 'expiry']) test(`an unpublished ${fault} refresh keeps acquisition polling alive`, { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const first = await f.send(1);
  await until(() => f.observed.getSnapshot().data?.some(row => row.id === first), 'first published server message');
  const shown = f.observed.getSnapshot();
  if (fault === 'prediction') await f.prediction(true);
  else f.failRefresh(fault);
  await until(() => fault === 'prediction' ? f.counts().fenced > 0 : f.counts().failures === 1, 'background refresh encountered fault');
  await delay(100); // Allow the unpublished attempt to settle before recovery.
  assert.deepEqual(f.observed.getSnapshot(), { ...shown, revalidating: true }, 'the failed/fenced result leaves the original answer marked revalidating');
  if (fault === 'prediction') await f.prediction(false);
  await f.remove(first);
  const second = await f.send(2);
  await until(() => f.observed.getSnapshot().data?.some(row => row.id === second), 'message after unpublished refresh, before acquisition ends');
  assert.ok(!f.observed.getSnapshot().data.some(row => row.id === first), 'the deletion also arrives');
  assert.equal(f.client.acquired, false);
  assert.equal(f.counts().publications, 0);
  assert.equal(f.counts().catchups, 1);
});

test('removing the watch stops cold-acquisition refreshes', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const id = await f.send(1);
  await until(() => f.observed.getSnapshot().data?.some(row => row.id === id), 'live fallback');
  f.observed.close();
  await delay(350);
  const before = f.counts().queries;
  await f.send(2); await delay(650);
  assert.equal(f.counts().queries, before);
  assert.equal(f.client.acquired, false);
});
