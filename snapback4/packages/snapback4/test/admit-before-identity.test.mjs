import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, devServer, root, binary } from "../../../witness/lib.mjs";
import { prepareClient } from "../dist/client-start.js";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { defaultFetch as nodeFetch } from "../dist/node-fetch.js";
import { until } from "./helpers/app-server.mjs";

const require = createRequire(`${root}/packages/snapback4/package.json`);
const seed = [
  { table: "conversations", row: { id: "c1", title: "General", creatorId: "dev:alice" } },
  { table: "memberships", row: { id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 } },
];
const op = { kind: "mutation", name: "send" };
const args = body => ({ conversationId: "c1", body });
async function browser(t, worker) {
  const f = await launch({ worker, seed, entrySource: `
    import { prepareClient } from "${root}/packages/snapback4/src/client-start.ts";
    import { createLocalClient as localClient } from "${root}/packages/snapback4/src/local.ts";
    import { mintId } from "${root}/packages/snapback4/src/client.ts";
    import { SnapbackProvider, usePendingWrites } from "${root}/packages/snapback4/src/react.tsx";
    import { createElement } from "${require.resolve("react")}";
    import { createRoot } from "${require.resolve("react-dom/client")}";
    window.openFresh = async url => {
      const opener = webDevice({ worker: ${worker} });
      window.posts = []; window.releasePosts = [];
      const options = { url, persona: 'alice', device: { async open(...args) { return window.core = await opener.open(...args); } }, fetch: async (url, init) => {
        if (String(url).includes('/m/')) {
          posts.push(JSON.parse(init.body));
          if (window.holdPosts) await new Promise(resolve => releasePosts.push(resolve));
        }
        return fetch(url, init);
      } };
      const prepared = await prepareClient(options, () => localClient(options));
      window.client = prepared.client; window.start = prepared.start;
      window.events = []; client.onWrite(w => events.push(w));
      window.save = (body, id) => client.mutate({ kind: 'mutation', name: 'send' }, { conversationId: 'c1', body }, { waitSeconds: 0, ...(id ? { id } : {}) });
      window.mintId = mintId;
      const form = document.createElement('form'); const button = document.createElement('button');
      button.textContent = 'Save'; form.append(button); document.body.append(form);
      window.saves = []; window.calls = [];
      form.onsubmit = async e => { e.preventDefault(); const call = save('Immediate'); calls.push(call); saves.push(await call); };
      function Pending() { window.hookWrites = usePendingWrites(); return null; }
      const mount = document.createElement('div'); document.body.append(mount);
      createRoot(mount).render(createElement(SnapbackProvider, { client }, createElement(Pending)));
    };
  ` });
  t.after(() => f.close());
  await f.page.evaluate(url => openFresh(url), f.api);
  return f;
}
for (const worker of [false, true]) {
  const tier = worker ? 'Worker' : 'wasm';
  test(`immediate mounted form waits for identity and second save works (${tier})`, { timeout: 90_000 }, async t => {
    const f = await browser(t, worker);
    await f.page.click('button'); await f.page.waitForFunction(() => calls.length === 1);
    assert.equal(await f.page.evaluate(() => saves.length), 0, 'no queued acknowledgement before admission');
    await f.page.waitForFunction(() => hookWrites?.length === 1);
    assert.match(await f.page.evaluate(() => hookWrites[0].reason), /not yet admitted/);
    assert.deepEqual(await f.page.evaluate(async () => (await core.call({ op: 'queued' })).ok), []);
    assert.equal(await f.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('snapback4-admission:')).length), 0);
    const begin = performance.now(); await f.page.evaluate(() => start());
    await f.page.waitForFunction(() => events.length === 1 && saves.length === 1);
    t.diagnostic(JSON.stringify({ tier, identityAndFirstSaveMs: performance.now() - begin }));
    assert.equal(await f.page.evaluate(() => events[0].state), 'sent');
    await f.page.click('button'); await f.page.waitForFunction(() => events.length === 2 && saves.length === 2);
    assert.deepEqual(await f.page.evaluate(() => events.map(e => e.state)), ['sent', 'sent']);
    assert.deepEqual(await f.page.evaluate(() => posts.map(e => e.id)), await f.page.evaluate(() => saves.map(e => e.id)));
  });
  test(`pre-identity burst admits in call order with ordinary prediction (${tier})`, { timeout: 90_000 }, async t => {
    const f = await browser(t, worker);
    await f.page.evaluate(() => {
      window.ids = [mintId(), mintId(), mintId()]; window.burst = ids.map((id, i) => save(String(i), id));
      window.same = save('0', ids[0]); window.conflict = save('different', ids[0]);
    });
    assert.equal((await f.page.evaluate(() => conflict)).why.code, 'E_WRITE_ID_REUSE');
    const ids = await f.page.evaluate(() => ids);
    assert.deepEqual(await f.page.evaluate(async () => (await client.pendingWrites()).map(e => e.id)), ids);
    assert.equal(await f.page.evaluate(() => posts.length), 0);
    await f.page.evaluate(() => { window.holdPosts = true; return start(); });
    await f.page.evaluate(() => Promise.all(burst));
    const entries = await f.page.evaluate(async () => (await core.call({ op: 'queued' })).ok);
    assert.deepEqual(entries.map(e => e.id), ids);
    assert.ok(entries.every(e => e.predictable && e.predicted.length), JSON.stringify(entries));
    await f.page.evaluate(() => { holdPosts = false; releasePosts.splice(0).forEach(f => f()); });
    await f.page.waitForFunction(() => events.length === 3);
    assert.deepEqual(await f.page.evaluate(() => posts.map(e => e.id)), ids);
    assert.deepEqual(await f.page.evaluate(() => events.map(e => e.id)), ids);
  });
  test(`reload discards only the unadmitted call (${tier})`, { timeout: 90_000 }, async t => {
    const f = await browser(t, worker);
    await f.page.evaluate(() => { window.id = mintId(); window.call = save('not admitted', id); });
    const id = await f.page.evaluate(() => id);
    assert.equal(await f.page.evaluate(async () => (await client.pendingWrites()).length), 1);
    await f.reload(); await f.page.evaluate(url => openFresh(url), f.api);
    assert.deepEqual(await f.page.evaluate(() => client.pendingWrites()), []);
    assert.equal(await f.page.evaluate(id => client.write(id), id), undefined);
    await f.page.evaluate(() => start()); await f.page.click('button');
    await f.page.waitForFunction(() => events.length === 1);
    assert.equal(await f.page.evaluate(() => posts.length), 1);
    assert.notEqual(await f.page.evaluate(() => posts[0].id), id);
  });
  for (const failure of ['timeout', 'adoption', 'incarnation', 'restore']) test(`identity ${failure} refuses publicly without custody (${tier})`, { timeout: 90_000 }, async t => {
    const f = await browser(t, worker);
    if (failure === 'timeout') await f.page.clock.install();
    await f.page.click('button'); await f.page.waitForFunction(() => calls.length === 1);
    if (failure === 'timeout') await f.page.clock.fastForward(15_001);
    else if (failure === 'adoption') await f.page.evaluate(async () => {
      const backend = (await core.call({ op: 'backend' })).ok; backend.generation++;
      const result = await core.call({ op: 'adopt', backend }); if (result.denied) throw Error(JSON.stringify(result));
    });
    else if (failure === 'incarnation') {
      await f.page.route(`${f.api}/sync`, async route => {
        const response = await route.fetch(), body = await response.json(); body.store_id = 'replacement-before-identity';
        await route.fulfill({ response, json: body });
      });
      await f.page.evaluate(() => start());
    } else {
      const schema = await (await fetch(`${f.api}/schema`, { headers: { 'x-snapback-persona': 'alice' } })).json();
      await f.page.evaluate(async store => {
        const backend = (await core.call({ op: 'backend' })).ok;
        const result = await core.call({ op: 'apply', first: true, page: { generation: backend.generation, snapshot: true, events: [], watermark: 100, images_at: 100, committed_above: {}, more: true, next: 'held', store_id: store } });
        if (result.denied) throw Error(JSON.stringify(result));
      }, schema.store_id);
      await f.page.evaluate(() => start());
    }
    await f.page.waitForFunction(() => saves.length === 1);
    const failed = await f.page.evaluate(() => saves[0]);
    assert.equal(failed.why.code, failure === 'timeout' ? 'E_ADMISSION_TIMEOUT' : 'E_ADMISSION_STORE');
    assert.match(failed.why.message, /new attempt/);
    assert.equal(await f.page.evaluate(() => posts.length), 0);
    assert.deepEqual(await f.page.evaluate(() => client.pendingWrites()), []);
    assert.deepEqual(await f.page.evaluate(async () => (await core.call({ op: 'queued' })).ok), []);
    assert.deepEqual((await f.page.evaluate(id => client.write(id), failed.id)).why, failed.why);
    if (failure === 'timeout') {
      await f.page.clock.resume(); await f.page.click('button'); await f.page.evaluate(() => start());
      await f.page.waitForFunction(() => saves.length === 2 && events.length === 2);
      assert.equal(await f.page.evaluate(() => events[1].state), 'sent', 'same mounted form recovers');
    }
  });
}

async function nodeFixture(t, online = false, held = true) {
  const server = await devServer({ seed }), dir = mkdtempSync(join(tmpdir(), 'sb4-identity-'));
  const clients = [], posts = [], values = new Map(), probes = [];
  const store = { async get(k) { return values.get(k) ?? null; }, async set(k, v) { values.set(k, v); }, async remove(k) { values.delete(k); } };
  let hold = held, syncHeld;
  t.after(async () => { hold = false; probes.splice(0).forEach(f => f()); for (const c of clients) await c.close(); await server.close(); rmSync(dir, { recursive: true, force: true }); });
  const { createClient } = await import('../dist/client.js'); const { onlineCustody } = await import('../dist/app-online.js');
  const open = async (offline = false) => {
    let core; const opener = processDevice({ dir, binary: binary() });
    const options = { url: server.api, persona: 'alice', device: { async open(...args) { return core = await opener.open(...args); } }, fetch: async (url, init) => {
      if (offline) throw new TypeError('offline fixture');
      if (String(url).endsWith('/probe') && hold) await new Promise((resolve, reject) => {
        probes.push(resolve); init.signal?.addEventListener('abort', () => reject(Error('closed')), { once: true });
      });
      if (String(url).endsWith('/sync') && syncHeld) { syncHeld.entered = true; await syncHeld.promise; }
      if (String(url).includes('/m/')) posts.push(JSON.parse(init.body));
      return nodeFetch(url, init);
    } };
    const prepared = online ? await onlineCustody(createClient(options), server.api, store, () => {}, false)
      : await prepareClient(options, () => createLocalClient(options));
    clients.push(prepared.client); return { ...prepared, core };
  };
  return { open, posts, values, api: server.api, holdSync() { syncHeld = { ...Promise.withResolvers(), entered: false }; return syncHeld; }, release() { hold = false; probes.splice(0).forEach(f => f()); } };
}
for (const online of [false, true]) {
  const tier = online ? 'online' : 'process';
  test(`fresh first save and burst wait in memory (${tier})`, { timeout: 60_000 }, async t => {
    const f = await nodeFixture(t, online), p = await f.open(), events = []; p.client.onWrite(w => events.push(w));
    let fulfilled = 0;
    const writes = ['one', 'two', 'three'].map(body => p.client.mutate(op, args(body), { waitSeconds: 0 }).then(w => { fulfilled++; return w; }));
    await until(async () => (await p.client.pendingWrites()).length === 3);
    assert.equal(fulfilled, 0); assert.equal(f.posts.length, 0);
    const ids = (await p.client.pendingWrites()).map(w => w.id);
    if (p.core) assert.deepEqual((await p.core.call({ op: 'queued' })).ok, []);
    else assert.ok([...f.values.values()].every(v => !JSON.parse(v).pending?.length));
    const begin = performance.now(); f.release(); await p.start(); await Promise.all(writes);
    await until(() => events.length === 3);
    t.diagnostic(JSON.stringify({ tier, identityAndBurstMs: performance.now() - begin }));
    assert.deepEqual(f.posts.map(w => w.id), ids); assert.deepEqual(events.map(w => w.id), ids);
    assert.ok(events.every(w => w.state === 'sent'));
    assert.equal((await p.client.mutate(op, args('second save'), { waitSeconds: 5 })).state, 'sent');
  });
  test(`close and reopen has no unadmitted custody (${tier})`, { timeout: 60_000 }, async t => {
    const f = await nodeFixture(t, online), p = await f.open();
    const writing = p.client.mutate(op, args('lost on close'), { waitSeconds: 0 });
    await until(async () => (await p.client.pendingWrites()).length === 1);
    const id = (await p.client.pendingWrites())[0].id;
    await p.client.close(); assert.equal((await writing).state, 'failed');
    const next = await f.open(); assert.deepEqual(await next.client.pendingWrites(), []);
    assert.equal(await next.client.write(id), undefined); f.release(); await next.start();
    assert.equal((await next.client.mutate(op, args('new attempt'), { waitSeconds: 5 })).state, 'sent');
    assert.equal(f.posts.length, 1); assert.notEqual(f.posts[0].id, id);
  });
  test(`identity never arrives refuses within 15 seconds and recovers (${tier})`, { timeout: 35_000 }, async t => {
    const f = await nodeFixture(t, online), p = await f.open(), begin = performance.now();
    const failed = await p.client.mutate(op, args('timeout'), { waitSeconds: 0 }); const elapsed = performance.now() - begin;
    assert.equal(failed.why.code, 'E_ADMISSION_TIMEOUT');
    assert.ok(elapsed >= 14_900 && elapsed < 16_000, `bounded wait: ${elapsed}`);
    t.diagnostic(JSON.stringify({ tier, timeoutMs: elapsed }));
    assert.equal(f.posts.length, 0); assert.deepEqual(await p.client.pendingWrites(), []);
    f.release(); await p.start();
    assert.equal((await p.client.mutate(op, args('new attempt'), { waitSeconds: 5 })).state, 'sent');
  });
}
for (const replacement of ['generation', 'incarnation']) test(`process ${replacement} at ordinary admission refuses unsent`, { timeout: 60_000 }, async t => {
  const f = await nodeFixture(t), p = await f.open(), invoke = p.core.call;
  let raced = false;
  p.core.call = async (request, committed) => {
    if (request.expected_generation !== undefined && !raced) {
      raced = true; const backend = (await invoke({ op: 'backend' })).ok;
      if (replacement === 'generation') backend.generation++;
      else assert.ok(!(await invoke({ op: 'observe_store', page: { generation: backend.generation, snapshot: false, events: [], watermark: 0, images_at: 0, committed_above: {}, more: false, store_id: 'replacement' } })).denied);
      assert.ok(!(await invoke({ op: 'adopt', backend })).denied);
    }
    return invoke(request, committed);
  };
  const writing = p.client.mutate(op, args('original draft'), { waitSeconds: 0 });
  f.release(); await p.start();
  const failed = await writing;
  assert.ok(raced); assert.equal(failed.why.code, 'E_ADMISSION_STORE');
  assert.equal(failed.why.family, 'store'); assert.equal(failed.why.site, 'client.mutate');
  assert.deepEqual((await p.client.write(failed.id)).why, failed.why);
  assert.equal(f.posts.length, 0);
});
test('ordinary native settlement stamps a live outbox before replacement (Grok round 2)', { timeout: 60_000 }, async t => {
  const f = await nodeFixture(t), p = await f.open(); f.release(); await p.start();
  const { mintId } = await import('../dist/client.js'); const id = mintId();
  const admitted = await p.core.call({ op: 'admit', entry: { id, op: 'send', args: args('settled'), seq: 1, viewer: 'dev:alice', now: Date.now(), new_ids: [mintId()], predictable: false, predicted: [] } });
  assert.ok(!admitted.denied, JSON.stringify(admitted));
  assert.ok(!(await p.core.call({ op: 'keep_write', value: JSON.stringify({ state: 'sent', id, seq: 1000 }) })).denied);
  assert.ok(!(await p.core.call({ op: 'settle', id, seq: 1000 })).denied);
  const entry = (await p.core.call({ op: 'queued' })).ok.find(e => e.id === id);
  assert.equal(entry.sent_seq, 1000); assert.equal(entry.receipt_store.success_seq, 1000);
  const generation = (await p.core.call({ op: 'state' })).ok.generation;
  const reset = await p.core.call({ op: 'observe_store', page: { generation, snapshot: false, events: [], watermark: 0, images_at: 0, committed_above: {}, more: false, store_id: 'replacement' } });
  assert.equal(reset.ok.retired[id], 1000);
  assert.ok(!(await p.core.call({ op: 'queued' })).ok.some(e => e.id === id));
});

test('timely identity does not expire behind an earlier ordinary admission', async t => {
  const { IdentityWait } = await import('../dist/identity-admission.js');
  const { setImmediate: tick } = await import('node:timers/promises');
  const waiter = new IdentityWait(() => {}), a = Promise.withResolvers(), order = [];
  t.after(() => waiter.close()); t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let release;
  const failed = why => ({ state: 'failed', id: '', why });
  const first = waiter.run({ id: 'first', op: 'write', args: {} }, async () => true, r => { release = r; order.push('first'); return a.promise; }, failed);
  const second = waiter.run({ id: 'second', op: 'write', args: {} }, async () => true, r => { order.push('second'); r(); return Promise.resolve({ state: 'pending', id: 'second' }); }, failed);
  await tick(); assert.deepEqual(order, ['first']);
  t.mock.timers.tick(15_001); await tick();
  assert.equal(waiter.pending().length, 2, 'identity succeeded; ordinary admission can still be in flight');
  release(); a.resolve({ state: 'pending', id: 'first' });
  assert.equal((await first).state, 'pending'); assert.equal((await second).state, 'pending');
  assert.deepEqual(order, ['first', 'second']);
});

test('online incompatible-store signal interrupts a held probe before custody', { timeout: 5000 }, async t => {
  const f = await nodeFixture(t, true), p = await f.open();
  const writing = p.client.mutate(op, args('unadmitted'), { waitSeconds: 0 });
  await until(async () => (await p.client.pendingWrites()).length === 1);
  await p.refuseStore({ code: 'E_STORE_RESTORE', family: 'store', message: 'restored fixture' });
  assert.equal((await writing).why.code, 'E_ADMISSION_STORE');
  assert.equal(f.posts.length, 0);
  assert.ok([...f.values.values()].every(v => !JSON.parse(v).pending?.length));
});

test('web capture fences a replacement in the gap after the identity read', async () => {
  const { AdmissionJournal } = await import('../dist/web-journal.js');
  for (const replacement of ['store', 'backend']) {
    const journal = new AdmissionJournal('fixture', true);
    journal.load([{ s: 'm', k: 'device:store_id', v: replacement === 'store' ? 'B' : 'A' },
      { s: 'm', k: 'device:backend-identity', v: replacement === 'backend' ? 'B' : 'A' }]);
    assert.throws(() => journal.capture({ expected_store: 'A', expected_backend: 'A', entry: {} }),
      error => error.why?.code === 'E_ADMISSION_STORE', 'no synchronous journal record may be captured for the replacement');
  }
});

// Round 4: cross the first-identification/final-recheck boundary.
async function identifyProcess(p, store) {
  const backend = (await p.core.call({ op: 'backend' })).ok;
  const reply = await p.core.call({ op: 'apply', first: true, page: { generation: backend.generation,
    snapshot: true, events: seed.map(({ table, row }) => ({ table, id: row.id, kind: 'put', data: row })),
    watermark: 10, images_at: 10, committed_above: {}, more: false, store_id: store } });
  assert.ok(!reply.denied, JSON.stringify(reply));
}
for (const replacement of ['store', 'backend']) test(`waiting calls pin first identity across ${replacement} replacement`, { timeout: 60_000 }, async t => {
  const held = Promise.withResolvers(); t.after(() => held.resolve());
  const f = await nodeFixture(t), initial = await f.open();
  const cached = (await initial.core.call({ op: 'backend' })).ok;
  assert.equal(cached.store_id, undefined, 'cached backend was never identified');
  await initial.client.close();
  const p = await f.open(true), invoke = p.core.call, admissions = [], events = [];
  p.client.onWrite(w => events.push(w));
  let checks = 0;
  await identifyProcess(p, 'A');
  p.core.call = async (request, committed) => {
    if (request.op === 'sync_state' && request.capture === false) {
      const result = await invoke(request, committed); checks++; return result;
    }
    if (request.op === 'admit') { admissions.push(request); if (admissions.length === 1) await held.promise; }
    return invoke(request, committed);
  };
  const first = p.client.mutate(op, args('first'), { waitSeconds: 0 });
  const second = p.client.mutate(op, args('second'), { waitSeconds: 0 });
  await until(() => admissions.length === 1 && checks >= 2, 'both calls identified A; first ordinary admission held');
  await new Promise(resolve => setImmediate(resolve));
  if (replacement === 'store') {
    const reply = await invoke({ op: 'observe_store', page: { generation: cached.generation,
      snapshot: false, events: [], watermark: 0, images_at: 0, committed_above: {}, more: false, store_id: 'B' } });
    assert.ok(!reply.denied, JSON.stringify(reply));
    assert.ok(!(await invoke({ op: 'adopt', backend: cached })).denied);
    await identifyProcess(p, 'B');
  } else {
    const changed = structuredClone(cached);
    changed.programs[0].name += '_replaced';
    assert.ok(!(await invoke({ op: 'adopt', backend: changed })).denied);
  }
  held.resolve();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(w => w.why?.code), ['E_ADMISSION_STORE', 'E_ADMISSION_STORE']);
  assert.equal(admissions.length, 1, 'final recheck refuses the second call before ordinary admission');
  assert.equal(f.posts.length, 0);
  assert.deepEqual((await invoke({ op: 'queued' })).ok, []);
  assert.deepEqual(events.map(w => w.why.code), ['E_ADMISSION_STORE', 'E_ADMISSION_STORE']);
  assert.deepEqual(await p.client.pendingWrites(), []);
});

for (const failure of ['hang', 'reject']) test(`final identity recheck ${failure} produces a public unsent refusal`, { timeout: 60_000 }, async t => {
  const held = Promise.withResolvers(); t.after(() => { held.resolve(); t.mock.timers.reset(); });
  const f = await nodeFixture(t), p = await f.open(), invoke = p.core.call, events = [];
  const store = (await (await nodeFetch(`${f.api}/schema`, { headers: { 'x-snapback-persona': 'alice' } })).json()).store_id;
  await identifyProcess(p, store);
  let checks = 0, admits = 0, outcome;
  p.client.onWrite(w => events.push(w));
  p.core.call = async (request, committed) => {
    if (request.op === 'admit') admits++;
    if (request.op === 'sync_state' && request.capture === false && ++checks === 2) {
      if (failure === 'reject') throw new Error('private device failure');
      await held.promise;
    }
    return invoke(request, committed);
  };
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const writing = p.client.mutate(op, args('held check'), { waitSeconds: 0 });
  void writing.then(w => { outcome = w; }, error => { outcome = { rejected: String(error) }; });
  await until(() => checks === 2, 'final check entered');
  t.mock.timers.tick(15_001);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(outcome?.state, 'failed', JSON.stringify(outcome));
  assert.equal(outcome.why.code, failure === 'hang' ? 'E_ADMISSION_TIMEOUT' : 'E_ADMISSION_STORE');
  assert.ok(outcome.why.site && outcome.why.guide && outcome.why.rewrite);
  assert.deepEqual(events, [outcome]);
  assert.deepEqual((await p.client.write(outcome.id)).why, outcome.why);
  assert.deepEqual(await p.client.pendingWrites(), []);
  held.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(admits, 0, 'late completion cannot admit an expired call');
  assert.equal(f.posts.length, 0);
  assert.deepEqual((await invoke({ op: 'queued' })).ok, []);
  t.mock.timers.reset();
});

for (const worker of [false, true]) test(`waiting E_ADMISSION releases the same-id reservation (${worker ? 'Worker' : 'wasm'})`, { timeout: 90_000 }, async t => {
  const f = await browser(t, worker);
  await f.page.evaluate(() => {
    window.id = mintId(); window.writing = save('repair storage', id);
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('snapback4-admission:')) throw new DOMException('fixture full', 'QuotaExceededError');
      return originalSetItem.call(this, key, value);
    };
  });
  await f.page.evaluate(() => start());
  const failed = await f.page.evaluate(() => writing);
  assert.equal(failed.why.code, 'E_ADMISSION'); assert.match(failed.why.rewrite, /same id/);
  assert.equal(await f.page.evaluate(() => posts.length), 0);
  assert.deepEqual(await f.page.evaluate(async () => (await core.call({ op: 'queued' })).ok), []);
  await f.page.evaluate(() => { Storage.prototype.setItem = originalSetItem; });
  const retried = await f.page.evaluate(() => save('repair storage', id));
  assert.equal(retried.state, 'pending', JSON.stringify(retried));
  await f.page.waitForFunction(() => events.some(w => w.id === id && w.state === 'sent'));
  assert.deepEqual(await f.page.evaluate(() => posts.map(w => w.id)), [failed.id]);
  const receipt = await f.page.evaluate(() => client.write(id));
  assert.equal(receipt.state, 'sent');
  assert.equal((await f.page.evaluate(() => save('different input', id))).why.code, 'E_WRITE_ID_REUSE');
});

for (const queued of [false, true]) test(`final identity I/O keeps only the remaining deadline (queued=${queued})`, async t => {
  const { IdentityWait } = await import('../dist/identity-admission.js');
  const { setImmediate: tick } = await import('node:timers/promises');
  const waiter = new IdentityWait(() => {}), initial = Promise.withResolvers(), final = Promise.withResolvers();
  const predecessor = Promise.withResolvers(); let releasePrior, checks = 0, outcome, admitted = false;
  t.after(() => { waiter.close(); initial.resolve(false); final.resolve(false); predecessor.resolve({ state: 'pending', id: 'prior' }); });
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const refused = why => ({ state: 'failed', id: 'timed', why });
  if (queued) {
    void waiter.run({ id: 'prior', op: 'send', args: {} }, async () => true, release => {
      releasePrior = release; return predecessor.promise;
    }, refused);
    await tick();
  }
  const writing = waiter.run({ id: 'timed', op: 'send', args: {} }, () => ++checks === 1 ? initial.promise : final.promise,
    async release => { admitted = true; release(); return { state: 'pending', id: 'timed' }; }, refused);
  void writing.then(w => { outcome = w; });
  t.mock.timers.tick(10_000); initial.resolve(true); await tick();
  if (queued) {
    t.mock.timers.tick(60_000); await tick(); assert.equal(outcome, undefined);
    releasePrior(); predecessor.resolve({ state: 'pending', id: 'prior' }); await tick();
  }
  assert.equal(checks, 2);
  t.mock.timers.tick(4_999); await tick(); assert.equal(outcome, undefined);
  t.mock.timers.tick(1); await tick(); assert.equal(outcome?.why?.code, 'E_ADMISSION_TIMEOUT');
  final.resolve(true); await tick(); assert.equal(admitted, false);
  assert.deepEqual(waiter.pending(), []);
});


for (const reopen of [false, true]) test(`adoption-required store waits before any custody (reopen=${reopen})`, { timeout: 60_000 }, async t => {
  let sync; t.after(() => sync?.resolve());
  const f = await nodeFixture(t); let p = await f.open(); f.release(); await p.start();
  await rewindProcess(p.core.call);
  if (reopen) { await p.client.close(); p = await f.open(true); }
  else { sync = f.holdSync(); void p.client.sync(); await until(() => sync.entered); }
  let result; const writing = p.client.mutate(op, args('during adoption'), { waitSeconds: 0, id: '00000000000000000000000001' });
  void writing.then(w => { result = w; });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(result, undefined, 'no ordinary admission before adoption');
  const pending = await p.client.pendingWrites(); assert.equal(pending.length, 1);
  assert.match(pending[0].reason, /not yet admitted/);
  assert.deepEqual((await p.core.call({ op: 'queued' })).ok, []); assert.equal(f.posts.length, 0);
  if (reopen) {
    const backend = (await p.core.call({ op: 'backend' })).ok;
    assert.ok(!(await p.core.call({ op: 'adopt', backend })).denied);
  } else sync.resolve();
  const write = await writing; assert.equal(write.state, 'pending', JSON.stringify(write));
  assert.equal(write.id, pending[0].id);
});

test('temporary unreadiness after first identification continues the bounded wait', async t => {
  const { IdentityWait } = await import('../dist/identity-admission.js');
  const { setImmediate: tick } = await import('node:timers/promises');
  const waiter = new IdentityWait(() => {}); t.after(() => waiter.close());
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let checks = 0, ready = false, outcome, admits = 0;
  const writing = waiter.run({ id: 'temporary', op: 'send', args: {} }, async () => ++checks === 1 || ready,
    async release => { admits++; release(); return { state: 'pending', id: 'temporary' }; },
    why => ({ state: 'failed', id: 'temporary', why }));
  void writing.then(w => { outcome = w; }); await tick();
  assert.equal(checks, 2); assert.equal(outcome, undefined);
  t.mock.timers.tick(14_000); await tick(); assert.equal(outcome, undefined);
  ready = true; t.mock.timers.tick(25); await tick();
  assert.equal((await writing).state, 'pending'); assert.equal(admits, 1);
});

test('native admission fences backend-required after the final read', { timeout: 60_000 }, async t => {
  const f = await nodeFixture(t), p = await f.open(), invoke = p.core.call;
  const store = (await (await nodeFetch(`${f.api}/schema`, { headers: { 'x-snapback-persona': 'alice' } })).json()).store_id;
  await identifyProcess(p, store); let injected = false;
  p.core.call = async (request, committed) => {
    if (request.op === 'admit' && request.expected_generation !== undefined) {
      injected = true; await rewindProcess(invoke);
    }
    return invoke(request, committed);
  };
  const write = await p.client.mutate(op, args('boundary'), { waitSeconds: 0, id: '00000000000000000000000001' });
  assert.equal(injected, true); assert.equal(write.why?.code, 'E_ADMISSION_STORE', JSON.stringify(write));
  assert.deepEqual((await invoke({ op: 'queued' })).ok, []); assert.equal(f.posts.length, 0);
});

test('empty browser capture reports a public identity refusal', async t => {
  const { AdmissionJournal } = await import('../dist/web-journal.js');
  const before = Object.fromEntries(['window', 'localStorage'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  t.after(() => { for (const [k, descriptor] of Object.entries(before)) { if (descriptor) Object.defineProperty(globalThis, k, descriptor); else delete globalThis[k]; } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: {} } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {} });
  const journal = new AdmissionJournal('empty', true);
  assert.throws(() => journal.capture({ entry: {} }), error => {
    assert.equal(error.why.code, 'E_ADMISSION_STORE');
    assert.ok(error.why.site && error.why.guide && error.why.rewrite);
    assert.doesNotMatch(error.why.message, /store is not identified yet/); return true;
  });
});


// Drive the real legacy-rewind transition; set_meta is intentionally client-namespaced.
async function rewindProcess(invoke) {
  const state = (await invoke({ op: 'sync_state', capture: false })).ok;
  assert.ok(state.watermark > 0, 'rewind needs a published head');
  const observed = await invoke({ op: 'observe_store', page: { generation: state.generation,
    snapshot: false, events: [], watermark: 0, more: false,
    requested_watermark: state.watermark, captured_watermark: state.watermark } });
  assert.equal(observed.ok?.reset, true, JSON.stringify(observed));
  const after = (await invoke({ op: 'sync_state', capture: false })).ok;
  assert.equal(after.backend_required, true);
  assert.equal(after.store_id, state.store_id);
  assert.equal(after.generation, state.generation);
  assert.equal(after.adoption_capture['device:backend-identity'], state.adoption_capture['device:backend-identity']);
}

// Round 5: review reproductions cross synchronous capture into the serialized transaction.
for (const worker of [false, true]) test(`browser transaction rejects backend replacement after synchronous capture (${worker ? 'Worker' : 'wasm'})`, { timeout: 90_000 }, async t => {
  const f = await browser(t, worker);
  await f.page.evaluate(async () => {
    const invoke = core.call.bind(core);
    const originalBackend = (await invoke({ op: 'backend' })).ok;
    window.admissions = []; window.captures = [];
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('snapback4-admission:')) captures.push(JSON.parse(value));
      return setItem.call(this, key, value);
    };
    core.call = async (request, committed) => {
      if (request.op === 'admit' && request.expected_generation !== undefined) {
        admissions.push(request);
        if (!request.expected_backend) throw Error('call must pin the identified backend');
        const backend = structuredClone(originalBackend);
        backend.programs[0].name += '_replaced';
        const adopting = invoke({ op: 'adopt', backend });
        const admitting = invoke(request, committed);
        const adopted = await adopting;
        if (adopted.denied) throw Error(JSON.stringify(adopted));
        window.adoptedState = (await invoke({ op: 'sync_state', capture: false })).ok;
        return admitting;
      }
      return invoke(request, committed);
    };
    window.writing = save('old program');
  });
  await f.page.evaluate(() => start());
  const result = await f.page.evaluate(() => writing);
  const [requests, captured, state] = await f.page.evaluate(() => [admissions, captures, adoptedState]);
  assert.equal(requests.length, 1); assert.equal(captured.length, 1, 'synchronous capture passed before adoption');
  assert.equal(state.store_id, requests[0].expected_store);
  assert.equal(state.generation, requests[0].expected_generation);
  assert.equal(state.backend_required, false);
  assert.notEqual(state.adoption_capture['device:backend-identity'], requests[0].expected_backend);
  assert.equal(result.why?.code, 'E_ADMISSION_STORE');
  assert.deepEqual(await f.page.evaluate(async () => (await core.call({op:'queued'})).ok), []);
  assert.equal(await f.page.evaluate(() => posts.length), 0);
  assert.deepEqual(await f.page.evaluate(() => events), [result]);
  assert.deepEqual(await f.page.evaluate(() => client.pendingWrites()), []);
  assert.equal(await f.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('snapback4-admission:')).length), 0);
  assert.deepEqual(await f.page.evaluate(id => client.write(id), result.id), result);
});

test('FIFO wait behind identity I/O consumes the identity budget', async t => {
  const { IdentityWait } = await import('../dist/identity-admission.js');
  const { setImmediate: tick } = await import('node:timers/promises');
  const waiter = new IdentityWait(() => {}), held = Promise.withResolvers();
  t.after(() => { waiter.close(); held.resolve(false); });
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let firstOutcome, secondOutcome, firstReads=0, secondReads=0, admits=0;
  const refusal = why => ({state:'failed',id:'fixture',why});
  const admit = async release => { admits++; release(); return {state:'pending',id:'fixture'}; };
  void waiter.run({id:'first',op:'send',args:{}}, () => ++firstReads===1 ? Promise.resolve(true) : held.promise, admit, refusal).then(w => firstOutcome=w);
  void waiter.run({id:'second',op:'send',args:{}}, () => ++secondReads===1 ? Promise.resolve(true) : held.promise, admit, refusal).then(w => secondOutcome=w);
  await tick();
  t.mock.timers.tick(15_000); await tick();
  assert.equal(firstOutcome?.why?.code, 'E_ADMISSION_TIMEOUT');
  assert.equal(admits,0);
  assert.equal(secondOutcome?.why?.code,'E_ADMISSION_TIMEOUT');
  assert.deepEqual(waiter.pending(), []);
  held.resolve(true); await tick(); assert.equal(admits, 0, 'late identity cannot admit expired calls');
});

for (const worker of [false, true]) test(`browser transaction checks generation independently of backend (${worker ? 'Worker' : 'wasm'})`, { timeout: 90_000 }, async t => {
  const f = await browser(t, worker); await f.page.evaluate(() => start());
  const result = await f.page.evaluate(async () => {
    const state = (await core.call({ op: 'sync_state', capture: false })).ok;
    const setItem = Storage.prototype.setItem; let captured = 0;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('snapback4-admission:')) captured++;
      return setItem.call(this, key, value);
    };
    try {
      // Exactly one stale pin: backend hashes also contain generation, so an
      // adoption alone would mask missing expected_generation forwarding.
      const reply = await core.call({ op: 'admit', expected_generation: state.generation + 1,
        expected_store: state.store_id, expected_backend: state.adoption_capture['device:backend-identity'],
        entry: { id: mintId(), op: 'send', args: { conversationId: 'c1', body: 'stale generation' },
          seq: 1, viewer: 'dev:alice', now: Date.now(), new_ids: [mintId()], predictable: false, predicted: [] } });
      return { reply, captured };
    } finally { Storage.prototype.setItem = setItem; }
  });
  assert.equal(result.captured, 1, 'capture passed; the transaction must reject the stale generation');
  assert.equal(result.reply.denied?.code, 'E_ADMISSION_STORE');
  assert.deepEqual(await f.page.evaluate(async () => (await core.call({ op: 'queued' })).ok), []);
  assert.equal(await f.page.evaluate(() => posts.length), 0);
  assert.equal(await f.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('snapback4-admission:')).length), 0);
});

test('FIFO deadline counts identity gaps between ordinary admissions', async t => {
  const { IdentityWait } = await import('../dist/identity-admission.js');
  const { setImmediate: tick } = await import('node:timers/promises');
  const waiter = new IdentityWait(() => {}), reads = [0, 0, 0], outcomes = [], releases = [], admissions = [];
  const identities = Array.from({ length: 3 }, () => Promise.withResolvers());
  const receipts = Array.from({ length: 2 }, () => Promise.withResolvers());
  t.after(() => { waiter.close(); identities.forEach(g => g.resolve(false)); receipts.forEach(g => g.resolve({ state: 'pending', id: '' })); });
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  for (let i = 0; i < 3; i++) {
    void waiter.run({ id: String(i), op: 'send', args: {} }, () => ++reads[i] === 1 ? Promise.resolve(true) : identities[i].promise,
      release => { releases[i] = release; admissions.push(i); return receipts[i].promise; },
      why => ({ state: 'failed', id: String(i), why })).then(w => { outcomes[i] = w; });
  }
  await tick(); assert.deepEqual(reads, [2, 1, 1]);
  t.mock.timers.tick(2_000); identities[0].resolve(true); await tick();
  assert.deepEqual(admissions, [0]);
  t.mock.timers.tick(60_000); await tick(); assert.equal(outcomes[2], undefined);
  releases[0](); await tick(); assert.deepEqual(reads, [2, 2, 1]);
  t.mock.timers.tick(3_000); identities[1].resolve(true); await tick();
  assert.deepEqual(admissions, [0, 1]);
  // A's later receipt/finally must not end B's ordinary-admission interval.
  receipts[0].resolve({ state: 'sent', id: '0', seq: 1 }); await tick();
  t.mock.timers.tick(60_000); await tick(); assert.equal(outcomes[2], undefined);
  releases[1](); receipts[1].resolve({ state: 'pending', id: '1' }); await tick();
  assert.deepEqual(reads, [2, 2, 2]);
  t.mock.timers.tick(9_999); await tick(); assert.equal(outcomes[2], undefined);
  t.mock.timers.tick(1); await tick(); assert.equal(outcomes[2]?.why?.code, 'E_ADMISSION_TIMEOUT');
  identities[2].resolve(true); await tick(); assert.deepEqual(admissions, [0, 1]);
  assert.deepEqual(waiter.pending(), []);
});

// Grok round 4: descriptor enrichment is not a store replacement.
for (const change of ['native descriptor', 'schema', 'programs']) test(`waiting admission after restored backend refresh: ${change}`, async t => {
  const { IdentityWait, localAdmissionIdentity } = await import('../dist/identity-admission.js');
  const { nativeInstaller } = await import('../dist/local-native.js');
  const { setImmediate: tick } = await import('node:timers/promises');
  // A device-restored backend has the native program, but no server descriptor.
  let backend = { generation: 1, schema: { tables: {}, operations: {} }, programs: [
    { name: 'nativeRead', kind: 'Query', args: {}, body: [], native: true },
  ] }, link = 'offline';
  const state = { generation: 1, store_id: 'A', backend_required: false,
    adoption_capture: { 'device:backend-identity': 'kept-backend' } };
  const identity = localAdmissionIdentity(backend, 1), waiter = new IdentityWait(() => {});
  const finalRead = Promise.withResolvers(); let checks = 0, admissions = 0, outcome;
  t.after(() => { waiter.close(); finalRead.resolve(); });
  const requests = [], installed = [];
  const install = nativeInstaller(() => ({ backend, generation: 1, link, closed: false }), next => { backend = next; },
    async request => {
      if (request.op === 'state') return { ok: { native: null } };
      assert.equal(request.op, 'install_native'); installed.push(request); return { ok: true };
    }, async url => {
      requests.push(url);
      if (url.endsWith('/native.wasm')) return new Response(new Uint8Array([0, 97, 115, 109]));
      assert.equal(url, 'https://native.invalid/schema');
      const refreshed = structuredClone(backend);
      refreshed.native = { digest: 'module-digest', jobs: [], reads: ['nativeRead'] };
      if (change === 'schema') refreshed.schema.operations.nativeRead = { held: true };
      if (change === 'programs') refreshed.programs[0].name += 'Changed';
      return Response.json(refreshed);
    }, 'https://native.invalid', () => ({ headers: {} }));
  assert.equal(await install(), false); assert.deepEqual(requests, []);
  const writing = waiter.run({ id: 'original-write', op: 'send', args: {} }, async () => {
    if (++checks === 2) await finalRead.promise;
    return identity.check(state, backend, 1, null);
  }, async release => { admissions++; release(); return { state: 'pending', id: 'original-write' }; },
  why => ({ state: 'failed', id: 'original-write', why }));
  void writing.then(w => { outcome = w; });
  await tick(); assert.equal(checks, 2); assert.equal(outcome, undefined);
  assert.equal(identity.fields().expected_backend, 'kept-backend');
  link = 'online'; assert.equal(await install(), true);
  assert.equal(installed.length, 1); assert.equal(backend.native.digest, 'module-digest');
  // The real installer has called setBackend; store/generation/device digest
  // did not change. Only server descriptor enrichment is identity-neutral.
  finalRead.resolve(); const write = await writing;
  if (change === 'native descriptor') {
    assert.equal(write.state, 'pending', JSON.stringify(write));
    assert.equal(write.id, 'original-write'); assert.equal(admissions, 1);
  } else {
    assert.equal(write.why?.code, 'E_ADMISSION_STORE'); assert.equal(admissions, 0);
  }
  assert.deepEqual(waiter.pending(), []);
});
