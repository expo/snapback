import { withHangGuard, hangBudget } from './helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
// Instrument the SDK's pinned Node transport, including its Darwin QoS fix.
import { defaultFetch as fetch } from "../dist/node-fetch.js";
import { createApp } from "../dist/app.js";
import { memorySessionStore, restoreSession, keepSession, sessionKey, refreshSession, logout as revokeSession } from "../dist/auth.js";
import { processDevice } from "../dist/native.js";
import { createSmoke } from "../../snapback4-expo/src/smoke.ts";

import { binary, until, server } from "./helpers/app-server.mjs";
const add = { kind: "mutation", name: "add" }, list = { kind: "query", name: "list" };
for (const tier of ["online", "local"]) test(`app ${tier}: signup, restart, rotation, account-bound pending writes and logout`, { timeout: hangBudget(25) }, async t => {
  const { url, dir } = await server(t);
  const sessionStore = memorySessionStore();
  let offline = false;
  const sent = [];
  const fetcher = async (input, init) => {
    if (offline && ["/m/add", "/sync"].includes(new URL(input).pathname)) throw Error("offline");
    if (new URL(input).pathname === "/m/add") sent.push({ ...JSON.parse(init.body), token: init.headers.authorization });
    return fetch(input, init);
  };
  const options = { url, sessionStore, fetch: fetcher, ...(tier === "local" ? { device: processDevice({ dir: join(dir, "device"), binary }) } : {}) };
  let app = createApp(options); t.after(() => app.close());
  assert.equal(app.auth.state, "restoring"); await app.ready;
  assert.equal(app.auth.state, "signed-out");
  const a = await app.auth.signup("a@example.com", "password-a"); assert.equal(a.ok, true, JSON.stringify(a));
  const principal = app.auth.viewer;
  assert.equal(principal, a.session.principal);
  const invalid = await app.auth.login("a@example.com", "wrong-password"); assert.equal(invalid.ok, false);
  assert.equal(app.auth.viewer, principal, "failed login keeps the current account");
  const rotated = await app.client.refreshSession(); assert.equal(rotated.ok, true);
  await app.close();
  assert.equal((await restoreSession(url, sessionStore)).token, rotated.session.token);
  app = createApp(options); assert.equal((await app.ready).ok, true); assert.equal(app.auth.viewer, principal);
  offline = true;
  const pending = await app.mutate(add, { body: "A's queued write" }); assert.equal(pending.state, "pending");
  const prior = app.client;
  const b = await app.auth.signup("b@example.com", "password-b"); assert.equal(b.ok, true, JSON.stringify(b));
  assert.notEqual(app.client, prior); assert.notEqual(app.auth.viewer, principal);
  assert.equal(await app.client.write(pending.id), undefined, "B cannot recover A's write");
  offline = false;
  assert.deepEqual(await until(async () => (await app.client.query(list, {})).data), []);
  assert.equal((await app.auth.login("a@example.com", "password-a")).ok, true);
  const settled = await until(async () => { const w = await app.client.write(pending.id); return w?.state === "sent" && w; }, "A's settlement");
  assert.equal(settled.id, pending.id);
  const rows = await until(async () => { const read = await app.client.query(list, {}); return read.data?.length === 1 && read.data; });
  assert.equal(rows[0].body, "A's queued write");
  assert.equal(rows[0].owner, principal);
  assert.ok(sent.every(write => write.id === pending.id));
  const token = app.client.session().token;
  assert.equal((await app.auth.logout()).ok, true);
  assert.equal(app.auth.state, "signed-out"); assert.equal(app.auth.viewer, null);
  assert.equal(await restoreSession(url, sessionStore), null);
  await until(async () => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${token}` } })).json()).denied?.code === "E_AUTH", "server revoked old token");
  await app.close(); app = createApp(options); await app.ready; assert.equal(app.auth.state, "signed-out");
});

test("online app recovers two lost confirmations with original IDs and immutable arguments", { timeout: hangBudget(16) }, async t => {
  const { url } = await server(t);
  const sessionStore = memorySessionStore();
  let cut = false;
  const posted = [];
  const fetcher = async (input, init) => {
    if (new URL(input).pathname !== "/m/add") return fetch(input, init);
    posted.push(JSON.parse(init.body));
    if (cut) throw Error("offline after lost reply");
    const response = await fetch(input, init);
    cut = true; await response.text(); throw Error("reply lost after commit");
  };
  let app = createApp({ url, sessionStore, fetch: fetcher }); t.after(() => app.close());
  await app.ready; assert.equal((await app.auth.guest()).ok, true);
  const args = { body: "first" };
  const promise = app.mutate(add, args); args.body = "changed after submit";
  const first = await promise, second = await app.mutate(add, { body: "second" });
  assert.equal(first.state, "pending"); assert.equal(second.state, "pending");
  await app.close();
  const recovered = [];
  app = createApp({ url, sessionStore, fetch: (input, init) => { if (new URL(input).pathname === "/m/add") recovered.push(JSON.parse(init.body)); return fetch(input, init); } });
  await app.ready;
  await until(async () => (await app.client.write(second.id))?.state === "sent");
  assert.deepEqual(recovered.map(write => write.id), [first.id, second.id]);
  assert.deepEqual(recovered.map(write => write.args.body), ["first", "second"]);
  assert.deepEqual((await app.client.query(list, {})).data.map(row => row.body), ["first", "second"]);
  await app.close(); app = createApp({ url, sessionStore }); await app.ready;
  assert.equal((await app.client.write(first.id)).state, "sent");
  assert.equal((await app.client.write(first.id)).replayed, true);
});

test("logoutEverywhere revokes other sessions and session restore cancellation cannot resurrect identity", { timeout: hangBudget(16) }, async t => {
  const { url } = await server(t);
  const sessionStore = memorySessionStore();
  const app = createApp({ url, sessionStore }); t.after(() => app.close());
  await app.ready; assert.equal((await app.auth.signup("everywhere@example.com", "password-a")).ok, true);
  const other = createApp({ url, sessionStore: memorySessionStore() }); t.after(() => other.close());
  await other.ready; assert.equal((await other.auth.login("everywhere@example.com", "password-a")).ok, true);
  const token = other.client.session().token;
  assert.equal((await app.auth.logoutEverywhere()).ok, true);
  assert.equal(app.auth.state, "signed-out"); assert.equal(await restoreSession(url, sessionStore), null);
  assert.equal((await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${token}` } })).json()).denied.code, "E_AUTH");
  let release; const gate = new Promise(resolve => { release = resolve; });
  await keepSession(url, { principal: "old", token: "old", kind: "user", expiresAt: Date.now() + 7 * 86400000 }, sessionStore);
  const delayed = createApp({ url, sessionStore: { ...sessionStore, async get(key) { const value = await sessionStore.get(key); await gate; return value; } } });
  t.after(() => delayed.close());
  await delay(0); const logout = delayed.auth.logout(); release(); await delayed.ready; await logout;
  assert.equal(delayed.auth.state, "signed-out"); assert.equal(await restoreSession(url, sessionStore), null);
});

test("online logout completes while rotation is stalled and revokes the late successor", { timeout: hangBudget(9) }, async t => {
  const sessionStore = memorySessionStore(), url = "https://app.invalid";
  const initial = { principal: "user:a", token: "old", kind: "user", expiresAt: Date.now() + 7 * 86400000 };
  await keepSession(url, initial, sessionStore);
  let finish, requested = false; const rotation = new Promise(resolve => { finish = resolve; });
  const revoked = [];
  const app = createApp({ url, sessionStore, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/auth/refresh") { requested = true; return rotation; }
    if (path === "/auth/logout") { revoked.push(init.headers.authorization); return Response.json({ ok: true }); }
    throw Error(path);
  } });
  t.after(async () => { finish(Response.json({ session: { ...initial, token: "next" } })); await app.close(); });
  await app.ready;
  const refresh = app.client.refreshSession();
  await until(() => requested);
  assert.equal((await app.auth.logout()).ok, true);
  assert.equal(await restoreSession(url, sessionStore), null);
  finish(Response.json({ session: { ...initial, token: "next" } })); await refresh;
  await until(() => revoked.includes("Bearer next"));
  assert.equal(app.auth.state, "signed-out");
  assert.equal(await restoreSession(url, sessionStore), null);
});

test("online custody refuses unstored admission and retains committed writes when receipt storage fails", { timeout: hangBudget(7) }, async t => {
  const { url } = await server(t);
  const memory = memorySessionStore();
  let failIntent = false, failReceipt = false, sends = 0;
  const store = { ...memory, async set(key, value) {
    if (key.endsWith(".writes")) {
      const journal = JSON.parse(value);
      if (failIntent || (failReceipt && journal.receipts.length)) throw Error("storage unavailable");
    }
    await memory.set(key, value);
  } };
  const app = createApp({ url, sessionStore: store, fetch: (input, init) => { if (new URL(input).pathname === "/m/add") sends++; return fetch(input, init); } });
  t.after(() => app.close());
  await app.ready; await app.auth.guest();
  failIntent = true;
  for (const waitSeconds of [undefined, 0]) {
    const refused = await app.mutate(add, { body: "never dispatched" }, { waitSeconds });
    assert.equal(refused.state, "failed"); assert.equal(refused.why.code, "E_STORE");
    assert.match(refused.why.message, /storage/);
  }
  assert.equal(sends, 0);
  failIntent = false; failReceipt = true;
  const write = await app.mutate(add, { body: "committed" });
  assert.equal(write.state, "sent", "failed receipt persistence cannot replace the confirmed outcome; the intent remains for replay");
  failReceipt = false;
  assert.equal((await app.client.write(write.id)).state, "sent");
  assert.equal(sends, 1);
});

test("failed session commit revokes only the provisional bearer before reporting signed-out", { timeout: hangBudget(15) }, async t => {
  const { url } = await server(t), memory = memorySessionStore();
  let sessionWrites = 0, issued;
  const app = createApp({ url, sessionStore: { ...memory, async set(key, value) {
    if (key.endsWith(".session") && ++sessionWrites === 1) throw Error("session store failed");
    await memory.set(key, value);
  } }, fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (new URL(input).pathname === "/auth/guest") issued = (await response.clone().json()).session;
    return response;
  } });
  t.after(() => app.close());
  await app.ready;
  const published = [];
  app.auth.onChange(() => { if (app.auth.state === "signed-out") published.push(restoreSession(url, memory)); });
  assert.equal((await app.auth.guest()).ok, false);
  assert.equal(app.auth.state, "signed-out");
  assert.equal(app.client.viewer(), null);
  assert.equal(await restoreSession(url, memory), null);
  assert.deepEqual(await Promise.all(published), [null]);
  await until(async () => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${issued.token}` } })).json()).denied?.code === "E_AUTH");
  const restarted = createApp({ url, sessionStore: memory });
  await restarted.ready; assert.equal(restarted.auth.state, "signed-out"); await restarted.close();
  assert.equal((await app.mutate(add, { body: "not allowed" })).why.code, "E_AUTH");
  assert.equal((await app.auth.guest()).ok, true, "a repaired session store can sign in again");
});

for (const action of ["logout", "logoutEverywhere"]) test(`${action} clears credentials after journal failure, and credential deletion is retryable`, async t => {
  const memory = memorySessionStore(), url = "https://app.invalid";
  let failDelete = false;
  const app = createApp({ url, sessionStore: { ...memory,
    async set(key, value) { if (key.endsWith(".writes")) throw Error("outbox store failed"); if (failDelete && JSON.parse(value).snapback4Logout) throw Error("session logout commit failed"); await memory.set(key, value); },
    async delete(key) { if (failDelete) throw Error("session delete failed"); await memory.delete(key); },
  }, fetch: async (input) => new URL(input).pathname === "/auth/guest"
    ? Response.json({ session: { principal: "alice", token: "secret", kind: "user", expiresAt: Date.now() + 7 * 86400000 } })
    : Response.json({ ok: true, ...(new URL(input).pathname === "/probe" ? { store_id: "journal-failure-test", seq: 0 } : {}) }) });
  t.after(() => app.close());
  await app.ready; await app.auth.guest();
  for (const waitSeconds of [undefined, 0]) {
    const refused = await app.mutate(add, { body: "not sent" }, { waitSeconds });
    assert.equal(refused.state, "failed"); assert.equal(refused.why.code, "E_STORE");
    assert.match(refused.why.message, /outbox store/);
  }
  failDelete = true;
  assert.equal((await app.auth[action]()).ok, false);
  assert.equal(app.auth.state, action === "logoutEverywhere" ? "signed-in" : "signed-out");
  assert.equal(app.client.viewer(), action === "logoutEverywhere" ? "alice" : null);
  assert.equal(app.auth.why.code, "E_CLIENT");
  failDelete = false;
  assert.equal((await app.auth.logout()).ok, true);
  assert.equal(await restoreSession(url, memory), null);
});

test("signed-out completion waits for durable credential deletion", async t => {
  const memory = memorySessionStore(); let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const app = createApp({ url: "https://app.invalid", sessionStore: { ...memory, async set(key, value) { if (JSON.parse(value).snapback4Logout) await gate; await memory.set(key, value); } },
    fetch: async input => new URL(input).pathname === "/auth/guest"
      ? Response.json({ session: { principal: "alice", token: "secret", kind: "user", expiresAt: Date.now() + 7 * 86400000 } })
      : Response.json({ ok: true }) });
  t.after(async () => { finish(); await app.close(); });
  await app.ready; await app.auth.guest();
  const ending = app.auth.logout();
  await delay(0);
  assert.equal(app.auth.state, "restoring"); assert.equal(app.client.viewer(), null);
  finish(); await ending;
  assert.equal(app.auth.state, "signed-out");
});

for (const tier of ["online", "local"]) test(`logout ${tier} deletes the bearer while network work is held`, { timeout: hangBudget(19) }, async t => {
  const { url, dir } = await server(t), store = memorySessionStore();
  const session = (await (await fetch(url + "/auth/guest", { method: "POST", body: "{}" })).json()).session;
  await keepSession(url, session, store);
  let releaseSchema, releaseLogout, schemaRequested = false, logoutRequested = false;
  const schemaGate = new Promise(resolve => { releaseSchema = resolve; });
  const logoutGate = new Promise(resolve => { releaseLogout = resolve; });
  const app = createApp({ url, sessionStore: store,
    ...(tier === "local" ? { device: processDevice({ dir: join(dir, "held-device"), binary }) } : {}),
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === "/schema") { schemaRequested = true; await schemaGate; }
      if (path === "/auth/logout") { logoutRequested = true; await logoutGate; }
      return fetch(input, init);
    },
  });
  t.after(async () => { releaseSchema(); releaseLogout(); await app.close(); });
  if (tier === "local") await until(() => schemaRequested);
  else await app.ready;
  const ending = app.auth.logout();
  await until(() => logoutRequested);
  assert.equal((await withHangGuard(() => ending, "app.test.mjs: asynchronous completion")).ok, true, "local logout is independent of both held requests");
  assert.equal(await restoreSession(url, store), null);
  assert.equal(app.auth.state, "signed-out");
  const restarted = createApp({ url, sessionStore: store });
  await restarted.ready; assert.equal(restarted.auth.state, "signed-out"); await restarted.close();
  releaseSchema(); releaseLogout(); await app.ready;
  assert.equal(await restoreSession(url, store), null, "late restoration cannot put the token back");
  assert.equal(app.auth.state, "signed-out");
  await until(async () => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${session.token}` } })).json()).denied?.code === "E_AUTH");
});

for (const tier of ["online", "local"]) test(`ordinary ${tier} app close retires an unread rotation and reopening refuses its consumed predecessor`, { timeout: hangBudget(20) }, async t => {
  const { url, dir } = await server(t), store = memorySessionStore();
  let release, rotated;
  const gate = new Promise(resolve => { release = resolve; });
  const options = { url, sessionStore: store,
    ...(tier === "local" ? { device: processDevice({ dir: join(dir, "rotating-device"), binary }) } : {}),
  };
  let app = createApp({ ...options, fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (new URL(input).pathname === "/auth/refresh") { rotated = (await response.clone().json()).session; await gate; }
    return response;
  } });
  t.after(async () => { release(); await app.close(); });
  await app.ready; await app.auth.guest();
  const published = [];
  t.after(app.client.onSession(session => published.push(session?.token ?? null)));
  const original = app.client.session().token, refresh = app.client.refreshSession();
  await until(() => rotated);
  await app.close();
  assert.equal((await refresh).ok, false, "close ends the unread rotation's caller without waiting for its body");
  release();
  assert.deepEqual(published, [null], "the hidden session subscription cannot disclose a late successor");
  assert.equal((await restoreSession(url, store)).token, original);
  await until(async () => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${rotated.token}` } })).json()).denied?.code === "E_AUTH");
  assert.notEqual(rotated.token, original);
  assert.equal((await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${original}` } })).json()).denied?.code, "E_AUTH");
  app = createApp(options); await app.ready;
  assert.equal((await app.client.query(list, {})).denied?.code, "E_AUTH");
  await until(() => app.auth.state === "signed-out", "the first protected read fences the consumed predecessor");
  assert.equal(app.auth.viewer, null);
  assert.equal((await app.auth.guest()).ok, true, "an explicit new sign-in can recover");
});


for (const tier of ["online", "local"]) test(`a stale ${tier} refresh preserves another owner's kept successor`, { timeout: hangBudget(19) }, async t => {
  const { url, dir } = await server(t), store = memorySessionStore();
  const options = { url, sessionStore: store };
  const a = createApp({ ...options, ...(tier === "local" ? { device: processDevice({ dir: join(dir, "tab-a"), binary }) } : {}) });
  const bOptions = { ...options, ...(tier === "local" ? { device: processDevice({ dir: join(dir, "tab-b"), binary }) } : {}) };
  t.after(() => a.close());
  await a.ready; await a.auth.guest();
  let release, rejected = false;
  const gate = new Promise(resolve => { release = resolve; });
  const b = createApp({ ...bOptions, fetch: async (input, init) => {
    if (new URL(input).pathname === "/auth/refresh") { rejected = true; await gate; }
    return fetch(input, init);
  } });
  t.after(async () => { release(); await b.close(); });
  await b.ready;
  const stale = b.client.refreshSession(); await until(() => rejected);
  const fresh = await a.client.refreshSession(); assert.equal(fresh.ok, true);
  await until(async () => (await restoreSession(url, store))?.token === fresh.session.token);
  release(); assert.equal((await stale).ok, false);
  await until(() => b.auth.state === "signed-out");
  assert.equal((await restoreSession(url, store))?.token, fresh.session.token);
  assert.deepEqual((await a.client.query(list, {})).data, []);
  // Explicit logout can drop a successor absent from this runtime. It must
  // revoke that dropped token instead of silently orphaning it on the server.
  assert.equal((await b.auth.logout()).ok, true);
  assert.equal(await restoreSession(url, store), null);
  await until(async () => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${fresh.session.token}` } })).json()).denied?.code === "E_AUTH");
});

for (const [tier, stage] of [["online", "first save"], ["local", "first save"], ["online", "final save"], ["local", "backend acquisition"]]) test(`stale ${tier} restoration restarts when another app rotates before its ${stage}`, { timeout: hangBudget(19) }, async t => {
  const { url, dir } = await server(t), memory = memorySessionStore(), saved = [];
  const store = { ...memory, async set(key, value) {
    if (key.endsWith(".session")) saved.push(JSON.parse(value).token);
    await memory.set(key, value);
  } };
  let held = false, release, requested = false, releaseResponse;
  const gate = new Promise(resolve => { release = resolve; });
  const responseGate = new Promise(resolve => { releaseResponse = resolve; });
  const b = createApp({ url, sessionStore: store, fetch: async (input, init) => {
    if (new URL(input).pathname === "/auth/refresh") { requested = true; await responseGate; }
    return fetch(input, init);
  } });
  t.after(async () => { release(); releaseResponse(); await b.close(); });
  await b.ready; await b.auth.guest();
  const old = b.client.session().token;
  const refreshing = b.client.refreshSession();
  await until(() => requested); // Capture the epoch before holding A's storage lock.
  const a = createApp({ url, sessionStore: { ...store, async get(key) {
    const value = await store.get(key);
    if (!held && stage !== "backend acquisition" && key.endsWith(stage === "first save" ? ".session" : ".writes")) {
      held = true; await gate;
    }
    return value;
  } }, fetch: async (input, init) => {
    if (!held && stage === "backend acquisition" && new URL(input).pathname === "/schema") { held = true; await gate; }
    return fetch(input, init);
  }, ...(tier === "local" ? { device: processDevice({ dir: join(dir, "restoring-device"), binary }) } : {}) });
  t.after(async () => { release(); await a.close(); });
  await until(() => held, "A captured the old session");
  // Online refresh reports its successor before its async onSession save
  // completes. Queue that save behind A's read, ahead of A's opening saves.
  releaseResponse();
  const fresh = await refreshing; assert.equal(fresh.ok, true);
  assert.notEqual(fresh.session.token, old);
  if (stage !== "first save") await until(async () => (await restoreSession(url, memory))?.token === fresh.session.token);
  release();
  assert.equal((await a.ready).ok, true);
  const nextAt = saved.indexOf(fresh.session.token);
  assert.notEqual(nextAt, -1);
  assert.ok(saved.slice(nextAt).every(token => token === fresh.session.token), "no stale opening may save old after next");
  assert.equal(a.client.session().token, fresh.session.token, "A restarts with the stored successor");
  assert.equal((await restoreSession(url, memory)).token, fresh.session.token);
  assert.equal(a.auth.state, "signed-in"); assert.equal(a.auth.why, undefined);
  assert.deepEqual((await a.client.query(list, {})).data, []);
  assert.deepEqual((await b.client.query(list, {})).data, [], "restarting A must not revoke B's successor family");
});

for (const tier of ["online", "local"]) test(`${tier} auth rejection after a failed login completes signed-out cleanup`, { timeout: hangBudget(10) }, async t => {
  const { url, dir } = await server(t), store = memorySessionStore();
  const app = createApp({ url, sessionStore: store,
    ...(tier === "local" ? { device: processDevice({ dir: join(dir, "rejected-device"), binary }) } : {}),
  });
  t.after(() => app.close());
  await app.ready;
  assert.equal((await app.auth.signup("reject@example.com", "password-a")).ok, true);
  const original = app.client;
  assert.equal((await app.auth.login("reject@example.com", "wrong-password")).ok, false);
  assert.equal(app.client, original); assert.equal(app.auth.state, "signed-in");
  await revokeSession(url, original.session().token);
  const refusal = await original.refreshSession();
  assert.equal(refusal.ok, false); assert.equal(refusal.why.code, "E_AUTH");
  await until(() => app.auth.state === "signed-out", "rejected original session publishes signed-out");
  assert.equal(app.auth.viewer, null); assert.equal(app.client.session(), null);
  assert.equal(await restoreSession(url, store), null, "a refused stored bearer commits a logout tombstone");
  assert.equal((await app.auth.logout()).ok, true);
  assert.equal(await restoreSession(url, store), null);
});

for (const tier of ["online", "local"]) for (const loginBob of [false, true]) test(`shared logout fences a held ${tier} rotation${loginBob ? " across Bob's login" : " while signed out"}`, { timeout: hangBudget(23) }, async t => {
  const { url, dir } = await server(t), store = memorySessionStore();
  const bob = (await (await fetch(url + "/auth/signup", { method: "POST", body: JSON.stringify({ email: "bob@example.com", password: "password-b" }) })).json()).session;
  await revokeSession(url, bob.token);
  let release, rotated;
  const gate = new Promise(resolve => { release = resolve; });
  const a = createApp({ url, sessionStore: store,
    ...(tier === "local" ? { device: processDevice({ dir: join(dir, "epoch-device"), binary }) } : {}),
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (new URL(input).pathname === "/auth/refresh") { rotated = (await response.clone().json()).session; await gate; }
      return response;
    },
  });
  t.after(async () => { release(); await a.close(); });
  await a.ready; assert.equal((await a.auth.signup("alice@example.com", "password-a")).ok, true);
  const b = createApp({ url, sessionStore: store }); t.after(() => b.close());
  await b.ready;
  const refresh = a.client.refreshSession();
  await until(() => rotated, "server committed Alice's rotation; response still held");
  assert.equal((await b.auth.logout()).ok, true);
  assert.equal(await restoreSession(url, store), null);
  let kept = null;
  if (loginBob) {
    const result = await b.auth.login("bob@example.com", "password-b");
    assert.equal(result.ok, true); kept = result.session;
  }
  release(); await refresh;
  await until(() => a.auth.state === "signed-out", "Alice notices the shared logout epoch");
  assert.equal(a.auth.viewer, null); assert.equal(a.client.session(), null);
  assert.equal((await restoreSession(url, store))?.token ?? null, kept?.token ?? null);
  await until(async () => {
    try { return (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${rotated.token}` } })).json()).denied?.code === "E_AUTH"; }
    catch (error) {
      // Cancelling a held poll can close a pooled socket before this probe
      // reuses it. Retry observation; still require E_AUTH within the bound.
      if (error.cause?.code !== "UND_ERR_SOCKET") throw error;
      return false;
    }
  }, "late successor is revoked");
  const reopened = createApp({ url, sessionStore: store }); t.after(() => reopened.close());
  assert.equal((await reopened.ready).ok, true);
  assert.equal(reopened.auth.viewer, kept?.principal ?? null);
  if (loginBob) assert.deepEqual((await b.client.query(list, {})).data, []);
});

test("a sign-in started before another app's logout cannot overwrite its later login", { timeout: hangBudget(17) }, async t => {
  const { url } = await server(t), store = memorySessionStore();
  const b = createApp({ url, sessionStore: store }); t.after(() => b.close());
  await b.ready; await b.auth.signup("bob@example.com", "password-b");
  let release, issued;
  const gate = new Promise(resolve => { release = resolve; });
  const a = createApp({ url, sessionStore: store, fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (new URL(input).pathname === "/auth/guest") { issued = (await response.clone().json()).session; await gate; }
    return response;
  } });
  t.after(async () => { release(); await a.close(); });
  await a.ready;
  const signingIn = a.auth.guest();
  await until(() => issued);
  await b.auth.logout();
  const bob = await b.auth.login("bob@example.com", "password-b"); assert.equal(bob.ok, true);
  release(); assert.equal((await signingIn).ok, false);
  assert.equal(a.auth.state, "signed-out");
  assert.equal((await restoreSession(url, store)).token, bob.session.token);
  await until(async () => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${issued.token}` } })).json()).denied?.code === "E_AUTH");
  assert.deepEqual((await b.client.query(list, {})).data, []);
});

for (const damage of ["invalid JSON", "expired session"]) test(`restoration cleanup of ${damage} preserves a replacement written after its read`, { timeout: hangBudget(15) }, async t => {
  const { url } = await server(t), store = memorySessionStore();
  let held = false, release, requested = false, releaseResponse;
  const gate = new Promise(resolve => { release = resolve; });
  const responseGate = new Promise(resolve => { releaseResponse = resolve; });
  const a = createApp({ url, sessionStore: store, fetch: async (input, init) => {
    if (new URL(input).pathname === "/auth/refresh") { requested = true; await responseGate; }
    return fetch(input, init);
  } });
  t.after(async () => { release(); releaseResponse(); await a.close(); });
  await a.ready; await a.auth.guest();
  const bytes = damage === "invalid JSON" ? "NOTJSON" : JSON.stringify({ ...a.client.session(), expiresAt: 0 });
  await store.set(sessionKey(url), bytes);
  const refreshing = a.client.refreshSession();
  await until(() => requested);
  const b = createApp({ url, sessionStore: { ...store, async get(key) {
    const value = await store.get(key);
    if (key === sessionKey(url) && !held) { held = true; await gate; }
    return value;
  } } });
  t.after(async () => { release(); await b.close(); });
  await until(() => held, "B read the damaged session");
  releaseResponse();
  const rotated = await refreshing; assert.equal(rotated.ok, true);
  // A's onSession save is queued ahead of B's compare-and-delete cleanup.
  release(); assert.equal((await b.ready).ok, true);
  assert.equal((await restoreSession(url, store))?.token, rotated.session.token);
  assert.equal(b.client.session()?.token, rotated.session.token);
  assert.deepEqual((await a.client.query(list, {})).data, []);
});

test("expired stored-session cleanup deletes bytes without revoking the live bearer", { timeout: hangBudget(8) }, async t => {
  const { url } = await server(t), store = memorySessionStore();
  const a = createApp({ url, sessionStore: store }); t.after(() => a.close());
  await a.ready; await a.auth.guest();
  const token = a.client.session().token;
  await store.set(sessionKey(url), JSON.stringify({ ...a.client.session(), expiresAt: 0 }));
  const revocations = [];
  const b = createApp({ url, sessionStore: store, fetch: (input, init) => {
    if (new URL(input).pathname === "/auth/logout") revocations.push(init.headers.authorization);
    return fetch(input, init);
  } });
  t.after(() => b.close());
  await b.ready; assert.equal(b.auth.state, "signed-out");
  assert.equal(await restoreSession(url, store), null);
  assert.deepEqual(revocations, [], "garbage cleanup is not logout");
  assert.equal((await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${token}` } })).json()).denied, undefined);
});

test("refresh started after a shared logout refuses before dispatch even if remote logout failed", { timeout: hangBudget(12) }, async t => {
  const { url } = await server(t), store = memorySessionStore();
  let refreshes = 0;
  const a = createApp({ url, sessionStore: store, fetch: (input, init) => {
    if (new URL(input).pathname === "/auth/refresh") refreshes++;
    return fetch(input, init);
  } });
  t.after(() => a.close());
  await a.ready; await a.auth.guest();
  const token = a.client.session().token;
  const b = createApp({ url, sessionStore: store, fetch: (input, init) => {
    if (new URL(input).pathname === "/auth/logout") throw Error("offline logout");
    return fetch(input, init);
  } });
  t.after(() => b.close());
  await b.ready; assert.equal((await b.auth.logout()).ok, true);
  assert.equal((await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${token}` } })).json()).denied, undefined);
  const bob = await b.auth.signup("bob@example.com", "password-b"); assert.equal(bob.ok, true);
  const result = await a.client.refreshSession();
  assert.equal(result.ok, false); assert.equal(result.why.code, "E_AUTH");
  assert.equal(refreshes, 0);
  await until(() => a.auth.state === "signed-out");
  assert.equal((await restoreSession(url, store)).token, bob.session.token);
  assert.deepEqual((await b.client.query(list, {})).data, []);
});

for (const persistentFailure of [false, true]) test(`offline logout replaces credentials when its epoch write ${persistentFailure ? "keeps failing" : "exceeds quota"}`, { timeout: hangBudget(10) }, async t => {
  const { url } = await server(t), values = new Map();
  const key = sessionKey(url), epochKey = key + ".epoch";
  const size = () => [...values].reduce((total, [key, value]) => total + key.length + value.length, 0);
  let quota = Infinity, offline = false, markerAttempts = 0, deletions = 0;
  const store = {
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) {
      if (values.get(key) === value) return; // A full store still permits unchanged writes.
      if (offline && key === epochKey) markerAttempts++;
      const growth = key.length + value.length - (values.has(key) ? key.length + values.get(key).length : 0);
      if (size() + growth > quota || (offline && persistentFailure && key === epochKey)) {
        throw new DOMException("session storage quota exceeded", "QuotaExceededError");
      }
      values.set(key, value);
    },
    async delete(key) { if (key === sessionKey(url)) deletions++; values.delete(key); },
  };
  const fetcher = (input, init) => { if (offline) throw Error("offline"); return fetch(input, init); };
  const app = createApp({ url, sessionStore: store, fetch: fetcher }); t.after(() => app.close());
  await app.ready; assert.equal((await app.auth.guest()).ok, true);
  assert.equal(await store.get(epochKey), null);
  quota = size(); offline = true;
  await store.set(key, await store.get(key));
  const result = await app.auth.logout();
  assert.equal(deletions, 0, "the fallback tombstone remains as a durable fence");
  assert.equal(markerAttempts, 0, "one atomic record needs no separate marker writes");
  assert.equal(await restoreSession(url, store), null);
  assert.equal(app.auth.state, "signed-out");
  assert.equal(result.ok, true);
  assert.equal(app.auth.why, undefined);
  if (!persistentFailure) {
    assert.equal(JSON.parse(await store.get(key)).snapback4Logout, "1", "the tombstone commits the epoch exactly once");
    assert.equal(app.auth.why, undefined);
  }
  const reopened = createApp({ url, sessionStore: store, fetch: fetcher }); t.after(() => reopened.close());
  assert.equal((await reopened.ready).ok, true);
  assert.equal(reopened.auth.state, "signed-out");
});

test("near-expiry restoration defers automatic refresh until journal opening and comparison commit succeed", { timeout: hangBudget(22) }, async t => {
  const { url } = await server(t), store = memorySessionStore();
  let rotated, releaseResponse, journalHeld = false, releaseJournal, rejected = false;
  const responseGate = new Promise(resolve => { releaseResponse = resolve; });
  const journalGate = new Promise(resolve => { releaseJournal = resolve; });
  const b = createApp({ url, sessionStore: store, fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (new URL(input).pathname === "/auth/refresh") { rotated = (await response.clone().json()).session; await responseGate; }
    return response;
  } });
  t.after(async () => { releaseResponse(); releaseJournal(); await b.close(); });
  await b.ready; assert.equal((await b.auth.guest()).ok, true);
  await keepSession(url, { ...b.client.session(), expiresAt: Date.now() + 60_000 }, store);
  const refreshing = b.client.refreshSession();
  await until(() => rotated, "B's rotation committed, with its response still held");
  const a = createApp({ url, sessionStore: { ...store, async get(key) {
    const value = await store.get(key);
    if (key.endsWith(".writes") && !journalHeld) { journalHeld = true; await journalGate; }
    return value;
  } }, fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (new URL(input).pathname === "/auth/refresh") {
      assert.equal((await response.clone().json()).denied?.code, "E_AUTH");
      rejected = true;
    }
    return response;
  } });
  t.after(async () => { releaseJournal(); await a.close(); });
  await until(() => journalHeld, "A is opening journal custody");
  assert.equal(rejected, false, "a provisional constructor must not consume the saved bearer");
  releaseResponse(); assert.equal((await refreshing).ok, true);
  await until(async () => (await restoreSession(url, store))?.token === rotated.token);
  releaseJournal();
  assert.equal((await a.ready).ok, true, "A must reopen the successor rather than return E_CLOSED");
  assert.equal(a.auth.state, "signed-in"); assert.equal(a.auth.why, undefined);
  assert.equal(a.client.session()?.token, rotated.token);
  assert.equal((await restoreSession(url, store))?.token, rotated.token);
  assert.deepEqual((await a.client.query(list, {})).data, []);
  assert.deepEqual((await b.client.query(list, {})).data, [], "retry must not revoke the winning session family");
});

for (const quota of [false, true]) for (const operation of ["refresh", "login"]) test(`logout tombstone fences another app's held ${operation} when ${quota ? "quota blocks" : "storage rejects"} the epoch key`, { timeout: hangBudget(32) }, async t => {
  const { url } = await server(t), memory = memorySessionStore(), key = sessionKey(url);
  let full = false, release, issued, deletes = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const store = { ...memory,
    async set(k, value) {
      const old = await memory.get(k);
      // Full storage permits reads, deletes, unchanged writes and shrinking
      // an existing value, but cannot allocate the separate epoch key.
      if (full && value !== old && (k.endsWith(".epoch") || (quota && (old === null || value.length > old.length)))) {
        throw new DOMException("session storage quota exceeded", "QuotaExceededError");
      }
      await memory.set(k, value);
    },
    async delete(k) { if (k === key) deletes++; await memory.delete(k); },
  };
  const a = createApp({ url, sessionStore: store, fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (new URL(input).pathname === `/auth/${operation}`) { issued = (await response.clone().json()).session; await gate; }
    return response;
  } });
  t.after(async () => { release(); await a.close(); });
  await a.ready; assert.equal((await a.auth.signup("alice@example.com", "password-a")).ok, true);
  const b = createApp({ url, sessionStore: store }); t.after(() => b.close());
  await b.ready;
  const pending = operation === "refresh" ? a.client.refreshSession() : a.auth.login("alice@example.com", "password-a");
  await until(() => issued, "server issued the held bearer");
  full = true;
  assert.equal((await b.auth.logout()).ok, true, "a durable tombstone completes local logout");
  assert.equal(await memory.get(key + ".epoch"), null);
  const tombstone = await memory.get(key);
  assert.ok(tombstone); assert.equal(JSON.parse(tombstone).token, undefined);
  assert.equal(await restoreSession(url, store), null);
  assert.equal(await memory.get(key), tombstone, "invalid-session cleanup must retain the fence");
  assert.equal(deletes, 0, "never remove the fallback fence");
  const reopened = createApp({ url, sessionStore: store }); t.after(() => reopened.close());
  assert.equal((await reopened.ready).ok, true); assert.equal(reopened.auth.state, "signed-out");
  assert.equal(await memory.get(key), tombstone);
  // A later login carries the tombstone epoch in the same atomic record.
  const epochBlocked = { ...memory, async set(k, value) {
    if (k.endsWith(".epoch")) throw new DOMException("epoch still full", "QuotaExceededError");
    await memory.set(k, value);
  } };
  const c = createApp({ url, sessionStore: epochBlocked }); t.after(() => c.close()); await c.ready;
  const visitor = await c.auth.guest(); assert.equal(visitor.ok, true);
  assert.equal(JSON.parse(await memory.get(key)).snapback4Epoch, "1");
  release(); await pending;
  await until(() => a.auth.state === "signed-out");
  assert.equal((await restoreSession(url, store)).token, visitor.session.token, "the late bearer cannot overwrite the atomic replacement");
  await until(async () => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${issued.token}` } })).json()).denied?.code === "E_AUTH", "discarded bearer is revoked");
  full = false;
  const bob = await b.auth.signup("bob@example.com", "password-b"); assert.equal(bob.ok, true);
  assert.equal(JSON.parse(await memory.get(key)).snapback4Epoch, "2", "a second replacement commits a newer epoch atomically");
  assert.deepEqual((await b.client.query(list, {})).data, []);
});

test("logout does not delete or revoke before either durable fence can be stored", { timeout: hangBudget(12) }, async t => {
  const { url } = await server(t), memory = memorySessionStore();
  let broken = false, deletes = 0, revokes = 0;
  const store = { ...memory,
    async set(key, value) { if (broken) throw Error("storage unavailable"); await memory.set(key, value); },
    async delete(key) { deletes++; await memory.delete(key); },
  };
  const app = createApp({ url, sessionStore: store, fetch: (input, init) => {
    if (new URL(input).pathname === "/auth/logout") revokes++;
    return fetch(input, init);
  } });
  t.after(() => app.close());
  await app.ready; await app.auth.guest();
  const original = await memory.get(sessionKey(url));
  broken = true;
  const result = await app.auth.logout(); assert.equal(result.ok, false);
  assert.equal(result.why.code, "E_CLIENT"); assert.match(result.why.message, /storage unavailable/);
  await delay(50);
  assert.equal(deletes, 0); assert.equal(revokes, 0);
  assert.equal(await memory.get(sessionKey(url)), original);
  broken = false;
  assert.equal((await app.auth.logout()).ok, true);
  assert.equal(await restoreSession(url, store), null);
  await until(() => revokes > 0);
});

for (const maxBytes of [-1, 1.5]) test(`invalid local asset budget ${maxBytes} leaves a restored bearer untouched`, { timeout: hangBudget(12) }, async t => {
  const { url, dir } = await server(t), memory = memorySessionStore();
  const original = createApp({ url, sessionStore: memory });
  await original.ready; await original.auth.guest();
  const session = original.client.session(); await original.close();
  const stored = await memory.get(sessionKey(url)), calls = [];
  const store = Object.fromEntries(["get", "set", "delete"].map(method => [method, (...args) => { calls.push(method); return memory[method](...args); }]));
  const app = createApp({ url, sessionStore: store, device: processDevice({ dir: join(dir, "bad-budget"), binary }),
    assets: { keep: "viewed", maxBytes }, fetch: (...args) => { calls.push("fetch"); return fetch(...args); },
  });
  t.after(() => app.close());
  const ready = await app.ready;
  assert.equal(ready.ok, false); assert.equal(ready.why.code, "E_CLIENT");
  assert.equal(ready.why.site, "app.assets"); assert.match(ready.why.rewrite, /maxBytes/);
  assert.deepEqual(app.auth.why, ready.why);
  assert.equal((await app.auth.guest()).ok, false);
  assert.deepEqual(calls, [], "configuration is checked before storage, network or client opening");
  assert.equal(await memory.get(sessionKey(url)), stored);
  assert.equal((await restoreSession(url, memory)).token, session.token);
  assert.equal((await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${session.token}` } })).json()).denied, undefined);
  const repaired = createApp({ url, sessionStore: memory, device: processDevice({ dir: join(dir, "good-budget"), binary }), assets: { keep: "viewed", maxBytes: 67108864 } });
  t.after(() => repaired.close());
  assert.equal((await repaired.ready).ok, true); assert.equal(repaired.auth.viewer, session.principal);
});

for (const operation of ["refresh", "login"]) for (const releaseAfterRetry of [false, true]) test(`failed fence revokes a discarded ${operation} ${releaseAfterRetry ? "after" : "before"} logout retry`, { timeout: hangBudget(22) }, async t => {
  const { url } = await server(t), memory = memorySessionStore();
  let broken = false, issued, release;
  const gate = new Promise(resolve => { release = resolve; }), revocations = [];
  const store = { ...memory, async set(key, value) {
    if (broken) throw Error("every session-store set is failing");
    await memory.set(key, value);
  } };
  const app = createApp({ url, sessionStore: store, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/auth/logout") revocations.push(new Headers(init.headers).get("authorization"));
    const response = await fetch(input, init);
    if (path === `/auth/${operation}`) { issued = (await response.clone().json()).session; await gate; }
    return response;
  } });
  t.after(async () => { release(); await app.close(); });
  await app.ready; await app.auth.signup("alice@example.com", "password-a");
  const original = app.client.session();
  const pending = operation === "refresh" ? app.client.refreshSession() : app.auth.login("alice@example.com", "password-a");
  await until(() => issued, "server committed the held bearer");
  broken = true;
  assert.equal((await app.auth.logout()).ok, false);
  assert.equal(app.auth.state, "signed-out");
  assert.equal((await restoreSession(url, memory)).token, original.token);
  assert.deepEqual(revocations, [], "failed fence must protect the stored bearer");
  if (releaseAfterRetry) {
    broken = false;
    assert.equal((await app.auth.logout()).ok, true);
  }
  release(); assert.equal((await pending).ok, false);
  await until(() => revocations.includes(`Bearer ${issued.token}`), "discarded bearer is dispatched for revocation");
  await until(async () => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${issued.token}` } })).json()).denied?.code === "E_AUTH", "discarded bearer is no longer live");
  if (!releaseAfterRetry) {
    assert.ok(!revocations.includes(`Bearer ${original.token}`), "still-stored bearer remains exempt");
    assert.equal((await restoreSession(url, memory)).token, original.token);
    if (operation === "login") assert.equal((await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${original.token}` } })).json()).denied, undefined);
    broken = false;
    assert.equal((await app.auth.logout()).ok, true);
  }
  assert.equal(await restoreSession(url, memory), null);
});

test("logout retry revokes a discarded login after its token-comparison read throws", { timeout: hangBudget(22) }, async t => {
  const { url } = await server(t), memory = memorySessionStore(), key = sessionKey(url);
  let brokenWrites = false, brokenRead = false, comparedOriginal = false, failedReads = 0, issued, release;
  const gate = new Promise(resolve => { release = resolve; }), failedWrites = [], revocations = [];
  const store = { ...memory,
    async set(k, value) {
      if (brokenWrites) { failedWrites.push(k); throw Error("both logout fences are unavailable"); }
      await memory.set(k, value);
    },
    async get(k) {
      if (k === key && brokenRead) { failedReads++; throw Error("token comparison is unavailable"); }
      if (k === key && failedWrites.includes(key)) comparedOriginal = true;
      return memory.get(k);
    },
  };
  const app = createApp({ url, sessionStore: store, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/auth/logout") revocations.push(new Headers(init.headers).get("authorization"));
    const response = await fetch(input, init);
    if (path === "/auth/login") { issued = (await response.clone().json()).session; await gate; }
    return response;
  } });
  t.after(async () => { release(); await app.close(); });
  await app.ready;
  assert.equal((await app.auth.signup("alice@example.com", "password-a")).ok, true);
  const original = app.client.session(), saved = await memory.get(key);
  const pending = app.auth.login("alice@example.com", "password-a");
  await until(() => issued, "server committed the held login bearer");
  assert.notEqual(issued.token, original.token);
  brokenWrites = true;
  assert.equal((await app.auth.logout()).ok, false);
  assert.deepEqual(failedWrites.filter(k => k === key || k === key + ".epoch"), [key], "the atomic session-and-epoch fence failed before any revocation");
  await until(() => comparedOriginal, "the stored bearer was compared before the read outage");
  brokenRead = true;
  release(); assert.equal((await pending).ok, false);
  await until(() => failedReads > 0, "discarded login token comparison threw");
  assert.equal(app.auth.state, "signed-out");
  assert.equal(await memory.get(key), saved, "failed fences preserve the stored bearer");
  assert.deepEqual(revocations, [], "an unreadable store cannot authorize revocation yet");
  assert.equal((await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${issued.token}` } })).json()).denied, undefined);
  brokenWrites = false; brokenRead = false;
  assert.equal((await app.auth.logout()).ok, true);
  assert.equal(await restoreSession(url, memory), null);
  await until(async () => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${issued.token}` } })).json()).denied?.code === "E_AUTH", "retry revoked the login token deferred by the failed comparison");
});

test("logout retry drains deferred revocation after a newer login of the same account", { timeout: hangBudget(15) }, async t => {
  const { url } = await server(t), memory = memorySessionStore(), key = sessionKey(url);
  let broken = false, failedFence = false, compared = false;
  const revocations = [];
  const store = { ...memory,
    async set(k, value) {
      if (broken) { if (k === key) failedFence = true; throw Error("storage cannot write the fence"); }
      await memory.set(k, value);
    },
    async get(k) { const value = await memory.get(k); if (failedFence && k === key) compared = true; return value; },
  };
  const a = createApp({ url, sessionStore: store, fetch: (input, init) => {
    if (new URL(input).pathname === "/auth/logout") revocations.push(new Headers(init.headers).get("authorization"));
    return fetch(input, init);
  } });
  t.after(() => a.close());
  await a.ready; await a.auth.signup("logout-retry@example.test", "logout-retry-password");
  const original = a.client.session();
  broken = true;
  assert.equal((await a.auth.logout()).ok, false);
  await until(() => compared, "revocation compares and defers the still-stored bearer");
  assert.deepEqual(revocations, []);
  assert.equal((await a.auth.logout()).ok, false, "another failed fence must not discard the deferred token");
  broken = false;
  const b = createApp({ url, sessionStore: memory }); t.after(() => b.close());
  await b.ready; const replacement = await b.auth.login("logout-retry@example.test", "logout-retry-password"); assert.equal(replacement.ok, true);
  assert.notEqual(replacement.session.token, original.token);
  assert.equal((await a.auth.logout()).ok, true);
  await until(() => revocations.includes(`Bearer ${original.token}`), "retry drains the retired owner's deferred token too");
  assert.equal(replacement.session.principal, original.principal);
  for (const token of [original.token, replacement.session.token]) await until(async () => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${token}` } })).json()).denied?.code === "E_AUTH");
  assert.equal(await restoreSession(url, memory), null);
});

test("sign-in keeps the tombstone until its epoch promotion is durable", { timeout: hangBudget(16) }, async t => {
  const { url } = await server(t), memory = memorySessionStore(), key = sessionKey(url);
  let blockEpoch = false, holdEpoch = false, held = false, release;
  const gate = new Promise(resolve => { release = resolve; });
  const store = { ...memory, async set(k, value) {
    if (k === key + ".epoch" && blockEpoch) throw Error("epoch key unavailable");
    if (k === key && JSON.parse(value).token && holdEpoch) { held = true; await gate; }
    await memory.set(k, value);
  } };
  const app = createApp({ url, sessionStore: store });
  t.after(async () => { release(); await app.close(); });
  await app.ready; await app.auth.guest();
  blockEpoch = true;
  assert.equal((await app.auth.logout()).ok, true);
  const tombstone = await memory.get(key); assert.ok(tombstone);
  assert.equal(JSON.parse(tombstone).token, undefined);
  assert.equal(await memory.get(key + ".epoch"), null);
  blockEpoch = false; holdEpoch = true;
  const signingIn = app.auth.guest();
  await until(() => held, "replacement is held before its single atomic write commits");
  assert.equal(JSON.parse(await memory.get(key)).snapback4Logout, JSON.parse(tombstone).snapback4Logout, "no window may expose a bearer without its durable epoch");
  assert.equal(await memory.get(key + ".epoch"), null);
  assert.equal(await restoreSession(url, memory), null);
  release(); const result = await signingIn; assert.equal(result.ok, true);
  assert.equal(JSON.parse(await memory.get(key)).snapback4Epoch, "1");
  assert.equal((await restoreSession(url, memory)).token, result.session.token);
});

test("local restoration captures the asset budget before the caller mutates it", { timeout: hangBudget(7) }, async t => {
  const { url, dir } = await server(t), store = memorySessionStore();
  const original = createApp({ url, sessionStore: store });
  await original.ready; await original.auth.guest();
  const kept = original.client.session(); await original.close();
  const assets = { keep: "viewed", maxBytes: 67108864 }, revocations = [];
  const app = createApp({ url, sessionStore: store, assets, device: processDevice({ dir: join(dir, "captured-assets"), binary }),
    fetch: (input, init) => {
      if (new URL(input).pathname === "/auth/logout") revocations.push(input);
      return fetch(input, init);
    },
  });
  assets.maxBytes = -1;
  t.after(() => app.close());
  assert.equal((await app.ready).ok, true, "opening must use the captured valid policy");
  assert.equal(app.auth.state, "signed-in"); assert.equal(app.auth.why, undefined);
  assert.equal(app.client.session().token, kept.token);
  assert.equal((await restoreSession(url, store)).token, kept.token);
  assert.deepEqual(revocations, []);
  assert.deepEqual((await app.client.query(list, {})).data, []);
});

test("the native instrumentation hook receives createApp's own restored client", async t => {
  const { url, dir } = await server(t);
  const storage = memorySessionStore();
  const native = processDevice({ dir: join(dir, "device"), binary });
  const attached = [];
  const device = { async open(...args) {
    const core = await native.open(...args);
    return { ...core, onClient(client, origin) { attached.push({ client, origin }); } };
  } };
  let app = createApp({ url, device, sessionStore: storage });
  t.after(() => app.close());
  await app.ready; assert.equal(attached.length, 0);
  assert.equal((await app.auth.guest()).ok, true);
  assert.equal(attached.length, 1); assert.equal(attached[0].client, app.client); assert.equal(attached[0].origin, url);
  await app.close();
  app = createApp({ url, device, sessionStore: storage });
  await app.ready;
  assert.equal(attached.length, 2); assert.equal(attached[1].client, app.client);
  assert.notEqual(attached[1].client, attached[0].client);
  await app.close(); // Stop its long poll before the server fixture tears down.
});

test("native smoke observes only the published replacement of a near-expiry restored session", { timeout: hangBudget(17) }, async t => {
  const { url, dir } = await server(t);
  const storage = memorySessionStore();
  const initial = createApp({ url, sessionStore: storage });
  await initial.ready; assert.equal((await initial.auth.guest()).ok, true);
  const saved = initial.client.session(); await initial.close();
  // The launch must carry the real served compiler facts, just as the driver
  // does. Session replacement must not bypass the helper's residency checks.
  const response = await fetch(url + '/schema', { headers: { authorization: `Bearer ${saved.token}` } });
  assert.equal(response.status, 200);
  const backend = await response.json();
  const queryFacts = Object.fromEntries(backend.programs.filter(program => program.kind === 'Query'
    && Object.values(program.args).every(type => type !== null && typeof type === 'object' && 'Optional' in type))
    .map(program => {
      const fact = backend.schema.operations[program.name];
      return [program.name, { runs: fact.runs, held: fact.held ?? false }];
    }));
  assert.deepEqual(Object.keys(queryFacts), ['list']);
  await keepSession(url, { ...saved, expiresAt: Date.now() + 3600_000 }, storage);
  const receipts = [], published = [];
  const runner = createSmoke({ witnessLaunch: JSON.stringify({ smoke: true, segment: 'prime', timeoutMs: hangBudget(),
    queryFacts, queryGeneration: backend.generation }),
    witnessAppend: line => receipts.push(JSON.parse(line)), witnessSignaled: () => false }, {
    errors: { getGlobalHandler: () => () => {}, setGlobalHandler: () => {} },
  });
  const native = processDevice({ dir: join(dir, 'device'), binary });
  let opens = 0, closes = 0, detached = 0, constructing = false, replaced = false;
  const racedStore = { ...storage, async get(key) {
    if (key === sessionKey(url) && constructing && !replaced) {
      replaced = true;
      // Another owner rotates the saved successor while this constructor is
      // finishing. The real guarded keepSession must discard this candidate.
      const kept = await restoreSession(url, storage);
      const successor = await refreshSession(url, kept.token);
      assert.equal(successor.ok, true);
      await keepSession(url, successor.session, storage);
    }
    return storage.get(key);
  } };
  const device = { async open(...args) {
    const core = await native.open(...args);
    opens++;
    return { ...core, async call(request, ...rest) {
      const result = await core.call(request, ...rest);
      if (request.op === 'state') constructing = true;
      return result;
    }, close: async () => { closes++; await core.close(); }, onClient(client, origin) {
      published.push({ client, isPublished: app.client === client && app.auth.state === 'signed-in' });
      const stop = runner.attach(client, core, origin);
      return () => { detached++; stop(); };
    } };
  } };
  const app = createApp({ url, device, sessionStore: racedStore });
  t.after(async () => { await app.close(); runner.dispose(); });
  assert.equal((await app.ready).ok, true);
  assert.equal(opens, 2, 'the rotated restoration must retry with its saved successor');
  assert.equal(closes, 1, 'the unpublished candidate was closed');
  assert.equal(published.length, 1);
  assert.ok(published.every(entry => entry.isPublished), 'a constructor candidate must never reach the witness');
  assert.notEqual(app.client.session().token, saved.token);
  await until(() => receipts.some(row => row.witness.step === 'primed'), 'replacement smoke receipt');
  assert.ok(!receipts.some(row => row.witness.step.endsWith(':failed')));
  const smoke = receipts.find(row => row.smoke).smoke;
  assert.equal(smoke.pass, true);
  assert.deepEqual(smoke.queryFacts, queryFacts);
  assert.equal(smoke.queryGeneration, backend.generation);
  assert.equal(smoke.generation, backend.generation);
  await app.close(); assert.equal(detached, 1);
});

for (const ending of ['sign-out', 'replacement']) test(`committed refresh body survives ${ending} and its unkept bearer is revoked`, async t => {
  const { url } = await server(t), { createClient } = await import('../dist/client.js');
  const session = (await (await fetch(url + '/auth/guest', { method: 'POST', body: '{}' })).json()).session;
  let release, replace, rotated;
  const body = new Promise(resolve => { release = resolve; }), change = new Promise(resolve => { replace = resolve; });
  const logouts = [];
  const client = createClient({ url, session, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/auth/logout') logouts.push(new Headers(init.headers).get('authorization'));
    if (path.startsWith('/q/') && JSON.parse(init.body).args.replace) {
      await change; return Response.json({ data: [], store_id: 'replacement', seq: 1 });
    }
    const response = await fetch(input, init);
    if (path === '/auth/refresh') { rotated = (await response.clone().json()).session; await body; }
    return response; // Actual fetch body rejects if its signal was aborted.
  } });
  t.after(async () => { release(); replace(); await client.close(); });
  await client.query(list, {});
  const changing = ending === 'replacement' ? client.query(list, { replace: true }) : null;
  const refreshing = client.refreshSession(); await until(() => rotated);
  if (changing) { replace(); assert.equal((await changing).denied.code, 'E_STORE_REPLACED'); }
  else await client.signOut();
  assert.equal((await withHangGuard(() => refreshing, 'caller still waits for the refresh body')).ok, false);
  release();
  await until(async () => (await (await fetch(url + '/probe', { headers: { authorization: `Bearer ${rotated.token}` } })).json()).denied?.code === 'E_AUTH', 'unkept successor is revoked');
  assert.ok(logouts.includes(`Bearer ${rotated.token}`));
  if (ending === 'sign-out') assert.ok(logouts.includes(`Bearer ${session.token}`));
});

for (const kind of ['mutation', 'upload']) test(`local close cancels a ${kind} caller without aborting its committed response`, async t => {
  const { url, dir } = await server(t); let release, entered = false, signal, consumed = false;
  const gate = new Promise(resolve => { release = resolve; });
  const sessionStore = memorySessionStore(), options = { url, sessionStore, device: processDevice({ dir: join(dir, 'effect-device'), binary }) };
  const app = createApp({ ...options, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    const effect = kind === 'mutation' ? path === '/m/add' : path === '/assets';
    const response = effect && kind === 'upload' ? Response.json({ asset: { id: 'unplaced', type: 'image/png', bytes: 1 } }) : await fetch(input, init);
    if (effect) {
      await response.clone().json(); signal = init.signal; entered = true; await gate;
      const read = response.json.bind(response); response.json = async () => { const value = await read(); consumed = true; return value; };
    }
    return response;
  } });
  t.after(async () => { release(); await app.close(); });
  await app.ready; await app.auth.guest(); const prior = app.client;
  const outcome = kind === 'mutation' ? app.mutate(add, { body: 'committed' }) : prior.upload(new Uint8Array([1]));
  await until(() => entered); assert.equal(signal, undefined);
  await withHangGuard(() => app.close(), 'close waited for an effect body');
  if (kind === 'upload') assert.equal((await outcome).why?.code, 'E_CLOSED');
  const write = await outcome;
  if (kind === 'mutation') {
    const offline = createApp({ ...options, fetch: async () => { throw new TypeError('offline'); } });
    t.after(() => offline.close()); assert.equal((await offline.ready).ok, true);
    const known = await offline.client.write(write.id);
    assert.ok(known && ['pending', 'sent'].includes(known.state), 'reopening the SQLite device must retain the cancelled caller id');
    await offline.close();
  }
  release(); await until(() => consumed, 'the background reply was consumed');
  if (kind === 'mutation') {
    const online = createApp(options); t.after(() => online.close()); await online.ready;
    await until(async () => (await online.client.write(write.id))?.state === 'sent', 'the original id settles after reopening');
    const rows = await until(async () => { const read = await online.client.query(list, {}); return read.data?.length && read.data; });
    assert.equal(rows.length, 1, 'retrying the original id never duplicates the committed mutation');
  }
});


for (const afterReopen of [false, true]) test(`online app keeps an unrotated bearer when refresh rejects ${afterReopen ? 'after' : 'before'} replacement reopens`, async t => {
  const { url } = await server(t), sessionStore = memorySessionStore();
  let releaseRefresh, releaseChange, releaseProbe, rotating = false, rejected = false, probing = false;
  const refreshGate = new Promise(resolve => { releaseRefresh = resolve; });
  const changeGate = new Promise(resolve => { releaseChange = resolve; });
  const probeGate = new Promise(resolve => { releaseProbe = resolve; });
  const probes = [], logouts = [], logoutRequests = [];
  const app = createApp({ url, sessionStore, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/auth/refresh') {
      rotating = true; await refreshGate; rejected = true;
      throw new TypeError('connection reset before reaching the server');
    }
    if (path === '/q/list' && JSON.parse(init.body).args.replace) {
      await changeGate; return Response.json({ data: [], seq: 1, store_id: 'replacement' });
    }
    if (path === '/probe') { probes.push(new Headers(init.headers).get('authorization')); probing = true; await probeGate; }
    if (path === '/auth/logout') {
      logouts.push(new Headers(init.headers).get('authorization'));
      // Use the real auth server: cleanup must actually revoke the bearer.
      const request = fetch(input, init); logoutRequests.push(request); return request;
    }
    return fetch(input, init);
  } });
  t.after(async () => { releaseRefresh(); releaseChange(); releaseProbe(); await app.close(); });
  await app.ready; await app.auth.guest();
  const prior = app.client, original = prior.session(); await prior.query(list, {});
  const changing = prior.query(list, { replace: true }), refreshing = prior.refreshSession();
  await until(() => rotating); releaseChange();
  assert.equal((await changing).denied.code, 'E_STORE_REPLACED');
  assert.equal((await refreshing).ok, false); await until(() => probing);
  const reopen = async () => {
    releaseProbe(); await until(() => app.auth.state !== 'restoring');
    assert.equal(app.auth.state, 'signed-in'); assert.notEqual(app.client, prior);
    assert.equal(app.client.session().token, original.token);
  };
  if (afterReopen) await reopen();
  releaseRefresh(); await until(() => rejected); await delay(0);
  await Promise.all(logoutRequests); // Any erroneous cleanup has reached the server before the assertions.
  if (!afterReopen) await reopen();
  assert.deepEqual(probes, [`Bearer ${original.token}`]);
  assert.equal((await restoreSession(url, sessionStore)).token, original.token);
  assert.deepEqual((await app.client.query(list, {})).data, []);
  assert.equal(app.auth.state, 'signed-in', 'late rejection must leave the recovered app signed in');
  assert.deepEqual(logouts, [], 'a failed rotation must not revoke the bearer used by recovery');
  assert.equal((await app.auth.logout()).ok, true);
  await until(async () => (await (await fetch(url + '/probe', { headers: { authorization: `Bearer ${original.token}` } })).json()).denied?.code === 'E_AUTH', 'explicit logout really invalidates the saved bearer');
});

for (const restart of [false, true]) test(`sign-in after a failed fence advances the epoch${restart ? " after restart" : " in the same runtime"}`, { timeout: hangBudget(20) }, async t => {
  const { url } = await server(t), memory = memorySessionStore();
  let broken = false, refreshes = 0;
  const store = { ...memory, async set(key, value) { if (broken) throw Error("all writes fail"); await memory.set(key, value); } };
  let a = createApp({ url, sessionStore: store }); t.after(() => a.close());
  await a.ready; await a.auth.signup("alice@example.com", "password-a");
  const alice = a.client.session();
  const b = createApp({ url, sessionStore: store, fetch: (input, init) => {
    if (new URL(input).pathname === "/auth/refresh") refreshes++;
    return fetch(input, init);
  } }); t.after(() => b.close()); await b.ready;
  broken = true; assert.equal((await a.auth.logout()).ok, false);
  assert.equal((await restoreSession(url, memory)).token, alice.token);
  if (restart) await a.close();
  broken = false;
  if (restart) { a = createApp({ url, sessionStore: store }); assert.equal((await a.ready).ok, true); }
  const visitor = await a.auth.guest(); assert.equal(visitor.ok, true);
  assert.notEqual(visitor.session.principal, alice.principal);
  assert.equal(JSON.parse(await memory.get(sessionKey(url))).snapback4Epoch, "1");
  const refreshed = await b.client.refreshSession();
  assert.equal(refreshed.ok, false); assert.equal(refreshed.why.code, "E_AUTH");
  assert.equal(refreshes, 0, "old owner is fenced before a refresh is dispatched");
  await until(() => b.auth.state === "signed-out");
  assert.equal((await restoreSession(url, memory)).token, visitor.session.token);
  await until(async () => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${alice.token}` } })).json()).denied?.code === "E_AUTH", "displaced Alice bearer is revoked");
  assert.deepEqual((await a.client.query(list, {})).data, []);
  const reopened = createApp({ url, sessionStore: store }); t.after(() => reopened.close());
  assert.equal((await reopened.ready).ok, true); assert.equal(reopened.auth.viewer, visitor.session.principal);
  assert.deepEqual((await reopened.client.query(list, {})).data, []);
});

for (const failure of ["offline", "refusal"]) test(`displaced-bearer revocation survives restart after ${failure} instead of acknowledgement`, { timeout: hangBudget(13) }, async t => {
  const { url } = await server(t), store = memorySessionStore();
  let attempts = 0;
  const a = createApp({ url, sessionStore: store, fetch: (input, init) => {
    if (new URL(input).pathname === "/auth/logout") {
      attempts++;
      if (failure === "offline") throw Error("logout transport offline");
      return Response.json({ denied: { code: "E_CLIENT", message: "logout not accepted" } });
    }
    return fetch(input, init);
  } }); t.after(() => a.close());
  await a.ready; await a.auth.guest(); const displaced = a.client.session();
  const visitor = await a.auth.guest(); assert.equal(visitor.ok, true);
  await until(() => attempts > 0, "displacement attempts remote revocation");
  await a.close();
  assert.equal((await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${displaced.token}` } })).json()).denied, undefined);
  const b = createApp({ url, sessionStore: store }); t.after(() => b.close());
  assert.equal((await b.ready).ok, true); assert.equal(b.auth.viewer, visitor.session.principal);
  await until(async () => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${displaced.token}` } })).json()).denied?.code === "E_AUTH", "restart replays the durable retirement");
  assert.deepEqual((await b.client.query(list, {})).data, [], "retirement never revokes the current bearer");
});

for (const failAt of ["journal", "epoch", "bearer"]) test(`failed ${failAt} write during sign-in preserves the displaced session bytes`, { timeout: hangBudget(11) }, async t => {
  const { url } = await server(t), memory = memorySessionStore(), key = sessionKey(url);
  let armed = false;
  const store = { ...memory, async set(k, value) {
    if (armed && (failAt === "journal" ? k === key + ".revocations" : k === key && (failAt === "bearer" || JSON.parse(value).snapback4Epoch === "1"))) throw Error("cutover storage failure");
    await memory.set(k, value);
  } };
  const a = createApp({ url, sessionStore: store }); t.after(() => a.close());
  await a.ready; await a.auth.guest();
  const kept = a.client.session(), bytes = await memory.get(key);
  armed = true;
  const failed = await a.auth.guest(); assert.equal(failed.ok, false); assert.equal(failed.why.code, "E_CLIENT");
  assert.equal(await memory.get(key), bytes);
  assert.equal(await memory.get(key + ".epoch"), null);
  assert.equal(JSON.parse(await memory.get(key)).snapback4Epoch, "0", "a failed commit never advances the epoch");
  armed = false;
  const b = createApp({ url, sessionStore: memory }); t.after(() => b.close());
  assert.equal((await b.ready).ok, true); assert.equal(b.client.session().token, kept.token);
  assert.deepEqual((await b.client.query(list, {})).data, [], "a staged revocation must skip the still-stored bearer");
});

for (const ending of ["logout", "sign-in"]) test(`a comparison read failure retains a discarded login for the next successful ${ending}`, { timeout: hangBudget(20) }, async t => {
  const { url } = await server(t), memory = memorySessionStore(), key = sessionKey(url);
  let broken = false, failedFence = false, comparisons = 0, unreadable = false, readFailures = 0, issued, release;
  const gate = new Promise(resolve => { release = resolve; }), revocations = [];
  const store = { ...memory,
    async set(k, value) { if (broken) { if (k === key) failedFence = true; throw Error("fence writes fail"); } await memory.set(k, value); },
    async get(k) {
      if (k === key && failedFence) {
        comparisons++;
        if (unreadable) { readFailures++; throw Error("comparison read fails"); }
      }
      return memory.get(k);
    },
  };
  const app = createApp({ url, sessionStore: store, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/auth/logout") revocations.push(new Headers(init.headers).get("authorization"));
    const response = await fetch(input, init);
    if (path === "/auth/login") { issued = (await response.clone().json()).session; await gate; }
    return response;
  } }); t.after(async () => { release(); await app.close(); });
  await app.ready; await app.auth.signup("alice@example.com", "password-a");
  const pending = app.auth.login("alice@example.com", "password-a"); await until(() => issued);
  broken = true; assert.equal((await app.auth.logout()).ok, false);
  await until(() => comparisons > 0, "stored bearer comparison completes before the held login is released");
  unreadable = true; release(); assert.equal((await pending).ok, false);
  await until(() => readFailures > 0);
  assert.deepEqual(revocations, [], "an unreadable store does not authorize revoking a potentially stored token");
  unreadable = false; broken = false;
  if (ending === "logout") assert.equal((await app.auth.logout()).ok, true);
  else assert.equal((await app.auth.guest()).ok, true);
  await until(() => revocations.includes(`Bearer ${issued.token}`));
  await until(async () => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${issued.token}` } })).json()).denied?.code === "E_AUTH");
  if (ending === "sign-in") assert.deepEqual((await app.client.query(list, {})).data, []);
});

test("a foreign revocation journal never sends its bearer to this backend", { timeout: hangBudget(5) }, async t => {
  const { url } = await server(t), store = memorySessionStore(), revocations = [];
  const saved = JSON.stringify({ backend: "https://another-backend.invalid", tokens: ["foreign-secret"] });
  await store.set(sessionKey(url) + ".revocations", saved);
  const app = createApp({ url, sessionStore: store, fetch: (input, init) => {
    if (new URL(input).pathname === "/auth/logout") revocations.push(new Headers(init.headers).get("authorization"));
    return fetch(input, init);
  } }); t.after(() => app.close());
  assert.equal((await app.ready).ok, true);
  await until(() => app.auth.why?.code === "E_CLIENT");
  assert.deepEqual(revocations, []);
  assert.equal(await store.get(sessionKey(url) + ".revocations"), saved, "preserve the damaged obligation for repair");
});

for (const failAt of ["fourth save", "device opening"]) test(`replacement preserves a guest when ${failAt} fails`, { timeout: hangBudget(11) }, async t => {
  const { url, dir } = await server(t), memory = memorySessionStore(), key = sessionKey(url), revoked = [];
  let writes = 0, rejectDevice = false;
  const device = processDevice({ dir: join(dir, "provisional-device"), binary });
  const store = { ...memory, async set(k, value) {
    if (k === key && ++writes === 4 && failAt === "fourth save") throw Error("fourth session save failed");
    await memory.set(k, value);
  } };
  const app = createApp({ url, sessionStore: store,
    ...(failAt === "device opening" ? { device: { open(...args) { if (rejectDevice) throw Error("device opening failed"); return device.open(...args); } } } : {}),
    fetch: (input, init) => {
      if (new URL(input).pathname === "/auth/logout") revoked.push(new Headers(init.headers).get("authorization"));
      return fetch(input, init);
    },
  }); t.after(() => app.close());
  await app.ready; assert.equal((await app.auth.guest()).ok, true);
  const old = app.client.session(), before = await memory.get(key);
  rejectDevice = true;
  const replacement = await app.auth.guest();
  if (failAt === "device opening") assert.equal(replacement.ok, false);
  if (!replacement.ok) {
    assert.equal(await memory.get(key), before, "failed opening cannot displace the previous guest");
    assert.equal((await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${old.token}` } })).json()).denied, undefined);
    assert.ok(!revoked.includes(`Bearer ${old.token}`));
  } else {
    // Atomic opening eliminates the old second/fourth save entirely.
    assert.equal(writes, 2);
    assert.equal((await restoreSession(url, memory)).token, replacement.session.token);
    await until(() => revoked.includes(`Bearer ${old.token}`));
  }
});

test("failed replacement cannot advance the epoch or make a peer revoke the stored bearer", { timeout: hangBudget(13) }, async t => {
  const { url } = await server(t), memory = memorySessionStore(), key = sessionKey(url), revoked = [];
  let failing = false;
  const store = { ...memory, async set(k, value) { if (failing && k === key) throw Error("bearer commit failed"); await memory.set(k, value); } };
  const fetcher = (input, init) => { if (new URL(input).pathname === "/auth/logout") revoked.push(new Headers(init.headers).get("authorization")); return fetch(input, init); };
  const a = createApp({ url, sessionStore: store, fetch: fetcher }); t.after(() => a.close());
  await a.ready; await a.auth.guest();
  const old = a.client.session(), before = await memory.get(key);
  const b = createApp({ url, sessionStore: store, fetch: fetcher }); t.after(() => b.close()); await b.ready;
  failing = true; assert.equal((await a.auth.guest()).ok, false);
  assert.equal(await memory.get(key), before); assert.equal(JSON.parse(before).snapback4Epoch, "0");
  assert.ok(!revoked.includes(`Bearer ${old.token}`), "the still-stored bearer was not revoked");
  failing = false;
  const rotated = await b.client.refreshSession(); assert.equal(rotated.ok, true);
  await until(async () => (await restoreSession(url, memory)).token === rotated.session.token);
  assert.equal(JSON.parse(await memory.get(key)).snapback4Epoch, "0", "the peer stays in the original epoch");
  assert.deepEqual((await b.client.query(list, {})).data, []);
});

test("acknowledged retirement removes journal and tombstone entries", { timeout: hangBudget(10) }, async t => {
  const { url } = await server(t), store = memorySessionStore(), key = sessionKey(url);
  const app = createApp({ url, sessionStore: store }); t.after(() => app.close()); await app.ready;
  for (let n = 0; n < 5; n++) {
    assert.equal((await app.auth.guest()).ok, true);
    await until(async () => await store.get(key + ".revocations") === null, "acknowledged journal is retired");
  }
  assert.equal((await app.auth.logout()).ok, true);
  await until(async () => !JSON.parse(await store.get(key)).snapback4Retired.length, "acknowledged tombstone is retired");
  await until(async () => await store.get(key + ".revocations") === null);
});

test("an observed replacement fences device reads, cached watches and native asset credentials", { timeout: hangBudget(9) }, async t => {
  const { url, dir } = await server(t), store = memorySessionStore();
  const a = createApp({ url, sessionStore: store, device: processDevice({ dir: join(dir, "cached-epoch"), binary }) });
  t.after(() => a.close()); await a.ready; await a.auth.guest();
  const old = a.client, watched = old.observe(list, {}); t.after(() => watched.close());
  await until(() => Array.isArray(watched.getSnapshot().data));
  const b = createApp({ url, sessionStore: store, fetch: (input, init) => {
    if (new URL(input).pathname === "/auth/logout") throw Error("remote revocation offline");
    return fetch(input, init);
  } }); t.after(() => b.close()); await b.ready; await b.auth.guest();
  assert.equal((await old.query(list, {})).denied.code, "E_AUTH");
  assert.equal(watched.getSnapshot().denied.code, "E_AUTH");
  assert.deepEqual(old.assetSource("old-private-asset").headers, {});
  assert.equal((await old.asset("old-private-asset")).denied.code, "E_AUTH");
  assert.equal((await old.mutate(add, { body: "old account" })).why.code, "E_AUTH");
});

test("a provisional online login cannot replay pending writes before its session commits", { timeout: hangBudget(12) }, async t => {
  const { url } = await server(t), memory = memorySessionStore(), key = sessionKey(url);
  let failCommit = false, initial, candidate; const sent = [];
  const app = createApp({ url, sessionStore: { ...memory, async set(k, value) {
    if (failCommit && k === key) throw Error("candidate commit failed"); await memory.set(k, value);
  } }, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/m/add") {
      const token = new Headers(init.headers).get("authorization");
      if (token === `Bearer ${initial}`) throw Error("original account transport offline");
      sent.push({ token, ...JSON.parse(init.body) });
    }
    const response = await fetch(input, init);
    if (path === "/auth/login") candidate = (await response.clone().json()).session?.token;
    return response;
  } }); t.after(() => app.close());
  await app.ready; await app.auth.signup("replay@example.com", "password-a");
  initial = app.client.session().token;
  const pending = await app.mutate(add, { body: "queued" }); assert.equal(pending.state, "pending");
  failCommit = true; assert.equal((await app.auth.login("replay@example.com", "password-a")).ok, false);
  assert.ok(candidate); assert.deepEqual(sent, [], "uncommitted identity cannot replay the journal");
  assert.equal((await restoreSession(url, memory)).token, initial);
  failCommit = false; assert.equal((await app.auth.login("replay@example.com", "password-a")).ok, true);
  await until(async () => (await app.client.write(pending.id))?.state === "sent");
  assert.equal(sent[0].id, pending.id);
});

test("failed local restoration cannot consume a near-expiry guest before device opening succeeds", { timeout: hangBudget(10) }, async t => {
  const { url } = await server(t), store = memorySessionStore();
  const original = createApp({ url, sessionStore: store }); await original.ready; await original.auth.guest();
  const session = original.client.session(); await original.close();
  await keepSession(url, { ...session, expiresAt: Date.now() + 60_000 }, store);
  const before = await store.get(sessionKey(url)); let rotations = 0;
  const app = createApp({ url, sessionStore: store, device: { async open() { throw Error("device cannot open"); } }, fetch: (input, init) => {
    if (new URL(input).pathname === "/auth/refresh") rotations++;
    return fetch(input, init);
  } }); t.after(() => app.close());
  assert.equal((await app.ready).ok, false);
  assert.equal(rotations, 0);
  assert.equal(await store.get(sessionKey(url)), before);
  assert.equal((await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${session.token}` } })).json()).denied, undefined);
});

test("foreign tombstone retirement credentials are preserved without dispatch", async t => {
  const store = memorySessionStore(), url = "https://retirement.invalid", key = sessionKey(url), sent = [];
  const bytes = JSON.stringify({ snapback4Logout: "1", snapback4Backend: "https://foreign.invalid", snapback4Retired: ["foreign-secret"] });
  await store.set(key, bytes);
  const app = createApp({ url, sessionStore: store, fetch: async input => { sent.push(input); return Response.json({ ok: true }); } });
  t.after(() => app.close()); await app.ready;
  await until(() => app.auth.why?.code === "E_CLIENT");
  assert.deepEqual(sent, []); assert.equal(await store.get(key), bytes);
  assert.equal((await app.auth.logout()).ok, false, "logout cannot relabel a foreign retirement as local");
  assert.deepEqual(sent, []); assert.equal(await store.get(key), bytes);
});

test("Client signOut and logoutAll use the app's atomic logout boundary", { timeout: hangBudget(14) }, async t => {
  const { url } = await server(t), store = memorySessionStore();
  const app = createApp({ url, sessionStore: store }); t.after(() => app.close()); await app.ready;
  await app.auth.guest(); const old = app.client, token = old.session().token;
  await old.signOut(); assert.equal(await restoreSession(url, store), null);
  await until(async () => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${token}` } })).json()).denied?.code === "E_AUTH");
  const next = await app.auth.guest(); assert.equal(next.ok, true);
  await old.signOut(); assert.equal((await old.logoutAll()).ok, false);
  assert.equal((await restoreSession(url, store)).token, next.session.token, "a retained old client cannot log out the new account");
  assert.equal((await app.client.logoutAll()).ok, true);
  assert.equal(await restoreSession(url, store), null); assert.equal(app.auth.state, "signed-out");
});

test("session custody preserves a class store's methods and receiver", async t => {
  class Store {
    values = new Map();
    async get(key) { return this.values.get(key) ?? null; }
    async set(key, value) { this.values.set(key, value); }
    async delete(key) { this.values.delete(key); }
  }
  const store = new Store(), url = "https://class-store.invalid";
  const app = createApp({ url, sessionStore: store, fetch: async input => new URL(input).pathname === "/auth/guest"
    ? Response.json({ session: { principal: "guest:a", token: "class-token", kind: "guest", expiresAt: Date.now() + 7 * 86400000 } })
    : Response.json({ ok: true }) });
  t.after(() => app.close()); await app.ready;
  assert.equal((await app.auth.guest()).ok, true); assert.equal((await restoreSession(url, store)).token, "class-token");
  assert.equal((await app.auth.logout()).ok, true); assert.equal(await restoreSession(url, store), null);
});

test("a session comparison read failure returns client refusals without losing identity", { timeout: hangBudget(13) }, async t => {
  const { url } = await server(t), memory = memorySessionStore(), key = sessionKey(url);
  let broken = false;
  const app = createApp({ url, sessionStore: { ...memory, async get(k) {
    if (broken) throw Error("session comparison unavailable");
    return memory.get(k);
  } } });
  t.after(() => app.close()); await app.ready; await app.auth.guest();
  const client = app.client, before = await memory.get(key);
  broken = true;
  assert.equal((await client.query(list, {})).denied.code, "E_CLIENT");
  assert.equal((await client.mutate(add, { body: "not dispatched" })).why.code, "E_CLIENT");
  assert.equal((await client.act({ kind: "action", name: "unused" }, {})).denied.code, "E_CLIENT");
  assert.equal((await client.upload(new Blob(["unused"]))).why.code, "E_CLIENT");
  assert.equal((await client.asset("unused")).denied.code, "E_CLIENT");
  assert.equal(await client.write("unused"), undefined);
  const watched = client.observe(list, {}); t.after(() => watched.close());
  await until(() => watched.getSnapshot().denied?.code === "E_CLIENT");
  assert.equal(await memory.get(key), before); assert.equal(app.auth.state, "signed-in");
  broken = false;
  assert.deepEqual((await client.query(list, {})).data, []);
});
