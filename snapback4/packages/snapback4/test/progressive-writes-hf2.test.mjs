// @ref LLP 3000.002.000.000#7 — review-found executor regressions use the real raw queue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url === new URL('../dist/local.js', import.meta.url).href) {
    const needle = 'let onlineHead = 0, onlineStore = backend?.store_id, onlineGeneration = Number(backend?.generation ?? 0);';
    assert.ok(String(result.source).includes(needle));
    result.source = String(result.source).replace(needle, needle + ' globalThis.__hf2Adopt?.(() => { storeIdentity = onlineStore = "B"; seq = onlineHead = 0; });');
  }
  if (url === new URL('../dist/client-start.js', import.meta.url).href) {
    const needle = 'const client = await create();';
    assert.ok(String(result.source).includes(needle));
    result.source = String(result.source).replace(needle, needle + ' globalThis.__hf2Transport?.(options, client);');
  }
  if (url === new URL('../dist/client.js', import.meta.url).href) {
    const needle = 'trackDispatch(client, dispatch);';
    assert.ok(String(result.source).includes(needle));
    result.source = String(result.source).replace(needle, needle + ' globalThis.__hf2Observe?.(observeStore);');
  }
  return result;
} });
const { fixture, gate, tick, until, mutation } = await import('./helpers/progressive-writes.mjs');
const { memorySessionStore } = await import('../dist/auth.js');
const { storeKey } = await import('../dist/app-storage.js');
const { mintId } = await import('../dist/client.js');
const { seedDispatchIdentity, trackDispatch } = await import('../dist/online-dispatch.js');
const { onlineCustody } = await import('../dist/app-online.js');
const { ProgressiveWrites, progressiveWriteCustody } = await import('../dist/progressive-writes.js');

for (const adopted of [undefined, 'B']) test(`HF2 H1: explicit retirement replaces earlier keep, adopted=${adopted}`, async t => {
  const id = mintId(), entered = gate(), response = gate(), store = memorySessionStore();
  const why = { code: 'E_STORE_REPLACED', family: 'store', message: 'retired' };
  const raw = { viewer: () => 'alice', onViewer: () => () => {}, onWrite: () => () => {},
    mutate: () => { entered.resolve(); return response.promise; }, write: async () => undefined,
    pendingWrites: async () => [], close: async () => {}, signOut: async () => {} };
  trackDispatch(raw, { store: 'A' });
  const owner = await onlineCustody(raw, 'https://progressive-writes.invalid', store, e => { throw e; }, true, undefined, true, true);
  t.after(() => { response.resolve({ state: 'pending', id }); return owner.client.close(); });
  const writing = owner.client.mutate(mutation, {}, { id }); await entered.promise;
  owner.keepStore(id);
  await owner.refuseStore(why, adopted);
  owner.keepStore(id); // A late keep response cannot undo the committed retirement.
  response.resolve({ state: 'failed', id, why });
  assert.equal((await writing).state, 'failed');
  const journal = await owner.inspect();
  assert.deepEqual(journal.pending, []); assert.equal(journal.receipts[0].state, 'failed');
});

for (const mode of ['selective', 'held persona retirement', 'keep'])
test(`HF2 H1: ${mode} preserves B intent after two real queued writes receive synthetic failures`, { timeout: 20_000 }, async t => {
  const persona = mode === 'held persona retirement', viewer = persona ? 'dev:alice' : 'alice';
  const url = persona ? 'http://127.0.0.1:4400' : 'https://progressive-writes.invalid';
  const key = storeKey('writes', url, viewer), memory = memorySessionStore();
  const wa = mintId(), wb = mintId(), entered = gate(), reply = gate(), saving = gate(), saved = gate();
  let adopt, raw, progressive, holdSave = persona;
  const errors = [], rawEvents = [], events = [];
  const store = { ...memory, async set(k, value) {
    if (holdSave && k === key && JSON.parse(value).receipts?.some(w => w.id === wa)) {
      holdSave = false; saving.resolve(); await saved.promise;
    }
    return memory.set(k, value);
  } };
  globalThis.__hf2Adopt = setter => { adopt = setter; };
  globalThis.__hf2Transport = (options, client) => { if (!options.device) raw = client; };
  t.after(() => { reply.resolve(); saved.resolve(); delete globalThis.__hf2Adopt; delete globalThis.__hf2Transport; });
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', function(local, identity, fetch, ...args) {
    progressive = this;
    return install.call(this, local, identity, async (input, init) => {
      if (new URL(input).pathname.startsWith('/m/') && JSON.parse(init.body).id === wa) {
        entered.resolve(); await reply.promise;
      }
      return fetch(input, init);
    }, ...args);
  });
  const f = await fixture(t, { raw: true, persona, store, report: e => errors.push(e), hold: false,
    storeRefusalCode: mode === 'keep' ? 'E_STORE_RESTORE' : 'E_STORE_REPLACED',
    ...(persona ? { onStoreChange: why => {
      // Match the device persona app's refusal-save-before-pause callback.
      const handle = progressiveWriteCustody(progressive.local);
      void handle.refuseStore(why).finally(() => handle.pause()).catch(error => errors.push(error));
    } } : {}) });
  raw.onWrite(write => rawEvents.push(write)); f.app.client.onWrite(write => events.push(write));
  const writingA = f.app.mutate(mutation, {}, { id: wa, waitSeconds: 5 }); await entered.promise;
  // The device adopted B while its raw dispatcher's A request was held. Bind
  // the second admission to B, then let the wrapper capture current B authority.
  f.replace('B'); adopt(); seedDispatchIdentity(raw, 'B');
  const writingB = f.app.mutate(mutation, {}, { id: wb, waitSeconds: 5 });
  await until(async () => (await raw.pendingWrites()).length === 2);
  assert.deepEqual((await f.journal()).pending.map(w => [w.id, w.storeId]), [[wa, 'A'], [wb, 'B']]);
  reply.resolve();
  await until(() => rawEvents.length === 2);
  if (persona) {
    await saving.promise;
    assert.equal(progressive.lifetime, 'installed', 'persona pause is delayed while retirement save holds');
    saved.resolve();
  }
  assert.equal((await writingB).state, 'pending');
  assert.equal((await writingA).state, mode === 'keep' ? 'pending' : 'failed');
  if (!persona) assert.equal((await f.app.client.write(wb))?.state, 'pending', 'lookup cannot persist a synthetic failure either');
  // Drain all onWrite transactions before inspecting durable custody.
  await f.app.close();
  const journal = await f.journal();
  assert.deepEqual(journal.pending.map(w => w.id), mode === 'keep' ? [wa, wb] : [wb]);
  assert.equal(journal.receipts.some(w => w.id === wb), false);
  assert.equal(events.some(w => w.id === wb), false);
  assert.deepEqual(errors, []);
  const reopened = await f.reopen(); await reopened.ready;
  await until(async () => (await reopened.client.write(wb))?.state === 'sent');
  assert.equal(f.requests.filter(id => id === wb).length, 1, 'reopen replays the kept id exactly once');
});

for (const code of ['E_STORE_REPLACED', 'E_DEV_RESET', 'E_STORE_RESTORE'])
for (const malformed of ['family', 'message', 'retryable'])
test(`HF2 H3: malformed ${code} ${malformed} keeps custody and the dispatcher alive`, { timeout: 10_000 }, async t => {
  let raw, repaired = false;
  globalThis.__hf2Transport = (options, client) => { if (!options.device) raw = client; };
  t.after(() => { delete globalThis.__hf2Transport; });
  const why = { code, family: 'store', message: 'changed' };
  if (malformed === 'retryable') why.retryable = 'no'; else delete why[malformed];
  const f = await fixture(t, { raw: true, hold: false, receiptReply: receipt => repaired ? receipt : { state: 'failed', why } });
  const id = mintId(); await f.app.mutate(mutation, {}, { id, waitSeconds: 0 });
  await f.posted.promise; await tick();
  assert.deepEqual((await raw.pendingWrites()).map(write => write.id), [id], 'malformed refusal must not stop the raw dispatcher');
  assert.equal((await f.app.client.write(id)).state, 'pending');
  const journal = await f.journal();
  assert.deepEqual(journal.pending.map(write => write.id), [id]); assert.deepEqual(journal.receipts, []);
  repaired = true;
  await until(async () => (await f.app.client.write(id))?.state === 'sent');
  assert.ok(f.requests.length >= 2, 'the same dispatcher retries once valid evidence is available');
});

for (const code of ['E_STORE_REPLACED', 'E_DEV_RESET', 'E_STORE_RESTORE'])
test(`HF2 H3 observer boundary: code-only ${code} cannot manufacture a terminal queue failure`, async t => {
  let observe, raw;
  globalThis.__hf2Observe = fn => { observe = fn; };
  globalThis.__hf2Transport = (options, client) => { if (!options.device) raw = client; };
  t.after(() => { delete globalThis.__hf2Observe; delete globalThis.__hf2Transport; });
  const f = await fixture(t, { raw: true });
  const id = mintId(); await f.app.mutate(mutation, {}, { id, waitSeconds: 0 }); await f.posted.promise;
  // HTTP decoding already rejects this shape. Exercise observeStore itself too:
  // every entry point must require the shared validator before acting on code.
  observe({ state: 'failed', why: { code } }, 20, true);
  assert.deepEqual((await raw.pendingWrites()).map(write => write.id), [id]);
  assert.equal((await f.app.client.write(id)).state, 'pending');
  assert.deepEqual((await f.journal()).receipts, []);
  f.release.resolve(); await until(async () => (await f.app.client.write(id))?.state === 'sent');
});
