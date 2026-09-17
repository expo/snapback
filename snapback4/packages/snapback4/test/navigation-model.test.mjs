// Node model of document teardown: the wasm device and server are real;
// ordinary fetch loses its reply on pagehide, while keepalive survives.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLocalClient } from "../dist/local.js";
import { mintId } from "../dist/client.js";
import { indexedDbPersistence, memoryPersistence, webDevice } from "../dist/web.js";
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
async function fixture(t, { exclusive = true } = {}) {
  if (exclusive) locks(t);
  const window = new EventTarget(), document = new EventTarget();
  const storage = new Map();
  const localStorage = {
    get length() { return storage.size; },
    key(i) { return [...storage.keys()][i] ?? null; },
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
  };
  document.visibilityState = "visible";
  for (const [key, value] of Object.entries({ window, document, localStorage })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const server = await devServer({ seed, port: 47000 + process.pid % 1000, extraSource: `
table audit:
  total: int
  ordering: int
  public 'navigation application counter'
  insert <- allow
  update <- allow
  delete <- allow
  sync public

mutation mark(digit: int):
  a = audit['audit']
  if a != null:
    update audit[a] { total: a.total + 1, ordering: a.ordering * 10 + digit }
  else:
    insert audit { id: 'audit', total: 1, ordering: digit }
  insert messages { conversationId: 'c1', authorId: viewer, body: 'journal', at: now }

mutation reject(digit: int):
  require digit = 1 else WRONG_DIGIT
  insert messages { conversationId: 'c1', authorId: viewer, body: 'accepted', at: now }

mutation answer(n: int):
  return n

mutation closeGate():
  delete audit['audit']

mutation guarded():
  require exists audit['audit'] else LOCKED
  insert messages { conversationId: 'c1', authorId: viewer, body: 'guarded', at: now }

mutation payload(body: text <=100000):
  insert messages { conversationId: 'c1', authorId: viewer, body: 'payload', at: now }

query audit():
  return audit['audit']
` });
  const clients = [], cleanup = [], persist = memoryPersistence();
  if (exclusive) persist.claim = indexedDbPersistence().claim;
  t.after(async () => { for (const run of cleanup) await run(); for (const client of clients) await client.close(); await server.close(); });
  const cores = [];
  const open = async (transport = fetch) => {
    const opener = webDevice({ wasm, persist });
    const device = { async open(...args) { const core = await opener.open(...args); cores.push(core); return core; } };
    const client = await createLocalClient({ url: server.api, persona: "alice", device, fetch: transport, waitSeconds: 1 });
    clients.push(client); return client;
  };
  const rows = async () => (await fetch(server.api + "/q/thread", { method: "POST", headers: { "x-snapback-persona": "alice" }, body: JSON.stringify({ args: { conversationId: "c1" } }) }).then(r => r.json())).data;
  const durable = () => [...persist.stores.values()].flatMap(s => [...s.values()]).filter(c => c.s === "o").map(c => JSON.parse(c.v)).sort((a, b) => a.seq - b.seq);
  const audit = async () => (await fetch(server.api + "/q/media.audit", { method: "POST", headers: { "x-snapback-persona": "alice" }, body: JSON.stringify({ args: {} }) }).then(r => r.json())).data;
  return { window, document, server, persist, open, rows, durable, cleanup, storage, localStorage, audit, cores };
}

const journalEntries = f => [...f.storage.values()].map(text => JSON.parse(text)).filter(r => r.entry);
const transfers = f => [...f.persist.stores.values()].flatMap(s => [...s.values()]).filter(c => c.s === "j");

test("W6d: caller id reservations preserve synchronous journal custody without duplicate prediction", async t => {
  const f = await fixture(t);
  let offline = false;
  const client = await f.open((url, init) => offline ? Promise.reject(new TypeError("offline")) : fetch(url, init));
  offline = true; await client.sync();
  const op = { kind: "mutation", name: "media.mark" }, id = mintId();
  const first = client.mutate(op, { digit: 1 }, { id });
  assert.equal(journalEntries(f).length, 1, "capture happens before mutate returns its promise");
  assert.equal(journalEntries(f)[0].entry.id, id);
  const retry = client.mutate(op, { digit: 1 }, { id });
  const conflict = client.mutate(op, { digit: 2 }, { id });
  assert.equal(journalEntries(f).length, 1);
  assert.equal(journalEntries(f)[0].entry.args.digit, 1, "a conflicting retry cannot overwrite the synchronous record");
  assert.strictEqual(await retry, await first);
  assert.equal((await conflict).why.code, "E_WRITE_ID_REUSE");
  assert.equal(f.durable().length, 1);
  offline = false; await client.sync();
  assert.ok(await until(async () => (await client.write(id))?.state === "sent", 15000));
  assert.equal((await f.audit()).total, 1); assert.equal((await f.rows()).length, 1);
  t.diagnostic("caller_id_journal_records=1 durable_entries=1 applied=1");
});

async function loseAdmission(f, client, op, args, options) {
  const gate = deferred(), entered = deferred(), save = f.persist.save.bind(f.persist);
  f.persist.save = async (name, changes) => {
    if (changes.some(c => c.s === "o")) { entered.resolve(); await gate.promise; throw new Error("document destroyed before IDB commit"); }
    await save(name, changes);
  };
  const writes = args.map(a => client.mutate(op, a, options));
  const captured = journalEntries(f);
  const closing = client.close();
  await entered.promise; gate.resolve();
  await closing; await Promise.all(writes);
  f.persist.save = save;
  return captured;
}

for (const settled of [false, true]) test(`pre-admission journal: committed admission dedupes a surviving journal (${settled ? "retired receipt" : "queued"})`, async t => {
  const f = await fixture(t), sends = [];
  let offline = false;
  const transport = (url, init) => {
    if (offline) return Promise.reject(new TypeError("offline"));
    if (String(url).includes("/m/")) sends.push(JSON.parse(init.body));
    return fetch(url, init);
  };
  const client = await f.open(transport);
  f.localStorage.removeItem = () => { throw new Error("cleanup disabled"); };
  if (!settled) { offline = true; await client.sync(); }
  const write = await client.mutate({ kind: "mutation", name: "media.mark" }, { digit: 1 });
  assert.equal(write.state, settled ? "sent" : "pending");
  const record = journalEntries(f)[0];
  assert.equal(record.entry.id, write.id);
  assert.equal(transfers(f).length, 1);
  await client.close();
  if (!settled) {
    const reopened = await f.open(transport);
    assert.equal(f.durable().length, 1);
    assert.equal((await f.cores.at(-1).call({ op: "next_submission" })).ok, 2, "journal replay must not readmit the same ID");
    await reopened.close(); offline = false;
  }
  const reopened = await f.open(transport); await reopened.sync();
  assert.ok(await until(async () => (await f.audit())?.total === 1));
  assert.equal(sends.length, 1);
  await reopened.close();
  f.localStorage.removeItem = key => f.storage.delete(key);
  const again = await f.open(transport); await again.sync();
  assert.equal((await f.audit()).total, 1);
  assert.equal(sends.length, 1);
  assert.equal(journalEntries(f).length, 0);
  console.log(`journal dedupe: retired=${settled}; admissions=1; applications=1; sends=${sends.length}; duplicates=0`);
});

for (const failure of ["prediction", "validation"]) test(`pre-admission journal: ${failure} refusal is removed and a valid successor applies`, async t => {
  const f = await fixture(t), sends = [], client = await f.open((url, init) => {
    if (String(url).includes("/m/")) sends.push(JSON.parse(init.body));
    return fetch(url, init);
  });
  const op = { kind: "mutation", name: "media.reject" };
  const failedPromise = client.mutate(op, { digit: failure === "prediction" ? 2 : "wrong type" });
  assert.equal(journalEntries(f).length, 1);
  const failed = await failedPromise;
  assert.equal(failed.state, "failed");
  assert.equal(failed.why.code, failure === "prediction" ? "WRONG_DIGIT" : "E_INPUT");
  assert.equal(journalEntries(f).length, 0);
  assert.equal(sends.length, 0);
  assert.equal((await client.mutate(op, { digit: 1 })).state, "sent");
  await client.close();
  const reopened = await f.open(); await reopened.sync();
  assert.equal((await f.rows()).length, 1);
  assert.equal(sends.length, 1);
});

test("pre-admission journal: a known refusal survives an IDB outage", async t => {
  const f = await fixture(t), client = await f.open(), save = f.persist.save.bind(f.persist);
  f.persist.save = async () => { throw new Error("IDB unavailable"); };
  const failed = await client.mutate({ kind: "mutation", name: "media.reject" }, { digit: 2 });
  f.persist.save = save;
  assert.equal(failed.state, "failed");
  assert.equal(failed.why.code, "WRONG_DIGIT");
  assert.equal(journalEntries(f).length, 0);
  assert.equal((await client.mutate({ kind: "mutation", name: "media.reject" }, { digit: 1 })).state, "sent");
});

for (const mismatch of ["persisted", "server", "offline then server"]) test(`pre-admission journal: ${mismatch} identity mismatch never sends a recovered write`, async t => {
  const f = await fixture(t), client = await f.open();
  const [record] = await loseAdmission(f, client, { kind: "mutation", name: "media.mark" }, [{ digit: 1 }]);
  assert.ok(record);
  if (mismatch === "persisted") {
    record.storeId += "-foreign";
    f.storage.set(record.key, JSON.stringify(record));
  }
  if (mismatch === "offline then server") {
    const offline = await f.open(() => Promise.reject(new TypeError("offline")));
    assert.equal(f.durable().length, 1);
    await offline.close();
  }
  const sends = [];
  const reopened = await f.open(async (url, init) => {
    if (String(url).includes("/m/")) sends.push(JSON.parse(init.body));
    const response = await fetch(url, init);
    if (mismatch !== "persisted" && ["/probe", "/sync", "/changes"].some(p => String(url).includes(p))) {
      const body = await response.json();
      if (body.store_id) body.store_id += "-replacement";
      return Response.json(body);
    }
    return response;
  });
  await reopened.sync();
  assert.equal(sends.length, 0);
  assert.equal(f.durable().length, 0);
  assert.equal(journalEntries(f).length, 0);
  assert.equal(await f.audit(), null);
});

for (const fault of ["quota", "accessor", "disabled"]) test(`pre-admission journal: ${fault} falls back to ordinary admission without throwing`, async t => {
  const f = await fixture(t), client = await f.open();
  if (fault === "quota") f.localStorage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
  if (fault === "accessor") Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked storage accessor"); } });
  if (fault === "disabled") Object.defineProperty(globalThis, "localStorage", { configurable: true, value: undefined });
  let write;
  assert.doesNotThrow(() => { write = client.mutate({ kind: "mutation", name: "media.mark" }, { digit: 1 }); });
  assert.equal((await write).state, "sent");
  assert.equal((await f.audit()).total, 1);
  assert.equal(journalEntries(f).length, 0);
});

test("pre-admission journal: arguments are captured before the caller changes them", async t => {
  const f = await fixture(t), client = await f.open();
  const args = { digit: 1 }, write = client.mutate({ kind: "mutation", name: "media.mark" }, args);
  assert.equal(journalEntries(f)[0].entry.args.digit, 1);
  args.digit = 2;
  assert.equal((await write).state, "sent");
  assert.equal((await f.audit()).ordering, 1);
});

for (const bound of ["record bytes", "journal bytes", "record count"]) test(`pre-admission journal: ${bound} bounds capture and ordinary admission still works`, async t => {
  const f = await fixture(t), client = await f.open();
  const bodies = bound === "record bytes" ? ["🙂".repeat(14000), "🙂".repeat(17000)]
    : bound === "journal bytes" ? Array(5).fill("🙂".repeat(14000)) : Array(33).fill("");
  const writes = bodies.map(body => client.mutate({ kind: "mutation", name: "media.payload" }, { body }));
  const captured = journalEntries(f), size = [...f.storage].reduce((n, [k, v]) => n + Buffer.byteLength(k) + Buffer.byteLength(v), 0);
  assert.equal(captured.length, bound === "record bytes" ? 1 : bound === "journal bytes" ? 4 : 32);
  assert.ok(size <= 256 * 1024);
  assert.ok(captured.every(r => Buffer.byteLength(JSON.stringify(r)) <= 64 * 1024));
  assert.ok((await Promise.all(writes)).every(w => w.state === "sent"));
  assert.equal((await f.rows()).length, bodies.length);
  console.log(`journal bounds: ${bound}; captured=${captured.length}; writes=${writes.length}; bytes=${size}; largestRecord=${Math.max(...captured.map(r => Buffer.byteLength(JSON.stringify(r))))}`);
});

function locks(t) {
  const held = new Set(), queues = new Map(), previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const pump = name => {
    if (held.has(name)) return;
    const next = queues.get(name)?.shift();
    if (next) next(); else queues.delete(name);
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request(name, options, body) {
    if (options.ifAvailable && (held.has(name) || queues.get(name)?.length)) return Promise.resolve(body(null));
    return new Promise((resolve, reject) => {
      const abort = () => { queues.set(name, (queues.get(name) ?? []).filter(run => run !== start)); reject(new DOMException("closed", "AbortError")); };
      const start = () => {
        options.signal?.removeEventListener("abort", abort);
        held.add(name);
        Promise.resolve().then(() => body({ name })).finally(() => { held.delete(name); pump(name); }).then(resolve, reject);
      };
      if (options.signal?.aborted) { abort(); return; }
      options.signal?.addEventListener("abort", abort, { once: true });
      if (!queues.has(name)) queues.set(name, []);
      queues.get(name).push(start); pump(name);
    });
  } } } });
  t.after(() => previous ? Object.defineProperty(globalThis, "navigator", previous) : delete globalThis.navigator);
}

test("pre-admission journal: the next device adopts a closed tab's writes in order", async t => {
  const f = await fixture(t); locks(t);
  const primary = await f.open(), orphan = await f.open();
  const source = [...f.persist.stores.keys()].find(n => n.includes(":tab-"));
  const captured = await loseAdmission(f, orphan, { kind: "mutation", name: "media.mark" }, [{ digit: 1 }, { digit: 2 }]);
  assert.equal(captured.length, 2);
  assert.equal(f.durable().length, 0);
  await primary.close();
  const client = await f.open();
  assert.equal((await client.mutate({ kind: "mutation", name: "media.mark" }, { digit: 3 })).state, "sent");
  await client.sync();
  assert.equal((await f.audit()).total, 3);
  assert.equal((await f.audit()).ordering, 123);
  assert.ok(!f.persist.stores.has(source));
  assert.equal(journalEntries(f).length, 0);
  await client.close();
  const again = await f.open(); await again.sync();
  assert.equal((await f.audit()).total, 3, "a valid custom alternate is adopted exactly once");
});

test("pre-admission journal: a live tab's journal is never adopted", async t => {
  const f = await fixture(t); locks(t);
  const primary = await f.open(), owner = await f.open(), gate = deferred(), entered = deferred();
  const save = f.persist.save.bind(f.persist);
  f.persist.save = async (name, changes) => {
    if (name.includes(":tab-") && changes.some(c => c.s === "o")) { entered.resolve(); await gate.promise; }
    await save(name, changes);
  };
  const write = owner.mutate({ kind: "mutation", name: "media.mark" }, { digit: 1 });
  await entered.promise;
  f.cleanup.push(() => { gate.resolve(); });
  await primary.close();
  const other = await f.open(); await other.sync();
  assert.equal(await f.audit(), null);
  assert.equal(journalEntries(f).length, 1);
  gate.resolve();
  assert.equal((await write).state, "sent");
  assert.equal((await f.audit()).total, 1);
});

test("pre-admission journal: a failed save recovers the predecessor before a surviving page's next admission", async t => {
  const f = await fixture(t), client = await f.open(), save = f.persist.save.bind(f.persist);
  let fail = true;
  f.persist.save = async (name, changes) => {
    if (fail && changes.some(c => c.s === "o")) { fail = false; throw new Error("one admission abort"); }
    await save(name, changes);
  };
  const first = client.mutate({ kind: "mutation", name: "media.mark" }, { digit: 1 });
  const second = client.mutate({ kind: "mutation", name: "media.mark" }, { digit: 2 });
  const third = client.mutate({ kind: "mutation", name: "media.reject" }, { digit: 2 });
  assert.equal((await first).why.code, "E_STORE");
  assert.equal((await second).state, "sent");
  assert.equal((await third).why.code, "WRONG_DIGIT");
  assert.equal((await f.audit()).total, 2);
  assert.equal((await f.audit()).ordering, 12);
  assert.equal(journalEntries(f).length, 0);
});

for (const count of [1, 2]) for (const timing of ["same turn", "held save"]) {
  test(`pre-admission journal: ${count} unawaited writes survive ${timing} teardown`, async t => {
    const f = await fixture(t), gate = deferred(), entered = deferred(), sent = [];
    let gone = false;
    const client = await f.open((url, init) => {
      if (gone) return Promise.reject(new TypeError("document destroyed"));
      return fetch(url, init);
    });
    const save = f.persist.save.bind(f.persist);
    f.persist.save = async (name, changes) => {
      if (changes.some(c => c.s === "o")) { entered.resolve(); await gate.promise; throw new Error("document destroyed before IDB commit"); }
      await save(name, changes);
    };
    const writes = Array.from({ length: count }, (_, i) => client.mutate({ kind: "mutation", name: "media.mark" }, { digit: i + 1 }));
    const captured = [...f.storage.values()]; // snapshot before mutate's first await resumes
    if (timing === "held save") await entered.promise;
    gone = true;
    f.window.dispatchEvent(new Event("pagehide"));
    const closing = client.close();
    await entered.promise;
    gate.resolve();
    await closing; await Promise.all(writes);
    assert.equal(f.durable().length, 0);
    assert.equal((await f.audit()), null);
    f.persist.save = save;
    const reopenedAt = performance.now();
    const reopened = await f.open((url, init) => {
      if (String(url).includes("/m/")) sent.push(JSON.parse(init.body));
      return fetch(url, init);
    });
    await reopened.sync();
    assert.ok(await until(async () => (await f.audit())?.total === count), "uncommitted writes must survive through the synchronous journal");
    const audit = await f.audit();
    assert.equal(audit.ordering, count === 1 ? 1 : 12);
    assert.equal(sent.length, count);
    assert.ok(captured.length > 0, "the record existed before mutate returned its promise");
    assert.deepEqual(sent.map(s => s.args.digit), Array.from({ length: count }, (_, i) => i + 1));
    assert.deepEqual((await f.rows()).map(r => r.id).sort(), sent.map(s => s.newIds[0]).sort());
    console.log(`pre-admission journal: count=${count}; timing=${timing}; applications=${audit.total}; order=${audit.ordering}; duplicates=${audit.total - count}; replayMs=${Math.round(performance.now() - reopenedAt)}; journalBytes=${captured.reduce((n, s) => n + Buffer.byteLength(s), 0)}`);
  });
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

const mark = { kind: "mutation", name: "media.mark" };
const storeName = f => [...f.persist.stores.keys()].find(n => n.startsWith("snapback4-") && !n.includes(":tab-") && n !== "snapback4-wasm");
async function requireBackend(f, name) {
  const storeId = (await f.persist.load(name)).find(c => c.k === "device:store_id").v;
  await f.persist.save(name, [{ s: "m", k: "device:backend-required", v: storeId }]);
}

test("W4R1 A: deferred recovery allocates before an offline successor, then applies ABC", async t => {
  const f = await fixture(t), first = await f.open();
  const records = await loseAdmission(f, first, mark, [{ digit: 1 }, { digit: 2 }]);
  await requireBackend(f, storeName(f));
  let unavailable = false;
  const sends = [];
  const transport = (url, init) => {
    if (unavailable || String(url).includes("/m/")) return Promise.reject(new TypeError("transport unavailable"));
    return fetch(url, init);
  };
  const client = await f.open(transport);
  assert.equal((await f.cores.at(-1).call({ op: "sync_state" })).ok.backend_required, false);
  assert.deepEqual(f.durable().map(e => e.seq), [1, 2], "reopen transfers journal custody before a successor");
  assert.ok((await Promise.all(records.map(record => client.write(record.entry.id)))).every(write => write?.state === "pending"));
  unavailable = true; await client.sync();
  const successor = await client.mutate(mark, { digit: 3 });
  assert.equal(successor.state, "pending");
  const queued = f.durable();
  await client.close();
  const reopened = await f.open((url, init) => {
    if (String(url).includes("/m/")) sends.push(JSON.parse(init.body));
    return fetch(url, init);
  });
  await reopened.sync();
  assert.equal((await f.audit()).ordering, 123);
  assert.equal((await f.audit()).total, 3);
  assert.deepEqual(queued.map(e => e.seq), [1, 2, 3]);
  assert.deepEqual(sends.map(e => e.id), [...records.map(r => r.entry.id), successor.id]);
  console.log(`W4R1 A: submissions=${queued.map(e => e.seq)}; applications=3; order=123; duplicates=0`);
});

test("W4R1 B1: a matching orphan installs the destination backend before recovery", async t => {
  const f = await fixture(t), primary = await f.open(), orphan = await f.open();
  const source = [...f.persist.stores.keys()].find(n => n.includes(":tab-"));
  const records = await loseAdmission(f, orphan, mark, [{ digit: 1 }, { digit: 2 }]);
  await requireBackend(f, source);
  await primary.close();
  const sends = [];
  const reopened = await f.open((url, init) => {
    if (String(url).includes("/m/")) sends.push(JSON.parse(init.body));
    return fetch(url, init);
  });
  await reopened.sync();
  assert.equal((await f.audit())?.ordering, 12);
  assert.equal((await f.audit()).total, 2);
  assert.deepEqual(sends.map(e => e.id), records.map(r => r.entry.id));
  assert.equal(journalEntries(f).length, 0);
  assert.ok(!f.persist.stores.has(source));
});

for (const fault of ["empty", "missing identity", "broken backend"]) test(`W4R1 B2: ${fault} orphan cannot fail open or hide a healthy orphan`, async t => {
  const f = await fixture(t), primary = await f.open(), orphan = await f.open();
  const source = [...f.persist.stores.keys()].find(n => n.includes(":tab-"));
  const [record] = await loseAdmission(f, orphan, mark, [{ digit: 1 }]);
  const saved = await f.persist.load(source);
  if (fault === "empty") f.persist.stores.delete(source);
  if (fault === "missing identity") await f.persist.save(source, [{ s: "m", k: "device:store_id", v: null }]);
  if (fault === "broken backend") await f.persist.save(source, [{ s: "m", k: "device:backend", v: "{" }]);
  const healthy = await f.open();
  await loseAdmission(f, healthy, mark, [{ digit: 3 }]);
  await primary.close();
  const reopened = await f.open();
  assert.equal((await reopened.mutate(mark, { digit: 2 })).state, "sent");
  assert.ok(f.storage.has(record.key), "unidentifiable or unusable source stays recoverable");
  assert.equal((await f.audit()).ordering, 32);
  await reopened.close();
  await f.persist.save(source, saved);
  const again = await f.open(); await again.sync();
  assert.equal((await f.audit()).ordering, 321);
  assert.equal((await f.audit()).total, 3);
  assert.equal(journalEntries(f).length, 0);
  assert.ok(!f.persist.stores.has(source));
});

for (const available of ["localStorage", "IDB", "neither"]) test(`W4R1 C: known refusal with failed removal and ${available} cancellation`, async t => {
  const f = await fixture(t), client = await f.open(), save = f.persist.save.bind(f.persist), setItem = f.localStorage.setItem;
  f.localStorage.removeItem = () => { throw new Error("removal unavailable"); };
  const gate = deferred(), entered = deferred();
  // Hold the serialized device chain so capture succeeds before storage fails.
  f.persist.save = async (name, changes) => { entered.resolve(); await gate.promise; await save(name, changes); };
  const barrier = f.cores.at(-1).call({ op: "set_meta", key: "refusal-test", value: "1" });
  await entered.promise;
  const write = client.mutate({ kind: "mutation", name: "media.guarded" }, {});
  assert.equal(journalEntries(f).length, 1);
  if (available !== "localStorage") f.localStorage.setItem = () => { throw new Error("replacement unavailable"); };
  if (available !== "IDB") f.persist.save = async () => { throw new Error("IDB unavailable"); };
  gate.resolve(); await barrier;
  const failed = await write;
  f.persist.save = save; f.localStorage.setItem = setItem;
  assert.equal(failed.why.code, "LOCKED", "bookkeeping must not replace a known authored refusal with E_STORE");
  assert.equal(failed.state, "failed");
  console.log(`W4R1 C: cancellation=${available}; refusal=${JSON.stringify(failed.why)}`);
  // Change the authored condition. Recovery may still see the device's stale
  // rows; the stranded intent must queue for the server's current decision.
  await fetch(f.server.api + "/m/media.mark", { method: "POST", headers: { "x-snapback-persona": "alice", "content-type": "application/json" }, body: JSON.stringify({ id: "unlock", args: { digit: 1 }, newIds: ["unlock-row"] }) }).then(r => r.json());
  await client.sync();
  await client.close();
  const reopened = await f.open(); await reopened.sync();
  const guarded = (await f.rows()).filter(r => r.body === "guarded");
  assert.equal(guarded.length, available === "neither" ? 1 : 0, "only total cancellation failure leaves an indeterminate record");
  assert.equal((await reopened.mutate({ kind: "mutation", name: "media.guarded" }, {})).state, "sent");
  assert.equal((await f.rows()).filter(r => r.body === "guarded").length, guarded.length + 1);
  f.localStorage.removeItem = key => f.storage.delete(key);
  await reopened.close();
  const cleaned = await f.open(); await cleaned.sync();
  assert.equal(f.storage.size, 0, "successful removal also collects non-executable cancellations");
});

test("W4R1 C: an orphan journal does not settle against its stale authored condition", async t => {
  const f = await fixture(t), primary = await f.open(), orphan = await f.open();
  const save = f.persist.save.bind(f.persist), setItem = f.localStorage.setItem;
  f.localStorage.removeItem = () => { throw new Error("removal unavailable"); };
  const gate = deferred(), entered = deferred();
  f.persist.save = async (name, changes) => { entered.resolve(); await gate.promise; await save(name, changes); };
  const barrier = f.cores.at(-1).call({ op: "set_meta", key: "orphan-refusal-test", value: "1" });
  await entered.promise;
  const write = orphan.mutate({ kind: "mutation", name: "media.guarded" }, {});
  f.localStorage.setItem = () => { throw new Error("replacement unavailable"); };
  f.persist.save = async () => { throw new Error("IDB unavailable"); };
  gate.resolve(); await barrier;
  const failed = await write;
  f.persist.save = save; f.localStorage.setItem = setItem;
  assert.equal(failed.state, "failed"); assert.equal(failed.why.code, "LOCKED");
  await fetch(f.server.api + "/m/media.mark", { method: "POST", headers: { "x-snapback-persona": "alice", "content-type": "application/json" }, body: JSON.stringify({ id: "orphan-unlock", args: { digit: 1 }, newIds: ["orphan-unlock-row"] }) }).then(r => r.json());
  await primary.sync();
  await orphan.close(); await primary.close();
  const reopened = await f.open(); await reopened.sync();
  assert.equal((await f.rows()).filter(row => row.body === "guarded").length, 1,
    "the acquired destination cannot let stale orphan rows cancel journal custody");
  f.localStorage.removeItem = key => f.storage.delete(key);
});

test("W4R1 D: single-context persistence supplies exclusive ownership without Web Locks", async t => {
  const f = await fixture(t, { exclusive: false });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  t.after(() => previous ? Object.defineProperty(globalThis, "navigator", previous) : delete globalThis.navigator);
  const client = await f.open(), gate = deferred(), entered = deferred(), save = f.persist.save.bind(f.persist);
  let blocked = false;
  f.cleanup.push(() => gate.resolve());
  f.persist.save = async (name, changes) => {
    if (!blocked && changes.some(c => c.s === "o")) { blocked = true; entered.resolve(); await gate.promise; }
    await save(name, changes);
  };
  const write = client.mutate(mark, { digit: 1 });
  const captured = journalEntries(f).length;
  await entered.promise;
  const other = await f.open(); await other.sync();
  assert.equal(await f.audit(), null, "the second owner must not execute the live admission");
  assert.equal(captured, 1);
  gate.resolve();
  assert.equal((await write).state, "sent");
  assert.equal((await f.audit()).total, 1);
});

test("durable IndexedDB and custom persistence cannot silently open without ownership", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  t.after(() => previous ? Object.defineProperty(globalThis, "navigator", previous) : delete globalThis.navigator);
  await assert.rejects(indexedDbPersistence().claim("durable", true), /requires the Web Locks API/);
  assert.throws(() => webDevice({ persist: {
    async load() { return []; },
    async save() {},
  } }), /must provide an exclusive claim\(name, alternate\) ownership contract/);
});

for (const fault of ["arbitrary alternate", "unrecoverable alternate"]) test(`custom persistence rejects ${fault} before opening`, async () => {
  const base = memoryPersistence();
  let rejectedReleased = 0;
  const persist = {
    load: base.load,
    save: base.save,
    ...(fault === "unrecoverable alternate" ? {} : { others: base.others, remove: base.remove }),
    async claim(name, alternate) {
      return {
        name: fault === "arbitrary alternate" ? "unrelated" : `${name}:tab-custom`,
        async release() { rejectedReleased++; },
      };
    },
  };
  await assert.rejects(webDevice({ wasm, persist }).open("owned", null),
    fault === "arbitrary alternate" ? /must use the owned:tab-\* namespace/
      : /must implement others\(prefix\) and remove\(name\)/);
  assert.equal(rejectedReleased, 1, "the rejected claim is released");
});

test("custom persistence rejects an inexact orphan claim before opening", async t => {
  const f = await fixture(t), primary = await f.open(), name = storeName(f);
  await primary.close();
  const orphan = `${name}:tab-orphan`;
  await f.persist.save(orphan, [{ s: "m", k: "present", v: "1" }]);
  const claim = f.persist.claim.bind(f.persist);
  let rejectedReleased = 0;
  f.persist.claim = async (requested, alternate) => !alternate
    ? { name: `${requested}:wrong`, async release() { rejectedReleased++; } }
    : claim(requested, alternate);
  await assert.rejects(f.open(), new RegExp(`non-alternate claim for ${orphan} must return that exact name`));
  assert.equal(rejectedReleased, 1, "the rejected orphan claim is released");
});

test("W4R1 E: one malformed journal key does not hide a real closed tab journal", async t => {
  const f = await fixture(t), primary = await f.open(), orphan = await f.open();
  const [record] = await loseAdmission(f, orphan, mark, [{ digit: 1 }]);
  f.storage.set("snapback4-admission:%E0%A4%A:bad", "{}");
  f.persist.others = async () => []; // This browser has no indexedDB.databases().
  await primary.close();
  const client = await f.open(); await client.sync();
  assert.equal((await f.audit())?.total, 1);
  assert.ok(!f.storage.has(record.key));
  assert.equal((await client.mutate(mark, { digit: 2 })).state, "sent");
  assert.equal((await f.audit()).ordering, 12);
});

test("W4R1 missing: queued primary precedes two orphan journals with one application each", async t => {
  const f = await fixture(t);
  let offline = false;
  const primary = await f.open((url, init) => offline ? Promise.reject(new TypeError("offline")) : fetch(url, init));
  offline = true; await primary.sync();
  const queued = await primary.mutate(mark, { digit: 1 });
  assert.equal(queued.state, "pending");
  const secondary = await f.open((url, init) => String(url).includes("/m/") ? Promise.reject(new TypeError("offline")) : fetch(url, init));
  const records = await loseAdmission(f, secondary, mark, [{ digit: 2 }, { digit: 3 }]);
  await primary.close();
  const sends = [];
  const client = await f.open((url, init) => {
    if (String(url).includes("/m/")) sends.push(JSON.parse(init.body));
    return fetch(url, init);
  });
  await client.sync();
  assert.equal((await f.audit()).ordering, 123);
  assert.equal((await f.audit()).total, 3);
  assert.deepEqual(sends.map(e => e.id), [queued.id, ...records.map(r => r.entry.id)]);
  console.log("W4R1 queued + orphan: applications=3; order=123; sends=3; duplicates=0");
});

test("W4R1 missing: before the first store identity mutation stays best-effort without throwing", async t => {
  const f = await fixture(t);
  const client = await f.open(async (url, init) => {
    const response = await fetch(url, init);
    if (["/probe", "/sync", "/changes"].some(p => String(url).includes(p))) {
      const body = await response.json(); delete body.store_id; return Response.json(body);
    }
    return response;
  });
  assert.equal((await f.cores.at(-1).call({ op: "sync_state" })).ok.store_id, null);
  let write;
  assert.doesNotThrow(() => { write = client.mutate(mark, { digit: 1 }); });
  assert.equal(journalEntries(f).length, 0);
  assert.equal((await write).state, "sent");
  assert.equal((await f.audit()).total, 1);
});

test("W5c a reloaded secondary tab recovers its terminal receipt by id", async t => {
  const f = await fixture(t);
  const primary = await f.open(), secondary = await f.open();
  const sent = await secondary.mutate(send, { conversationId: "c1", body: "receipt survives tab store adoption" });
  assert.equal(sent.state, "sent");
  await secondary.sync();
  await secondary.close();
  // Force the surviving tab's adoption to finish before the reload. The
  // receipt is already shared; neither poll timing nor a lookup retry helps.
  await primary.sync();
  const reloaded = await f.open();
  const receipt = await reloaded.write(sent.id);
  assert.equal(receipt?.state, "sent");
  assert.equal(receipt.replayed, true);
  assert.equal("result" in receipt, false);
  assert.equal((await f.rows()).filter(row => row.body === "receipt survives tab store adoption").length, 1);
  await primary.close();
});

// Hold heartbeat replies until close: only the test's explicit sync can adopt.
function quietChanges(url, init) {
  if (!String(url).includes("/changes")) return fetch(url, init);
  return new Promise((_, reject) => {
    const abort = () => reject(new DOMException("closed", "AbortError"));
    if (init.signal.aborted) abort(); else init.signal.addEventListener("abort", abort, { once: true });
  });
}

for (const outcome of ["sent", "failed"]) test(`W11R1a: A adopts B before C opens (${outcome})`, async t => {
  const f = await fixture(t), primary = await f.open(quietChanges), secondary = await f.open(quietChanges);
  const source = [...f.persist.stores.keys()].find(n => n.includes(":tab-"));
  const write = outcome === "sent"
    ? await secondary.mutate(mark, { digit: 1 })
    : await secondary.mutate({ kind: "mutation", name: "media.reject" }, { digit: 2 }, { id: mintId() });
  assert.equal(write.state, outcome);
  await secondary.sync(); await secondary.close();
  await primary.sync();
  assert.ok(!f.persist.stores.has(source), "A must finish deleting B before C opens");
  assert.equal((await primary.write(write.id))?.state, outcome);
  const replacement = await f.open(quietChanges);
  const recovered = await replacement.write(write.id);
  assert.equal(recovered?.state, outcome, "C must see the receipt even though A already adopted B");
  assert.equal("result" in recovered, false);
  if (outcome === "sent") { assert.equal(recovered.replayed, true); assert.equal((await f.audit()).total, 1); }
  else assert.equal(recovered.why.code, "WRONG_DIGIT");
  t.diagnostic(`forced_adoption_before_reopen=1 recovered_${outcome}=1 applications=${outcome === "sent" ? 1 : 0}`);
});

test("W11R1a: lock release after foreground retries recovers without a backend write", async t => {
  const f = await fixture(t), primary = await f.open(quietChanges), secondary = await f.open(quietChanges);
  const source = [...f.persist.stores.keys()].find(n => n.includes(":tab-"));
  const sent = await secondary.mutate(mark, { digit: 1 });
  assert.equal(sent.state, "sent"); await secondary.sync(); await secondary.close();
  const release = deferred(), entered = deferred(), manager = navigator.locks, request = manager.request.bind(manager);
  let misses = 0;
  manager.request = (name, options, body) => request(name, options, lock => { if (name === source && !lock) misses++; return body(lock); });
  const holding = request(source, { ifAvailable: true }, async lock => { assert.ok(lock); entered.resolve(); await release.promise; });
  f.cleanup.push(async () => { release.resolve(); await holding; });
  await entered.promise;
  const replacement = await f.open(quietChanges);
  assert.ok(misses > 0); assert.ok(f.persist.stores.has(source), "a held owner cannot be adopted");
  assert.equal(await replacement.write(sent.id), undefined);
  const foregroundMisses = misses;
  // The foreground open (all eleven attempts on the old implementation) has
  // finished. Release only now; no sync, mutation or change reply follows.
  release.resolve(); await holding;
  assert.ok(await until(() => !f.persist.stores.has(source), 5000), "the busy candidate remains a background responsibility");
  assert.equal((await replacement.write(sent.id))?.state, "sent");
  assert.equal((await f.audit()).total, 1);
  t.diagnostic(`foreground_lock_misses=${foregroundMisses} post_release_backend_writes=0 applications=1`);
});

test("W11R1a: background outbox adoption keeps one sender and never takes a live owner", async t => {
  const f = await fixture(t), sending = deferred(), release = deferred(), posts = [];
  f.cleanup.push(() => release.resolve());
  const transport = async (url, init) => {
    if (String(url).includes("/m/")) { posts.push(JSON.parse(init.body)); sending.resolve(); await release.promise; }
    return quietChanges(url, init);
  };
  const primary = await f.open(transport);
  const secondary = await f.open((url, init) => String(url).includes("/m/") ? Promise.reject(new TypeError("offline")) : quietChanges(url, init));
  const source = [...f.persist.stores.keys()].find(n => n.includes(":tab-"));
  const pending = await secondary.mutate(mark, { digit: 1 });
  assert.equal(pending.state, "pending");
  const replacement = await f.open(transport);
  await primary.sync(); await replacement.sync();
  assert.equal(posts.length, 0); assert.equal(f.durable().length, 1);
  assert.ok((await f.persist.load(source)).some(c => c.s === "o" && c.k === pending.id));
  await secondary.close();
  // No backend change or explicit sync wakes the adopters after the close.
  assert.ok(await until(() => posts.length > 0, 5000)); await sending.promise;
  assert.equal(posts.length, 1); assert.equal(f.durable().length, 1);
  assert.ok(!f.persist.stores.has(source));
  release.resolve();
  assert.ok(await until(async () => (await f.audit())?.total === 1, 5000));
  await primary.sync(); await replacement.sync();
  assert.equal(posts.length, 1); assert.equal((await f.audit()).total, 1);
  t.diagnostic("live_owner_adoptions=0 adopted_outbox_owners=1 posts=1 applications=1");
});

test("W11R1a: shared persistence failure leaves the source recoverable", async t => {
  const f = await fixture(t), primary = await f.open(quietChanges), secondary = await f.open(quietChanges);
  const sent = await secondary.mutate(mark, { digit: 1 });
  assert.equal(sent.state, "sent"); await secondary.sync(); await secondary.close();
  const source = [...f.persist.stores.keys()].find(n => n.includes(":tab-")), save = f.persist.save.bind(f.persist);
  let blocked = true;
  f.persist.save = (name, changes) => name.endsWith(":receipts") && blocked ? Promise.reject(new Error("shared commit failed")) : save(name, changes);
  await primary.sync();
  assert.ok(f.persist.stores.has(source));
  assert.ok((await f.persist.load(source)).some(c => c.k === "client:write-history" && JSON.parse(c.v).some(w => w.id === sent.id)));
  blocked = false;
  assert.ok(await until(() => !f.persist.stores.has(source), 5000));
  const replacement = await f.open(quietChanges);
  assert.equal((await replacement.write(sent.id))?.state, "sent");
  assert.equal((await f.audit()).total, 1);
});

test("W11R1a: the shared window is bounded, immutable and does not refresh on reads", async t => {
  const f = await fixture(t), primary = await f.open(quietChanges), secondary = await f.open(quietChanges);
  const source = f.cores.at(-1), ids = Array.from({ length: 256 }, () => mintId());
  for (const [seq, id] of ids.entries()) await source.call({ op: "keep_write", value: JSON.stringify({ state: "sent", id, seq, replayed: true }) });
  await secondary.close(); await primary.sync();
  const sharedName = [...f.persist.stores.keys()].find(n => n.endsWith(":receipts"));
  const history = async () => JSON.parse((await f.persist.load(sharedName)).find(c => c.k === "client:write-history").v);
  assert.equal((await history()).length, 256);
  const before = await f.persist.load(sharedName);
  assert.equal((await primary.write(ids[0]))?.seq, 0);
  assert.deepEqual(await f.persist.load(sharedName), before);
  const another = await f.open(quietChanges), core = f.cores.at(-1), newest = mintId();
  await core.call({ op: "keep_write", value: JSON.stringify({ state: "failed", id: ids[1], why: { code: "WRONG_DIGIT", family: "input", message: "must not replace" } }) });
  await core.call({ op: "keep_write", value: JSON.stringify({ state: "sent", id: newest, seq: 999, result: "must not be shared" }) });
  await another.close(); await primary.sync();
  assert.equal((await history()).length, 256);
  assert.equal(await primary.write(ids[0]), undefined);
  assert.equal((await primary.write(ids[1]))?.state, "sent");
  assert.equal((await primary.write(ids[1]))?.seq, 1);
  const replacement = await f.open(quietChanges);
  assert.deepEqual(await replacement.write(newest), { state: "sent", id: newest, seq: 999, replayed: true });
  assert.equal((await f.persist.load(sharedName)).length, 1, "one bounded record; no per-id tombstones or outboxes");
  t.diagnostic("shared_receipts=256 inserted_receipts=257 shared_records=1 evicted=1");
});

test("W11R1a: competing adopters serialize shared receipts without holding up an opener", async t => {
  const f = await fixture(t), primary = await f.open(quietChanges), second = await f.open(quietChanges), third = await f.open(quietChanges);
  const a = await second.mutate(mark, { digit: 1 }), b = await third.mutate(mark, { digit: 2 });
  assert.equal(a.state, "sent"); assert.equal(b.state, "sent");
  await second.sync(); await third.sync();
  const entered = deferred(), release = deferred(), save = f.persist.save.bind(f.persist);
  let blocked = false;
  f.cleanup.push(() => release.resolve());
  f.persist.save = async (name, changes) => {
    if (name.endsWith(":receipts") && !blocked) { blocked = true; entered.resolve(); await release.promise; }
    await save(name, changes);
  };
  await Promise.all([second.close(), third.close()]);
  const adopting = primary.sync();
  await entered.promise;
  const replacement = await f.open(quietChanges);
  assert.equal((await f.persist.others(`${storeName(f)}:tab-`)).length, 3, "two sources stay intact while the receipt transaction is busy");
  release.resolve(); await adopting;
  assert.ok(await until(async () => (await replacement.write(a.id))?.state === "sent" && (await replacement.write(b.id))?.state === "sent", 5000));
  assert.equal((await f.audit()).total, 2);
  t.diagnostic("competing_adopters=2 shared_receipts=2 applications=2");
});


test("W6R1 web: two live tabs admit the same new caller ID and apply once", async t => {
  const f = await fixture(t), sends = [];
  let offline = false;
  const transport = (url, init) => {
    if (offline) return Promise.reject(new TypeError("offline"));
    if (String(url).includes("/m/")) sends.push(JSON.parse(init.body));
    return fetch(url, init);
  };
  const first = await f.open(transport), second = await f.open(transport), id = mintId();
  offline = true; await first.sync(); await second.sync();
  const a = first.mutate(mark, { digit: 1 }, { id }), b = second.mutate(mark, { digit: 1 }, { id });
  assert.equal(journalEntries(f).length, 2, "each live owner captures synchronously in its own journal");
  assert.equal((await a).state, "pending"); assert.equal((await b).state, "pending");
  assert.equal(f.durable().length, 2); assert.ok(f.durable().every(e => e.id === id));
  offline = false; await Promise.all([first.sync(), second.sync()]);
  assert.ok(await until(async () => (await first.write(id))?.state === "sent" && (await second.write(id))?.state === "sent", 15000));
  assert.equal((await f.audit()).total, 1); assert.equal((await f.rows()).length, 1);
  assert.deepEqual(await first.write(id), await second.write(id));
  assert.equal(sends.length, 2); assert.ok(sends.every(e => e.id === id));
  t.diagnostic("live_web_tabs=2 journal_records=2 posts=2 applications=1");
});

for (const offlineReopen of [false, true]) test(`W6R1 journal: caller ID stays fenced across replacement (offline reopen=${offlineReopen})`, async t => {
  const f = await fixture(t), client = await f.open(), id = mintId();
  const [record] = await loseAdmission(f, client, mark, [{ digit: 1 }], { id });
  assert.equal(record.entry.id, id);
  if (offlineReopen) {
    const offline = await f.open(() => Promise.reject(new TypeError("offline")));
    assert.equal(f.durable().length, 1); assert.equal(f.durable()[0].id, id);
    assert.equal((await offline.write(id))?.state, "pending", "offline reopen retains visible caller-ID custody");
    await offline.close();
  }
  const sends = [];
  const reopened = await f.open(async (url, init) => {
    if (String(url).includes("/m/")) sends.push(JSON.parse(init.body));
    const response = await fetch(url, init);
    if (["/probe", "/sync", "/changes"].some(p => String(url).includes(p))) {
      const body = await response.json(); if (body.store_id) body.store_id += "-replacement"; return Response.json(body);
    }
    return response;
  });
  await reopened.sync();
  assert.equal(sends.length, 0); assert.equal(f.durable().length, 0); assert.equal(journalEntries(f).length, 0);
  assert.equal(await f.audit(), null);
  t.diagnostic(`caller_id_replacement_posts=0 remaining_journal=0 offline_reopen=${offlineReopen}`);
});


test("W6R1 journal: an evicted guarded caller ID survives failed admission persistence and reopen", async t => {
  const f = await fixture(t), first = await f.open(), id = mintId(), guarded = { kind: "mutation", name: "media.guarded" };
  assert.equal((await first.mutate(mark, { digit: 1 })).state, "sent");
  const original = await first.mutate(guarded, {}, { id }); assert.equal(original.state, "sent");
  assert.equal((await first.mutate({ kind: "mutation", name: "media.closeGate" }, {})).state, "sent");
  for (let n = 0; n < 256; n++) assert.equal((await first.mutate({ kind: "mutation", name: "media.answer" }, { n })).state, "sent");
  assert.equal(await first.write(id), undefined); await first.close();
  const retry = await f.open();
  const [record] = await loseAdmission(f, retry, guarded, [{}], { id });
  assert.equal(record.entry.id, id); assert.equal(record.entry.replay_candidate, true);
  assert.equal(journalEntries(f).length, 1, "the executable replay candidate survives a failed IDB save");
  const posts = []; let offline = true;
  const recovered = await f.open((url, init) => {
    if (offline) return Promise.reject(new TypeError("offline"));
    if (String(url).includes("/m/")) posts.push(JSON.parse(init.body));
    return fetch(url, init);
  });
  assert.equal(f.durable().length, 1); assert.equal(f.durable()[0].id, id);
  assert.equal(f.durable()[0].predictable, false); assert.deepEqual(f.durable()[0].predicted, []);
  offline = false; await recovered.sync();
  assert.ok(await until(async () => (await recovered.write(id))?.state === "sent", 15000));
  assert.deepEqual(await recovered.write(id), { state: "sent", id, seq: original.seq, replayed: true });
  assert.equal(posts.length, 1); assert.equal((await f.rows()).length, 2); assert.equal(await f.audit(), null);
  t.diagnostic("evicting_writes=256 recovered_replay_candidates=1 replay_posts=1 duplicate_rows=0");
});
