import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url === new URL('../dist/client-start.js', import.meta.url).href) {
    const source = String(result.source), needle = 'const client = await create();';
    assert.ok(source.includes(needle));
    return { ...result, source: source.replace(needle, `${needle}\n        await globalThis.__e14Prepared?.(options, client);`) };
  }
  if (url === new URL('../dist/local.js', import.meta.url).href) {
    const source = String(result.source), needle = 'const journalCuts = new QueryCuts();';
    assert.ok(source.includes(needle));
    return { ...result, source: source.replace(needle, `${needle}\n        globalThis.__e14Cuts?.(journalCuts);`) };
  }
  return result;
} });
const { memorySessionStore } = await import('../dist/auth.js');
const { mintId } = await import('../dist/client.js');
const { storeKey, storeLock } = await import('../dist/app-storage.js');
const { ProgressiveWrites, progressiveWriteCustody } = await import('../dist/progressive-writes.js');
const { fixture, gate, tick, until, mutation, query } = await import('./helpers/progressive-writes.mjs');
const regression = (name, work) => test(name, { timeout: 20_000 }, work);
const url = 'https://progressive-writes.invalid', key = storeKey('writes', url, 'alice');

regression('E14 adopted-store refusal recovers the dispatcher and the next app mutation reaches B', async t => {
  const store = memorySessionStore(), id = mintId();
  await store.set(key, JSON.stringify({ owner: 'alice', backend: url, pending: [{ owner: 'alice', id, op: 'write', args: {}, storeId: 'A' }], receipts: [] }));
  const f = await fixture(t, { startup: 'awaited', store, hold: false });
  f.coreGate.resolve(); await f.app.ready;
  await until(async () => (await f.app.client.write(id))?.state === 'sent');
  f.replace('B'); await f.app.client.sync();
  assert.equal((await f.app.client.query(query, {})).data, 'local');
  const requests = f.requests.length;
  const write = await f.app.mutate(mutation, {}, { waitSeconds: 5 });
  assert.equal(write.why?.code, 'E_STORE_REPLACED');
  // The facade may reopen asynchronously; readiness of a new raw client is
  // observable without forcing a recovery that the refusal failed to request.
  await until(() => f.app.auth.getSnapshot().state === 'signed-in');
  const next = await f.app.mutate(mutation, {}, { waitSeconds: 5 });
  assert.ok(f.requests.length >= requests + 2, 'the next mutation must make a second request to B');
  assert.equal(next.state, 'sent', JSON.stringify(next));
  assert.equal((await f.app.client.query(query, {})).data, 'local');
});

regression('E14 pause during nested preparation leaves the device open and custody deferred until start', async t => {
  const store = memorySessionStore(), entered = gate(), release = gate();
  await store.set(key, 'damaged opening');
  let progressive, installs = 0, transport, closes = 0;
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', function(...args) {
    progressive = this; installs++; return install.apply(this, args);
  });
  globalThis.__e14Prepared = async (options, client) => {
    if (installs !== 2 || options.device) return;
    transport = client; const close = client.close;
    t.mock.method(client, 'close', async () => { closes++; await close(); });
    entered.resolve(); await release.promise;
  };
  t.after(() => { release.resolve(); delete globalThis.__e14Prepared; });
  const f = await fixture(t, { raw: true, store, hold: false, report: () => {} });
  const handle = progressiveWriteCustody(f.app.client);
  const recovering = progressive.pending(); await entered.promise;
  const replay = mintId();
  await store.set(key, JSON.stringify({ owner: 'alice', backend: url, pending: [{ owner: 'alice', id: replay, op: 'write', args: {}, storeId: 'A' }], receipts: [] }));
  handle.pause(); release.resolve(); await recovering;
  assert.ok(transport); assert.equal(closes, 0, 'a pause must not retire the prepared transport');
  assert.equal(progressiveWriteCustody(f.app.client), handle);
  assert.ok(progressive.custody, 'paused opening still installs its deferred custody');
  const action = await f.app.client.act({ kind: 'action', name: 'perform' }, {});
  assert.equal(action.state, 'done', 'the raw device lifetime remains open');
  assert.deepEqual(f.requests, [], 'paused custody does not start replay');
  assert.equal((await f.app.client.mutate(mutation, {}, { waitSeconds: 0 })).why?.code, 'E_ADMISSION');
  handle.start(); // The existing deferred-start entry point resumes this opening.
  await until(async () => (await f.app.client.write(replay))?.state === 'sent');
  assert.equal((await f.app.client.mutate(mutation, {}, { waitSeconds: 5 })).state, 'sent');
  assert.equal(f.requests.length, 2); assert.equal(f.requests[0], replay);
});

regression('E14 late own empty preservation withdraws a displayed answer after peer settlement without a second cut', async t => {
  const { journalChanges } = await import('../dist/journal-changes.js');
  const { episodeDeadline } = await import('../dist/read-episode.js');
  const cover = gate(), queried = gate(), received = gate(); let progressive, replacing = false;
  const install = ProgressiveWrites.prototype.install, receipt = ProgressiveWrites.prototype.receipt;
  t.mock.method(ProgressiveWrites.prototype, 'install', async function(...args) { await install.apply(this, args); progressive = this; });
  t.mock.method(ProgressiveWrites.prototype, 'receipt', function(...args) { const completed = receipt.apply(this, args); assert.equal(args[1].authorityCurrent(), true); received.resolve(); return completed; });
  const cuts = [];
  globalThis.__e14Cuts = owner => {
    const change = owner.change;
    t.mock.method(owner, 'change', function(...args) { cuts.push(args); return change.apply(this, args); });
  };
  t.after(() => { delete globalThis.__e14Cuts; });
  t.after(() => cover.resolve());
  const f = await fixture(t, { receiptReply: r => ({ ...r, preserved: [] }), queryReply: async (_path, head) => {
    if (replacing) { queried.resolve(); await cover.promise; }
    return { data: replacing ? 'replacement' : 'displayed', complete: true, tables: ['items'], scopes: { items: [{}] }, seq: head, store_id: 'A', generation: 1 };
  } });
  await f.app.ready;
  const watch = f.app.client.observe(query, {}); watch.subscribe(() => {}); t.after(() => watch.close());
  await until(() => watch.getSnapshot().data === 'displayed');
  const id = mintId(), writing = f.app.mutate(mutation, {}, { id, waitSeconds: 0 });
  await f.posted.promise; await writing;
  await until(() => !progressive.uncertain && progressive.current().some(write => write.id === id));
  replacing = true;
  const events = journalChanges(key, () => {}); t.after(() => events.close());
  await storeLock(key, async () => { const journal = await f.journal(); journal.pending = []; journal.receipts.push({ state: 'sent', id, seq: 21, replayed: true }); await f.store.set(key, JSON.stringify(journal)); });
  events.notify();
  await until(() => !progressive.uncertain && !progressive.current().some(write => write.id === id));
  await queried.promise;
  assert.equal(watch.getSnapshot().data, 'displayed');
  assert.equal(episodeDeadline(watch.getSnapshot()), undefined, 'inspection has unknown preservation');
  const settledCuts = cuts.length;
  f.release.resolve(); await received.promise;
  assert.equal(progressive.receipts.has(id), false, 'late own evidence is not retained');
  const deadline = episodeDeadline(watch.getSnapshot());
  assert.ok(deadline !== undefined && deadline - Date.now() <= 1000, 'late live revocation starts the withdrawal bound');
  await until(() => !('data' in watch.getSnapshot()));
  assert.ok(Date.now() <= deadline + 250);
  assert.equal(cuts.length, settledCuts, 'live preservation does not settle the id twice');
  cover.resolve(); await until(() => watch.getSnapshot().data === 'replacement');
});

regression('E14 credential rotation keeps the withdrawal bound of an own known empty preservation list', async t => {
  const { episodeDeadline } = await import('../dist/read-episode.js');
  const held = gate(), queried = gate(); let local, replacing = false, evidence;
  const install = ProgressiveWrites.prototype.install, receipt = ProgressiveWrites.prototype.receipt;
  t.mock.method(ProgressiveWrites.prototype, 'install', function(client, ...args) { local = client; return install.call(this, client, ...args); });
  t.mock.method(ProgressiveWrites.prototype, 'receipt', function(id, value) { evidence = value; return receipt.call(this, id, value); });
  t.after(() => held.resolve());
  const f = await fixture(t, { receiptReply: r => ({ ...r, preserved: [], generation: 2 }),
    refreshReply: () => Response.json({ ok: false, why: { code: 'E_OVERLOADED', family: 'availability', message: 'try later', retryable: true } }, { status: 503 }),
    queryReply: async (_path, head) => {
      if (replacing) { queried.resolve(); await held.promise; }
      return { data: replacing ? 'replacement' : 'displayed', complete: true, tables: ['other'], scopes: { other: [{}] }, seq: head, store_id: 'A', generation: 1 };
    } });
  await f.app.ready;
  const writing = f.app.mutate(mutation, {}, { waitSeconds: 5 }); await f.posted.promise;
  assert.equal((await local.refreshSession()).ok, false);
  // Rotation correctly withdraws the old authority's display. Mount a fresh,
  // disjoint answer under the new revision while the old receipt is held.
  // Its expanded execution generation will invalidate this answer on arrival.
  const watch = local.observe({ kind: 'query', name: 'other' }, {}); watch.subscribe(() => {}); t.after(() => watch.close());
  await until(() => watch.getSnapshot().data === 'displayed');
  replacing = true; f.release.resolve(); assert.equal((await writing).state, 'sent'); await queried.promise;
  assert.equal(evidence.authorityCurrent(), false, 'the response belongs to the previous credential revision');
  assert.deepEqual(evidence.preserved, []);
  const deadline = episodeDeadline(watch.getSnapshot());
  assert.ok(deadline !== undefined && deadline - Date.now() <= 1000, 'obsolete credentials cannot turn known revocation into unknown evidence');
  await until(() => !('data' in watch.getSnapshot())); assert.ok(Date.now() <= deadline + 250);
  held.resolve(); await until(() => watch.getSnapshot().data === 'replacement');
});

for (const refusing of ['B', 'C']) regression(`E14 real replacement metadata for ${refusing} calls recovery once and only a new store fences reads`, async t => {
  const changes = [], observations = [], store = memorySessionStore(), id = mintId();
  await store.set(key, JSON.stringify({ owner: 'alice', backend: url, pending: [{ owner: 'alice', id, op: 'write', args: {}, storeId: 'A' }], receipts: [] }));
  const f = await fixture(t, { raw: true, startup: 'awaited', journal: true, store, hold: false, onStoreChange: why => changes.push(why),
    wrapCore: core => ({ ...core, async call(request, ...args) { if (request.op === 'observe_store') observations.push(request); return core.call(request, ...args); } }) });
  await until(async () => (await f.app.client.write(id))?.state === 'sent');
  f.replace('B'); await f.app.client.sync();
  const watch = f.app.client.observe(query, {}); watch.subscribe(() => {}); t.after(() => watch.close());
  await until(() => watch.getSnapshot().data === 'local');
  const before = changes.length, observed = observations.length;
  if (refusing === 'C') f.replace('C');
  const write = await f.app.client.mutate(mutation, {}, { waitSeconds: 5 });
  assert.equal(write.why?.code, 'E_STORE_REPLACED');
  assert.equal(changes.length, before + 1, 'real HTTP-200 refusal with head requests recovery exactly once');
  f.offline(true);
  if (refusing === 'C') {
    assert.equal(watch.getSnapshot().denied?.code, 'E_STORE_REPLACED');
    assert.equal((await f.app.client.query(query, {})).denied?.code, 'E_STORE_REPLACED');
  } else {
    assert.equal(observations.length, observed, 'already-adopted B has no incarnation reset');
    assert.equal(watch.getSnapshot().data, 'local');
    assert.equal((await f.app.client.query(query, {})).data, 'local', 'B reads remain usable offline');
  }
});

regression('E14 paused open denial frame keeps raw mutations at E_ADMISSION', async t => {
  const { localStatus } = await import('../dist/app.js');
  const memory = memorySessionStore(); await memory.set(key, 'damaged opening');
  // start() now attempts opening recovery too. Keep quarantine unavailable so
  // this witness reaches pause with an actual denial frame, not installed custody.
  const store = { ...memory, async set(k, value) {
    if (k.startsWith(`${key}.damaged.`)) throw Error('quarantine unavailable');
    return memory.set(k, value);
  } };
  const f = await fixture(t, { raw: true, custody: 'present', store, report: () => {} });
  await until(() => localStatus(f.app.client).getSnapshot().state === 'ready');
  progressiveWriteCustody(f.app.client).pause();
  const write = await f.app.client.mutate(mutation, {}, { waitSeconds: 0 });
  assert.equal(write.why?.code, 'E_ADMISSION', 'pause is not permission to admit into the device outbox');
  assert.deepEqual(f.requests, []); assert.equal(await store.get(key), 'damaged opening');
});

async function peerAdmissions(t, count) {
  const { journalChanges } = await import('../dist/journal-changes.js');
  let progressive;
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', async function(...args) { await install.apply(this, args); progressive = this; });
  const f = await fixture(t, { raw: true, hold: false });
  const ids = Array.from({ length: count }, () => mintId());
  const events = journalChanges(key, () => {}); t.after(() => events.close());
  await storeLock(key, async () => { const journal = await f.journal(); journal.pending = ids.map(id => ({ owner: 'alice', id, op: 'write', args: {}, storeId: 'A', dispatched: true })); await f.store.set(key, JSON.stringify(journal)); });
  events.notify(); await until(() => !progressive.uncertain && progressive.current().length === count);
  return { f, ids, progressive, events };
}

regression('E14 an own receipt after 257 peer completions retains no orphan evidence', async t => {
  const { WRITE_HISTORY_LIMIT } = await import('../dist/writes.js');
  const { journalChanges } = await import('../dist/journal-changes.js');
  let progressive; const received = gate();
  const install = ProgressiveWrites.prototype.install, receipt = ProgressiveWrites.prototype.receipt;
  t.mock.method(ProgressiveWrites.prototype, 'install', async function(...args) { await install.apply(this, args); progressive = this; });
  t.mock.method(ProgressiveWrites.prototype, 'receipt', function(...args) { const completed = receipt.apply(this, args); received.resolve(); return completed; });
  const f = await fixture(t, { raw: true });
  const ids = Array.from({ length: WRITE_HISTORY_LIMIT + 1 }, () => mintId());
  const writing = f.app.client.mutate(mutation, {}, { id: ids[0], waitSeconds: 0 });
  await f.posted.promise; await writing;
  assert.equal(progressive.responding.has(ids[0]), true, 'the actual own HTTP request pins its response');
  const events = journalChanges(key, () => {}); t.after(() => events.close());
  await storeLock(key, async () => { const journal = await f.journal(); journal.pending.push(...ids.slice(1).map(id => ({ owner: 'alice', id, op: 'write', args: {}, storeId: 'A', dispatched: true }))); await f.store.set(key, JSON.stringify(journal)); });
  events.notify(); await until(() => !progressive.uncertain && progressive.current().length === ids.length);
  // Observe the first 256 settlements, then publish the next legal receipt
  // window. An oversized snapshot is invalid journal data, not 257 completions.
  await storeLock(key, async () => { const journal = await f.journal(); journal.pending = journal.pending.slice(-1); journal.receipts = ids.slice(0, -1).map((id, n) => ({ state: 'sent', id, seq: 21 + n, replayed: true })); await f.store.set(key, JSON.stringify(journal)); });
  events.notify(); await until(() => !progressive.uncertain && progressive.current().length === 1);
  assert.equal(progressive.completed.has(ids[0]), true);
  await storeLock(key, async () => { const journal = await f.journal(); journal.pending = []; journal.receipts = journal.receipts.slice(1); journal.receipts.push({ state: 'sent', id: ids.at(-1), seq: 21 + WRITE_HISTORY_LIMIT, replayed: true }); await f.store.set(key, JSON.stringify(journal)); });
  events.notify(); await until(() => !progressive.uncertain && progressive.current().length === 0);
  assert.equal(progressive.completed.has(ids[0]), true, 'the completed-id ring pins the still-outstanding own response');
  assert.equal(progressive.completed.has(ids[1]), false, 'the ring evicts the oldest unpinned completion');
  f.release.resolve(); await received.promise;
  assert.equal(progressive.receipts.has(ids[0]), false, 'late own evidence cannot resurrect a settled id after history eviction');
  await until(() => progressive.responding.size === 0);
  assert.equal(progressive.receipts.size, 0); assert.deepEqual(f.requests, [ids[0]]);
});

regression('E14 all 257 admitted receipts survive the evidence cap including an updated oldest entry', async t => {
  const { WRITE_HISTORY_LIMIT } = await import('../dist/writes.js');
  const { ids, progressive } = await peerAdmissions(t, WRITE_HISTORY_LIMIT + 1);
  const evidence = { store: 'A', generation: 1, preserved: ['items'], authorityCurrent: () => true };
  for (const id of ids.slice(0, -1)) progressive.receipt(id, evidence);
  const latest = { ...evidence, preserved: [] };
  progressive.receipt(ids[0], latest);
  progressive.receipt(ids.at(-1), evidence);
  assert.equal(progressive.receipts.size, ids.length, 'the cap permits overflow while every receipt is admitted');
  assert.equal(progressive.receipts.get(ids[0]), latest, 'updating an old Map key cannot make an admitted receipt evictable');
  for (const id of ids) assert.ok(progressive.receipts.has(id));
});
