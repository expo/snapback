import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SnapbackRefusal, api, browserTokenStore, createClient } from "../dist/client.mjs";
import { decodeDeliveryEnvelope } from "../dist/index.mjs";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";

const emptyReceipt = () => ({ ranges: [], absences: [], verdicts: [] });
const row = (table: string, id: string, body = id) => ({ table, id, row: { id, body } });
const ref = (table: string, id: string) => ({ $row: { table, id } });
const generation = "d".repeat(64);
const schemaHash = "e".repeat(64);
const planHash = "f".repeat(64);

async function golden(name: string): Promise<any> {
  const text = await readFile(new URL(`../../../corpus/offline/${name}`, import.meta.url), "utf8");
  return JSON.parse(text);
}

function deliveryFromEnvelope(op: string, args: unknown, value: any) {
  const decoded = decodeDeliveryEnvelope(value);
  return {
    op,
    args,
    state: decoded.state,
    data: decoded.data,
    next: decoded.next,
    seq: decoded.seq,
    validator: decoded.validator,
    rows: decoded.rows,
    receipt: decoded.receipt,
    ...(decoded.reason === undefined ? {} : { reason: decoded.reason }),
    ...(decoded.rule === undefined ? {} : { rule: decoded.rule }),
  };
}

const messageSchema = {
  tables: { messages: { indexes: { byConversationAt: { columns: ["conversationId", "at", "id"] } } } },
};

function metadataResponse(input: RequestInfo | URL): Response | undefined {
  const url = String(input);
  if (url.endsWith("/api/manifest")) {
    return new Response(JSON.stringify({
      generation: "schema-generation",
      programGeneration: generation,
      ops: {},
      channels: {},
      auth: {},
      tables: { messages: { retain: "delivered-history" } },
    }), { status: 200 });
  }
  if (url.includes("/api/program?")) {
    return new Response(JSON.stringify({
      generation,
      schemaHash,
      programs: {},
      schema: {
        tables: {
          messages: {
            columns: { id: "Id", conversationId: { Ref: { table: "conversations" } }, at: "Time", body: { Text: { max: 4000 } } },
            indexes: { byConvTime: { columns: ["conversationId", "at", "id"], unique: false }, byId: { columns: ["id"], unique: true } },
            retain: "delivered-history",
          },
        },
      },
    }), { status: 200 });
  }
  return undefined;
}

const range = (overrides: Record<string, unknown> = {}) => ({
  site: "thread.range",
  table: "messages",
  index: "byConvTime",
  prefix: ["c1"],
  order: "Asc",
  take: 50,
  after: null,
  before: null,
  gt: null,
  gte: null,
  lt: null,
  lte: null,
  ruleHash: "a".repeat(64),
  rowIds: [] as string[],
  stop: "Exhausted",
  absence: false,
  ...overrides,
});

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "snapback2-offline-"));
}

function indexedFactory(database = new FakeIndexedDb(), locks = new FakeLocks()) {
  return { database, locks, factory: indexedDbRangeStore({ indexedDB: database as any, locks: locks as any }) };
}

async function exerciseSharedRows(factory: ReturnType<typeof fileRangeStore>): Promise<void> {
  const store = factory();
  await store.open("dev:alice");
  const shared = row("messages", "m1", "hello");
  await store.commit({ deliveries: [{
    op: "one", args: {}, state: "complete", data: ref("messages", "m1"), next: null,
    seq: 1, rows: [shared], receipt: emptyReceipt(),
  }, {
    op: "two", args: {}, state: "complete", data: { message: ref("messages", "m1") }, next: null,
    seq: 1, rows: [shared], receipt: emptyReceipt(),
  }] });
  assert.equal((await store.coverage()).rows.length, 1);
  assert.deepEqual((await store.answer("one", {}))?.data, { id: "m1", body: "hello" });
  assert.deepEqual((await store.answer("two", {}))?.data, { message: { id: "m1", body: "hello" } });
  await store.close?.();
}

test("RangeStore stores rows once and shares them across answers on both carriers", async () => {
  const root = await tempRoot();
  try {
    await exerciseSharedRows(fileRangeStore(root));
    const { factory } = indexedFactory();
    await exerciseSharedRows(factory as ReturnType<typeof fileRangeStore>);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// @ref LLP 1012#4-the-range-store — the carrier holds only what `coverage()` reads back.
test("the IndexedDB carrier keeps rows, answers, outbox, meta, and bytes; the version-2 projection stores are deleted and never written", async () => {
  const { database, factory } = indexedFactory();
  const name = "snapback2:dev:alice";
  const fresh: any = factory();
  await fresh.open("dev:alice");
  assert.deepEqual(database.storeNames(name), ["answers", "bytes", "meta", "outbox", "rows"], "a fresh database has exactly the stores coverage() reads");
  await fresh.commit({ deliveries: [{
    op: "thread", args: {}, state: "complete", data: [ref("messages", "m1")], next: null, seq: 1, rows: [row("messages", "m1")],
    receipt: { ranges: [range({ rowIds: ["m1"] })], absences: [["messages", "byId", ["m9"]]], verdicts: [{ ruleHash: "a".repeat(64), pinnedInputsDigest: "b".repeat(64), principal: "dev:alice", authEpoch: 1, result: true }] },
  }] });
  assert.deepEqual(database.storeNames(name), ["answers", "bytes", "meta", "outbox", "rows"], "a swap with a receipt writes no projection store");
  assert.equal((await fresh.coverage()).ranges.length, 1, "coverage derives the range from the answer's receipt");
  assert.equal((await fresh.coverage()).absences.length, 1);
  assert.equal((await fresh.coverage()).verdicts.length, 1);
  await fresh.close?.();
  // A version-2 database (the seven state stores plus bytes) loses its three projections on open and keeps its answers.
  database.seedVersion2(name, ["rows", "answers", "ranges", "absences", "verdicts", "outbox", "meta", "bytes"]);
  const upgraded: any = factory();
  await upgraded.open("dev:alice");
  assert.deepEqual(database.storeNames(name), ["answers", "bytes", "meta", "outbox", "rows"], "version 3 deleted the projections");
  await upgraded.close?.();
});

test("a pooled row no answer references any more leaves the swap: a replaced closure drops what it stopped pooling, a dropped answer drops its pool", async () => {
  const root = await tempRoot();
  const store = fileRangeStore(root)();
  await store.open("dev:alice");
  // `mem1` is pooled as a rule input (never cited by `data`); it survives only through the answer's refs.
  await store.commit({ deliveries: [{
    op: "thread", args: {}, state: "complete", data: [ref("messages", "m1")], next: null, seq: 1,
    rows: [row("messages", "m1"), row("memberships", "mem1")], receipt: emptyReceipt(),
  }, {
    op: "other", args: {}, state: "complete", data: [ref("messages", "m2")], next: null, seq: 1,
    rows: [row("messages", "m2"), row("memberships", "mem2")], receipt: emptyReceipt(),
  }] });
  assert.deepEqual((await store.coverage()).rows.map((item) => item.id).sort(), ["m1", "m2", "mem1", "mem2"], "pooled rule inputs are held");
  // The same answer re-delivered without `mem1` in its closure: the row is referenced by nothing and leaves.
  await store.commit({ deliveries: [{
    op: "thread", args: {}, state: "complete", data: [ref("messages", "m1")], next: null, seq: 2,
    rows: [row("messages", "m1")], receipt: emptyReceipt(),
  }] });
  assert.deepEqual((await store.coverage()).rows.map((item) => item.id).sort(), ["m1", "m2", "mem2"], "a replaced closure drops the row it stopped pooling");
  assert.deepEqual((await store.coverage()).evicted, [], "leaving unreferenced is not an eviction");
  await store.commit({ dropAnswers: ["other\u0000{}"] });
  assert.deepEqual((await store.coverage()).rows.map((item) => item.id).sort(), ["m1"], "a dropped answer takes its pool with it");
  await store.close?.();
  await rm(root, { recursive: true, force: true });
});

test("file and IndexedDB swaps are atomic when persistence fails", async () => {
  const root = await tempRoot();
  let failRename = false;
  const file = fileRangeStore(root, { beforeRename: () => {
    if (failRename) throw new Error("kill before rename");
  } });
  const store = file();
  await store.open("dev:alice");
  await store.commit({ deliveries: [{ op: "list", args: {}, state: "complete", data: [1], next: null, seq: 1 }] });
  failRename = true;
  await assert.rejects(store.commit({ deliveries: [{ op: "list", args: {}, state: "complete", data: [2], next: null, seq: 2 }] }));
  await store.close?.();
  const reopened = fileRangeStore(root)();
  await reopened.open("dev:alice");
  assert.deepEqual((await reopened.answer("list", {}))?.data, [1]);

  const { database, factory } = indexedFactory();
  const indexed = factory();
  await indexed.open("dev:bob");
  await indexed.commit({ deliveries: [{ op: "list", args: {}, state: "complete", data: [1], next: null, seq: 1 }] });
  database.failNextPut = true;
  await assert.rejects(indexed.commit({ deliveries: [{ op: "list", args: {}, state: "complete", data: [2], next: null, seq: 2 }] }));
  assert.deepEqual((await indexed.answer("list", {}))?.data, [1]);
  database.abortNextPut = true;
  await assert.rejects(
    indexed.commit({ deliveries: [{ op: "list", args: {}, state: "complete", data: [3], next: null, seq: 3 }] }),
    /asynchronous put failure/,
  );
  assert.deepEqual((await indexed.answer("list", {}))?.data, [1]);
  await indexed.close?.();
  const indexedReopened = factory();
  await indexedReopened.open("dev:bob");
  assert.deepEqual((await indexedReopened.answer("list", {}))?.data, [1]);
  await indexedReopened.close?.();
  await rm(root, { recursive: true, force: true });
});

test("a process killed between file write and rename leaves the previous snapshot", async () => {
  const root = await tempRoot();
  const seeded = fileRangeStore(root)();
  await seeded.open("dev:alice");
  await seeded.commit({ deliveries: [{
    op: "list", args: {}, state: "complete", data: [1], next: null, seq: 1,
  }] });
  await seeded.close?.();

  const moduleUrl = new URL("../dist/test.mjs", import.meta.url).href;
  const script = `
    const { fileRangeStore } = await import(${JSON.stringify(moduleUrl)});
    const store = fileRangeStore(${JSON.stringify(root)}, {
      beforeRename: async () => {
        process.stdout.write("barrier\\n");
        await new Promise(() => {});
      },
    })();
    await store.open("dev:alice");
    await store.commit({ deliveries: [{
      op: "list", args: {}, state: "complete", data: [2], next: null, seq: 2,
    }] });
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`carrier child exited before barrier: ${code}`)));
    child.stdout.once("data", () => resolve());
  });
  assert.equal(child.kill("SIGKILL"), true);
  await once(child, "exit");

  const reopened = fileRangeStore(root)();
  await reopened.open("dev:alice");
  assert.deepEqual((await reopened.answer("list", {}))?.data, [1]);
  await reopened.close?.();
  await rm(root, { recursive: true, force: true });
});

async function exerciseEvictions(store: any): Promise<void> {
  await store.open("dev:alice");
  const heldRange = range({ rowIds: ["m1", "m2"] });
  await store.commit({ deliveries: [{
    op: "thread", args: { c: null }, state: "complete",
    data: [ref("messages", "m1"), ref("messages", "m2")], next: null, seq: 1,
    rows: [row("messages", "m1"), row("messages", "m2")],
    receipt: { ranges: [heldRange], absences: [], verdicts: [] },
  }] });
  await store.commit({ deliveries: [{
    op: "fresh", args: {}, state: "complete", data: ref("messages", "m2"), next: null, seq: 2,
    rows: [row("messages", "m2")],
    receipt: { ranges: [{ ...heldRange, rowIds: ["m2"] }], absences: [], verdicts: [] },
  }] });
  assert.deepEqual((await store.coverage()).rows.map((item) => item.id), ["m2"], "uniform-range hole evicts");

  const limitedRange = range({
    site: "thread.limit", prefix: ["c2"], rowIds: ["m7", "m8", "m9"], stop: "Limit",
  });
  await store.commit({ deliveries: [{
    op: "limited", args: {}, state: "capped",
    data: [ref("messages", "m7"), ref("messages", "m8"), ref("messages", "m9")], next: "c9", seq: 2,
    rows: [
      { table: "messages", id: "m7", row: { id: "m7", conversationId: "c2", at: 7 } },
      { table: "messages", id: "m8", row: { id: "m8", conversationId: "c2", at: 8 } },
      { table: "messages", id: "m9", row: { id: "m9", conversationId: "c2", at: 9 } },
    ],
    receipt: { ranges: [limitedRange], absences: [], verdicts: [] },
  }] });
  await store.commit({ deliveries: [{
    op: "limited-fresh", args: {}, state: "capped", data: [ref("messages", "m7"), ref("messages", "m9")],
    next: "c10", seq: 3, rows: [
      { table: "messages", id: "m7", row: { id: "m7", conversationId: "c2", at: 7 } },
      { table: "messages", id: "m9", row: { id: "m9", conversationId: "c2", at: 9 } },
    ],
    receipt: { ranges: [{ ...limitedRange, rowIds: ["m7", "m9"] }], absences: [], verdicts: [] },
  }], schema: { tables: { messages: { indexes: { byConvTime: { columns: ["conversationId", "at", "id"] } } } } } });
  assert.equal((await store.coverage()).rows.some((item) => item.id === "m8"), false, "limited extent hole evicts");

  await store.commit({ deliveries: [{
    op: "body", args: {}, state: "complete", data: ref("messages", "m3"), next: null, seq: 3,
    rows: [row("messages", "m3")], receipt: emptyReceipt(),
  }] });
  await store.commit({ deliveries: [{
    op: "absence", args: {}, state: "complete", data: null, next: null, seq: 4,
    receipt: { ranges: [], absences: [["messages", "byId", ["m3"]]], verdicts: [] },
  }] });
  assert.equal((await store.coverage()).rows.some((item) => item.id === "m3"), false, "point absence evicts");

  await store.commit({ deliveries: [{
    op: "body4", args: {}, state: "complete", data: ref("messages", "m4"), next: null, seq: 5,
    rows: [row("messages", "m4")], receipt: emptyReceipt(),
  }], tombstones: [{ table: "messages", id: "m4", seq: 5 }] });
  assert.equal((await store.coverage()).rows.some((item) => item.id === "m4"), false, "tombstone evicts");

  await store.commit({ deliveries: [{
    op: "hidden-default", args: {}, state: "complete", data: { message: ref("messages", "m5") }, next: null,
    seq: 6, rows: [row("messages", "m5")], receipt: emptyReceipt(),
  }] });
  await store.commit({ deliveries: [{
    op: "hidden-default", args: {}, state: "complete", data: { message: null }, next: null,
    seq: 7, receipt: emptyReceipt(),
  }] });
  assert.equal((await store.coverage()).rows.some((item) => item.id === "m5"), false, "default hidden evicts");

  await store.commit({ deliveries: [{
    op: "history", args: {}, state: "complete", data: { message: ref("messages", "m6") }, next: null,
    seq: 8, rows: [row("messages", "m6", "history")], receipt: emptyReceipt(),
  }] });
  await store.commit({ retention: { messages: "delivered-history" }, deliveries: [{
    op: "history", args: {}, state: "complete", data: { message: null }, next: null,
    seq: 9, receipt: emptyReceipt(),
  }] });
  const history = await store.answer<any>("history", {});
  assert.equal(history?.retained, true);
  assert.deepEqual(history?.data, { message: { id: "m6", body: "history" } });
  await store.close?.();
}

test("both carriers apply the four swap rules with until-revoked and delivered-history", async () => {
  const root = await tempRoot();
  try {
    await exerciseEvictions(fileRangeStore(root)());
    await exerciseEvictions(indexedFactory().factory());
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("O1a golden ranges evict only holes inside Exhausted bounds and the returned Limit extent", async () => {
  const root = await tempRoot();
  const store = fileRangeStore(root)();
  await store.open("alice");

  const exhaustedHeld = await golden("envelope-uniform-range-halo.json");
  exhaustedHeld.seq = 16;
  exhaustedHeld.validator = "0".repeat(64);
  exhaustedHeld.data = [
    ref("messages", "message-1"),
    ref("messages", "message-inside"),
    ref("messages", "message-outside"),
    ref("messages", "message-boundary"),
  ];
  exhaustedHeld.rows.push(
    row("messages", "message-inside", "inside"),
    { table: "messages", id: "message-outside", row: {
      id: "message-outside", conversationId: "conversation-2", at: 1, body: "outside",
    } },
    { table: "messages", id: "message-boundary", row: {
      id: "message-boundary", conversationId: "conversation-1", at: 0, body: "before cursor",
    } },
  );
  exhaustedHeld.rows.at(-3).row.conversationId = "conversation-1";
  exhaustedHeld.rows.at(-3).row.at = 3;
  exhaustedHeld.receipt.ranges[0].after = [0, "message-boundary"];
  exhaustedHeld.receipt.ranges[0].rowIds = [
    "message-1", "message-inside", "message-outside", "message-boundary",
  ];
  await store.commit({ deliveries: [deliveryFromEnvelope("exhausted-held", {}, exhaustedHeld)] });
  const exhaustedFresh = await golden("envelope-uniform-range-halo.json");
  exhaustedFresh.receipt.ranges[0].after = [0, "message-boundary"];
  await store.commit({
    deliveries: [deliveryFromEnvelope("exhausted-fresh", {}, exhaustedFresh)],
    schema: messageSchema,
  });
  const afterExhausted = (await store.coverage()).rows.map((item) => item.id);
  assert.equal(afterExhausted.includes("message-inside"), false);
  assert.equal(afterExhausted.includes("message-outside"), true, "a different prefix is outside Exhausted extent");
  assert.equal(afterExhausted.includes("message-boundary"), true, "the exclusive after cursor bounds Exhausted extent");

  const limitedHeld = await golden("envelope-capped-page-next.json");
  limitedHeld.seq = 18;
  limitedHeld.validator = "2".repeat(64);
  limitedHeld.data = ["message-1", "message-2", "message-3", "message-4"]
    .map((id) => ref("messages", id));
  limitedHeld.rows.push(
    { table: "messages", id: "message-3", row: { id: "message-3", conversationId: "conversation-1", at: 3 } },
    { table: "messages", id: "message-4", row: { id: "message-4", conversationId: "conversation-1", at: 4 } },
  );
  limitedHeld.receipt.ranges[0].rowIds = ["message-1", "message-2", "message-3", "message-4"];
  await store.commit({ deliveries: [deliveryFromEnvelope("limited-held", {}, limitedHeld)] });
  const limitedFresh = await golden("envelope-capped-page-next.json");
  limitedFresh.seq = 19;
  limitedFresh.validator = "3".repeat(64);
  limitedFresh.data = [ref("messages", "message-1"), ref("messages", "message-3")];
  limitedFresh.rows.push({
    table: "messages", id: "message-3",
    row: { id: "message-3", conversationId: "conversation-1", at: 3 },
  });
  limitedFresh.receipt.ranges[0].rowIds = ["message-1", "message-3"];
  delete limitedFresh.receipt.ranges[0].haloId;
  await store.commit({
    deliveries: [deliveryFromEnvelope("limited-fresh", {}, limitedFresh)],
    schema: messageSchema,
  });
  const afterLimit = (await store.coverage()).rows.map((item) => item.id);
  assert.equal(afterLimit.includes("message-2"), false, "a missing key between returned keys is evicted");
  assert.equal(afterLimit.includes("message-4"), true, "a key after the last returned key is outside Limit extent");
  await store.close?.();
  await rm(root, { recursive: true, force: true });
});

test("the O1a whole-answer-null golden is hidden evidence and delivered-history restores it", async () => {
  const root = await tempRoot();
  const store = fileRangeStore(root)();
  await store.open("alice");
  const hit = await golden("envelope-point-hit.json");
  hit.seq = 16;
  await store.commit({ deliveries: [deliveryFromEnvelope("messages.alternate", {}, hit)] });
  const hidden = await golden("envelope-hidden-point-alternate-key.json");
  await store.commit({
    deliveries: [deliveryFromEnvelope("messages.alternate", {}, hidden)],
    retention: { messages: "delivered-history" },
  });
  const answer = await store.answer<any>("messages.alternate", {});
  assert.equal(answer?.retained, true);
  assert.equal(answer?.data.body, "hello");
  await store.close?.();
  await rm(root, { recursive: true, force: true });
});

test("sequence fences make absence, hidden, and tombstone evidence monotonic and deliveries idempotent", async () => {
  const root = await tempRoot();
  const store = fileRangeStore(root)();
  await store.open("dev:alice");

  await store.commit({ deliveries: [{
    op: "absence-seed", args: {}, state: "complete", data: ref("messages", "a"), next: null, seq: 9,
    rows: [row("messages", "a")], receipt: emptyReceipt(), deliveredAt: 1,
  }] });
  await store.commit({ deliveries: [{
    op: "absence", args: {}, state: "complete", data: null, next: null, seq: 10,
    receipt: { ranges: [], absences: [["messages", "byId", ["a"]]], verdicts: [] }, deliveredAt: 2,
  }] });
  await store.commit({ deliveries: [{
    op: "absence-replay", args: {}, state: "complete", data: ref("messages", "a"), next: null, seq: 9,
    rows: [row("messages", "a", "stale")], receipt: emptyReceipt(), deliveredAt: 3,
  }] });
  assert.equal((await store.coverage()).rows.some((item) => item.id === "a"), false);

  await store.commit({ deliveries: [{
    op: "hidden", args: {}, state: "complete", data: ref("messages", "h"), next: null, seq: 19,
    rows: [row("messages", "h")], receipt: emptyReceipt(), deliveredAt: 4,
  }] });
  await store.commit({ deliveries: [{
    op: "hidden", args: {}, state: "complete", data: null, next: null, seq: 20,
    receipt: emptyReceipt(), deliveredAt: 5,
  }] });
  await store.commit({ deliveries: [{
    op: "hidden", args: {}, state: "complete", data: ref("messages", "h"), next: null, seq: 19,
    rows: [row("messages", "h", "stale")], receipt: emptyReceipt(), deliveredAt: 6,
  }] });
  assert.equal((await store.coverage()).rows.some((item) => item.id === "h"), false);

  await store.commit({ deliveries: [{
    op: "tombstone-seed", args: {}, state: "complete", data: ref("messages", "t"), next: null, seq: 29,
    rows: [row("messages", "t")], receipt: emptyReceipt(), deliveredAt: 7,
  }] });
  await store.commit({ tombstones: [{ table: "messages", id: "t", seq: 30 }] });
  await store.commit({ deliveries: [{
    op: "tombstone-replay", args: {}, state: "complete", data: ref("messages", "t"), next: null, seq: 29,
    rows: [row("messages", "t", "stale")], receipt: emptyReceipt(), deliveredAt: 8,
  }] });
  assert.equal((await store.coverage()).rows.some((item) => item.id === "t"), false);

  const duplicate = {
    op: "duplicate", args: {}, state: "complete" as const, data: [1], next: null, seq: 40,
    receipt: emptyReceipt(), deliveredAt: 9,
  };
  await store.commit({ deliveries: [duplicate] });
  const once = await store.answer("duplicate", {});
  await store.commit({ deliveries: [duplicate] });
  assert.deepEqual(await store.answer("duplicate", {}), once);
  await assert.rejects(store.commit({ deliveries: [{ ...duplicate, data: [2] }] }), /conflicting deliveries/);
  await store.commit({ deliveries: [{
    op: "row-one", args: {}, state: "complete", data: ref("messages", "same-seq"), next: null, seq: 41,
    rows: [row("messages", "same-seq", "one")], receipt: emptyReceipt(),
  }] });
  await assert.rejects(store.commit({ deliveries: [{
    op: "row-two", args: {}, state: "complete", data: ref("messages", "same-seq"), next: null, seq: 41,
    rows: [row("messages", "same-seq", "two")], receipt: emptyReceipt(),
  }] }), /conflicting row/);
  await assert.rejects(store.commit({ deliveries: [{
    op: "bad-absence", args: {}, state: "complete", data: null, next: null, seq: 42,
    receipt: { ranges: [], absences: [["messages", "byAlternate", ["same-seq"]]], verdicts: [] },
  }] }), /primary byId absence/);
  await store.close?.();
  await rm(root, { recursive: true, force: true });
});

test("shrunk arrays and denied answers emit the hidden signal", async () => {
  const root = await tempRoot();
  const store = fileRangeStore(root)();
  await store.open("dev:alice");
  await store.commit({ deliveries: [{
    op: "shrunk", args: {}, state: "complete", data: [ref("messages", "s1"), ref("messages", "s2")],
    next: null, seq: 1, rows: [row("messages", "s1"), row("messages", "s2")], receipt: emptyReceipt(),
  }] });
  await store.commit({ deliveries: [{
    op: "shrunk", args: {}, state: "complete", data: [ref("messages", "s1")], next: null, seq: 2,
    rows: [row("messages", "s1")], receipt: emptyReceipt(),
  }] });
  assert.equal((await store.coverage()).rows.some((item) => item.id === "s2"), false);
  await store.commit({ deliveries: [{
    op: "denied", args: {}, state: "complete", data: ref("messages", "d1"), next: null, seq: 3,
    rows: [row("messages", "d1")], receipt: emptyReceipt(),
  }] });
  await store.commit({ deliveries: [{
    op: "denied", args: {}, state: "denied", seq: 4, rule: "messages.Read", receipt: emptyReceipt(),
  }] });
  assert.equal((await store.coverage()).rows.some((item) => item.id === "d1"), false);
  await store.close?.();
  await rm(root, { recursive: true, force: true });
});

test("seal survives a cold open, confirmed re-auth unseals, and wipe deletes the partition", async () => {
  for (const make of [fileRangeStore(await tempRoot()), indexedFactory().factory]) {
    let store = make();
    await store.open("dev:alice");
    await store.commit({ deliveries: [{ op: "list", args: {}, state: "complete", data: [1], next: null, seq: 1 }] });
    await store.outbox.put({ intent: "i1", ids: [], op: "send", args: { body: "secret" }, state: "queued", createdAt: 1, updatedAt: 1 });
    await store.seal();
    assert.equal(await store.answer("list", {}), undefined);
    await assert.rejects(store.outbox.all(), /sealed/);
    await assert.rejects(store.outbox.get("i1"), /sealed/);
    await assert.rejects(store.outbox.remove("i1"), /sealed/);
    await assert.rejects(store.outbox.put({
      intent: "i2", ids: [], op: "send", args: {}, state: "queued", createdAt: 2, updatedAt: 2,
    }), /sealed/);
    await store.close?.();
    store = make();
    await store.open("dev:alice");
    assert.equal(await store.answer("list", {}), undefined, "cold open must not defeat the seal");
    await store.unseal(); // the client calls this only after owner-confirmed authentication
    assert.deepEqual((await store.answer("list", {}))?.data, [1]);
    const entries = await store.outbox.all();
    entries[0]!.args = { body: "mutated copy" };
    assert.deepEqual((await store.outbox.get("i1"))?.args, { body: "secret" });
    await store.wipe("dev:alice");
    await store.open("dev:alice");
    assert.equal(await store.answer("list", {}), undefined);
    await store.close?.();
  }
});

test("carrier open failures and a second web lock holder refuse loudly", async () => {
  const badFactory: any = () => ({
    open: async () => { throw new Error("disk unavailable"); }, seal: async () => undefined,
    wipe: async () => undefined, answer: async () => undefined, commit: async () => undefined,
    coverage: async () => ({ rows: [], ranges: [], absences: [], verdicts: [], watermarks: [] }),
    outbox: { all: async () => [], get: async () => undefined, put: async () => undefined, remove: async () => undefined },
  });
  Object.defineProperty(badFactory, "carrier", { value: "broken-test" });
  const bad = createClient({ url: "http://offline.test", as: "alice", offline: { store: badFactory } });
  await assert.rejects(bad.ready, (error: unknown) => error instanceof SnapbackRefusal
    && error.code === "E_OFFLINE_CARRIER" && error.envelope.rewrite?.includes("broken-test") === true);

  const shared = indexedFactory();
  const first = createClient({ url: "http://offline.test", as: "alice", offline: { store: shared.factory } });
  await first.ready;
  const second = createClient({ url: "http://offline.test", as: "alice", offline: { store: shared.factory } });
  await assert.rejects(second.ready, (error: unknown) => error instanceof SnapbackRefusal
    && error.code === "E_OFFLINE_LOCK" && error.envelope.rewrite === "this account is open in another tab");
  first.close();
  second.close();
});

test("offline option shape and fenceDays bounds are TypeErrors", () => {
  const rootFactory = fileRangeStore("/tmp/snapback2-option-shape-test");
  for (const fenceDays of [0, 31, 1.5, "7", null]) {
    assert.throws(
      () => createClient({ url: "http://options.test", as: "alice", offline: { store: rootFactory, fenceDays } } as any),
      TypeError,
    );
  }
  assert.throws(
    () => createClient({ url: "http://options.test", as: "alice", offline: { store: {} } } as any),
    TypeError,
  );
});

test("a sealed cold start stays unreadable until auth.me confirms the same bearer principal", async () => {
  const root = await tempRoot();
  const values = new Map<string, string>();
  const tokenStore = browserTokenStore({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  }, "auth");
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const metadata = metadataResponse(input);
    if (metadata) return metadata;
    if (String(input).endsWith("/api/auth/login")) {
      return new Response(JSON.stringify({ token: "token-1", viewer: "principal-1" }), { status: 200 });
    }
    if (String(input).endsWith("/api/auth/me")) {
      return new Response(JSON.stringify({ viewer: "principal-1", kind: "user" }), { status: 200 });
    }
    assert.equal(new URL(String(input)).searchParams.get("receipt"), "1");
    return new Response(JSON.stringify({ state: "complete", data: ["held"], seq: 1, next: null }), { status: 200 });
  };
  const first = createClient({ url: "http://bearer.test", tokenStore, offline: { store: fileRangeStore(root) }, fetch });
  await first.auth.login({ email: "a@example.com", password: "password" });
  await first.query(api.messages.thread, { c: null });
  first.close();
  const sealed = fileRangeStore(root)();
  await sealed.open("principal-1");
  await sealed.seal();
  await sealed.close?.();
  const unauthenticated = createClient({
    url: "http://bearer.test",
    tokenStore,
    offline: { store: fileRangeStore(root) },
    fetch: async () => { throw new Error("network down"); },
  });
  await unauthenticated.ready;
  await unauthenticated.offline();
  assert.equal((await unauthenticated.query<any, any>(api.messages.thread as any, { c: null })).state, "hydrating");
  unauthenticated.close();
  const cold = createClient({ url: "http://bearer.test", tokenStore, offline: { store: fileRangeStore(root) }, fetch });
  await cold.ready;
  await cold.offline();
  const held = await cold.query<any, any>(api.messages.thread as any, { c: null });
  assert.deepEqual("data" in held ? held.data : undefined, ["held"]);
  cold.close();
  await rm(root, { recursive: true, force: true });
});

// @ref LLP 1012#15-diagnostics — a partition mismatch is `E_OFFLINE_AUTHORITY`,
// never `E_OFFLINE_RESET`: the held coverage survives the refused delivery.
test("an envelope cannot switch the open principal partition: E_OFFLINE_AUTHORITY, and the held coverage survives", async () => {
  const root = await tempRoot();
  let reads = 0;
  const client = createClient({
    url: "http://authority.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input) => {
      const metadata = metadataResponse(input);
      if (metadata) return metadata;
      const value = envelope([reads === 0 ? "held" : "secret"], String(reads + 1).repeat(64), reads + 1);
      if (reads++ > 0) value.authority.principal = "dev:bob";
      return new Response(JSON.stringify(value), { status: 200 });
    },
  });
  await client.ready;
  await client.query(api.messages.thread, {});
  await assert.rejects(client.query(api.messages.thread, {}), (error: unknown) =>
    error instanceof SnapbackRefusal && error.code === "E_OFFLINE_AUTHORITY" && error.envelope.family === "offline"
      && error.envelope.site === "RangeStore.commit" && typeof error.envelope.rewrite === "string");
  await client.offline();
  const held = await client.query<any, any>(api.messages.thread as any, {});
  assert.deepEqual("data" in held ? held.data : undefined, ["held"], "the held coverage survived the refused delivery");
  await client.close();
  for (const principal of ["dev:alice", "dev:bob"]) {
    const inspect = fileRangeStore(root)();
    await inspect.open(principal);
    const answer = await inspect.answer("messages.thread", {});
    if (principal === "dev:alice") assert.deepEqual(answer?.data, ["held"], "alice's coverage is intact on disk");
    else assert.equal(answer, undefined, "nothing was committed under the delivery's principal");
    await inspect.close?.();
  }
  await rm(root, { recursive: true, force: true });
});

test("manifest retention is loaded before the first commit without an app manifest call", async () => {
  const root = await tempRoot();
  const hit = await golden("envelope-point-hit.json");
  hit.authority.principal = "dev:alice";
  hit.seq = 16;
  const hidden = await golden("envelope-hidden-point-alternate-key.json");
  hidden.authority.principal = "dev:alice";
  let reads = 0;
  const client = createClient({
    url: "http://retention.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input) => {
      const metadata = metadataResponse(input);
      if (metadata) return metadata;
      return new Response(JSON.stringify(reads++ === 0 ? hit : hidden), { status: 200 });
    },
  });
  await client.ready;
  await client.query(api.messages.alternate as any, {});
  await client.query(api.messages.alternate as any, {});
  await client.offline();
  const held = await client.query<any, any>(api.messages.alternate as any, {});
  assert.equal("retained" in held && held.retained, true);
  assert.equal("data" in held && held.data?.body, "hello");
  await client.close();
  await rm(root, { recursive: true, force: true });
});

test("conditional unchanged branches before envelope decoding and refreshes the held seq", async () => {
  const root = await tempRoot();
  const validator = "7".repeat(64);
  let reads = 0;
  const client = createClient({
    url: "http://conditional.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input, init) => {
      const metadata = metadataResponse(input);
      if (metadata) return metadata;
      const request = JSON.parse(String(init?.body));
      if (reads++ === 0) return new Response(JSON.stringify(envelope(["held"], validator, 3)), { status: 200 });
      assert.equal(request.validator, validator);
      return new Response(JSON.stringify({ state: "unchanged", seq: 4, validator }), { status: 200 });
    },
  });
  await client.ready;
  await client.query(api.messages.thread, {});
  const unchanged = await client.query<any, any>(api.messages.thread as any, {});
  assert.equal(unchanged.seq, 4);
  assert.deepEqual("data" in unchanged ? unchanged.data : undefined, ["held"]);
  await client.offline();
  assert.equal((await client.query<any, any>(api.messages.thread as any, {})).seq, 4);
  await client.close();
  await rm(root, { recursive: true, force: true });
});

test("a subscription conditional unchanged frame reuses the held pooled answer", async () => {
  const root = await tempRoot();
  const validator = "9".repeat(64);
  const client = createClient({
    url: "http://conditional-sse.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input) => {
      const metadata = metadataResponse(input);
      if (metadata) return metadata;
      const url = String(input);
      if (url.includes("/api/query")) return new Response(JSON.stringify(envelope(["held"], validator, 3)), { status: 200 });
      assert.equal(new URL(url).searchParams.get("validator"), validator);
      return sse({ state: "unchanged", seq: 4, validator });
    },
  });
  await client.ready;
  await client.query(api.messages.thread, {});
  const sub = client.subscribe(api.messages.thread, {}, () => undefined);
  const unchanged = await sub.until((item) => item.state === "complete", 1_000);
  assert.equal(unchanged.live, true);
  assert.equal(unchanged.seq, 4);
  assert.deepEqual("data" in unchanged ? unchanged.data : undefined, ["held"]);
  sub.close();
  await client.close();
  await rm(root, { recursive: true, force: true });
});

// @ref LLP 1012#15-diagnostics — another auth epoch under the same program is
// `E_OFFLINE_AUTHORITY` and the coverage is kept; another generation is a
// rotation: the live answer is served, and the held coverage is superseded —
// `hydrating` offline, never stale-exact — until the reset path rebuilds it.
test("an auth-epoch mismatch cannot replace held coverage; a generation mismatch supersedes it without a refusal", async () => {
  const root = await tempRoot();
  let reads = 0;
  const client = createClient({
    url: "http://epoch.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input) => {
      if (String(input).endsWith("/api/resume") && reads >= 3) {
        throw new TypeError("the reset transport closed after the live delivery");
      }
      const metadata = metadataResponse(input);
      if (metadata) return metadata;
      const value = envelope([["held", "wrong", "rotated"][reads] ?? "later"], String(reads + 1).repeat(64), reads + 1);
      if (reads === 1) value.authority.authEpoch = 8;
      if (reads >= 2) value.generation = "9".repeat(64);
      reads += 1;
      return new Response(JSON.stringify(value), { status: 200 });
    },
  });
  await client.ready;
  await client.query(api.messages.thread, {});
  await assert.rejects(client.query(api.messages.thread, {}), (error: unknown) =>
    error instanceof SnapbackRefusal && error.code === "E_OFFLINE_AUTHORITY");
  await client.offline();
  const held = await client.query<any, any>(api.messages.thread as any, {});
  assert.deepEqual("data" in held ? held.data : undefined, ["held"], "the fence refused the delivery and kept the coverage");
  await client.online();
  const rotated = await client.query<any, any>(api.messages.thread as any, {});
  assert.deepEqual("data" in rotated ? rotated.data : undefined, ["rotated"], "a rotation serves the live answer, refusing nothing");
  await client.offline();
  const superseded = await client.query<any, any>(api.messages.thread as any, {});
  assert.deepEqual(superseded, { state: "hydrating", live: false, connection: "offline" }, "the held answer is superseded, never served stale-exact");
  await client.close();
  const store = fileRangeStore(root)();
  await store.open("dev:alice");
  const coverage = await store.coverage();
  assert.equal(coverage.facts?.generation, generation, "the old facts stay until the reset path");
  assert.deepEqual(coverage.superseded, { generation: "9".repeat(64), schemaHash, authEpoch: 7 }, "the supersession is durable");
  assert.ok((await store.answer("messages.thread", {})), "the held answer is still on disk for the reset path to drop");
  await store.close?.();
  await rm(root, { recursive: true, force: true });
});

test("held and unheld offline reads expose since and fenceDays never blocks reading", async () => {
  const root = await tempRoot();
  let now = 1_000;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const client = createClient({
      url: "http://query.test", as: "alice", offline: { store: fileRangeStore(root), fenceDays: 1 },
      fetch: async (_input, init) => {
        const metadata = metadataResponse(_input);
        if (metadata) return metadata;
        assert.equal(new URL(String(_input)).searchParams.get("receipt"), "1");
        return new Response(JSON.stringify({ state: "complete", data: [{ id: "m1" }], seq: 1, next: null }), { status: 200 });
      },
    });
    await client.ready;
    const online = await client.query(api.messages.thread, { c: null });
    assert.equal(online.state, "complete");
    now += 40 * 24 * 60 * 60 * 1_000;
    await client.offline();
    const held = await client.query<any, any>(api.messages.thread as any, { c: null });
    assert.equal(held.state, "complete");
    assert.equal("connection" in held && held.connection, "offline");
    assert.deepEqual("stale" in held && held.stale, { since: 1_000 });
    const unheld = await client.query<any, any>(api.messages.other as any, {});
    assert.deepEqual(unheld, { state: "hydrating", live: false, connection: "offline" });
    client.close();
  } finally {
    Date.now = realNow;
    await rm(root, { recursive: true, force: true });
  }
});

test("the client tombstone hook evicts the named body in the same delivery swap", async () => {
  const root = await tempRoot();
  let call = 0;
  const client = createClient({
    url: "http://tombstone.test", as: "alice",
    offline: {
      store: fileRangeStore(root),
      onTombstone: (item) => item.table === "deliveries"
        && (item.row.kind === "removed" || item.row.kind === "expired")
        && typeof item.row.messageId === "string"
        ? [{ table: "messages", id: item.row.messageId }] : [],
    },
    fetch: async (input) => {
      const metadata = metadataResponse(input);
      if (metadata) return metadata;
      call += 1;
      const delivered = envelope(
        ref(call === 1 ? "messages" : "deliveries", call === 1 ? "m1" : "d1"),
        String(call).repeat(64),
        call,
      );
      delivered.rows = call === 1
        ? [row("messages", "m1", "secret")]
        : [{ table: "deliveries", id: "d1", row: { id: "d1", kind: "removed", messageId: "m1" } }];
      return new Response(JSON.stringify(delivered), { status: 200 });
    },
  });
  await client.ready;
  await client.query(api.messages.body as any, {});
  await client.query(api.deliveries.inbox as any, {});
  await client.offline();
  const body = await client.query<any, any>(api.messages.body as any, {});
  assert.equal(body.state, "partial");
  assert.deepEqual("data" in body ? body.data : undefined, null);
  assert.equal("validator" in body, false);
  await client.close();
  await rm(root, { recursive: true, force: true });
});

test("the frozen delivery decoder rejects malformed custody facts", async () => {
  const root = await tempRoot();
  const malformed: any = envelope([]);
  delete malformed.planHash;
  const client = createClient({
    url: "http://envelope.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input) => metadataResponse(input) ?? new Response(JSON.stringify(malformed), { status: 200 }),
  });
  await assert.rejects(client.query(api.messages.thread, {}), (error: unknown) =>
    error instanceof SnapbackRefusal && error.code === "E_WIRE_SHAPE" && error.message.includes("planHash"));
  await client.close();
  await rm(root, { recursive: true, force: true });
});

function sse(value?: unknown, hang = false): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      if (value !== undefined) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      if (!hang) controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("drain true follows five pages, persists the watermark, and follows a new tail page", async () => {
  const root = await tempRoot();
  const cursors: Array<string | null> = [];
  let subscriptions = 0;
  const nextByCursor = new Map<any, string | null>([[null, "c1"], ["c1", "c2"], ["c2", "c3"], ["c3", "c4"], ["c4", null], ["c5", null]]);
  const client = createClient({
    url: "http://drain.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input, init) => {
      const url = String(input);
      const metadata = metadataResponse(input);
      if (metadata) return metadata;
      if (url.endsWith("/api/resume")) {
        return new Response(JSON.stringify({ code: "E_ROUTE", family: "op", message: "not found", guide: "op/reference" }), { status: 404 });
      }
      if (url.includes("/api/query")) {
        const args = JSON.parse(String(init?.body)).args;
        cursors.push(args.c);
        const next = nextByCursor.get(args.c);
        const page = envelope([args.c], String(cursors.length).repeat(64), cursors.length);
        page.state = next === null ? "complete" : "capped";
        page.next = next;
        return new Response(JSON.stringify(page), { status: 200 });
      }
      subscriptions += 1;
      if (subscriptions !== 1) return sse(undefined, true);
      const tail = envelope(["tail"], "a".repeat(64), 10);
      tail.state = "capped";
      tail.next = "c5";
      return sse(tail);
    },
  });
  await client.ready;
  const seen: any[] = [];
  const drain = client.subscribe(api.deliveries.inbox as any, { c: null }, (value) => seen.push(value), { drain: true });
  const caught = await drain.until((value) => value.state === "complete" && value.caughtUp === true && value.watermark === "c5", 2_000);
  assert.equal(caught.state, "complete");
  assert.deepEqual(cursors, [null, "c1", "c2", "c3", "c4", "c5"]);
  drain.close();
  client.close();
  const inspect = fileRangeStore(root)();
  await inspect.open("dev:alice");
  const watermark = (await inspect.coverage()).watermarks[0];
  assert.equal(watermark?.watermark, "c5");
  assert.equal(watermark?.validator, "6".repeat(64), "the base args carry the tail answer's validator");
  const heldDrain = await inspect.answer("deliveries.inbox", { c: null });
  assert.equal(heldDrain?.caughtUp, true);
  assert.equal(heldDrain?.watermark, "c5");
  await inspect.close?.();
  await rm(root, { recursive: true, force: true });
});

function envelope(data: unknown, validator = "1".repeat(64), seq = 3) {
  return {
    protocol: 1, generation, schemaHash, planHash,
    authority: { principal: "dev:alice", authEpoch: 7 }, state: "complete", data, next: null, seq,
    rows: [], receipt: emptyReceipt(), validator,
  };
}

async function seededResumeStore(root: string): Promise<void> {
  const store = fileRangeStore(root)();
  await store.open("dev:alice");
  await store.commit({
    deliveries: [{
      op: "deliveries.inbox", args: { c: null }, state: "complete", data: [], next: null, seq: 3,
      validator: "1".repeat(64), receipt: emptyReceipt(),
    }],
    watermark: {
      op: "deliveries.inbox", args: { c: null }, watermark: "cursor-9", validator: "1".repeat(64),
      generation, schemaHash, authEpoch: 7, updatedAt: 10,
    },
  });
  await store.close?.();
}

test("cold resume sends the bounded shape before subscribe and a 404 falls back with validator", async () => {
  const root = await tempRoot();
  await seededResumeStore(root);
  const order: string[] = [];
  let request: any;
  const client = createClient({
    url: "http://resume.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input, init) => {
      const url = String(input);
      const metadata = metadataResponse(input);
      if (metadata) return metadata;
      if (url.endsWith("/api/resume")) {
        order.push("resume");
        request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ code: "E_ROUTE", family: "op", message: "not found", guide: "op/reference" }), { status: 404 });
      }
      order.push("subscribe");
      assert.equal(new URL(url).searchParams.get("validator"), "1".repeat(64));
      return sse(undefined, true);
    },
  });
  await client.ready;
  const sub = client.subscribe(api.deliveries.inbox as any, { c: null }, () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order.slice(0, 2), ["resume", "subscribe"]);
  assert.deepEqual(request, {
    protocol: 1, generation, schemaHash, authEpoch: 7,
    log: { op: "deliveries.inbox", args: { c: null }, watermark: "cursor-9", validator: "1".repeat(64) },
    mounted: [],
  });
  sub.close();
  await client.close();
  await rm(root, { recursive: true, force: true });
});

test("resume excludes its drain mount and atomically preserves a full log watermark and validator", async () => {
  const root = await tempRoot();
  await seededResumeStore(root);
  let resumes = 0;
  let reconnectRequest: any;
  const client = createClient({
    url: "http://resume-watermark.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input, init) => {
      const url = String(input);
      const metadata = metadataResponse(input);
      if (metadata) return metadata;
      if (url.endsWith("/api/resume")) {
        const request = JSON.parse(String(init?.body));
        resumes += 1;
        if (resumes === 1) return new Response(JSON.stringify({
          seq: 3, generation, schemaHash,
          authority: { principal: "dev:alice", authEpoch: 7 }, log: { unchanged: true }, mounted: [],
        }), { status: 200 });
        reconnectRequest = request;
        return new Response(JSON.stringify({
          seq: 5, generation, schemaHash,
          authority: { principal: "dev:alice", authEpoch: 7 },
          log: { ...envelope([], "8".repeat(64), 5), watermark: "cursor-10" },
          mounted: [],
        }), { status: 200 });
      }
      if (url.includes("/api/query")) return new Response(JSON.stringify(envelope([], "4".repeat(64), 4)), { status: 200 });
      return sse(undefined, true);
    },
  });
  await client.ready;
  const drain = client.subscribe(api.deliveries.inbox as any, { c: null }, () => undefined, { drain: true });
  await drain.until((value) => value.state === "complete" && value.caughtUp === true);
  await client.offline();
  await client.online();
  assert.deepEqual(reconnectRequest.mounted, [], "the drained log is represented only by log");
  drain.close();
  client.close();
  const inspect = fileRangeStore(root)();
  await inspect.open("dev:alice");
  const watermark = (await inspect.coverage()).watermarks.find((item) => item.op === "deliveries.inbox");
  assert.equal(watermark?.watermark, "cursor-10");
  assert.equal(watermark?.validator, "8".repeat(64));
  await inspect.close?.();
  await rm(root, { recursive: true, force: true });
});

test("E_OFFLINE_RESET drops coverage but preserves the durable outbox slot", async () => {
  const root = await tempRoot();
  await seededResumeStore(root);
  const store = fileRangeStore(root)();
  await store.open("dev:alice");
  await store.outbox.put({ intent: "i1", ids: [], op: "send", args: {}, state: "queued", createdAt: 1, updatedAt: 1 });
  await store.close?.();
  const client = createClient({
    url: "http://reset.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input) => metadataResponse(input) ?? new Response(JSON.stringify({
      code: "E_OFFLINE_RESET", family: "offline", message: "generation moved", rewrite: "cold drain", guide: "offline",
    }), { status: 409 }),
  });
  await client.ready;
  await client.offline();
  assert.equal((await client.query(api.deliveries.inbox as any, { c: null })).state, "hydrating");
  client.close();
  const inspect = fileRangeStore(root)();
  await inspect.open("dev:alice");
  assert.equal((await inspect.outbox.all())[0]?.intent, "i1");
  await inspect.close?.();
  await rm(root, { recursive: true, force: true });
});

test("E_OFFLINE_RESET cold-drains a mounted drain from the null cursor", async () => {
  const root = await tempRoot();
  await seededResumeStore(root);
  let resumes = 0;
  const queryCursors: Array<string | null> = [];
  let sawResetDrain!: () => void;
  const resetDrain = new Promise<void>((resolve) => { sawResetDrain = resolve; });
  const client = createClient({
    url: "http://reset-drain.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input, init) => {
      const url = String(input);
      const metadata = metadataResponse(input);
      if (metadata) return metadata;
      if (url.endsWith("/api/resume")) {
        resumes += 1;
        if (resumes === 1) return new Response(JSON.stringify({
          seq: 3, generation, schemaHash,
          authority: { principal: "dev:alice", authEpoch: 7 }, log: { unchanged: true }, mounted: [],
        }), { status: 200 });
        return new Response(JSON.stringify({
          code: "E_OFFLINE_RESET", family: "offline", message: "generation moved",
          rewrite: "cold drain", guide: "offline",
        }), { status: 409 });
      }
      if (url.includes("/api/query")) {
        const args = JSON.parse(String(init?.body)).args;
        queryCursors.push(args.c);
        if (queryCursors.length === 2) sawResetDrain();
        return new Response(JSON.stringify({ state: "complete", data: [], next: null, seq: 4 }), { status: 200 });
      }
      return sse(undefined, true);
    },
  });
  await client.ready;
  // The reset drain's page and watermark are committed before its caught-up
  // event fires; tearing down on the request alone raced those carrier writes
  // against `rm(root)` (ENOTEMPTY on the temp dir under load).
  let caughtUpEvents = 0;
  let sawResetSettled!: () => void;
  const resetSettled = new Promise<void>((resolve) => { sawResetSettled = resolve; });
  const drain = client.subscribe(api.deliveries.inbox as any, { c: null }, (event: any) => {
    if (event.caughtUp === true && ++caughtUpEvents === 2) sawResetSettled();
  }, { drain: true });
  await drain.until((value) => value.state === "complete" && value.caughtUp === true);
  await client.offline();
  await client.online();
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      resetDrain.then(() => resetSettled),
      new Promise<never>((_resolve, reject) => {
        resetTimer = setTimeout(() => reject(new Error("reset drain did not start")), 1_000);
      }),
    ]);
  } finally {
    if (resetTimer) clearTimeout(resetTimer);
  }
  assert.deepEqual(queryCursors, [null, null]);
  drain.close();
  await client.close();
  await rm(root, { recursive: true, force: true });
});

test("E_OFFLINE_RESUME honors which and cap and initial consecutive 413s do not wedge ready", async () => {
  const root = await tempRoot();
  await seededResumeStore(root);
  const store = fileRangeStore(root)();
  await store.open("dev:alice");
  await store.commit({ deliveries: [{ op: "old.value", args: {}, state: "complete", data: ["old"], next: null, seq: 1 }] });
  await store.close?.();
  let resumes = 0;
  const requests: any[] = [];
  const client = createClient({
    url: "http://resume-cap.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input, init) => {
      const metadata = metadataResponse(input);
      if (metadata) return metadata;
      requests.push(JSON.parse(String(init?.body)));
      resumes += 1;
      if (resumes <= 2) return new Response(JSON.stringify({
        code: "E_OFFLINE_RESUME", family: "offline", message: "too many", which: "log", cap: 0,
        rewrite: "re-subscribe the rest as ordinary reads", guide: "offline",
      }), { status: 413 });
      return new Response(JSON.stringify({
        seq: 3, generation, schemaHash,
        authority: { principal: "dev:alice", authEpoch: 7 }, log: { unchanged: true }, mounted: [],
      }), { status: 200 });
    },
  });
  await client.ready;
  assert.equal(resumes, 2);
  assert.ok(requests[0].log);
  assert.equal(requests[1].log, undefined);
  assert.deepEqual(requests[1].mounted, []);
  await client.offline();
  assert.equal((await client.query(api.old.value as any, {})).state, "complete");
  await client.online();
  assert.equal(resumes, 3, "ready settled and a later online call could resume");
  await client.close();
  await rm(root, { recursive: true, force: true });
});

test("a second consecutive E_OFFLINE_RESUME settles online as a refusal and leaves the client usable", async () => {
  const root = await tempRoot();
  await seededResumeStore(root);
  let resumes = 0;
  const client = createClient({
    url: "http://resume-refusal.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input) => {
      const metadata = metadataResponse(input);
      if (metadata) return metadata;
      resumes += 1;
      if (resumes === 1) return new Response(JSON.stringify({
        seq: 3, generation, schemaHash,
        authority: { principal: "dev:alice", authEpoch: 7 }, log: { unchanged: true }, mounted: [],
      }), { status: 200 });
      return new Response(JSON.stringify({
        code: "E_OFFLINE_RESUME", family: "offline", message: "still too large", which: "log", cap: 0,
        rewrite: "re-subscribe the rest as ordinary reads", guide: "offline",
      }), { status: 413 });
    },
  });
  await client.ready;
  await client.offline();
  await assert.rejects(client.online(), (error: unknown) =>
    error instanceof SnapbackRefusal && error.code === "E_OFFLINE_RESUME");
  assert.equal(resumes, 3);
  await client.offline();
  assert.equal((await client.query(api.deliveries.inbox as any, { c: null })).state, "complete");
  await client.close();
  await rm(root, { recursive: true, force: true });
});

test("resume applies its mounted swap before online resolves", async () => {
  const root = await tempRoot();
  await seededResumeStore(root);
  const seeded = fileRangeStore(root)();
  await seeded.open("dev:alice");
  await seeded.commit({ deliveries: [{
    op: "messages.body", args: {}, state: "complete", data: ["old"], next: null, seq: 3,
    validator: "3".repeat(64), receipt: emptyReceipt(),
  }] });
  await seeded.close?.();
  let resumes = 0;
  const client = createClient({
    url: "http://resume-swap.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input) => {
      const metadata = metadataResponse(input);
      if (metadata) return metadata;
      if (String(input).endsWith("/api/resume")) {
        resumes += 1;
        if (resumes === 1) return new Response(JSON.stringify({
          seq: 3, generation, schemaHash,
          authority: { principal: "dev:alice", authEpoch: 7 }, log: { unchanged: true }, mounted: [],
        }), { status: 200 });
        return new Response(JSON.stringify({
          seq: 4, generation, schemaHash,
          authority: { principal: "dev:alice", authEpoch: 7 }, log: { unchanged: true },
          mounted: [envelope(["fresh"], "2".repeat(64), 4)],
        }), { status: 200 });
      }
      return sse(undefined, true);
    },
  });
  await client.ready;
  const sub = client.subscribe(api.messages.body as any, {}, () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await client.offline();
  await client.online();
  await client.offline();
  const held = await client.query<any, any>(api.messages.body as any, {});
  assert.deepEqual("data" in held ? held.data : undefined, ["fresh"]);
  sub.close();
  await client.close();
  await rm(root, { recursive: true, force: true });
});

test("clients without offline storage preserve query and subscribe request bytes", async () => {
  let body = "";
  let subscribeUrl = "";
  const client = createClient({
    url: "http://bytes.test", as: "alice",
    fetch: async (_input, init) => {
      if (!init?.body) {
        subscribeUrl = String(_input);
        return sse(undefined, true);
      }
      body = String(init?.body);
      return new Response(JSON.stringify({ state: "complete", data: [], seq: 1, next: null }), { status: 200 });
    },
  });
  await client.query(api.messages.thread, { c: null });
  assert.equal(body, JSON.stringify({ op: "messages.thread", args: { c: null } }));
  const sub = client.subscribe(api.messages.thread, { c: "space here" }, () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(
    subscribeUrl,
    `http://bytes.test/api/subscribe?op=messages.thread&args=${encodeURIComponent(JSON.stringify({ c: "space here" }))}`,
  );
  sub.close();
  client.close();
});
