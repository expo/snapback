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
    assert.equal(await f.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('snapback4:admission:')).length), 0);
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
  let hold = held;
  t.after(async () => { hold = false; probes.splice(0).forEach(f => f()); for (const c of clients) await c.close(); await server.close(); rmSync(dir, { recursive: true, force: true }); });
  const { createClient } = await import('../dist/client.js'); const { onlineCustody } = await import('../dist/app-online.js');
  const open = async () => {
    let core; const opener = processDevice({ dir, binary: binary() });
    const options = { url: server.api, persona: 'alice', device: { async open(...args) { return core = await opener.open(...args); } }, fetch: async (url, init) => {
      if (String(url).endsWith('/probe') && hold) await new Promise((resolve, reject) => {
        probes.push(resolve); init.signal?.addEventListener('abort', () => reject(Error('closed')), { once: true });
      });
      if (String(url).includes('/m/')) posts.push(JSON.parse(init.body));
      return fetch(url, init);
    } };
    const prepared = online ? await onlineCustody(createClient(options), server.api, store, () => {}, false)
      : await prepareClient(options, () => createLocalClient(options));
    clients.push(prepared.client); return { ...prepared, core };
  };
  return { open, posts, values, release() { hold = false; probes.splice(0).forEach(f => f()); } };
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
