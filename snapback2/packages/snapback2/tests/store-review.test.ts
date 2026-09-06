import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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
  // Actual native provisional03 v4 certificates; these envelopes/validators are synthetic controls.
  const fixtures = JSON.parse(await readFile(new URL("../../evaluator/src/test-search-v4-fixtures.json", import.meta.url), "utf8"));
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
  const { clock: packet } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v4-fixtures.json', import.meta.url), 'utf8'));
  // Actual native v4 clock IR/certificate; the no-row envelopes below are synthetic signed-clock controls.
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
  // A valid cold carrier at the exact provisional logical-slot boundary; no discarded guard stands in for admission.
  const saturate = () => { saved.factGuards = Object.fromEntries(Array.from({ length: 524288 }, (_, i) =>
    [JSON.stringify(['row', 'messages', { Id: `old${i}` }]), { seq: 1, digest: 'a'.repeat(64) }])); saved.factSlots = 524288; };
  saturate();
  let runtime = new OfflineRuntime({ store: factory }); await runtime.open('clock', true);
  const envelope = { protocol: 1, ...facts, planHash: 'b'.repeat(64), authority: { principal: 'clock', authEpoch: 0 },
    state: 'complete', data: [ref('fresh')], rows: [row('fresh')], receipt: receipt(), next: null, seq: 2, readTime: 1, validator: 'c'.repeat(64) };
  delete envelope.authEpoch;
  assert.equal(await runtime.commit('timed', {}, await runtime.accept('timed', {}, envelope)), true);
  assert.equal(runtime.resetNeeded, true); assert.equal((await runtime.store.outbox.all())[0].intent, 'keep');
  assert.equal(Object.keys(saved.factGuards).length, 0);
  await runtime.store.close(); saturate();
  runtime = new OfflineRuntime({ store: factory }); await runtime.open('clock', true);
  await assert.rejects(runtime.commit('timed', {}, await runtime.accept('timed', {}, envelope)), /still exceeds its slot budget/);
  assert.equal(Object.keys(saved.factGuards).length, 524288, 'second failure preserves the existing recovery state');
  assert.equal((await runtime.store.outbox.all())[0].intent, 'keep'); await runtime.store.close();
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
      assert.equal(Object.keys((runtime.store as any).state.factGuards).length, 0, 'failed preflight rolls back every prospective guard');
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
