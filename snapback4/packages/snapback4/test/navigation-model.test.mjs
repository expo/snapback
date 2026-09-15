// Node model of document teardown: the wasm device and server are real;
// ordinary fetch loses its reply on pagehide, while keepalive survives.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLocalClient } from "../dist/local.js";
import { memoryPersistence, webDevice } from "../dist/web.js";
import { devServer } from "../../../witness/lib.mjs";

const wasm = readFileSync(new URL("../src/wasm/snapback4_device_bg.wasm", import.meta.url));
const send = { kind: "mutation", name: "send" };
const seed = [
  { table: "conversations", row: { id: "c1", title: "General", creatorId: "dev:alice" } },
  { table: "memberships", row: { id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 } },
];
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check, ms = 2000) {
  const end = performance.now() + ms;
  do { if (await check()) return true; await new Promise(r => setTimeout(r, 10)); } while (performance.now() < end);
  return false;
}
async function fixture(t) {
  const window = new EventTarget(), document = new EventTarget();
  document.visibilityState = "visible";
  for (const [key, value] of Object.entries({ window, document })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const server = await devServer({ seed, port: 47000 + process.pid % 1000 });
  const clients = [], cleanup = [], persist = memoryPersistence();
  t.after(async () => { for (const run of cleanup) await run(); for (const client of clients) await client.close(); server.close(); });
  const open = async (transport = fetch) => {
    const client = await createLocalClient({ url: server.api, persona: "alice", device: webDevice({ wasm, persist }), fetch: transport, waitSeconds: 1 });
    clients.push(client); return client;
  };
  const rows = async () => (await fetch(server.api + "/q/thread", { method: "POST", headers: { "x-snapback-persona": "alice" }, body: JSON.stringify({ args: { conversationId: "c1" } }) }).then(r => r.json())).data;
  const durable = () => [...persist.stores.values()].flatMap(s => [...s.values()]).filter(c => c.s === "o").map(c => JSON.parse(c.v)).sort((a, b) => a.seq - b.seq);
  return { window, document, server, persist, open, rows, durable, cleanup };
}

for (const applied of [false, true]) for (const count of [1, 2]) {
  test(`navigation model: ${count} unawaited writes, ordinary ${applied ? "applied with lost reply" : "aborted before delivery"}`, async t => {
    const f = await fixture(t), requests = [], entered = deferred();
    let abortOrdinary, gone = false;
    const client = await f.open(async (url, init) => {
      if (gone && !init?.keepalive) throw new TypeError("document destroyed");
      if (!String(url).includes("/m/")) return fetch(url, init);
      requests.push({ id: JSON.parse(init.body).id, keepalive: !!init.keepalive });
      if (init.keepalive) return fetch(url, init);
      if (applied) await fetch(url, init).then(r => r.arrayBuffer());
      return new Promise((_, reject) => { abortOrdinary = () => reject(new DOMException("pagehide", "AbortError")); entered.resolve(); });
    });
    const writes = Array.from({ length: count }, (_, n) => client.mutate(send, { conversationId: "c1", body: `write ${n + 1}` }));
    await entered.promise;
    assert.ok(await until(() => f.durable().length === count));
    const ids = f.durable().map(e => e.id);
    gone = true;
    f.window.dispatchEvent(new Event("pagehide"));
    const exitAtHide = requests.filter(r => r.keepalive);
    abortOrdinary();
    await client.close();
    await Promise.all(writes);
    const reachedBeforeReopen = await until(async () => (await f.rows()).length === 1);
    const reopenedAt = performance.now();
    const reopened = await f.open();
    assert.ok(await until(async () => (await f.rows()).length === count));
    await reopened.sync();
    const rows = await f.rows();
    console.log(`navigation model: writes=${count}; appliedBeforeAbort=${applied}; exitRequests=${exitAtHide.length}; beforeReopen=${reachedBeforeReopen ? 1 : 0}; afterReopen=${rows.length}; duplicates=${rows.length - count}; replayMs=${Math.round(performance.now() - reopenedAt)}`);
    assert.deepEqual(exitAtHide.map(r => r.id), [ids[0]], "pagehide retries only the ordinary send's same durable head");
    assert.ok(reachedBeforeReopen, "the head must arrive even when the next page does not open a client");
    assert.deepEqual(rows.map(r => r.body).sort(), Array.from({ length: count }, (_, n) => `write ${n + 1}`));
  });
}

test("navigation model: admission finishing after pagehide sends only after its commit", async t => {
  const f = await fixture(t), commit = deferred(), entered = deferred(), exits = [];
  let gone = false;
  const client = await f.open((url, init) => {
    if (init?.keepalive) { exits.push(JSON.parse(init.body)); return fetch(url, init); }
    return gone ? Promise.reject(new TypeError("pagehide aborted fetch")) : fetch(url, init);
  });
  const save = f.persist.save.bind(f.persist);
  f.persist.save = async (name, changes) => {
    if (changes.some(c => c.s === "o")) { entered.resolve(); await commit.promise; }
    await save(name, changes);
  };
  const write = client.mutate(send, { conversationId: "c1", body: "late admission" });
  await entered.promise;
  gone = true; f.window.dispatchEvent(new Event("pagehide"));
  assert.equal(exits.length, 0, "an uncommitted admission is never sent");
  assert.equal(f.durable().length, 0);
  commit.resolve();
  const outcome = await write;
  const received = await until(async () => (await f.rows()).length === 1);
  console.log(`navigation model late commit: exitRequests=${exits.length}; rows=${(await f.rows()).length}; state=${outcome.state}`);
  assert.ok(received, "a completed admission must recheck the suspended page");
  assert.deepEqual(exits.map(e => e.id), [outcome.id]);
});

for (const identity of ["same", "different", "missing", "restored"]) {
  test(`navigation model: reopen before slow first sync (${identity} store)`, async t => {
    const f = await fixture(t);
    let offline = false;
    const client = await f.open((url, init) => offline ? Promise.reject(new TypeError("offline")) : fetch(url, init));
    offline = true; await client.sync();
    const pending = await client.mutate(send, { conversationId: "c1", body: "reopen promptly" });
    assert.equal(pending.state, "pending");
    await client.close();
    const syncGate = deferred(), sends = [], synced = deferred();
    let released = false;
    const opening = f.open(async (url, init) => {
      if (!released && String(url).endsWith("/probe")) {
        const body = await fetch(url, init).then(r => r.json());
        if (identity === "different") body.store_id += "-replaced";
        if (identity === "missing") delete body.store_id;
        if (identity === "restored") body.seq = 0;
        return Response.json(body);
      }
      if (String(url).endsWith("/sync")) { synced.resolve(); await syncGate.promise; }
      if (String(url).includes("/m/")) sends.push({ body: JSON.parse(init.body), beforeSync: !released });
      return fetch(url, init);
    });
    f.cleanup.push(async () => { released = true; syncGate.resolve(); await opening; });
    if (identity === "same") {
      const reached = await until(async () => (await f.rows()).length === 1);
      console.log(`navigation model slow sync: beforeFirstSync=${(await f.rows()).length}; sends=${sends.length}`);
      assert.ok(reached, "replay must not wait for first acquisition to complete");
      assert.deepEqual(sends.map(r => r.body.id), [pending.id]);
      assert.equal(sends[0].beforeSync, true);
    } else {
      await Promise.race([synced.promise, opening]); await tick();
      assert.equal(sends.length, 0, "unverified/replaced/restored stores must not take the early replay path");
    }
    released = true; syncGate.resolve();
    const reopened = await opening;
    if (identity !== "restored") {
      assert.ok(await until(async () => (await f.rows()).length === 1));
      await reopened.sync();
      assert.equal((await f.rows()).length, 1);
    }
  });
}
