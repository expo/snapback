import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire, register } from "node:module";
import { test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { api, createClient, SnapbackRefusal } from "../dist/client.mjs";
import { nodeSqliteDriver } from "../dist/sqlite-test.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { fakeOwner } from "./fake-owner.ts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).__snapbackNative ??= { React, fileUris: [], fileBodies: new Map(), videoSources: [] };
register(new URL("./native-mocks/loader.mjs", import.meta.url));
const expoEntry = await import("../dist/expo.mjs");
const nativeEntry = await import("../dist/react-native.mjs");
const coreEntry = await import("../dist/react-core.mjs");
const { SnapbackProvider, createExpoClient, expoSecureTokenStore, expoSqliteDriver } = expoEntry;
const { useSnapbackClient, useConnection, useAuth, useMutation, useOutbox, useSnapbackSnapshot } = nativeEntry;
const { witnessControl, runSqliteDriverConformance } = await import("../dist/expo/witness.mjs");

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

test("built Expo entry exports every native component and hook by name", () => {
  const nativeNames = Object.keys(nativeEntry).filter((name) => !(name in coreEntry)).sort();
  assert.ok(nativeNames.includes("AssetImage") && nativeNames.includes("AssetVideo"));
  assert.deepEqual(Object.keys(expoEntry).filter((name) => nativeNames.includes(name)).sort(), nativeNames);
  for (const name of nativeNames) assert.equal(typeof expoEntry[name], typeof nativeEntry[name], name);
});

test("emitted web declarations exclude node modules and SQLite test exports", async () => {
  for (const name of ["react", "client", "react-core"]) {
    const source = await readFile(new URL(`../dist/${name}.d.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /node:|sqlite-exports|native-modules/);
  }
  await assert.rejects(readFile(new URL("../dist/store/sqlite-node.d.ts", import.meta.url)), { code: "ENOENT" });
});

test("native development dependencies match Expo SDK 54 and use real expo-sqlite declarations", async () => {
  const require = createRequire(import.meta.url);
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const expected = { expo: "54.0.37", "expo-sqlite": "16.0.10", "expo-secure-store": "15.0.8",
    "expo-file-system": "19.0.24", "expo-video": "3.0.16", "react-native": "0.81.5", react: "19.1.0" };
  for (const [name, version] of Object.entries(expected)) {
    assert.equal(pkg.devDependencies[name], version, `${name}: reproducible pin`);
    assert.equal(require(`${name}/package.json`).version, version, `${name}: installed version`);
  }
  const ts = require("typescript");
  const source = new URL("../src/store/sqlite-expo.ts", import.meta.url).pathname;
  const resolved = ts.resolveModuleName("expo-sqlite", source, { moduleResolution: ts.ModuleResolutionKind.Bundler }, ts.sys).resolvedModule;
  assert.match(resolved.resolvedFileName, /expo-sqlite\/build\/index\.d\.ts$/);
  const build = await readFile(new URL("../build.mjs", import.meta.url), "utf8");
  assert.match(build, /types: \[\]/);
  assert.doesNotMatch(build, /paths:\s*\{/);
});

test("built witness conformance opens two connections and reports WAL plus every check name", async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-expo-conformance-"));
  const opened: unknown[] = [];
  try {
    const result = await runSqliteDriverConformance(() => {
      const driver = nodeSqliteDriver(join(root, "witness.db"));
      opened.push(driver);
      return driver;
    });
    assert.equal(opened.length, 2);
    assert.notEqual(opened[0], opened[1]);
    assert.equal(result.journalMode, "wal");
    assert.deepEqual(result.checks, ["journal_mode readback", "BLOB 1", "BLOB 1048576", "BLOB 0",
      "JSON tuple key round trip", "missing row is undefined", "rollback on throw",
      "late beforeCommit holds transaction", "transaction result"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("replacing a supplied client clears authentication, mutations, and outbox readiness before delayed work settles", async () => {
  const deferred = () => {
    let resolve!: (value: any) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };
  const alice = createClient({ url: "http://swap.test", as: "alice", fetch: fakeOwner().fetch });
  const bob = createClient({ url: "http://swap.test", as: "bob", fetch: fakeOwner().fetch });
  await Promise.all([alice.ready, bob.ready]);
  assert.equal(alice.snapshot.authGeneration, bob.snapshot.authGeneration);
  const bobMe = deferred(), aliceReady = deferred(), bobReady = deferred();
  const lateSuccess = deferred(), lateFailure = deferred(), bobMutation = deferred();
  alice.auth.me = async () => ({ viewer: "dev:alice", kind: "dev" });
  bob.auth.me = () => bobMe.promise;
  let delayAlice = false;
  let emitAlice!: (entries: any[]) => void;
  alice.outbox.subscribe = (callback) => { emitAlice = callback; callback([{ intent: "alice", op: "send", state: "queued" }]); return () => undefined; };
  alice.outbox.ready = () => delayAlice ? aliceReady.promise : Promise.resolve(true);
  bob.outbox.subscribe = (callback) => { callback([{ intent: "bob", op: "send", state: "queued" }]); return () => undefined; };
  bob.outbox.ready = () => bobReady.promise;
  const transport = new SnapbackRefusal({ code: "E_TRANSPORT", family: "owner", message: "alice transport", guide: "owner" }, true);
  alice.mutation = async (_ref, args: any) => {
    if (args.stage === "last") return { state: "committed", seq: 1, data: "alice" };
    if (args.stage === "transport") throw transport;
    return args.stage === "late-success" ? lateSuccess.promise : lateFailure.promise;
  };
  bob.mutation = () => bobMutation.promise;
  let current: any;
  const renders: any[] = [];
  function Consumer() {
    current = { client: useSnapbackClient(), snapshot: useSnapbackSnapshot(), auth: useAuth(), mutation: useMutation(api.send), outbox: useOutbox() };
    renders.push(current);
    return null;
  }
  const tree = (client) => React.createElement(SnapbackProvider, { client }, React.createElement(Consumer));
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(tree(alice)); });
    await act(async () => { await current.mutation.run({ stage: "last" }); });
    await act(async () => { await assert.rejects(current.mutation.run({ stage: "transport" })); });
    assert.equal(current.auth.viewer, "dev:alice");
    assert.equal(current.mutation.last.data, "alice");
    assert.equal(current.mutation.transport, transport);
    assert.equal(current.mutation.ready, true);
    assert.deepEqual(current.mutation.pending.map((entry) => entry.intent), ["alice"]);
    let oldSuccess, oldFailure;
    await act(async () => {
      oldSuccess = current.mutation.run({ stage: "late-success" });
      oldFailure = current.mutation.run({ stage: "late-failure" }).catch((error) => error);
      delayAlice = true;
      emitAlice([{ intent: "late-alice", op: "send", state: "queued" }]);
    });
    assert.equal(current.mutation.inFlight, true);
    renders.length = 0;
    await act(async () => { renderer.update(tree(bob)); });
    for (const view of renders) {
      assert.equal(view.client, bob);
      assert.equal(view.snapshot.persona, "bob", "even the first render uses Bob's snapshot");
      assert.equal(view.auth.viewer, undefined);
      assert.equal(view.auth.state, "hydrating");
      assert.equal(view.mutation.last, undefined);
      assert.equal(view.mutation.transport, undefined);
      assert.equal(view.mutation.inFlight, false);
      assert.equal(view.mutation.ready, false);
      assert.deepEqual(view.mutation.pending, []);
      assert.deepEqual(view.outbox.entries, []);
    }
    let newRun;
    await act(async () => {
      bobMe.resolve({ viewer: "dev:bob", kind: "dev" });
      bobReady.resolve(true);
      newRun = current.mutation.run({});
    });
    await act(async () => {
      aliceReady.resolve(true);
      emitAlice([{ intent: "after-unsubscribe", op: "send", state: "queued" }]);
      lateSuccess.resolve({ state: "committed", seq: 2, data: "late-alice" });
      lateFailure.reject(transport);
      await Promise.all([oldSuccess, oldFailure]);
    });
    assert.equal(current.auth.viewer, "dev:bob");
    assert.equal(current.mutation.last, undefined);
    assert.equal(current.mutation.transport, undefined);
    assert.equal(current.mutation.inFlight, true, "Alice's completion cannot decrement Bob's pending run");
    assert.equal(current.outbox.ready, true);
    assert.deepEqual(current.outbox.entries.map((entry) => entry.intent), ["bob"]);
    assert.deepEqual(current.mutation.pending.map((entry) => entry.intent), ["bob"]);
    await act(async () => { bobMutation.resolve({ state: "committed", seq: 3, data: "bob" }); await newRun; });
    assert.equal(current.mutation.last.data, "bob");
    assert.equal(current.mutation.inFlight, false);
  } finally { if (renderer) await act(async () => renderer.unmount()); await alice.close(); await bob.close(); }
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
