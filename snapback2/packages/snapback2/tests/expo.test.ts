import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";
import { test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createClient } from "../dist/client.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { fakeOwner } from "./fake-owner.ts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).__snapbackNative ??= { React, fileUris: [], fileBodies: new Map(), videoSources: [] };
register(new URL("./native-mocks/loader.mjs", import.meta.url));
const { SnapbackProvider, createExpoClient, expoSecureTokenStore, expoSqliteDriver } = await import("../dist/expo.mjs");
const { useSnapbackClient, useConnection } = await import("../dist/react-native.mjs");
const { witnessControl } = await import("../dist/expo/witness.mjs");

function secureFake() {
  const values = new Map<string, string>();
  const reads: string[] = [];
  const deletes: string[] = [];
  let failure = false;
  const keyCheck = (key: string) => assert.match(key, /^[A-Za-z0-9._-]+$/);
  return {
    values, reads, deletes,
    fail(value: boolean) { failure = value; },
    async getItemAsync(key: string) { keyCheck(key); reads.push(key); return values.get(key) ?? null; },
    async setItemAsync(key: string, value: string) {
      keyCheck(key);
      assert.ok(new TextEncoder().encode(value).byteLength <= 2048);
      if (failure) throw new Error("keychain locked");
      values.set(key, value);
    },
    async deleteItemAsync(key: string) { keyCheck(key); deletes.push(key); values.delete(key); },
  };
}

test("Expo SecureStore uses legal keys, caches reads, bounds values, and deletes token plus principal", async () => {
  const fake = secureFake();
  const store = expoSecureTokenStore("app-1.x_y", fake);
  assert.throws(() => expoSecureTokenStore("has:colon", fake), TypeError);
  assert.throws(() => expoSecureTokenStore("", fake), TypeError);
  await Promise.all([store.load(), store.load()]);
  assert.deepEqual(fake.reads, ["snapback2.app-1.x_y.token"]);
  await store.save("bearer");
  await store.savePrincipal("principal");
  assert.equal(await store.load(), "bearer");
  assert.equal(await store.loadPrincipal(), "principal");
  assert.equal(fake.reads.length, 1);
  assert.deepEqual([...fake.values.keys()], ["snapback2.app-1.x_y.token", "snapback2.app-1.x_y.principal"]);
  await assert.rejects(store.save("雪".repeat(683)), /2 KB/);
  assert.equal(await store.load(), "bearer");
  fake.fail(true);
  await assert.rejects(store.save("new bearer"), /locked/);
  assert.equal(await store.load(), "bearer", "failed writes do not publish a cached token");
  await store.save(null);
  assert.deepEqual(fake.deletes.sort(), ["snapback2.app-1.x_y.principal", "snapback2.app-1.x_y.token"]);
  assert.equal(fake.values.size, 0);
  assert.equal(await store.load(), null);
  assert.equal(await store.loadPrincipal(), null);
});

test("Expo driver scopes statements to the exclusive executor and normalizes null", async () => {
  const calls: string[] = [];
  const connection = (name: string) => ({
    async runAsync(_sql, _params) { calls.push(`${name}.run`); },
    async getFirstAsync(_sql, _params) { calls.push(`${name}.get`); return null; },
    async getAllAsync(_sql, _params) { calls.push(`${name}.all`); return []; },
  });
  (globalThis as any).__snapbackExpoSqlite = async (name, options) => {
    assert.equal(name, "conformance.db");
    assert.deepEqual(options, { useNewConnection: true });
    return { ...connection("outer"), async execAsync() {}, async closeAsync() { calls.push("close"); },
      async withExclusiveTransactionAsync(body) { calls.push("begin"); await body(connection("tx")); calls.push("commit"); } };
  };
  const driver = expoSqliteDriver("conformance.db");
  assert.equal(await driver.get("missing"), undefined);
  assert.equal(await driver.transaction(async (tx) => {
    await tx.run("insert", [new Uint8Array([1])]);
    assert.equal(await tx.get("missing"), undefined);
    assert.deepEqual(await tx.all("all"), []);
    return 7;
  }), 7);
  await driver.close();
  assert.deepEqual(calls, ["outer.get", "begin", "tx.run", "tx.get", "tx.all", "commit", "close"]);
});

test("built native entries exclude node and IndexedDB, share react-core, and ship source maps", async () => {
  for (const name of ["expo", "react-native"]) {
    const source = await readFile(new URL(`../dist/${name}.mjs`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /node:|indexedDB/);
    assert.match(source, /snapback2\/react-core/);
    assert.doesNotMatch(source, /createContext/);
    const map = JSON.parse(await readFile(new URL(`../dist/${name}.mjs.map`, import.meta.url), "utf8"));
    assert.ok(map.sources.length > 0);
  }
  const core = await readFile(new URL("../dist/react-core.mjs", import.meta.url), "utf8");
  assert.match(core, /createContext/);
  assert.doesNotMatch(core, /node:|indexedDB/);
});

test("built Expo provider and native hook share one context; supplied client remains caller-owned", async () => {
  const client = createClient({ url: "http://context.test", as: "alice", fetch: fakeOwner().fetch });
  let observed: unknown;
  function Consumer() { observed = useSnapbackClient(); return React.createElement("status", null, useConnection()); }
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(React.StrictMode, null,
    React.createElement(SnapbackProvider, { client }, React.createElement(Consumer)))); });
  assert.equal(observed, client);
  await act(async () => renderer.unmount());
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.notEqual(client.snapshot.connection, "offline", "unmount does not close caller-owned clients");
  await client.close();
});

test("createExpoClient defaults to Expo fetch and secure custody, preserves overrides, and never adds tokenStore beside as", async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-expo-"));
  const fake = secureFake();
  (globalThis as any).__snapbackSecureStore = fake;
  let requests = 0;
  const owner = fakeOwner();
  const fetch = async (input, init) => { requests++; return owner.fetch(input, init); };
  (globalThis as any).__snapbackNative.expoFetch = fetch;
  const offline = { store: fileRangeStore(root) };
  const persona = createExpoClient({ url: "http://expo.test", as: "alice", offline });
  let bearer;
  let customCalls = 0;
  const custom = createExpoClient({ url: "http://expo.test", tokenStore: { load: () => null, save() {} },
    fetch: async (input, init) => { customCalls++; return fetch(input, init); }, offline });
  try {
    await persona.ready;
    assert.equal(fake.reads.length, 0, "persona constructor supplies no token store");
    bearer = createExpoClient({ url: "http://expo.test", offline });
    await bearer.ready;
    assert.ok(fake.reads.includes("snapback2.default.token"));
    await persona.manifest();
    assert.ok(requests >= 1);
    // An explicit invalid custody combination must fail with createClient's exact error.
    const invalid = { url: "http://expo.test", as: "alice", tokenStore: { load: () => null, save() {} }, offline };
    let expected;
    try { createClient(invalid as any); } catch (error) { expected = error; }
    assert.throws(() => createExpoClient(invalid as any), (error) => error instanceof TypeError && error.message === expected.message);
    assert.throws(() => witnessControl(persona, "ws://localhost"), /not built/);
    await custom.ready;
    await custom.manifest();
    assert.equal(customCalls, 1);
  } finally { await persona.close(); await bearer?.close(); await custom.close(); await rm(root, { recursive: true, force: true }); }
});


test("createExpoClient defaults to the SQLite carrier and refuses a native open failure", async () => {
  const fake = secureFake();
  (globalThis as any).__snapbackSecureStore = fake;
  let opened;
  (globalThis as any).__snapbackExpoSqlite = async (name) => { opened = name; throw new Error("native file unavailable"); };
  const client = createExpoClient({ url: "http://expo.test", as: "sqlite-default", fetch: fakeOwner().fetch });
  try {
    await assert.rejects(client.ready, (error: any) => error.code === "E_OFFLINE_CARRIER" && /native file unavailable/.test(error.message));
    assert.equal(opened, "snapback2.db");
    assert.equal(fake.reads.length, 0);
  } finally { await client.close(); }
});
