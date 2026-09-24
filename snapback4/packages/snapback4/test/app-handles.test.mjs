import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createApp } from "../dist/app.js";
import { memorySessionStore, restoreSession, sessionKey } from "../dist/auth.js";
import { processDevice } from "../dist/native.js";
import { binary, until, server } from "./helpers/app-server.mjs";
const list = { kind: "query", name: "list" }, add = { kind: "mutation", name: "add" };
const probe = async (url, token) => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${token}` } })).json()).denied?.code;

test("refusal tombstones an unpersisted rotation's consumed predecessor", { timeout: 20_000 }, async t => {
  const { url } = await server(t), memory = memorySessionStore(), key = sessionKey(url);
  let failNextSave = false, failures = 0;
  const app = createApp({ url, sessionStore: { ...memory, async set(k, value) {
    if (failNextSave && k === key) { failNextSave = false; failures++; throw Error("one rotation save failed"); }
    await memory.set(k, value);
  } } }); t.after(() => app.close()); await app.ready; await app.auth.guest();
  const before = await memory.get(key), old = app.client;
  failNextSave = true; const rotation = await old.refreshSession(); assert.equal(rotation.ok, true);
  await until(() => app.auth.why?.code === "E_CLIENT");
  assert.equal(failures, 1); assert.equal(await memory.get(key), before);
  await fetch(url + "/auth/logout", { method: "POST", headers: { authorization: `Bearer ${rotation.session.token}` } });
  assert.equal((await old.refreshSession()).why.code, "E_AUTH");
  await until(() => app.auth.state === "signed-out");
  assert.equal(await restoreSession(url, memory), null, "the consumed predecessor is not a restorable credential");
  await app.close();
  const offline = createApp({ url, sessionStore: memory, fetch: async () => { throw Error("offline"); } }); t.after(() => offline.close());
  assert.equal((await offline.ready).ok, true); assert.equal(offline.auth.state, "signed-out");
});

for (const tier of ["online", "local"]) test(`${tier}: global logout keeps the public view until its fence commits, then fences captured handles`, { timeout: 20_000 }, async t => {
  const { url, dir } = await server(t), memory = memorySessionStore(), key = sessionKey(url);
  let failFence = false; const dispatched = [];
  const app = createApp({ url, sessionStore: { ...memory, async set(k, value) {
    if (failFence && k === key && JSON.parse(value).snapback4Logout) throw Error("logout fence unavailable");
    await memory.set(k, value);
  } }, ...(tier === "local" ? { device: processDevice({ dir: join(dir, "handles"), binary }) } : {}), fetch(input, init) {
    dispatched.push(new URL(input).pathname); return fetch(input, init);
  } }); t.after(() => app.close()); await app.ready; await app.auth.signup("handles@example.com", "password-a");
  await app.mutate(add, { body: "private row" });
  const old = app.client, token = old.session().token, watched = old.observe(list, {});
  t.after(() => watched.close()); await until(() => watched.getSnapshot().data?.length === 1);
  let notices = 0; watched.subscribe(() => { if (watched.getSnapshot().denied) notices++; });
  const sibling = (await (await fetch(url + "/auth/login", { method: "POST", body: JSON.stringify({ email: "handles@example.com", password: "password-a" }) })).json()).session;
  const before = await memory.get(key); failFence = true;
  assert.equal((await app.auth.logoutEverywhere()).ok, false); assert.equal(app.auth.state, "signed-in");
  assert.equal(app.auth.why.code, "E_CLIENT"); assert.equal(app.client, old);
  assert.equal(await memory.get(key), before); assert.equal(await probe(url, token), undefined);
  assert.equal(old.viewer(), app.auth.viewer); assert.equal(old.session().token, token);
  assert.equal((await old.query(list, {})).data.length, 1);
  assert.equal(watched.getSnapshot().data.length, 1); assert.equal(notices, 0);
  failFence = false; assert.equal((await app.auth.logoutEverywhere()).ok, true);
  assert.equal(app.auth.state, "signed-out");
  assert.equal(old.viewer(), null); assert.equal(old.session(), null); assert.equal(old.link(), "signed-out");
  assert.equal(watched.getSnapshot().denied?.code, "E_AUTH"); assert.ok(notices > 0, "held observation notifies its refused snapshot");
  const start = dispatched.length;
  assert.equal((await old.query(list, {})).denied.code, "E_AUTH");
  assert.equal((await old.mutate(add, { body: "must not write" })).why.code, "E_AUTH");
  assert.equal((await old.refreshSession()).why.code, "E_AUTH");
  if (tier === "local") await old.sync();
  assert.deepEqual(old.assetSource("private").headers, {});
  const later = old.observe(list, {}); t.after(() => later.close());
  await until(() => later.getSnapshot().denied?.code === "E_AUTH");
  assert.ok(!dispatched.slice(start).some(path => ["/q/list", "/m/add", "/auth/refresh", "/sync"].includes(path)), JSON.stringify(dispatched.slice(start)));
  await old.close(); await old.signOut(); assert.equal((await old.logoutAll()).ok, false);
  await until(async () => await probe(url, sibling.token) === "E_AUTH");
});

test("rollback publishes a new facade and never revives captured handles", { timeout: 20_000 }, async t => {
  const { url } = await server(t), memory = memorySessionStore(), key = sessionKey(url);
  let failNext = false;
  const app = createApp({ url, sessionStore: { ...memory, async set(k, value) {
    if (failNext && k === key && JSON.parse(value).token) { failNext = false; throw Error("candidate save failed"); }
    await memory.set(k, value);
  } } }); t.after(() => app.close()); await app.ready; await app.auth.guest();
  await app.mutate(add, { body: "prior guest" });
  const old = app.client, principal = old.viewer(), watched = old.observe(list, {}); t.after(() => watched.close());
  await until(() => watched.getSnapshot().data?.length === 1);
  failNext = true; assert.equal((await app.auth.guest()).ok, false);
  assert.equal(app.auth.state, "signed-in"); assert.equal(app.auth.viewer, principal);
  assert.notEqual(app.client, old); assert.equal(old.viewer(), null);
  assert.equal(watched.getSnapshot().denied?.code, "E_AUTH");
  assert.equal((await old.query(list, {})).denied.code, "E_AUTH");
  assert.equal((await old.mutate(add, { body: "old capability" })).why.code, "E_AUTH");
  await old.close(); await old.signOut(); assert.equal((await old.logoutAll()).ok, false);
  assert.equal((await app.client.query(list, {})).data.length, 1);
});

test("refusal of an unpersisted successor preserves an unrelated replacement", { timeout: 20_000 }, async t => {
  const { url } = await server(t), memory = memorySessionStore(), key = sessionKey(url);
  let failNext = false, holdRefusal = false, held = false, release;
  const gate = new Promise(resolve => { release = resolve; });
  const a = createApp({ url, sessionStore: { ...memory, async set(k, value) {
    if (failNext && k === key) { failNext = false; throw Error("one rotation save failed"); }
    await memory.set(k, value);
  } }, fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (holdRefusal && new URL(input).pathname === "/auth/refresh") { held = true; await gate; }
    return response;
  } }); t.after(async () => { release(); await a.close(); }); await a.ready; await a.auth.guest();
  failNext = true; const rotated = await a.client.refreshSession();
  await until(() => a.auth.why?.code === "E_CLIENT");
  await fetch(url + "/auth/logout", { method: "POST", headers: { authorization: `Bearer ${rotated.session.token}` } });
  holdRefusal = true; const refusing = a.client.refreshSession(); await until(() => held);
  const b = createApp({ url, sessionStore: memory }); t.after(() => b.close()); await b.ready;
  const bob = await b.auth.guest(); assert.equal(bob.ok, true);
  release(); assert.equal((await refusing).ok, false);
  await until(() => a.auth.state === "signed-out");
  assert.equal((await restoreSession(url, memory)).token, bob.session.token);
  await until(async () => {
    const read = await b.client.query(list, {});
    if ("denied" in read) {
      // A cancelled peer request can leave a pooled transport unavailable.
      // Retry transport only; any authorization refusal still fails at once.
      assert.equal(read.denied.code, "E_OFFLINE", JSON.stringify(read)); return false;
    }
    assert.deepEqual(read.data, []); return true;
  }, "replacement remains readable");
});
