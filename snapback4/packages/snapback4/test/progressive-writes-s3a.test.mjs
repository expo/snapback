import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url === new URL('../dist/local.js', import.meta.url).href) {
    let source = String(result.source);
    for (const [needle, addition] of [
      ['const answers = new LocalReads();', ' globalThis.__s3aAnswers?.(answers);'],
      ['let onlineHead = 0, onlineStore = backend?.store_id, onlineGeneration = Number(backend?.generation ?? 0);',
        ' globalThis.__s3aMetadata?.(() => ({ onlineHead, onlineStore, storeIdentity, seq }), () => { storeIdentity = "B"; seq = 0; });'],
    ]) { assert.ok(source.includes(needle)); source = source.replace(needle, needle + addition); }
    result.source = source;
  }
  return result;
} });
const { fixture, gate, tick, until, mutation, query, schema } = await import('./helpers/progressive-writes.mjs');
const { memorySessionStore } = await import('../dist/auth.js');
const { mintId } = await import('../dist/client.js');
const { storeKey } = await import('../dist/app-storage.js');
const { onlineCustody } = await import('../dist/app-online.js');
const { ProgressiveWrites, progressiveWriteCustody } = await import('../dist/progressive-writes.js');
const { journalChanges } = await import('../dist/journal-changes.js');
const { trackDispatch } = await import('../dist/online-dispatch.js');
const { IdentityWait, identityRefusal } = await import('../dist/identity-admission.js');
const { WRITE_HISTORY_LIMIT } = await import('../dist/writes.js');
const url = 'https://progressive-writes.invalid', key = storeKey('writes', url, 'alice');
const regression = (name, work) => test(name, { timeout: 20_000 }, work);
function capture(t) {
  const owner = { publications: [], episodes: [] }, install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', function(client, identity, fetch, changed, ...args) {
    owner.writes = this; owner.fetch = fetch;
    return install.call(this, client, identity, fetch, (op, effect) => {
      if (effect?.type === 'publish') owner.publications.push(effect.publication);
      if (effect?.type === 'startEpisode') owner.episodes.push(effect);
      changed(op, effect);
    }, ...args);
  });
  return owner;
}
async function inspectAgain(t, f, owner, journal) {
  if (journal) await f.store.set(key, JSON.stringify(journal));
  const events = journalChanges(key, () => {}); t.after(() => events.close());
  const custody = owner.writes.custody, inspect = custody.inspect; let inspections = 0;
  const spy = t.mock.method(custody, 'inspect', async () => { const result = await inspect(); inspections++; return result; });
  events.notify(); await until(() => inspections > 0 && !owner.writes.uncertain); spy.mock.restore();
}
regression('S3a 0.1: cold reopen with 256 historical receipts publishes nothing', async t => {
  const store = memorySessionStore(), owner = capture(t);
  await store.set(key, JSON.stringify({ owner: 'alice', backend: url, pending: [], receipts: Array.from({ length: WRITE_HISTORY_LIMIT }, (_, n) => ({ state: 'sent', id: mintId(), seq: 1000 + n, replayed: true })) }));
  const f = await fixture(t, { raw: true, store, hold: false });
  assert.equal(owner.publications.length, 0, 'historical receipts are not this document’s pending exits');
  assert.equal(owner.writes.states.size, 0);
  await inspectAgain(t, f, owner); await inspectAgain(t, f, owner);
  assert.equal(owner.publications.length, 0);
  assert.equal((await f.app.client.query(query, {})).data, 'local', 'historical unknown cuts cannot strand current reads');
});
regression('S3a 0.1: retained receipts survive divergent eviction and repeated snapshots', async t => {
  const owner = capture(t), f = await fixture(t, { raw: true, hold: false });
  const ids = Array.from({ length: WRITE_HISTORY_LIMIT + 1 }, () => mintId());
  const journal = await f.journal(); journal.pending = ids.map(id => ({ owner: 'alice', id, op: 'write', args: {}, storeId: 'A', dispatched: true }));
  await inspectAgain(t, f, owner, journal);
  // The second outcome is unknown, so keepReceipts can drop it ahead of older
  // successful outcomes; completed state insertion order need not match retention.
  const finish = owner.writes.dispatch(ids[1]);
  journal.pending = journal.pending.slice(-1);
  journal.receipts = ids.slice(0, -1).map((id, n) => n === 1 ? { state: 'failed', id, why: { code: 'E_STORE_REPLACED', family: 'store', message: 'unknown' } } : { state: 'sent', id, seq: 21 + n, replayed: true });
  await inspectAgain(t, f, owner, journal);
  journal.pending = []; journal.receipts = journal.receipts.filter(w => w.id !== ids[1]);
  journal.receipts.push({ state: 'sent', id: ids.at(-1), seq: 400, replayed: true });
  await inspectAgain(t, f, owner, journal);
  assert.equal(owner.writes.states.has(ids[0]), true, 'retained oldest success stays represented');
  assert.equal(owner.writes.states.has(ids[2]), true, 'retained history cannot be sacrificed to an outstanding pin');
  assert.equal(owner.publications.length, ids.length);
  await inspectAgain(t, f, owner); await inspectAgain(t, f, owner);
  assert.equal(owner.publications.length, ids.length, 'unchanged snapshots cannot republish in waves');
  finish();
  assert.equal(owner.writes.states.size, WRITE_HISTORY_LIMIT);
  assert.equal(owner.writes.states.has(ids[1]), false, 'eviction follows the retained receipt set');
});
regression('S3a 0.1: never-admitted identity-wait refusal causes no read', async t => {
  const owner = capture(t), f = await fixture(t);
  await f.app.ready;
  const watched = f.app.client.observe(query, {}); watched.subscribe(() => {}); t.after(() => watched.close());
  await until(() => watched.getSnapshot().data === 'server');
  const before = f.reads();
  t.mock.getter(IdentityWait.prototype, 'size', () => 1);
  t.mock.method(IdentityWait.prototype, 'run', function(_entry, _check, _admit, refused) { return Promise.resolve(refused(identityRefusal(false))); });
  const id = mintId(), result = await f.app.mutate(mutation, {}, { id, waitSeconds: 5 });
  assert.equal(result.why?.code, 'E_ADMISSION_STORE');
  await inspectAgain(t, f, owner);
  assert.equal(owner.writes.states.has(id), false, 'no admission or dispatch owns this id');
  assert.equal(owner.publications.length, 0); assert.equal(f.reads(), before);
});
regression('S3a 0.2A: obsolete arrival rereads other columns outside its publication footprint', async t => {
  const backend = structuredClone(schema), owner = capture(t); let replacing = false;
  backend.programs.find(p => p.name === 'write').settlement.writes = { items: ['body'] };
  backend.programs.find(p => p.name === 'read').settlement.reads = { items: ['title'] };
  const f = await fixture(t, { backend, receiptReply: r => ({ ...r, preserved: ['items'] }),
    refreshReply: () => Response.json({ ok: false, why: { code: 'E_OVERLOADED', family: 'availability', message: 'retry', retryable: true } }, { status: 503 }),
    queryReply: (_path, head) => ({ data: replacing ? 'replacement' : 'displayed', complete: true, tables: ['items'], scopes: { items: [{}] }, seq: head, store_id: 'A', generation: 1 }) });
  await f.app.ready;
  const writing = f.app.mutate(mutation, {}, { waitSeconds: 5 }); await f.posted.promise;
  assert.equal((await f.app.client.refreshSession()).ok, false);
  const watched = f.app.client.observe(query, {}); watched.subscribe(() => {}); t.after(() => watched.close());
  await until(() => watched.getSnapshot().data === 'displayed'); replacing = true;
  f.release.resolve(); assert.equal((await writing).state, 'sent');
  assert.ok(owner.episodes.some(e => e.scope === 'all-columns-of-known-tables'));
  await until(() => watched.getSnapshot().data === 'replacement');
});
regression('S3a 0.2B: late own response rereads after the peer replacement has finished', async t => {
  const owner = capture(t); let value = 'displayed';
  const f = await fixture(t, { receiptReply: r => ({ ...r, preserved: [] }),
    queryReply: (_path, head) => ({ data: value, complete: true, tables: ['items'], scopes: { items: [{}] }, seq: head, store_id: 'A', generation: 1 }) });
  await f.app.ready;
  const watched = f.app.client.observe(query, {}); watched.subscribe(() => {}); t.after(() => watched.close());
  await until(() => watched.getSnapshot().data === 'displayed');
  const id = mintId(), writing = f.app.mutate(mutation, {}, { id, waitSeconds: 5 }); await f.posted.promise;
  value = 'peer replacement'; const journal = await f.journal(); journal.pending = []; journal.receipts = [{ state: 'sent', id, seq: 21, replayed: true }];
  await inspectAgain(t, f, owner, journal); await until(() => watched.getSnapshot().data === value);
  await tick(); const reads = f.reads(); value = 'late replacement'; f.release.resolve(); await writing;
  await until(() => watched.getSnapshot().data === value);
  assert.ok(f.reads() > reads); assert.equal(owner.publications.length, 1);
  assert.equal(owner.writes.states.get(id)?.phase, 'settled'); assert.equal(owner.writes.states.get(id)?.certificate, undefined);
});
regression('S3a 0.3: foreign completion wakes without a B-side barrier or forgotten answer', async t => {
  let answers; globalThis.__s3aAnswers = value => { answers = value; }; t.after(() => { delete globalThis.__s3aAnswers; });
  const owner = capture(t), f = await fixture(t, { raw: true });
  f.replace('B'); f.head(30); await f.app.client.sync();
  await f.app.ready;
  const watched = f.app.client.observe(query, {}); watched.subscribe(() => {}); t.after(() => watched.close());
  await until(() => 'data' in watched.getSnapshot());
  const changed = t.mock.method(answers, 'changed'), forget = t.mock.method(answers.serverAnswers, 'forget');
  const revision = answers.revision;
  // Drive the real executor with the pure foreign-store publication row.
  const { extract } = await import('../dist/settlement-extract.js');
  const id = mintId(), facts = extract({ state: 'sent', seq: 99, store_id: 'A', generation: 1 },
    { kind: 'response', source: 'journal-wrapper', id, op: 'write', footprintKnown: true, restoreConfirmed: false },
    { closed: false, sessionDead: false, credentialRevision: 0, incarnation: 0, storeIdentity: 'B', onlineStore: 'B', generation: 1, onlineHead: 30, onlineGeneration: 1, dispatchWatermark: 20, dispatchSendRevision: 0, dispatchStore: 'A', dispatchIncarnation: 0, requestRevision: 0, requestStore: 'A' });
  owner.writes.receipt(id, facts); owner.writes.reduce(id, { type: 'persisted' }, facts);
  assert.deepEqual(owner.publications.at(-1), { invalidate: false, cut: undefined, preserved: undefined, footprint: 'qualified' });
  assert.equal(changed.mock.callCount(), 0, 'wake is not change evidence');
  assert.equal(answers.revision, revision); assert.equal(forget.mock.callCount(), 0);
});
regression('S3a 0.4: adoption window captures B without A head and installs only B head', async t => {
  let metadata, adopt;
  globalThis.__s3aMetadata = (read, replace) => { metadata = read; adopt = replace; };
  t.after(() => { delete globalThis.__s3aMetadata; });
  const owner = capture(t), f = await fixture(t, { raw: true, hold: false });
  f.head(100); await f.app.client.query(query, {});
  assert.equal(metadata().onlineHead, 100);
  f.replace('B'); f.head(30); adopt();
  assert.deepEqual(metadata(), { onlineHead: 100, onlineStore: 'A', storeIdentity: 'B', seq: 0 });
  let facts; const receipt = ProgressiveWrites.prototype.receipt;
  t.mock.method(ProgressiveWrites.prototype, 'receipt', function(id, value) { facts = value; return receipt.call(this, id, value); });
  const response = await owner.fetch(`${url}/m/write`, { method: 'POST', body: JSON.stringify({ id: mintId(), store_id: 'A', args: {} }) });
  assert.equal((await response.json()).why?.code, 'E_STORE_REPLACED');
  assert.ok(facts, 'the wrapper processed the response after capturing B');
  assert.equal(facts.capture.watermark, 0, 'A’s 100 is not dispatch evidence for B');
  assert.equal(metadata().onlineHead, 30, 'adopting B resets the lagging A maximum');
  assert.notEqual((await f.app.client.query(query, {})).denied?.code, 'E_STORE_RESTORE');
});
function rawFixture() {
  let viewer = 'alice', onWrite, onViewer;
  const raw = { viewer: () => viewer, onViewer: fn => { onViewer = fn; return () => {}; }, onWrite: fn => { onWrite = fn; return () => {}; },
    mutate: async () => ({ state: 'pending', id: '' }), write: async () => undefined, pendingWrites: async () => [], close: async () => {}, signOut: async () => {} };
  trackDispatch(raw, { store: 'B' });
  return { raw, emit: write => onWrite(write), viewer: next => { viewer = next; onViewer(next); } };
}
for (const progressive of [false, true]) regression(`S3a 0.6: kept B success settles after refusal, progressive=${progressive}`, async t => {
  const store = memorySessionStore(), id = mintId(), entered = gate(), result = gate(), f = rawFixture(), events = [];
  f.raw.mutate = async () => { entered.resolve(); return result.promise; };
  const owner = await onlineCustody(f.raw, url, store, e => { throw e; }, true, undefined, true, progressive, undefined, (kind, write) => events.push([kind, write]));
  t.after(() => owner.client.close());
  const writing = owner.client.mutate(mutation, {}, { id }); await entered.promise;
  await owner.refuseStore({ code: 'E_STORE_REPLACED', family: 'store', message: 'changed' }, 'B');
  const sent = { state: 'sent', id, seq: 31 }; f.emit(sent); result.resolve(sent); await writing;
  const journal = await owner.inspect();
  assert.equal(journal.pending.length, 0); assert.equal(journal.receipts[0]?.seq, 31);
  assert.ok(events.some(([kind]) => kind === 'persisted'));
});
regression('S3a 0.7: duplicate settlement emits persisted only for the transaction that removed pending', async t => {
  const store = memorySessionStore(), id = mintId(), f = rawFixture(), events = [];
  const owner = await onlineCustody(f.raw, url, store, e => { throw e; }, false, undefined, true, true, undefined, (kind, write) => events.push([kind, write]));
  t.after(() => owner.client.close());
  await store.set(key, JSON.stringify({ owner: 'alice', backend: url, pending: [{ owner: 'alice', id, op: 'write', args: {}, storeId: 'B' }], receipts: [] }));
  f.emit({ state: 'sent', id, seq: 31 }); await until(() => events.some(([kind]) => kind === 'observed'));
  events.length = 0; f.emit({ state: 'sent', id, seq: 31 }); await until(() => events.length > 0);
  assert.deepEqual(events.map(([kind]) => kind), ['observed']);
});
regression('S3a 0.8: raw store refusal before initialized retires despite observed viewer change', async t => {
  const memory = memorySessionStore(), id = mintId(), other = mintId(), entered = gate(), release = gate(), f = rawFixture(), errors = [];
  await memory.set(key, JSON.stringify({ owner: 'alice', backend: url, pending: [id, other].map(id => ({ owner: 'alice', id, op: 'write', args: {}, storeId: 'B' })), receipts: [] }));
  let held = true;
  const store = { ...memory, async get(k) { if (held && k === key) { held = false; entered.resolve(); await release.promise; } return memory.get(k); } };
  t.after(() => release.resolve());
  const opening = onlineCustody(f.raw, url, store, error => errors.push(error), false);
  await entered.promise; f.viewer('bob');
  f.emit({ state: 'failed', id, why: { code: 'E_STORE_REPLACED', family: 'store', message: 'changed' } });
  release.resolve(); const owner = await opening; t.after(() => owner.client.close());
  await until(async () => JSON.parse(await memory.get(key)).receipts.length > 0);
  const journal = JSON.parse(await memory.get(key));
  assert.equal(journal.pending.length, 0, 'the active raw actor retires every intent');
  assert.deepEqual(journal.receipts.map(w => w.id).sort(), [id, other].sort());
  assert.deepEqual(errors, []);
});
regression('S3a 0.7: failed-save retry after peer completion reports observed, never persisted', async t => {
  const memory = memorySessionStore(), id = mintId(), f = rawFixture(), events = [], errors = []; let failing = false;
  const store = { ...memory, async set(k, value) { if (failing && k === key && JSON.parse(value).receipts?.length) throw Error('held save'); return memory.set(k, value); } };
  const owner = await onlineCustody(f.raw, url, store, error => errors.push(error), false, undefined, true, true, undefined, (kind, write) => events.push([kind, write]));
  t.after(() => owner.client.close());
  await memory.set(key, JSON.stringify({ owner: 'alice', backend: url, pending: [{ owner: 'alice', id, op: 'write', args: {}, storeId: 'B' }], receipts: [] }));
  failing = true; f.emit({ state: 'sent', id, seq: 31 }); await until(() => errors.length === 1);
  assert.deepEqual(events.map(([kind]) => kind), ['observed']);
  failing = false; events.length = 0;
  await memory.set(key, JSON.stringify({ owner: 'alice', backend: url, pending: [], receipts: [{ state: 'sent', id, seq: 31 }] }));
  f.emit({ state: 'sent', id, seq: 31 }); await owner.inspect();
  assert.deepEqual(events.map(([kind]) => kind), ['observed'], 'a no-op retry still reports the observed pending exit');
});
