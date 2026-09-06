import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileRangeStore } from "../dist/test.mjs";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { PersistentRangeStore, SqliteBackend, nodeSqliteDriver } from "../dist/sqlite-test.mjs";
import { sqliteFactory } from "./sqlite-fixture.ts";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";

const ref = (id: string) => ({ $row: { table: "messages", id } });
const row = (id: string, body = id) => ({ table: "messages", id, row: { id, body } });
const receipt = () => ({ ranges: [], absences: [], verdicts: [] });
const delivery = (op: string, ids: string[], seq: number) => ({ op, args: {}, seq,
  state: "complete", data: ids.map(ref), rows: ids.map((id) => row(id)), receipt: receipt() });
const entry = (intent: string) => ({ intent, grant: "g", offset: 0, count: 1, ids: [],
  op: "send", args: { body: "pending" }, issuedSeq: 1, state: "queued", createdAt: 1, updatedAt: 1 });

async function carriers() {
  const root = await mkdtemp(join(tmpdir(), "s2-store-review-"));
  const database = new FakeIndexedDb();
  return { root, database, factories: [fileRangeStore(join(root, "files")),
    indexedDbRangeStore({ indexedDB: database as any, locks: new FakeLocks() }),
    sqliteFactory(join(root, "state.db"))] };
}

test("conditional refresh then same-sequence redelivery survives reopen without accepting equivocation", async (context) => {
  const { root, factories } = await carriers();
  try {
    for (const factory of factories) await context.test(factory.carrier, async () => {
      let store = factory();
      await store.open("alice");
      const first = { ...delivery("inbox", ["one"], 10), next: "page-one", validator: "a".repeat(64) };
      await store.commit({ deliveries: [first] });
      await store.commit({ refreshes: [{ op: first.op, args: first.args, seq: 11, validator: first.validator }] });
      await store.close();
      store = factory();
      await store.open("alice");
      try {
        assert.equal((await store.answer(first.op, first.args))?.seq, 11);
        assert.equal(Object.values((store as any).state.answers)[0].nextSeq, 10, "revalidation does not renew continuation evidence");
        // The strong validator excludes seq. A nonempty resume log returns its
        // full envelope even on validator equality, after an unrelated commit.
        const repeated = { ...first, seq: 11 };
        await store.commit({ deliveries: [repeated] });
        assert.equal(Object.values((store as any).state.answers)[0].nextSeq, 11, "a full delivery renews continuation evidence");
        const before = await store.coverage();
        await store.close();
        store = factory();
        await store.open("alice");
        await store.commit({ deliveries: [repeated] });
        assert.deepEqual(await store.coverage(), before, `${factory.carrier}: equal content is an idempotent replay`);
        for (const changed of [
          { data: [] }, { state: "capped" }, { next: "other-page" },
          { validator: "b".repeat(64) }, { rows: [row("one", "different")] },
          { receipt: { ...receipt(), absences: [["messages", "byId", ["missing"]]] } },
          { reason: "different" }, { rule: "different" },
        ]) {
          await assert.rejects(store.commit({ deliveries: [{ ...repeated, ...changed }] }), /conflicting deliveries/);
          assert.deepEqual(await store.coverage(), before, "a conflicting envelope cannot partly commit");
        }
        await assert.rejects(store.commit({ deliveries: [{ ...repeated, op: "other", rows: [row("one", "conflicting")] }] }), /conflicting row/);
        assert.deepEqual(await store.coverage(), before, "the full delivery also binds pooled rows at its new seq");
        await store.commit({ deliveries: [first] });
        assert.equal((await store.answer(first.op, first.args))?.seq, 11, "late old frames cannot rewind seq");
        await store.commit({ deliveries: [{ ...first, seq: 12, rows: [row("one", "newer")] }] });
        assert.equal((await store.answer(first.op, first.args))?.data[0].body, "newer");
      } finally { await store.close(); }
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("authoritative evictions purge pooled bodies and derived literals on every carrier", async () => {
  const { root, factories } = await carriers();
  try {
    for (const factory of factories) for (const source of ["tombstone", "absence"] as const) {
      const partition = source;
      let store = factory();
      await store.open(partition);
      await store.commit({ deliveries: [
        { ...delivery("body", ["secret"], 1), rows: [row("secret", "PRIVATE_SENTINEL_8412")] },
        { ...delivery("projection", ["secret"], 1), data: { body: "PRIVATE_SENTINEL_8412" },
          rows: [row("secret", "PRIVATE_SENTINEL_8412")] },
        delivery("unrelated", ["safe"], 1),
      ] });
      await store.commit(source === "tombstone" ? { tombstones: [{ table: "messages", id: "secret", seq: 2 }] }
        : { deliveries: [{ ...delivery("gone", [], 2), data: null,
          receipt: { ...receipt(), absences: [["messages", "byId", ["secret"]]] } }] });
      for (const op of ["body", "projection"]) {
        assert.equal(JSON.stringify(await store.answer(op, {})).includes("PRIVATE_SENTINEL_8412"), false, `${factory.carrier} ${op}`);
      }
      assert.deepEqual((await store.answer("unrelated", {}))?.data, [{ id: "safe", body: "safe" }]);
      await store.close();
      const backend = (factory() as any).backend;
      const persisted = await backend.open(partition);
      assert.equal(JSON.stringify(persisted).includes("PRIVATE_SENTINEL_8412"), false, `${factory.carrier} persisted ${source}`);
      assert.match(Object.values(persisted.answers)[0].fingerprint, /^[0-9a-f]{64}$/);
      await backend.close();
      store = factory();
      await store.open(partition);
      assert.equal(JSON.stringify(await store.answer("projection", {})).includes("PRIVATE_SENTINEL_8412"), false);
      await store.close();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("array deletion, reordering and limiting preserve fresh identities and independently held rows", async () => {
  for (const ids of [["b", "c"], ["a", "c"], ["c", "a", "b"], ["b"]]) {
    const store = new PersistentRangeStore({ carrier: "memory", open: async () => undefined,
      replace: async () => {}, close: () => {}, wipe: async () => {} });
    await store.open("alice");
    await store.commit({ deliveries: [delivery("list", ["a", "b", "c"], 1), delivery("other", ["a", "b", "c"], 1)] });
    await store.commit({ deliveries: [{ ...delivery("list", ids, 2), state: "capped" }] });
    const answer = await store.answer("list", {});
    assert.equal(answer.state, "capped");
    assert.deepEqual(answer.data.map((item: any) => item.id), ids);
    assert.deepEqual((await store.answer("other", {})).data.map((item: any) => item.id), ["a", "b", "c"]);
    assert.deepEqual((await store.coverage()).evicted, []);
    // A null in an extant slot still revokes; the same row elsewhere in a
    // fresh array is positive evidence and must survive the positional null.
    await store.commit({ deliveries: [{ ...delivery("list", [], 3), data: [null, ref("a")], rows: [row("a")] }] });
    assert.ok((await store.coverage()).rows.some((item: any) => item.id === "a"));
    await store.close();
  }
});

const range = (rowIds: string[], stop = "Exhausted", extra = {}) => ({ site: "list", table: "messages",
  index: "byName", prefix: [], order: "Asc", take: 2, after: null, before: null,
  gt: null, gte: null, lt: null, lte: null, ruleHash: "rule", rowIds, stop, absence: false, ...extra });

test("uniform range eviction uses engine ordering for Unicode, Bytes and optional values", async () => {
  for (const scenario of [
    { type: { Text: {} }, held: "\u{10000}", fresh: ["\u9000", "\ue000"], evicted: false },
    { type: { Bytes: {} }, held: { Bytes: "10" }, fresh: [{ Bytes: "00" }, { Bytes: "20" }], evicted: true },
    { type: { Bytes: {} }, held: { Bytes: "ff" }, fresh: [{ Bytes: "00" }, { Bytes: "20" }], evicted: false },
    { type: { Optional: { Text: {} } }, held: null, fresh: ["a", "b"], evicted: false },
    { type: { Optional: { Text: {} } }, held: "a", fresh: [null, "b"], evicted: true },
    { type: { Optional: { Text: {} } }, held: undefined, fresh: ["a", "b"], evicted: false },
  ]) for (const order of ["Asc", "Desc"]) {
    const store = new PersistentRangeStore({ carrier: "memory", open: async () => undefined,
      replace: async () => {}, close: () => {}, wipe: async () => {} });
    const schema = { tables: { messages: { columns: { id: "Id", name: scenario.type }, indexes: { byName: { columns: ["name", "id"] } } } } };
    const named = (id: string, name: any) => ({ table: "messages", id, row: { id, name } });
    await store.open("alice");
    await store.commit({ schema, deliveries: [
      { ...delivery("list", ["x"], 1), rows: [named("x", scenario.held)], receipt: { ...receipt(), ranges: [range(["x"], "Exhausted", { order })] } },
      { ...delivery("other", ["x"], 1), rows: [named("x", scenario.held)] },
    ] });
    const ids = order === "Asc" ? ["a", "b"] : ["b", "a"];
    await store.commit({ schema, deliveries: [{ ...delivery("list", ids, 2), state: "capped",
      rows: [named("a", scenario.fresh[0]), named("b", scenario.fresh[1])],
      receipt: { ...receipt(), ranges: [range(ids, "Limit", { order })] } }] });
    assert.equal((await store.coverage()).rows.some((item: any) => item.id === "x"), !scenario.evicted,
      JSON.stringify({ scenario, order }));
    await store.close();
  }
});

test("escaped objects remain literals through collection, viewing, eviction and carrier reopen", async () => {
  const { root, factories } = await carriers();
  try {
    for (const factory of factories) {
      let store = factory();
      await store.open("alice");
      const literal = { $row: { table: "messages", id: "literal" } };
      const data = { $row: { $value: { ...literal, nested: ref("real") } } };
      await store.commit({ deliveries: [
        { ...delivery("escaped", ["real"], 1), data },
        delivery("viewed", ["literal"], 1),
      ] });
      await store.commit({ viewed: [{ table: "messages", id: "literal" }] });
      assert.deepEqual((await store.answer("escaped", {})).data, { ...literal, nested: { id: "real", body: "real" } });
      await store.commit({ tombstones: [{ table: "messages", id: "literal", seq: 2 }] });
      assert.equal((await store.answer("escaped", {})).state, "complete");
      await store.close();
      store = factory();
      await store.open("alice");
      assert.deepEqual((await store.answer("escaped", {})).data, { ...literal, nested: { id: "real", body: "real" } });
      await store.commit({ deliveries: [{ ...delivery("literalOnly", [], 3), data: { $row: { $value: literal } } }] });
      assert.deepEqual((await store.answer("literalOnly", {})).data, literal);
      await store.close();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("held answer callers cannot mutate the store's immutable committed rows", async () => {
  const { root, factories } = await carriers();
  try {
    for (const factory of factories) {
      const store = factory();
      await store.open("alice");
      await store.commit({ deliveries: [delivery("body", ["a"], 1)] });
      (await store.answer("body", {})).data[0].body = "caller mutation";
      await store.commit({ outbox: { put: [entry("g:0")] } });
      assert.deepEqual((await store.answer("body", {})).data, [{ id: "a", body: "a" }]);
      await store.close();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the first metadata-only swap persists normalization of a legacy plaintext fingerprint", async () => {
  const { root, factories } = await carriers();
  try {
    for (const factory of factories) {
      let store = factory();
      await store.open("alice");
      await store.commit({ deliveries: [delivery("body", ["a"], 1)] });
      const state = structuredClone((store as any).state);
      Object.values(state.answers)[0].fingerprint = '{"rows":"LEGACY_PRIVATE_SENTINEL"}';
      await (store as any).backend.replace(state, { put: [], remove: [] });
      await store.close();
      store = factory();
      await store.open("alice");
      await store.commit({ outbox: { put: [entry("g:0")] } });
      await store.close();
      const backend = (factory() as any).backend;
      assert.equal(JSON.stringify(await backend.open("alice")).includes("LEGACY_PRIVATE_SENTINEL"), false, factory.carrier);
      await backend.close();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a new authenticated epoch accepts a same-seq revalidation then restores duplicate conflict checks", async () => {
  const { root, factories } = await carriers();
  try {
    for (const factory of factories) {
      let store = factory();
      const facts = { generation: "generation", schemaHash: "schema", authEpoch: 1 };
      const original = { ...delivery("body", ["a"], 1), validator: "old-validator", next: "old-cursor" };
      await store.open("alice");
      await store.commit({ facts, deliveries: [original], outbox: { put: [entry("g:0")] } });
      await store.commit({ facts: { ...facts, authEpoch: 2 } });
      assert.equal((await store.answer("body", {})).validator, "old-validator");
      await store.close();
      store = factory();
      await store.open("alice");
      assert.equal((await store.outbox.all()).length, 1);
      const fresh = { ...original, validator: "new-validator", next: "new-cursor" };
      await store.commit({ deliveries: [fresh] });
      await store.commit({ deliveries: [fresh] });
      assert.equal((await store.answer("body", {})).validator, "new-validator");
      await assert.rejects(store.commit({ deliveries: [{ ...fresh, validator: "conflicting-validator" }] }), /conflicting deliveries/);
      assert.deepEqual((await store.coverage()).rows, [row("a")]);
      await store.close();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function seedHistory(store: any) {
  await store.open("alice");
  await store.commit({ deliveries: Array.from({ length: 20 }, (_, page) => ({
    ...delivery(`page${page}`, Array.from({ length: 50 }, (_, at) => `m${page * 50 + at}`), 1),
    rows: Array.from({ length: 50 }, (_, at) => row(`m${page * 50 + at}`, "retained-body".repeat(40))),
  })) });
}

test("outbox-only SQLite swaps write no unchanged history and do not clone it", async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-store-delta-"));
  const driver = nodeSqliteDriver(join(root, "state.db"));
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  const wrapped = { ...driver, transaction: (body: any) => driver.transaction((tx: any) => body({ ...tx,
    run: async (sql: string, params: unknown[]) => { writes.push({ sql, params }); return tx.run(sql, params); },
  })) };
  const store = new PersistentRangeStore(new SqliteBackend(wrapped));
  try {
    await seedHistory(store);
    writes.length = 0;
    const originalClone = globalThis.structuredClone;
    const clonedHistory: unknown[] = [];
    globalThis.structuredClone = ((value: unknown, ...options: any[]) => {
      if (JSON.stringify(value)?.includes("retained-body")) clonedHistory.push(value);
      return originalClone(value, ...options);
    }) as typeof structuredClone;
    try { await store.commit({ outbox: { put: [entry("g:0")] } }); }
    finally { globalThis.structuredClone = originalClone; }
    assert.equal(clonedHistory.length, 0);
    assert.equal(writes.filter(({ sql }) => /(?:INTO|FROM) (?:rows|answers)\b/.test(sql)).length, 0);
    assert.equal(writes.some(({ sql, params }) => sql.includes("metadata") && params[1] === '["rowSeq"]'), false);
    assert.equal(writes.filter(({ sql }) => sql.startsWith("INSERT")).length, 2, "one outbox entry and the scalar clock header");
    assert.equal((await store.outbox.all()).length, 1);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});

test("outbox-only IndexedDB swaps update only the entry and scalar header, including after reopen", async () => {
  const database = new FakeIndexedDb();
  const factory = indexedDbRangeStore({ indexedDB: database as any, locks: new FakeLocks() });
  let store = factory();
  try {
    await seedHistory(store);
    await store.close();
    store = factory();
    await store.open("alice");
    database.writes.length = 0;
    await store.commit({ outbox: { put: [entry("g:0")] } });
    assert.deepEqual(database.writes, [
      { store: "outbox", action: "put", key: "g:0" }, { store: "meta", action: "put", key: "state" },
    ]);
    await store.commit({ outbox: { remove: ["g:0"] } });
    assert.equal((await store.outbox.all()).length, 0);
    assert.equal((await store.coverage()).rows.length, 1000);
  } finally { await store.close(); }
});
