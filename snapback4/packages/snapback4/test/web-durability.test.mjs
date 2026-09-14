// Real Wasm, with failures at the host's all-or-nothing persistence boundary.
// IndexedDB transaction and lock semantics are exercised by witness/idb.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { memoryPersistence, webDevice } from "../dist/web.js";
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
