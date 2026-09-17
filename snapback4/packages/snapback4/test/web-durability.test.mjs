// Real Wasm, with failures at the host's all-or-nothing persistence boundary.
// IndexedDB transaction and lock semantics are exercised by witness/idb.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { indexedDbPersistence, memoryPersistence, webDevice } from "../dist/web.js";
import { WebDevice } from "../dist/wasm/snapback4_device.js";

const wasm = readFileSync(new URL("../dist/wasm/snapback4_device_bg.wasm", import.meta.url));
const backend = JSON.parse(readFileSync(new URL("./chat-schema.json", import.meta.url), "utf8"));
const entry = (id, seq) => ({ id, seq, op: "send", args: { conversationId: "c1", body: id }, viewer: "dev:alice", now: seq + 10, new_ids: [id], predictable: true });
const events = [
  { table: "conversations", id: "c1", title: "General", creatorId: "dev:alice" },
  { table: "memberships", id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 },
  { table: "messages", id: "confirmed", conversationId: "c1", authorId: "dev:alice", body: "confirmed", at: 1, editedAt: null, photo: null },
].map(({ table, ...data }) => ({ table, id: data.id, kind: "put", data }));
const snapshot = (watermark = 1, replacement = events) => ({ op: "apply", first: true, page: { snapshot: true, generation: 1, events: replacement, watermark, more: false } });
const ok = reply => { assert.ok(!reply.denied, JSON.stringify(reply)); return reply.ok; };
const query = async core => ok(await core.call({ op: "query", name: "thread", viewer: "dev:alice", args: { conversationId: "c1", c: null }, now: 100 })).data;

async function fixture(t) {
  const name = `durability-${t.name}`;
  const memory = memoryPersistence();
  let failSave = false, failLoad = false, loads = 0, saves = 0;
  const persist = {
    ...memory,
    async load(store) { if (store === name) { loads++; if (failLoad) throw new Error("read unavailable"); } return memory.load(store); },
    async save(store, changes) { if (store === name) { saves++; if (failSave) { failSave = false; throw new Error("save aborted"); } } return memory.save(store, changes); },
  };
  const opener = webDevice({ wasm, persist });
  let core = await opener.open(name, backend);
  t.after(() => core.close());
  ok(await core.call(snapshot()));
  ok(await core.call({ op: "admit", entry: entry("earlier", 1) }));
  return { get core() { return core; }, memory, name, failSave() { failSave = true; }, failLoad(value) { failLoad = value; }, stats() { return { loads, saves }; }, async reopen() { await core.close(); core = await opener.open(name); } };
}

test("failed admission cannot appear in later reads or hitchhike on the next saved call", async t => {
  const f = await fixture(t);
  const before = await query(f.core);
  const durable = await f.memory.load(f.name);
  f.failSave();
  const rejected = f.core.call({ op: "admit", entry: entry("rejected", 2) });
  // Already queued before the failed save settles: ordering must include recovery.
  const following = f.core.call({ op: "set_meta", key: "following", value: "saved" });
  await assert.rejects(rejected, /save aborted/);
  ok(await following);
  assert.deepEqual(await query(f.core), before);
  assert.deepEqual(ok(await f.core.call({ op: "queued" })).map(e => e.id), ["earlier"]);
  assert.deepEqual((await f.memory.load(f.name)).filter(c => c.k !== "client:following"), durable);
  await f.reopen();
  assert.deepEqual(await query(f.core), before);
  ok(await f.core.call({ op: "admit", entry: entry("later", 3) }));
  assert.deepEqual(ok(await f.core.call({ op: "queued" })).map(e => e.id), ["earlier", "later"]);
});

test("failed snapshot publication and backend adoption preserve acknowledged state", async t => {
  const f = await fixture(t);
  const before = await query(f.core);
  f.failSave();
  await assert.rejects(f.core.call(snapshot(2, [])), /save aborted/);
  assert.deepEqual(await query(f.core), before);
  assert.equal(ok(await f.core.call({ op: "state" })).watermark, 1);
  f.failSave();
  await assert.rejects(f.core.call({ op: "adopt", backend: { ...backend, generation: 2 } }), /save aborted/);
  assert.equal(ok(await f.core.call({ op: "state" })).generation, 1);
  await f.reopen();
  assert.deepEqual(await query(f.core), before);
  ok(await f.core.call({ op: "settle", id: "earlier" }));
  assert.deepEqual((await query(f.core)).map(row => row.body), ["confirmed"], "confirmed base survives failed replacement and later withdrawal");
});

test("recovery read failures block calls until durable state can be reopened", async t => {
  const f = await fixture(t);
  f.failSave();
  await assert.rejects(f.core.call({ op: "set_meta", key: "uncommitted", value: "never" }), /save aborted/);
  f.failLoad(true);
  await assert.rejects(f.core.call({ op: "state" }), /read unavailable/);
  f.failLoad(false);
  assert.equal(ok(await f.core.call({ op: "meta", key: "uncommitted" })), null);
  assert.deepEqual(ok(await f.core.call({ op: "queued" })).map(e => e.id), ["earlier"]);
});

test("failed initial persistence frees the constructed Wasm device", async t => {
  const memory = memoryPersistence();
  const free = WebDevice.prototype.free;
  let freed = 0;
  WebDevice.prototype.free = function () { freed++; return free.call(this); };
  t.after(() => { WebDevice.prototype.free = free; });
  const opener = webDevice({ wasm, persist: { ...memory, async save(name, changes) { if (name === "failed-open") throw new Error("initial save aborted"); return memory.save(name, changes); } } });
  await assert.rejects(opener.open("failed-open", backend), /initial save aborted/);
  assert.equal(freed, 1);
});

test("successful calls keep incremental persistence without loading the store again", async t => {
  const f = await fixture(t);
  const before = f.stats();
  for (let n = 0; n < 50; n++) ok(await f.core.call({ op: "set_meta", key: "counter", value: String(n) }));
  for (let n = 0; n < 50; n++) assert.equal(ok(await f.core.call({ op: "meta", key: "counter" })), "49");
  const after = f.stats();
  assert.equal(after.loads, before.loads);
  assert.equal(after.saves - before.saves, 50);
});

test("close drains accepted calls once and refuses later calls", async () => {
  const memory = memoryPersistence();
  let started, release, block = false;
  const saved = new Promise(resolve => { started = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  const opener = webDevice({ wasm, persist: { ...memory, async save(name, changes) { if (block) { block = false; started(); await barrier; } await memory.save(name, changes); } } });
  const core = await opener.open("close-during-save", backend);
  block = true;
  const first = core.call({ op: "set_meta", key: "first", value: "saved" });
  await saved;
  const second = core.call({ op: "set_meta", key: "second", value: "saved" });
  const closing = core.close();
  await assert.rejects(core.call({ op: "state" }), /closed/);
  release();
  await Promise.all([first, second, closing, core.close()]);
  const reopened = await opener.open("close-during-save");
  try {
    assert.equal(ok(await reopened.call({ op: "meta", key: "first" })), "saved");
    assert.equal(ok(await reopened.call({ op: "meta", key: "second" })), "saved");
  } finally { await reopened.close(); }
});


for (const state of ["evicted", "unidentified"]) test(`W11R2: ${state} journal has no retry timer or missing-store read`, async t => {
  const name = `quiet-${state}`, orphan = `${name}:tab-old`, key = `snapback4-admission:${encodeURIComponent(orphan)}:store:write`;
  const memory = memoryPersistence(), timers = new Set();
  let loads = 0;
  for (const [globalKey, value] of Object.entries({ window: new EventTarget(), localStorage: { length: 1, key: () => key, getItem: () => "{}" }, navigator: { locks: { async request(name, options, body) { return body({ name }); } } } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, globalKey);
    Object.defineProperty(globalThis, globalKey, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, globalKey, previous) : delete globalThis[globalKey]);
  }
  t.mock.method(globalThis, "setTimeout", callback => { const timer = { callback, unref() {} }; timers.add(timer); return timer; });
  t.mock.method(globalThis, "clearTimeout", timer => timers.delete(timer));
  if (state === "unidentified") await memory.save(orphan, [{ s: "m", k: "client:marker", v: "unidentified" }]);
  const persist = { ...memory, async load(store) { if (store === orphan) loads++; return memory.load(store); } };
  const core = await webDevice({ wasm, persist }).open(name, backend);
  try {
    assert.equal(timers.size, 0, "an unresolved journal must wait for a signal, not poll for its lifetime");
    assert.equal(loads, state === "evicted" ? 0 : 1, "a read must not create an evicted journal's database");
    ok(await core.call({ op: "state" }));
    assert.equal(timers.size, 0);
    assert.equal((await memory.others(`${name}:tab-`)).length, state === "evicted" ? 0 : 1);
    t.diagnostic(`state=${state} retry_timers=${timers.size} orphan_loads=${loads}`);
  } finally { await core.close(); }
});

test("W11R2: receipt lookup never opens an absent shared database and sees later adoption", async t => {
  const name = "lazy-receipts", memory = memoryPersistence();
  let opens = 0;
  const persist = { ...memory,
    async load(store) { if (store === `${name}:receipts`) opens++; return memory.load(store); },
    async read(store, s, k) { if (store === `${name}:receipts`) opens++; return memory.read(store, s, k); },
  };
  const core = await webDevice({ wasm, persist }).open(name, backend);
  try {
    for (let i = 0; i < 10; i++) assert.deepEqual(JSON.parse(ok(await core.call({ op: "meta", key: "write-history" }))), []);
    assert.equal(opens, 0, "ordinary receipt lookups must not open/create the shared database");
    await memory.save(`${name}:receipts`, [{ s: "m", k: "client:write-history", v: JSON.stringify([{ state: "sent", id: "recovered", seq: 7 }]) }]);
    assert.deepEqual(JSON.parse(ok(await core.call({ op: "meta", key: "write-history" }))), [{ state: "sent", id: "recovered", seq: 7, replayed: true }]);
    assert.equal(opens, 1, "a later sibling adoption is visible without reopening this client");
    t.diagnostic("empty_receipt_lookups=10 absent_database_opens=0 later_receipts=1");
  } finally { await core.close(); }
});


function replaceGlobal(t, key, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
}

for (const unrelatedLocks of [false, true]) test(`W11INT: custom claims recover on sync without borrowing unrelated Web Locks (${unrelatedLocks})`, async t => {
  const name = "custom-claims", orphan = `${name}:tab-old`, memory = memoryPersistence();
  let waits = 0, timers = 0, foreignClaims = 0;
  replaceGlobal(t, "navigator", unrelatedLocks ? { locks: { request(name, options, body) {
    waits++;
    return new Promise((_, reject) => options.signal?.addEventListener("abort", () => reject(new DOMException("closed", "AbortError")), { once: true }));
  } } } : {});
  t.mock.method(globalThis, "setTimeout", () => { timers++; return { unref() {} }; });
  await memory.save(orphan, [{ s: "m", k: "client:write-history", v: JSON.stringify([{ state: "sent", id: "custom-receipt", seq: 3 }]) }]);
  await memory.save("unrelated", [{ s: "m", k: "present", v: "1" }]);
  const held = await memory.claim(orphan, false);
  const persist = { ...memory,
    async others(prefix) { return [...await memory.others(prefix), "unrelated"]; },
    async claim(requested, alternate) { if (requested === "unrelated") foreignClaims++; return memory.claim(requested, alternate); },
  };
  const core = await webDevice({ wasm, persist }).open(name, backend);
  try {
    assert.equal(await memory.has(orphan), true, "a busy provider claim keeps its source");
    assert.equal(waits, 0, "a free unrelated Web Lock cannot signal this provider's release");
    await held.release();
    ok(await core.call(snapshot()));
    assert.equal(await memory.has(orphan), false, "sync retries the provider claim after release");
    assert.deepEqual(JSON.parse(ok(await core.call({ op: "meta", key: "write-history" }))), [{ state: "sent", id: "custom-receipt", seq: 3, replayed: true }]);
    assert.equal(await memory.has("unrelated"), true);
    assert.equal(foreignClaims, 0, "enumeration cannot claim a store outside the orphan namespace");
    assert.equal(timers, 0);
    t.diagnostic(`custom_claim_recoveries=1 unrelated_lock_waits=${waits} foreign_claims=${foreignClaims} retry_timers=${timers}`);
  } finally { await held.release(); await core.close(); }
});

test("W11R2: a live sibling queues one cancellable lock wait without a timer", async t => {
  const name = "quiet-live", orphan = `${name}:tab-live`, memory = memoryPersistence();
  let waits = 0, aborts = 0, timers = 0;
  await memory.save(orphan, [{ s: "m", k: "client:marker", v: "held" }]);
  replaceGlobal(t, "navigator", { locks: { request(name, options, body) {
    if (name !== orphan) return Promise.resolve(body({ name }));
    if (options.ifAvailable) return Promise.resolve(body(null));
    waits++;
    return new Promise((_, reject) => options.signal.addEventListener("abort", () => { aborts++; reject(new DOMException("closed", "AbortError")); }, { once: true }));
  } } });
  memory.claim = indexedDbPersistence().claim;
  t.mock.method(globalThis, "setTimeout", () => { timers++; return { unref() {} }; });
  const core = await webDevice({ wasm, persist: memory }).open(name, backend);
  try {
    for (let n = 0; n < 3; n++) ok(await core.call(snapshot()));
    assert.equal(waits, 1, "repeated syncs share one queued wait per lock");
    assert.equal(timers, 0, "a living sibling costs no retry ticks");
  } finally { await core.close(); }
  assert.equal(aborts, 1, "close cancels the pending lock request");
  t.diagnostic(`live_sibling_waits=${waits} retry_timers=${timers} cancelled_waits=${aborts}`);
});

test("W11R2: persistent recovery failure exhausts three backoffs then a sync can recover", async t => {
  const name = "bounded-failure", orphan = `${name}:tab-old`, memory = memoryPersistence(), timers = new Set(), delays = [];
  let failed = true, attempts = 0;
  await memory.save(orphan, [{ s: "m", k: "client:write-history", v: JSON.stringify([{ state: "sent", id: "kept", seq: 1 }]) }]);
  replaceGlobal(t, "navigator", { locks: { async request(name, options, body) { return body({ name }); } } });
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { const timer = { callback, unref() {} }; timers.add(timer); delays.push(delay); return timer; });
  t.mock.method(globalThis, "clearTimeout", timer => timers.delete(timer));
  const persist = { ...memory, async save(store, changes) {
    if (store === `${name}:receipts`) { attempts++; if (failed) throw new Error("persistent outage"); }
    return memory.save(store, changes);
  } };
  const core = await webDevice({ wasm, persist }).open(name, backend);
  try {
    for (let n = 0; n < 8 && timers.size; n++) {
      const timer = [...timers][0]; timers.delete(timer); timer.callback();
      ok(await core.call({ op: "state" }));
    }
    assert.equal(timers.size, 0, "the timer budget must terminate during a persistent outage");
    assert.equal(attempts, 4, "one initial attempt and three retries");
    assert.deepEqual(delays, [1000, 2000, 4000]);
    assert.equal(await memory.has(orphan), true);
    failed = false; ok(await core.call(snapshot()));
    assert.equal(await memory.has(orphan), false);
    assert.equal(JSON.parse(ok(await core.call({ op: "meta", key: "write-history" })))[0].id, "kept");
    t.diagnostic("failed_attempts=4 retry_delays_ms=1000,2000,4000 remaining_timers=0 signal_recoveries=1");
  } finally { await core.close(); }
});

test("W11R2: IndexedDB existence fallback aborts creation of missing stores", async t => {
  const names = new Set(["present"]);
  let aborted = 0, closed = 0;
  replaceGlobal(t, "indexedDB", { open(name) {
    const request = { result: { close() { closed++; }, transaction() { throw new Error("absence must not start a read transaction"); } } };
    queueMicrotask(() => {
      if (names.has(name)) request.onsuccess();
      else {
        request.transaction = { abort() { aborted++; queueMicrotask(() => request.onerror()); } };
        request.onupgradeneeded();
      }
    });
    return request;
  } });
  const persist = indexedDbPersistence();
  assert.equal(await persist.has("missing"), false);
  assert.equal(await persist.read("missing", "m", "client:write-history"), null);
  assert.equal(await persist.has("present"), true);
  assert.deepEqual([...names], ["present"]);
  assert.equal(aborted, 2); assert.equal(closed, 1);
});
