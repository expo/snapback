import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../dist/app.js";
import { memorySessionStore, restoreSession, keepSession, sessionKey, logout as revokeSession } from "../dist/auth.js";
import { processDevice } from "../dist/native.js";

const binary = process.env.SNAPBACK4_BIN ?? resolve(import.meta.dirname, "../../../target/debug/snapback4");
const add = { kind: "mutation", name: "add" }, list = { kind: "query", name: "list" };
const until = async (read, label = "condition") => {
  for (let n = 0; n < 500; n++) { const value = await read(); if (value) return value; await delay(10); }
  assert.fail(`timed out: ${label}`);
};
async function server(t) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-app-"));
  mkdirSync(join(dir, "snapback"));
  writeFileSync(join(dir, "snapback/schema.q"), `use identity
 tablePlaceholder` .replace(' tablePlaceholder', `table notes:
  owner: principal
  body: text <=200
  by byOwner: owner, id
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
mutation add(body: text <=200):
  insert notes { owner: viewer, body }
query list():
  return notes[viewer] first 100 by byOwner
`));
  let output = "";
  const host = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  host.stdout.on("data", bytes => { output += bytes; }); host.stderr.on("data", bytes => { output += bytes; });
  t.after(async () => { const done = new Promise(resolve => host.once("exit", resolve)); if (host.exitCode === null) { host.kill("SIGTERM"); await done; } rmSync(dir, { recursive: true, force: true }); });
  const url = await until(() => { assert.equal(host.exitCode, null, output); return output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; }, "server");
  return { url, dir };
}
for (const tier of ["online", "local"]) test(`app ${tier}: signup, restart, rotation, account-bound pending writes and logout`, { timeout: 60_000 }, async t => {
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

test("online app recovers two lost confirmations with original IDs and immutable arguments", { timeout: 30_000 }, async t => {
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

test("logoutEverywhere revokes other sessions and session restore cancellation cannot resurrect identity", { timeout: 30_000 }, async t => {
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

test("online logout completes while rotation is stalled and revokes the late successor", { timeout: 10_000 }, async t => {
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

test("online custody refuses unstored admission and retains committed writes when receipt storage fails", { timeout: 30_000 }, async t => {
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
  await assert.rejects(app.mutate(add, { body: "never dispatched" }), /storage/);
  assert.equal(sends, 0);
  failIntent = false; failReceipt = true;
  const write = await app.mutate(add, { body: "committed" });
  assert.equal(write.state, "pending", "failed receipt persistence cannot turn an executed write into failure");
  failReceipt = false;
  assert.equal((await app.client.write(write.id)).state, "sent");
  assert.equal(sends, 1);
});

test("failed session persistence clears and revokes the kept bearer before reporting signed-out", { timeout: 15_000 }, async t => {
  const { url } = await server(t), memory = memorySessionStore();
  let sessionWrites = 0, issued;
  const app = createApp({ url, sessionStore: { ...memory, async set(key, value) {
    if (key.endsWith(".session") && ++sessionWrites === 2) throw Error("session store failed");
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
    async set(key, value) { if (key.endsWith(".writes")) throw Error("outbox store failed"); await memory.set(key, value); },
    async delete(key) { if (failDelete) throw Error("session delete failed"); await memory.delete(key); },
  }, fetch: async (input) => new URL(input).pathname === "/auth/guest"
    ? Response.json({ session: { principal: "alice", token: "secret", kind: "user", expiresAt: Date.now() + 7 * 86400000 } })
    : Response.json({ ok: true }) });
  t.after(() => app.close());
  await app.ready; await app.auth.guest();
  await assert.rejects(app.mutate(add, { body: "not sent" }), /outbox store/);
  failDelete = true;
  assert.equal((await app.auth[action]()).ok, false);
  assert.equal(app.auth.state, "signed-out");
  assert.equal(app.client.viewer(), null);
  failDelete = false;
  assert.equal((await app.auth.logout()).ok, true);
  assert.equal(await restoreSession(url, memory), null);
});

test("signed-out completion waits for durable credential deletion", async t => {
  const memory = memorySessionStore(); let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const app = createApp({ url: "https://app.invalid", sessionStore: { ...memory, async delete(key) { await gate; await memory.delete(key); } },
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

for (const tier of ["online", "local"]) test(`logout ${tier} deletes the bearer while network work is held`, { timeout: 15_000 }, async t => {
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
  assert.equal((await Promise.race([ending, delay(500).then(() => ({ ok: false }))])).ok, true, "local logout is independent of both held requests");
  assert.equal(await restoreSession(url, store), null);
  assert.equal(app.auth.state, "signed-out");
  const restarted = createApp({ url, sessionStore: store });
  await restarted.ready; assert.equal(restarted.auth.state, "signed-out"); await restarted.close();
  releaseSchema(); releaseLogout(); await app.ready;
  assert.equal(await restoreSession(url, store), null, "late restoration cannot put the token back");
  assert.equal(app.auth.state, "signed-out");
  await until(async () => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${session.token}` } })).json()).denied?.code === "E_AUTH");
});

for (const tier of ["online", "local"]) test(`ordinary ${tier} app close keeps an in-flight rotation for the next runtime`, { timeout: 20_000 }, async t => {
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
  const original = app.client.session().token, refresh = app.client.refreshSession();
  await until(() => rotated);
  const closing = app.close();
  await delay(0); release();
  assert.equal((await refresh).ok, true); await closing;
  assert.equal((await restoreSession(url, store)).token, rotated.token);
  assert.notEqual(rotated.token, original);
  assert.equal((await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${original}` } })).json()).denied?.code, "E_AUTH");
  app = createApp(options); assert.equal((await app.ready).ok, true);
  assert.equal(app.auth.viewer, rotated.principal);
  assert.deepEqual((await app.client.query(list, {})).data, []);
});


for (const tier of ["online", "local"]) test(`a stale ${tier} refresh preserves another owner's kept successor`, { timeout: 20_000 }, async t => {
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

for (const [tier, stage] of [["online", "first save"], ["local", "first save"], ["online", "final save"], ["local", "backend acquisition"]]) test(`stale ${tier} restoration restarts when another app rotates before its ${stage}`, { timeout: 20_000 }, async t => {
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

for (const tier of ["online", "local"]) test(`${tier} auth rejection after a failed login completes signed-out cleanup`, { timeout: 15_000 }, async t => {
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
  assert.equal(await restoreSession(url, store), null);
});

for (const tier of ["online", "local"]) for (const loginBob of [false, true]) test(`shared logout fences a held ${tier} rotation${loginBob ? " across Bob's login" : " while signed out"}`, { timeout: 20_000 }, async t => {
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
  await until(async () => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${rotated.token}` } })).json()).denied?.code === "E_AUTH", "late successor is revoked");
  const reopened = createApp({ url, sessionStore: store }); t.after(() => reopened.close());
  assert.equal((await reopened.ready).ok, true);
  assert.equal(reopened.auth.viewer, kept?.principal ?? null);
  if (loginBob) assert.deepEqual((await b.client.query(list, {})).data, []);
});

test("a sign-in started before another app's logout cannot overwrite its later login", { timeout: 15_000 }, async t => {
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

for (const damage of ["invalid JSON", "expired session"]) test(`restoration cleanup of ${damage} preserves a replacement written after its read`, { timeout: 15_000 }, async t => {
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

test("expired stored-session cleanup deletes bytes without revoking the live bearer", { timeout: 15_000 }, async t => {
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

test("refresh started after a shared logout refuses before dispatch even if remote logout failed", { timeout: 15_000 }, async t => {
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

for (const persistentFailure of [false, true]) test(`offline logout deletes credentials when its epoch write ${persistentFailure ? "keeps failing" : "exceeds quota"}`, { timeout: 15_000 }, async t => {
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
  assert.equal(deletions, 1, "deletion is attempted even when the first marker write fails");
  assert.equal(markerAttempts, 2, "retry the marker after deletion frees space");
  assert.equal(await restoreSession(url, store), null);
  assert.equal(app.auth.state, "signed-out");
  assert.equal(result.ok, !persistentFailure);
  if (persistentFailure) {
    assert.equal(result.why.code, "E_CLIENT");
    assert.match(result.why.message, /quota exceeded/);
    assert.deepEqual(app.auth.why, result.why);
  } else {
    assert.equal(await store.get(epochKey), "1", "the retry advances the epoch only once");
    assert.equal(app.auth.why, undefined);
  }
  const reopened = createApp({ url, sessionStore: store, fetch: fetcher }); t.after(() => reopened.close());
  assert.equal((await reopened.ready).ok, true);
  assert.equal(reopened.auth.state, "signed-out");
});

test("near-expiry restoration retries a successor after automatic refresh is rejected during journal opening", { timeout: 20_000 }, async t => {
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
  await until(() => journalHeld && rejected, "A's constructor refresh was rejected while custody is opening");
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
  assert.equal((await Promise.race([refreshing, delay(500).then(() => assert.fail('caller still waits for the refresh body'))])).ok, false);
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
  await Promise.race([app.close(), delay(500).then(() => assert.fail('close waited for an effect body'))]);
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


test('online app keeps an unrotated bearer through replacement and the recovery probe accepts it', async t => {
  const { url } = await server(t), sessionStore = memorySessionStore();
  let releaseRefresh, releaseChange, releaseProbe, rotating = false, rejected = false, probing = false;
  const refreshGate = new Promise(resolve => { releaseRefresh = resolve; });
  const changeGate = new Promise(resolve => { releaseChange = resolve; });
  const probeGate = new Promise(resolve => { releaseProbe = resolve; });
  const probes = [], logouts = [];
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
    if (path === '/auth/logout') logouts.push(new Headers(init.headers).get('authorization'));
    return fetch(input, init);
  } });
  t.after(async () => { releaseRefresh(); releaseChange(); releaseProbe(); await app.close(); });
  await app.ready; await app.auth.guest();
  const prior = app.client, original = prior.session(); await prior.query(list, {});
  const changing = prior.query(list, { replace: true }), refreshing = prior.refreshSession();
  await until(() => rotating); releaseChange();
  assert.equal((await changing).denied.code, 'E_STORE_REPLACED');
  assert.equal((await refreshing).ok, false); await until(() => probing);
  releaseRefresh(); await until(() => rejected); await delay(0);
  assert.deepEqual(logouts, [], 'a failed rotation must not revoke the bearer used by recovery');
  releaseProbe(); await until(() => app.auth.state !== 'restoring');
  assert.equal(app.auth.state, 'signed-in'); assert.notEqual(app.client, prior);
  assert.deepEqual(probes, [`Bearer ${original.token}`]);
  assert.equal(app.client.session().token, original.token);
  assert.equal((await restoreSession(url, sessionStore)).token, original.token);
  assert.deepEqual((await app.client.query(list, {})).data, []);
});
