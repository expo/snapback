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

const range = (rowIds: string[], stop = "Exhausted", extra = {}) => ({ site: "list", table: "messages",
  index: "byName", prefix: [], order: "Asc", take: 2, after: null, before: null,
  gt: null, gte: null, lt: null, lte: null, ruleHash: "rule", rowIds, stop, absence: false, ...extra });

async function seedHistory(store: any) {
  await store.open("alice");
  await store.commit({ deliveries: Array.from({ length: 20 }, (_, page) => ({
    ...delivery(`page${page}`, Array.from({ length: 50 }, (_, at) => `m${page * 50 + at}`), 1),
    rows: Array.from({ length: 50 }, (_, at) => row(`m${page * 50 + at}`, "retained-body".repeat(40))),
  })) });
}

const clocked = (op: string, ids: string[], seq: number, readTime: number, extra = {}) => ({
  ...delivery(op, ids, seq), readTime, clockPlanHash: 'c'.repeat(64), validator: 'd'.repeat(64), ...extra,
});

test('unchanged native26c9 movement, revocation and halo deliveries survive public admission on every carrier', async context => {
  const { nativeR8: native } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  const { root, factories } = await carriers();
  try {
    for (const factory of factories) for (const cold of [false, true]) await context.test(`${factory.carrier}/${cold}`, async () => {
      for (const between of [false, true]) for (const reverse of [false, true]) {
        const witness = native.movement, principal = witness.first.authority.principal;
        let runtime = new OfflineRuntime({ store: factory }); await runtime.store.wipe(principal);
        await runtime.open(principal, true); await runtime.program(witness.packet);
        const commit = async (op: string, frame: any) => runtime.commit(op, {}, await runtime.accept(op, {}, frame));
        const reopen = async () => { await runtime.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open(principal, true); };
        await runtime.store.commit({ outbox: { put: [entry('keep')] } });
        await commit('clock.bounded', witness.first); if (cold) await reopen();
        const moves = [['clock.bounded', witness.hole], ['clock.read', witness.moved]];
        if (reverse) moves.reverse();
        await commit(moves[0][0], moves[0][1]); if (between) await reopen(); await commit(moves[1][0], moves[1][1]);
        assert.deepEqual((await runtime.store.coverage()).rows, witness.moved.rows);
        assert.equal((await runtime.store.answer('clock.read', {})).data.rows[0].at, 5);
        assert.deepEqual((await runtime.store.coverage()).evicted, []);
        assert.equal((await runtime.store.outbox.all())[0].intent, 'keep'); await runtime.close();
      }
      for (const kind of ['revocation', 'halo']) {
        const witness = native[kind], principal = witness.first.authority.principal;
        const args = kind === 'revocation' ? { id: 'one' } : {}, op = kind === 'revocation' ? 'timed' : 'clock.fixed';
        const anchor = kind === 'revocation' ? 'anchor' : 'clock.read';
        let runtime = new OfflineRuntime({ store: factory }); await runtime.store.wipe(principal);
        await runtime.open(principal, true); await runtime.program(witness.program);
        const commit = async (name: string, frame: any) => runtime.commit(name, args, await runtime.accept(name, args, frame));
        await commit(anchor, witness.anchor); await commit(op, witness.first);
        if (cold) { await runtime.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open(principal, true); }
        await commit(op, witness.last);
        assert.deepEqual((await runtime.store.coverage()).rows, witness.last.rows);
        for (const name of [op, anchor]) {
          const result = await runtime.twin.evaluate(name, args);
          assert(!JSON.stringify(result).includes('secret'), 'revoked body cannot remain complete or partial data');
          if (kind === 'revocation') assert.equal(result.data.row, null);
        }
        if (kind === 'halo') assert.equal((await runtime.twin.evaluate(op, args)).state, 'complete');
        assert.equal((await runtime.store.coverage()).evicted[0].id, kind === 'halo' ? 'halo' : 'one');
        await runtime.close();
      }
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a prior halo participates in same-sequence conflicts and immutable conditional extent custody', async context => {
  const { nativeR8: { halo } } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  // This adversarial derivative is synthetic. The preceding native test uses every frame unchanged.
  const contradiction = { ...halo.last, seq: halo.first.seq };
  const { root, factories } = await carriers();
  try {
    for (const factory of factories) await context.test(factory.carrier, async () => {
      const principal = halo.first.authority.principal;
      let runtime = new OfflineRuntime({ store: factory }); await runtime.store.wipe(principal);
      await runtime.open(principal, true); await runtime.program(halo.program);
      const commit = async (frame: any) => runtime.commit('clock.fixed', {}, await runtime.accept('clock.fixed', {}, frame));
      await commit(halo.first); await runtime.store.commit({ outbox: { put: [entry('keep')] } });
      for (const cold of [false, true]) {
        if (cold) { await runtime.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open(principal, true); }
        const before = JSON.stringify((runtime.store as any).state);
        await assert.rejects(commit(contradiction), /conflicting durable fact/);
        assert.equal(JSON.stringify((runtime.store as any).state), before);
      }
      await commit(halo.last);
      await runtime.store.commit({ refreshes: [{ op: 'clock.fixed', args: {}, seq: 3, validator: halo.last.validator }] });
      await runtime.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open(principal, true);
      const before = JSON.stringify((runtime.store as any).state);
      const positive = { ...halo.anchor, seq: 3, readTime: halo.last.readTime + 1 };
      await assert.rejects(runtime.commit('clock.read', {}, await runtime.accept('clock.read', {}, positive)), /conflicting durable fact/);
      assert.equal(JSON.stringify((runtime.store as any).state), before);
      assert.equal((await runtime.store.outbox.all())[0].intent, 'keep'); await runtime.close();
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ambiguous experimental fact custody resets atomically on cold open while ordinary history and queued intents survive', async () => {
  for (const version of [undefined,2,3,4]) for (const timed of [false, true]) for (const sealed of [false, true]) {
    let saved: any, fail = false;
    const factory = () => new PersistentRangeStore({ carrier: 'memory', open: async () => structuredClone(saved),
      replace: async state => { if (fail) throw new Error('injected reset failure'); saved = structuredClone(state); }, close() {}, wipe: async () => {} });
    let store = factory(); await store.open('legacy');
    await store.commit({ facts: { generation: 'e'.repeat(64), schemaHash: 'f'.repeat(64), authEpoch: 0 },
      deliveries: [timed ? clocked('read', ['one'], 1, 1) : delivery('read', ['one'], 1)], outbox: { put: [entry('keep')] } });
    if (sealed) await store.seal(); await store.close();
    delete saved.factFormat; delete saved.factImages; delete saved.factExtents; delete saved.extentGuards; delete saved.extentNegative;
    if (version !== undefined) { saved.factFormat = version; saved.factExtents = { old: { condition: { legacy: true } } }; }
    const original = JSON.stringify(saved);
    if (timed || version !== undefined) {
      fail = true; store = factory(); await assert.rejects(store.open('legacy'), /injected reset failure/);
      assert.equal(JSON.stringify(saved), original, 'failed format reset leaves durable custody and outbox untouched');
      fail = false; await store.open('legacy'); await store.close();
    }
    store = factory(); await store.open('legacy');
    if (sealed) { await assert.rejects(store.outbox.all(), /sealed/); await store.unseal(); }
    assert.equal((await store.outbox.all())[0].intent, 'keep');
    if (timed || version !== undefined) {
      assert.equal(await store.answer('read', {}), undefined);
      assert.equal((await store.coverage()).superseded.generation, 'e'.repeat(64));
      assert.equal(saved.factFormat, 5); assert.equal(saved.factSlots, 0);
    } else assert.deepEqual((await store.answer('read', {})).data, [{ id: 'one', body: 'one' }]);
    await store.close();
  }
});

test('carrier projection preserves a missing fact-format marker so experimental custody resets and published ordinary history survives', async context => {
  const { root,factories } = await carriers();
  try {
    for (const factory of factories) for (const marker of [undefined,0,2,3,4]) for (const timed of [false,true]) for (const sealed of [false,true])
      await context.test(`${factory.carrier}/${marker ?? 'missing'}/${timed}/${sealed}`, async () => {
      const principal = `legacy-projection-${marker}-${timed}-${sealed}`;
      let store = factory(); await store.open(principal);
      await store.commit({ deliveries: [timed ? clocked('read', ['one'], 1, 1) : delivery('read', ['one'], 1)], outbox: { put: [entry('keep')] } });
      if (sealed) await store.seal(); await store.close();
      const backend = (factory() as any).backend, saved = await backend.open(principal);
      const key = JSON.stringify(['row','messages',{ Id: 'one' }]), digest = saved.rowFacts['messages\0one']?.[1];
      delete saved.factFormat;
      if (marker !== undefined) saved.factFormat = marker;
      if (marker !== 4) {
        for (const field of ['rowFacts','verdictFacts','factImages','factExtents','extentGuards','extentNegative']) delete saved[field];
        saved.factGuards = timed ? { [key]: { seq: 1,digest } } : {};
        saved.factSlots = timed ? 2 : 0;
        for (const answer of Object.values<any>(saved.answers)) {
          delete answer.rowProofs; delete answer.verdictProofs;
          if (timed) answer.factProofs = [[key,digest]];
        }
      }
      await backend.replace(saved,{ put: [],remove: [] }); await backend.close();
      store = factory(); await store.open(principal);
      try {
        if (sealed) { await assert.rejects(store.outbox.all(), /sealed/); await store.unseal(); }
        assert.equal((await store.outbox.all())[0].intent, 'keep');
        if (timed || marker !== undefined) assert.equal(await store.answer('read', {}), undefined, 'a carrier default must not relabel experimental guards as current custody');
        else assert.equal((await store.answer('read', {})).data[0].body, 'one', 'published no-clock history retains its normal behavior');
      } finally { await store.close(); }
    });
  } finally { await rm(root,{ recursive: true,force: true }); }
});

test('close, active wipe and principal switch release carrier indexes and ephemeral schema custody', async () => {
  const { nativeR8: { movement } } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  const partitions = new Map<string, any>(); let current = '';
  const store = new PersistentRangeStore({ carrier: 'memory',
    open: async partition => { current = partition; return structuredClone(partitions.get(partition)); },
    replace: async state => { partitions.set(current, structuredClone(state)); }, close() {}, wipe: async partition => { partitions.delete(partition); } });
  const held = store as any;
  const populate = async () => {
    await store.open('alice');
    await store.commit({ schema: movement.packet.schema, deliveries: [{ ...clocked('read', ['one'], 1, 1),
      rows: movement.first.rows, data: [{ $row: { table: 'events', id: 'one' } }] }], outbox: { put: [entry('keep')] } });
    assert.equal((await store.answer('read', {})).data[0].at, 0);
    assert.ok(held.referenceIndex); assert.ok(held.referenceSchema);
  };
  const released = () => { assert.equal(held.referenceIndex, undefined); assert.equal(held.referenceSchema, undefined); };
  await populate(); const original = JSON.stringify(partitions.get('alice'));
  await store.close(); released();
  assert.equal(JSON.stringify(partitions.get('alice')), original, 'releasing indexes does not discard durable facts or queued work');
  await store.open('alice'); assert.equal((await store.outbox.all())[0].intent, 'keep');
  assert.equal((await store.answer('read', {})).data[0].at, 0, 'same-instance cold open rebuilds from retained custody');
  await populate(); await store.open('bob'); released();
  assert.equal(await store.answer('read', {}), undefined);
  assert.equal(held.referenceIndex, undefined, 'empty principal cannot acquire the previous principal index');
  await populate(); await store.wipe('bob'); assert.ok(held.referenceIndex, 'inactive wipe preserves active ownership');
  await store.wipe('alice'); released(); await store.open('alice');
  assert.equal(await store.answer('read', {}), undefined); assert.deepEqual(await store.outbox.all(), []);
  await store.close(); released();
});

test('global negative guards retain integrity without retaining positive index owners', async () => {
  for (const cold of [false,true]) {
    let saved: any;
    const factory = () => new PersistentRangeStore({ carrier: 'memory', open: async () => structuredClone(saved),
      replace: async state => { saved = structuredClone(state); }, close() {}, wipe: async () => {} });
    let store = factory(); await store.open('negative');
    await store.commit({ deliveries: [clocked('read', ['one'], 1, 1)], outbox: { put: [entry('keep')] } });
    assert.equal((store as any).referenceIndex.guards.size, 1);
    await store.commit({ tombstones: [{ table: 'messages', id: 'one', seq: 2 }] });
    assert.equal((store as any).referenceIndex.guards.size, 0, 'no positive posting owner survives a global negative guard');
    if (cold) { await store.close(); store = factory(); await store.open('negative'); }
    await store.commit({ deliveries: [delivery('empty', [], 2)] });
    assert.equal((store as any).referenceIndex.guards.size, 0, 'cold reconstruction also omits redundant negative owners');
    const before = JSON.stringify(saved);
    await assert.rejects(store.commit({ deliveries: [clocked('read', ['one'], 2, 2)] }), /conflicting durable fact/);
    assert.equal(JSON.stringify(saved), before, 'same-sequence global absence remains authoritative and atomic');
    await store.commit({ deliveries: [clocked('read', ['one'], 3, 3)] });
    assert.equal((store as any).referenceIndex.guards.size, 1);
    assert.equal((await store.answer('read', {})).data[0].body, 'one');
    assert.equal((await store.outbox.all())[0].intent, 'keep'); await store.close();
  }
});

test('sequence-zero primary absence and positive proofs remain explicit across cold and conditional custody', async () => {
  for (const cold of [false,true]) {
    let saved: any;
    const factory = () => new PersistentRangeStore({ carrier: 'memory', open: async () => structuredClone(saved),
      replace: async state => { saved = structuredClone(state); }, close() {}, wipe: async () => {} });
    let store = factory(); await store.open('zero');
    const gone = { ...delivery('gone', [], 0), validator: 'a'.repeat(64), receipt: { ...receipt(), absences: [['messages','byId',['one']]] } };
    await store.commit({ deliveries: [gone,clocked('positive', ['two'], 0, 0)], outbox: { put: [entry('keep')] } });
    assert.equal(saved.rowFacts['messages\0one'], 0);
    assert.equal(saved.rowFacts['messages\0two'][0], 0);
    if (cold) { await store.close(); store = factory(); await store.open('zero'); }
    const before = JSON.stringify(saved);
    await assert.rejects(store.commit({ deliveries: [clocked('inside', ['one'], 0, 0)] }), /conflicting durable fact/);
    await assert.rejects(store.commit({ deliveries: [{ ...gone, op: 'contrary', receipt: { ...receipt(), absences: [['messages','byId',['two']]] } }] }), /conflicting durable fact/);
    assert.equal(JSON.stringify(saved), before, 'zero-sequence contradictions leave both fact kinds and outbox atomic');
    await store.commit({ refreshes: [{ op: 'gone',args: {},seq: 1,validator: gone.validator }] });
    assert.equal(saved.rowFacts['messages\0one'], 1, 'a null answer proof advances the explicit absence');
    await assert.rejects(store.commit({ deliveries: [clocked('inside', ['one'], 1, 1)] }), /conflicting durable fact/);
    await store.commit({ deliveries: [clocked('inside', ['one'], 2, 2)] });
    assert.equal(saved.rowFacts['messages\0one'][0], 2);
    assert.equal((await store.answer('inside', {})).data[0].body, 'one');
    assert.equal((await store.outbox.all())[0].intent, 'keep'); await store.close();
  }
});

test('closed extents retain all-ID consistency after conditional refresh and GC without globalizing nonmembership', async () => {
  const { nativeR8: { movement } } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  for (const cold of [false,true]) for (const reverse of [false,true]) for (const inside of [false,true]) {
    let saved: any;
    const factory = () => new PersistentRangeStore({ carrier: 'memory', open: async () => saved,
      replace: async state => { saved = structuredClone(state); }, close() {}, wipe: async () => {} });
    let runtime = new OfflineRuntime({ store: factory }); const principal = movement.first.authority.principal;
    await runtime.open(principal,true); await runtime.program(movement.packet);
    const admit = async (op: string, frame: any) => runtime.commit(op,{},await runtime.accept(op,{},frame));
    await runtime.store.commit({ outbox: { put: [entry('keep')] } });
    const empty = structuredClone(movement.hole), positive = structuredClone(movement.moved);
    // No historical row with this ID; native-certified program, synthetic all-ID control.
    positive.rows[0].id = positive.rows[0].row.id = 'unknown'; positive.rows[0].row.at = inside ? 0 : 5;
    positive.data.rows[0].$row.id = 'unknown'; positive.receipt.ranges[0].rowIds = ['unknown'];
    const close = () => admit('clock.bounded',empty), arrive = () => admit('clock.read',positive);
    await (reverse ? arrive() : close());
    if (cold) { await runtime.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open(principal,true); }
    const before = JSON.stringify(saved);
    if (inside) {
      await assert.rejects(reverse ? close() : arrive(), /conflicting durable fact/);
      assert.equal(JSON.stringify(saved),before); await runtime.close(); continue;
    }
    await (reverse ? close() : arrive());
    assert.equal((await runtime.store.coverage()).rows[0].row.at,5);
    assert.equal(Object.keys(saved.negative).length,0);
    await runtime.store.commit({ refreshes: [{ op: 'clock.bounded',args: {},seq: 3,validator: empty.validator }] });
    await runtime.store.commit({ dropAnswers: ['clock.bounded\0{}','clock.read\0{}'] });
    assert.equal((await runtime.store.coverage()).rows.length,0,'body GC leaves immutable extent facts');
    if (cold) { await runtime.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open(principal,true); }
    const delayed = structuredClone(positive); delayed.seq = 3; delayed.readTime += 1; delayed.rows[0].row.at = 0;
    await assert.rejects(admit('clock.read',delayed), /conflicting durable fact/);
    delayed.rows[0].row.at = 5; await admit('clock.read',delayed);
    assert.equal((await runtime.store.coverage()).rows[0].row.at,5,'conditional extent cannot become a global absence');
    await runtime.store.commit({ tombstones: [{ table: 'events',id: 'unknown',seq: 4 }] });
    delayed.seq = 4; delayed.readTime += 1;
    await assert.rejects(admit('clock.read',delayed), /conflicting durable fact/);
    assert.equal((await runtime.store.coverage()).rows.length,0);
    assert.equal((await runtime.store.outbox.all())[0].intent,'keep');
    await runtime.store.commit({ resetCoverage: true });
    assert.equal(saved.factSlots,0);
    for (const field of ['rowFacts','verdictFacts','factImages','factExtents','extentGuards','extentNegative']) assert.deepEqual(saved[field],{});
    assert.equal((await runtime.store.outbox.all())[0].intent,'keep'); await runtime.close();
  }
});

test('scoped holes dominate every FIFO overlay state until a compatible authoritative image returns', async () => {
  const { nativeR8: { movement } } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  for (const status of ['queued','sent','committed']) {
    let saved: any;
    const factory = () => new PersistentRangeStore({ carrier:'memory',open:async()=>saved,replace:async s=>{saved=structuredClone(s);},close(){},wipe:async()=>{} });
    let runtime = new OfflineRuntime({store:factory}); const principal = movement.first.authority.principal;
    await runtime.open(principal,true); await runtime.program(movement.packet);
    const admit = async (op: string,frame: any) => runtime.commit(op,{},await runtime.accept(op,{},frame));
    await admit('clock.bounded',movement.first);
    const pending = { ...entry('pending'),state:status,...(status==='committed'?{response:{seq:4}}:{}),trace:{points:[],verdicts:[]} };
    const overlay = {table:'events',id:'one',row:{id:'one',at:9}};
    await runtime.store.commit({outbox:{put:[pending]},overlay:{put:{pending:[overlay]}}});
    const intent = JSON.stringify(await runtime.store.outbox.all());
    await admit('clock.bounded',movement.hole);
    assert.equal(JSON.stringify(await runtime.store.outbox.all()),intent,'scoped omission preserves queued intent custody');
    const rows = async () => (await runtime.twin.evaluate('clock.read',{}))?.data?.rows ?? [];
    assert.deepEqual(await rows(),[],`${status} overlay cannot survive a hole without a base image`);
    await runtime.store.commit({outbox:{put:[{...entry('newer'),issuedSeq:3}]},overlay:{put:{newer:[overlay]}}});
    assert.deepEqual(await rows(),[],'newer full-image prediction alone is not authoritative presence');
    await runtime.close(); runtime = new OfflineRuntime({store:factory}); await runtime.open(principal,true);
    assert.deepEqual(await rows(),[],'hole dominance persists cold');
    await runtime.store.commit({outbox:{remove:['newer']}});
    await admit('clock.read',movement.moved);
    assert.deepEqual((await rows()).map((r:any)=>r.at),[5],'outside authority supersedes only the scoped mask; stale FIFO contribution stays suppressed');
    await runtime.store.commit({tombstones:[{table:'events',id:'one',seq:3}],outbox:{put:[{...entry('after-tombstone'),issuedSeq:4}]},overlay:{put:{'after-tombstone':[overlay]}}});
    assert.deepEqual(await rows(),[],'primary tombstone still dominates a newer prediction');
    await runtime.close();
  }
});

test('a receipt-owned primary absence admits only a later predicted overlay image', async () => {
  const { nativeR8: { movement } } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  for (const proofFirst of [true, false]) {
    let saved: any;
    const factory = () => new PersistentRangeStore({carrier:'memory',open:async()=>saved,replace:async state=>{saved=structuredClone(state);},close(){},wipe:async()=>{}});
    const runtime = new OfflineRuntime({store:factory});
    await runtime.open(movement.first.authority.principal,true); await runtime.program(movement.packet);
    const absent = structuredClone(movement.hole);
    absent.receipt.absences = [['events','byId',['one']]];
    const admit = async () => runtime.commit('clock.bounded',{},await runtime.accept('clock.bounded',{},absent));
    const overlay = async () => runtime.store.commit({outbox:{put:[{...entry('predicted'),predicted:true,issuedSeq:0}]},
      overlay:{put:{predicted:[{table:'events',id:'one',row:{id:'one',at:9}}]}}});
    if (proofFirst) { await admit(); await overlay(); } else { await overlay(); await admit(); }
    const rows = (await runtime.twin.evaluate('clock.read',{}) as any)?.data?.rows ?? [];
    assert.deepEqual(rows.map((row:any)=>row.at),proofFirst?[9]:[],
      'only an intent durably ordered after the receipt may create over its proved absence');
    await runtime.close();
  }
});

test('primary absence admission survives answer custody changes but not later row authority', async () => {
  const { nativeR8: { movement } } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  const setup = async () => {
    let saved: any;
    const factory = () => new PersistentRangeStore({carrier:'memory',open:async()=>saved,replace:async state=>{saved=structuredClone(state);},close(){},wipe:async()=>{}});
    let runtime = new OfflineRuntime({store:factory});
    await runtime.open(movement.first.authority.principal,true); await runtime.program(movement.packet);
    const absent = structuredClone(movement.hole);
    absent.receipt.absences = [['events','byId',['one']]];
    await runtime.commit('clock.bounded',{},await runtime.accept('clock.bounded',{},absent));
    await runtime.store.commit({outbox:{put:[{...entry('predicted'),predicted:true,issuedSeq:0}]},
      overlay:{put:{predicted:[{table:'events',id:'one',row:{id:'one',at:9}}]}}});
    const rows = async () => (await runtime.twin.evaluate('clock.read',{}) as any)?.data?.rows ?? [];
    assert.deepEqual((await rows()).map((row:any)=>row.at),[9]);
    return { factory, rows, runtime: () => runtime, reopen: async () => {
      await runtime.close(); runtime = new OfflineRuntime({store:factory}); await runtime.open(movement.first.authority.principal,true);
    }};
  };
  {
    const state = await setup();
    const equivalent = structuredClone(movement.hole);
    equivalent.readTime += 1; equivalent.receipt.absences = [['events','byId',['one']]];
    await state.runtime().commit('clock.bounded',{},await state.runtime().accept('clock.bounded',{},equivalent));
    assert.deepEqual((await state.rows()).map((row:any)=>row.at),[9],
      'an equivalent timed refresh at the same database seq preserves earlier proof chronology');
    await state.reopen(); assert.deepEqual((await state.rows()).map((row:any)=>row.at),[9],
      'the admission fact survives an equivalent refresh and cold rebuild');
    await state.runtime().close();
  }
  {
    const state = await setup();
    await state.runtime().store.commit({dropAnswers:['clock.bounded\0{}']});
    assert.deepEqual((await state.rows()).map((row:any)=>row.at),[9],
      'answer GC does not discard the exact absence already bound to the durable intent');
    await state.reopen(); assert.deepEqual((await state.rows()).map((row:any)=>row.at),[9],
      'the intent-bound fact survives answer GC and a cold rebuild');
    await state.runtime().close();
  }
  {
    const state = await setup();
    const replacement = structuredClone(movement.hole);
    replacement.seq = 3; replacement.readTime += 1; replacement.receipt.absences = [];
    await state.runtime().commit('clock.bounded',{},await state.runtime().accept('clock.bounded',{},replacement));
    assert.deepEqual((await state.rows()).map((row:any)=>row.at),[9],
      'answer replacement alone does not erase a still-uncontradicted absence held before admission');
    await state.runtime().close();
  }
  {
    const state = await setup();
    await state.runtime().store.commit({tombstones:[{table:'events',id:'one',seq:3}]});
    assert.deepEqual(await state.rows(),[],'a later primary revocation dominates an older receipt and prediction');
    await state.reopen(); assert.deepEqual(await state.rows(),[],'the later revocation remains dominant cold');
    await state.runtime().close();
  }
  {
    const state = await setup();
    const newer = structuredClone(movement.moved);
    newer.seq = 3; newer.readTime += 1;
    await state.runtime().commit('clock.read',{},await state.runtime().accept('clock.read',{},newer));
    assert.deepEqual((await state.rows()).map((row:any)=>row.at),[5],
      'an old absence cannot let an older prediction overwrite a newer authoritative row');
    await state.reopen(); assert.deepEqual((await state.rows()).map((row:any)=>row.at),[5],
      'positive authority removes stale raw absence custody before a cold rebuild');
    await state.runtime().close();
  }
});

test('native-certified Unicode search accepts scope movement in either arrival order and retains exact Q custody cold', async () => {
  const f = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url),'utf8'));
  const operation = f.operations['search.inConversation'], op = operation.program.name;
  const packet = { generation:'e'.repeat(64),schemaHash:operation.certificate.schema_hash,schema:f.schema,programs:{[op]:{
    kind:'query',ir:operation.program,certificate:operation.certificate,planHash:operation.certificate.plan_hash}} };
  for (const reverse of [false,true]) for (const cold of [false,true]) for (const batch of [false,true]) {
    let saved: any;
    const factory = () => new PersistentRangeStore({carrier:'memory',open:async()=>saved,replace:async s=>{saved=structuredClone(s);},close(){},wipe:async()=>{}});
    let runtime = new OfflineRuntime({store:factory}); await runtime.open('viewer',true); await runtime.program(packet);
    const args = (room: string) => ({conversation:room,term:'cafe\u0301',c:null});
    const accepted = async (room: string,seq: number,present: boolean) => {
      const rows = [{table:'memberships',id:`member-${room}`,row:{id:`member-${room}`,conversation:room,principal:'viewer'}},
        ...(present?[{table:'messages',id:'one',row:{id:'one',conversation:room,body:'CAFÉ',caption:null,at:0}}]:[])];
      const envelope = {protocol:1,generation:packet.generation,schemaHash:packet.schemaHash,planHash:operation.certificate.plan_hash,
        authority:{principal:'viewer',authEpoch:0},state:'complete',seq,validator:'a'.repeat(64),next:null,
        data:present?[{$row:{table:'messages',id:'one'}}]:[],rows,receipt:{...receipt(),ranges:[{
          site:'search.inConversation.0',table:'messages',index:'byConversationWords',prefix:[{Scalar:room},{WordPrefix:{contract:'u17-nfc-scf-nfc-wsp-p',source:'cafe\u0301'}}],
          order:'Desc',take:20,after:null,before:null,gt:null,gte:null,lt:null,lte:null,rowIds:present?['one']:[],stop:'Exhausted',absence:false,
          ruleHash:operation.certificate.rule_hashes['messages.read']}]}};
      return {op,args:args(room),accepted:await runtime.accept(op,args(room),envelope)};
    };
    await runtime.commitMany([await accepted('left',1,true)]);
    if(cold){await runtime.close();runtime=new OfflineRuntime({store:factory});await runtime.open('viewer',true);}
    const items=[await accepted('left',2,false),await accepted('right',2,true)];if(reverse)items.reverse();
    if(batch)await runtime.commitMany(items);else{
      await runtime.commitMany([items[0]]);
      if(cold){await runtime.close();runtime=new OfflineRuntime({store:factory});await runtime.open('viewer',true);}
      await runtime.commitMany([items[1]]);
    }
    assert.deepEqual(((await runtime.twin.evaluate(op,args('right')))?.data as any[]).map(row=>row.conversation),['right']);
    assert.deepEqual((await runtime.twin.evaluate(op,args('left')))?.data,[]);
    assert.equal(saved.negative['messages\0one'],undefined);
    // Same certified Q2000 remains independent of optional caption/source widths after persisted extent reuse.
    await assert.rejects(runtime.twin.evaluate(op,{...args('right'),term:'same same'}),/one word/);
    await runtime.close();
  }
});


test('repeated immutable pools preserve receipt isolation, backend rollback and keys-only custody after body collection', async () => {
  const { clock } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  let saved: any, fail = false;
  const factory = () => new PersistentRangeStore({ carrier: 'memory', open: async () => saved,
    replace: async state => { if (fail) throw new Error('publication refused'); saved = structuredClone(state); }, close() {}, wipe: async () => {} });
  let store = factory(); await store.open('isolated');
  // Generic carrier inputs, not native-emitted rows; payload is intentionally unindexed.
  const secret = 'transaction-only-obsolete-payload', rows = ['a','b','halo'].map((id,at) => ({ table: 'events',id,row: { id,at,payload: secret } }));
  const range = { site: 'clock.range',table: 'events',index: 'byAt',prefix: [],order: 'Asc',take: 2,
    after: null,before: null,gt: null,gte: null,lt: null,lte: null,ruleHash: 'a'.repeat(64),rowIds: ['a','b'],haloId: 'halo',stop: 'Limit',absence: false };
  const full = (op: string, seq = 1) => ({ op,args: {},seq,state: 'complete',data: [],rows: structuredClone(rows),
    receipt: { ...receipt(),ranges: [structuredClone(range)] },validator: 'b'.repeat(64),deliveredAt: seq });
  const inputs = [full('one'),full('two')];
  await store.commit({ schema: clock.schema,deliveries: inputs,outbox: { put: [entry('keep')] } });
  const accepted = JSON.stringify(saved), index = (store as any).referenceIndex;
  inputs[0].rows[1].row.at = 999; inputs[0].receipt.ranges[0].rowIds.length = 0;
  const held = await store.answer('one', {});
  assert.deepEqual(held.receipt.ranges[0].heldSuffix,[{ Int: 1 },{ Id: 'b' }]);
  assert.equal(held.receipt.ranges[0].haloId,'halo'); held.receipt.ranges[0].heldSuffix[0].Int = 999;
  assert.equal(JSON.stringify(saved),accepted,'caller mutations cannot change either receipt owner or key pool');
  fail = true;
  await assert.rejects(store.commit({ deliveries: [full('one',2)],refreshes: [{ op: 'two',args: {},seq: 2,validator: 'b'.repeat(64) }],
    outbox: { remove: ['keep'] } }), /publication refused/);
  assert.equal(JSON.stringify(saved),accepted); assert.equal(JSON.stringify((store as any).state),accepted);
  assert.equal((store as any).referenceIndex,index,'failed publication preserves the prior maintained index');
  fail = false;
  await store.commit({ refreshes: [{ op: 'one',args: {},seq: 2,validator: 'b'.repeat(64),deliveredAt: 2 }] });
  await store.close(); store = factory(); await store.open('isolated');
  const loaded = saved; loaded.answers['one\0{}'].receipt.ranges[0].rowIds.length = 0;
  assert.deepEqual((await store.answer('one',{})).receipt.ranges[0].rowIds,['a','b'],'arbitrary backend loaded JSON is isolated');
  await store.commit({ schema: clock.schema,dropAnswers: ['one\0{}','two\0{}'] });
  assert.equal((await store.coverage()).rows.length,0);
  assert(Object.keys(saved.factImages).length > 0,'exact keys remain owned by durable guards');
  assert(Object.keys(saved.factExtents).length > 0,'closed extent custody survives body GC');
  const visited = new Set<object>();
  const reachable = (value: any): boolean => {
    if (typeof value === 'string') return value.includes(secret);
    if (!value || typeof value !== 'object' || visited.has(value)) return false;
    visited.add(value);
    return (value instanceof Map ? [...value].flat() : value instanceof Set ? [...value] : Object.values(value)).some(reachable);
  };
  assert.equal(reachable(store),false,'no reachable retained carrier object owns the obsolete body after all row owners leave');
  assert(!JSON.stringify(saved).includes(secret)); assert.equal(saved.factFormat,5);
  assert.equal((await store.outbox.all())[0].intent,'keep'); await store.close();
});

test('repeated certified frames cannot hide an earlier conflicting image behind a later valid version', async () => {
  const { nativeR8: { movement } } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  for (const reverse of [false,true]) {
    let saved: any;
    const factory = () => new PersistentRangeStore({ carrier: 'memory',open: async () => saved,
      replace: async state => { saved = structuredClone(state); },close() {},wipe: async () => {} });
    const runtime = new OfflineRuntime({ store: factory }); await runtime.open(movement.first.authority.principal,true);
    await runtime.program(movement.packet); await runtime.store.commit({ outbox: { put: [entry('keep')] } });
    const item = async (op: string,frame: any) => ({ op,args: {},accepted: await runtime.accept(op,{},frame) });
    await runtime.commitMany([await item('clock.bounded',movement.first)]);
    const before = JSON.stringify(saved), snapshot = JSON.stringify(await runtime.store.coverage());
    // Certified issuing programs, synthetic adversarial transport frames. Different
    // operations keep the two seq1 assertions applicable in either batch order.
    const hole = { ...movement.hole,seq: movement.first.seq,readTime: movement.first.readTime + 1 };
    const early = { ...movement.moved,seq: movement.first.seq,rows: movement.first.rows,data: movement.first.data };
    const pairs = [await item('clock.bounded',hole),await item('clock.read',early)]; if (reverse) pairs.reverse();
    pairs.push(await item('clock.read',movement.moved));
    await assert.rejects(runtime.commitMany(pairs),/conflicting durable fact/);
    assert.equal(JSON.stringify(saved),before); assert.equal(JSON.stringify(await runtime.store.coverage()),snapshot);
    assert.equal((await runtime.store.outbox.all())[0].intent,'keep'); await runtime.close();
  }
});


test('carrier preflight preserves the first source refusal and skips stale ordinary fact payloads', async () => {
  const { clock } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  let saved: any;
  const store = new PersistentRangeStore({ carrier: 'memory',open: async () => saved,
    replace: async state => { saved = structuredClone(state); },close() {},wipe: async () => {} });
  await store.open('ordering'); await store.commit({ deliveries: [delivery('held',[],2)],outbox: { put: [entry('keep')] } });
  // Stale ordinary frames never acquired authority; their unrelated fact payload is not admitted.
  await store.commit({ deliveries: [{ ...delivery('held',[],1),receipt: { ...receipt(),verdicts: [null] } }] });
  const schema = structuredClone(clock.schema), table = schema.tables.events;
  table.columns.payload = { Text: { max: 2000 } };
  table.indexes.badWords = { components: [{ WordPrefixes: { fields: ['payload'] } },{ Column: 'id' }] };
  const rows = [{ table: 'events',id: 'a',row: { id: 'a',at: 0,payload: 'valid' } },
    { table: 'events',id: 'b',row: { id: 'b',at: 1,payload: 123 } }];
  const before = JSON.stringify(saved);
  await assert.rejects(store.commit({ schema,deliveries: [{ ...delivery('invalid',[],3),rows }],outbox: { remove: ['keep'] } }),
    error => error.code === 'E_SCHEMA','invalid schema at the first image precedes the later malformed source');
  assert.equal(JSON.stringify(saved),before); assert.equal(JSON.stringify((store as any).state),before);
  assert.equal((await store.outbox.all())[0].intent,'keep'); await store.close();
});

test('typed full cursor bounds refuse before empty or populated carrier and checked-runtime publication', async context => {
  const { nativeR8: { halo } } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  context.mock.method(Date,'now',() => halo.last.readTime + 1000);
  // Native schema/program; malformed transport derivatives are synthetic, never native-emitted.
  for (const populated of [false,true]) for (const direct of [false,true]) {
    let saved: any;
    const factory = () => new PersistentRangeStore({ carrier: 'json',open: async () => saved,
      replace: async state => { saved = JSON.parse(JSON.stringify(state)); },close() {},wipe: async () => {} });
    let runtime = new OfflineRuntime({ store: factory }); await runtime.open(halo.first.authority.principal,true); await runtime.program(halo.program);
    if (populated) await runtime.commit('clock.fixed',{},await runtime.accept('clock.fixed',{},halo.first));
    await runtime.store.commit({ outbox: { put: [entry('keep')] } });
    const before = JSON.stringify(saved), snapshot = JSON.stringify(await runtime.store.coverage()), slots = saved.factSlots;
    const localBefore = await runtime.twin.evaluate('clock.fixed',{});
    const internalBefore = JSON.stringify((runtime.store as any).state);
    for (const boundary of ['after','before']) for (const bound of [0,[0],[0,'edge','extra'],['wrong','edge'],[0,7]]) {
      const frame = structuredClone(halo.first); frame.seq++; frame.readTime++; frame.state = 'complete'; frame.data.rows = []; frame.rows = [];
      const range = frame.receipt.ranges[0]; range.rowIds = []; delete range.haloId; range.stop = 'Exhausted'; range[boundary] = bound;
      const commit = () => direct ? runtime.store.commit({ schema: halo.program.schema,deliveries: [{ op: 'clock.fixed',args: {},seq: frame.seq,state: frame.state,
        data: frame.data,rows: [],receipt: frame.receipt,receiptEvidence: frame.receipt,validator: frame.validator,
        readTime: frame.readTime,clockPlanHash: frame.planHash }],outbox: { remove: ['keep'] } })
        : runtime.accept('clock.fixed',{},frame).then(accepted => runtime.commit('clock.fixed',{},accepted));
      await assert.rejects(commit, error => bound === 0 || Array.isArray(bound) && bound.length === 1
        ? error.code === 'E_TYPE' && error.message.includes('suffix width')
        : error.name === 'DeliveryEnvelopeDecodeError',JSON.stringify({ populated,direct,boundary,bound }));
      assert.equal(JSON.stringify(saved),before); assert.equal(JSON.stringify((runtime.store as any).state),internalBefore);
      assert.equal(JSON.stringify(await runtime.store.coverage()),snapshot); assert.equal(saved.factSlots,slots);
      assert.deepEqual(await runtime.twin.evaluate('clock.fixed',{}),localBefore,'warm rows/indexes/authority survive refusal');
      assert.equal((await runtime.store.outbox.all())[0].intent,'keep');
    }
    await runtime.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open(halo.first.authority.principal,true);
    assert.equal(JSON.stringify(await runtime.store.coverage()),snapshot,'cold state never contains the refused bound');
    if (populated) assert.equal((await runtime.twin.evaluate('clock.fixed',{})).state,'capped');
    await runtime.close();
  }
  // The full Time/Id tuple is valid; it covers its own extent, not the issuing query's unbounded head.
  for (const boundary of ['after','before']) {
    let saved: any; const runtime = new OfflineRuntime({ store: () => new PersistentRangeStore({ carrier: 'json',open: async () => saved,
      replace: async state => { saved = JSON.parse(JSON.stringify(state)); },close() {},wipe: async () => {} }) });
    await runtime.open(halo.first.authority.principal,true); await runtime.program(halo.program);
    const frame = structuredClone(halo.first); frame.state = 'complete'; frame.data.rows = []; frame.rows = [];
    const range = frame.receipt.ranges[0]; range.rowIds = []; delete range.haloId; range.stop = 'Exhausted'; range[boundary] = [0,'edge'];
    await runtime.commit('clock.fixed',{},await runtime.accept('clock.fixed',{},frame));
    assert.equal((await runtime.twin.evaluate('clock.fixed',{})).state,'partial'); await runtime.close();
  }
});

test('Limit replacement values retain a capped stop through overlays until an actual native Exhausted receipt', async () => {
  const { nativeR8: { halo } } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  for (const removed of [['r0'],['halo'],['r0','halo']]) {
    let saved: any; const factory = () => new PersistentRangeStore({ carrier: 'json',open: async () => saved,
      replace: async state => { saved = JSON.parse(JSON.stringify(state)); },close() {},wipe: async () => {} });
    let runtime = new OfflineRuntime({ store: factory }); await runtime.open(halo.first.authority.principal,true); await runtime.program(halo.program);
    await runtime.commit('clock.fixed',{},await runtime.accept('clock.fixed',{},halo.first));
    const original = await runtime.twin.evaluate('clock.fixed',{}); assert.equal(original.state,'capped');
    for (const id of removed) {
      const prediction = await runtime.twin.predict('remove',{ id },[]); assert.equal(prediction.predicted,true);
      // Actual Twin prediction, synthetic queued carrier entry; no public grant-admission claim.
      await runtime.store.commit({ outbox: { put: [{ ...entry(id),op: 'remove',args: { id },count: 0,predicted: true,trace: prediction.trace }] },overlay: { put: { [id]: prediction.overlay } } });
    }
    const ids = [...halo.first.receipt.ranges[0].rowIds,halo.first.receipt.ranges[0].haloId].filter(id => !removed.includes(id)).slice(0,10);
    for (const cold of [false,true]) {
      if (cold) { await runtime.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open(halo.first.authority.principal,true); }
      const local = await runtime.twin.evaluate('clock.fixed',{});
      assert.equal(local.state,removed.length === 1 ? 'capped' : 'partial'); assert.deepEqual(local.data.rows.map(r => r.id),ids);
      // A compatible unheld row at11 is beyond these exact values, but prevents an exhaustion assertion.
      assert.notEqual(local.state,'complete'); assert.equal(saved.answers['clock.fixed\0{}'].receipt.ranges[0].stop,'Limit');
    }
    await runtime.store.commit({ outbox: { put: removed.map(id => ({ ...entry(id),op: 'remove',state: 'rejected' })) } });
    assert.deepEqual((await runtime.twin.evaluate('clock.fixed',{})).data.rows,original.data.rows,'rejected FIFO contributions restore the base page');
    await runtime.commit('clock.fixed',{},await runtime.accept('clock.fixed',{},halo.last));
    assert.equal((await runtime.twin.evaluate('clock.fixed',{})).state,'complete','unchanged native26c9 seq2 Exhausted establishes completeness');
    await runtime.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open(halo.first.authority.principal,true);
    assert.equal((await runtime.twin.evaluate('clock.fixed',{})).state,'complete'); await runtime.close();
  }
});

test('cold coverage keeps the issuing keys after later authenticated movement without a replacement page', async context => {
  const { nativeR8: { halo } } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  context.mock.method(Date,'now',() => halo.last.readTime + 1000);
  for (const moved of [[],['r9'],['r8','r9'],['halo']]) {
    let saved: any; const factory = () => new PersistentRangeStore({ carrier: 'json',open: async () => saved,
      replace: async state => { saved = JSON.parse(JSON.stringify(state)); },close() {},wipe: async () => {} });
    let runtime = new OfflineRuntime({ store: factory }); await runtime.open(halo.first.authority.principal,true); await runtime.program(halo.program);
    await runtime.commit('clock.fixed',{},await runtime.accept('clock.fixed',{},halo.first)); await runtime.twin.evaluate('clock.fixed',{});
    await runtime.store.commit({ outbox: { put: [entry('keep')] } });
    const proof = structuredClone(saved.answers['clock.fixed\0{}'].rowProofs), oldImageKeys = Object.keys(saved.factImages);
    // Real checked public path, synthetic later frame with the actual clock.read identity, not native-emitted movement.
    const frame = structuredClone(halo.first); frame.planHash = halo.program.programs['clock.read'].planHash; frame.seq++; frame.readTime++;
    frame.validator = 'b'.repeat(64); frame.receipt = receipt(); frame.rows = frame.rows.filter(r => moved.includes(r.id)).map((r,i) => ({ ...r,row: { ...r.row,at: 100 + i } }));
    frame.data = { now: frame.readTime,rows: frame.rows.map(r => ({ $row: { table: r.table,id: r.id } })) };
    await runtime.commit('clock.read',{},await runtime.accept('clock.read',{},frame));
    assert.deepEqual(saved.answers['clock.fixed\0{}'].rowProofs,proof); assert(oldImageKeys.every(key => saved.factImages[key]),'answer ownership retains old immutable keys');
    const expected = moved.length > 1 ? 'partial' : 'capped';
    for (const cold of [false,true]) {
      if (cold) { await runtime.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open(halo.first.authority.principal,true); }
      const local = await runtime.twin.evaluate('clock.fixed',{}); assert.equal(local.state,expected);
      if (moved.length > 1) assert.equal(local.data.rows.at(-1).at,100,'this candidate cannot exclude a compatible unheld row at11');
    }
    const before = JSON.stringify(saved), prior = JSON.stringify(await runtime.twin.evaluate('clock.fixed',{}));
    const conflict = structuredClone(frame); conflict.rows.forEach(r => { r.row.at++; });
    if (moved.length) await assert.rejects(runtime.commit('clock.read',{},await runtime.accept('clock.read',{},conflict)),/conflicting/);
    assert.equal(JSON.stringify(saved),before); assert.equal(JSON.stringify(await runtime.twin.evaluate('clock.fixed',{})),prior);
    await runtime.store.commit({ dropAnswers: ['clock.fixed\0{}','clock.read\0{}'] });
    assert.equal((await runtime.store.coverage()).rows.length,0); assert.equal((await runtime.store.outbox.all())[0].intent,'keep');
    for (const id of moved) assert(!saved.factImages[`events\0${proof[`events\0${id}`]}`],'obsolete image keys reclaim after final owner and newer guard');
    await runtime.close();
  }
});


test('delayed FULL replaces every interior issuing position even when newer current bodies and endpoints are unchanged', async context => {
  const { nativeR8: { halo } } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  context.mock.method(Date,'now',() => halo.first.readTime + 1000);
  let saved: any; const factory = () => new PersistentRangeStore({ carrier: 'json',open: async () => saved,
    replace: async state => { saved = JSON.parse(JSON.stringify(state)); },close() {},wipe: async () => {} });
  let runtime = new OfflineRuntime({ store: factory }); await runtime.open(halo.first.authority.principal,true); await runtime.program(halo.program);
  const commit = async (op: string, frame: any) => runtime.commit(op,{},await runtime.accept(op,{},frame));
  await commit('clock.fixed',halo.first); assert.equal((await runtime.twin.evaluate('clock.fixed',{})).state,'capped');
  // Native initial certificate/frame; subsequent matching-plan frames are synthetic admission controls.
  const latest = structuredClone(halo.first); latest.seq += 2; latest.readTime += 2; latest.validator = 'b'.repeat(64);
  latest.planHash = halo.program.programs['clock.read'].planHash; latest.receipt = receipt();
  latest.rows = latest.rows.filter((r: any) => ['r0','r1'].includes(r.id));
  latest.data = { now: latest.readTime,rows: latest.rows.map((r: any) => ({ $row: { table: r.table,id: r.id } })) };
  await commit('clock.read',latest); assert.equal((await runtime.twin.evaluate('clock.fixed',{})).state,'capped');
  const delayed = structuredClone(halo.first); delayed.seq++; delayed.readTime++; delayed.data.now = delayed.readTime; delayed.validator = 'c'.repeat(64);
  for (const row of delayed.rows) { if (row.id === 'r0') row.row.at = -20; if (row.id === 'r1') row.row.at = -10; }
  await commit('clock.fixed',delayed);
  const warm = await runtime.twin.evaluate('clock.fixed',{}); assert.equal(warm.state,'partial'); assert.equal(warm.next,undefined);
  assert.deepEqual(warm.data.rows.map((r: any) => r.at),Array.from({ length: 10 },(_,i) => i));
  const before = JSON.stringify(saved); await commit('clock.fixed',delayed);
  assert.equal(JSON.stringify(saved),before,'an exact replay changes neither custody nor logical slots');
  assert.deepEqual(await runtime.twin.evaluate('clock.fixed',{}),warm);
  await runtime.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open(halo.first.authority.principal,true);
  const cold = await runtime.twin.evaluate('clock.fixed',{}); assert.equal(cold.state,'partial'); assert.deepEqual(cold.data,warm.data);
  assert.equal(JSON.stringify(saved),before); await runtime.close();
});


test('authenticated sparse optional images retain exact bytes and refuse same-sequence explicit null atomically', async () => {
  const fixtures = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json',import.meta.url),'utf8'));
  const op = 'search.findPeople', operation = fixtures.operations[op], args = { term: 'é',c: null };
  const program = { generation: 'c'.repeat(64),schemaHash: operation.certificate.schema_hash,schema: fixtures.schema,
    programs: { [op]: { kind: 'query',ir: operation.program,certificate: operation.certificate,planHash: operation.certificate.plan_hash } } };
  // Actual native26c9 certificate; synthetic matching authenticated frames, not native emission.
  const frame: any = { protocol: 1,state: 'complete',generation: program.generation,schemaHash: program.schemaHash,
    planHash: operation.certificate.plan_hash,authority: { principal: 'dev:alice',authEpoch: 0 },seq: 1,validator: 'd'.repeat(64),next: null,
    data: [{ $row: { table: 'people',id: 'one' } }],rows: [{ table: 'people',id: 'one',row: { id: 'one',name: 'é' } }],receipt: receipt() };
  let saved: any; const factory = () => new PersistentRangeStore({ carrier: 'json',open: async () => saved,
    replace: async state => { saved = JSON.parse(JSON.stringify(state)); },close() {},wipe: async () => {} });
  let runtime = new OfflineRuntime({ store: factory }); await runtime.open('dev:alice',true); await runtime.program(program);
  await runtime.commit(op,args,await runtime.accept(op,args,frame));
  await runtime.store.commit({ outbox: { put: [entry('keep')] } });
  const { RowImage } = await import('../dist/image-runtime.mjs');
  const hydrated = await runtime.twin.hydrate(), image = hydrated.store.byId('people','one');
  assert(RowImage.is(image)); assert.equal(image.Row.handle,'Null');
  assert(!Object.hasOwn(saved.rows['people\0one'].row,'handle'));
  const before = JSON.stringify(saved), slots = saved.factSlots, privateBefore = JSON.stringify((runtime.store as any).state);
  const different = structuredClone(frame); different.rows[0].row.handle = null; different.validator = 'e'.repeat(64);
  await assert.rejects(runtime.commit(op,args,await runtime.accept(op,args,different)),/conflicting/);
  assert.equal(JSON.stringify(saved),before); assert.equal(saved.factSlots,slots);
  assert.equal(JSON.stringify((runtime.store as any).state),privateBefore);
  assert.equal((await runtime.twin.hydrate()).store.byId('people','one'),image);
  assert.equal((await runtime.store.outbox.all())[0].intent,'keep');
  await runtime.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open('dev:alice',true);
  const cold = (await runtime.twin.hydrate()).store.byId('people','one');
  assert.equal(cold.Row.handle,'Null'); assert.equal(RowImage.digest(cold),RowImage.digest(image));
  assert.equal(JSON.stringify(saved),before); assert.equal(saved.factSlots,slots);
  different.seq++; await runtime.commit(op,args,await runtime.accept(op,args,different));
  assert.equal(saved.rows['people\0one'].row.handle,null); assert.equal((await runtime.store.outbox.all())[0].intent,'keep');
  await runtime.close();
});


test('equal authenticated refresh shares built current ownership without semantic revisions across replay and cold replacement', async context => {
  const { nativeR8: { halo } } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json',import.meta.url),'utf8'));
  const { RowImage,imageCanonical } = await import('../dist/image-runtime.mjs');
  context.mock.method(Date,'now',() => halo.first.readTime + 1000);
  for (const cold of [false,true]) {
    let saved: any, refuse = false;
    const factory = () => new PersistentRangeStore({ carrier: 'json',open: async () => saved,
      replace: async state => { if (refuse) throw new Error('owned rollback'); saved = JSON.parse(JSON.stringify(state)); },close() {},wipe: async () => {} });
    let runtime = new OfflineRuntime({ store: factory }); await runtime.open(halo.first.authority.principal,true); await runtime.program(halo.program);
    const commit = async (frame: any) => runtime.commit('clock.fixed',{},await runtime.accept('clock.fixed',{},frame));
    // Real native26c9 initial halo frame, synthetic checked equal-image successors.
    await commit(halo.first); await runtime.store.commit({ outbox: { put: [entry('keep')] } });
    if (cold) { await runtime.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open(halo.first.authority.principal,true); }
    const held = await runtime.twin.hydrate(), key = 'events\0r0', initial = (runtime.store as any).state.rows[key].row;
    assert.equal(held.store.byId('events','r0'),initial); const revision = held.rowsRevision, authority = held.authorityRevision;
    const frame = structuredClone(halo.first); frame.seq++; frame.readTime++; frame.data.now = frame.readTime; frame.validator = 'e'.repeat(64);
    await commit(frame); const refreshed = await runtime.twin.hydrate(), current = (runtime.store as any).state.rows[key].row;
    assert.notEqual(current,initial); assert.equal(refreshed.store.byId('events','r0'),current);
    assert.equal(RowImage.keys(current),RowImage.keys(initial)); assert.equal(imageCanonical(current),imageCanonical(initial));
    assert.equal(refreshed.rowsRevision,revision); assert.equal(refreshed.authorityRevision,authority);
    await runtime.store.commit({ outbox: { put: [entry('noop')] },overlay: { put: { noop: [{ table: 'events',id: 'r0',row: { id: 'r0',at: 0 },fields: ['at'] }] } } });
    assert.equal((await runtime.twin.hydrate()).store.byId('events','r0'),current,'an exact no-op overlay retains the current body');
    assert.equal(refreshed.rowsRevision,revision);
    await runtime.store.commit({ outbox: { remove: ['noop'] },overlay: { remove: ['noop'] } });
    assert.equal((await runtime.twin.hydrate()).store.byId('events','r0'),current);
    const before = JSON.stringify(saved), slots = saved.factSlots;
    await commit(frame); assert.equal(JSON.stringify(saved),before); assert.equal((await runtime.twin.hydrate()).store.byId('events','r0'),current);
    const failed = structuredClone(frame); failed.seq++; failed.readTime++; failed.data.now = failed.readTime; failed.validator = 'f'.repeat(64);
    refuse = true; await assert.rejects(commit(failed),/owned rollback/); refuse = false;
    assert.equal(JSON.stringify(saved),before); assert.equal(saved.factSlots,slots);
    assert.equal((await runtime.twin.hydrate()).store.byId('events','r0'),current);
    assert.equal((await runtime.store.outbox.all())[0].intent,'keep');
    const changed = structuredClone(failed); changed.planHash = halo.program.programs['clock.read'].planHash; changed.receipt = receipt();
    changed.rows = [{ table: 'events',id: 'r0',row: { id: 'r0',at: 50 } }]; changed.data = { now: changed.readTime,rows: [{ $row: { table: 'events',id: 'r0' } }] };
    await runtime.commit('clock.read',{},await runtime.accept('clock.read',{},changed));
    const latest = await runtime.twin.hydrate(); assert.equal(latest.store.byId('events','r0'),(runtime.store as any).state.rows[key].row);
    assert.equal(latest.store.byId('events','r0').Row.at.Int,50); assert.equal(latest.rowsRevision,revision + 1);
    await runtime.store.commit({ dropAnswers: ['clock.fixed\0{}','clock.read\0{}'] });
    assert.equal((await runtime.twin.hydrate()).store.byId('events','r0'),null); await runtime.close();
  }
});
