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
  { table: "navigationAudit", row: { id: "audit", total: 0, order: 0 } },
];
const extraSource = `
table navigationAudit:
  total: int
  order: int
  public 'navigation model audit'
  update <- allow
  online only

mutation record(body: text <=200, digit: int):
  audit = navigationAudit['audit'] ! else AUDIT_MISSING
  require digit > 0 else BAD_DIGIT
  update navigationAudit[audit] { total: audit.total + 1, order: audit.order * 10 + digit }
  insert messages { conversationId: 'c1', authorId: viewer, body, at: now }

query audit():
  return navigationAudit['audit'] { total, order }
`;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check, ms = 2000) {
  const end = performance.now() + ms;
  do { if (await check()) return true; await new Promise(r => setTimeout(r, 10)); } while (performance.now() < end);
  return false;
}
async function fixture(t, source = extraSource) {
  const window = new EventTarget(), document = new EventTarget();
  document.visibilityState = "visible";
  for (const [key, value] of Object.entries({ window, document })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const server = await devServer({ seed, extraSource: source, port: 47000 + process.pid % 1000 });
  const clients = [], cores = [], cleanup = [], persist = memoryPersistence();
  t.after(async () => { for (const run of cleanup) await run(); for (const client of clients) await client.close(); server.close(); });
  const open = async (transport = fetch) => {
    const opener = webDevice({ wasm, persist });
    const device = { async open(...args) { const core = await opener.open(...args); cores.push(core); return core; } };
    const client = await createLocalClient({ url: server.api, persona: "alice", device, fetch: transport, waitSeconds: 1 });
    clients.push(client); return client;
  };
  const rows = async () => (await fetch(server.api + "/q/thread", { method: "POST", headers: { "x-snapback-persona": "alice" }, body: JSON.stringify({ args: { conversationId: "c1" } }) }).then(r => r.json())).data;
  const durable = () => [...persist.stores.values()].flatMap(s => [...s.values()]).filter(c => c.s === "o").map(c => JSON.parse(c.v)).sort((a, b) => a.seq - b.seq);
  const audit = async () => (await fetch(server.api + "/q/media.audit", { method: "POST", headers: { "x-snapback-persona": "alice" }, body: "{}" }).then(r => r.json())).data;
  return { window, document, server, persist, open, rows, durable, audit, cleanup, cores };
}

for (const count of [1, 2]) for (const duringSave of [false, true]) {
  test(`navigation model: immediate ${count} unawaited writes before admission (${duringSave ? "save pending" : "same turn"})`, async t => {
    const f = await fixture(t), commit = deferred(), entered = deferred(), exits = [];
    let offline = false;
    const client = await f.open((url, init) => {
      if (init?.keepalive) { exits.push({ url, init }); return fetch(url, init); }
      return offline ? Promise.reject(new TypeError("document destroyed")) : fetch(url, init);
    });
    offline = true; await client.sync();
    const save = f.persist.save.bind(f.persist);
    f.persist.save = async (name, changes) => {
      if (changes.some(c => c.s === "o")) { entered.resolve(); await commit.promise; }
      await save(name, changes);
    };
    f.cleanup.push(() => commit.resolve());
    const writes = Array.from({ length: count }, (_, n) => client.mutate({ kind: "mutation", name: "media.record" }, { body: String(n + 1), digit: n + 1 }));
    if (duringSave) await entered.promise;
    const hiddenAt = performance.now();
    if (duringSave) {
      f.document.visibilityState = "hidden"; f.document.dispatchEvent(new Event("visibilitychange"));
    } else f.window.dispatchEvent(new Event("pagehide"));
    assert.equal(f.durable().length, 0);
    assert.equal(exits.length, 1, "navigation must synchronously send before admission can commit");
    assert.ok(await until(async () => (await f.audit()).total === count), "all submitted writes must apply while persistence is held");
    const before = await f.audit(), elapsed = Math.round(performance.now() - hiddenAt);
    const payload = JSON.parse(exits[0].init.body), sent = payload.writes ?? [payload];
    assert.equal(sent.length, count);
    assert.equal(before.order, count === 1 ? 1 : 12);
    const rowIds = (await f.rows()).map(row => row.id).sort();
    assert.deepEqual(rowIds, sent.map(entry => entry.newIds[0]).sort());
    assert.equal(f.durable().length, 0, "server application precedes the held persistence boundary");
    f.window.dispatchEvent(new Event("pageshow"));
    commit.resolve();
    const outcomes = await Promise.all(writes);
    assert.deepEqual(f.durable().map(entry => entry.id), sent.map(entry => entry.id));
    assert.deepEqual(outcomes.map(entry => entry.id), sent.map(entry => entry.id));
    await client.close();
    const reopened = await f.open(); await reopened.sync();
    assert.deepEqual(await f.audit(), before, "the non-idempotent counter and order must not change on replay");
    assert.deepEqual((await f.rows()).map(row => row.id).sort(), rowIds);
    console.log(`immediate navigation: writes=${count}; savePending=${duringSave}; exitRequests=1; durableBefore=0; appliedBeforeAdmission=${before.total}; afterReplay=${(await f.audit()).total}; duplicates=0; bodyBytes=${Buffer.byteLength(exits[0].init.body)}; applicationMs=${elapsed}`);
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

test("navigation model: a durable predecessor blocks pending admissions at exit", async t => {
  const f = await fixture(t), commit = deferred(), exits = [];
  let offline = false;
  const client = await f.open((url, init) => {
    if (init?.keepalive) { exits.push(JSON.parse(init.body)); return fetch(url, init); }
    return offline ? Promise.reject(new TypeError("offline")) : fetch(url, init);
  });
  offline = true; await client.sync();
  const first = await client.mutate({ kind: "mutation", name: "media.record" }, { body: "1", digit: 1 });
  const save = f.persist.save.bind(f.persist);
  f.persist.save = async (name, changes) => {
    if (changes.some(c => c.s === "o")) await commit.promise;
    await save(name, changes);
  };
  f.cleanup.push(() => commit.resolve());
  const second = client.mutate({ kind: "mutation", name: "media.record" }, { body: "2", digit: 2 });
  f.window.dispatchEvent(new Event("pagehide"));
  assert.equal(exits.length, 1); assert.equal(exits[0].id, first.id);
  assert.equal(exits[0].writes, undefined);
  assert.ok(await until(async () => (await f.audit()).total === 1));
  f.window.dispatchEvent(new Event("pageshow")); commit.resolve(); await second;
  await client.close(); const reopened = await f.open(); await reopened.sync();
  assert.deepEqual(await f.audit(), { total: 2, order: 12 });
});

test("navigation model: submission captures arguments before the caller changes them", async t => {
  const f = await fixture(t), commit = deferred(), exits = [];
  let offline = false;
  const client = await f.open((url, init) => {
    if (init?.keepalive) { exits.push(JSON.parse(init.body)); return fetch(url, init); }
    return offline ? Promise.reject(new TypeError("offline")) : fetch(url, init);
  });
  offline = true; await client.sync();
  const save = f.persist.save.bind(f.persist);
  f.persist.save = async (name, changes) => { if (changes.some(c => c.s === "o")) await commit.promise; await save(name, changes); };
  f.cleanup.push(() => commit.resolve());
  const args = { body: "original", digit: 1 };
  const write = client.mutate({ kind: "mutation", name: "media.record" }, args);
  args.body = "changed"; args.digit = 2;
  f.window.dispatchEvent(new Event("pagehide"));
  assert.deepEqual(exits[0].args, { body: "original", digit: 1 });
  assert.ok(await until(async () => (await f.audit()).total === 1));
  f.window.dispatchEvent(new Event("pageshow")); commit.resolve(); await write;
  await client.close(); const reopened = await f.open(); await reopened.sync();
  assert.deepEqual(await f.audit(), { total: 1, order: 1 });
  assert.equal((await f.rows())[0].body, "original");
});

for (const committed of [false, true]) test(`navigation model: dropped keepalive with admission ${committed ? "committed" : "lost"}`, async t => {
  const f = await fixture(t), commit = deferred();
  let offline = false, exits = 0;
  const client = await f.open((url, init) => {
    if (init?.keepalive) { exits++; return Promise.reject(new TypeError("browser dropped keepalive")); }
    return offline ? Promise.reject(new TypeError("document destroyed")) : fetch(url, init);
  });
  offline = true; await client.sync();
  const save = f.persist.save.bind(f.persist);
  f.persist.save = async (name, changes) => {
    if (changes.some(c => c.s === "o")) { await commit.promise; if (!committed) throw new Error("admission aborted on unload"); }
    await save(name, changes);
  };
  f.cleanup.push(() => commit.resolve());
  const writes = [1, 2].map(digit => client.mutate({ kind: "mutation", name: "media.record" }, { body: String(digit), digit }));
  f.window.dispatchEvent(new Event("pagehide"));
  assert.equal(exits, 1); assert.equal(f.durable().length, 0);
  f.window.dispatchEvent(new Event("pageshow")); commit.resolve();
  const outcomes = await Promise.all(writes);
  assert.ok(outcomes.every(w => w.state === (committed ? "pending" : "failed")));
  await client.close();
  // This loss control destroys the document; close/reopen within the same
  // surviving page must instead retain failed admissions' exit obligations.
  Object.defineProperty(globalThis, "document", { configurable: true, value: new EventTarget() });
  const reopened = await f.open(); await reopened.sync();
  assert.deepEqual(await f.audit(), committed ? { total: 2, order: 12 } : { total: 0, order: 0 });
  console.log(`dropped keepalive: admissionCommitted=${committed}; writes=2; exitRequests=${exits}; afterReopen=${(await f.audit()).total}`);
});

test("navigation model: admission finishing after pagehide keeps the exit mutation id", async t => {
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
  assert.equal(exits.length, 1, "the pending admission is sent synchronously");
  assert.equal(f.durable().length, 0);
  commit.resolve();
  const outcome = await write;
  const received = await until(async () => (await f.rows()).length === 1);
  console.log(`navigation model late commit: exitRequests=${exits.length}; rows=${(await f.rows()).length}; state=${outcome.state}`);
  assert.ok(received, "a completed admission must recheck the suspended page");
  assert.ok(exits.every(e => e.id === outcome.id), "a post-commit retry keeps the submitted id");
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

for (const refusal of ["retryable", "unrecorded"]) for (const reopen of [false, true]) test(`navigation model: unresolved exposure blocks ordinary and repeated exit successors (${refusal}, reopen=${reopen})`, async t => {
  const f = await fixture(t), admission = deferred(), entered = deferred(), settlements = [], ordinary = [], exits = [];
  let offline = false, allowReplay = false;
  const transport = (url, init) => {
    if (init?.keepalive) { exits.push(JSON.parse(init.body)); return Promise.reject(new TypeError("keepalive dropped")); }
    if (offline) return Promise.reject(new TypeError("offline"));
    if (String(url).includes("/m/")) {
      const entry = JSON.parse(init.body); ordinary.push(entry);
      if (!allowReplay && entry.args.digit === 1) return Promise.resolve(Response.json({ state: "failed", id: entry.id, why: refusal === "retryable"
        ? { code: "E_STORE", family: "store", message: "try later", retryable: true }
        : { code: "E_INPUT", family: "input", message: "argument refused before a receipt was recorded" } }));
    }
    return fetch(url, init);
  };
  let client = await f.open(transport);
  offline = true; await client.sync();
  client.onWrite(write => settlements.push(write));
  const save = f.persist.save.bind(f.persist);
  let abort = true;
  f.persist.save = async (name, changes) => {
    if (abort && changes.some(c => c.s === "o")) { abort = false; entered.resolve(); await admission.promise; throw new Error("admission transaction aborted"); }
    await save(name, changes);
  };
  f.cleanup.push(() => admission.resolve());
  const write = client.mutate({ kind: "mutation", name: "media.record" }, { body: "1", digit: 1 });
  await entered.promise; f.window.dispatchEvent(new Event("pagehide"));
  f.window.dispatchEvent(new Event("pageshow")); admission.resolve();
  const first = await write;
  assert.equal(first.state, "failed");
  const second = await client.mutate({ kind: "mutation", name: "media.record" }, { body: "2", digit: 2 });
  if (reopen) { await client.close(); client = await f.open(transport); client.onWrite(write => settlements.push(write)); }
  offline = false; await client.sync();
  assert.ok(await until(() => ordinary.length > 0));
  f.window.dispatchEvent(new Event("pagehide")); await tick();
  f.window.dispatchEvent(new Event("pageshow"));
  const held = { ordinary: ordinary.map(w => w.id), exits: exits.map(w => w.id), audit: await f.audit() };
  allowReplay = true;
  assert.ok(await until(() => settlements.some(w => w.id === second.id && w.state === "sent"), 5000));
  assert.ok(held.ordinary.every(id => id === first.id), "an unresolved receipt must hold every ordinary successor");
  assert.deepEqual(held.exits, [first.id, first.id], "a repeated exit must retry the exposed predecessor, even after close/reopen");
  assert.deepEqual(held.audit, { total: 0, order: 0 });
  assert.deepEqual(await f.audit(), { total: 2, order: 12 });
  assert.deepEqual(settlements.filter(w => w.state === "sent").map(w => w.id), [first.id, second.id]);
});

for (const abortAdmission of [false, true]) test(`navigation model: inability to retain an exit obligation refuses successors (admission abort=${abortAdmission})`, async t => {
  const f = await fixture(t), admission = deferred(), entered = deferred(), settlements = [], exits = [], ordinary = [];
  let offline = false;
  const client = await f.open((url, init) => {
    if (init?.keepalive) { exits.push(JSON.parse(init.body)); return fetch(url, init); }
    if (offline) return Promise.reject(new TypeError("offline"));
    if (String(url).includes("/m/")) ordinary.push(JSON.parse(init.body));
    return fetch(url, init);
  });
  offline = true; await client.sync(); client.onWrite(write => settlements.push(write));
  const core = f.cores[0];
  // Model a host that cannot retain the fallback record; the base ignores
  // this state entirely and dispatches the write, making the control red.
  core.exitState ??= { pending: new Map(), blocked: false };
  core.exitState.pending.set = () => { throw new Error("cannot retain exit record"); };
  const save = f.persist.save.bind(f.persist);
  f.persist.save = async (name, changes) => {
    if (changes.some(c => c.s === "o")) { entered.resolve(); await admission.promise; if (abortAdmission) throw new Error("admission transaction aborted"); }
    await save(name, changes);
  };
  f.cleanup.push(() => admission.resolve());
  const write = client.mutate({ kind: "mutation", name: "media.record" }, { body: "1", digit: 1 });
  await entered.promise; f.window.dispatchEvent(new Event("pagehide"));
  f.window.dispatchEvent(new Event("pageshow")); admission.resolve();
  const first = await write;
  const second = await client.mutate({ kind: "mutation", name: "media.record" }, { body: "2", digit: 2 });
  offline = false; await client.sync(); await tick();
  assert.equal(first.state, "failed"); assert.equal(first.why.code, "E_EXIT_ORDER");
  assert.equal(second.state, "failed"); assert.equal(second.why.code, "E_EXIT_ORDER");
  assert.equal(exits.length, 0); assert.equal(ordinary.length, 0);
  assert.deepEqual(await f.audit(), { total: 0, order: 0 });
  assert.ok(settlements.some(w => w.id === first.id && w.why?.code === "E_EXIT_ORDER"));
});

test("navigation model: a recorded terminal refusal releases an exposed predecessor", async t => {
  const f = await fixture(t), admission = deferred(), entered = deferred(), delivery = deferred(), settlements = [], ordinary = [];
  let offline = false, exitWork, exitReceipt;
  const client = await f.open((url, init) => {
    if (init?.keepalive) { exitWork = delivery.promise.then(() => fetch(url, init)).then(response => { exitReceipt = response.clone(); return response; }); return exitWork; }
    if (offline) return Promise.reject(new TypeError("offline"));
    if (String(url).includes("/m/")) ordinary.push(JSON.parse(init.body));
    return fetch(url, init);
  });
  offline = true; await client.sync(); client.onWrite(write => settlements.push(write));
  const save = f.persist.save.bind(f.persist);
  let abort = true;
  f.persist.save = async (name, changes) => {
    if (abort && changes.some(c => c.s === "o")) { abort = false; entered.resolve(); await admission.promise; throw new Error("admission transaction aborted"); }
    await save(name, changes);
  };
  f.cleanup.push(async () => { admission.resolve(); delivery.resolve(); await exitWork; });
  const write = client.mutate({ kind: "mutation", name: "media.record" }, { body: "refused", digit: 0 });
  await entered.promise; f.window.dispatchEvent(new Event("pagehide"));
  f.window.dispatchEvent(new Event("pageshow")); admission.resolve();
  const first = await write;
  const second = await client.mutate({ kind: "mutation", name: "media.record" }, { body: "2", digit: 2 });
  offline = false; await client.sync();
  assert.ok(await until(() => settlements.some(w => w.id === second.id && w.state === "sent"), 5000));
  delivery.resolve();
  await exitWork;
  const receipt = await exitReceipt.json();
  assert.equal(receipt.state, "failed"); assert.equal(receipt.why.code, "BAD_DIGIT"); assert.equal(receipt.replayed, true);
  assert.deepEqual(ordinary.map(w => w.id), [first.id, first.id, second.id], "confirm that the refusal is recorded before sending B");
  assert.equal(first.why.code, "E_EXIT_ADMISSION");
  assert.deepEqual(settlements.map(w => w.state === "failed" ? w.why.code : w.state), ["E_EXIT_ADMISSION", "BAD_DIGIT", "sent"]);
  assert.deepEqual(await f.audit(), { total: 1, order: 2 });
});

for (const delivery of ["delivered", "dropped", "delayed"]) for (const count of [1, 2]) {
  test(`navigation model: failed admission retains ${count} exit-exposed predecessors (${delivery})`, async t => {
    const f = await fixture(t), admission = deferred(), entered = deferred(), deliveryGate = deferred();
    const exits = [], ordinary = [], settlements = [];
    let offline = false, exitWork;
    const client = await f.open((url, init) => {
      if (init?.keepalive) {
        exits.push({ url, init });
        exitWork = (async () => {
          if (delivery === "dropped") throw new TypeError("keepalive dropped");
          if (delivery === "delayed") await deliveryGate.promise;
          return fetch(url, init);
        })();
        return exitWork;
      }
      if (offline) return Promise.reject(new TypeError("offline"));
      if (String(url).includes("/m/")) ordinary.push(JSON.parse(init.body));
      return fetch(url, init);
    });
    offline = true; await client.sync();
    client.onWrite(write => settlements.push(write));
    const save = f.persist.save.bind(f.persist);
    let aborts = count;
    f.persist.save = async (name, changes) => {
      if (aborts && changes.some(c => c.s === "o" && c.v !== null)) {
        aborts--; entered.resolve(); await admission.promise;
        throw new Error("admission transaction aborted");
      }
      await save(name, changes);
    };
    f.cleanup.push(async () => { admission.resolve(); deliveryGate.resolve(); try { await exitWork; } catch {} });
    const writes = Array.from({ length: count }, (_, n) => client.mutate({ kind: "mutation", name: "media.record" }, { body: String(n + 1), digit: n + 1 }));
    await entered.promise;
    f.document.visibilityState = "hidden"; f.document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(exits.length, 1); assert.equal(f.durable().length, 0);
    if (delivery === "delivered") assert.ok(await until(async () => (await f.audit()).total === count));
    f.window.dispatchEvent(new Event("pageshow")); admission.resolve();
    const failed = await Promise.all(writes);
    assert.ok(failed.every(w => w.state === "failed"));
    assert.equal(f.durable().length, 0, "aborted admissions have no durable outbox entries");
    const successor = await client.mutate({ kind: "mutation", name: "media.record" }, { body: String(count + 1), digit: count + 1 });
    assert.equal(successor.state, "pending");
    assert.deepEqual(f.durable().map(e => e.id), [successor.id]);
    const resumedAt = performance.now();
    offline = false; await client.sync();
    assert.ok(await until(() => settlements.some(w => w.id === successor.id && w.state === "sent"), 5000), "the recovered page must eventually send its successor");
    const replayMs = Math.round(performance.now() - resumedAt);
    // Deliver the original request only after ordinary flushing reached B.
    deliveryGate.resolve();
    try { await (await exitWork).arrayBuffer(); } catch {}
    const audit = await f.audit(), sent = settlements.filter(w => w.state === "sent");
    console.log(`failed admission: delivery=${delivery}; predecessors=${count}; order=${audit.order}; applications=${audit.total}; ordinaryIds=${ordinary.length}; sentSettlements=${sent.length}; recoveryMs=${replayMs}`);
    assert.deepEqual(audit, { total: count + 1, order: count === 1 ? 12 : 123 });
    assert.deepEqual(ordinary.map(w => w.id), [...failed.map(w => w.id), successor.id], "every exposed predecessor is replayed before B with its original id");
    const payload = JSON.parse(exits[0].init.body), exposed = payload.writes ?? [payload];
    assert.deepEqual(ordinary.slice(0, count).map(({ id, args, newIds }) => ({ id, args, newIds })), exposed.map(({ id, args, newIds }) => ({ id, args, newIds })));
    assert.deepEqual(sent.map(w => w.id), [...failed.map(w => w.id), successor.id], "an admission failure must later settle through onWrite");
    assert.ok(failed.every(w => w.why.code === "E_EXIT_ADMISSION" && w.why.retryable === true));
    for (const write of failed) assert.ok(settlements.indexOf(write) < settlements.findIndex(w => w.id === write.id && w.state === "sent"));
  });
}

for (const failAfterCommit of [false, true]) test(`navigation model: confirmed exposed replay settles despite apply persistence failure (afterCommit=${failAfterCommit})`, async t => {
  const f = await fixture(t), admission = deferred(), entered = deferred(), settlements = [], replies = [];
  let offline = false, confirmed = false, applyFailures = 0;
  const client = await f.open(async (url, init) => {
    if (!init?.keepalive && offline) throw new TypeError("offline");
    const response = await fetch(url, init);
    if (!init?.keepalive && String(url).includes("/m/")) {
      const reply = await response.clone().json(); replies.push(reply);
      confirmed = reply.state === "sent" && reply.replayed === true;
    }
    return response;
  });
  offline = true; await client.sync(); client.onWrite(write => settlements.push(write));
  const save = f.persist.save.bind(f.persist);
  let abort = true;
  f.persist.save = async (name, changes) => {
    if (abort && changes.some(c => c.s === "o")) { abort = false; entered.resolve(); await admission.promise; throw new Error("admission transaction aborted"); }
    await save(name, changes);
  };
  f.cleanup.push(() => admission.resolve());
  // Arm only an actual apply call after the authoritative replay, so a
  // preceding reconnect sync or begin_send cannot consume the injected fault.
  const core = f.cores[0], call = core.call.bind(core);
  let applying = false;
  core.call = async request => {
    applying = request.op === "apply" && confirmed;
    try { return await call(request); } finally { applying = false; }
  };
  const admissionSave = f.persist.save;
  f.persist.save = async (name, changes) => {
    if (applying && applyFailures === 0 && changes.length) {
      applyFailures++;
      if (failAfterCommit) await save(name, changes);
      throw new Error("apply persistence failed after confirmed replay");
    }
    await admissionSave(name, changes);
  };
  const write = client.mutate({ kind: "mutation", name: "media.record" }, { body: "1", digit: 1 });
  await entered.promise; f.window.dispatchEvent(new Event("pagehide"));
  assert.ok(await until(async () => (await f.audit()).total === 1));
  f.window.dispatchEvent(new Event("pageshow")); admission.resolve();
  const first = await write;
  assert.equal(first.why.code, "E_EXIT_ADMISSION"); assert.equal(f.durable().length, 0);
  offline = false; await client.sync().catch(() => {});
  assert.ok(await until(() => applyFailures === 1), "the post-confirmation apply must hit persistence");
  assert.ok(await until(() => settlements.some(w => w.id === first.id && w.state === "sent")), "a confirmed replay must notify even when the following apply fails");
  await client.sync(); await client.sync();
  const sent = settlements.filter(w => w.id === first.id && w.state === "sent");
  assert.equal(sent.length, 1); assert.equal(sent[0].replayed, true);
  assert.equal(replies.length, 1); assert.equal(core.exitState.pending.size, 0);
  assert.deepEqual(await f.audit(), { total: 1, order: 1 });
  console.log(`confirmed replay: afterCommit=${failAfterCommit}; applyFailures=${applyFailures}; failedCallers=1; sentSettlements=${sent.length}; applications=1; duplicates=0`);
});

for (const refusal of ["removed", "narrowed"]) test(`navigation model: permanent ${refusal} operation refusal settles and releases successor`, async t => {
  const source = refusal === "removed" ? extraSource.replace("mutation record(", "mutation replacement(") : extraSource.replace("body: text <=200", "body: text <=1");
  const f = await fixture(t, source), admission = deferred(), entered = deferred(), delivery = deferred(), settlements = [], ordinary = [], replies = [];
  let offline = false, exitWork, exitReceipt;
  const client = await f.open(async (url, init) => {
    if (init?.keepalive) { exitWork = delivery.promise.then(() => fetch(url, init)).then(response => { exitReceipt = response.clone(); return response; }); return exitWork; }
    if (offline) throw new TypeError("offline");
    const response = await fetch(url, init);
    if (String(url).endsWith("/schema")) {
      // Model an already loaded client catalog while the server has removed
      // its operation or narrowed its input. Mutation refusals are real HTTP.
      const backend = await response.json();
      const program = backend.programs.find(p => p.name === (refusal === "removed" ? "media.replacement" : "media.record"));
      const old = structuredClone(program); old.name = "media.record"; old.args.body.Text.max = 200;
      if (refusal === "removed") backend.programs.push(old); else Object.assign(program, old);
      return Response.json(backend);
    }
    if (String(url).includes("/m/")) { ordinary.push(JSON.parse(init.body)); replies.push(await response.clone().json()); }
    return response;
  });
  offline = true; await client.sync(); client.onWrite(write => settlements.push(write));
  const save = f.persist.save.bind(f.persist);
  let abort = true;
  f.persist.save = async (name, changes) => {
    if (abort && changes.some(c => c.s === "o")) { abort = false; entered.resolve(); await admission.promise; throw new Error("admission transaction aborted"); }
    await save(name, changes);
  };
  f.cleanup.push(async () => { admission.resolve(); delivery.resolve(); await exitWork; });
  const write = client.mutate({ kind: "mutation", name: "media.record" }, { body: "old body", digit: 1 });
  await entered.promise; f.window.dispatchEvent(new Event("pagehide"));
  f.window.dispatchEvent(new Event("pageshow")); admission.resolve();
  const first = await write;
  assert.equal(first.why.code, "E_EXIT_ADMISSION");
  const second = await client.mutate({ kind: "mutation", name: refusal === "removed" ? "media.replacement" : "media.record" }, { body: "2", digit: 2 });
  offline = false; await client.sync();
  assert.ok(await until(() => settlements.some(w => w.id === second.id && w.state === "sent"), 5000), "a permanent refusal must release the ordered successor");
  delivery.resolve(); await exitWork;
  const delayed = await exitReceipt.json(), code = refusal === "removed" ? "E_OP" : "E_INPUT";
  assert.equal(delayed.state, "failed"); assert.equal(delayed.why.code, code); assert.equal(delayed.replayed, true);
  assert.equal(replies[0].state, "failed"); assert.equal(replies[1].replayed, true);
  assert.deepEqual(ordinary.map(w => w.id), [first.id, first.id, second.id]);
  assert.deepEqual(settlements.map(w => w.state === "failed" ? w.why.code : w.state), ["E_EXIT_ADMISSION", code, "sent"]);
  await client.sync();
  assert.equal(settlements.filter(w => w.id === first.id && w.why?.code === code).length, 1);
  assert.deepEqual(await f.audit(), { total: 1, order: 2 });
  console.log(`permanent refusal: kind=${refusal}; terminalFailures=1; successorSent=1; ordinarySends=${ordinary.length}; order=2; delayedReplay=true; duplicates=0`);
});
