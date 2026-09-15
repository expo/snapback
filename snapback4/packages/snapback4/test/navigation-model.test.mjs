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

mutation payload(body: text <=100000):
  insert messages { conversationId: 'c1', authorId: viewer, body: 'payload', at: now }

query audit():
  return audit['audit']
` });
  const clients = [], cleanup = [], persist = memoryPersistence();
  t.after(async () => { for (const run of cleanup) await run(); for (const client of clients) await client.close(); server.close(); });
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

async function loseAdmission(f, client, op, args) {
  const gate = deferred(), entered = deferred(), save = f.persist.save.bind(f.persist);
  f.persist.save = async (name, changes) => {
    if (changes.some(c => c.s === "o")) { entered.resolve(); await gate.promise; throw new Error("document destroyed before IDB commit"); }
    await save(name, changes);
  };
  const writes = args.map(a => client.mutate(op, a));
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
  const held = new Set(), previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { async request(name, _options, body) {
    if (held.has(name)) return body(null);
    held.add(name);
    try { return await body({ name }); } finally { held.delete(name); }
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
