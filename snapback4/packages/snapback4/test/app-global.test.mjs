import { hangBudget } from './helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createApp } from "../dist/app.js";
import { memorySessionStore, restoreSession, sessionKey } from "../dist/auth.js";
import { processDevice } from "../dist/native.js";
import { binary, until, server } from "./helpers/app-server.mjs";
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const probe = async (url, token) => {
  // Use the fixture's bounded retry for an aborted pooled socket. Wrap a
  // successful response so an absent refusal is not mistaken for retry work.
  const reply = await until(async () => ({ body: await (await fetch(url + "/probe", {
    headers: { authorization: `Bearer ${token}` },
  })).json() }), "probe response");
  return reply.body.denied?.code;
};
const login = async (url, email) => (await (await fetch(url + "/auth/login", { method: "POST", body: JSON.stringify({ email, password: "password-a" }) })).json()).session;

for (const tier of ["online", "local"]) for (const heldResponse of [false, true]) test(`${tier}: global logout follows another tab's ${heldResponse ? "held" : "persisted"} rotation and revokes external siblings`, { timeout: hangBudget(27) }, async t => {
  const { url, dir } = await server(t), store = memorySessionStore(), held = gate(), requests = [];
  let successor;
  const options = name => ({ url, sessionStore: store,
    ...(tier === "local" ? { device: processDevice({ dir: join(dir, name), binary }) } : {}),
    fetch: async (input, init) => {
      const path = new URL(input).pathname, token = new Headers(init?.headers).get("authorization")?.slice(7);
      if (path === "/auth/logout-all" || path === "/auth/logout") requests.push({ path, token });
      const response = await fetch(input, init);
      if (path === "/auth/refresh") { successor = (await response.clone().json()).session; if (heldResponse) await held.promise; }
      return response;
    },
  });
  const a = createApp(options("a")), b = createApp(options("b"));
  t.after(async () => { held.release(); await a.close(); await b.close(); });
  await a.ready; await b.ready; assert.equal((await a.auth.signup("alice@example.com", "password-a")).ok, true);
  // B restores after signup so its private token is the rotation's predecessor.
  await b.close(); const peer = createApp(options("peer")); t.after(() => peer.close()); await peer.ready;
  const sibling = await login(url, "alice@example.com"), predecessor = a.client.session().token;
  const refreshing = a.client.refreshSession(); await until(() => successor);
  if (!heldResponse) { await refreshing; await until(async () => (await restoreSession(url, store))?.token === successor.token); }
  const result = await peer.auth.logoutEverywhere();
  assert.equal(result.ok, !heldResponse);
  assert.equal(peer.auth.state, "signed-out"); assert.equal(await restoreSession(url, store), null);
  if (heldResponse) {
    assert.equal(result.why.code, "E_AUTH"); assert.equal(await probe(url, sibling.token), undefined);
    // The retry intent is durable even after the tab that requested it closes.
    await peer.close(); held.release(); await refreshing;
  }
  await until(async () => await probe(url, sibling.token) === "E_AUTH");
  assert.equal(await probe(url, successor.token), "E_AUTH");
  assert.ok(requests.some(value => value.path === "/auth/logout-all" && value.token === successor.token), JSON.stringify(requests));
  assert.equal(requests.find(value => value.token === successor.token)?.path, "/auth/logout-all", "ordinary retirement cannot consume the global retry credential");
  if (!heldResponse) assert.ok(!requests.some(value => value.path === "/auth/logout-all" && value.token === predecessor));
  await until(async () => {
    const inline = JSON.parse(await store.get(sessionKey(url))), journal = JSON.parse(await store.get(sessionKey(url) + ".revocations") ?? "null");
    return !inline.snapback4LogoutAll?.length && !journal?.all?.length;
  });
});

test("global logout never selects another principal's stored bearer", { timeout: hangBudget(9) }, async t => {
  const { url } = await server(t), store = memorySessionStore(), sent = [];
  const a = createApp({ url, sessionStore: store, fetch(input, init) {
    if (new URL(input).pathname === "/auth/logout-all") sent.push(new Headers(init.headers).get("authorization"));
    return fetch(input, init);
  } }); t.after(() => a.close()); await a.ready; await a.auth.signup("alice@example.com", "password-a");
  const b = createApp({ url, sessionStore: store }); t.after(() => b.close()); await b.ready;
  assert.equal((await b.auth.signup("bob@example.com", "password-a")).ok, true);
  const bob = b.client.session(), before = await store.get(sessionKey(url));
  assert.equal((await a.auth.logoutEverywhere()).ok, false); assert.deepEqual(sent, []);
  assert.equal(await store.get(sessionKey(url)), before); assert.equal(await probe(url, bob.token), undefined);
});

for (const completed of [false, true]) test(`a ${completed ? "completed" : "pending"} global fence survives replacement before a late rotation returns`, { timeout: hangBudget(21) }, async t => {
  const { url } = await server(t), store = memorySessionStore(), held = gate(), sent = []; let successor;
  const a = createApp({ url, sessionStore: store, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/auth/logout-all") sent.push(new Headers(init.headers).get("authorization")?.slice(7));
    const response = await fetch(input, init);
    if (path === "/auth/refresh") { successor = (await response.clone().json()).session; await held.promise; }
    return response;
  } }); t.after(async () => { held.release(); await a.close(); }); await a.ready;
  await a.auth.signup("alice@example.com", "password-a");
  const b = createApp({ url, sessionStore: store }); t.after(() => b.close()); await b.ready;
  const sibling = await login(url, "alice@example.com");
  const rotating = a.client.refreshSession(); await until(() => successor);
  if (completed) assert.equal((await b.auth.login("alice@example.com", "password-a")).ok, true);
  assert.equal((await b.auth.logoutEverywhere()).ok, completed);
  if (completed) assert.equal((await b.auth.login("alice@example.com", "password-a")).ok, true);
  else assert.equal((await b.auth.signup("bob@example.com", "password-a")).ok, true);
  const replacement = b.client.session();
  held.release(); await rotating;
  await until(async () => await probe(url, sibling.token) === "E_AUTH");
  await until(async () => await probe(url, successor.token) === "E_AUTH");
  assert.equal((await restoreSession(url, store)).token, replacement.token);
  assert.equal(await probe(url, replacement.token), undefined);
  assert.equal(sent.includes(successor.token), !completed, "completed fence does not repeat global logout against a later login");
});
