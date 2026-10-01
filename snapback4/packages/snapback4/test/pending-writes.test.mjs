import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, mintId } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";
import { memorySessionStore } from "../dist/auth.js";
import { onlineCustody } from "../dist/app-online.js";
import { prepareClient } from "../dist/client-start.js";
import { guardClient } from "../dist/app-client.js";
import { ownDispatch } from "../dist/online-dispatch.js";

const binary = process.env.SNAPBACK4_BIN ?? new URL("../../../target/debug/snapback4", import.meta.url).pathname;
const wasm = readFileSync(new URL("../src/wasm/snapback4_device_bg.wasm", import.meta.url));
const op = name => ({ kind: "mutation", name });
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) { return awaitState(check, message); }
const source = `use personas alice, bob
table records:
  n: int
  public 'pending-write witness'
  insert <- allow
  sync public
table remote:
  n: int
  public 'unpredicted-write witness'
  insert <- allow
  online only
mutation record(n: int):
  return insert records { n }
mutation remote(n: int):
  return insert remote { n }
query records():
  return records[] first 100 by byId
`;

async function fixture(t, tier) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-pending-list-"));
  mkdirSync(join(dir, "snapback")); writeFileSync(join(dir, "snapback/schema.q"), source);
  const server = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(server, "exit"); let log = "", url;
  for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => { log += chunk; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  const clients = [], gates = [], posts = [], errors = [], sessions = memorySessionStore();
  let gateWrites = true;
  t.after(async () => {
    for (const client of clients) await client.close();
    for (const gate of gates) gate.resolve(Response.json({}));
    server.kill(); await exited; rmSync(dir, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  await until(() => { if (server.exitCode != null) throw Error(log); return url; }, "server startup");
  const persist = memoryPersistence();
  const opener = tier === "process" ? processDevice({ dir: join(dir, "devices"), binary }) : webDevice({ wasm, persist });
  const cores = [], device = { async open(...args) { const core = await opener.open(...args); cores.push(core); return core; } };
  const transport = async (input, init) => {
    if (!new URL(input).pathname.startsWith("/m/")) return fetch(input, init);
    const body = JSON.parse(init.body); posts.push(body);
    if (!gateWrites) return fetch(input, init);
    const gate = deferred(); gates.push({ ...gate, id: body.id }); return gate.promise;
  };
  const open = async (prepared = false, persona = "alice") => {
    const options = { url, persona, fetch: transport, waitSeconds: 1, device };
    const local = tier === "process" || tier === "wasm";
    const opening = await prepareClient(options, () => local ? createLocalClient(options) : createClient(options));
    let client = opening.client, start = opening.start;
    if (tier === "app-online") {
      const custody = await onlineCustody(client, url, sessions, error => errors.push(error), false);
      client = custody.client;
      start = async () => { await opening.start(); custody.start(); };
    }
    clients.push(client);
    if (!prepared) { await start(); if (local) await client.sync(); }
    return { client, start };
  };
  return { open, posts, gates, cores, persist, pass() { gateWrites = false; },
    rows: () => fetch(url + "/q/records", { method: "POST", headers: { "x-snapback-persona": "alice" }, body: '{"args":{}}' }).then(r => r.json()).then(r => r.data),
  };
}

for (const failure of ["save throws", "device refuses"]) for (const supersede of ["dispatch", "hold", "settlement", "signOut", "close", "adoption"]) {
  test(`wasm: local unsaved hold survives ${failure} until ${supersede}`, async t => {
    const f = await fixture(t, "wasm"), { client } = await f.open();
    const write = await client.mutate(op("record"), { n: 1 }, { waitSeconds: 0 });
    await until(() => f.gates.length === 1, "first POST did not start");
    const core = f.cores[0], call = core.call.bind(core), save = f.persist.save.bind(f.persist);
    let failedSaves = 0, blockedRetries = 0;
    // Keep later retries from changing the status while storage is unavailable.
    t.mock.method(core, "call", (request, ...args) => {
      if (request.op === "begin_send") { blockedRetries++; return Promise.resolve({ denied: { code: "E_STORE", message: "retry save unavailable" } }); }
      if (request.op === "hold_write" && failure === "device refuses") {
        failedSaves++;
        return Promise.resolve({ denied: { code: "E_STORE", message: "status refused" } });
      }
      return call(request, ...args);
    });
    f.persist.save = async (name, changes) => {
      if (failure === "save throws" && changes.some(c => c.s === "o" && c.v && JSON.parse(c.v).dispatch === "E_BUSY")) {
        failedSaves++; throw Error("status save unavailable");
      }
      await save(name, changes);
    };
    const observed = [];
    client.onPendingWrites(() => { void client.pendingWrites().then(list => observed.push(list)); });
    f.gates[0].resolve(Response.json({ denied: { code: "E_BUSY", family: "store", message: "retry later", retryable: true } }, { status: 409 }));
    await until(() => observed.some(list => list[0]?.state === "held" && list[0].reason === "E_BUSY"), "the failed save must notify a live held/E_BUSY list");
    assert.equal(failedSaves, 1);
    assert.equal(f.posts.length, 1);
    assert.equal((await call({ op: "queued" })).ok[0].dispatch, "", "the real device reopened its persisted sent row after the failed save");
    assert.deepEqual((await client.pendingWrites()).map(w => [w.id, w.state, w.reason]), [[write.id, "held", "E_BUSY"]]);
    assert.equal((await client.write(write.id)).state, "pending");
    f.persist.save = save;
    if (supersede === "dispatch") {
      await until(() => blockedRetries > 0, "retry never reached the failed send save");
      assert.equal((await client.pendingWrites())[0].reason, "E_BUSY", "failed retries retain the observed hold");
      await call({ op: "begin_send", id: write.id });
      assert.equal((await client.pendingWrites())[0].state, "sent", "a newer send revision supersedes the fallback even with unchanged persisted dispatch text");
    } else if (supersede === "hold") {
      await call({ op: "hold_write", id: write.id, reason: "E_RATE" });
      assert.equal((await client.pendingWrites())[0].reason, "E_RATE");
    } else if (supersede === "settlement") {
      await call({ op: "settle", id: write.id });
      assert.deepEqual(await client.pendingWrites(), []);
    } else if (supersede === "adoption") {
      const backend = (await call({ op: "backend" })).ok;
      backend.generation++;
      await call({ op: "adopt", backend });
      await client.sync();
      assert.ok(!(await client.pendingWrites()).some(w => w.reason === "E_BUSY"));
    } else {
      await client[supersede]();
      assert.deepEqual(await client.pendingWrites(), []);
    }
    assert.equal(f.posts.length, 1, "status presentation never sends an extra POST");
  });
}

for (const tier of ["online", "wasm", "process"]) for (const end of ["signOut", "close"]) {
  test(`${tier}: dispatch subscriber ${end} prevents the POST`, async t => {
    const f = await fixture(t, tier), { client } = await f.open();
    f.pass(); // An accidental POST would reach the real server.
    let dispatching = false, ending, notices = 0;
    if (tier === "online") ownDispatch(client, { observe() {}, async before() { dispatching = true; } });
    else {
      const core = f.cores[0], call = core.call.bind(core);
      t.mock.method(core, "call", async (...args) => {
        const reply = await call(...args);
        if (args[0].op === "begin_send" && !reply.denied) dispatching = true;
        return reply;
      });
    }
    const stop = client.onPendingWrites(() => {
      if (!dispatching) return;
      notices++; stop(); ending = client[end]();
    });
    const result = await client.mutate(op("record"), { n: 1 }, { waitSeconds: 0 });
    await until(() => !!ending, "dispatch subscriber never ended the client");
    await ending;
    assert.equal(notices, 1);
    assert.equal(result.state, "pending", "dispatch shutdown preserves admitted custody");
    if (end === "signOut") assert.equal(client.viewer(), null);
    assert.deepEqual(f.posts, [], "no POST starts after the dispatch callback ends the client");
    assert.deepEqual(await f.rows(), [], "the server must not execute the cancelled dispatch");
  });
}

for (const tier of ["online", "app-online", "wasm", "process"]) for (const status of [409, 503]) {
  test(`${tier} HTTP ${status}: pending list keeps FIFO, args, prediction names, held state and terminal notifications`, { timeout: hangBudget(24) }, async t => {
    const f = await fixture(t, tier), { client } = await f.open();
    // Deliberately submit in the opposite order from the ids' lexical order.
    const secondId = mintId(), firstId = mintId(), events = [], changed = [];
    client.onWrite(write => events.push(write));
    client.onPendingWrites(() => changed.push(true));
    const first = client.mutate(op("record"), { n: 1 }, { id: firstId });
    await until(() => f.gates.length === 1, "first write was not dispatched");
    const input = { n: 2 };
    const second = client.mutate(op("remote"), input, { id: secondId });
    input.n = 999;
    const list = await until(async () => { const list = await client.pendingWrites(); return list.length === 2 && list; }, "second write was not listed");
    assert.deepEqual(list.map(w => [w.id, w.op, w.args, w.state]), [
      [firstId, "record", { n: 1 }, "sent"], [secondId, "remote", { n: 2 }, "queued"],
    ]);
    assert.deepEqual(list[1].predicted, []);
    if (tier === "wasm" || tier === "process") {
      assert.equal(list[0].predicted.length, 1); assert.match(list[0].predicted[0], /^records\//);
      assert.match(list[1].reason, /queued without a row/);
    } else assert.deepEqual(list[0].predicted, []);
    // Mutating returned JSON cannot rewrite admitted intent or later snapshots.
    list[1].args.n = 123; list[0].predicted.push("fake/row");
    const untouched = await client.pendingWrites();
    assert.equal(untouched[1].args.n, 2); assert.ok(!untouched[0].predicted.includes("fake/row"));
    f.gates[0].resolve(Response.json({ denied: { code: "E_BUSY", family: "store", message: "retry later", retryable: true } }, { status }));
    await until(async () => (await client.pendingWrites())[0]?.state === "held", "retryable refusal did not hold the head");
    assert.equal((await client.pendingWrites())[0].reason, "E_BUSY");
    assert.equal(events.length, 0, "a hold is not terminal settlement");
    assert.equal(f.posts.length, 1, "a held head must not be bypassed");
    await until(() => f.gates.length === 2, "held head was not retried");
    assert.equal(f.gates[1].id, firstId);
    assert.equal((await client.pendingWrites())[0].state, "sent");
    assert.notEqual((await client.pendingWrites())[0].reason, "E_BUSY");
    f.gates[1].resolve(Response.json({ state: "sent", seq: 0, result: null }));
    await until(() => f.gates.length === 3, "success did not release the next write");
    assert.equal(f.gates[2].id, secondId);
    assert.deepEqual((await client.pendingWrites()).map(w => w.id), [secondId]);
    assert.equal((await client.pendingWrites())[0].state, "sent");
    assert.equal(Object.hasOwn((await client.pendingWrites())[0], "reason"), false, "a dispatched online-only write has no queued prediction reason");
    f.gates[2].resolve(Response.json({ state: "failed", why: { code: "E_INPUT", family: "input", message: "invalid" } }));
    await Promise.all([first, second]);
    await until(async () => !(await client.pendingWrites()).length, "settlement did not empty the list");
    await until(() => events.length === 2, "missing terminal notifications");
    assert.deepEqual(events.map(w => [w.id, w.state]), [[firstId, "sent"], [secondId, "failed"]]);
    assert.equal((await client.write(firstId)).state, "sent");
    assert.equal((await client.write(secondId)).state, "failed");
    assert.ok(changed.length >= 4);
    await client.close(); assert.deepEqual(await client.pendingWrites(), []);
  });
}

for (const tier of ["online", "app-online", "wasm", "process"]) {
  test(`${tier}: custody waits and dropped connections preserve sent until settlement`, { timeout: hangBudget(19) }, async t => {
    const f = await fixture(t, tier), { client } = await f.open();
    const firstId = mintId(), secondId = mintId(), events = [];
    client.onWrite(write => events.push(write));
    const admitted = await client.mutate(op("remote"), { n: 1 }, { id: firstId, waitSeconds: 0 });
    assert.equal(admitted.state, "pending");
    assert.equal((await client.pendingWrites())[0].id, firstId, "custody return has a listed owner");
    await until(() => f.gates.length === 1, "first dispatch");
    const second = await client.mutate(op("remote"), { n: 2 }, { id: secondId, waitSeconds: 0.01 });
    assert.equal(second.state, "pending");
    assert.deepEqual((await client.pendingWrites()).map(w => [w.id, w.state]), [[firstId, "sent"], [secondId, "queued"]]);
    f.gates[0].reject(new TypeError("connection dropped before any HTTP reply"));
    await until(() => client.link() === "offline", "transport failure was not consumed");
    assert.deepEqual((await client.pendingWrites()).map(w => [w.id, w.state, w.reason]), [
      [firstId, "sent", undefined], [secondId, "queued", tier === "wasm" || tier === "process" ? "queued without a row: local data does not justify prediction" : undefined],
    ]);
    assert.deepEqual(events, [], "a dropped connection never settles custody");
    await until(() => f.gates.length === 2, "same-id retry");
    assert.equal(f.gates[1].id, firstId);
    f.gates[1].resolve(Response.json({ denied: { code: "E_BUSY", family: "store", message: "hold", retryable: true } }, { status: 409 }));
    await until(async () => (await client.pendingWrites())[0]?.state === "held", "hold after retry");
    assert.equal((await client.write(firstId)).state, "pending");
    assert.deepEqual((await client.pendingWrites()).map(w => w.state), ["held", "queued"]);
    await until(() => f.gates.length === 3, "held retry");
    f.pass(); f.gates[2].resolve(Response.json({ state: "sent", seq: 0, result: null }));
    await until(() => events.length === 2, "custody did not report settlement");
    assert.deepEqual(await client.pendingWrites(), []);
    assert.equal((await client.write(firstId)).state, "sent");
    assert.equal((await client.write(secondId)).state, "sent");
  });
}

for (const tier of ["app-online", "wasm", "process"]) for (const state of ["held", "sent"]) {
  test(`${tier}: reload preserves ${state} head and queued tail, then settles the same ids once`, { timeout: hangBudget(20) }, async t => {
    const f = await fixture(t, tier), { client } = await f.open();
    const ids = [mintId(), mintId()], first = client.mutate(op("record"), { n: 10 }, { id: ids[0] });
    await until(() => f.gates.length === 1, "first dispatch");
    const second = client.mutate(op("remote"), { n: 20 }, { id: ids[1] });
    await until(async () => (await client.pendingWrites()).length === 2, "second admission");
    if (state === "held") {
      f.gates[0].resolve(Response.json({ denied: { code: "E_BUSY", family: "store", message: "hold", retryable: true } }, { status: 409 }));
      await until(async () => (await client.pendingWrites())[0]?.state === "held", "held status");
    }
    await client.close(); await Promise.all([first, second]);
    const reopened = await f.open(true), events = [];
    reopened.client.onWrite(write => events.push(write));
    const list = await reopened.client.pendingWrites();
    assert.deepEqual(list.map(w => [w.id, w.state, w.args]), [[ids[0], state, { n: 10 }], [ids[1], "queued", { n: 20 }]]);
    if (state === "held") assert.equal(list[0].reason, "E_BUSY");
    // An unrelated account cannot list this device/journal's intent.
    const other = await f.open(true, "bob");
    assert.deepEqual(await other.client.pendingWrites(), []); await other.client.close();
    f.pass(); await reopened.start();
    await until(async () => !(await reopened.client.pendingWrites()).length, "reopened queue did not settle");
    await until(() => events.length === 2, "reopened client missed settlement");
    assert.deepEqual(events.map(w => w.id), ids);
    assert.equal((await f.rows()).length, 1, "same intent must execute once");
    assert.deepEqual(f.posts.slice(-2).map(w => w.id), ids);
    assert.equal((await reopened.client.write(ids[0])).state, "sent");
  });
}

test("raw online queue is in memory; reopening never invents durable intent", async t => {
  const f = await fixture(t, "online"), { client } = await f.open(), id = mintId();
  const write = client.mutate(op("record"), { n: 1 }, { id });
  await until(() => f.gates.length === 1, "dispatch");
  assert.equal((await client.pendingWrites())[0].state, "sent");
  await client.close(); assert.equal((await write).state, "pending");
  assert.deepEqual(await (await f.open()).client.pendingWrites(), []);
  assert.equal(f.posts.length, 1);
});

test("online pending-list subscriber can admit a successor without redispatching the head", async t => {
  const f = await fixture(t, "online"), { client } = await f.open(), ids = [mintId(), mintId()];
  let notices = 0, second;
  client.onPendingWrites(() => {
    if (++notices === 2) second = client.mutate(op("remote"), { n: 2 }, { id: ids[1] });
  });
  const first = client.mutate(op("record"), { n: 1 }, { id: ids[0] });
  assert.equal((await client.pendingWrites())[0].state, "queued");
  await until(() => second && f.gates.length, "dispatch notification");
  assert.deepEqual(f.posts.map(w => w.id), [ids[0]]);
  assert.deepEqual((await client.pendingWrites()).map(w => w.state), ["sent", "queued"]);
  f.pass(); f.gates[0].resolve(Response.json({ state: "sent", seq: 0, result: null }));
  await Promise.all([first, second]);
  assert.deepEqual(f.posts.map(w => w.id), ids);
});

test("account facade fences both an outstanding list and its subscription", async () => {
  const reading = deferred(), listeners = new Set(); let valid = true;
  const raw = { onPendingWrites(notify) { listeners.add(notify); return () => listeners.delete(notify); }, pendingWrites: () => reading.promise };
  const guarded = guardClient(raw, async () => true, () => valid, () => ({ code: "E_AUTH", family: "auth", message: "signed out" }));
  let notices = 0;
  guarded.client.onPendingWrites(() => notices++);
  const listing = guarded.client.pendingWrites();
  await sleep(0); valid = false; guarded.fence()();
  reading.resolve([{ id: "private", op: "send", args: { body: "secret" }, state: "queued", predicted: [] }]);
  assert.deepEqual(await listing, []);
  assert.deepEqual(await guarded.client.pendingWrites(), []);
  assert.equal(listeners.size, 0); assert.equal(notices, 1);
});
