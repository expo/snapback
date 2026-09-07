import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { SnapbackRefusal, api, browserTokenStore } from "../dist/client.mjs";
import { fixtureClient as createClient } from "./live-fixture.ts";
import { decodeDeliveryEnvelope } from "../dist/index.mjs";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { sqliteFactory } from "./sqlite-fixture.ts";
import { offlineView } from "../dist/sqlite-test.mjs";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";

import { certifiedDrain, certifiedDrainEnvelope, certifiedDrainMetadataResponse, generation, schemaHash, planHash, metadataResponse } from "./offline-metadata-fixture.ts";

const emptyReceipt = () => ({ ranges: [], absences: [], verdicts: [] });
const row = (table: string, id: string, body = id) => ({ table, id, row: { id, body } });
const ref = (table: string, id: string) => ({ $row: { table, id } });
async function golden(name: string): Promise<any> {
  const text = await readFile(process.env.SNAPBACK2_CORPUS ? resolve(process.env.SNAPBACK2_CORPUS, "offline", name) : new URL(`../../../corpus/offline/${name}`, import.meta.url), "utf8");
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
  tables: { messages: { columns: { id: "Id", conversationId: "Id", at: "Time", body: { Text: { max: 4000 } } }, indexes: { byConversationAt: { components: [{ Column: "conversationId" }, { Column: "at" }, { Column: "id" }] } } } },
};

const evictionSchema = { tables: { messages: { ...messageSchema.tables.messages, indexes: { byConvTime: messageSchema.tables.messages.indexes.byConversationAt } } } };

const range = (overrides: Record<string, unknown> = {}) => ({
  site: "thread.range",
  table: "messages",
  index: "byConvTime",
  prefix: [{ Scalar: "c1" }],
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

test("RangeStore stores rows once and shares them across answers on all three carriers", async () => {
  const root = await tempRoot();
  try {
    await exerciseSharedRows(fileRangeStore(root));
    await exerciseSharedRows(sqliteFactory(join(root, "state.db")));
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
  await store.commit({ schema: evictionSchema });
  const heldRange = range({ rowIds: ["m1", "m2"] });
  await store.commit({ deliveries: [{
    op: "thread", args: { c: null }, state: "complete",
    data: [ref("messages", "m1"), ref("messages", "m2")], next: null, seq: 1,
    rows: [{ table: "messages", id: "m1", row: { id: "m1", body: "m1", conversationId: "c1", at: 1 } }, { table: "messages", id: "m2", row: { id: "m2", body: "m2", conversationId: "c1", at: 2 } }],
    receipt: { ranges: [heldRange], absences: [], verdicts: [] },
  }] });
  await store.commit({ deliveries: [{
    op: "fresh", args: {}, state: "complete", data: ref("messages", "m2"), next: null, seq: 2,
    rows: [{ table: "messages", id: "m2", row: { id: "m2", body: "m2", conversationId: "c1", at: 2 } }],
    receipt: { ranges: [{ ...heldRange, rowIds: ["m2"] }], absences: [], verdicts: [] },
  }] });
  assert.deepEqual((await store.coverage()).rows.map((item) => item.id), ["m2"], "uniform-range hole evicts");

  const limitedRange = range({
    site: "thread.limit", prefix: [{ Scalar: "c2" }], rowIds: ["m7", "m8", "m9"], stop: "Limit",
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
  }], schema: evictionSchema });
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

test("all three carriers apply the four swap rules with until-revoked and delivered-history", async () => {
  const root = await tempRoot();
  try {
    await exerciseEvictions(fileRangeStore(root)());
    await exerciseEvictions(sqliteFactory(join(root, "state.db"))());
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
  await assert.rejects(store.commit({ deliveries: [deliveryFromEnvelope("limited-fresh", {}, limitedFresh)], schema: messageSchema }),
    /conflicting durable fact/, "the old halo cannot be both present in the immutable pool and an interior checked hole");
  limitedFresh.rows = limitedFresh.rows.filter((item: any) => item.id !== "message-2");
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

test("retained reconstruction keeps independent pages and falls back when the rerun lacks authority", async () => {
  const root = await tempRoot();
  const store = fileRangeStore(root)();
  await store.open("alice");
  const message = (id: string, at: number) => ({
    table: "messages", id, row: { id, body: id, conversationId: "c1", at },
  });
  await store.commit({ retention: { messages: "delivered-history" }, deliveries: [{
    op: "thread", args: { c: null }, state: "capped",
    data: [
      { position: "first", message: ref("messages", "m1") },
      { position: "second", message: ref("messages", "m2") },
    ],
    next: "server-page-2", seq: 10, rows: [message("m1", 1), message("m2", 2)],
    receipt: { ranges: [range({ rowIds: ["m1", "m2"], stop: "Limit" })], absences: [], verdicts: [] },
  }, {
    op: "thread", args: { c: "server-page-2" }, state: "complete",
    data: [
      { position: "third", message: ref("messages", "m3") },
      { position: "fourth", message: ref("messages", "m4") },
    ],
    next: null, seq: 10, rows: [message("m3", 3), message("m4", 4)],
    receipt: { ranges: [range({ after: [2, "m2"], rowIds: ["m3", "m4"] })], absences: [], verdicts: [] },
  }] });
  await store.commit({ retention: { messages: "delivered-history" }, deliveries: [{
    op: "thread", args: { c: null }, state: "capped",
    data: [
      { position: "first", message: ref("messages", "m1") },
      { position: "second", message: null },
    ],
    next: "server-page-2", seq: 11, rows: [message("m1", 1)],
    receipt: { ranges: [], absences: [["messages", "byId", ["m2"]]], verdicts: [] },
  }] });

  const retained = await store.answer<any>("thread", { c: null });
  assert.equal(retained?.retained, true, "revoking one row conservatively purges its retained projection");
  const secondPage = await store.answer<any>("thread", { c: "server-page-2" });
  assert.deepEqual(secondPage?.data.map((entry: any) => entry.message.id), ["m3", "m4"],
    "history outside the bounded answer remains in its independently held page");

  const currentPage = [
    { position: "first", message: { id: "m1", body: "m1", conversationId: "c1", at: 1 } },
    { position: "second", message: null },
  ];
  const reconstructed = offlineView(retained, {
    state: "capped", data: currentPage, next: "local-page-2", seq: 99,
  });
  assert.equal(reconstructed.state, "capped");
  assert.deepEqual(reconstructed.data, currentPage, "a complete local rerun repairs only the authored page");
  assert.equal(reconstructed.next, "local-page-2", "the reconstructed page keeps its own continuation");
  assert.equal(reconstructed.seq, retained.seq, "reconstruction retains the issuing owner sequence");

  for (const local of [{ state: "partial", reason: "never-held", site: "thread.range", seq: 99 },
    { state: "denied", rule: "MEMBERSHIP_REQUIRED", seq: 99 }] as const) {
    const fallback = offlineView(retained, local);
    assert.equal(fallback.retained, true);
    assert.deepEqual(fallback.data, retained.data,
      `${local.state} local evidence cannot replace readable delivered history`);
    assert.equal(fallback.next, "server-page-2", "missing authority preserves the held continuation");
  }
  assert.deepEqual((await store.answer<any>("thread", { c: "server-page-2" }))?.data, secondPage?.data,
    "selecting the current bounded reconstruction does not rewrite another held page");
  await store.close?.();
  await rm(root, { recursive: true, force: true });
});

test("a maintained-coherence partial waits for its named owner unless one overlay supplies the whole value", () => {
  const held = {
    op: "deliveries.conversationView", args: { conversationId: "c1" }, state: "partial" as const,
    reason: "maintained-coherence", data: { messages: [{ id: "old" }], count: 2, preview: [] },
    seq: 7, deliveredAt: 100,
  };
  const mixed = offlineView(held, {
    state: "complete", data: { messages: [{ id: "old" }], count: 1, preview: [] }, next: null, seq: 8,
  });
  assert.equal(mixed.state, "partial");
  assert.equal(mixed.reason, "maintained-coherence");
  const predicted = offlineView(held, {
    state: "complete", data: { messages: [{ id: "new" }, { id: "old" }], count: 3, preview: [{ id: "new" }] },
    next: null, seq: 8, predicted: ["intent"],
  });
  assert.equal(predicted.state, "complete");
  assert.deepEqual(predicted.predicted, ["intent"]);
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
  for (const make of [fileRangeStore(await tempRoot()), indexedFactory().factory, sqliteFactory(join(await tempRoot(), "state.db"))]) {
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
    wipe: async () => undefined, answer: async () => undefined, commit: async () => undefined, subscribeInputs: () => () => undefined,
    coverage: async () => ({ rows: [], ranges: [], absences: [], verdicts: [], watermarks: [] }),
    outbox: { all: async () => [], get: async () => undefined, put: async () => undefined, remove: async () => undefined },
  });
  Object.defineProperty(badFactory, "carrier", { value: "broken-test" });
  const bad = createClient({ url: "http://offline.test", as: "alice", offline: { store: badFactory } });
  await assert.rejects(bad.ready, (error: unknown) => error instanceof SnapbackRefusal
    && error.code === "E_OFFLINE_CARRIER" && error.envelope.rewrite?.includes("broken-test") === true);

  // A second web tab of the same account opens as a follower. This carrier
  // test has no forwarding peer; the protocol remains in explicit discovery.
  const shared = indexedFactory();
  const first = createClient({ url: "http://offline.test", as: "alice", offline: { store: shared.factory } });
  await first.ready;
  const second = createClient({ url: "http://offline.test", as: "alice", offline: { store: shared.factory } });
  await second.ready;
  assert.equal((await second.outbox.status()).reason, "writer-discovery");
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

test("offline factory returns fail at setup with the browser spelling, before auth or I/O", () => {
  let requests = 0;
  const options = { url: "http://options.test", fetch: async () => { requests++; throw new Error("unexpected I/O"); } };
  const setupError = (error: unknown) => error instanceof TypeError
    && /offline\.store must return a RangeStore with open\(\)/.test(error.message)
    && error.message.includes("store: indexedDbRangeStore()")
    && error.message.includes("snapback2 guide offline");
  // The exported builder returns a factory; the client needs the builder's result.
  assert.throws(() => createClient({ ...options, offline: { store: indexedDbRangeStore } } as any), setupError);
  for (const returned of [undefined, null, 1, true, "store", {}, { open: 1 }, Promise.resolve({}), () => ({})]) {
    let calls = 0;
    assert.throws(() => createClient({ ...options, offline: { store: () => { calls++; return returned; } } } as any), setupError);
    assert.equal(calls, 1, "validation must not invoke the factory again");
  }
  assert.equal(requests, 0);
});

test("offline setup accepts unbranded custom and callable stores, invoking each factory once", async () => {
  for (const callable of [false, true]) {
    let calls = 0, opens = 0;
    const methods = {
      open: async () => { opens++; }, unseal: async () => {}, seal: async () => {}, wipe: async () => {},
      answer: async () => undefined, commit: async () => {}, subscribeInputs: () => () => undefined,
      coverage: async () => ({ rows: [], ranges: [], absences: [], verdicts: [], watermarks: [] }),
      outbox: { all: async () => [], get: async () => undefined, put: async () => {}, remove: async () => {},
        grant: async () => undefined, grants: async () => [], bounds: async () => ({}),
        overlay: async () => ({}), programs: async () => ({}) },
    };
    // Inherited methods and callable objects both satisfy the structural contract.
    const custom = callable ? Object.assign(() => {}, methods) : Object.create(methods);
    const client = createClient({ url: "http://custom.test", as: "alice", startOffline: true,
      offline: { store: () => { calls++; return custom; } } });
    try {
      await client.ready;
      await client.offline();
      assert.deepEqual(await client.outbox.entries(), []);
      assert.equal(opens, 1);
      assert.equal(calls, 1);
    } finally { client.close(); }
  }
});

test("offline setup preserves throwing factories and unavailable carrier refusals", async () => {
  for (const failure of [new Error("factory failed"), new TypeError("factory failed"),
    Object.assign(new TypeError("carrier unavailable"), { code: "E_OFFLINE_CARRIER" })]) {
    let calls = 0;
    const factory = Object.assign(() => { calls++; throw failure; }, { carrier: "custom-test" });
    assert.throws(() => createClient({ url: "http://factory.test", offline: { store: factory } }),
      (error: unknown) => error instanceof SnapbackRefusal && error.message === failure.message
        && error.code === ((failure as any).code ?? "E_OFFLINE_STATE") && error.envelope.site === "client.offline");
    assert.equal(calls, 1);
  }
  let calls = 0;
  const unavailable = indexedDbRangeStore({ indexedDB: {} as any, locks: {} as any });
  const client = createClient({ url: "http://unavailable.test", as: "alice", startOffline: true,
    offline: { store: Object.assign(() => { calls++; return unavailable(); }, { carrier: "IndexedDB" }) } });
  try {
    await assert.rejects(client.ready, (error: unknown) => error instanceof SnapbackRefusal
      && error.code === "E_OFFLINE_CARRIER" && error.envelope.site === "RangeStore.open"
      && error.message === "IndexedDB and Web Locks are required"
      && error.envelope.rewrite === "install or configure the IndexedDB carrier");
    assert.equal(calls, 1);
  } finally { client.close(); }
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
      return new Response(JSON.stringify({ token: "token-1", viewer: "principal-1", kind: "user" }), { status: 200 });
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
      if (metadata) {
        const value = await metadata.json();
        if (String(input).includes('/api/program?')) Object.assign(value, { generation: hit.generation, schemaHash: hit.schemaHash });
        else value.programGeneration = hit.generation;
        return new Response(JSON.stringify(value), { status: 200 });
      }
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
      const metadata = certifiedDrainMetadataResponse(input);
      if (metadata) return metadata;
      if (url.endsWith("/api/resume")) {
        return new Response(JSON.stringify({ code: "E_ROUTE", family: "op", message: "not found", guide: "op/reference" }), { status: 404 });
      }
      if (url.includes("/api/query")) {
        const args = JSON.parse(String(init?.body)).args;
        cursors.push(args.c);
        const next = nextByCursor.get(args.c);
        const page = certifiedDrainEnvelope([args.c], String(cursors.length).repeat(64), cursors.length);
        page.state = next === null ? "complete" : "capped";
        page.next = next;
        return new Response(JSON.stringify(page), { status: 200 });
      }
      subscriptions += 1;
      if (subscriptions !== 1) return sse(undefined, true);
      const tail = certifiedDrainEnvelope(["tail"], "a".repeat(64), 10);
      tail.state = "capped";
      tail.next = "c5";
      return sse(tail);
    },
  });
  await client.ready;
  const seen: any[] = [];
  const drain = client.subscribe((api as any).local.partial, { c: null }, (value) => seen.push(value), { drain: true });
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
  const heldDrain = await inspect.answer(certifiedDrain.op, { c: null });
  assert.equal(heldDrain?.caughtUp, true);
  assert.equal(heldDrain?.watermark, "c5");
  const coverageBefore = await inspect.coverage();
  await inspect.close?.();
  // A cold reopen adopts the persisted watermark instead of the twin's own
  // page chain, and records nothing (LLP 1012 §6).
  const cold = createClient({
    url: "http://drain.test", as: "alice", offline: { store: fileRangeStore(root) }, startOffline: true,
    fetch: async () => { throw new TypeError("network cut"); },
  } as Parameters<typeof createClient>[0]);
  await cold.ready;
  const coldDrain = cold.subscribe((api as any).local.partial, { c: null }, () => undefined, { drain: true });
  const coldCaught = await coldDrain.until((value) => (value.state === "complete" || value.state === "capped") && value.caughtUp === true, 2_000);
  assert.equal(coldCaught.watermark, "c5", "an offline drain adopts the persisted watermark");
  assert.equal(coldCaught.connection, "offline");
  coldDrain.close();
  await cold.close();
  const reopened = fileRangeStore(root)();
  await reopened.open("dev:alice");
  assert.deepEqual(await reopened.coverage(), coverageBefore, "an offline drain writes no coverage");
  assert.equal((await reopened.answer(certifiedDrain.op, { c: null }))?.watermark, "c5");
  await reopened.close?.();
  await rm(root, { recursive: true, force: true });
});

function envelope(data: unknown, validator = "1".repeat(64), seq = 3) {
  return {
    protocol: 1, generation, schemaHash, planHash,
    authority: { principal: "dev:alice", authEpoch: 7 }, state: "complete", data, next: null, seq,
    rows: [], receipt: emptyReceipt(), validator,
  };
}
async function seededResumeStore(root: string, exact = false): Promise<void> {
  const identity = exact ? certifiedDrain : { op: "deliveries.inbox", generation, schemaHash };
  const store = fileRangeStore(root)();
  await store.open("dev:alice");
  await store.commit({
    deliveries: [{
      op: identity.op, args: { c: null }, state: "complete", data: [], next: null, seq: 3,
      validator: "1".repeat(64), receipt: emptyReceipt(),
    }],
    watermark: {
      op: identity.op, args: { c: null }, watermark: "cursor-9", validator: "1".repeat(64),
      generation: identity.generation, schemaHash: identity.schemaHash, authEpoch: 7, updatedAt: 10,
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
  await seededResumeStore(root, true);
  let resumes = 0;
  let reconnectRequest: any;
  const client = createClient({
    url: "http://resume-watermark.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input, init) => {
      const url = String(input);
      const metadata = certifiedDrainMetadataResponse(input);
      if (metadata) return metadata;
      if (url.endsWith("/api/resume")) {
        const request = JSON.parse(String(init?.body));
        resumes += 1;
        if (resumes === 1) return new Response(JSON.stringify({
          seq: 3, generation: certifiedDrain.generation, schemaHash: certifiedDrain.schemaHash,
          authority: { principal: "dev:alice", authEpoch: 7 }, log: { unchanged: true }, mounted: [],
        }), { status: 200 });
        reconnectRequest = request;
        return new Response(JSON.stringify({
          seq: 5, generation: certifiedDrain.generation, schemaHash: certifiedDrain.schemaHash,
          authority: { principal: "dev:alice", authEpoch: 7 },
          log: { ...certifiedDrainEnvelope([], "8".repeat(64), 5), watermark: "cursor-10" },
          mounted: [],
        }), { status: 200 });
      }
      if (url.includes("/api/query")) return new Response(JSON.stringify(certifiedDrainEnvelope([], "4".repeat(64), 4)), { status: 200 });
      return sse(undefined, true);
    },
  });
  await client.ready;
  const drain = client.subscribe((api as any).local.partial, { c: null }, () => undefined, { drain: true });
  await drain.until((value) => value.state === "complete" && value.caughtUp === true);
  await client.offline();
  await client.online();
  assert.deepEqual(reconnectRequest.mounted, [], "the drained log is represented only by log");
  drain.close();
  client.close();
  const inspect = fileRangeStore(root)();
  await inspect.open("dev:alice");
  const watermark = (await inspect.coverage()).watermarks.find((item) => item.op === certifiedDrain.op);
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
  await seededResumeStore(root, true);
  let resumes = 0;
  const queryCursors: Array<string | null> = [];
  let sawResetDrain!: () => void;
  const resetDrain = new Promise<void>((resolve) => { sawResetDrain = resolve; });
  const client = createClient({
    url: "http://reset-drain.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input, init) => {
      const url = String(input);
      const metadata = certifiedDrainMetadataResponse(input);
      if (metadata) return metadata;
      if (url.endsWith("/api/resume")) {
        resumes += 1;
        if (resumes === 1) return new Response(JSON.stringify({
          seq: 3, generation: certifiedDrain.generation, schemaHash: certifiedDrain.schemaHash,
          authority: { principal: "dev:alice", authEpoch: 7 }, log: { unchanged: true }, mounted: [],
          grant: { id: "s2id-00000000000000000000000000000001-0000000000000001", from: "s2id-00000000000000000000000000000001-0000000000000001", count: 8192, mintedAt: Date.now(), expiresAt: Date.now() + 86400000 },
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
  const drain = client.subscribe((api as any).local.partial, { c: null }, (event: any) => {
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
  assert.deepEqual(queryCursors, [null, null], "the initial drain and its reset replacement both restart at the root; drains are not redundantly revalidated as mounted queries");
  drain.close();
  await client.close();
  await rm(root, { recursive: true, force: true });
});

test("E_OFFLINE_RESUME adjusts only structured mounted limits and never drops the log", async () => {
  const root = await tempRoot();
  await seededResumeStore(root);
  const store = fileRangeStore(root)();
  await store.open("dev:alice");
  await store.commit({ deliveries: [{ op: "old.value", args: {}, state: "complete", data: ["old"], next: null, seq: 1, validator: "9".repeat(64) }] });
  await store.close?.();
  let resumes = 0;
  const requests: any[] = [];
  const client = createClient({
    url: "http://resume-cap.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input, init) => {
      if (new URL(String(input)).pathname === "/api/subscribe") return sse(undefined, true);
      const metadata = metadataResponse(input);
      if (metadata) return metadata;
      requests.push(JSON.parse(String(init?.body)));
      resumes += 1;
      if (resumes <= 2) return new Response(JSON.stringify({
        code: "E_OFFLINE_RESUME", family: "offline", message: "too many", reason: "limit", which: "mounted", cap: 0,
        rewrite: "re-subscribe the rest as ordinary reads", guide: "offline",
      }), { status: 413 });
      return new Response(JSON.stringify({
        seq: 3, generation, schemaHash,
        authority: { principal: "dev:alice", authEpoch: 7 }, log: { unchanged: true }, mounted: [],
      }), { status: 200 });
    },
  });
  const mounted = client.subscribe(api.old.value as any, {}, () => {});
  await client.ready;
  assert.equal(resumes, 2);
  assert.ok(requests[0].log);
  assert.deepEqual(requests[1].log, requests[0].log, "adjustment preserves the selected log");
  assert.deepEqual(requests[1].mounted, []);
  await client.offline();
  assert.equal((await client.query(api.old.value as any, {})).state, "complete");
  await client.online();
  assert.equal(resumes, 3, "ready settled and a later online call could resume");
  mounted.close();
  await client.close();
  await rm(root, { recursive: true, force: true });
});

test("an unstructured legacy E_OFFLINE_RESUME refuses once and leaves the client usable", async () => {
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
  assert.equal(resumes, 2, "unstructured refusal is never retried without its log");
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

test("clients without offline storage preserve query bytes and logical subscription arguments", async () => {
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

// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — a program that reads the
// clock re-executes at one durable seq with a different answer; the owner's execution read
// time orders those deliveries. Every other same-seq disagreement stays an equivocation.
test("a clock-reading program's later execution installs at the same seq; older, equal, and unstamped ones do not", async () => {
  const root = await tempRoot();
  let store = fileRangeStore(root)();
  await store.open("dev:alice");
  const timed = { op: "clock.serverNow", args: {}, state: "complete" as const, next: null, seq: 7, receipt: emptyReceipt(), clockPlanHash: planHash };
  await store.commit({ deliveries: [{ ...timed, data: { now: 1000 }, validator: "1".repeat(64), readTime: 1000 }] });
  await store.commit({ deliveries: [{ ...timed, data: { now: 2000 }, validator: "2".repeat(64), readTime: 2000 }] });
  assert.deepEqual((await store.answer("clock.serverNow", {}))?.data, { now: 2000 }, "a later execution installs at the same seq");
  await store.commit({ deliveries: [{ ...timed, data: { now: 1500 }, validator: "3".repeat(64), readTime: 1500 }] });
  assert.deepEqual((await store.answer("clock.serverNow", {}))?.data, { now: 2000 }, "an older execution arriving late is stale and stays out");
  await assert.rejects(store.commit({ deliveries: [{ ...timed, data: { now: 2001 }, validator: "4".repeat(64), readTime: 2000 }] }),
    /conflicting deliveries/, "the same read time with different bytes is equivocation");
  const plain = { op: "plain", args: {}, state: "complete" as const, data: [1], next: null, seq: 8, receipt: emptyReceipt() };
  await store.commit({ deliveries: [plain] });
  await assert.rejects(store.commit({ deliveries: [{ ...plain, data: [2] }] }), /conflicting deliveries/, "an unstamped program still refuses");
  await store.close?.();
  store = fileRangeStore(root)();
  await store.open("dev:alice");
  const cold = await store.answer("clock.serverNow", {});
  assert.deepEqual(cold?.data, { now: 2000 });
  assert.equal(cold?.readTime, 2000, "the stamp survives a cold reopen");
  await store.commit({ deliveries: [{ ...timed, data: { now: 3000 }, validator: "5".repeat(64), readTime: 3000 }] });
  assert.deepEqual((await store.answer("clock.serverNow", {}))?.data, { now: 3000 }, "and still orders after the reopen");
  await store.close?.();
  await rm(root, { recursive: true, force: true });
});

test('conditional public query states preserve denial/partial shape and complete/capped cursors warm and cold', async context => {
  for (const state of ['denied', 'partial', 'complete', 'capped']) for (const cold of [false, true])
    await context.test(`${state}/${cold}`, async () => {
      const root = await tempRoot(); await seededResumeStore(root);
      const full = { ...envelope(state === 'denied' ? null : ['held']), state,
        next: state === 'capped' ? 'server-page' : null,
        ...(state === 'denied' ? { rule: 'MEMBERSHIP_REQUIRED' } : state === 'partial' ? { reason: 'missing-authority' } : {}) };
      const factory = fileRangeStore(root);
      const options = { url: 'http://conditional-state.test', as: 'alice', offline: { store: factory },
        fetch: async (input: any, init: any) => {
          const metadata = metadataResponse(input); if (metadata) return metadata;
          if (String(input).endsWith('/api/resume')) return Response.json({ seq: 3, generation, schemaHash,
            authority: full.authority, log: { unchanged: true }, mounted: [] });
          const request = JSON.parse(String(init.body));
          return Response.json(request.validator ? { state: 'unchanged', seq: 4, validator: full.validator } : full);
        } };
      let client = createClient(options);
      try {
        await client.ready;
        const first = await client.query(api.example.read as any, {});
        if (cold) { await client.close(); client = createClient(options); await client.ready; }
        const second = await client.query(api.example.read as any, {});
        assert.deepEqual(second, { ...first, seq: 4 });
        if (state === 'denied' || state === 'partial') assert(!Object.hasOwn(second, 'next'));
        else assert.equal(second.next, full.next);
        if (state === 'denied') assert(!Object.hasOwn(second, 'data'));
        await client.close();
        const store = factory(); await store.open('dev:alice');
        assert.equal((await store.answer('example.read', {})).next, full.next, 'private receipt custody keeps its original next');
        await store.close();
      } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
    });
  const client = createClient({ url: 'http://strict-denied.test', as: 'alice',
    fetch: async () => Response.json({ state: 'denied', rule: 'NO', seq: 1, next: null }) });
  try { await assert.rejects(client.query(api.example.read as any, {}), /must not carry next/); }
  finally { await client.close(); }
});

test('held public query states omit denied payload and nonpage cursors through offline entrypoints', async context => {
  // Synthetic protocol frames enter the real Client decoder/runtime; no native emission claim.
  for (const state of ['denied', 'partial', 'complete', 'capped']) for (const mode of ['forced', 'hydrating', 'retry'])
    await context.test(`${state}/${mode}`, async () => {
      const root = await tempRoot(); await seededResumeStore(root);
      const full = { ...envelope(['private wire payload']), state, next: state === 'complete' ? null : 'server-page',
        ...(state === 'denied' ? { rule: 'NO' } : state === 'partial' ? { reason: 'missing-authority' } : {}) };
      const factory = fileRangeStore(root); let fail = false, requests = 0, unblock!: () => void;
      const waiting = new Promise<void>(resolve => { unblock = resolve; });
      const fetch = async (input: any) => {
        const metadata = metadataResponse(input); if (metadata) return metadata;
        if (String(input).endsWith('/api/auth/me')) { await waiting; return Response.json({ viewer: 'dev:alice', kind: 'user', authEpoch: 7 }); }
        if (String(input).endsWith('/api/resume')) return Response.json({ seq: 3, generation, schemaHash,
          authority: full.authority, log: { unchanged: true }, mounted: [] });
        requests++; if (fail) throw new TypeError('offline transport');
        return Response.json(full);
      };
      let client = createClient({ url: 'http://held-state.test', as: 'alice', offline: { store: factory }, fetch });
      let sub: ReturnType<typeof client.subscribe> | undefined;
      try {
        await client.ready; await client.query(api.example.read as any, {});
        if (mode === 'forced') await client.offline();
        if (mode === 'retry') { fail = true; requests = 0; }
        if (mode === 'hydrating') {
          await client.close(); client = createClient({ url: 'http://held-state.test', offline: { store: factory }, fetch,
            tokenStore: { load: () => 'held-token', save: () => {}, loadPrincipalBinding: () => ({ token: 'held-token', principal: 'dev:alice' }) } });
        }
        const result = await client.query(api.example.read as any, {});
        if (mode === 'hydrating') assert.equal(client.snapshot.auth.state, 'hydrating');
        if (mode === 'retry') assert.equal(requests, 3);
        const check = (answer: any) => {
          assert.equal(answer.state, state); assert.equal(answer.connection, 'offline'); assert.equal(answer.live, false);
          assert.equal(Object.hasOwn(answer, 'next'), state === 'complete' || state === 'capped');
          if (state === 'complete' || state === 'capped') assert.equal(answer.next, full.next);
          assert.equal(Object.hasOwn(answer, 'data'), state !== 'denied');
          if (state !== 'denied') assert.deepEqual(answer.data, full.data);
        };
        check(result);
        if (mode === 'forced') {
          let delivered!: (answer: any) => void; const update = new Promise<any>(resolve => { delivered = resolve; });
          sub = client.subscribe(api.example.read as any, {}, answer => { if (answer.state === state) delivered(answer); });
          check(await update); sub.close();
        }
        unblock(); await client.close();
        const inspect = factory(); await inspect.open('dev:alice');
        const held = await inspect.answer('example.read', {});
        assert.equal(held.next, full.next, 'private next custody survives projection');
        assert.deepEqual(held.data, full.data, 'public omission does not rewrite retained protocol data');
        await inspect.close();
      } finally { sub?.close(); unblock(); await client.close(); await rm(root, { recursive: true, force: true }); }
    });
});

test('resume rejects equivocation with the same typed refusal exposed by query and snapshot', async () => {
  const root = await tempRoot(); await seededResumeStore(root);
  let resumes = 0, conflicting = false;
  const disk = fileRangeStore(root), full = envelope(['before']); let active: any;
  const factory = () => active = disk();
  const pending = { intent: 'keep', ids: [], op: 'send', args: { body: 'pending' }, state: 'queued', createdAt: 1, updatedAt: 1 };
  const client = createClient({ url: 'http://typed-resume.test', as: 'alice', offline: { store: factory },
    fetch: async (input, init) => {
      const metadata = metadataResponse(input); if (metadata) return metadata;
      const bad = envelope(['equivocation'], '2'.repeat(64));
      if (String(input).endsWith('/api/resume')) return Response.json({ seq: 3, generation, schemaHash,
        authority: full.authority, log: { unchanged: true }, mounted: ++resumes === 1 ? [] : [bad] });
      if (init?.body) return Response.json(conflicting ? bad : full);
      return sse(undefined, true);
    } });
  try {
    await client.ready; await client.query(api.messages.body as any, {});
    const sub = client.subscribe(api.messages.body as any, {}, () => undefined);
    await new Promise(resolve => setTimeout(resolve, 5)); await client.offline();
    await active.outbox.put(pending);
    let refusal: any;
    await assert.rejects(client.online(), error => { refusal = error; return error instanceof SnapbackRefusal && error.code === 'E_OFFLINE_DELIVERY'; });
    assert.deepEqual(client.snapshot.lastRefusal, refusal.envelope);
    conflicting = true;
    await assert.rejects(client.query(api.messages.body as any, {}), error => error instanceof SnapbackRefusal && error.code === refusal.code);
    await client.offline(); assert.deepEqual((await client.query(api.messages.body as any, {})).data, ['before']);
    sub.close();
  } finally {
    await client.close(); const inspect = factory(); await inspect.open('dev:alice');
    assert.deepEqual((await inspect.outbox.all()).map(({ order, ...entry }) => entry),[pending]);
    await inspect.close(); await rm(root, { recursive: true, force: true });
  }
});

test('aborting an in-flight resume preserves AbortError without publishing a delivery refusal', async () => {
  const root = await tempRoot(); await seededResumeStore(root);
  let resumes = 0, release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const client = createClient({ url: 'http://abort-resume.test', as: 'alice', offline: { store: fileRangeStore(root) },
    fetch: async (input,init) => {
      const metadata = metadataResponse(input); if (metadata) return metadata;
      if (String(input).endsWith('/api/resume')) {
        if (++resumes > 1) {
          release(); return new Promise<Response>((_,reject) => {
            const abort = () => reject(new DOMException('cancelled','AbortError'));
            if (init?.signal?.aborted) abort(); else init?.signal?.addEventListener('abort',abort,{ once: true });
          });
        }
        return Response.json({ seq: 3,generation,schemaHash,authority: envelope([]).authority,log: { unchanged: true },mounted: [] });
      }
      return sse(undefined,true);
    } });
  try {
    await client.ready; await client.offline();
    const resumed = client.online(); const rejection = assert.rejects(resumed,error => error.name === 'AbortError' && !(error instanceof SnapbackRefusal));
    await waiting; await client.offline(); await rejection;
    assert.equal(client.snapshot.lastRefusal,undefined);
    assert.equal((await client.query(api.deliveries.inbox as any,{ c: null })).state,'complete');
  } finally { await client.close(); await rm(root,{ recursive: true,force: true }); }
});
