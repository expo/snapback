import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApp } from "../dist/app.js";
import { memorySessionStore, restoreSession, sessionKey } from "../dist/auth.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { server, until } from "./helpers/app-server.mjs";
const wasm = readFileSync(new URL("../src/wasm/snapback4_device_bg.wasm", import.meta.url));
const device = () => webDevice({ wasm, persist: memoryPersistence() });
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };

test("a failed local rotation save is not silently repeated by its notification", { timeout: 20_000 }, async t => {
  const { url } = await server(t), memory = memorySessionStore(), key = sessionKey(url);
  let fail = false, failures = 0, successor;
  const store = { ...memory, async set(k, value) {
    if (fail && k === key && successor && JSON.parse(value).token === successor.token) { fail = false; failures++; throw Error("one rotation save failed"); }
    await memory.set(k, value);
  } };
  const options = { url, sessionStore: store, device: device(), fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (new URL(input).pathname === "/auth/refresh") successor = (await response.clone().json()).session;
    return response;
  } };
  const app = createApp(options); t.after(() => app.close()); await app.ready; await app.auth.guest();
  const before = await memory.get(key); fail = true;
  await assert.rejects(app.client.refreshSession(), /one rotation save failed/);
  assert.equal(failures, 1);
  const saved = JSON.parse(await memory.get(key));
  assert.ok(saved.snapback4Rotation, "the predecessor stays claimed when successor persistence fails");
  delete saved.snapback4Rotation;
  assert.deepEqual(saved, JSON.parse(before));
  assert.equal(app.client.session().token, successor.token, "the live runtime owns the committed rotation until persistence recovers");
  await app.close();
  assert.equal((await restoreSession(url, store)).token, successor.token);
  const reopened = createApp(options); t.after(() => reopened.close()); await reopened.ready;
  assert.equal(reopened.auth.state, "signed-in"); assert.equal(reopened.client.session().token, successor.token);
});

test("a local query retries its consumed predecessor after the owned rotation arrives", { timeout: 20_000 }, async t => {
  const { url } = await server(t, "online only"), store = memorySessionStore(), held = gate(); let successor, denied = false;
  const app = createApp({ url, device: device(), sessionStore: store, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    const response = await fetch(input, init);
    if (path === "/auth/refresh") { successor = (await response.clone().json()).session; await held.promise; }
    if (path === "/q/list" && response.status === 401) denied = true;
    return response;
  } }); t.after(async () => { held.release(); await app.close(); }); await app.ready; await app.auth.guest();
  const old = app.client, rotating = old.refreshSession(); await until(() => successor);
  let completed = false;
  const reading = old.query({ kind: "query", name: "list" }, {}).finally(() => { completed = true; });
  await until(() => denied); assert.equal(completed, false, "obsolete refusal is not delivered as a session refusal");
  held.release(); assert.equal((await rotating).ok, true); assert.deepEqual((await reading).data, []);
  assert.equal(app.auth.state, "signed-in"); assert.equal((await restoreSession(url, store)).token, successor.token);
});
