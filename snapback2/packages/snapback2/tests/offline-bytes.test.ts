// Lane O4-web: asset bytes under the row's lease, view-once at view time (LLP 1012 §9, LLP 1006 §9b).
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SnapbackRefusal, api, createClient } from "../dist/client.mjs";
import { AssetImage, AssetVideo, SnapbackProvider, indexedDbRangeStore } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { sqliteFactory, sqliteKeys } from "./sqlite-fixture.ts";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { domEnvironment, until } from "./dom-environment.ts";

const A = "s2id-00000000000000000000000000000006-0000000000000001";
const B = "s2id-00000000000000000000000000000006-0000000000000002";
const C = "s2id-00000000000000000000000000000006-0000000000000003";
const D = "s2id-00000000000000000000000000000006-0000000000000004";
const V = "s2id-00000000000000000000000000000006-0000000000000005";
const generation = "d".repeat(64);
const schemaHash = "e".repeat(64);
const planHash = "f".repeat(64);
/** The version-1 carrier's seven state stores; version 3 keeps four and deletes the three projections. */
const STATE_STORES = ["rows", "answers", "ranges", "absences", "verdicts", "outbox", "meta"];

const photo = (id: string, width = 8) => ({ id, width, height: 8 });
const clip = (id: string) => ({ id, width: 2, height: 2, duration: 2_000 });
const ref = (table: string, id: string) => ({ $row: { table, id } });
const emptyReceipt = () => ({ ranges: [], absences: [], verdicts: [] });
const key = (asset: string, width: number | null) => width === null ? asset : `${asset}.w${width}`;
const bytesOf = (length: number, fill: number) => new Uint8Array(length).fill(fill);
const messageRow = (id: string, asset: string, extra: Record<string, unknown> = {}) => ({
  table: "messages",
  id,
  row: { id, conversationId: "c1", at: Number(id.slice(1)), photo: photo(asset), ...extra },
});
const put = (assetId: string, width: number | null, length: number, fill: number) => ({
  assetId, width, bytes: bytesOf(length, fill), type: "image/jpeg",
});
const range = (overrides: Record<string, unknown> = {}) => ({
  site: "thread.range", table: "messages", index: "byConvTime", prefix: ["c1"], order: "Asc", take: 50,
  after: null, before: null, gt: null, gte: null, lt: null, lte: null, ruleHash: "a".repeat(64),
  rowIds: [] as string[], stop: "Exhausted", absence: false, ...overrides,
});

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "snapback2-bytes-"));
}

async function fileKeys(root: string, partition = "dev:alice"): Promise<string[]> {
  try {
    return (await readdir(join(root, `${encodeURIComponent(partition)}.bytes`))).sort();
  } catch {
    return [];
  }
}

function indexedFactory(database = new FakeIndexedDb(), locks = new FakeLocks()) {
  return { database, factory: indexedDbRangeStore({ indexedDB: database as any, locks: locks as any }) };
}

function envelope(data: unknown, rows: unknown[], seq = 3, validator = "1".repeat(64)) {
  return {
    protocol: 1, generation, schemaHash, planHash,
    authority: { principal: "dev:alice", authEpoch: 7 }, state: "complete", data, next: null, seq,
    rows, receipt: emptyReceipt(), validator,
  };
}

function metadataResponse(url: URL): Response | undefined {
  if (url.pathname === "/api/manifest") {
    return new Response(JSON.stringify({
      generation: "schema-generation", programGeneration: generation, ops: {}, channels: {}, auth: {},
      tables: { messages: { retain: "until-revoked" } },
    }), { status: 200 });
  }
  if (url.pathname === "/api/program") {
    return new Response(JSON.stringify({ code: "E_ROUTE", family: "op", message: "not found", guide: "op/reference" }), { status: 404 });
  }
  return undefined;
}

async function exerciseCache(store: any, carrierKeys: () => Promise<string[]>): Promise<void> {
  await store.open("dev:alice");
  await store.commit({ deliveries: [{
    op: "thread", args: {}, state: "complete",
    data: [ref("messages", "m1"), ref("messages", "m2"), ref("messages", "m3")], next: null, seq: 1,
    rows: [messageRow("m1", A), messageRow("m2", B), messageRow("m3", C)], receipt: emptyReceipt(),
  }] });
  assert.equal(await store.readBytes(A, 8), undefined, "a miss before any fetch");
  const ceiling = 10;
  await store.commit({ bytes: { put: [put(A, 8, 4, 1)], ceiling } });
  const hit = await store.readBytes(A, 8);
  assert.deepEqual([...hit.bytes], [1, 1, 1, 1]);
  assert.equal(hit.type, "image/jpeg");
  assert.deepEqual(await carrierKeys(), [key(A, 8)]);
  await store.commit({ bytes: { put: [put(D, 8, 2, 9)], ceiling } });
  assert.equal(await store.readBytes(D, 8), undefined, "no held row references D: nothing is cached");
  assert.deepEqual((await store.rowsReferencing(A)).map((row: any) => row.id), ["m1"]);
  await store.commit({ bytes: { put: [put(B, 8, 4, 2)], ceiling } });
  await store.commit({ bytes: { touch: [key(A, 8)] } });
  await store.commit({ bytes: { put: [put(C, 8, 4, 3)], ceiling } });
  const status = await store.bytes();
  assert.deepEqual(status.entries.map((entry: any) => entry.assetId).sort(), [A, C]);
  assert.equal(status.totalBytes, 8);
  assert.equal(await store.readBytes(B, 8), undefined, "the least-recently-read rendition left at the ceiling");
  assert.deepEqual(await carrierKeys(), [key(A, 8), key(C, 8)]);
  await store.commit({ bytes: { put: [put(A, 16, 11, 4)], ceiling } });
  assert.deepEqual((await store.bytes()).entries.map((entry: any) => key(entry.assetId, entry.width)).sort(), [key(A, 8), key(C, 8)]);
  await assert.rejects(store.commit({ bytes: { put: [{ ...put(A, 8, 1, 1), assetId: "asset-1" }] } }), TypeError);
  await store.close?.();
}

test("byte puts land only under a held row's lease, reads order the LRU, and the ceiling evicts least-recently-read on all three carriers", async () => {
  const root = await tempRoot();
  try {
    await exerciseCache(fileRangeStore(root)(), () => fileKeys(root));
    const sqlPath = join(root, "state.db");
    await exerciseCache(sqliteFactory(sqlPath)(), () => sqliteKeys(sqlPath));
    const sqlCold: any = sqliteFactory(sqlPath)();
    await sqlCold.open("dev:alice");
    assert.deepEqual([...(await sqlCold.readBytes(C, 8)).bytes], [3, 3, 3, 3]);
    await sqlCold.close();
    const reopened: any = fileRangeStore(root)();
    await reopened.open("dev:alice");
    assert.deepEqual([...(await reopened.readBytes(A, 8)).bytes], [1, 1, 1, 1], "payloads survive a cold open");
    await reopened.close?.();
    const { database, factory } = indexedFactory();
    await exerciseCache(factory(), async () => database.keys("snapback2:dev:alice", "bytes"));
    const cold: any = factory();
    await cold.open("dev:alice");
    assert.deepEqual([...(await cold.readBytes(C, 8)).bytes], [3, 3, 3, 3]);
    await cold.close?.();
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function exercisePurge(store: any, carrierKeys: () => Promise<string[]>): Promise<void> {
  await store.open("dev:alice");
  let seq = 0;
  const hold = async (op: string, data: unknown, rows: unknown[], receipt = emptyReceipt(), retention?: Record<string, string>) => {
    await store.commit({ deliveries: [{ op, args: {}, state: "complete", data, next: null, seq: ++seq, rows, receipt }], retention });
  };
  const cache = async (asset: string) => {
    await store.commit({ bytes: { put: [put(asset, 8, 4, 1)] } });
    assert.notEqual(await store.readBytes(asset, 8), undefined, `${asset} cached under its row`);
  };
  const gone = async (asset: string, why: string) => {
    assert.equal(await store.readBytes(asset, 8), undefined, why);
    assert.equal((await carrierKeys()).includes(key(asset, 8)), false, `${why}: payload left the carrier`);
  };

  await hold("body", ref("messages", "m1"), [messageRow("m1", A)]);
  await cache(A);
  await hold("absence", null, [], { ranges: [], absences: [["messages", "byId", ["m1"]]], verdicts: [] });
  await gone(A, "a point absence evicts the row and its bytes");

  const held = range({ rowIds: ["m2", "m3"] });
  await hold("page", [ref("messages", "m2"), ref("messages", "m3")], [messageRow("m2", B), messageRow("m3", C)], { ranges: [held], absences: [], verdicts: [] });
  await cache(B);
  await cache(C);
  // A fresh delivery of the same certified range under another op: the hole rule matches the range, not the op.
  await hold("page-fresh", [ref("messages", "m3")], [messageRow("m3", C)], { ranges: [{ ...held, rowIds: ["m3"] }], absences: [], verdicts: [] });
  await gone(B, "a hole in a fresh uniform range evicts the row and its bytes");
  assert.notEqual(await store.readBytes(C, 8), undefined, "the row still in the range keeps its bytes");

  await hold("body4", ref("messages", "m4"), [messageRow("m4", D)]);
  await cache(D);
  await store.commit({ tombstones: [{ table: "messages", id: "m4", seq: ++seq }] });
  await gone(D, "a tombstone evicts the row and its bytes");

  await hold("hidden", { message: ref("messages", "m5") }, [messageRow("m5", A)]);
  await cache(A);
  await hold("hidden", { message: null }, []);
  await gone(A, "hidden under until-revoked evicts the row and its bytes");

  await hold("history", { message: ref("messages", "m6") }, [messageRow("m6", B)]);
  await cache(B);
  await hold("history", { message: null }, [], emptyReceipt(), { messages: "delivered-history" });
  assert.equal((await store.answer("history", {}))?.retained, true);
  assert.notEqual(await store.readBytes(B, 8), undefined, "a retained row keeps its bytes");

  await store.commit({ resetCoverage: true });
  await gone(B, "dropping coverage drops every lease");
  await gone(C, "dropping coverage drops every lease");
  assert.deepEqual(await carrierKeys(), []);

  await hold("body7", ref("messages", "m7"), [messageRow("m7", C)]);
  await cache(C);
  await store.wipe("dev:alice");
  await store.open("dev:alice");
  assert.equal(await store.readBytes(C, 8), undefined, "wipe removed the bytes with the partition");
  assert.deepEqual(await carrierKeys(), []);
  await store.close?.();
}

test("bytes leave in the commit that evicts their row: absence, range hole, tombstone, hidden, reset, and wipe", async () => {
  const root = await tempRoot();
  try {
    await exercisePurge(fileRangeStore(root)(), () => fileKeys(root));
    const sqlPath = join(root, "state.db");
    await exercisePurge(sqliteFactory(sqlPath)(), () => sqliteKeys(sqlPath));
    await assert.rejects(stat(join(root, `${encodeURIComponent("dev:alice")}.bytes`)), "wipe removed the bytes directory");
    const { database, factory } = indexedFactory();
    await exercisePurge(factory(), async () => database.keys("snapback2:dev:alice", "bytes"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a sealed partition hides its bytes until the same principal returns, across a cold open", async () => {
  const root = await tempRoot();
  try {
    const store: any = fileRangeStore(root)();
    await store.open("dev:alice");
    await store.commit({ deliveries: [{
      op: "body", args: {}, state: "complete", data: ref("messages", "m1"), next: null, seq: 1,
      rows: [messageRow("m1", A)], receipt: emptyReceipt(),
    }] });
    await store.commit({ bytes: { put: [put(A, 8, 4, 1)] } });
    await store.seal();
    assert.equal(await store.readBytes(A, 8), undefined);
    assert.deepEqual(await store.bytes(), { entries: [], totalBytes: 0, viewed: [] });
    assert.deepEqual(await store.rowsReferencing(A), []);
    await assert.rejects(store.commit({ bytes: { put: [put(A, 16, 4, 1)] } }), /sealed/);
    await store.close?.();
    const cold: any = fileRangeStore(root)();
    await cold.open("dev:alice");
    assert.equal(await cold.readBytes(A, 8), undefined, "a cold open must not defeat the seal");
    await cold.unseal();
    assert.deepEqual([...(await cold.readBytes(A, 8)).bytes], [1, 1, 1, 1]);
    await cold.close?.();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("assetBlob reads the byte cache before the network, fills it after a fetch, and answers offline from it", async () => {
  const root = await tempRoot();
  try {
    let assetFetches = 0;
    const client = createClient({
      url: "http://bytes.test", as: "alice", offline: { store: fileRangeStore(root), maxAssetBytes: 64 },
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const metadata = metadataResponse(url);
        if (metadata) return metadata;
        if (url.pathname.startsWith("/api/asset/")) {
          assetFetches += 1;
          assert.equal(new Headers(init?.headers).get("X-Snapback-As"), "alice");
          return new Response(bytesOf(4, 7), { status: 200, headers: { "Content-Type": "image/jpeg" } });
        }
        if (url.pathname === "/api/query") return new Response(JSON.stringify(envelope([ref("messages", "m1")], [messageRow("m1", A)])), { status: 200 });
        throw new Error(`unexpected path ${url.pathname}`);
      },
    });
    await client.ready;
    const url = (await client.assetUrl(photo(A) as any, { width: 8 }))!;
    assert.equal((await client.assetBlob(url)).size, 4);
    assert.equal(assetFetches, 1);
    assert.equal(await client.assetCache!.get(A, 8), undefined, "nothing is cached until a held delivery references the asset");
    await client.query(api.messages.thread, { conversationId: "c1", c: null });
    const fetched = await client.assetBlob(url);
    assert.equal(assetFetches, 2);
    assert.equal(fetched.type, "image/jpeg");
    const served = await client.assetBlob(url);
    assert.equal(assetFetches, 2, "the second read is served from the byte cache");
    assert.equal(served.size, 4);
    assert.equal((await client.assetCache!.get(A, 8))?.size, 4);
    assert.deepEqual((await client.assetCache!.status()).entries.map((entry) => [entry.assetId, entry.width, entry.size]), [[A, 8, 4]]);
    await client.offline();
    assert.equal((await client.assetBlob(url)).size, 4, "a held rendition renders offline");
    await assert.rejects(client.assetBlob((await client.assetUrl(photo(A) as any, { width: 16 }))!), (error: unknown) =>
      error instanceof SnapbackRefusal && error.code === "E_NETWORK");
    assert.equal(assetFetches, 2);
    client.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a view-once row renders once: its bytes are never cached, a restart refuses them, and the held answer omits the row", async () => {
  const viewing = {};
  const root = await tempRoot();
  try {
    let assetFetches = 0;
    const make = () => createClient({
      url: "http://once.test", as: "alice",
      offline: { store: fileRangeStore(root), viewOnce: (table, row) => table === "messages" && row.id === "m2" },
      fetch: async (input) => {
        const url = new URL(String(input));
        const metadata = metadataResponse(url);
        if (metadata) return metadata;
        if (url.pathname.startsWith("/api/asset/")) {
          assetFetches += 1;
          return new Response(bytesOf(4, 5), { status: 200, headers: { "Content-Type": "image/jpeg" } });
        }
        if (url.pathname === "/api/query") {
          return new Response(JSON.stringify(envelope(
            [ref("messages", "m1"), ref("messages", "m2")],
            [messageRow("m1", A), messageRow("m2", B)],
          )), { status: 200 });
        }
        throw new Error(`unexpected path ${url.pathname}`);
      },
    });
    const client = make();
    await client.ready;
    await client.query(api.messages.thread, { conversationId: "c1", c: null });
    const urlA = (await client.assetUrl(photo(A) as any, { width: 8 }))!;
    const urlB = (await client.assetUrl(photo(B) as any, { width: 8 }))!;
    assert.equal((await client.assetBlob(urlB, { viewing })).size, 4, "the first view renders");
    assert.equal(assetFetches, 1);
    const status = await client.assetCache!.status();
    assert.deepEqual(status.entries, [], "view-once bytes are never cached");
    assert.deepEqual(status.viewed, [{ table: "messages", id: "m2" }]);
    assert.equal((await client.assetBlob(urlB, { viewing })).size, 4, "the viewing instance keeps rendering what it showed");
    assert.equal(assetFetches, 1);
    await client.assetBlob(urlA);
    assert.equal(assetFetches, 2);
    await client.offline();
    const cold = await client.restart();
    await assert.rejects(cold.assetBlob(urlB), (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_ASSET_VIEWED");
    assert.equal(cold.snapshot.lastRefusal?.code, "E_ASSET_VIEWED");
    assert.equal(assetFetches, 2, "a viewed view-once row fetches nothing");
    assert.equal(await cold.assetCache!.viewed(B), true);
    assert.equal(await cold.assetCache!.get(B, 8), undefined);
    const held = await cold.query<any, any>(api.messages.thread as any, { conversationId: "c1", c: null });
    assert.deepEqual(("data" in held ? held.data : []).map((row: any) => row?.id ?? null), ["m1", null], "the viewed row reads as absent");
    assert.equal((await cold.assetBlob(urlA)).size, 4, "the ordinary row's bytes render from the cache");
    cold.close();
    await cold.online().catch(() => undefined);
    const online = make();
    await online.ready;
    await assert.rejects(online.assetBlob(urlB), (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_ASSET_VIEWED");
    assert.equal(assetFetches, 2, "viewed is consulted before any byte is fetched, online too");
    online.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the IndexedDB carrier upgrades a version-1 database, keeps payloads in their own store, and rolls bytes back with the swap", async () => {
  const { database, factory } = indexedFactory();
  const name = "snapback2:dev:alice";
  database.seedVersion1(name, STATE_STORES);
  const store: any = factory();
  await store.open("dev:alice");
  assert.equal(database.hasStore(name, "bytes"), true, "open upgraded the database with the bytes store");
  await store.commit({ deliveries: [{
    op: "thread", args: {}, state: "complete", data: [ref("messages", "m1"), ref("messages", "m2")], next: null, seq: 1,
    rows: [messageRow("m1", A), messageRow("m2", B)], receipt: emptyReceipt(),
  }] });
  await store.commit({ bytes: { put: [put(A, 8, 4, 1)] } });
  assert.deepEqual(database.keys(name, "bytes"), [key(A, 8)]);
  assert.equal(database.keys(name, "rows").length, 2, "state stores never carry payloads");
  database.failNextPutIn = "bytes";
  await assert.rejects(store.commit({ bytes: { put: [put(B, 8, 4, 2)] } }), /injected put failure/);
  assert.equal(await store.readBytes(B, 8), undefined, "an aborted transaction leaves no index entry");
  assert.deepEqual(database.keys(name, "bytes"), [key(A, 8)], "and no payload");
  assert.deepEqual((await store.coverage()).rows.map((row: any) => row.id), ["m1", "m2"], "the rows survived the abort");
  await store.commit({ deliveries: [{
    op: "absence", args: {}, state: "complete", data: null, next: null, seq: 2,
    receipt: { ranges: [], absences: [["messages", "byId", ["m1"]]], verdicts: [] },
  }] });
  assert.deepEqual(database.keys(name, "bytes"), [], "the evicting swap dropped the payload in its own transaction");
  await store.wipe("dev:alice");
  assert.equal(database.has(name), false);
  await store.close?.();
});

test("a cache read stamps the LRU in memory without rewriting the carrier; the next swap persists the order", async () => {
  const root = await tempRoot();
  try {
    const statePath = join(root, `${encodeURIComponent("dev:alice")}.json`);
    const store: any = fileRangeStore(root)();
    await store.open("dev:alice");
    await store.commit({ deliveries: [{
      op: "thread", args: {}, state: "complete",
      data: [ref("messages", "m1"), ref("messages", "m2"), ref("messages", "m3")], next: null, seq: 1,
      rows: [messageRow("m1", A), messageRow("m2", B), messageRow("m3", C)], receipt: emptyReceipt(),
    }] });
    const ceiling = 10;
    await store.commit({ bytes: { put: [put(A, 8, 4, 1)], ceiling } });
    await store.commit({ bytes: { put: [put(B, 8, 4, 2)], ceiling } });
    const before = await readFile(statePath, "utf8");
    await store.touchBytes([key(A, 8)]);
    await store.touchBytes([key(A, 8)]);
    assert.equal(await readFile(statePath, "utf8"), before, "a read stamp never rewrites the carrier");
    await store.commit({ bytes: { put: [put(C, 8, 4, 3)], ceiling } });
    assert.deepEqual((await store.bytes()).entries.map((entry: any) => entry.assetId).sort(), [A, C], "the ceiling evicted B: A's in-memory stamp counted");
    await store.close?.();
    const cold: any = fileRangeStore(root)();
    await cold.open("dev:alice");
    const entries = (await cold.bytes()).entries;
    assert.ok(entries.find((entry: any) => entry.assetId === A).lastRead < entries.find((entry: any) => entry.assetId === C).lastRead, "the swap persisted the stamps");
    await cold.close?.();

    // The client's read path: cache hits touch in memory only.
    let assetFetches = 0;
    const client = createClient({
      url: "http://touch.test", as: "alice", offline: { store: fileRangeStore(root) },
      fetch: async (input) => {
        const url = new URL(String(input));
        const metadata = metadataResponse(url);
        if (metadata) return metadata;
        if (url.pathname.startsWith("/api/asset/")) {
          assetFetches += 1;
          return new Response(bytesOf(4, 7), { status: 200, headers: { "Content-Type": "image/jpeg" } });
        }
        if (url.pathname === "/api/query") return new Response(JSON.stringify(envelope([ref("messages", "m1")], [messageRow("m1", A)])), { status: 200 });
        throw new Error(`unexpected path ${url.pathname}`);
      },
    });
    await client.ready;
    await client.query(api.messages.thread, { conversationId: "c1", c: null });
    const url = (await client.assetUrl(photo(A) as any, { width: 16 }))!;
    await client.assetBlob(url);
    assert.equal(assetFetches, 1);
    const written = await readFile(statePath, "utf8");
    for (let read = 0; read < 3; read += 1) assert.equal((await client.assetBlob(url)).size, 4);
    assert.equal(assetFetches, 1, "served from the cache");
    assert.equal(await readFile(statePath, "utf8"), written, "three cache hits wrote nothing");
    client.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("AssetImage, AssetVideo, and useAssetUrl render held renditions from the byte cache offline without the network", async () => {
  const root = await tempRoot();
  const env = domEnvironment();
  let bytesCommitted!: () => void;
  const cachedRenditions = new Promise<void>((resolve) => { bytesCommitted = resolve; });
  const onlineStore = () => {
    const store: any = fileRangeStore(root)();
    const commit = store.commit.bind(store);
    store.commit = async (swap: unknown) => {
      await commit(swap);
      if ((await store.bytes()).entries.length === 2) bytesCommitted();
    };
    return store;
  };
  const assetFetches: string[] = [];
  let carrierCalls = 0;
  let phase: "online" | "offline" = "online";
  const fetch = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const metadata = metadataResponse(url);
    if (metadata) return metadata;
    if (url.pathname === "/api/query") {
      return new Response(JSON.stringify(envelope(
        [ref("messages", "m1"), ref("messages", "m2")],
        [messageRow("m1", A), { table: "messages", id: "m2", row: { id: "m2", conversationId: "c1", at: 2, clip: clip(V) } }],
      )), { status: 200 });
    }
    if (phase === "offline") throw new Error(`network used offline: ${url.pathname}`);
    if (url.pathname === "/api/auth/asset-session") {
      carrierCalls += 1;
      return new Response(JSON.stringify({ token: "dom-carrier", expiresAt: Date.now() + 120_000 }), { status: 200 });
    }
    if (url.pathname.startsWith("/api/asset/")) {
      assetFetches.push(`${url.pathname}${url.search}`);
      const video = url.pathname.endsWith(V);
      return new Response(bytesOf(video ? 6 : 4, 1), { status: 200, headers: { "Content-Type": video ? "video/mp4" : "image/jpeg" } });
    }
    throw new Error(`unexpected path ${url.pathname}`);
  };
  const seed = createClient({ url: "http://assets.test", as: "alice", offline: { store: fileRangeStore(root) }, fetch });
  await seed.ready;
  await seed.query(api.messages.thread, { conversationId: "c1", c: null });
  await seed.close();
  function Harness() {
    return React.createElement(React.Fragment, null,
      React.createElement(AssetImage, { asset: photo(A) as any, alt: "photo" }),
      React.createElement(AssetVideo, { asset: clip(V) as any, "aria-label": "clip" }),
    );
  }
  const document = env.dom.window.document;
  let reactRoot: Root | undefined;
  try {
    reactRoot = createRoot(document.getElementById("root")!);
    await act(async () => {
      reactRoot!.render(React.createElement(
        SnapbackProvider,
        { url: "http://assets.test", as: "alice", fetch, offline: { store: onlineStore } } as any,
        React.createElement(Harness),
      ));
    });
    assert.ok(await until(() => Boolean(document.querySelector("img")?.getAttribute("src")) && assetFetches.length >= 2));
    assert.deepEqual(assetFetches.sort(), [`/api/asset/${A}?w=240`, `/api/asset/${V}`], "the image at its width and the clip once, tokenless");
    assert.equal(document.querySelector("video")!.src, `http://assets.test/api/asset/${V}?s=dom-carrier`, "online, the player streams from the carrier");
    assert.ok(carrierCalls >= 1);
    const shown = document.querySelector("img")!.getAttribute("src")!;
    // A started fetch is not a held rendition: unmount aborts video prefetch.
    // Wait for both carrier writes before the offline cold mount.
    await act(async () => { await cachedRenditions; });
    await act(async () => reactRoot!.unmount());
    reactRoot = undefined;
    assert.ok(env.revoked.includes(shown), "unmount revoked the image's blob: URL");
    phase = "offline";
    const fetchesBefore = assetFetches.length;
    const carriersBefore = carrierCalls;
    reactRoot = createRoot(document.getElementById("root")!);
    await act(async () => {
      reactRoot!.render(React.createElement(
        SnapbackProvider,
        { url: "http://assets.test", as: "alice", fetch, offline: { store: fileRangeStore(root) } } as any,
        React.createElement(Harness),
      ));
    });
    assert.ok(await until(() => (document.querySelector("video")?.src ?? "").startsWith("blob:")));
    const img = document.querySelector("img")!;
    const player = document.querySelector("video")!;
    assert.match(img.getAttribute("src") ?? "", /^blob:test-/, "the image renders from the byte cache");
    assert.match(player.src, /^blob:test-/, "the clip plays from the byte cache");
    assert.equal(assetFetches.length, fetchesBefore, "no asset fetch offline");
    assert.equal(carrierCalls, carriersBefore, "no carrier minted for a held clip");
  } finally {
    if (reactRoot) await act(async () => reactRoot!.unmount());
    env.restore();
    await rm(root, { recursive: true, force: true });
  }
});
