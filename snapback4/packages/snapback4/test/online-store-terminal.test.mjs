import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient, mintId } from '../dist/client.js';
const q = { kind: 'query', name: 'page' }, m = { kind: 'mutation', name: 'revoke' };
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const ready = (store_id, seq, data = ['private']) => ({ store_id, seq, data, complete: true, tables: ['secrets'] });
const head = (store_id, seq) => ({ store_id, seq, generation: 1, tables: ['secrets'] });
const until = async check => { for (let n = 0; n < 600; n++) { if (await check()) return; await delay(5); } assert.fail('store transition did not settle'); };
const blocked = signal => new Promise((_, reject) => { if (signal?.aborted) reject(Error('closed')); else signal?.addEventListener('abort', () => reject(Error('closed')), { once: true }); });

for (const source of ['query', 'mutation', 'changes', 'probe']) for (const replacement of [true, false]) {
  test(`${source}: ${replacement ? 'replacement' : 'regression'} is terminal for all reads and writes`, async t => {
    const change = gate(), receipt = gate(); let polls = 0, probes = 0, queryCount = 0, writes = 0, total = 0, changed = false;
    const id = replacement ? 'B' : 'A', code = replacement ? 'E_STORE_REPLACED' : 'E_STORE_RESTORE';
    const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
      total++;
      if (url.includes('/changes')) {
        if (!['changes', 'probe'].includes(source)) return blocked(init.signal);
        if (++polls === 1) return Response.json(head('A', 100));
        if (polls === 2) { await change.promise; if (source === 'probe') throw Error('disconnected'); return Response.json(head(id, 1)); }
        return blocked(init.signal);
      }
      if (url.includes('/probe')) { probes++; return Response.json({ ok: true, ...head(id, 1) }); }
      if (url.includes('/m/')) {
        writes++; await receipt.promise;
        // A late retryable failure used to reschedule this request even after
        // a head check had reported E_STORE_RESTORE.
        if (source !== 'mutation') return Response.json({ why: { code: 'E_BUSY', retryable: true } }, { status: 503 });
        return Response.json({ state: 'sent', id: JSON.parse(init.body).id, store_id: id, seq: 1, head: 1 });
      }
      queryCount++;
      return Response.json(ready(changed && source === 'query' ? id : 'A', changed && source === 'query' ? 1 : 100));
    } });
    t.after(async () => { change.resolve(); receipt.resolve(); await client.close(); });
    const watch = client.observe(q, {}), seen = [], settled = [];
    watch.subscribe(() => seen.push(watch.getSnapshot())); client.onWrite(write => settled.push(write));
    await until(() => watch.getSnapshot().data);
    const ids = [mintId(), mintId(), mintId()];
    const submitted = ids.map(id => client.mutate(m, {}, { id }));
    await until(() => writes === 1); seen.length = 0; changed = true;
    if (source === 'query') assert.equal((await client.query(q, { direct: true })).denied.code, code);
    else if (source === 'mutation') receipt.resolve();
    else change.resolve();
    await until(() => watch.getSnapshot().denied?.code === code);
    // These must resolve before the outstanding HTTP body settles.
    for (const write of await Promise.race([Promise.all(submitted), delay(500).then(() => assert.fail('terminal writes did not settle before the HTTP body'))])) {
      assert.equal(write.state, 'failed'); assert.equal(write.why.code, code);
      assert.match(write.why.message, /may have executed.*unknown/); assert.ok(write.why.site && write.why.rewrite);
    }
    assert.equal(settled.length, 3); assert.equal(writes, 1);
    receipt.resolve(); await delay(350); // Past the old first retry deadline.
    const before = total;
    assert.equal((await client.query(q, {})).denied.code, code);
    const newWrite = await client.mutate(m, {}, { id: mintId() });
    assert.equal(newWrite.state, 'failed'); assert.equal(newWrite.why.code, code);
    for (const id of ids) { const receipt = await client.write(id); assert.equal(receipt.why.code, code); assert.match(receipt.why.message, /unknown/); }
    const next = client.observe(q, { later: true });
    assert.equal(next.getSnapshot().denied.code, code);
    await delay(50);
    assert.equal(total, before, 'terminal clients make no later request, including queued sends');
    assert.equal(writes, 1); assert.equal(settled.length, 4, 'late receipts do not emit a second settlement');
    const terminal = seen.findIndex(read => read.denied?.code === code);
    assert.ok(terminal >= 0 && seen.slice(terminal).every(read => !('data' in read)), 'the probe evidence withdraws all data; preceding offline revalidation may retain');
    assert.equal(probes, source === 'probe' ? 1 : 0);
    assert.ok(queryCount <= (['changes', 'probe', 'query'].includes(source) ? 2 : 1));
  });
}

for (const body of ['ready', 'unavailable', 'denied']) test(`direct queries detect replacement in a ${body} response without polling`, async t => {
  let requests = 0;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async url => {
    assert.ok(url.includes('/q/'), 'a direct reader needs no head request');
    if (++requests === 1) return Response.json(ready('A', 100));
    return Response.json({ store_id: 'B', seq: 1, ...(body === 'ready' ? ready('B', 1) : body === 'unavailable' ? { loading: true, data: null, complete: false } : { denied: { code: 'PRIVATE', family: 'rule', message: 'refused' } }) });
  } });
  t.after(() => client.close());
  assert.deepEqual((await client.query(q, {})).data, ['private']);
  assert.equal((await client.query(q, {})).denied.code, 'E_STORE_REPLACED');
  assert.equal((await client.query(q, {})).denied.code, 'E_STORE_REPLACED');
  assert.equal(requests, 2);
});

test('a replacement-store revocation receipt fences an already evaluated replacement-store private page', async t => {
  const read = gate(), receipt = gate(); let queries = 0, writing = false;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/changes')) return blocked(init.signal);
    if (url.includes('/m/')) { writing = true; await receipt.promise; return Response.json({ state: 'sent', store_id: 'B', seq: 2, head: 2 }); }
    if (++queries === 1) return Response.json(ready('A', 1));
    await read.promise; return Response.json(ready('B', 1, ['revoked']));
  } });
  t.after(async () => { read.resolve(); receipt.resolve(); await client.close(); });
  const watch = client.observe(q, {}), seen = [];
  watch.subscribe(() => seen.push(watch.getSnapshot()));
  await until(() => watch.getSnapshot().data);
  const pending = client.query(q, {}), write = client.mutate(m, {});
  await until(() => queries === 2 && writing);
  seen.length = 0; receipt.resolve();
  assert.equal((await write).why.code, 'E_STORE_REPLACED');
  assert.equal(watch.getSnapshot().denied.code, 'E_STORE_REPLACED');
  read.resolve();
  assert.equal((await pending).denied.code, 'E_STORE_REPLACED');
  assert.ok(seen.every(snapshot => !('data' in snapshot))); assert.equal(queries, 2);
});

test('same-head same-generation replacement denies outstanding old-store answers', async t => {
  const old = gate(), change = gate(); let queries = 0, polls = 0;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/changes')) { if (++polls > 1) return blocked(init.signal); await change.promise; return Response.json(head('B', 10)); }
    if (++queries === 1) return Response.json(ready('A', 10));
    await old.promise; return Response.json(ready('A', 10));
  } });
  t.after(async () => { old.resolve(); change.resolve(); await client.close(); });
  const watch = client.observe(q, {});
  await until(() => watch.getSnapshot().data);
  const pending = client.query(q, {}); await until(() => queries === 2);
  change.resolve(); await until(() => watch.getSnapshot().denied);
  old.resolve(); assert.equal((await pending).denied.code, 'E_STORE_REPLACED');
  assert.equal(watch.getSnapshot().denied.code, 'E_STORE_REPLACED'); assert.equal(polls, 1);
});

test('replayed receipts verify their current head without lowering the historical commit fence', async t => {
  let writes = 0, reads = 0;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/m/')) return Response.json({ state: 'sent', store_id: 'A', head: 10, seq: ++writes === 1 ? 10 : 1, ...(writes > 1 ? { replayed: true } : {}) });
    reads++; return Response.json(ready('A', 10, []));
  } });
  t.after(() => client.close());
  assert.equal((await client.mutate(m, {})).seq, 10);
  assert.equal((await client.mutate(m, {})).replayed, true);
  assert.deepEqual((await client.query(q, {})).data, []); assert.equal(reads, 1);
});

test('a replayed historical receipt cannot authorize a later sequence-1 read', async t => {
  let writes = 0, reads = 0;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async url => {
    if (url.includes('/m/')) return Response.json({ state: 'sent', store_id: 'A', head: 10, seq: ++writes === 1 ? 10 : 1, ...(writes > 1 ? { replayed: true } : {}) });
    reads++; return Response.json(ready('A', 1, ['revoked']));
  } });
  t.after(() => client.close());
  assert.equal((await client.mutate(m, {})).seq, 10);
  const replay = await client.mutate(m, {});
  assert.equal(replay.replayed, true); assert.equal(replay.seq, 1);
  assert.equal((await client.query(q, {})).denied?.code, 'E_STORE_RESTORE');
  assert.equal(reads, 1, 'a head below the acknowledged floor is terminal');
});


test('a buffered refusal head below an observed write is refetched before publication', async t => {
  const refused = gate(); let reads = 0;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/m/')) return Response.json({ state: 'sent', store_id: 'A', seq: 2, head: 2 });
    if (++reads === 1) return Response.json(ready('A', 1, []));
    if (reads === 2) { await refused.promise; return Response.json({ store_id: 'A', head: 1, denied: { code: 'PRIVATE', family: 'rule', message: 'membership required' } }); }
    return Response.json(ready('A', 2, ['now authorized']));
  } });
  t.after(async () => { refused.resolve(); await client.close(); });
  await client.query(q, {});
  const pending = client.query(q, {}); await until(() => reads === 2);
  assert.equal((await client.mutate({ kind: 'mutation', name: 'grant' }, {})).state, 'sent');
  refused.resolve();
  assert.deepEqual((await pending).data, ['now authorized']);
  assert.equal(reads, 3, 'the old explained refusal is subject to the same sequence floor');
});
