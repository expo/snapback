import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../dist/app.js";
import { memorySessionStore, restoreSession, keepSession } from "../dist/auth.js";
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
  let finish; const rotation = new Promise(resolve => { finish = resolve; });
  const revoked = [];
  const app = createApp({ url, sessionStore, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/auth/refresh") return rotation;
    if (path === "/auth/logout") { revoked.push(init.headers.authorization); return Response.json({ ok: true }); }
    throw Error(path);
  } });
  t.after(async () => { finish(Response.json({ session: { ...initial, token: "next" } })); await app.close(); });
  await app.ready;
  const refresh = app.client.refreshSession();
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
    if (key.endsWith(":writes")) {
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

test("failed session persistence never exposes a half-open authenticated client", async t => {
  const memory = memorySessionStore(); let sessionWrites = 0;
  const app = createApp({ url: "https://app.invalid", sessionStore: { ...memory, async set(key, value) {
    if (key.endsWith(":session") && ++sessionWrites === 2) throw Error("session store failed");
    await memory.set(key, value);
  } }, fetch: async () => Response.json({ session: { principal: "alice", token: "secret", kind: "user", expiresAt: Date.now() + 7 * 86400000 } }) });
  t.after(() => app.close());
  await app.ready;
  assert.equal((await app.auth.guest()).ok, false);
  assert.equal(app.auth.state, "signed-out");
  assert.equal(app.client.viewer(), null);
  assert.equal((await app.mutate(add, { body: "not allowed" })).why.code, "E_AUTH");
  assert.equal((await app.auth.guest()).ok, true, "a repaired session store can sign in again");
});

for (const action of ["logout", "logoutEverywhere"]) test(`${action} clears credentials after journal failure, and credential deletion is retryable`, async t => {
  const memory = memorySessionStore(), url = "https://app.invalid";
  let failDelete = false;
  const app = createApp({ url, sessionStore: { ...memory,
    async set(key, value) { if (key.endsWith(":writes")) throw Error("outbox store failed"); await memory.set(key, value); },
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
