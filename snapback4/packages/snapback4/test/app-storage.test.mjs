import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../dist/app.js";
import { keepSession, restoreSession, sessionKey } from "../dist/auth.js";
import { storeKey } from "../dist/app-storage.js";

const mutation = { kind: "mutation", name: "write" };
const url = "https://app.invalid";
const session = principal => ({ principal, token: "token-" + principal, kind: "user", expiresAt: Date.now() + 7 * 86400000 });
const until = async read => { for (let n = 0; n < 500; n++) { const value = await read(); if (value) return value; await delay(5); } assert.fail("condition did not settle"); };
function storage() {
  const values = new Map(), keys = [];
  const check = key => { assert.match(key, /^[A-Za-z0-9._-]+$/); keys.push(key); };
  const store = {
    async get(key) { check(key); return values.get(key) ?? null; },
    async set(key, value) { check(key); values.set(key, value); },
    async delete(key) { check(key); values.delete(key); },
  };
  const intentValues = new Map();
  const intentStore = { getItem: key => intentValues.get(key) ?? null,
    setItem: (key, value) => { intentValues.set(key, value); }, removeItem: key => { intentValues.delete(key); } };
  return { values, keys, store, intentValues, intentStore };
}
function generated(t, held, fetcher, address = url) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-secure-adapter-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const binary = process.env.SNAPBACK4_BIN ?? resolve(import.meta.dirname, "../../../target/debug/snapback4");
  const init = spawnSync(binary, ["init", "--expo"], { cwd: dir, encoding: "utf8" });
  assert.equal(init.status, 0, init.stdout + init.stderr);
  const js = ts.transpileModule(readFileSync(join(dir, "src/client.ts"), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { exports: {}, process: { env: { EXPO_PUBLIC_SNAPBACK_URL: address } }, require(name) {
    if (name === "./intents" || name === "./intent-store") {
      const child = { exports: {}, require: context.require };
      const file = name === "./intents" ? "intents.ts" : "intent-store.native.ts";
      const code = ts.transpileModule(readFileSync(join(dir, "src", file), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
      vm.runInNewContext(code, child); return child.exports;
    }
    if (name === "expo-sqlite/kv-store") return { default: { getItemSync: held.intentStore.getItem, setItemSync: held.intentStore.setItem, removeItemSync: held.intentStore.removeItem } };
    if (name === "react-native") return { Platform: { OS: "ios" } };
    if (name === "expo-secure-store") return { getItemAsync: held.store.get, setItemAsync: held.store.set, deleteItemAsync: held.store.delete };
    if (name === "snapback4/app") return { createApp: options => createApp({ ...options, fetch: fetcher }) };
    if (name === "snapback4-expo") return { nativeAvailable: () => false };
    return {};
  } };
  vm.runInNewContext(js, context);
  assert.equal(context.exports.tier, "online");
  const app = context.exports.app;
  t.after(() => app.close());
  return app;
}
function transport() {
  // These fixtures exercise admitted custody isolation; identification works
  // while mutation delivery is offline.
  let deliveryOffline = true;
  const sent = [];
  const fetcher = async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/auth/login") return Response.json({ session: session(JSON.parse(init.body).email) });
    if (path === "/auth/logout") return Response.json({ ok: true });
    if (path === "/probe") {
      return Response.json({ ok: true, store_id: "storage-test", seq: sent.length });
    }
    if (path === "/m/write") {
      if (deliveryOffline) throw Error("offline");
      const body = JSON.parse(init.body); sent.push({ ...body, token: init.headers.authorization });
      return Response.json({ state: "sent", id: body.id, seq: sent.length });
    }
    throw Error(path);
  };
  return { fetcher, sent, online() { deliveryOffline = false; } };
}

for (const [a, b] of [["a!b", "a~b"], ["a*b", "a'b"], ["a(b", "a)b"], ["user:01ABC", "user_3A01ABC"], ["ab", "慢"]]) test(`generated Expo storage keeps ${a} and ${b} write custody separate`, async t => {
  const held = storage(), wire = transport(), app = generated(t, held, wire.fetcher);
  await app.ready; await app.auth.login(a, "password");
  const pending = await app.mutate(mutation, { body: "secret from " + a });
  assert.equal(pending.state, "pending");
  await app.auth.logout(); await app.auth.login(b, "password");
  assert.equal(await app.client.write(pending.id), undefined);
  wire.online(); await app.mutate(mutation, { body: "from B" });
  assert.deepEqual(wire.sent.map(write => [write.args.body, write.token]), [["from B", "Bearer token-" + b]]);
  await app.auth.login(a, "password");
  await until(async () => (await app.client.write(pending.id))?.state === "sent");
  assert.deepEqual(wire.sent.map(write => [write.args.body, write.token]), [["from B", "Bearer token-" + b], ["secret from " + a, "Bearer token-" + a]]);
  assert.notEqual(storeKey("writes", url, a), storeKey("writes", url, b));
  assert.ok([...held.values.keys()].every(key => !key.includes(".writes")), "SecureStore contains no newly written intent text");
  assert.ok([...held.intentValues.keys()].some(key => key.endsWith(".writes")));
});

test("generated SecureStore separates formerly colliding backend session keys", async t => {
  const held = storage(), wire = transport();
  const aUrl = "https://app.invalid/a!b", bUrl = "https://app.invalid/a~b";
  const a = generated(t, held, async (input, init) => new URL(input).pathname.endsWith("/auth/login") ? Response.json({ session: session("alice") }) : Response.json({ ok: true }), aUrl);
  await a.ready; await a.auth.login("alice", "password"); await a.close();
  const b = generated(t, held, wire.fetcher, bUrl);
  await b.ready; assert.equal(b.auth.state, "signed-out");
  assert.equal((await restoreSession(aUrl, held.store)).principal, "alice");
  assert.equal(await restoreSession(bUrl, held.store), null);
  assert.notEqual(sessionKey(aUrl), sessionKey(bUrl));
  const segments = ["a!b", "a~b", "a*b", "a'b", "a(b", "a)b", "user:01ABC", "user_3A01ABC", "ab", "慢", "\ud800", "\ufffd"];
  assert.equal(new Set(segments.map(value => storeKey("writes", url, value))).size, segments.length);
});

test("recovery refuses an intent with a foreign recorded owner even at the correct safe key", async t => {
  const held = storage(), wire = transport(), app = generated(t, held, wire.fetcher);
  await app.ready; await app.auth.login("a!b", "password");
  const pending = await app.mutate(mutation, { body: "A's private intent" });
  const raw = JSON.parse(held.intentStore.getItem(storeKey("writes", url, "a!b")));
  raw.owner = "a~b"; // defeat the top-level check: the intent still belongs to A.
  const bytes = JSON.stringify(raw), bKey = storeKey("writes", url, "a~b");
  held.intentStore.setItem(bKey, bytes);
  await app.auth.logout(); wire.online();
  assert.equal((await app.auth.login("a~b", "password")).ok, true);
  assert.equal(app.auth.why.code, "E_CLIENT");
  assert.equal(await app.client.write(pending.id), undefined);
  assert.equal(wire.sent.length, 0);
  assert.ok([...held.values.keys()].every(key => !key.includes(".writes")), "quarantine stays out of SecureStore too");
  assert.ok([...held.intentValues].some(([key, value]) => key.startsWith(bKey + ".damaged.") && value === bytes));
  await app.mutate(mutation, { body: "B's own intent" });
  assert.deepEqual(wire.sent.map(write => write.args.body), ["B's own intent"]);
});

test("recovery quarantines a valid same-principal journal transplanted from another backend", async t => {
  const held = storage(), wire = transport(), otherUrl = "https://other.invalid";
  const a = generated(t, held, wire.fetcher);
  await a.ready; await a.auth.login("alice", "password");
  const pending = await a.mutate(mutation, { body: "private to backend A" });
  assert.equal(pending.state, "pending");
  const aKey = storeKey("writes", url, "alice"), bKey = storeKey("writes", otherUrl, "alice");
  const bytes = held.intentStore.getItem(aKey);
  await a.close();
  held.intentStore.setItem(bKey, bytes); // Valid owner, arguments and ID; only backend differs.
  wire.online();
  const b = generated(t, held, wire.fetcher, otherUrl);
  await b.ready;
  assert.equal((await b.auth.login("alice", "password")).ok, true);
  assert.equal(b.auth.why?.code, "E_CLIENT");
  assert.equal(await b.client.write(pending.id), undefined);
  assert.equal(wire.sent.length, 0);
  assert.ok([...held.intentValues].some(([key, value]) => key.startsWith(bKey + ".damaged.") && value === bytes));
  assert.equal(held.intentStore.getItem(aKey), bytes, "A's original custody remains intact");
  assert.equal((await b.mutate(mutation, { body: "own intent on backend B" })).state, "sent");
  assert.deepEqual(wire.sent.map(write => write.args.body), ["own intent on backend B"]);
});

for (const bytes of ["{", "null", '{"pending":[],"receipts":[]}', JSON.stringify({ owner: "alice", backend: url, pending: {}, receipts: [] })]) test(`damaged journal ${bytes.slice(0, 24)} is preserved without blocking restore or login`, async t => {
  const held = storage(), wire = transport(); wire.online();
  const key = storeKey("writes", url, "alice");
  await keepSession(url, session("alice"), held.store); await held.store.set(key, bytes);
  let app = createApp({ url, sessionStore: held.store, fetch: wire.fetcher });
  t.after(() => app.close());
  assert.equal((await app.ready).ok, true); assert.equal(app.auth.state, "signed-in");
  assert.equal(app.auth.why.code, "E_CLIENT");
  assert.match(app.auth.why.rewrite, /sessionStore.get/);
  assert.ok([...held.values].some(([name, value]) => name.startsWith(key + ".damaged.") && value === bytes));
  assert.deepEqual(JSON.parse(await held.store.get(key)).pending, []);
  assert.equal(wire.sent.length, 0);
  await app.auth.logout(); await held.store.set(key, bytes);
  assert.equal((await app.auth.login("alice", "password")).ok, true);
  assert.equal(app.auth.why.code, "E_CLIENT");
  assert.equal((await app.mutate(mutation, { body: "new intent" })).state, "sent");
  await app.close(); app = createApp({ url, sessionStore: held.store, fetch: wire.fetcher });
  assert.equal((await app.ready).ok, true); assert.equal(app.auth.why, undefined);
});

test("unavailable quarantine preserves the original bytes and blocks writes, not sign-in", async t => {
  const held = storage(), wire = transport(); wire.online();
  const key = storeKey("writes", url, "alice"), bytes = "broken";
  await keepSession(url, session("alice"), held.store); await held.store.set(key, bytes);
  let broken = true;
  const app = createApp({ url, fetch: wire.fetcher, sessionStore: { ...held.store, async set(name, value) {
    if (broken && name.includes(".damaged.")) throw Error("storage unavailable");
    await held.store.set(name, value);
  } } });
  t.after(() => app.close());
  assert.equal((await app.ready).ok, true); assert.equal(app.auth.state, "signed-in");
  assert.equal(app.auth.why.code, "E_CLIENT");
  for (const waitSeconds of [undefined, 0]) {
    const refused = await app.mutate(mutation, { body: "not admitted" }, { waitSeconds });
    assert.equal(refused.state, "failed"); assert.equal(refused.why.code, "E_STORE");
    assert.match(refused.why.message, /storage unavailable/);
  }
  assert.equal(await held.store.get(key), bytes); assert.equal(wire.sent.length, 0);
  broken = false;
  assert.equal((await app.mutate(mutation, { body: "now safe" })).state, "sent");
});

test("quarantine naming failure also preserves bytes without refusing sign-in", async t => {
  const held = storage(), wire = transport(), key = storeKey("writes", url, "alice");
  await keepSession(url, session("alice"), held.store); await held.store.set(key, "broken");
  await delay(5); // mintId must request fresh entropy rather than increment its last millisecond.
  t.mock.method(globalThis.crypto, "getRandomValues", () => { throw Error("entropy unavailable"); });
  const app = createApp({ url, sessionStore: held.store, fetch: wire.fetcher });
  t.after(() => app.close());
  assert.equal((await app.ready).ok, true);
  assert.equal(app.auth.state, "signed-in"); assert.equal(app.auth.why.code, "E_CLIENT");
  assert.equal(await held.store.get(key), "broken");
  assert.equal(wire.sent.length, 0);
});
