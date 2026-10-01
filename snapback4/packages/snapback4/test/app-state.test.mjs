import { hangBudget } from './helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createApp } from "../dist/app.js";
import { memorySessionStore, restoreSession, sessionKey } from "../dist/auth.js";
import { processDevice } from "../dist/native.js";
import { binary, until, server } from "./helpers/app-server.mjs";
const list = { kind: "query", name: "list" }, add = { kind: "mutation", name: "add" };
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const probe = async (url, token) => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${token}` } })).json()).denied?.code;

for (const tier of ["online", "local"]) test(`${tier}: refused bearer cannot reopen offline or disclose its replica`, { timeout: hangBudget(14) }, async t => {
  const { url, dir } = await server(t), store = memorySessionStore();
  const device = tier === "local" ? processDevice({ dir: join(dir, "refused-replica"), binary }) : undefined;
  const app = createApp({ url, sessionStore: store, device }); t.after(() => app.close());
  await app.ready; await app.auth.guest();
  assert.equal((await app.mutate(add, { body: "private cached row" })).state, "sent");
  await until(async () => (await app.client.query(list, {})).data?.length === 1);
  const token = app.client.session().token;
  assert.equal((await (await fetch(url + "/auth/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } })).json()).ok, true);
  assert.equal((await app.client.refreshSession()).why.code, "E_AUTH");
  await until(() => app.auth.state === "signed-out");
  assert.equal(await restoreSession(url, store), null);
  await app.close();
  let opened = 0;
  const offline = createApp({ url, sessionStore: store, fetch: async () => { throw Error("offline"); },
    ...(device ? { device: { open(...args) { opened++; return device.open(...args); } } } : {}),
  }); t.after(() => offline.close());
  assert.equal((await offline.ready).ok, true); assert.equal(offline.auth.state, "signed-out");
  assert.equal(opened, 0, "known-refused replica is never opened");
  assert.equal((await offline.client.query(list, {})).denied.code, "E_AUTH");
});

test("rollback cannot publish Alice after observing Charlie's held replacement", { timeout: hangBudget(17) }, async t => {
  const { url } = await server(t), memory = memorySessionStore(), key = sessionKey(url);
  const charlieGate = gate(), bobGate = gate(); let charlieHeld = false, bobIssued = false, bobJournalHeld = false, charlieToken, alice;
  const aStore = { ...memory, async get(k) {
    const value = await memory.get(k);
    if (bobIssued && k.endsWith(".writes") && !bobJournalHeld) { bobJournalHeld = true; await bobGate.promise; }
    if (k === key && JSON.parse(value ?? "null")?.token === charlieToken) observed = true;
    return value;
  } };
  let observed = false; const publications = [];
  const a = createApp({ url, sessionStore: aStore, fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (new URL(input).pathname === "/auth/signup" && JSON.parse(init.body).email === "bob@example.com") { bobIssued = true; }
    return response;
  } }); t.after(async () => { charlieGate.release(); bobGate.release(); await a.close(); });
  await a.ready; await a.auth.signup("alice@example.com", "password-a"); alice = a.auth.viewer;
  a.auth.onChange(() => { if (observed) publications.push({ state: a.auth.state, viewer: a.auth.viewer, client: a.client.viewer() }); });
  const c = createApp({ url, sessionStore: { ...memory, async set(k, value) {
    const record = JSON.parse(value);
    if (k === key && record.token && record.token !== a.client.session()?.token) {
      charlieToken = record.token; charlieHeld = true; await charlieGate.promise;
    }
    await memory.set(k, value);
  } } }); t.after(() => c.close()); await c.ready;
  const bob = a.auth.signup("bob@example.com", "password-b"); await until(() => bobJournalHeld);
  const charlie = c.auth.signup("charlie@example.com", "password-c"); await until(() => charlieHeld);
  bobGate.release(); await new Promise(resolve => setTimeout(resolve, 10));
  charlieGate.release(); assert.equal((await charlie).ok, true); assert.equal((await bob).ok, false);
  await until(() => a.auth.state === "signed-out");
  assert.ok(observed); assert.ok(!publications.some(value => value.viewer === alice), JSON.stringify(publications));
  assert.ok(publications.every(value => value.viewer === value.client));
  assert.equal((await restoreSession(url, memory)).token, charlieToken);
});

for (const tier of ["online", "local"]) for (const restart of [false, true]) test(`${tier}: global logout waits for rotation and retains failed retry custody${restart ? " across restart" : " in this app"}`, { timeout: hangBudget(24) }, async t => {
  const { url, dir } = await server(t), store = memorySessionStore(), held = gate();
  let successor, offline = false; const requests = [];
  const options = { url, sessionStore: store,
    ...(tier === "local" ? { device: processDevice({ dir: join(dir, "global-rotation"), binary }) } : {}),
    fetch: async (input, init) => {
      const path = new URL(input).pathname, token = new Headers(init?.headers).get("authorization")?.slice(7);
      if (path === "/auth/logout-all" || path === "/auth/logout") requests.push({ path, token });
      if (path === "/auth/logout-all" && offline) throw Error("global revocation transport offline");
      const response = await fetch(input, init);
      if (path === "/auth/refresh") { successor = (await response.clone().json()).session; await held.promise; }
      return response;
    },
  };
  let app = createApp(options); t.after(async () => { held.release(); await app.close(); });
  await app.ready; await app.auth.signup("global@example.com", "password-a");
  const sibling = (await (await fetch(url + "/auth/login", { method: "POST", body: JSON.stringify({ email: "global@example.com", password: "password-a" }) })).json()).session;
  const refreshing = app.client.refreshSession(); await until(() => successor);
  const ending = app.auth.logoutEverywhere();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(requests, [], "global logout waits for the committed rotation response");
  offline = true; held.release(); await refreshing;
  assert.equal((await ending).ok, false); assert.equal(app.auth.state, "signed-out");
  assert.equal(await restoreSession(url, store), null);
  assert.ok(requests.some(value => value.path === "/auth/logout-all" && value.token === successor.token));
  assert.ok(!requests.some(value => value.path === "/auth/logout" && value.token === successor.token), "ordinary retirement cannot consume the global retry credential");
  assert.equal(await probe(url, successor.token), undefined); assert.equal(await probe(url, sibling.token), undefined);
  if (restart) { await app.close(); app = createApp(options); await app.ready; assert.equal(app.auth.state, "signed-out"); }
  offline = false;
  assert.equal((await app.auth.logoutEverywhere()).ok, true);
  await until(async () => await probe(url, sibling.token) === "E_AUTH");
  await until(async () => !JSON.parse(await store.get(sessionKey(url))).snapback4LogoutAll?.length);
  assert.equal(await probe(url, successor.token), "E_AUTH");
});

test("a refusal during schema restoration also prevents the next offline replica open", { timeout: hangBudget(12) }, async t => {
  const { url, dir } = await server(t), store = memorySessionStore();
  const device = processDevice({ dir: join(dir, "schema-refusal"), binary });
  const initial = createApp({ url, sessionStore: store, device });
  await initial.ready; await initial.auth.guest();
  await initial.mutate(add, { body: "private cached row" });
  await until(async () => (await initial.client.query(list, {})).data?.length === 1);
  const token = initial.client.session().token; await initial.close();
  await fetch(url + "/auth/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } });
  const rejected = createApp({ url, sessionStore: store, device }); t.after(() => rejected.close());
  assert.equal((await rejected.ready).ok, false); assert.equal(rejected.auth.state, "signed-out");
  assert.equal(await restoreSession(url, store), null); await rejected.close();
  let opens = 0;
  const offline = createApp({ url, sessionStore: store, fetch: async () => { throw Error("offline"); }, device: {
    open(...args) { opens++; return device.open(...args); },
  } }); t.after(() => offline.close());
  assert.equal((await offline.ready).ok, true); assert.equal(offline.auth.state, "signed-out"); assert.equal(opens, 0);
});

test("global logout owns a successor whose session save failed", { timeout: hangBudget(14) }, async t => {
  const { url } = await server(t), memory = memorySessionStore(), key = sessionKey(url);
  let rejectBearer = false;
  const app = createApp({ url, sessionStore: { ...memory, async set(k, value) {
    if (rejectBearer && k === key && JSON.parse(value).token) throw Error("bearer save failed");
    await memory.set(k, value);
  } } }); t.after(() => app.close());
  await app.ready; await app.auth.signup("unpersisted@example.com", "password-a");
  const original = app.client.session(), sibling = (await (await fetch(url + "/auth/login", { method: "POST", body: JSON.stringify({ email: "unpersisted@example.com", password: "password-a" }) })).json()).session;
  rejectBearer = true;
  const next = await app.client.refreshSession(); assert.equal(next.ok, true);
  await until(() => app.auth.why?.code === "E_CLIENT");
  assert.equal((await restoreSession(url, memory)).token, original.token);
  assert.equal((await app.auth.logoutEverywhere()).ok, true);
  assert.equal(await restoreSession(url, memory), null);
  await until(async () => await probe(url, sibling.token) === "E_AUTH");
  assert.equal(await probe(url, next.session.token), "E_AUTH");
});

test("foreign global retirement credentials never reach this backend", async t => {
  const url = "https://local-global.invalid", store = memorySessionStore(), sent = [];
  const bytes = JSON.stringify({ snapback4Logout: "1", snapback4Backend: "https://foreign.invalid", snapback4LogoutAll: ["foreign-secret"] });
  await store.set(sessionKey(url), bytes);
  const app = createApp({ url, sessionStore: store, fetch: async input => { sent.push(input); return Response.json({ ok: true }); } });
  t.after(() => app.close()); await app.ready;
  await until(() => app.auth.why?.code === "E_CLIENT");
  assert.equal((await app.auth.logoutEverywhere()).ok, false);
  assert.deepEqual(sent, []); assert.equal(await store.get(sessionKey(url)), bytes);
});

for (const tier of ["online", "local"]) test(`${tier}: client notifications cannot publish a signed-in view after credential loss`, { timeout: hangBudget(10) }, async t => {
  const { url, dir } = await server(t), memory = memorySessionStore(), held = gate();
  let hold = false, writing = false;
  const app = createApp({ url, sessionStore: { ...memory, async set(k, value) {
    if (hold && k === sessionKey(url) && JSON.parse(value).snapback4Logout) { writing = true; await held.promise; }
    await memory.set(k, value);
  } }, ...(tier === "local" ? { device: processDevice({ dir: join(dir, "notification-state"), binary }) } : {}) });
  t.after(async () => { held.release(); await app.close(); }); await app.ready; await app.auth.guest();
  const client = app.client, token = client.session().token, seen = [];
  const snapshot = () => seen.push({ state: app.auth.state, viewer: app.auth.viewer, client: app.client.viewer() });
  app.auth.onChange(snapshot); client.onViewer(snapshot); client.onLink(snapshot); client.onAcquired(snapshot);
  await fetch(url + "/auth/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } });
  hold = true; const refused = client.refreshSession(); await until(() => writing);
  snapshot();
  assert.ok(seen.every(value => value.state !== "signed-in" || value.viewer === value.client), JSON.stringify(seen));
  assert.notEqual(app.auth.state, "signed-in"); assert.equal(app.client.viewer(), null);
  held.release(); await refused; await until(() => app.auth.state === "signed-out");
});

for (const tier of ["online", "local"]) test(`${tier}: closing the current public client closes its app view`, { timeout: hangBudget(5) }, async t => {
  const { url, dir } = await server(t), store = memorySessionStore();
  const app = createApp({ url, sessionStore: store, ...(tier === "local" ? { device: processDevice({ dir: join(dir, "public-close"), binary }) } : {}) });
  t.after(() => app.close()); await app.ready; await app.auth.guest();
  const token = app.client.session().token;
  await app.client.close();
  assert.equal(app.auth.state, "signed-out"); assert.equal(app.auth.viewer, null); assert.equal(app.client.viewer(), null);
  assert.equal((await restoreSession(url, store)).token, token, "ordinary close keeps the stored identity");
});
