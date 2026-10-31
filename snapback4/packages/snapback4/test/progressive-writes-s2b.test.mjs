import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url === new URL('../dist/local.js', import.meta.url).href) {
    const needle = 'let onlineHead = 0, onlineStore = backend?.store_id, onlineGeneration = Number(backend?.generation ?? 0);';
    assert.ok(String(result.source).includes(needle));
    result.source = String(result.source).replace(needle, needle + ' globalThis.__s2bOnlineStore?.(value => { onlineStore = value; });');
  }
  return result;
} });
const { fixture, gate, until, mutation, query, schema } = await import('./helpers/progressive-writes.mjs');
const { memorySessionStore } = await import('../dist/auth.js');
const { mintId } = await import('../dist/client.js');
const { storeKey } = await import('../dist/app-storage.js');
const { onlineCustody } = await import('../dist/app-online.js');
const { ProgressiveWrites, progressiveWriteCustody } = await import('../dist/progressive-writes.js');
const { episodeDeadline } = await import('../dist/read-episode.js');
const { trackDispatch } = await import('../dist/online-dispatch.js');
const url = 'https://progressive-writes.invalid', key = storeKey('writes', url, 'alice');

for (const lagging of [false, true]) test(`S2b refusal: selective retirement precedes shrink with lagging online store=${lagging}`, async t => {
  const store = memorySessionStore(), seed = mintId(), kept = mintId(), notices = []; let setOnlineStore;
  globalThis.__s2bOnlineStore = setter => { setOnlineStore = setter; };
  t.after(() => { delete globalThis.__s2bOnlineStore; });
  await store.set(key, JSON.stringify({ owner: 'alice', backend: url, pending: [{ owner: 'alice', id: seed, op: 'write', args: {}, storeId: 'A' }], receipts: [] }));
  const f = await fixture(t, { raw: true, startup: 'awaited', journal: true, store, hold: false, onStoreChange: why => notices.push(why) });
  await until(async () => (await f.app.client.write(seed))?.state === 'sent');
  f.replace('B'); f.head(40); await f.app.client.sync();
  const journal = await f.journal(); journal.pending.push({ owner: 'alice', id: kept, op: 'write', args: {}, storeId: 'B', dispatched: false });
  await store.set(key, JSON.stringify(journal));
  if (lagging) setOnlineStore('A');
  notices.length = 0; f.head(30);
  const reply = await f.app.client.mutate(mutation, {}, { waitSeconds: 5 });
  assert.equal(reply.why?.code, 'E_STORE_REPLACED');
  assert.equal((await f.app.client.query(query, {})).denied?.code, 'E_STORE_RESTORE', 'device identity makes this a same-store shrink');
  const after = await f.journal();
  assert.ok(after.pending.some(intent => intent.id === kept), 'the prior selective retirement protects the B intent from restore retirement');
  assert.equal(after.receipts.some(receipt => receipt.id === kept), false);
  assert.equal(notices.length, 1, 'one recovery notification including online evidence');
});

test('S2b refusal: caller of a kept intent gets pending and reopen replays it once', async t => {
  const store = memorySessionStore(), id = mintId(), entered = gate(), reply = gate(), notifications = [];
  const why = { code: 'E_STORE_REPLACED', family: 'store', message: 'store changed' };
  const raw = { viewer: () => 'alice', onViewer: () => () => {}, onWrite: () => () => {},
    mutate: async () => { entered.resolve(); return reply.promise; }, write: async () => undefined,
    pendingWrites: async () => [], close: async () => {}, signOut: async () => {} };
  trackDispatch(raw, { store: 'B' });
  const owner = await onlineCustody(raw, url, store, error => { throw error; }, true, undefined, true, true);
  t.after(() => owner.client.close()); owner.client.onWrite(write => notifications.push(write));
  const writing = owner.client.mutate(mutation, {}, { id }); await entered.promise;
  await owner.refuseStore(why, 'B'); reply.resolve({ state: 'failed', id, why });
  assert.deepEqual(await writing, { state: 'pending', id });
  assert.deepEqual(notifications, []);
  assert.equal(JSON.parse(await store.get(key)).pending[0].id, id);
  await owner.client.close();
  let sends = 0;
  const next = { ...raw, mutate: async () => { sends++; return { state: 'sent', id, seq: 41 }; } };
  trackDispatch(next, { store: 'B' });
  const reopened = await onlineCustody(next, url, store, error => { throw error; });
  t.after(() => reopened.client.close());
  await until(async () => (await reopened.client.write(id))?.state === 'sent');
  assert.equal(sends, 1);
});

for (const mismatchedGeneration of [false, true]) test(`S2b settlement: arrival starts revocation before a held save, generation mismatch=${mismatchedGeneration}`, async t => {
  const memory = memorySessionStore(), id = mintId(), entered = gate(), saved = gate(); let holding = true, progressive;
  const store = { ...memory, async set(k, value) {
    if (holding && k === key && JSON.parse(value).receipts?.some(w => w.id === id)) { entered.resolve(); await saved.promise; }
    return memory.set(k, value);
  } };
  t.after(() => { holding = false; saved.resolve(); });
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', function(...args) { progressive = this; return install.apply(this, args); });
  const f = await fixture(t, { store, receiptReply: reply => ({ ...reply, preserved: mismatchedGeneration ? ['items'] : [],
    ...(mismatchedGeneration ? { generation: 2, head: undefined, replayed: true } : {}) }) });
  await f.app.ready;
  const watched = f.app.client.observe(mismatchedGeneration ? { kind: 'query', name: 'other' } : query, {});
  watched.subscribe(() => {}); t.after(() => watched.close());
  await until(() => 'data' in watched.getSnapshot());
  await f.app.mutate(mutation, {}, { id, waitSeconds: 0 }); await f.posted.promise;
  f.release.resolve(); await entered.promise;
  assert.equal(progressive.states.get(id)?.phase, 'responded', 'the held receipt has not left pending');
  const deadline = episodeDeadline(watched.getSnapshot());
  assert.ok(deadline !== undefined && deadline - Date.now() <= 1000, 'arrival starts the existing non-renewing bound even on another table');
  await until(() => !('data' in watched.getSnapshot()));
  assert.equal(progressive.states.get(id)?.published, false);
  holding = false; saved.resolve();
  await until(() => progressive.states.get(id)?.published);
});

test('S2b settlement: response before any admission inspection still publishes its cut once', async t => {
  const publications = []; let progressive, beforeResponse;
  const install = ProgressiveWrites.prototype.install, receipt = ProgressiveWrites.prototype.receipt;
  t.mock.method(ProgressiveWrites.prototype, 'install', async function(client, identity, fetch, changed, ...args) {
    progressive = this;
    await install.call(this, client, identity, fetch, (op, effect) => { if (effect?.type === 'publish') publications.push(effect.publication); changed(op, effect); }, ...args);
  });
  t.mock.method(ProgressiveWrites.prototype, 'receipt', function(id, facts) { beforeResponse = this.states.get(id)?.op; return receipt.call(this, id, facts); });
  const f = await fixture(t, { raw: true, hold: false, report: () => {}, receiptReply: reply => ({ ...reply, preserved: [] }) });
  const custody = progressiveWriteCustody(f.app.client), inspect = custody.inspect;
  t.mock.method(custody, 'inspect', async () => { throw Error('inspection held until after completion'); });
  const id = mintId(); assert.equal((await f.app.mutate(mutation, {}, { id, waitSeconds: 5 })).state, 'sent');
  assert.equal(beforeResponse, undefined, 'no admitted event was observed for the id');
  assert.deepEqual(publications, [{ invalidate: true, cut: 21, preserved: [], footprint: 'qualified' }]);
  custody.inspect = inspect;
  await progressive.pending();
  assert.equal(publications.length, 1);
  const persisted = (await f.journal()).receipts.find(write => write.id === id);
  assert.equal(persisted.generation, 1); assert.equal(persisted.storeId, 'A'); assert.equal(persisted.op, 'write');
});
