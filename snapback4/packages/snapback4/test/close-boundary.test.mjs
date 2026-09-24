import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../dist/app.js";
import { createLocalClient } from "../dist/local.js";
import { memorySessionStore, sessionKey } from "../dist/auth.js";
import { mintId } from "../dist/client.js";
import { processDevice } from "../dist/native.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { binary, server, until } from "./helpers/app-server.mjs";

const wasm = readFileSync(new URL("../src/wasm/snapback4_device_bg.wasm", import.meta.url));
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const mutation = { kind: "mutation", name: "add" }, action = { kind: "action", name: "work" };
const why = { code: "E_MODEL_REFUSED", family: "input", message: "the second invocation was refused", site: "work", rewrite: "submit the original arguments" };

async function fixture(t, tier, cleanupAt = "device") {
  const { url, dir } = await server(t), cleanup = gate(), replies = [], releases = [];
  let armed = false, cleaning = false, deviceClosed = tier === "online";
  const underlying = tier === "online" ? undefined : tier === "wasm"
    ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, "device") });
  const device = underlying && { ...underlying, async open(...args) {
    const core = await underlying.open(...args);
    return { ...core, async close() {
      if (armed && cleanupAt === "device") { cleaning = true; await cleanup.promise; }
      await core.close(); deviceClosed = true;
    } };
  } };
  const memory = memorySessionStore();
  const sessionStore = { ...memory, async get(key) {
    if (armed && cleanupAt === "session" && key === sessionKey(url)) {
      assert.equal(deviceClosed, true, "public close has finished raw device cleanup before session cleanup starts");
      cleaning = true; await cleanup.promise;
    }
    return memory.get(key);
  } };
  const app = createApp({ url, device, sessionStore, fetch: async (input, init) => {
    if (!["/m/add", "/a/work"].includes(new URL(input).pathname)) return fetch(input, init);
    assert.equal(init.signal, undefined, "closing must detach the caller, never abort a committed effect");
    const request = JSON.parse(init.body), held = gate(); releases.push(held.release);
    const reply = { request, held, delivered: false }; replies.push(reply);
    await held.promise;
    const response = Response.json(reply.body), json = response.json.bind(response);
    response.json = async () => { const body = await json(); reply.delivered = true; return body; };
    return response;
  } });
  t.after(async () => { armed = false; cleanup.release(); for (const release of releases) release(); await app.close(); });
  await app.ready; assert.equal((await app.auth.guest()).ok, true);
  return { app, replies, cleanup, arm() { armed = true; }, cleaning: () => cleaning };
}

for (const tier of ["wasm", "native"]) for (const kind of ["mutation", "action"]) for (const different of [false, true]) {
  test(`${tier} ${kind}: concurrent same-id calls with ${different ? "different" : "identical"} arguments keep their own cleanup outcomes`, { timeout: 20_000 }, async t => {
    const f = await fixture(t, tier), id = mintId(), args = { body: "first" };
    const call = args => kind === "mutation" ? f.app.mutate(mutation, args, { id }) : f.app.client.act(action, args, { id });
    const first = call(args); await until(() => f.replies.length === 1);
    const second = call(different ? { body: "second" } : args);
    // Mutations coalesce identical invocations and reject conflicting input
    // before dispatch. Actions have one transport response per invocation.
    if (kind === "mutation" && different) assert.equal((await second).why.code, "E_WRITE_ID_REUSE");
    if (kind === "action") await until(() => f.replies.length === 2);
    await new Promise(resolve => setImmediate(resolve));
    f.arm(); const closing = f.app.close(); await until(f.cleaning);
    const success = kind === "mutation" ? { state: "sent", id, seq: 7, result: { answer: "first" } }
      : { state: "done", id, result: { answer: "first" } };
    f.replies[0].body = success;
    if (kind === "action") {
      f.replies[1].body = different ? { state: "failed", id, why } : success;
      // Deliver in reverse invocation order. ID-keyed capture swaps outcomes.
      f.replies[1].held.release(); await until(() => f.replies[1].delivered);
    }
    f.replies[0].held.release(); await until(() => f.replies[0].delivered);
    f.cleanup.release(); await closing;
    assert.deepEqual(await first, success);
    if (kind === "action") assert.deepEqual(await second, different ? { state: "failed", id, why } : success);
    else if (!different) assert.deepEqual(await second, success, "overlapping mutation callers share the full outcome");
    assert.equal(f.replies.length, kind === "mutation" ? 1 : 2);
  });
}

for (const tier of ["online", "wasm", "native"]) for (const known of [false, true]) {
  test(`${tier}: overlapping mutation callers share ${known ? "a refusal" : "pending"} across close`, { timeout: 20_000 }, async t => {
    const f = await fixture(t, tier, "session"), id = mintId(), args = { body: "same" };
    const first = f.app.mutate(mutation, args, { id }); await until(() => f.replies.length === 1);
    const second = f.app.mutate(mutation, args, { id });
    // Enter both submissions before hiding the facade (its authorization
    // check is asynchronous); neither caller is a later receipt lookup.
    await new Promise(resolve => setImmediate(resolve));
    f.arm(); const closing = f.app.close(); await until(f.cleaning);
    const failed = { state: "failed", id, why }; f.replies[0].body = failed;
    if (known) { f.replies[0].held.release(); await until(() => f.replies[0].delivered); }
    f.cleanup.release(); await closing;
    const expected = known ? failed : { state: "pending", id };
    assert.deepEqual(await first, expected); assert.deepEqual(await second, expected);
    f.replies[0].held.release(); await until(() => f.replies[0].delivered);
    assert.equal(f.replies.length, 1);
  });
}

for (const tier of ["online", "wasm", "native"]) for (const kind of ["mutation", "action"]) for (const failed of [false, true]) {
  test(`${tier} ${kind}: ${failed ? "refusal" : "success"} arriving during app session cleanup reaches its caller`, { timeout: 20_000 }, async t => {
    const f = await fixture(t, tier, "session"), id = mintId();
    const pending = kind === "mutation" ? f.app.mutate(mutation, { body: "one" }, { id }) : f.app.client.act(action, {}, { id });
    await until(() => f.replies.length === 1);
    f.arm(); const closing = f.app.close(); await until(f.cleaning);
    const expected = failed ? { state: "failed", id, why } : kind === "mutation"
      ? { state: "sent", id, seq: 9, result: "known" } : { state: "done", id, result: "known" };
    f.replies[0].body = expected; f.replies[0].held.release(); await until(() => f.replies[0].delivered);
    f.cleanup.release(); await closing;
    assert.deepEqual(await pending, expected);
  });
}

for (const tier of ["online", "wasm", "native"]) for (const queuedGlobal of [false, true]) test(`${tier}: public close detaches a held refresh and retires its late successor; queued global logout=${queuedGlobal}`, { timeout: 20_000 }, async t => {
  const { url, dir } = await server(t), held = gate(); let successor, consumed = false;
  const device = tier === "online" ? undefined : tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, "device") });
  const app = createApp({ url, device, sessionStore: memorySessionStore(), fetch: async (input, init) => {
    if (new URL(input).pathname !== "/auth/refresh") return fetch(input, init);
    assert.equal(init.signal, undefined);
    const body = await (await fetch(input, init)).json(); successor = body.session;
    await held.promise;
    const response = Response.json(body), json = response.json.bind(response);
    response.json = async () => { const body = await json(); consumed = true; return body; };
    return response;
  } });
  t.after(async () => { held.release(); await app.close(); });
  await app.ready; assert.equal((await app.auth.guest()).ok, true);
  const refresh = app.client.refreshSession(); await until(() => successor);
  const revoking = queuedGlobal ? app.auth.logoutEverywhere() : undefined;
  await new Promise(resolve => setImmediate(resolve));
  let closed = false;
  const closing = app.close().then(() => { closed = true; });
  await until(() => closed, "close must complete without releasing the held refresh");
  await closing; assert.equal((await refresh).ok, false);
  if (revoking) assert.equal((await revoking).ok, false);
  held.release(); await until(() => consumed);
  await until(async () => {
    const reply = await fetch(`${url}/q/list`, { method: "POST", headers: { authorization: `Bearer ${successor.token}`, "content-type": "application/json" }, body: '{"args":{}}' });
    return (await reply.json()).denied?.code === "E_AUTH";
  }, "the late unkept successor is rejected by the server");
});

for (const tier of ["wasm", "native"]) test(`${tier}: raw close finishes already-started rotation persistence and keeps that successor`, { timeout: 20_000 }, async t => {
  const { url, dir } = await server(t), held = gate(), memory = memorySessionStore();
  let armed = false, saving = false, deviceClosed = false;
  const underlying = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, "device") });
  const device = { ...underlying, async open(...args) {
    const core = await underlying.open(...args);
    return { ...core, async close() { deviceClosed = true; await core.close(); } };
  } };
  const client = await createLocalClient({ url, device, guest: true, sessionStore: { ...memory, async set(key, value) {
    if (armed && key === sessionKey(url)) { saving = true; await held.promise; }
    await memory.set(key, value);
  } } });
  t.after(async () => { held.release(); await client.close(); });
  armed = true;
  const refreshing = client.refreshSession(); await until(() => saving);
  const successor = client.session(); let closed = false;
  const closing = client.close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false); assert.equal(deviceClosed, false, "device cleanup cannot overtake an already-started session save");
  held.release(); await closing;
  assert.equal((await refreshing).ok, true);
  assert.deepEqual(JSON.parse(await memory.get(sessionKey(url))), successor);
  const response = await fetch(`${url}/q/list`, { method: "POST", headers: { authorization: `Bearer ${successor.token}`, "content-type": "application/json" }, body: '{"args":{}}' });
  assert.deepEqual((await response.json()).data, [], "close keeps the successor whose persistence had already started");
});

for (const tier of ["online", "wasm", "native"]) test(`${tier}: public close detaches held global revocation but keeps its acknowledgement custody`, { timeout: 20_000 }, async t => {
  const { url, dir } = await server(t), held = gate(), sessions = memorySessionStore();
  let received, consumed = false, attempts = 0;
  const device = tier === "online" ? undefined : tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, "device") });
  const options = { url, device, sessionStore: sessions, fetch: async (input, init) => {
    if (new URL(input).pathname !== "/auth/logout-all") return fetch(input, init);
    attempts++;
    assert.equal(init.signal, undefined);
    received = await (await fetch(input, init)).json();
    await held.promise;
    const response = Response.json(received), json = response.json.bind(response);
    response.json = async () => { const body = await json(); consumed = true; return body; };
    return response;
  } };
  const app = createApp(options);
  t.after(async () => { held.release(); await app.close(); });
  await app.ready; assert.equal((await app.auth.guest()).ok, true);
  const revoking = app.auth.logoutEverywhere(); await until(() => received);
  assert.equal(received.ok, true, "global revocation committed before its body was held");
  let closed = false;
  const closing = app.close().then(() => { closed = true; });
  await until(() => closed, "close cannot queue behind unread global revocation");
  await closing; assert.equal((await revoking).ok, false);
  held.release(); await until(() => consumed);
  await until(async () => {
    const journal = JSON.parse(await sessions.get(sessionKey(url) + ".revocations") ?? "null");
    return !journal?.all?.length;
  }, "the detached request persists its acknowledgement");
  const reopened = createApp(options); t.after(() => reopened.close()); await reopened.ready;
  assert.equal(reopened.auth.state, "signed-out");
  assert.equal(attempts, 1, "reopening never reconsumes an acknowledged global bearer");
});
