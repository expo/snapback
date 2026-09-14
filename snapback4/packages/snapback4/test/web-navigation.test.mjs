// Page teardown around the real wasm device and HTTP server; IndexedDB itself
// is exercised by witness/navigation.mjs. No browser process needed here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webDevice, memoryPersistence, indexedDbPersistence } from "../dist/web.js";
import { createLocalClient } from "../dist/local.js";
import { exitTransport } from "../dist/local-exit.js";
import { devServer } from "../../../witness/lib.mjs";

const wasm = readFileSync(new URL("../src/wasm/snapback4_device_bg.wasm", import.meta.url));
const send = { kind: "mutation", name: "send" };
const seed = [
  { table: "conversations", row: { id: "c1", title: "General", creatorId: "dev:alice" } },
  { table: "memberships", row: { id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 } },
];
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) {
  const end = Date.now() + 10000;
  while (!await check()) { if (Date.now() > end) throw new Error("timed out waiting"); await new Promise(resolve => setTimeout(resolve, 20)); }
}
function page(t) {
  const window = new EventTarget(), document = new EventTarget();
  document.visibilityState = "visible";
  for (const [key, value] of Object.entries({ window, document })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  return { window, document };
}
async function fixture(t) {
  const events = page(t);
  const server = await devServer({ seed, port: 46000 + process.pid % 1000 });
  const clients = [];
  t.after(async () => { for (const c of clients) await c.close(); server.close(); });
  const persist = memoryPersistence(), requests = [], responses = [], cores = [];
  let offline = false;
  const transport = (input, init) => {
    if (init?.keepalive) {
      requests.push({ input, init });
      return fetch(input, init).then(async r => { responses.push(await r.clone().json()); return r; });
    }
    return offline ? Promise.reject(new TypeError("page transport stopped")) : fetch(input, init);
  };
  const open = async () => {
    const opener = webDevice({ wasm, persist });
    const device = { async open(...args) { const core = await opener.open(...args); cores.push(core); return core; } };
    const client = await createLocalClient({ url: server.api, persona: "alice", device, fetch: transport, waitSeconds: 1 });
    clients.push(client); return client;
  };
  const client = await open();
  offline = true;
  await client.sync();
  assert.equal(client.link(), "offline");
  const rows = async () => (await fetch(server.api + "/q/thread", { method: "POST", headers: { "x-snapback-persona": "alice" }, body: JSON.stringify({ args: { conversationId: "c1" } }) }).then(r => r.json())).data;
  return { ...events, client, open, persist, requests, responses, cores, rows, online() { offline = false; } };
}

test("pagehide sends committed writes synchronously and reopen is deduped by the server", async t => {
  const f = await fixture(t);
  const writes = await Promise.all(["navigation one", "navigation two"].map(body => f.client.mutate(send, { conversationId: "c1", body })));
  assert.ok(writes.every(w => w.state === "pending"));
  assert.equal((await f.rows()).length, 0);
  const durable = [...f.persist.stores.values()].flatMap(s => [...s.values()]).filter(c => c.s === "o").map(c => JSON.parse(c.v));
  assert.deepEqual(durable.map(e => e.id).sort(), writes.map(w => w.id).sort());
  f.window.dispatchEvent(new Event("pagehide"));
  // No promise/microtask or device read is allowed before starting the requests.
  const countAtExit = f.requests.length;
  await f.client.close();
  await tick();
  if (!countAtExit) {
    assert.equal((await f.rows()).length, 0, "base reproduction: absent until reopen");
    f.online(); await f.open(); await until(async () => (await f.rows()).length === 2);
    console.log("base navigation: 0 exit requests; 0 rows before reopen; 2 rows after reopen");
  }
  assert.equal(countAtExit, 2);
  for (const { init } of f.requests) {
    assert.equal(init.keepalive, true); assert.equal(init.signal, undefined);
    assert.equal(init.headers["x-snapback-persona"], "alice");
  }
  await until(() => f.responses.length === 2);
  assert.ok(f.responses.every(r => r.state === "sent"));
  assert.equal((await f.rows()).length, 2, "server received writes before next device opens");
  for (const { input, init } of f.requests) {
    const replay = await fetch(input, init).then(r => r.json());
    assert.equal(replay.state, "sent");
    assert.equal(replay.seq, f.responses.find(r => r.id === replay.id)?.seq);
  }
  f.online(); await f.open();
  assert.equal((await f.rows()).length, 2);
  console.log("navigation: 2 durable writes; 2 exit requests; 2 rows before reopen; 2 rows after replay");
});

test("hidden flushes, visible does not, and close removes page hooks", async t => {
  const f = await fixture(t);
  await f.client.mutate(send, { conversationId: "c1", body: "hidden" });
  f.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(f.requests.length, 0);
  f.document.visibilityState = "hidden";
  f.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(f.requests.length, 1);
  f.window.dispatchEvent(new Event("pagehide"));
  assert.equal(f.requests.length, 1, "do not duplicate an outstanding exit request");
  await f.client.close();
  f.window.dispatchEvent(new Event("pagehide"));
  assert.equal(f.requests.length, 1);
  await until(() => f.responses.length === 1);
});

test("mutate waits for outbox persistence before the exit transport can see it", async t => {
  const f = await fixture(t);
  const save = f.persist.save.bind(f.persist);
  let release, saving = false;
  f.persist.save = async (name, changes) => {
    if (changes.some(c => c.s === "o")) {
      saving = true; await new Promise(resolve => { release = resolve; });
    }
    await save(name, changes);
  };
  let resolved = false;
  const admitted = f.client.mutate(send, { conversationId: "c1", body: "durable first" }).then(w => { resolved = true; return w; });
  await until(() => saving);
  assert.equal(resolved, false);
  f.window.dispatchEvent(new Event("pagehide"));
  assert.equal(f.requests.length, 0);
  release();
  assert.equal((await admitted).state, "pending");
  f.persist.save = save;
  f.window.dispatchEvent(new Event("pagehide"));
  assert.equal(f.requests.length, 1);
  await until(() => f.responses.length === 1);
});

test("IndexedDB save resolves on transaction completion, not request success", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  t.after(() => previous ? Object.defineProperty(globalThis, "indexedDB", previous) : delete globalThis.indexedDB);
  let tx, mode, options, closed = false;
  const db = { transaction(_name, m, o) { mode = m; options = o; tx = { objectStore() { return { put() {}, delete() {} }; } }; return tx; }, close() { closed = true; } };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open() { const r = { result: db }; queueMicrotask(() => r.onsuccess()); return r; } } });
  let finished = false;
  const saving = indexedDbPersistence().save("device", [{ s: "o", k: "id", v: "entry" }]).then(() => { finished = true; });
  await tick();
  assert.equal(finished, false); assert.equal(mode, "readwrite");
  tx.oncomplete(); await saving;
  assert.equal(finished, true); assert.equal(closed, true);
  assert.equal(options?.durability, "strict");
});

test("failed persistence stops the device before either transport can send an undurable admission", async t => {
  const f = await fixture(t);
  f.persist.save = async (_name, changes) => {
    if (changes.some(c => c.s === "o")) throw new Error("disk full");
  };
  const write = await f.client.mutate(send, { conversationId: "c1", body: "not committed" });
  assert.equal(write.state, "failed"); assert.equal(write.why.code, "E_STORE");
  f.window.dispatchEvent(new Event("pagehide"));
  assert.equal(f.requests.length, 0);
  await assert.rejects(f.cores[0].call({ op: "queued" }), /disk full/);
  assert.equal((await f.rows()).length, 0);
});

test("an exit send invalidates an older sync receipt before the page resumes", async t => {
  const f = await fixture(t);
  await f.client.mutate(send, { conversationId: "c1", body: "sync race" });
  const before = (await f.cores[0].call({ op: "sync_state" })).ok;
  f.window.dispatchEvent(new Event("pagehide"));
  assert.equal(f.requests.length, 1);
  const stale = await f.cores[0].call({ op: "apply", page: { watermark: before.watermark, generation: before.generation, events: [], snapshot: false, more: false, send_revision: before.send_revision } });
  assert.match(stale.denied?.message, /mutation send overlapped/);
  assert.equal((await f.cores[0].call({ op: "queued" })).ok.length, 1);
  await until(() => f.responses.length === 1);
});

test("keepalive splits writes, counts UTF-8 bytes across clients, and releases quota on failure", async () => {
  const requests = [], finish = [];
  const transport = (url, init) => {
    requests.push({ url, init });
    return new Promise(resolve => finish.push(() => resolve(new Response("{}"))));
  };
  const a = exitTransport(transport, "https://example.test"), b = exitTransport(transport, "https://example.test");
  const entry = (id, n) => ({ id, op: "write", args: { body: "😀".repeat(n) }, newIds: [] });
  const first = entry("a", 8000), second = entry("b", 8000), third = entry("c", 8000);
  a([first, second, third, entry("oversize", 20000)], { authorization: "Bearer session" });
  b([entry("other client", 8000)], {});
  assert.equal(requests.length, 2);
  const total = requests.reduce((n, r) => n + Buffer.byteLength(r.init.body), 0);
  assert.ok(total <= 65536 && total > 64000);
  assert.ok(requests.every(r => r.init.keepalive && !r.init.signal));
  finish.splice(0).forEach(f => f()); await tick();
  assert.equal(requests.length, 4, "the next wave, including another client, starts as quota frees");
  assert.deepEqual(requests.map(r => JSON.parse(r.init.body).id).sort(), ["a", "b", "c", "other client"]);
  finish.splice(0).forEach(f => f()); await tick();
  let attempts = 0;
  const failing = exitTransport(() => { attempts++; if (attempts === 1) throw new TypeError("sync failure"); return Promise.reject(new TypeError("async failure")); }, "https://example.test");
  failing([first], {}); failing([first], {}); await tick(); failing([first], {}); await tick();
  assert.equal(attempts, 3);
  console.log(`keepalive: ${total} UTF-8 body bytes in 2 concurrent requests; ceiling 65536 bytes`);
});
