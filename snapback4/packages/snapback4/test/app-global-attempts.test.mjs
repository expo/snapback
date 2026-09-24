import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createApp } from "../dist/app.js";
import { memorySessionStore, restoreSession, sessionKey } from "../dist/auth.js";
import { processDevice } from "../dist/native.js";
import { binary, until, server } from "./helpers/app-server.mjs";
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const probe = async (url, token) => (await (await fetch(url + "/probe", { headers: { authorization: `Bearer ${token}` } })).json()).denied?.code;
const login = async (url) => (await (await fetch(url + "/auth/login", { method: "POST", body: JSON.stringify({ email: "alice@example.com", password: "password-a" }) })).json()).session;

for (const failCleanup of [false, true]) test(`a held global acknowledgement preserves retirement of a login minted after its dispatch${failCleanup ? " across a cleanup retry" : ""}`, { timeout: 20_000 }, async t => {
  const { url } = await server(t), memory = memorySessionStore(), key = sessionKey(url), dispatch = gate(), receipt = gate();
  let cleanupFailures = 0;
  const store = { ...memory, async set(k, value) {
    if (failCleanup && !cleanupFailures && k === key + ".revocations" && JSON.parse(value).fences?.some(fence => fence.complete)) {
      cleanupFailures++; throw Error("first acknowledgement cleanup failed");
    }
    await memory.set(k, value);
  } };
  let loginWaiting = false, committed = false, late, retireFailures = 0, allowRetirement = false, firstGlobal = true;
  const retirementFetch = async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/auth/logout-all" && firstGlobal) {
      firstGlobal = false;
      const response = await fetch(input, init); assert.equal(response.status, 200);
      committed = true; await receipt.promise; return response;
    }
    if (path.startsWith("/auth/logout") && !allowRetirement) { retireFailures++; throw Error("retirement offline"); }
    return fetch(input, init);
  };
  const a = createApp({ url, sessionStore: store, fetch: retirementFetch });
  t.after(async () => { dispatch.release(); receipt.release(); await a.close(); });
  await a.ready; await a.auth.signup("alice@example.com", "password-a");
  const b = createApp({ url, sessionStore: store, fetch: async (input, init) => {
    if (new URL(input).pathname !== "/auth/login") return retirementFetch(input, init);
    loginWaiting = true; await dispatch.promise;
    const response = await fetch(input, init); late = (await response.clone().json()).session; return response;
  } }); t.after(() => b.close()); await b.ready;
  const signingIn = b.auth.login("alice@example.com", "password-a"); await until(() => loginWaiting);
  const ending = a.auth.logoutEverywhere(); await until(() => committed);
  dispatch.release(); assert.equal((await signingIn).ok, false); await until(() => late && retireFailures > 0);
  await b.close(); // No live runtime will restage this login after acknowledgement.
  const custody = async () => {
    const saved = JSON.parse(await store.get(key) ?? "null"), journal = JSON.parse(await store.get(key + ".revocations") ?? "null");
    return [...(saved?.snapback4Retired ?? []), ...(saved?.snapback4LogoutAll ?? []), ...(journal?.tokens ?? []), ...(journal?.all ?? [])];
  };
  assert.ok((await custody()).includes(late.token)); assert.equal(await probe(url, late.token), undefined);
  receipt.release(); assert.equal((await ending).ok, true);
  assert.equal(cleanupFailures, Number(failCleanup));
  assert.ok((await custody()).includes(late.token), "the earlier attempt cannot erase custody of a post-dispatch token");
  assert.equal(await probe(url, late.token), undefined, "failed individual retirement still needs recovery");
  await a.close(); allowRetirement = true;
  const reopened = createApp({ url, sessionStore: store, fetch: retirementFetch }); t.after(() => reopened.close()); await reopened.ready;
  assert.equal(reopened.auth.state, "signed-out");
  await until(async () => await probe(url, late.token) === "E_AUTH");
  await until(async () => !(await custody()).includes(late.token));
});

for (const tier of ["online", "local"]) test(`${tier}: a dormant tab cannot globally revoke a later login of the same principal`, { timeout: 20_000 }, async t => {
  const { url, dir } = await server(t), store = memorySessionStore(), sent = [];
  const options = name => ({ url, sessionStore: store,
    ...(tier === "local" ? { device: processDevice({ dir: join(dir, name), binary }) } : {}),
    fetch: (input, init) => { if (new URL(input).pathname === "/auth/logout-all") sent.push(new Headers(init.headers).get("authorization")?.slice(7)); return fetch(input, init); },
  });
  const a = createApp(options("a")); t.after(() => a.close()); await a.ready; await a.auth.signup("alice@example.com", "password-a");
  const b = createApp(options("b")); t.after(() => b.close()); await b.ready;
  assert.equal((await b.auth.logoutEverywhere()).ok, true);
  assert.equal((await b.auth.login("alice@example.com", "password-a")).ok, true);
  const replacement = b.client.session(), sibling = await login(url), before = await store.get(sessionKey(url)), start = sent.length;
  assert.equal(JSON.parse(before).snapback4GlobalFences, undefined, "the new session has no inline fence");
  assert.ok(JSON.parse(await store.get(sessionKey(url) + ".revocations")).fences.some(fence => fence.principal === replacement.principal && fence.complete), "the completed principal watermark is in the journal");
  const result = await a.auth.logoutEverywhere(); assert.equal(result.ok, false); assert.equal(result.why.code, "E_AUTH");
  assert.equal(await store.get(sessionKey(url)), before); assert.equal((await restoreSession(url, store)).token, replacement.token);
  assert.deepEqual(sent.slice(start), [], "a stale caller cannot dispatch global revocation in the replacement epoch");
  assert.equal(await probe(url, replacement.token), undefined); assert.equal(await probe(url, sibling.token), undefined);
  assert.equal((await b.client.query({ kind: "query", name: "list" }, {})).denied, undefined);
});

test("global selection uses the principal's journal watermark for legacy session bytes", { timeout: 20_000 }, async t => {
  const { url } = await server(t), store = memorySessionStore(), sent = [];
  const a = createApp({ url, sessionStore: store, fetch: (input, init) => {
    if (new URL(input).pathname === "/auth/logout-all") sent.push(input);
    return fetch(input, init);
  } }); t.after(() => a.close()); await a.ready; await a.auth.signup("alice@example.com", "password-a");
  const b = createApp({ url, sessionStore: store }); t.after(() => b.close()); await b.ready;
  assert.equal((await b.auth.logoutEverywhere()).ok, true);
  assert.equal((await b.auth.login("alice@example.com", "password-a")).ok, true);
  const next = b.client.session(), sibling = await login(url);
  // The lower-level keepSession format is supported; it carries no app epoch.
  await store.set(sessionKey(url), JSON.stringify(next));
  const before = await store.get(sessionKey(url));
  assert.equal((await a.auth.logoutEverywhere()).ok, false);
  assert.equal(await store.get(sessionKey(url)), before); assert.deepEqual(sent, []);
  assert.equal(await probe(url, next.token), undefined); assert.equal(await probe(url, sibling.token), undefined);
});

test("another principal's watermark and legacy counter cannot block a same-scope rotated bearer", { timeout: 20_000 }, async t => {
  const { url } = await server(t), store = memorySessionStore(), key = sessionKey(url);
  const a = createApp({ url, sessionStore: store }); t.after(() => a.close()); await a.ready;
  await a.auth.signup("alice@example.com", "password-a");
  const b = createApp({ url, sessionStore: store }); t.after(() => b.close()); await b.ready;
  const rotated = await b.client.refreshSession(); assert.equal(rotated.ok, true);
  await until(async () => (await restoreSession(url, store))?.token === rotated.session.token);
  const sibling = await login(url), bytes = JSON.parse(await store.get(key));
  // Exercise supported legacy-counter data independently of the committed
  // account scope. The only global watermark belongs to a different principal.
  const marker = (BigInt(bytes.snapback4Epoch) + 1n).toString();
  await store.set(key + ".epoch", marker);
  await store.set(key + ".revocations", JSON.stringify({ backend: url, tokens: [], all: [],
    fences: [{ principal: "user:someone-else", epoch: marker, tokens: [], complete: true }] }));
  assert.equal((await a.auth.logoutEverywhere()).ok, true);
  assert.equal(await probe(url, rotated.session.token), "E_AUTH"); assert.equal(await probe(url, sibling.token), "E_AUTH");
});
