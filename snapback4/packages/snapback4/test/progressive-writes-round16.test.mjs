import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  const patch = (needle, replacement) => {
    const source = String(result.source); assert.ok(source.includes(needle), needle);
    result.source = source.replace(needle, replacement);
  };
  if (url === new URL('../dist/local.js', import.meta.url).href) {
    patch('const response = await doFetch(input, { ...init, headers: request.headers });',
      'const response = await doFetch(input, { ...init, headers: request.headers }); await globalThis.__e16Response?.(response, input, init);');
    patch('const journalCuts = new QueryCuts();', 'const journalCuts = new QueryCuts(); globalThis.__e16Cuts?.(journalCuts);');
    patch('function observeIncarnation(id, force = false, delivery, cause = "store-reset") {',
      'function observeIncarnation(id, force = false, delivery, cause = "store-reset") { globalThis.__e16Incarnation?.(id, force, cause);');
    patch('function scheduleRead(watch, changed = false, cut, preserved, writes) {',
      'function scheduleRead(watch, changed = false, cut, preserved, writes) { globalThis.__e16Schedule?.(watch, changed, cut, preserved, writes);');
    patch('let onlineHead = 0, onlineStore = backend?.store_id, onlineGeneration = Number(backend?.generation ?? 0);',
      'let onlineHead = 0, onlineStore = backend?.store_id, onlineGeneration = Number(backend?.generation ?? 0); globalThis.__e16Metadata?.(() => ({ onlineHead, onlineStore, onlineGeneration }));');
  }
  if (url === new URL('../dist/client-start.js', import.meta.url).href) {
    patch('const client = await create();', 'const client = await create(); await globalThis.__e16Prepared?.(options, client);');
  }
  if (url === new URL('../dist/progressive-writes.js', import.meta.url).href && process.env.E16_CONTROL === 'pause-guard') {
    patch('if (this.lifetimePaused)\n                return failedAdmission(options?.id ?? mintId(), this.admissionDenied ??\n                    admissionRefusal("write custody is paused", "app.mutate", "retry after opening resumes"));', '');
  }
  return result;
} });
const { unpublishedReceipt, unpublishedCount, completed, outstanding, outstandingCount, receiptFacts } = await import("./helpers/progressive-writes.mjs");
const { memorySessionStore } = await import('../dist/auth.js');
const { mintId } = await import('../dist/client.js');
const { storeKey, storeLock } = await import('../dist/app-storage.js');
const { ProgressiveWrites, progressiveWriteCustody } = await import('../dist/progressive-writes.js');
const { fixture, gate, tick, until, mutation, query, schema } = await import('./helpers/progressive-writes.mjs');
const regression = (item, name, work) => test(`E16 item ${item}: ${name}`, { timeout: 20_000, skip: process.env.E16_ITEM && !process.env.E16_ITEM.split(',').includes(String(item)) }, work);
const url = 'https://progressive-writes.invalid', key = storeKey('writes', url, 'alice');
const refreshReply = () => Response.json({ ok: false, why: { code: 'E_OVERLOADED', family: 'availability', message: 'try later', retryable: true } }, { status: 503 });
function hook(t, name, value) { globalThis[name] = value; t.after(() => { delete globalThis[name]; }); }
async function seed(store, ids) {
  await store.set(key, JSON.stringify({ owner: 'alice', backend: url, pending: ids.map(id => ({ owner: 'alice', id, op: 'write', args: {}, storeId: 'A' })), receipts: [] }));
}

for (const boundary of ['credential rotation', 'program adoption']) for (const code of ['E_STORE_REPLACED', 'E_DEV_RESET']) regression(1, `${code} recovers an adopted-store dispatcher after ${boundary}`, async t => {
  const store = memorySessionStore(), id = mintId(), entered = gate(), release = gate(); let local;
  await seed(store, [id]);
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', function(client, ...args) { local = client; return install.call(this, client, ...args); });
  hook(t, '__e16Response', async response => {
    const json = await response.clone().json(); if (json.why?.code !== 'E_STORE_REPLACED') return;
    if (code !== json.why.code) {
      const replacement = { ...json, why: { ...json.why, code } };
      t.mock.method(response, 'clone', () => Response.json(replacement));
      // Both the local evidence path and private transport consume this refusal.
      t.mock.method(response, 'text', async () => JSON.stringify(replacement));
      t.mock.method(response, 'json', async () => replacement);
    }
    entered.resolve(); await release.promise;
  });
  t.after(() => release.resolve());
  const backend = structuredClone(schema);
  const f = await fixture(t, { startup: 'awaited', store, hold: false, refreshReply, backend });
  f.coreGate.resolve(); await f.app.ready;
  await until(async () => (await f.app.client.write(id))?.state === 'sent');
  f.replace('B'); await f.app.client.sync();
  const writing = f.app.mutate(mutation, {}, { waitSeconds: 5 }); await entered.promise;
  if (boundary === 'credential rotation') assert.equal((await local.refreshSession()).ok, false);
  else { backend.generation = 2; await f.app.client.sync(); }
  const requests = f.requests.length;
  release.resolve(); assert.equal((await writing).why?.code, code);
  await until(() => f.app.auth.getSnapshot().state === 'signed-in');
  const next = await f.app.mutate(mutation, {}, { waitSeconds: 5 });
  assert.ok(f.requests.length > requests, 'the next mutation must reach B after the obsolete dispatcher retires');
  assert.equal(next.state, 'sent', JSON.stringify(next));
});

for (const obsolete of ['credential', 'generation']) regression(2, `peer completion retains live revocation with obsolete ${obsolete}`, async t => {
  const { journalChanges } = await import('../dist/journal-changes.js');
  const { episodeDeadline } = await import('../dist/read-episode.js');
  const cover = gate(), queried = gate(), received = gate(); let progressive, local, replacing = false;
  const install = ProgressiveWrites.prototype.install, receipt = ProgressiveWrites.prototype.receipt;
  t.mock.method(ProgressiveWrites.prototype, 'install', async function(client, ...args) { await install.call(this, client, ...args); progressive = this; local = client; });
  t.mock.method(ProgressiveWrites.prototype, 'receipt', function(...args) { const result = receipt.apply(this, args); received.resolve(args[1]); return result; });
  const cuts = [];
  hook(t, '__e16Cuts', owner => {
    const change = owner.change;
    t.mock.method(owner, 'change', function(...args) { cuts.push(args); return change.apply(this, args); });
  });
  t.after(() => cover.resolve());
  const backend = structuredClone(schema);
  backend.programs.find(p => p.name === 'write').settlement.writes = { items: ['title'] };
  backend.programs.find(p => p.name === 'other').settlement.reads = { items: ['body'] };
  const f = await fixture(t, { backend, refreshReply, receiptReply: r => ({ ...r, preserved: ['items'], ...(obsolete === 'generation' ? { generation: 2, head: undefined, replayed: true } : {}) }),
    queryReply: async (_path, head) => {
      if (replacing) { queried.resolve(); await cover.promise; }
      return { data: replacing ? 'replacement' : 'displayed', complete: true, tables: ['items'], scopes: { items: [{}] }, seq: head, store_id: 'A', generation: 1 };
    } });
  await f.app.ready;
  const id = mintId(), writing = f.app.mutate(mutation, {}, { id, waitSeconds: 0 });
  await f.posted.promise; await writing;
  if (obsolete === 'credential') assert.equal((await local.refreshSession()).ok, false);
  // A disjoint column read can publish while this write is pending; an
  // unqualified certificate must conservatively invalidate its whole table.
  const displayed = local.observe({ kind: 'query', name: 'other' }, {}); displayed.subscribe(() => {}); t.after(() => displayed.close());
  await until(() => displayed.getSnapshot().data === 'displayed');
  await until(() => !progressive.uncertain && progressive.current().some(write => write.id === id));
  replacing = true;
  const events = journalChanges(key, () => {}); t.after(() => events.close());
  await storeLock(key, async () => { const journal = await f.journal(); journal.pending = []; journal.receipts.push({ state: 'sent', id, seq: 21, replayed: true }); await f.store.set(key, JSON.stringify(journal)); });
  events.notify(); await until(() => !progressive.uncertain && !progressive.current().some(write => write.id === id));
  await queried.promise;
  assert.equal(displayed.getSnapshot().data, 'displayed');
  assert.equal(episodeDeadline(displayed.getSnapshot()), undefined);
  const settledCuts = cuts.length;
  f.release.resolve(); const evidence = await received.promise;
  assert.equal(evidence.authorityCurrent(), obsolete !== 'credential');
  assert.equal((unpublishedReceipt(progressive, id) !== undefined), false);
  const deadline = episodeDeadline(displayed.getSnapshot());
  assert.ok(deadline !== undefined && deadline - Date.now() <= 1000, 'unqualified live preservation must start the withdrawal bound after peer completion');
  await until(() => !('data' in displayed.getSnapshot())); assert.ok(Date.now() <= deadline + 250);
  assert.equal(cuts.length, settledCuts, 'late preservation installs no second cut');
  cover.resolve(); await until(() => displayed.getSnapshot().data === 'replacement');
});

for (const kind of ['shrink', 'generation', 'foreign-reset', 'foreign-restore']) regression(4, `refusal metadata observes only accepted evidence: ${kind}`, async t => {
  const store = memorySessionStore(), id = mintId(), changes = [], resets = []; let metadata;
  await seed(store, [id]);
  hook(t, '__e16Metadata', read => { metadata = read; });
  hook(t, '__e16Incarnation', (...args) => resets.push(args));
  hook(t, '__e16Response', async response => {
    const json = await response.clone().json(); if (json.why?.code !== 'E_STORE_REPLACED') return;
    if (kind === 'shrink') json.head = 30;
    else if (kind === 'generation') json.generation = 2;
    else { json.why.code = kind === 'foreign-reset' ? 'E_DEV_RESET' : 'E_STORE_RESTORE'; json.store_id = 'A'; json.head = 0; json.generation = 2; }
    t.mock.method(response, 'clone', () => Response.json(json));
    t.mock.method(response, 'text', async () => JSON.stringify(json));
    t.mock.method(response, 'json', async () => json);
  });
  const f = await fixture(t, { raw: true, startup: 'awaited', journal: true, store, hold: false, onStoreChange: why => changes.push(why) });
  await until(async () => (await f.app.client.write(id))?.state === 'sent');
  f.replace('B'); f.head(40); await f.app.client.sync();
  assert.deepEqual(metadata(), { onlineStore: 'B', onlineHead: 40, onlineGeneration: 1 });
  resets.length = 0; changes.length = 0;
  const write = await f.app.client.mutate(mutation, {}, { waitSeconds: 5 });
  assert.equal(write.state, 'failed');
  if (kind === 'shrink') {
    assert.equal((await f.app.client.query(query, {})).denied?.code, 'E_STORE_RESTORE', 'same-store shrink must pass through the durable restore witness');
    assert.equal(metadata().onlineHead, 40, 'a refusal cannot lower the observed high watermark');
  } else if (kind === 'generation') {
    assert.equal(resets.filter(([, force, cause]) => force && cause === 'program-generation').length, 1, 'same-store generation evidence resets program authority once');
    assert.equal(metadata().onlineGeneration, 2); assert.equal(changes.length, 1, 'dispatcher recovery still has one callback');
  } else {
    assert.deepEqual(metadata(), { onlineStore: 'B', onlineHead: 40, onlineGeneration: 1 }, 'an unaccepted A-bound refusal cannot overwrite B metadata');
    assert.equal(resets.length, 0);
  }
});

for (const when of ['before recovery', 'during recovery read']) regression(6, `opening pause ${when} can resume without reload`, async t => {
  const memory = memorySessionStore(), entered = gate(), release = gate(); await memory.set(key, 'damaged opening');
  let progressive, holding = false, installs = 0;
  const store = { ...memory, async get(k) { if (k === key && holding) { holding = false; entered.resolve(); await release.promise; } return memory.get(k); } };
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', async function(...args) {
    progressive = this; const opening = ++installs; await install.apply(this, args);
    if (opening === 1) {
      // Own the first recovery boundary: the fixture normally starts at once.
      const handle = progressiveWriteCustody(args[0]), start = handle.start; let initialStart = true;
      handle.start = () => { if (initialStart) { initialStart = false; return; } start(); };
    }
  });
  t.after(() => release.resolve());
  const f = await fixture(t, { raw: true, store, hold: false, report: () => {} });
  const handle = progressiveWriteCustody(f.app.client);
  if (when === 'before recovery') { handle.pause(); await progressive.pending(); }
  else { holding = true; const recovering = progressive.pending(); await entered.promise; handle.pause(); release.resolve(); await recovering; }
  assert.equal(installs, 1, 'pause precedes nested transport preparation');
  assert.equal(progressive.custody, undefined);
  const id = mintId(); assert.equal((await f.app.client.mutate(mutation, {}, { id, waitSeconds: 0 })).why?.code, 'E_ADMISSION');
  handle.start();
  await until(() => progressive.custody !== undefined);
  assert.equal((await f.app.client.mutate(mutation, {}, { id, waitSeconds: 5 })).state, 'sent', 'start resumes recovery and admits the refused id');
  assert.deepEqual(f.requests, [id]);
});

regression(5, 'an unadmitted own receipt survives 256 admitted certificates and response pressure', async t => {
  const { WRITE_HISTORY_LIMIT } = await import('../dist/writes.js');
  const { journalChanges } = await import('../dist/journal-changes.js');
  let progressive; const settled = [];
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', async function(client, identity, fetch, changed, ...args) {
    await install.call(this, client, identity, fetch, (...event) => { if (event[1]?.type === "publish") settled.push(event); changed(...event); }, ...args); progressive = this;
  });
  const f = await fixture(t, { raw: true, hold: false });
  const ids = Array.from({ length: WRITE_HISTORY_LIMIT }, () => mintId());
  const events = journalChanges(key, () => {}); t.after(() => events.close());
  const intent = id => ({ owner: 'alice', id, op: 'write', args: {}, storeId: 'A', dispatched: true });
  await storeLock(key, async () => { const journal = await f.journal(); journal.pending = ids.map(intent); await f.store.set(key, JSON.stringify(journal)); });
  events.notify(); await until(() => !progressive.uncertain && progressive.current().length === ids.length);
  const evidence = { store: 'A', generation: 1, preserved: ['items'], authorityCurrent: () => true };
  for (const id of ids) progressive.receipt(id, receiptFacts(id, evidence));
  const fresh = mintId(), certificate = receiptFacts(fresh, { ...evidence, preserved: [] }, 42), finish = progressive.dispatch(fresh); t.after(finish);
  assert.equal(progressive.current().some(write => write.id === fresh), false);
  progressive.receipt(fresh, certificate);
  assert.equal(unpublishedReceipt(progressive, fresh), certificate.certificate, 'the newly inserted pre-admission certificate cannot evict itself');
  const other = mintId(); progressive.receipt(other, receiptFacts(other, evidence));
  assert.deepEqual(unpublishedReceipt(progressive, other)?.preserved, evidence.preserved, 'even an unpinned insertion cannot evict itself');
  assert.equal(unpublishedReceipt(progressive, fresh), certificate.certificate, 'an outstanding response stays pinned during another insertion');
  await storeLock(key, async () => { const journal = await f.journal(); journal.pending.push(intent(fresh)); await f.store.set(key, JSON.stringify(journal)); });
  events.notify(); await until(() => progressive.current().some(write => write.id === fresh));
  await storeLock(key, async () => { const journal = await f.journal(); journal.pending = journal.pending.filter(write => write.id !== fresh); journal.receipts.push({ state: 'sent', id: fresh, seq: 42, replayed: true }); await f.store.set(key, JSON.stringify(journal)); });
  events.notify(); await until(() => completed(progressive, fresh));
  assert.deepEqual(settled.find(event => event[1]?.publication?.cut === 42)?.[1].publication, {invalidate:true,cut:42,preserved:[],footprint:'qualified'}, 'settlement uses the actual certificate rather than its admission placeholder');
});

regression(7, 'recovering an A-bound dispatcher replays unsent B intent instead of failing it', async t => {
  const store = memorySessionStore(), seedId = mintId(), a = mintId(), b = mintId(), entered = gate(), release = gate();
  await seed(store, [seedId]);
  hook(t, '__e16Response', async response => {
    const json = await response.clone().json(); if (json.id !== a) return;
    assert.equal(json.why?.code, 'E_STORE_REPLACED'); entered.resolve(); await release.promise;
  });
  t.after(() => release.resolve());
  const f = await fixture(t, { startup: 'awaited', store, hold: false });
  f.coreGate.resolve(); await f.app.ready;
  await until(async () => (await f.app.client.write(seedId))?.state === 'sent');
  f.replace('B'); await f.app.client.sync();
  const writing = f.app.mutate(mutation, {}, { id: a, waitSeconds: 5 }); await entered.promise;
  await storeLock(key, async () => {
    const journal = await f.journal(); journal.pending.push({ owner: 'alice', id: b, op: 'write', args: {}, storeId: 'B', dispatched: false });
    await store.set(key, JSON.stringify(journal));
  });
  assert.equal(f.requests.includes(b), false, 'B intent has never been sent');
  release.resolve(); assert.equal((await writing).why?.code, 'E_STORE_REPLACED');
  await until(() => f.app.auth.getSnapshot().state === 'signed-in');
  await until(async () => (await f.app.client.write(b))?.state !== 'pending');
  assert.equal((await f.app.client.write(b))?.state, 'sent', 'B intent remains durable and replays on the recovered dispatcher');
  assert.equal(f.requests.filter(id => id === b).length, 1);
  assert.equal((await f.journal()).pending.length, 0);
});

regression(3, 'a repaired paused dispatcher refuses its opening pending id until start', async t => {
  const store = memorySessionStore(), entered = gate(), release = gate(); await store.set(key, 'damaged opening');
  const id = mintId(); let progressive, installs = 0;
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', async function(...args) {
    progressive = this; const opening = ++installs; await install.apply(this, args);
    if (opening === 1) await seed(store, [id]); // Repair before recovery reads its opening prefix.
  });
  hook(t, '__e16Prepared', async options => { if (installs === 2 && !options.device) { entered.resolve(); await release.promise; } });
  t.after(() => release.resolve());
  const f = await fixture(t, { raw: true, store, hold: false, report: () => {} });
  const handle = progressiveWriteCustody(f.app.client), recovering = progressive.pending(); await entered.promise;
  assert.equal(progressive.initial.pending[0]?.id, id, 'the repaired opening snapshot owns X');
  handle.pause(); release.resolve(); await recovering;
  assert.ok(progressive.custody);
  assert.equal((await f.app.client.write(id))?.state, 'pending');
  assert.deepEqual(f.requests, []);
  const retry = await f.app.client.mutate(mutation, {}, { id, waitSeconds: 0 });
  assert.equal(retry.why?.code, 'E_ADMISSION', 'same-id journal ownership cannot bypass a paused opening');
  assert.deepEqual(f.requests, []);
  handle.start();
  assert.equal((await f.app.client.mutate(mutation, {}, { id, waitSeconds: 5 })).state, 'sent');
  assert.deepEqual(f.requests, [id]);
});

regression(8, 'a qualified own receipt schedules intersecting watches once at settlement', async t => {
  const schedules = [], cuts = []; let progressive;
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', async function(...args) { await install.apply(this, args); progressive = this; });
  hook(t, '__e16Schedule', (watch, changed, cut, preserved) => { if (changed && preserved != null) schedules.push({ op: watch.op.name, cut, preserved }); });
  hook(t, '__e16Cuts', owner => {
    const change = owner.change; t.mock.method(owner, 'change', function(...args) { cuts.push(args); return change.apply(this, args); });
  });
  const f = await fixture(t, { receiptReply: r => ({ ...r, preserved: [] }) }); await f.app.ready;
  const watch = f.app.client.observe(query, {}); watch.subscribe(() => {}); t.after(() => watch.close());
  await until(() => 'data' in watch.getSnapshot());
  const id = mintId(), writing = f.app.mutate(mutation, {}, { id, waitSeconds: 5 }); await f.posted.promise;
  await until(() => !progressive.uncertain && progressive.current().some(write => write.id === id));
  schedules.length = 0; cuts.length = 0;
  f.release.resolve(); assert.equal((await writing).state, 'sent');
  await until(() => completed(progressive, id) && !progressive.uncertain);
  assert.deepEqual(schedules, [{ op: 'read', cut: 21, preserved: [] }], 'ordinary certified settlement must not duplicate its live invalidation');
  assert.equal(cuts.length, 1);
});
