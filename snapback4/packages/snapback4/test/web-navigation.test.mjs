// Page teardown around the real wasm device and HTTP server; IndexedDB itself
// is exercised by witness/navigation.mjs. No browser process needed here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webDevice, memoryPersistence, indexedDbPersistence } from "../dist/web.js";
import { createLocalClient } from "../dist/local.js";
import { exitTransport } from "../dist/local-exit.js";
import { prepareClient } from "../dist/client-start.js";
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
async function fixture(t, { stallExitBody = false, applyExit = true, holdExit = false } = {}) {
  const events = page(t);
  const server = await devServer({ seed });
  const clients = [];
  const stalledBodies = [];
  t.after(async () => {
    try { stalledBodies.forEach(c => c.close()); for (const c of clients) await c.close(); }
    finally { await server.close(); }
  });
  const persist = memoryPersistence(), requests = [], responses = [], cores = [];
  let offline = false, pauseOrdinary = false, pauseExit = false;
  const exits = [];
  let ordinaryCount = 0;
  const ordinary = [], ordinaryRequests = [];
  const transport = (input, init) => {
    if (init?.keepalive) {
      requests.push({ input, init });
      const send = async () => {
        const response = holdExit ? Response.json({ denied: { code: "E_BUSY", family: "store", message: "retry later", retryable: true } }, { status: 409 })
          : applyExit ? await fetch(input, init) : new Response("{}");
        if (applyExit) responses.push(await response.clone().json());
        if (!stallExitBody) return response;
        await response.arrayBuffer();
        // Headers arrive, but the transport never finishes the response body.
        return new Response(new ReadableStream({ start(controller) { stalledBodies.push(controller); } }));
      };
      return pauseExit ? new Promise(resolve => exits.push(() => resolve(send()))) : send();
    }
    if (String(input).includes("/m/")) { ordinaryCount++; ordinaryRequests.push(JSON.parse(init.body)); }
    if (pauseOrdinary && String(input).includes("/m/")) return new Promise(resolve => ordinary.push(() => resolve(fetch(input, init))));
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
  return { ...events, client, open, persist, requests, responses, cores, rows, stalledBodies, ordinaryRequests, online() { offline = false; }, ordinary, count() { return ordinaryCount; }, holdExit() { pauseExit = true; }, releaseExit() { pauseExit = false; exits.splice(0).forEach(f => f()); }, pause() { pauseOrdinary = true; }, resume() { pauseOrdinary = false; ordinary.splice(0).forEach(f => f()); } };
}

async function within(work, ms, message) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { clearTimeout(timer); }
}

for (const applyExit of [false, true]) test(`stalled exit body recovers in order (${applyExit ? "already applied acknowledgement" : "not applied"})`, async t => {
  const f = await fixture(t, { stallExitBody: true, applyExit });
  const writes = [];
  for (const body of ["first", "second"]) writes.push(await f.client.mutate(send, { conversationId: "c1", body }));
  assert.ok(writes.every(w => w.state === "pending"));
  const entries = (await f.cores[0].call({ op: "queued" })).ok;
  await tick();
  f.document.visibilityState = "hidden";
  f.document.dispatchEvent(new Event("visibilitychange"));
  await until(() => f.stalledBodies.length === 1);
  assert.equal((await f.rows()).length, applyExit ? 1 : 0);
  const confirmed = [];
  f.client.onWrite(write => { if (write.state === "sent") confirmed.push(write); });
  const before = f.count(), resumedAt = performance.now();
  f.pause(); f.online();
  f.document.visibilityState = "visible";
  f.document.dispatchEvent(new Event("visibilitychange"));
  await f.client.sync();
  // An acknowledged head settles locally; an unknown head must replay first.
  const expected = applyExit ? writes.slice(1) : writes;
  try {
    await within(until(() => f.ordinary.length === 1), 3000, "ordinary flush wedged behind stalled exit body");
    assert.equal(f.count(), before + 1);
    const head = entries.find(entry => entry.id === expected[0].id);
    assert.deepEqual(f.ordinaryRequests.at(-1), { id: head.id, args: head.args, newIds: head.new_ids, store_id: JSON.parse(f.requests[0].init.body).store_id });
    if (applyExit) assert.equal((await f.client.write(writes[0].id)).state, "sent");
    f.window.dispatchEvent(new Event("pagehide"));
    assert.equal(f.requests.length, 1);
  } finally { f.resume(); }
  await until(() => confirmed.length === 2);
  assert.deepEqual(f.ordinaryRequests.slice(before).map(r => r.id), expected.map(w => w.id));
  assert.deepEqual(confirmed.map(w => w.id), writes.map(w => w.id));
  assert.ok(confirmed[0].seq < confirmed[1].seq);
  assert.equal(confirmed[0].replayed === true, applyExit);
  assert.deepEqual((await f.rows()).map(r => r.body).sort(), ["first", "second"]);
  assert.equal(f.stalledBodies.length, 1, "exit body is still stalled after recovery");
  console.log(`stalled exit: applied=${applyExit}; 2 writes; 1 exit request; ${expected.length} ordered ordinary sends; 2 rows; 0 duplicates; recovery ${Math.round(performance.now() - resumedAt)} ms`);
});

test("close during a stalled exit body resolves promptly", async t => {
  const f = await fixture(t, { stallExitBody: true });
  await f.client.mutate(send, { conversationId: "c1", body: "close stalled" });
  await tick();
  f.document.visibilityState = "hidden";
  f.document.dispatchEvent(new Event("visibilitychange"));
  await until(() => f.stalledBodies.length === 1);
  f.online();
  f.document.visibilityState = "visible";
  f.document.dispatchEvent(new Event("visibilitychange"));
  await f.client.sync(); await tick();
  const before = f.count(), started = performance.now();
  // The ordinary offline follower can already be in its one-second sleep.
  await within(f.client.close(), 1500, "close wedged behind stalled exit body");
  assert.equal(f.count(), before, "close stops waiting without starting a replay");
  assert.equal(f.requests[0].init.signal, undefined, "close does not cancel keepalive");
  assert.equal(f.stalledBodies.length, 1);
  console.log(`stalled exit close: ${Math.round(performance.now() - started)} ms; 0 ordinary sends after close`);
});

test("stalled exit wait stops immediately on close without cancelling delivery", async () => {
  const closed = new AbortController();
  let body;
  const send = exitTransport((_url, init) => {
    assert.equal(init.signal, undefined);
    return Promise.resolve(new Response(new ReadableStream({ start(controller) { body = controller; } })));
  }, "https://example.test", closed.signal);
  const waiting = send([{ id: "close", op: "send", args: {}, newIds: [], store_id: "kept-store" }], {});
  try {
    closed.abort();
    await within(waiting, 100, "close did not release the exit wait immediately");
  } finally { body.close(); await waiting; }
});

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
  assert.equal(countAtExit, 1);
  for (const { init } of f.requests) {
    assert.equal(init.keepalive, true); assert.equal(init.signal, undefined);
    assert.equal(init.headers["x-snapback-persona"], "alice");
  }
  await until(() => f.responses.length === 1);
  assert.ok(f.responses.every(r => r.state === "sent"));
  assert.equal((await f.rows()).length, 1, "server received only the oldest write before reopen");
  for (const { input, init } of f.requests) {
    const replay = await fetch(input, init).then(r => r.json());
    assert.equal(replay.state, "sent");
    assert.equal(replay.seq, f.responses.find(r => r.id === replay.id)?.seq);
  }
  f.online(); await f.open();
  await until(async () => (await f.rows()).length === 2);
  console.log("navigation: 2 durable writes; 1 exit request; 1 row before reopen; 2 rows after replay");
});

test("pagehide dispatch and retryable hold invalidate the pending-write list", async t => {
  const f = await fixture(t, { holdExit: true });
  const write = await f.client.mutate(send, { conversationId: "c1", body: "held on exit" });
  await tick(); // Release the ordinary offline attempt's settlement ownership.
  let notices = 0;
  f.client.onPendingWrites(() => notices++);
  f.window.dispatchEvent(new Event("pagehide"));
  assert.equal(f.requests.length, 1);
  assert.ok(notices > 0, "exit dispatch must notify mounted pending-write hooks");
  await until(async () => (await f.client.pendingWrites())[0]?.state === "held");
  const list = await f.client.pendingWrites();
  assert.equal(list[0].id, write.id); assert.equal(list[0].reason, "E_BUSY");
  assert.equal((await f.rows()).length, 0);
  assert.equal((await f.client.write(write.id)).state, "pending");
  await f.client.close();
  const saved = [...f.persist.stores.values()].flatMap(s => [...s.values()]).filter(c => c.s === "o").map(c => JSON.parse(c.v));
  assert.equal(saved.find(entry => entry.id === write.id).dispatch, "E_BUSY");
});

test("hidden flushes, visible does not, and close removes page hooks", async t => {
  const f = await fixture(t);
  await f.client.mutate(send, { conversationId: "c1", body: "hidden" });
  f.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(f.requests.length, 0);
  await tick(); // Let a failed ordinary offline attempt finish before the exit dispatch.
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
    // Stall admission only. Dispatch now also updates that durable entry.
    if (!saving && changes.some(c => c.s === "o")) {
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
  await tick();
  f.window.dispatchEvent(new Event("pagehide"));
  assert.equal(f.requests.length, 1);
  await until(() => f.responses.length === 1);
});

for (const blockedCleanup of [false, true]) test(`first pagehide dispatch survives a stalled status save (cleanup blocked=${blockedCleanup})`, async t => {
  const f = await fixture(t, { stallExitBody: true, applyExit: false });
  let storage = new Map(), cleanupFails = blockedCleanup;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const localStorage = { get length() { return storage.size; }, key: i => [...storage.keys()][i] ?? null,
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem(key) { if (cleanupFails) throw Error("cleanup unavailable"); storage.delete(key); } };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorage });
  t.after(() => previous ? Object.defineProperty(globalThis, "localStorage", previous) : delete globalThis.localStorage);
  const core = f.cores[0], call = core.call.bind(core);
  core.call = (request, ...args) => request.op === "begin_send"
    ? Promise.resolve({ denied: { code: "E_OFFLINE", family: "link", message: "ordinary dispatch blocked" } }) : call(request, ...args);
  const admitted = await f.client.mutate(send, { conversationId: "c1", body: "first dispatch at exit" }, { waitSeconds: 0 });
  assert.equal((await f.client.pendingWrites())[0].state, "queued");
  const save = f.persist.save.bind(f.persist);
  let release, saving = false, stall = true;
  f.persist.save = async (name, changes) => {
    // A send revision commits even if begin_send loses its id (the mutant).
    if (stall && !saving && changes.some(c => c.s === "m" && c.k === "device:send_revision")) {
      saving = true; await new Promise(resolve => { release = resolve; });
    }
    await save(name, changes);
  };
  try {
    await tick();
    f.window.dispatchEvent(new Event("pagehide"));
    await until(() => saving);
    assert.equal(f.requests.length, 1, "the keepalive request has started before IDB finishes");
    assert.ok([...storage.keys()].some(k => k.includes(":exit:")), "dispatch evidence precedes the request");
    const name = [...f.persist.stores].find(([, entries]) => [...entries.values()].some(c => c.s === "o" && c.k === admitted.id))?.[0];
    assert.ok(name);
    assert.equal(JSON.parse((await f.persist.load(name)).find(c => c.s === "o" && c.k === admitted.id).v).dispatch, undefined);
    async function reopenCopy(state = "sent") {
      const copy = memoryPersistence();
      for (const [name, entries] of f.persist.stores) copy.stores.set(name, new Map(structuredClone([...entries])));
      const options = { url: f.requests[0].input.split("/m/")[0], persona: "alice", device: webDevice({ wasm, persist: copy }),
        fetch: () => Promise.reject(new TypeError("reopen offline")) };
      const originalStorage = storage; storage = new Map(storage);
      const opened = await prepareClient(options, () => createLocalClient(options));
      try { assert.deepEqual((await opened.client.pendingWrites()).map(w => [w.id, w.state]), [[admitted.id, state]]); }
      finally { await opened.client.close(); storage = originalStorage; }
    }
    await reopenCopy();
    assert.ok([...storage.keys()].some(k => k.includes(":exit:")), "crash copy did not clean the original journal");
    release(); await call({ op: "queued" });
    assert.equal(JSON.parse((await f.persist.load(name)).find(c => c.s === "o" && c.k === admitted.id).v).dispatch, "",
      "the keyed begin_send itself must persist sent before journal cleanup");
    if (blockedCleanup) {
      assert.ok([...storage.keys()].some(k => k.includes(":exit:")), "failed cleanup retains its acknowledged marker");
      await call({ op: "hold_write", id: admitted.id, reason: "E_BUSY" });
      await reopenCopy("held"); // An acknowledged marker must not regress a later refusal.
      cleanupFails = false; await call({ op: "queued" });
    }
    assert.equal([...storage.keys()].some(k => k.includes(":exit:")), false);
    await reopenCopy(blockedCleanup ? "held" : "sent");
  } finally { stall = false; release?.(); }
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

test("failed persistence discards the device before either transport can send an undurable admission", async t => {
  const f = await fixture(t);
  f.persist.save = async (_name, changes) => {
    if (changes.some(c => c.s === "o")) throw new Error("disk full");
  };
  const write = await f.client.mutate(send, { conversationId: "c1", body: "not committed" });
  assert.equal(write.state, "failed"); assert.equal(write.why.code, "E_STORE");
  f.window.dispatchEvent(new Event("pagehide"));
  assert.equal(f.requests.length, 0);
  // The failed call discarded its uncommitted memory; the next call reopens
  // from IndexedDB, where the admission never landed.
  assert.deepEqual((await f.cores[0].call({ op: "queued" })).ok, []);
  assert.equal((await f.rows()).length, 0);
});

test("an exit send invalidates an older sync receipt before the page resumes", async t => {
  const f = await fixture(t);
  await f.client.mutate(send, { conversationId: "c1", body: "sync race" });
  await tick();
  const before = (await f.cores[0].call({ op: "sync_state" })).ok;
  f.window.dispatchEvent(new Event("pagehide"));
  assert.equal(f.requests.length, 1);
  const stale = await f.cores[0].call({ op: "apply", page: { watermark: before.watermark, generation: before.generation, events: [], snapshot: false, more: false, send_revision: before.send_revision } });
  assert.match(stale.denied?.message, /mutation send overlapped/);
  assert.equal((await f.cores[0].call({ op: "queued" })).ok.length, 1);
  await until(() => f.responses.length === 1);
});

test("keepalive counts UTF-8 bytes across clients and releases quota on failure", async () => {
  const requests = [], finish = [];
  const transport = (url, init) => {
    requests.push({ url, init });
    return new Promise(resolve => finish.push(() => resolve(new Response("{}"))));
  };
  const a = exitTransport(transport, "https://example.test"), b = exitTransport(transport, "https://example.test");
  const entry = (id, n) => ({ id, op: "write", args: { body: "😀".repeat(n) }, newIds: [], store_id: "kept-store" });
  const first = entry("a", 8000), second = entry("b", 8000), third = entry("c", 8000);
  a([first, second, third, entry("oversize", 20000)], { authorization: "Bearer session" });
  b([entry("other client", 8000)], {});
  assert.equal(requests.length, 2);
  const total = requests.reduce((n, r) => n + Buffer.byteLength(r.init.body), 0);
  assert.ok(total <= 65536 && total > 64000);
  assert.ok(requests.every(r => r.init.keepalive && !r.init.signal));
  finish.splice(0).forEach(f => f()); await tick();
  assert.equal(requests.length, 2, "successors stay durable until the head is settled");
  assert.deepEqual(requests.map(r => JSON.parse(r.init.body).id).sort(), ["a", "other client"]);
  finish.splice(0).forEach(f => f()); await tick();
  let attempts = 0;
  const failing = exitTransport(() => { attempts++; if (attempts === 1) throw new TypeError("sync failure"); return Promise.reject(new TypeError("async failure")); }, "https://example.test");
  failing([first], {}); failing([first], {}); await tick(); failing([first], {}); await tick();
  assert.equal(attempts, 3);
  console.log(`keepalive: ${total} UTF-8 body bytes in 2 concurrent requests; ceiling 65536 bytes`);
});

test("exit ordering survives reversed server processing", async () => {
  const pending = [], processed = new Set(); let value = 0;
  const transport = (_url, init) => new Promise(resolve => pending.push(() => {
    const entry = JSON.parse(init.body);
    if (!processed.has(entry.id)) { processed.add(entry.id); value = entry.args.value; }
    resolve(new Response("{}"));
  }));
  const send = exitTransport(transport, "https://example.test");
  const entries = [1, 2].map(value => ({ id: String(value), op: "set", args: { value }, newIds: [], store_id: "kept-store" }));
  send(entries, {});
  const outstanding = pending.length;
  pending.splice(0).reverse().forEach(f => f()); await tick();
  assert.equal(outstanding, 1, "only the oldest unconfirmed request may start");
  assert.equal(value, 1);
  send(entries.slice(1), {});
  pending.splice(0).reverse().forEach(f => f()); await tick();
  assert.equal(value, 2);
});

test("exit never bypasses an oversized or quota-blocked predecessor", async () => {
  const sent = [], finish = [];
  const transport = (_url, init) => { sent.push(JSON.parse(init.body).id); return new Promise(resolve => finish.push(() => resolve(new Response("{}")))); };
  const entry = (id, n) => ({ id, op: "set", args: "x".repeat(n), newIds: [], store_id: "kept-store" });
  const a = exitTransport(transport, "https://example.test"), b = exitTransport(transport, "https://example.test");
  a([entry("oversized", 65536), entry("small successor", 1)], {});
  const oversize = [...sent];
  finish.splice(0).forEach(f => f()); await tick(); sent.length = 0;
  a([entry("other client", 40000)], {});
  b([entry("quota blocked", 40000), entry("small successor", 1)], {});
  const quota = [...sent];
  finish.splice(0).forEach(f => f()); await tick();
  finish.splice(0).forEach(f => f()); await tick();
  assert.deepEqual(oversize, []);
  assert.deepEqual(quota, ["other client"]);
});

test("exit overlaps only the same ordinary in-flight head", async t => {
  const f = await fixture(t);
  await f.client.mutate(send, { conversationId: "c1", body: "first" });
  await f.client.mutate(send, { conversationId: "c1", body: "second" });
  f.pause(); f.online();
  const syncing = f.client.sync();
  t.after(() => f.resume());
  await until(() => f.ordinary.length > 0);
  f.window.dispatchEvent(new Event("pagehide"));
  const atExit = f.requests.length;
  assert.deepEqual(JSON.parse(f.requests[0].init.body), f.ordinaryRequests.at(-1));
  f.resume(); await syncing;
  await until(async () => (await f.rows()).length === 2);
  assert.equal(atExit, 1);
});

test("ordinary flush waits for the exit request before replaying its head", async t => {
  const f = await fixture(t);
  await f.client.mutate(send, { conversationId: "c1", body: "first" });
  await f.client.mutate(send, { conversationId: "c1", body: "second" });
  await tick();
  f.holdExit();
  f.window.dispatchEvent(new Event("pagehide"));
  assert.equal(f.requests.length, 1);
  const before = f.count();
  f.online();
  await f.client.sync(); await tick();
  const during = f.count();
  f.releaseExit();
  await until(async () => (await f.rows()).length === 2);
  assert.equal(during, before, "ordinary transport cannot overlap the exit send");
  assert.ok(f.count() > during, "ordinary replay resumes after exit transport settles");
});
