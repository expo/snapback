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
  const core = webDevice({ wasm, persist: memoryPersistence() });
  const options = { url, persona: 'bob', device: { async open(...args) {
    const opened = await core.open(...args);
    return { ...opened, async call(request, committed) {
      const result = await opened.call(request, committed);
      if (request.op === 'apply' && result.ok?.published) publications++;
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
    try { return await fetch(input, init); }
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
    counts: () => ({ queries, catchups, publications, peak }),
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
