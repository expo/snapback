import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { fileRangeStore } from "../dist/test.mjs";
import { decodeDeliveryEnvelope, encodeDeliveryEnvelope } from "../dist/index.mjs";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { PersistentRangeStore, SqliteBackend, nodeSqliteDriver, OfflineRuntime } from "../dist/sqlite-test.mjs";
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

test("identical pre-program envelopes survive cold custody and install checked coverage without accepting equivocation", async (context) => {
  // Actual final native v5 certificates; these envelopes/validators are synthetic controls.
  const fixtures = JSON.parse(await readFile(new URL("../../evaluator/src/test-search-v5-fixtures.json", import.meta.url), "utf8"));
  const people = fixtures.operations["search.findPeople"];
  const cases = [
    { op: "minimum", fixture: fixtures.minimum, args: { term: "ab" }, data: "ab", rows: [], receipt: receipt() },
    { op: "search.findPeople", fixture: { ...people, schema: fixtures.schema }, args: { term: "ab", c: null },
      data: [{ $row: { table: "people", id: "p1" } }], rows: [{ table: "people", id: "p1", row: { id: "p1", name: "ab", handle: null } }],
      receipt: { ...receipt(), ranges: [{ site: "search.findPeople.0", table: "people", index: "byNameWords",
        prefix: [{ WordPrefix: { contract: "u17-nfc-scf-nfc-wsp-p", source: "ab" } }], order: "Asc", take: 20,
        after: null, before: null, gt: null, gte: null, lt: null, lte: null,
        ruleHash: people.certificate.rule_hashes["people.read"], rowIds: ["p1"], stop: "Exhausted", absence: false }] } },
  ];
  const { root, factories } = await carriers();
  try {
    for (const factory of factories) for (const item of cases) await context.test(`${factory.carrier}/${item.op}`, async () => {
      const { fixture, op, args } = item, generation = "c".repeat(64);
      const packet = { generation, schema: fixture.schema, schemaHash: fixture.certificate.schema_hash,
        programs: { [op]: { kind: "query", ir: fixture.program, planHash: fixture.certificate.plan_hash, certificate: fixture.certificate } } };
      const envelope = { protocol: 1, generation, schemaHash: packet.schemaHash, planHash: fixture.certificate.plan_hash,
        authority: { principal: op, authEpoch: 0 }, state: "complete", data: item.data, next: null, seq: 3264,
        rows: item.rows, receipt: item.receipt, validator: "d".repeat(64) };
      let runtime = new OfflineRuntime({ store: factory });
      await runtime.open(op, true);
      const commit = async (value: any) => runtime.commit(op, args, await runtime.accept(op, args, value));
      await commit(envelope); await commit(envelope);
      assert.equal((await runtime.store.answer(op, args)).receipt, undefined, "untrusted issuing Q grants no coverage");
      await assert.rejects(commit({ ...envelope, data: [] }), /conflicting deliveries/);
      await runtime.store.close();
      runtime = new OfflineRuntime({ store: factory }); await runtime.open(op, true);
      await runtime.program(packet);
      try {
        assert.equal((await runtime.store.answer(op, args)).receipt, undefined);
        await commit(envelope);
        assert.ok((await runtime.store.answer(op, args)).receipt, "exact duplicate can now install its checked receipt");
        assert.equal((await runtime.twin.evaluate(op, args)).state, "complete");
        const before = await runtime.store.coverage();
        await commit(envelope); assert.deepEqual(await runtime.store.coverage(), before);
        const controls = [{ data: [] }, { validator: "e".repeat(64) }];
        if (item.rows.length) controls.push({ rows: [{ ...item.rows[0], row: { ...item.rows[0].row, name: "changed" } }] },
          { receipt: { ...item.receipt, ranges: [{ ...item.receipt.ranges[0], ruleHash: "f".repeat(64) }] } });
        for (const changed of controls) {
          await assert.rejects(commit({ ...envelope, ...changed }), /conflicting deliveries/);
          assert.deepEqual(await runtime.store.coverage(), before, "equivocation leaves custody and coverage atomic");
        }
      } finally { await runtime.store.close(); }
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

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
    const schema = { tables: { messages: { columns: { id: "Id", name: scenario.type }, indexes: { byName: { components: [{ Column: "name" }, { Column: "id" }] } } } } };
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

test('compatible bounded pages union presence within one durable sequence', async () => {
  const store = new PersistentRangeStore({ carrier: 'memory', open: async () => undefined,
    replace: async () => {}, close() {}, wipe: async () => {} });
  await store.open('alice');
  const schema = { tables: { messages: { columns: { id: 'Id', body: { Text: { max: 20 } } },
    indexes: { byName: { components: [{ Column: 'body' }, { Column: 'id' }] } } } } };
  await store.commit({ schema, deliveries: [{ ...delivery('held', ['b'], 1), receipt: { ...receipt(), ranges: [range(['b'])] } }] });
  // The former a,c/b premise skipped a known interior member in a checked Limit
  // interval. It is contradictory under the all-ID contract, not a valid union.
  await assert.rejects(store.commit({ schema, deliveries: [
    { ...delivery('wide', ['a', 'c'], 2), receipt: { ...receipt(), ranges: [range(['a', 'c'], 'Limit')] } },
    { ...delivery('middle', ['b'], 2), receipt: { ...receipt(), ranges: [range(['b'], 'Limit')] } },
  ] }), /conflicting durable fact/);
  await store.commit({ schema, deliveries: [
    { ...delivery('wide', ['a', 'b'], 2), receipt: { ...receipt(), ranges: [range(['a', 'b'], 'Limit')] } },
    { ...delivery('middle', ['b', 'c'], 2), receipt: { ...receipt(), ranges: [range(['b', 'c'], 'Limit')] } },
  ] });
  assert.deepEqual((await store.answer('held', {})).data, [{ id: 'b', body: 'b' }]);
  assert.deepEqual((await store.coverage()).evicted, []);
  await store.close();
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

// Clock fields here are synthetic transport controls. Native clock-envelope proof is qualified separately.
const clocked = (op: string, ids: string[], seq: number, readTime: number, extra = {}) => ({
  ...delivery(op, ids, seq), readTime, clockPlanHash: 'c'.repeat(64), validator: 'd'.repeat(64), ...extra,
});
test('execution clocks order answers while immutable durable facts survive collection on every carrier', async context => {
  const { root, factories } = await carriers();
  try {
    for (const factory of factories) await context.test(factory.carrier, async () => {
      let store = factory(); await store.open('clock');
      const first = clocked('timed', ['one'], 10, -30, { next: 'old-link' });
      await store.commit({ deliveries: [first, delivery('anchor', ['one'], 10)] });
      const fingerprint = Object.values((store as any).state.answers)[0].fingerprint;
      await store.commit({ deliveries: [clocked('timed', [], 10, -20, { data: [null], next: 'new-link' })] });
      assert.deepEqual((await store.answer('anchor', {})).data, [{ id: 'one', body: 'one' }], 'clock omission is not revocation');
      assert.deepEqual((await store.coverage()).evicted, []);
      await store.commit({ deliveries: [first] });
      assert.equal((await store.answer('timed', {})).readTime, -20, 'older clock at equal seq is stale');
      await assert.rejects(store.commit({ deliveries: [clocked('timed', [], 10, -20, { data: 'changed' })] }), /conflicting deliveries/);
      await store.commit({ dropAnswers: ['anchor\0{}'] });
      assert.equal((await store.coverage()).rows.length, 0, 'the immutable guard retains no row body');
      await store.close(); store = factory(); await store.open('clock');
      await assert.rejects(store.commit({ deliveries: [clocked('other', ['one'], 10, 0, { rows: [row('one', 'reverted')] })] }), /conflicting durable fact/);
      await assert.rejects(store.commit({ deliveries: [{ ...delivery('ordinary', [], 10), receipt: { ...receipt(), absences: [['messages', 'byId', ['one']]] } }] }), /conflicting durable fact/);
      await store.commit({ deliveries: [clocked('timed', ['one'], 11, -100, { rows: [row('one', 'new-seq')] })] });
      assert.equal((await store.answer('timed', {})).readTime, -100, 'higher durable seq establishes a new clock frontier');
      const original = Object.values((store as any).state.answers).find((a: any) => a.op === 'timed');
      assert.notEqual(original.fingerprint, fingerprint);
      await store.commit({ refreshes: [{ op: 'timed', args: {}, seq: 12, validator: 'd'.repeat(64) }] });
      assert.equal(Object.values((store as any).state.answers).find((a: any) => a.op === 'timed').fingerprint, original.fingerprint);
      assert.equal((await store.answer('timed', {})).readTime, -100);
      await store.commit({ deliveries: [clocked('timed', [], 12, -90)] }); // body collection after immutable conditional advancement
      await assert.rejects(store.commit({ deliveries: [{ ...delivery('ordinary', ['one'], 12), rows: [row('one', 'old-body')] }] }), /conflicting durable fact/);
      await store.commit({ deliveries: [clocked('negative', [], 13, 1, { receipt: { ...receipt(), absences: [['messages', 'byId', ['gone']]] } })] });
      await assert.rejects(store.commit({ deliveries: [delivery('positive', ['gone'], 13)] }), /conflicting durable fact/);
      const verdict = { ruleHash: 'a'.repeat(64), pinnedInputsDigest: 'b'.repeat(64), principal: 'clock', authEpoch: 0, result: true };
      await store.commit({ deliveries: [clocked('verdict', [], 14, 1, { receipt: { ...receipt(), verdicts: [verdict] } })] });
      await store.commit({ refreshes: [{ op: 'verdict', args: {}, seq: 15, validator: 'd'.repeat(64) }] });
      await store.close(); store = factory(); await store.open('clock');
      await assert.rejects(store.commit({ deliveries: [{ ...delivery('ordinary', [], 15), receipt: { ...receipt(), verdicts: [{ ...verdict, result: false }] } }] }), /conflicting durable fact/);
      await store.close();
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ordinary conditional proof enrollment requires one full read and preserves original custody through GC', async context => {
  const { root, factories } = await carriers();
  try {
    for (const factory of factories) await context.test(factory.carrier, async () => {
      const runtime = new OfflineRuntime({ store: factory }); await runtime.open('clock', true);
      const ordinary = { ...delivery('ordinary', ['one'], 1), validator: 'a'.repeat(64) };
      await runtime.store.commit({ deliveries: [ordinary] });
      const conditional = await runtime.accept('ordinary', {}, { state: 'unchanged', seq: 3, validator: ordinary.validator });
      await runtime.store.commit({ deliveries: [clocked('timed', ['one'], 1, 1)] });
      await runtime.store.commit({ tombstones: [{ table: 'messages', id: 'one', seq: 2 }] });
      assert.equal((await runtime.store.coverage()).rows.length, 0);
      await assert.rejects(runtime.commit('ordinary', {}, conditional), /requires immutable/);
      assert.equal((await runtime.store.answer('ordinary', {})).seq, 1);
      let reads = 0;
      conditional.revalidate = async () => { reads++; throw new Error('full read unavailable'); };
      await assert.rejects(runtime.commit('ordinary', {}, conditional), /full read unavailable/);
      assert.equal(reads, 1); assert.equal((await runtime.store.answer('ordinary', {})).seq, 1);
      conditional.revalidate = async () => { reads++; return { result: { state: 'complete', data: [], seq: 3 },
        envelope: { protocol: 1, generation: 'e'.repeat(64), schemaHash: 'f'.repeat(64), planHash: 'a'.repeat(64),
          authority: { principal: 'clock', authEpoch: 0 }, ...ordinary, seq: 3, data: [ref('one')], rows: [row('one', 'current')], next: null } }; };
      await runtime.commit('ordinary', {}, conditional);
      assert.equal(reads, 2); assert.equal((await runtime.store.answer('ordinary', {})).needsFactProofs, undefined);
      await assert.rejects(runtime.store.commit({ deliveries: [clocked('timed', ['one'], 3, 2)] }), /conflicting durable fact/);
      await runtime.store.close();
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('stamped cold custody validates its actual issuing clock and legacy reset preserves queued work', async context => {
  const { clock: packet } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  // Actual raw clock IR recertified by final native v5; the no-row envelopes below are synthetic signed-clock controls.
  const op = 'clock.read', operation = packet.programs[op];
  const envelope = { protocol: 1, generation: packet.generation, schemaHash: packet.schemaHash, planHash: operation.planHash,
    authority: { principal: 'clock', authEpoch: 0 }, state: 'complete', data: { now: -5, rows: [] }, seq: 1, next: null,
    rows: [], receipt: receipt(), validator: 'a'.repeat(64), readTime: -5 };
  const { readTime: _readTime, ...untimed } = envelope;
  const baseBytes = Buffer.byteLength(encodeDeliveryEnvelope(untimed));
  for (const readTime of [-Number.MAX_SAFE_INTEGER, -1, 0, Number.MAX_SAFE_INTEGER]) {
    const stamped = { ...envelope, readTime };
    assert.equal(decodeDeliveryEnvelope(stamped).readTime, readTime);
    assert.equal(JSON.parse(encodeDeliveryEnvelope(stamped)).readTime, readTime);
    assert(Buffer.byteLength(encodeDeliveryEnvelope(stamped)) - baseBytes <= 32);
  }
  const { root, factories } = await carriers();
  try {
    for (const factory of factories) await context.test(factory.carrier, async () => {
      let runtime = new OfflineRuntime({ store: factory }); await runtime.open('clock', true);
      await runtime.commit(op, {}, await runtime.accept(op, {}, envelope));
      await runtime.store.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open('clock', true);
      await runtime.program(packet); await runtime.commit(op, {}, await runtime.accept(op, {}, envelope));
      assert.equal((await runtime.store.answer(op, {})).readTime, -5);
      assert.ok((await runtime.store.answer(op, {})).receipt, 'same raw envelope now installs trusted coverage');
      const { readTime, ...missing } = envelope;
      await assert.rejects(runtime.commit(op, {}, await runtime.accept(op, {}, missing)), /clock identity/);
      for (const value of [-0, 1.5, 2 ** 53, '1', null, undefined]) await assert.rejects(runtime.accept(op, {}, { ...envelope, readTime: value }), /readTime/);
      await assert.rejects(runtime.commit(op, {}, await runtime.accept(op, {}, { ...envelope, planHash: 'b'.repeat(64) })), /identity/);
      await runtime.store.close();
      // Upgrade from genuinely unstamped cache: one existing reset/re-drain, never fingerprint erasure.
      const store = factory(); await store.open('legacy');
      await store.commit({ facts: { generation: packet.generation, schemaHash: packet.schemaHash, authEpoch: 0 },
        programs: { [packet.generation]: packet }, deliveries: [{ ...delivery(op, [], 1), data: 1 }], outbox: { put: [entry('keep')] } });
      await store.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.program(packet); await runtime.open('legacy', true);
      assert.equal(runtime.resetNeeded, true); assert.equal(await runtime.store.answer(op, {}), undefined);
      assert.equal((await runtime.store.outbox.all())[0].intent, 'keep');
      await runtime.store.close();
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('clock-only tail frames preserve watermark and retirement evidence; explicit new facts still retire', async () => {
  const store = new PersistentRangeStore({ carrier: 'memory', open: async () => undefined, replace: async () => {}, close() {}, wipe: async () => {} });
  await store.open('clock');
  const tail = clocked('tail', [], 10, 1, { args: { c: 'head' }, cursorArg: 'c', next: 'old-next' });
  const mark = { op: 'tail', args: { c: null }, cursorArg: 'c', watermark: 'head', updatedAt: 1 };
  await store.commit({ deliveries: [tail], watermark: mark, outbox: { put: [{ ...entry('pending'), state: 'committed', response: { seq: 10 }, predicted: true }] },
    overlay: { put: { pending: [{ table: 'messages', id: 'missing', row: { id: 'missing', body: 'pending' } }] } } });
  await store.commit({ deliveries: [{ ...tail, readTime: 2, next: 'new-next' }], watermark: { ...mark, watermark: 'new-next' }, resumeSeq: 11 });
  assert.equal((await store.coverage()).watermarks[0].watermark, 'head', 'tail page args differ from base watermark args');
  assert.ok((await store.outbox.overlay()).pending);
  assert.equal((store as any).state.overlayMisses.pending, undefined);
  await store.commit({ deliveries: [clocked('actual', ['missing'], 10, 3)] });
  assert.equal((await store.outbox.overlay()).pending, undefined, 'actual full row evidence still proves arrival at its durable seq');
  await store.close();
});

test('timed guard slot exhaustion resets coverage once, preserves outbox, and refuses a repeated saturated rebuild', async () => {
  let saved: any;
  const factory = () => new PersistentRangeStore({ carrier: 'memory', open: async () => saved,
    replace: async state => { saved = structuredClone(state); }, close() {}, wipe: async () => {} });
  const seed = factory(); await seed.open('clock');
  const facts = { generation: 'e'.repeat(64), schemaHash: 'f'.repeat(64), authEpoch: 0 };
  await seed.commit({ facts, outbox: { put: [entry('keep')] } }); await seed.close();
  // Real primary-absence guards need no key-image dictionary. Two remaining slots
  // cannot fit the new positive's guard, answer reference AND immutable image.
  const saturate = () => {
    saved.rowFacts = {};
    for (let i = 0; i < 524286; i++) saved.rowFacts[`messages\0old${i}`] = 1;
    saved.factSlots = 524286;
  };
  saturate();
  let runtime = new OfflineRuntime({ store: factory }); await runtime.open('clock', true);
  const envelope = { protocol: 1, ...facts, planHash: 'b'.repeat(64), authority: { principal: 'clock', authEpoch: 0 },
    state: 'complete', data: [ref('fresh')], rows: [row('fresh')], receipt: receipt(), next: null, seq: 2, readTime: 1, validator: 'c'.repeat(64) };
  delete envelope.authEpoch;
  assert.equal(await runtime.commit('timed', {}, await runtime.accept('timed', {}, envelope)), true);
  assert.equal(runtime.resetNeeded, true); assert.equal((await runtime.store.outbox.all())[0].intent, 'keep');
  assert.equal(Object.keys(saved.rowFacts).length, 0);
  await runtime.store.close(); saturate();
  runtime = new OfflineRuntime({ store: factory }); await runtime.open('clock', true);
  await assert.rejects(runtime.commit('timed', {}, await runtime.accept('timed', {}, envelope)), /still exceeds its slot budget/);
  assert.equal(Object.keys(saved.rowFacts).length, 524286, 'second failure preserves the existing recovery state');
  assert.equal((await runtime.store.outbox.all())[0].intent, 'keep'); await runtime.store.close();
});

test('revalidation reset markers refuse concurrent repeats atomically and failed publication remains retryable cold', async () => {
  let saved: any, fail = false;
  const factory = () => new PersistentRangeStore({ carrier: 'memory', open: async () => structuredClone(saved),
    replace: async state => { if (fail) throw new Error('injected marker publication failure'); saved = structuredClone(state); }, close() {}, wipe: async () => {} });
  let store = factory(); await store.open('reset');
  await store.commit({ deliveries: [clocked('read', ['one'], 0, 0)], outbox: { put: [entry('keep')] } });
  const before = JSON.stringify(saved), marker = JSON.stringify(['reset',{ generation: 'g',schemaHash: 's',authEpoch: 0 }]);
  fail = true; await assert.rejects(store.commit({ resetCoverage: true,factLimitReset: marker }), /injected marker/);
  assert.equal(JSON.stringify(saved), before); await store.close(); fail = false; store = factory(); await store.open('reset');
  const results = await Promise.allSettled([store.commit({ resetCoverage: true,factLimitReset: marker }),
    store.commit({ resetCoverage: true,factLimitReset: marker,outbox: { remove: ['keep'] } })]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.equal((results[1] as PromiseRejectedResult).reason.code, 'E_OFFLINE_CARRIER');
  assert.match((results[1] as PromiseRejectedResult).reason.message, /still exceeds its slot budget/);
  assert.equal(saved.factLimitReset, marker); assert.equal((await store.outbox.all())[0].intent, 'keep');
  await store.close(); store = factory(); await store.open('reset');
  const after = JSON.stringify(saved);
  await assert.rejects(store.commit({ resetCoverage: true,factLimitReset: marker }), /still exceeds its slot budget/);
  assert.equal(JSON.stringify(saved), after, 'cold refusal preserves the prior durable state');
  await store.commit({ resetCoverage: true });
  assert.equal(saved.factLimitReset, marker, 'explicit manual reset does not erase the saturation marker');
  assert.equal((await store.outbox.all())[0].intent, 'keep'); await store.close();
});

test('first timed facts constrain ordinary conditionals in the same atomic swap and revalidate each affected answer once', async context => {
  const { root, factories } = await carriers();
  try {
    for (const factory of factories) await context.test(factory.carrier, async () => {
      const runtime = new OfflineRuntime({ store: factory }); await runtime.open('clock', true);
      const ordinary = ['one', 'two'].map(id => ({ ...delivery(id, [id], 1), validator: 'a'.repeat(64) }));
      await runtime.store.commit({ deliveries: ordinary });
      const refreshes = ordinary.map(d => ({ op: d.op, args: {}, seq: 2, validator: d.validator }));
      const timed = clocked('timed', ['one', 'two'], 2, 1, { rows: [row('one', 'new'), row('two', 'new')] });
      await assert.rejects(runtime.store.commit({ deliveries: [timed], refreshes }), /requires immutable/);
      for (const d of ordinary) { const answer = await runtime.store.answer(d.op, {});
        assert.equal(answer.seq, 1); assert.equal(answer.data[0].body, d.op); assert.equal(answer.needsFactProofs, undefined); }
      assert.equal(Object.keys((runtime.store as any).state.rowFacts).length, 0, 'failed preflight rolls back every prospective guard');
      const counts = new Map<string, number>();
      const full = (d: any) => ({ protocol: 1, generation: 'e'.repeat(64), schemaHash: 'f'.repeat(64), planHash: d.clockPlanHash ?? 'b'.repeat(64),
        authority: { principal: 'clock', authEpoch: 0 }, state: d.state, data: d.data, next: null, seq: d.seq,
        rows: d.rows, receipt: d.receipt, validator: d.validator, ...(d.readTime === undefined ? {} : { readTime: d.readTime }) });
      const items = await Promise.all(ordinary.map(async d => ({ op: d.op, args: {}, accepted: await runtime.accept(d.op, {},
        { state: 'unchanged', seq: 2, validator: d.validator }, async () => {
          counts.set(d.op, (counts.get(d.op) ?? 0) + 1); return full({ ...d, seq: 2, rows: [row(d.op, 'new')], validator: 'b'.repeat(64) });
        }) })));
      items.push({ op: timed.op, args: {}, accepted: await runtime.accept(timed.op, {}, full(timed)) });
      await runtime.commitMany(items);
      assert.deepEqual([...counts], [['one', 1], ['two', 1]]);
      for (const d of ordinary) { const answer = await runtime.store.answer(d.op, {});
        assert.equal(answer.seq, 2); assert.equal(answer.data[0].body, 'new'); assert.equal(answer.needsFactProofs, undefined); }
      await runtime.store.close();
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const carrierIndex of [0, 1, 2]) test(`checked extent membership follows immutable assertion sequences across row movement: carrier ${carrierIndex}`, async context => {
  const fixtures = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  // Native-certified v5 programs; contradictory transport frames are synthetic.
  const clock = structuredClone(fixtures.clock), bounded = fixtures.boundedClockCertificate;
  const ir = structuredClone(clock.programs['clock.read'].ir); ir.name = 'clock.bounded';
  ir.body[0].Return.Object.rows.Scan.range.lt = { Literal: { Int: 1 } };
  clock.programs[ir.name] = { kind: 'query', ir, certificate: bounded, planHash: bounded.plan_hash };
  const timed = structuredClone(fixtures.operations['search.findPeople'].program);
  timed.name = 'search.timed'; timed.read_time_granularity_ms = 1;
  timed.body[0].Return = { Object: { now: { Input: 'ReadTime' }, rows: timed.body[0].Return } };
  const cert = fixtures.timedSearchCertificate;
  const search = { generation: 'd'.repeat(64), schemaHash: cert.schema_hash, schema: fixtures.schema,
    programs: { [timed.name]: { kind: 'query', ir: timed, certificate: cert, planHash: cert.plan_hash },
      'search.findPeople': { kind: 'query', ir: fixtures.operations['search.findPeople'].program,
        certificate: fixtures.operations['search.findPeople'].certificate, planHash: fixtures.operations['search.findPeople'].certificate.plan_hash } } };
  const { root, factories: allFactories } = await carriers();
  const factories = [allFactories[carrierIndex]];
  try {
    for (const factory of factories) for (const derived of [false, true]) for (const cold of [false, true])
      for (const arrival of ['batch', 'separate', 'reopen-between'])
      await context.test(`${factory.carrier}/${derived ? 'Unicode' : 'Time'}/${cold ? 'cold' : 'warm'}/${arrival}`, async () => {
        const packet = derived ? search : clock, table = derived ? 'people' : 'events';
        for (const reverse of [false, true]) for (const scenario of [
          { name: 'earlier-contradiction', seed: 0, hole: 1, move: 2, position: 5, rejects: true },
          { name: 'same-seq-move-out', seed: 0, hole: 2, move: 2, position: 5 },
          { name: 'later-hole-after-move-out', seed: 0, hole: 3, move: 2, position: 5 },
          { name: 'later-positive-after-hole', seed: 0, hole: 2, move: 3, position: 5 },
          { name: 'same-seq-move-in', seed: 5, hole: 2, move: 2, position: 0, rejects: true },
          { name: 'later-hole-after-move-in', seed: 5, hole: 3, move: 2, position: 0, evicts: true },
        ]) {
          const principal = `${derived}-${cold}-${reverse}-${scenario.name}-${arrival}`;
          let runtime = new OfflineRuntime({ store: factory }); await runtime.open(principal, true); await runtime.program(packet);
          const accept = async (inside: boolean, seq: number, position: number | null, readTime: number) => {
            const op = derived ? inside ? timed.name : 'search.findPeople' : inside ? 'clock.bounded' : 'clock.read';
            const operation = packet.programs[op], term = inside || position === 0 ? 'cafe\u0301' : 'Other';
            const args = derived ? { term, c: null } : {}, ids = position === null ? [] : ['one'];
            const row = derived ? { id: 'one', name: position === 0 ? 'CAFÉ' : 'Other', handle: null } : { id: 'one', at: position };
            const frame = { protocol: 1, generation: packet.generation, schemaHash: packet.schemaHash,
              planHash: operation.planHash, authority: { principal, authEpoch: 0 }, state: 'complete', seq,
              ...(derived && !inside ? {} : { readTime }),
              data: { now: readTime, rows: ids.map(id => ({ $row: { table, id } })) }, next: null,
              rows: ids.map(id => ({ table, id, row })), validator: 'a'.repeat(64), receipt: { ...receipt(), ranges: [{
                site: derived ? 'search.findPeople.0' : 'clock.range', table, index: derived ? 'byNameWords' : 'byAt',
                prefix: derived ? [{ WordPrefix: { contract: 'u17-nfc-scf-nfc-wsp-p', source: term } }] : [],
                order: 'Asc', take: derived ? 20 : 10, after: null, before: null, gt: null, gte: null,
                lt: derived ? null : inside ? 1 : readTime, lte: null, rowIds: ids, stop: 'Exhausted', absence: false,
                ruleHash: operation.certificate.rule_hashes[`${table}.read`],
              }] } };
            return { op, args, accepted: await runtime.accept(op, args, frame) };
          };
          await runtime.store.commit({ outbox: { put: [entry('keep')] } });
          await runtime.commitMany([await accept(scenario.seed === 0, 1, scenario.seed, 10)]);
          // Establish the matching empty domain when the starting row lies outside it.
          if (scenario.seed) await runtime.commitMany([await accept(true, 1, null, 11)]);
          if (cold) { await runtime.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open(principal, true); }
          const before = JSON.stringify((runtime.store as any).state);
          // Different ops/arguments keep both frames applicable in either order.
          const items = [await accept(true, scenario.hole, null, 20), await accept(false, scenario.move, scenario.position, 30)];
          if (reverse) items.reverse();
          if (arrival !== 'batch') {
            let refused = false;
            for (const item of items) {
              if (arrival === 'reopen-between') { await runtime.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open(principal, true); }
              const prior = JSON.stringify((runtime.store as any).state);
              try { await runtime.commitMany([item]); } catch (error) {
                assert.match(error.message, /conflicting durable fact/); refused = true;
                assert.equal(JSON.stringify((runtime.store as any).state), prior, 'only the refused transaction rolls back'); break;
              }
            }
            assert.equal(refused, !!scenario.rejects, scenario.name);
          } else if (scenario.rejects) {
            await assert.rejects(runtime.commitMany(items), /conflicting durable fact/, scenario.name);
            assert.equal(JSON.stringify((runtime.store as any).state), before, 'failed admission preserves rows, guards, fingerprints and outbox');
          } else await runtime.commitMany(items);
          if (!scenario.rejects) {
            const coverage = await runtime.store.coverage();
            assert.equal(coverage.rows.length, scenario.evicts ? 0 : 1, scenario.name);
            if (!scenario.evicts) assert.equal(derived ? coverage.rows[0].row.name : coverage.rows[0].row.at, derived ? 'Other' : 5);
            if (scenario.move <= scenario.hole && !scenario.evicts)
              assert.equal(coverage.evicted.length, 0, 'known movement out never creates a global absence');
          }
          assert.equal((await runtime.store.outbox.all())[0].intent, 'keep'); await runtime.close();
        }
      });
    for (const factory of factories) for (const cold of [false, true]) await context.test(`${factory.carrier}/Limit-edges-${cold}`, async () => {
      const principal = `edges-${cold}`;
      let runtime = new OfflineRuntime({ store: factory }); await runtime.open(principal, true); await runtime.program(clock);
      const accept = async (op: string, seq: number, readTime: number, entries: Array<[string, number]>, limit = false) => {
        const operation = clock.programs[op], ids = entries.map(([id]) => id);
        return { op, args: {}, accepted: await runtime.accept(op, {}, {
          protocol: 1, generation: clock.generation, schemaHash: clock.schemaHash, planHash: operation.planHash,
          authority: { principal, authEpoch: 0 }, state: limit ? 'capped' : 'complete', seq, readTime, validator: 'a'.repeat(64), next: null,
          data: { now: readTime, rows: ids.map(id => ({ $row: { table: 'events', id } })) },
          rows: entries.map(([id, at]) => ({ table: 'events', id, row: { id, at } })), receipt: { ...receipt(), ranges: [{
            site: 'clock.range', table: 'events', index: 'byAt', prefix: [], order: 'Asc', take: 10,
            after: null, before: null, gt: null, gte: null, lt: op === 'clock.bounded' ? 1 : readTime, lte: null,
            rowIds: ids, stop: limit ? 'Limit' : 'Exhausted', absence: false, ruleHash: bounded.rule_hashes['events.read'],
          }] },
        }) };
      };
      await runtime.commitMany([await accept('clock.bounded', 1, 1, [['a', -2], ['one', -1], ['z', 0]])]);
      if (cold) { await runtime.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open(principal, true); }
      const before = JSON.stringify((runtime.store as any).state);
      await assert.rejects(runtime.commitMany([
        await accept('clock.bounded', 1, 2, [['a', -2], ['z', 0]], true),
        await accept('clock.read', 2, 10, [['a', 5]]),
      ]), /conflicting durable fact/);
      assert.equal(JSON.stringify((runtime.store as any).state), before, 'later endpoint movement cannot change the issuing Limit extent');
      await runtime.close();
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('checked fixed extent holes reject clock contradictions atomically and retain negative conditional custody warm and cold', async context => {
  const fixtures = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  const packet = structuredClone(fixtures.clock), op = 'clock.bounded', certificate = fixtures.boundedClockCertificate;
  const ir = structuredClone(packet.programs['clock.read'].ir); ir.name = op;
  ir.body[0].Return.Object.rows.Scan.range.lt = { Literal: { Int: 1 } };
  packet.programs[op] = { kind: 'query', ir, certificate, planHash: certificate.plan_hash };
  // Actual final-owner v5 certificate for this fixed extent; envelopes below are
  // adversarial authenticated-transport controls, not claimed native emissions.
  const event = (id: string) => ({ table: 'events', id, row: { id, at: id === 'other' ? 5 : 0 } });
  const eventRef = (id: string) => ({ $row: { table: 'events', id } });
  const range = { site: 'clock.range', table: 'events', index: 'byAt', prefix: [], order: 'Asc', take: 10,
    after: null, before: null, gt: null, gte: null, lt: 1, lte: null,
    ruleHash: certificate.rule_hashes['events.read'], rowIds: ['one'], stop: 'Exhausted', absence: false };
  const frame = (seq: number, readTime: number, ids: string[]) => ({ protocol: 1, generation: packet.generation,
    schemaHash: packet.schemaHash, planHash: certificate.plan_hash, authority: { principal: 'clock', authEpoch: 0 },
    state: 'complete', data: { now: readTime, rows: ids.map(eventRef) }, rows: ids.map(event), next: null,
    receipt: { ...receipt(), ranges: [{ ...range, rowIds: ids }] }, seq, readTime, validator: 'a'.repeat(64) });
  const anchor = (op: string, id: string) => ({ ...delivery(op, [], 1), data: eventRef(id), rows: [event(id)], validator: 'b'.repeat(64) });
  const { root, factories } = await carriers();
  try {
    for (const factory of factories) for (const cold of [false, true]) await context.test(`${factory.carrier}/${cold ? 'cold' : 'warm'}`, async () => {
      let runtime = new OfflineRuntime({ store: factory }); await runtime.open(`clock-${cold}`, true); await runtime.program(packet);
      const commit = async (value: any) => runtime.commit(op, {}, await runtime.accept(op, {}, { ...value, authority: { principal: `clock-${cold}`, authEpoch: 0 } }));
      const reopen = async () => {
        await runtime.store.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open(`clock-${cold}`, true);
      };
      await runtime.store.commit({ deliveries: [anchor('anchor', 'one'), anchor('unrelated', 'other')], outbox: { put: [entry('keep')] } });
      await commit(frame(1, 1, ['one'])); if (cold) await reopen();
      await commit(frame(1, 2, ['one']));
      assert.equal((await runtime.store.coverage()).rows.length, 2);
      const before = JSON.stringify((runtime.store as any).state);
      await assert.rejects(commit(frame(1, 3, [])), /conflicting durable fact/);
      assert.equal(JSON.stringify((runtime.store as any).state), before, 'failed hole leaves all durable metadata, rows, guards and outbox unchanged');
      // A different typed extent cannot infer a hole in the original fixed domain.
      const different = frame(1, 3, []); different.receipt.ranges[0].lt = -1;
      await commit(different);
      assert.deepEqual((await runtime.store.answer('anchor', {})).data, { id: 'one', at: 0 });
      await commit(frame(1, 4, ['one']));
      await commit(frame(2, 5, []));
      assert.equal((await runtime.store.answer('anchor', {})).data, null);
      assert.deepEqual((await runtime.store.answer('unrelated', {})).data, { id: 'other', at: 5 });
      assert.deepEqual((await runtime.store.coverage()).evicted, [{ table: 'events', id: 'one' }]);
      assert.equal((await runtime.store.outbox.all())[0].intent, 'keep');
      await assert.rejects(runtime.store.commit({ deliveries: [{ ...anchor('revert', 'one'), seq: 2 }] }), /conflicting durable fact/);
      if (cold) await reopen();
      await runtime.store.commit({ refreshes: [{ op, args: {}, seq: 3, validator: 'a'.repeat(64) }] });
      if (cold) await reopen();
      await assert.rejects(runtime.store.commit({ deliveries: [{ ...anchor('revert', 'one'), seq: 3 }] }), /conflicting durable fact/);
      assert.equal((await runtime.store.outbox.all())[0].intent, 'keep');
      await runtime.store.commit({ deliveries: [{ ...anchor('return', 'one'), seq: 4 }] });
      assert.deepEqual((await runtime.store.answer('return', {})).data, { id: 'one', at: 0 }, 'a genuinely newer positive is allowed');
      await runtime.store.close();
    });
    for (const factory of factories) for (const seeded of [false, true]) await context.test(`${factory.carrier}/sequence-batch-${seeded}`, async () => {
      const principal = `batch-${seeded}`;
      let runtime = new OfflineRuntime({ store: factory }); await runtime.open(principal, true); await runtime.program(packet);
      const accept = async (seq: number, ids: string[], readTime = seq) => ({ op, args: {}, accepted: await runtime.accept(op, {},
        { ...frame(seq, readTime, ids), authority: { principal, authEpoch: 0 } }) });
      await runtime.store.commit({ outbox: { put: [entry('keep')] } });
      if (seeded) await runtime.commitMany([await accept(1, ['one'])]);
      await runtime.commitMany([await accept(2, ['one']), await accept(3, [])]);
      assert.equal((await runtime.store.coverage()).rows.length, 0, 'older batch presence cannot mask a newer checked hole');
      assert.deepEqual((await runtime.store.coverage()).evicted, [{ table: 'events', id: 'one' }]);
      await assert.rejects(runtime.store.commit({ deliveries: [{ ...anchor('revert', 'one'), seq: 3 }] }), /conflicting durable fact/);
      await runtime.store.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open(principal, true);
      await runtime.store.commit({ refreshes: [{ op, args: {}, seq: 4, validator: 'a'.repeat(64) }] });
      await assert.rejects(runtime.store.commit({ deliveries: [{ ...anchor('revert', 'one'), seq: 4 }] }), /conflicting durable fact/);
      await runtime.commitMany([await accept(5, []), await accept(6, ['one'])]);
      assert.deepEqual((await runtime.store.answer(op, {})).data, { now: 6, rows: [{ id: 'one', at: 0 }] }, 'later batch positive survives older negative');
      await runtime.commitMany([await accept(8, ['one']), await accept(7, [])]);
      assert.deepEqual((await runtime.store.answer(op, {})).data, { now: 8, rows: [{ id: 'one', at: 0 }] }, 'stale full frame cannot revoke a newer row');
      const before = JSON.stringify((runtime.store as any).state);
      await assert.rejects(runtime.commitMany([await accept(9, ['one']), await accept(9, [], 10)]), /conflicting durable fact/);
      assert.equal(JSON.stringify((runtime.store as any).state), before, 'same-seq newer-clock Exhausted contradiction cannot hide behind batch union');
      await assert.rejects(runtime.commitMany([await accept(9, ['one']), await accept(9, [], 10), await accept(10, ['one'])]), /conflicting durable fact/);
      assert.equal(JSON.stringify((runtime.store as any).state), before, 'a later positive cannot erase an earlier applicable same-seq contradiction');
      const conditional = { op, args: {}, accepted: await runtime.accept(op, {}, { state: 'unchanged', seq: 9, validator: 'a'.repeat(64) }) };
      await assert.rejects(runtime.commitMany([conditional, await accept(9, [], 10), await accept(10, ['one'])]), /conflicting durable fact/);
      assert.equal(JSON.stringify((runtime.store as any).state), before, 'conditional immutable proof participates at its own sequence');
      await assert.rejects(runtime.commitMany([await accept(8, [], 9), await accept(10, ['one'])]), /conflicting durable fact/);
      assert.equal(JSON.stringify((runtime.store as any).state), before, 'pre-swap positive8 remains an equality constraint after preflight advances to10');
      await assert.rejects(runtime.store.commit({ tombstones: [{ table: 'events', id: 'one', seq: 8 }],
        deliveries: [{ ...anchor('later-positive', 'one'), seq: 10 }] }), /conflicting durable fact/);
      assert.equal(JSON.stringify((runtime.store as any).state), before, 'explicit tombstone is checked before a later row suppresses final eviction');
      await runtime.store.commit({ tombstones: [{ table: 'events', id: 'one', seq: 9 }],
        deliveries: [{ ...anchor('later-positive', 'one'), seq: 10 }] });
      assert.deepEqual((await runtime.store.answer('later-positive', {})).data, { id: 'one', at: 0 });
      const changed = frame(12, 12, ['one']); changed.rows[0].row.at = 12;
      await runtime.commitMany([
        { op, args: {}, accepted: await runtime.accept(op, {}, { ...changed, authority: { principal, authEpoch: 0 } }) },
        await accept(10, [], 11),
      ]);
      assert.deepEqual((await runtime.store.answer(op, {})).data, { now: 12, rows: [{ id: 'one', at: 12 }] }, 'a genuinely stale full never enters equality preflight');
      assert.equal((await runtime.store.outbox.all())[0].intent, 'keep');
      await runtime.store.close();
    });
    for (const factory of factories) await context.test(`${factory.carrier}/replacement-proof-custody`, async () => {
      const runtime = new OfflineRuntime({ store: factory }); await runtime.open('replacement', true); await runtime.program(packet);
      const op = 'clock.read';
      const varying = (seq: number, readTime: number, ids: string[]) => {
        const value = frame(seq, readTime, ids); value.planHash = packet.programs[op].planHash;
        value.authority.principal = 'replacement'; value.receipt.ranges[0].lt = readTime; return value;
      };
      const accept = async (value: any) => ({ op, args: {}, accepted: await runtime.accept(op, {}, value) });
      await runtime.commitMany([await accept(varying(1, 2, ['one']))]);
      await runtime.commitMany([await accept(varying(2, 2, [])), await accept(varying(3, -1, []))]);
      await assert.rejects(runtime.store.commit({ deliveries: [{ ...anchor('old-revert', 'one'), seq: 2 }] }), /conflicting durable fact/);
      await runtime.store.commit({ refreshes: [{ op, args: {}, seq: 4, validator: 'a'.repeat(64) }] });
      await runtime.store.commit({ deliveries: [{ ...anchor('outside-new-extent', 'one'), seq: 4 }] });
      assert.deepEqual((await runtime.store.answer('outside-new-extent', {})).data, { id: 'one', at: 0 },
        'a replaced extent cannot donate its negative proof to the newer answer');
      await runtime.store.close();
    });
    for (const factory of factories) for (const point of [false,true]) await context.test(`${factory.carrier}/first-hole-enrollment-${point}`, async () => {
      const principal = `first-hole-${point}`;
      const runtime = new OfflineRuntime({ store: factory }); await runtime.open(principal, true); await runtime.program(packet);
      const old = { ...anchor('ordinary', 'one'), receipt: { ...receipt(), ranges: point ? [] : [range] } };
      await runtime.store.commit({ deliveries: [old], outbox: { put: [entry('keep')] } });
      const before = JSON.stringify((runtime.store as any).state);
      // The first timed assertion is a checked absence. A same-swap ordinary
      // conditional has no immutable body proof and must request a full read.
      const accepted = await runtime.accept(op, {}, { ...frame(2, 1, []), authority: { principal, authEpoch: 0 } });
      await assert.rejects(runtime.commitMany([
        { op: 'ordinary', args: {}, accepted: await runtime.accept('ordinary', {}, { state: 'unchanged', seq: 3, validator: old.validator }) },
        { op, args: {}, accepted },
      ]), /requires immutable/);
      assert.equal(JSON.stringify((runtime.store as any).state), before);
      const ordinaryFull = async (seq: number) => {
        const { readTime, ...value } = frame(seq, 0, ['one']);
        return runtime.accept('ordinary-positive', {}, { ...value, authority: { principal, authEpoch: 0 },
          data: eventRef('one'), receipt: receipt(), planHash: 'b'.repeat(64) });
      };
      await assert.rejects(runtime.commitMany([
        { op: 'ordinary-positive', args: {}, accepted: await ordinaryFull(2) }, { op, args: {}, accepted },
      ]), /conflicting durable fact/);
      assert.equal(JSON.stringify((runtime.store as any).state), before, 'newly enrolled negative constrains earlier ordinary full proof at the same seq');
      await runtime.commitMany([
        { op, args: {}, accepted }, { op: 'ordinary-positive', args: {}, accepted: await ordinaryFull(3) },
      ]);
      assert.deepEqual((await runtime.store.answer('ordinary-positive', {})).data, { id: 'one', at: 0 });
      assert.equal((await runtime.store.answer('ordinary-positive', {})).needsFactProofs, undefined, 'the raw full body supplies its own newly enrolled custody');
      await runtime.store.commit({ refreshes: [{ op: 'ordinary-positive', args: {}, seq: 4, validator: 'a'.repeat(64) }] });
      await assert.rejects(runtime.store.commit({ tombstones: [{ table: 'events', id: 'one', seq: 4 }] }), /conflicting durable fact/);
      assert.equal((await runtime.store.outbox.all())[0].intent, 'keep');
      await runtime.store.close();
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
