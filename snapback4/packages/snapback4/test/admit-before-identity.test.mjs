import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, devServer, root, binary } from "../../../witness/lib.mjs";
import { prepareClient } from "../dist/client-start.js";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { until } from "./helpers/app-server.mjs";

const require = createRequire(`${root}/packages/snapback4/package.json`);
const baseline = process.env.SNAPBACK4_EA_BASELINE === "1";
const base = "7f540f09467fcbdd73d4faa05db14fce696e9e85";
const sourceOverrides = baseline ? Object.fromEntries(["web-journal.ts", "web.ts", "web-worker-device.ts", "web-worker-runtime.ts", "local-backend.ts", "local.ts", "local-types.ts", "pending-writes.ts"].map(name =>
  [`${root}/packages/snapback4/src/${name}`, execFileSync("git", ["show", `${base}:snapback4/packages/snapback4/src/${name}`], { cwd: root, encoding: "utf8" })])) : {};
const seed = [
  { table: "conversations", row: { id: "c1", title: "General", creatorId: "dev:alice" } },
  { table: "memberships", row: { id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 } },
];
const op = { kind: "mutation", name: "send" };
const args = body => ({ conversationId: "c1", body });
async function browser(t, worker) {
  const f = await launch({ worker, sourceOverrides, seed, entrySource: `
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
      window.saves = [];
      form.onsubmit = async e => { e.preventDefault(); saves.push(await save('Immediate')); };
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
  const tier = worker ? "Worker" : "wasm";
  test(`immediate mounted form before identity (${tier})`, { timeout: 90_000 }, async t => {
    const f = await browser(t, worker);
    for (let n = 1; n <= 2; n++) {
      await f.page.click("button");
      await f.page.waitForFunction(n => saves.length === n, n);
    }
    const first = await f.page.evaluate(() => saves);
    console.log(JSON.stringify({ tier, beforeIdentity: first }));
    if (baseline) {
      assert.deepEqual(first.map(w => w.why?.code), ["E_ADMISSION", "E_ADMISSION"]);
      await f.page.evaluate(() => start());
      await f.page.click("button"); await f.page.waitForFunction(() => saves.length === 3);
      assert.equal(await f.page.evaluate(() => saves[2].state), "pending");
      console.log("same mounted form succeeds after identity without route navigation");
    } else {
      assert.deepEqual(first.map(w => w.state), ["pending", "pending"]);
      await f.page.waitForFunction(() => hookWrites?.length === 2);
      assert.deepEqual(await f.page.evaluate(() => hookWrites.map(w => w.id)), first.map(w => w.id));
      assert.equal(await f.page.evaluate(() => posts.length), 0);
      await f.page.evaluate(() => start());
      await f.page.waitForFunction(() => events.filter(w => w.state === 'sent').length === 2);
      assert.deepEqual(await f.page.evaluate(() => events.map(w => w.id)), first.map(w => w.id));
      assert.deepEqual(await f.page.evaluate(() => posts.map(w => w.id)), first.map(w => w.id));
      await f.page.click("button"); await f.page.waitForFunction(() => events.length === 3);
      assert.equal(await f.page.evaluate(() => events[2].state), "sent");
    }
  });
  if (baseline) continue;
  test(`deferred burst, prediction, ids and reload (${tier})`, { timeout: 90_000 }, async t => {
    const f = await browser(t, worker);
    const before = await f.page.evaluate(async () => {
      const id = mintId();
      const a = save('one', id), same = save('one', id), b = save('two'), c = save('three');
      const bad = await save('different', id);
      return { writes: await Promise.all([a, b, c]), same: await same, bad, records: JSON.parse((await core.call({ op: 'meta', key: 'identity-admissions' })).ok) };
    });
    assert.equal(before.bad.why.code, "E_WRITE_ID_REUSE");
    assert.equal(before.same.id, before.writes[0].id);
    assert.equal(before.records.length, 3);
    await f.reload();
    await f.page.evaluate(url => openFresh(url), f.api);
    assert.deepEqual(await f.page.evaluate(async () => (await client.pendingWrites()).map(w => w.id)), before.writes.map(w => w.id));
    const fourth = await f.page.evaluate(() => save('four'));
    await f.page.evaluate(() => { window.holdPosts = true; return start(); });
    await f.page.waitForFunction(() => posts.length === 1);
    const queued = await f.page.evaluate(async () => (await core.call({ op: 'queued' })).ok);
    assert.ok(queued.every(e => e.predictable && e.predicted.length), JSON.stringify(queued));
    assert.deepEqual(queued.slice(0, 3).map(e => e.new_ids), before.records.map(r => r.entry.new_ids.slice(0, 1)));
    await f.page.evaluate(() => { holdPosts = false; releasePosts.splice(0).forEach(f => f()); });
    await f.page.waitForFunction(() => events.length === 4);
    const ids = [...before.writes.map(w => w.id), fourth.id];
    assert.deepEqual(await f.page.evaluate(() => posts.map(w => w.id)), ids);
    assert.deepEqual(await f.page.evaluate(() => events.map(w => w.id)), ids);
    assert.equal(await f.page.evaluate(async () => (await client.pendingWrites()).length), 0);
  });
  test(`same-turn navigation before deferred custody commits (${tier})`, { timeout: 90_000 }, async t => {
    const f = await browser(t, worker);
    const id = await f.page.evaluate(() => {
      const id = mintId(); sessionStorage.setItem('test-id', id); void save('navigation', id); location.reload(); return id;
    });
    await f.page.waitForFunction(() => typeof openFresh === 'function' && !window.client);
    await f.page.evaluate(url => openFresh(url), f.api);
    const kept = await f.page.evaluate(() => sessionStorage.getItem('test-id'));
    assert.equal(kept, id);
    assert.equal((await f.page.evaluate(id => client.write(id), id)).state, "pending");
    await f.page.evaluate(() => start());
    await f.page.waitForFunction(() => events.length === 1);
    assert.equal(await f.page.evaluate(() => events[0].id), id);
    assert.equal(await f.page.evaluate(() => posts.length), 1);
  });
  test(`an unidentified closed tab transfers custody in order (${tier})`, { timeout: 90_000 }, async t => {
    const f = await browser(t, worker);
    const primary = await f.page.evaluate(() => save('primary'));
    const other = await f.page.context().newPage();
    await other.goto(f.page.url()); await other.waitForFunction(() => typeof openFresh === 'function');
    await other.evaluate(url => openFresh(url), f.api);
    const orphaned = await other.evaluate(() => Promise.all([save('orphan one'), save('orphan two')]));
    await other.close();
    await f.page.evaluate(() => start());
    await f.page.waitForFunction(() => events.length === 3);
    assert.deepEqual(await f.page.evaluate(() => posts.map(w => w.id)), [primary.id, ...orphaned.map(w => w.id)]);
    assert.ok((await f.page.evaluate(() => events)).every(w => w.state === 'sent'));
  });
  test(`schema binding wins over a staged replacement snapshot (${tier})`, { timeout: 90_000 }, async t => {
    const f = await browser(t, worker), replacement = await devServer({ seed });
    t.after(() => replacement.close());
    const replacementSchema = await (await fetch(`${replacement.api}/schema`, { headers: { 'x-snapback-persona': 'alice' } })).json();
    const staged = await f.page.evaluate(async store => {
      const backend = (await core.call({ op: 'backend' })).ok;
      const result = await core.call({ op: 'observe_store', page: {
        generation: backend.generation, snapshot: true, events: [], watermark: 0, images_at: 0,
        committed_above: {}, more: true, store_id: store,
      } });
      if (result.denied) throw Error(JSON.stringify(result));
      return (await core.call({ op: 'sync_state', capture: false })).ok;
    }, replacementSchema.store_id);
    assert.equal(staged.store_id, null);
    assert.equal(staged.transfer_store_id, replacementSchema.store_id);
    const write = await f.page.evaluate(() => save('draft belongs to schema store'));
    assert.equal(write.state, 'pending');
    // All later requests reach a real same-schema replacement server. A leaked
    // POST would execute there, rather than be refused by the original store.
    await f.page.route(`${f.api}/**`, async route => {
      if (new URL(route.request().url()).pathname === '/changes') return route.abort();
      const response = await route.fetch({ url: route.request().url().replace(f.api, replacement.api) });
      await route.fulfill({ response });
    });
    await f.page.evaluate(() => start());
    await f.page.waitForFunction(() => events.length === 1);
    const outcome = await f.page.evaluate(() => events[0]);
    console.log(JSON.stringify({ tier, replacementOutcome: outcome, posts: await f.page.evaluate(() => posts) }));
    assert.equal(outcome.why?.code, 'E_ADMISSION_STORE');
    assert.equal(await f.page.evaluate(() => posts.length), 0);
    assert.equal((await f.page.evaluate(id => client.write(id), write.id)).why.code, 'E_ADMISSION_STORE');
  });
  for (const failure of ["timeout", "adoption", "incarnation"]) test(`identification ${failure} settles visibly without sending (${tier})`, { timeout: 90_000 }, async t => {
    const f = await browser(t, worker);
    if (failure === "timeout") await f.page.clock.install();
    const write = await f.page.evaluate(() => save('never sent'));
    if (failure === "timeout") await f.page.clock.fastForward(30_001);
    else if (failure === "incarnation") {
      await f.page.route(`${f.api}/sync`, async route => {
        const response = await route.fetch(), body = await response.json();
        body.store_id = 'replacement-before-first-identification';
        await route.fulfill({ response, json: body });
      });
      await f.page.evaluate(() => start());
    } else await f.page.evaluate(async () => {
      const backend = (await core.call({ op: 'backend' })).ok; backend.generation++;
      const result = await core.call({ op: 'adopt', backend });
      if (result.denied) throw Error(JSON.stringify(result));
    });
    await f.page.waitForFunction(() => events.length === 1);
    const failed = await f.page.evaluate(() => events[0]);
    assert.equal(failed.id, write.id);
    assert.equal(failed.why.code, failure === "timeout" ? "E_ADMISSION_TIMEOUT" : "E_ADMISSION_STORE");
    assert.match(failed.why.message, /new attempt/);
    assert.equal(await f.page.evaluate(() => posts.length), 0);
    if (failure === "timeout") {
      const retry = await f.page.evaluate(() => save('new attempt after timeout'));
      await f.page.evaluate(() => start());
      await f.page.waitForFunction(() => events.length === 2);
      assert.equal(await f.page.evaluate(() => events[1].state), 'sent');
      assert.deepEqual(await f.page.evaluate(() => posts.map(w => w.id)), [retry.id]);
    }
    await f.reload(); await f.page.evaluate(url => openFresh(url), f.api);
    assert.equal((await f.page.evaluate(id => client.write(id), write.id)).why.code, failed.why.code);
    assert.equal(await f.page.evaluate(async () => (await client.pendingWrites()).length), 0);
  });
}
if (!baseline) test("process device persists immediate writes before identity and resumes in order", { timeout: 90_000 }, async t => {
  const server = await devServer({ seed }), dir = mkdtempSync(join(tmpdir(), "sb4-identity-"));
  const clients = [], posts = [];
  t.after(async () => { for (const client of clients) await client.close(); await server.close(); rmSync(dir, { recursive: true, force: true }); });
  const open = async () => {
    const options = { url: server.api, persona: "alice", device: processDevice({ dir, binary: binary() }), fetch: (url, init) => {
      if (String(url).includes('/m/')) posts.push(JSON.parse(init.body));
      return fetch(url, init);
    } };
    const prepared = await prepareClient(options, () => createLocalClient(options));
    clients.push(prepared.client); return prepared;
  };
  const first = await open();
  const writes = await Promise.all(['one', 'two', 'three'].map(body => first.client.mutate(op, args(body), { waitSeconds: 0 })));
  assert.deepEqual(writes.map(w => w.state), ['pending', 'pending', 'pending']);
  assert.equal(posts.length, 0);
  await first.client.close();
  const next = await open(), events = [];
  next.client.onWrite(w => events.push(w));
  assert.deepEqual((await next.client.pendingWrites()).map(w => w.id), writes.map(w => w.id));
  const fourth = await next.client.mutate(op, args('four'), { waitSeconds: 0 });
  await next.start(); await until(() => events.length === 4, 'four ordered settlements');
  assert.deepEqual(posts.map(w => w.id), [...writes.map(w => w.id), fourth.id]);
  assert.deepEqual(events.map(w => w.id), posts.map(w => w.id));
});

if (!baseline) test("online app takes custody before a held identity probe, including reload", { timeout: 90_000 }, async t => {
  const { createClient } = await import('../dist/client.js');
  const { onlineCustody } = await import('../dist/app-online.js');
  const server = await devServer({ seed }), values = new Map(), posts = [], clients = [];
  const store = { async get(key) { return values.get(key) ?? null; }, async set(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); } };
  let held = true; const probes = [];
  t.after(async () => { held = false; probes.splice(0).forEach(f => f()); for (const c of clients) await c.close(); await server.close(); });
  const open = async () => {
    const raw = createClient({ url: server.api, persona: 'alice', fetch: async (url, init) => {
      if (String(url).endsWith('/probe') && held) await new Promise((resolve, reject) => {
        probes.push(resolve); init.signal?.addEventListener('abort', () => reject(Error('closed')), { once: true });
      });
      if (String(url).includes('/m/')) posts.push(JSON.parse(init.body));
      return fetch(url, init);
    } });
    const custody = await onlineCustody(raw, server.api, store, e => { throw e; });
    clients.push(custody.client); return custody.client;
  };
  const first = await open();
  const writes = await Promise.race([
    Promise.all(['one', 'two', 'three'].map(body => first.mutate(op, args(body), { waitSeconds: body === 'one' ? 1 : 0 }))),
    new Promise((_, reject) => setTimeout(() => reject(Error('identity probe blocked custody')), 2000).unref()),
  ]);
  assert.deepEqual(writes.map(w => w.state), ['pending', 'pending', 'pending']);
  assert.deepEqual((await first.pendingWrites()).map(w => w.id), writes.map(w => w.id));
  assert.equal(posts.length, 0);
  await first.close();
  const next = await open(), events = []; next.onWrite(w => events.push(w));
  const fourth = await next.mutate(op, args('four'), { waitSeconds: 0 });
  held = false; probes.splice(0).forEach(f => f());
  await until(() => events.length === 4, 'online recovered settlements');
  assert.deepEqual(posts.map(w => w.id), [...writes.map(w => w.id), fourth.id]);
});

if (!baseline) test("two native owners compare deferred custody without losing or replacing writes", { timeout: 90_000 }, async t => {
  const server = await devServer({ seed }), dir = mkdtempSync(join(tmpdir(), "sb4-identity-owners-")), clients = [];
  t.after(async () => { for (const c of clients) await c.close(); await server.close(); rmSync(dir, { recursive: true, force: true }); });
  const open = async () => {
    const options = { url: server.api, persona: "alice", device: processDevice({ dir, binary: binary() }) };
    const p = await prepareClient(options, () => createLocalClient(options)); clients.push(p.client); return p;
  };
  const a = await open(), b = await open();
  const writes = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).client.mutate(op, args(`write ${i}`), { waitSeconds: 0 })));
  assert.ok(writes.every(w => w.state === 'pending'), JSON.stringify(writes));
  const { mintId } = await import('../dist/client.js'); const id = mintId();
  const raced = await Promise.all([a.client.mutate(op, args('winner A'), { id, waitSeconds: 0 }), b.client.mutate(op, args('winner B'), { id, waitSeconds: 0 })]);
  assert.equal(raced.filter(w => w.state === 'pending').length, 1);
  assert.equal(raced.find(w => w.state === 'failed').why.code, 'E_WRITE_ID_REUSE');
  await a.client.close(); await b.client.close();
  const reopened = await open(), pending = await reopened.client.pendingWrites();
  assert.equal(pending.length, 9);
  assert.equal(new Set(pending.map(w => w.id)).size, 9);
  const events = []; reopened.client.onWrite(w => events.push(w));
  await reopened.start(); await until(() => events.length === 9, 'all native owners settled');
  assert.deepEqual(events.map(w => w.id), pending.map(w => w.id));
});

for (const replacement of ["generation", "incarnation"]) if (!baseline) test(`native ${replacement} between identity validation and admission refuses the original write unsent`, { timeout: 90_000 }, async t => {
  const server = await devServer({ seed }), dir = mkdtempSync(join(tmpdir(), 'sb4-identity-race-')), posts = [];
  const opener = processDevice({ dir, binary: binary() });
  let raced = false, client;
  t.after(async () => { await client?.close(); await server.close(); rmSync(dir, { recursive: true, force: true }); });
  const options = { url: server.api, persona: 'alice', device: { async open(...args) {
    const core = await opener.open(...args);
    return { ...core, async call(request, committed) {
      if (request.identity_backend && !raced) {
        raced = true;
        const backend = (await core.call({ op: 'backend' })).ok;
        if (replacement === 'generation') backend.generation++;
        else assert.ok(!(await core.call({ op: 'observe_store', page: { generation: backend.generation, snapshot: false, events: [], watermark: 0, images_at: 0, committed_above: {}, more: false, store_id: 'same-generation-replacement' } })).denied);
        assert.ok(!(await core.call({ op: 'adopt', backend })).denied);
      }
      return core.call(request, committed);
    } };
  } }, fetch: (url, init) => { if (String(url).includes('/m/')) posts.push(JSON.parse(init.body)); return fetch(url, init); } };
  const prepared = await prepareClient(options, () => createLocalClient(options)); client = prepared.client;
  const events = []; client.onWrite(write => events.push(write));
  const write = await client.mutate(op, args('original draft'), { waitSeconds: 0 });
  assert.equal(write.state, 'pending');
  await prepared.start(); await until(() => events.length === 1, 'adoption refusal');
  assert.ok(raced); assert.equal(events[0].id, write.id);
  assert.equal(events[0].why.code, 'E_ADMISSION_STORE'); assert.match(events[0].why.message, /new attempt/);
  assert.equal(events[0].why.family, 'store');
  assert.equal(events[0].why.site, 'client.mutate');
  assert.equal(events[0].why.guide, 'writes');
  assert.match(events[0].why.rewrite, /new write id/);
  assert.deepEqual((await client.write(write.id)).why, events[0].why);
  assert.equal(posts.length, 0); assert.equal((await client.pendingWrites()).length, 0);
});

for (const online of [false, true]) if (!baseline) test(`expired identification deadline survives reopen (${online ? 'online' : 'process'})`, { timeout: 90_000 }, async t => {
  const server = await devServer({ seed }), dir = mkdtempSync(join(tmpdir(), 'sb4-expired-')), clients = [], posts = [];
  const { createClient } = await import('../dist/client.js');
  const { onlineCustody } = await import('../dist/app-online.js');
  const values = new Map();
  const store = { async get(k) { return values.get(k) ?? null; }, async set(k, v) { values.set(k, v); }, async remove(k) { values.delete(k); } };
  t.after(async () => { for (const c of clients) await c.close(); await server.close(); rmSync(dir, { recursive: true, force: true }); });
  const offlineProbe = async (url, init) => {
    if (String(url).endsWith('/probe')) throw Error('test identity unavailable');
    if (String(url).includes('/m/')) posts.push(JSON.parse(init.body));
    return fetch(url, init);
  };
  const open = async () => {
    const options = { url: server.api, persona: 'alice', fetch: offlineProbe, device: processDevice({ dir, binary: binary() }) };
    const prepared = online ? await onlineCustody(createClient(options), server.api, store, error => { throw error; }, false)
      : await prepareClient(options, () => createLocalClient(options));
    clients.push(prepared.client); return prepared;
  };
  const first = await open(), write = await first.client.mutate(op, args('expires'), { waitSeconds: 0 });
  assert.equal(write.state, 'pending');
  assert.match((await first.client.pendingWrites())[0].reason, /identification/);
  await first.client.close();
  const afterDeadline = Date.now() + 30_001;
  t.mock.method(Date, 'now', () => afterDeadline);
  const second = await open(), events = []; second.client.onWrite(w => events.push(w));
  await second.start();
  await until(async () => (await second.client.write(write.id))?.state === 'failed', 'durable identification deadline');
  const failed = await second.client.write(write.id);
  assert.equal(failed.why.code, 'E_ADMISSION_TIMEOUT');
  assert.match(failed.why.message, /new attempt/);
  assert.equal(posts.length, 0);
  assert.equal((await second.client.pendingWrites()).length, 0);
});
