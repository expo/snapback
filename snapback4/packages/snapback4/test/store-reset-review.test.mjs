// Deterministic transport barriers around the real wasm device.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate as tick } from "node:timers/promises";
import { createLocalClient } from "../dist/local.js";
import { webDevice, memoryPersistence } from "../dist/web.js";

const wasm = readFileSync(new URL("../dist/wasm/snapback4_device_bg.wasm", import.meta.url));
const original = JSON.parse(readFileSync(new URL("./chat-schema.json", import.meta.url), "utf8"));
const ok = reply => { assert.ok(!reply.denied, JSON.stringify(reply)); return reply.ok; };
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check) { for (let i = 0; i < 10000; i++) { if (await check()) return; await tick(); } assert.fail("barrier was not reached"); }
const events = (store, count = 1) => [
  { table: "conversations", id: "c1", title: store, creatorId: "dev:alice" },
  { table: "memberships", id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 },
  ...Array.from({ length: count }, (_, i) => ({ table: "messages", id: `${store}-${i}`, conversationId: "c1", authorId: "dev:alice", body: store, at: i + 1, editedAt: null, photo: null })),
].map(({ table, ...data }) => ({ table, id: data.id, kind: "put", data }));
const backend = store => ({ ...original, programs: [...original.programs, { name: "marker", kind: "Query", args: {}, body: [{ Return: { Literal: { String: store } } }] }] });
const thread = { kind: "query", name: "thread" };
const args = { conversationId: "c1", c: null };
const snapshot = (store, count = 1) => ({ snapshot: true, store_id: store, generation: 1, events: events(store, count), watermark: 10, more: false });

async function fixture(t, count = 1) {
  const persist = memoryPersistence();
  let store = "A", offline = false, schemaFailures = 0, core, client, changes;
  let queryGate, localGate, mutationGate, localStarts = 0, queryStarts = 0, schemaCalls = 0, mutationStarts = 0, syncStarts = 0;
  const reads = [], clients = [], sends = [];
  let observing;
  const fetcher = async (input, init = {}) => {
    if (offline && !init.keepalive) throw new TypeError("offline");
    const path = new URL(input).pathname;
    if (path === "/schema") { schemaCalls++; if (schemaFailures-- > 0) throw new TypeError("schema interrupted"); return Response.json(backend(store)); }
    if (path === "/sync") {
      syncStarts++;
      const request = JSON.parse(init.body);
      return Response.json(request.from === 0 && !request.stream ? snapshot(store, count) : { snapshot: false, store_id: store, generation: 1, events: [], watermark: 10, more: false });
    }
    if (path === "/changes") {
      const current = changes = gate();
      const abort = () => current.resolve({ seq: 10, store_id: store });
      init.signal?.addEventListener("abort", abort, { once: true });
      try { return Response.json(await current.promise); } finally { init.signal?.removeEventListener("abort", abort); }
    }
    if (path.startsWith("/q/")) {
      const captured = store; queryStarts++;
      if (queryGate) await queryGate.promise;
      reads.push(captured);
      return Response.json({ data: captured, complete: true, tables: ["messages"] });
    }
    if (path.startsWith("/m/")) { sends.push({ ...JSON.parse(init.body), store, exit: !!init.keepalive }); mutationStarts++; if (mutationGate) await mutationGate.promise; return Response.json({ state: "sent", seq: 11 }); }
    if (path === "/probe") return Response.json({ ok: true });
    assert.fail(path);
  };
  async function open() {
    const opener = webDevice({ wasm, persist });
    client = await createLocalClient({ url: `http://reset.test/${encodeURIComponent(t.name)}`, persona: "alice", device: { async open(...a) { const opened = core = await opener.open(...a); return { ...opened, async call(request) {
      if (request.op === "observe_store") observing?.();
      const reply = await opened.call(request);
      if (request.op === "query" && localGate) { localStarts++; await localGate.promise; }
      return reply;
    } }; } }, fetch: (input, init) => fetcher(String(input).replace(`/${encodeURIComponent(t.name)}`, ""), init) });
    clients.push(client); return client;
  }
  t.after(async () => { queryGate?.resolve(); localGate?.resolve(); mutationGate?.resolve(); for (const c of clients) await c.close(); });
  await open();
  return { get client() { return client; }, get core() { return core; }, open, persist, reads, sends,
    replace() { store = "B"; }, offline(v) { offline = v; }, failSchema(n) { schemaFailures = n; },
    onObserve(callback) { observing = callback; },
    stats() { return { queryStarts, localStarts, schemaCalls, mutationStarts, syncStarts }; },
    holdLocal() { return localGate = gate(); },
    holdQueries() { return queryGate = gate(); }, holdMutation() { return mutationGate = gate(); },
    async changed(seq = 10) { await until(() => changes); const c = changes; changes = null; c.resolve({ seq, store_id: store, generation: 1 }); await tick(); },
  };
}

test("R2 item 2: getSnapshot is cleared and notified in the reset turn", async t => {
  const f = await fixture(t), watch = f.client.observe({ kind: "query", name: "marker" }, {}), notices = [];
  watch.subscribe(() => notices.push(watch.getSnapshot()));
  await until(() => watch.getSnapshot().fresh);
  assert.equal(watch.getSnapshot().data, "A");
  let during;
  f.onObserve(() => { during = watch.getSnapshot(); assert.deepEqual(during, { loading: true }); assert.deepEqual(notices.at(-1), during); });
  f.replace(); await f.client.sync();
  assert.deepEqual(during, { loading: true });
  await until(() => watch.getSnapshot().data === "B");
  assert.equal(watch.getSnapshot().fresh, true);
});

test("R4: a same-identity /changes head below acquisition persists the restore halt even when writes refill the head", async t => {
  const f = await fixture(t), op = { kind: "query", name: "marker" };
  assert.equal((await f.client.query(op, {})).fresh, true);
  // /changes reports the committed head. The store was restored to 5; other
  // writers then create commits 6–10, so the next /sync from 10 looks empty.
  await f.changed(5); await f.client.sync();
  assert.equal((await f.core.call({ op: "sync_state" })).ok.restore_refusal?.code, "E_STORE_RESTORE");
  const read = await f.client.query(op, {});
  assert.equal(read.denied?.code, "E_STORE_RESTORE", JSON.stringify(read));
});
test("finding 1: failed same-generation backend adoption survives retry and offline reopen", async t => {
  const f = await fixture(t);
  assert.equal((await f.client.query({ kind: "query", name: "marker" }, {})).data, "A");
  f.replace(); f.failSchema(1); await f.client.sync();
  f.offline(true); await f.client.sync(); await f.client.close(); await f.open();
  const held = ok(await f.core.call({ op: "query", name: "thread", viewer: "dev:alice", args, now: 100 }));
  assert.ok(held.denied, "offline reopen cannot acquire before adopting B");
  f.offline(false); await f.client.sync();
  const read = await f.client.query({ kind: "query", name: "marker" }, {});
  assert.equal(read.data, "B", "retry must not forget B's backend after its identity was persisted");
  assert.equal(read.fresh, true);
});

for (const mode of ["server", "horizon", "watch"]) test(`finding 2: delayed ${mode} answer cannot escape its incarnation`, async t => {
  const f = await fixture(t, mode === "horizon" ? 50 : 1);
  const op = mode === "horizon" ? thread : { kind: "query", name: "remote", runs: "server" };
  const barrier = f.holdQueries();
  const notices = [];
  const watch = mode === "watch" ? f.client.observe(op, args) : null;
  watch?.subscribe(() => notices.push(watch.getSnapshot()));
  const read = watch ? null : f.client.query(op, args);
  await until(() => f.stats().queryStarts > 0);
  f.replace(); await f.client.sync();
  barrier.resolve();
  if (watch) {
    await until(() => notices.some(r => r.data === "B"));
    assert.ok(!notices.some(r => r.data === "A"), "the running watch must discard A before notifying");
  } else assert.equal((await read).data, "B", "an old server answer must be retried");
  f.offline(true); await f.client.sync();
  const offline = await f.client.query(op, args);
  if (mode === "horizon") assert.ok(offline.data.every(row => row.body === "B"));
  else assert.equal(offline.data, "B", "remembered answers retain the current incarnation only");
});

test("finding 2: changes observation drops freshness while a mutation holds the network queue", async t => {
  const f = await fixture(t);
  assert.equal((await f.client.query(thread, args)).fresh, true);
  const barrier = f.holdMutation();
  const write = f.client.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "pending" });
  await until(() => f.stats().mutationStarts > 0);
  const before = f.stats().syncStarts;
  f.replace(); await f.changed();
  const read = await f.client.query(thread, args);
  const during = f.stats().syncStarts;
  barrier.resolve(); await write;
  assert.ok(read.data === "B" || read.fresh === false, "A cannot be fresh after /changes identified B; a current server answer is allowed");
  assert.equal(before, during, "the assertion runs before queued sync can start");
});

function locks(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request: async (name, options, body) => body({ name }) } } });
  t.after(() => previous ? Object.defineProperty(globalThis, "navigator", previous) : delete globalThis.navigator);
}

test("finding 3: orphan import retires foreign receipts and disables unknown predictions", async t => {
  locks(t);
  const persist = memoryPersistence(), opener = webDevice({ wasm, persist }), name = "orphan-review";
  let primary = await opener.open(name, backend("B"), "dev:alice");
  ok(await primary.call({ op: "apply", first: true, page: snapshot("B") })); await primary.close();
  const orphan = await opener.open(`${name}:tab-old`, backend("A"), "dev:alice");
  ok(await orphan.call({ op: "apply", first: true, page: snapshot("A") }));
  for (const [i, id] of ["known-observed", "known-sent", "unknown"].entries()) ok(await orphan.call({ op: "enqueue", entry: {
    id, seq: i + 1, op: "send", args: { conversationId: "c1", body: id }, new_ids: [id], predicted: [`messages/${id}`], predictable: true,
    ...(i === 0 ? { observed_seq: 11 } : i === 1 ? { sent_seq: 12 } : {}),
  } }));
  await orphan.close(); primary = await opener.open(name, null, "dev:alice"); t.after(() => primary.close());
  const queue = ok(await primary.call({ op: "queued" }));
  assert.deepEqual(queue.map(e => e.id), ["unknown"], "known A receipts must never enter B's sendable outbox");
  assert.equal(queue[0].predictable, false); assert.deepEqual(queue[0].predicted, []); assert.deepEqual(queue[0].new_ids, ["unknown"]);
});


test("finding 2: a delayed device read is retried before returning", async t => {
  const f = await fixture(t);
  const barrier = f.holdLocal();
  const read = f.client.query({ kind: "query", name: "marker" }, {});
  await until(() => f.stats().localStarts > 0);
  f.replace(); await f.client.sync(); barrier.resolve();
  assert.equal((await read).data, "B");
});

test("orphan provenance survives an unidentified destination and resolves on sync", async t => {
  locks(t);
  const persist = memoryPersistence(), opener = webDevice({ wasm, persist }), name = "unidentified-orphan";
  const orphan = await opener.open(`${name}:tab-A`, backend("A"), "dev:alice");
  ok(await orphan.call({ op: "apply", first: true, page: snapshot("A") }));
  for (const [i, id] of ["known", "unknown"].entries()) ok(await orphan.call({ op: "enqueue", entry: {
    id, seq: i + 1, op: "send", args: { conversationId: "c1", body: id }, new_ids: [id], predictable: true, ...(i === 0 ? { observed_seq: 11 } : {}),
  } }));
  await orphan.close();
  let primary = await opener.open(name, backend("B"), "dev:alice");
  assert.deepEqual(ok(await primary.call({ op: "queued" })).map(e => e.id), ["unknown"]);
  const kept = await persist.load(`${name}:tab-A`);
  assert.equal(kept.find(c => c.k === "device:store_id").v, "A");
  assert.deepEqual(kept.filter(c => c.s === "o").map(c => c.k), ["known"]);
  await primary.close(); primary = await opener.open(name, null, "dev:alice");
  ok(await primary.call({ op: "apply", first: true, page: snapshot("B") }));
  assert.deepEqual(ok(await primary.call({ op: "queued" })).map(e => e.id), ["unknown"]);
  assert.deepEqual(await persist.load(`${name}:tab-A`), []);
  await primary.close();
});

test("same-store orphan adoption preserves receipts, order and row IDs without predictions", async t => {
  locks(t);
  const persist = memoryPersistence(), opener = webDevice({ wasm, persist }), name = "same-orphan";
  const orphan = await opener.open(`${name}:tab-A`, backend("A"), "dev:alice");
  ok(await orphan.call({ op: "apply", first: true, page: snapshot("A") }));
  for (const [i, id] of ["known", "unknown"].entries()) ok(await orphan.call({ op: "enqueue", entry: {
    id, seq: i + 1, op: "send", args: {}, new_ids: [id], predictable: true, ...(i === 0 ? { observed_seq: 11 } : {}),
  } }));
  await orphan.close();
  const primary = await opener.open(name, backend("A"), "dev:alice"); t.after(() => primary.close());
  ok(await primary.call({ op: "apply", first: true, page: snapshot("A") }));
  const entries = ok(await primary.call({ op: "queued" }));
  // Unknowns may transfer before destination identification; the deferred
  // receipt follows once same-store ownership is established.
  assert.deepEqual(entries.map(e => e.id), ["unknown", "known"]);
  assert.equal(entries[1].observed_seq, 11);
  assert.ok(entries.every(e => !e.predictable && e.predicted.length === 0 && e.new_ids[0] === e.id));
});


for (const exit of [false, true]) test(`replacement receipts use ${exit ? "exit" : "ordinary"} transport without replaying known writes`, async t => {
  const window = new EventTarget(), document = new EventTarget(); document.visibilityState = "visible";
  for (const [key, value] of Object.entries({ window, document })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const f = await fixture(t);
  f.offline(true); await f.client.sync();
  const known = await f.client.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "known" });
  const unknown = await f.client.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "unknown" });
  // Simulate A's stream acknowledgement after losing the full POST reply.
  ok(await f.core.call({ op: "apply", page: { snapshot: false, store_id: "A", events: [], watermark: 10, more: false, acknowledged: { [known.id]: 10 } } }));
  const before = ok(await f.core.call({ op: "queued" }));
  const unknownIds = before.find(e => e.id === unknown.id).new_ids;
  assert.equal(before.find(e => e.id === known.id).observed_seq, 10);
  f.replace();
  if (exit) {
    ok(await f.core.call({ op: "observe_store", page: snapshot("B") }));
    window.dispatchEvent(new Event("pagehide"));
  } else { f.offline(false); await f.client.sync(); }
  await until(() => f.sends.length > 0);
  assert.equal(f.sends.filter(s => s.id === known.id).length, 0);
  assert.equal(f.sends.filter(s => s.id === unknown.id).length, 1);
  assert.deepEqual(f.sends[0].newIds, unknownIds);
  assert.equal(f.sends[0].exit, exit); assert.equal(f.sends[0].store, "B");
});

test("finding 2: a rerun started by replacement observation cannot publish the old partition", async t => {
  const f = await fixture(t), watch = f.client.observe({ kind: "query", name: "marker" }, {}), notices = [];
  watch.subscribe(() => notices.push(watch.getSnapshot()));
  await until(() => watch.getSnapshot().data === "A");
  const barrier = f.holdMutation();
  const write = f.client.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "pending" });
  await until(() => f.stats().mutationStarts > 0);
  // Finish any ordinary prediction rerun before starting the observation.
  await tick(); await tick(); notices.length = 0;
  f.replace(); await f.changed(); await tick();
  const stale = notices.filter(r => r.complete && r.data === "A");
  barrier.resolve(); await write;
  assert.deepEqual(stale, [], "a new revision cannot relabel a device read still backed by A as complete");
});
