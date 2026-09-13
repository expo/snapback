// @ref LLP 1018.008.007.002#11-block-index-acquisition-restart — selected block postings retain exact query and proof semantics.
import corpusJson from '../../../corpus/manifest.json';
import { ClientStore } from '../../evaluator/src/store.js';
import { EvalError } from '../../evaluator/src/errors.js';
import { RowImage } from '../../evaluator/src/row-image.js';
import { asString, field, schemaDigest, totalCompare, canonicalJson } from '../../evaluator/src/value-runtime.js';
import type { CorpusCase, Value } from '../../evaluator/src/types.js';
import type { HeldProgram } from '../src/store/range-store.js';
import type { NativeState, NativeRow } from '../src/native-custody.js';
import { DurableCustody } from '../src/durable-custody.js';
import { DurableRows } from '../src/durable-rows.js';
import { DurableQueryHost } from '../src/durable-query.js';
import { scalarKey, scalarFromKey, directoryKeys, indexPrefix } from '../src/durable-key.js';
import { preparePrefix } from '../../evaluator/src/index-store.js';
import { SEARCH_CONTRACT } from '../../evaluator/src/unicode.js';

const corpus = corpusJson as unknown as CorpusCase[];
const check = (value: unknown, message: string): void => { if (!value) throw Error(message); };
function equal(actual: unknown, expected: unknown, message: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw Error(`${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
async function outcome(run: () => unknown): Promise<unknown> {
  try { return { value: JSON.parse(JSON.stringify(await run())) }; }
  catch (error) {
    if (!(error instanceof EvalError)) throw error;
    return { code: error.code, authoredCode: error.authoredCode, partialSites: error.partialSites,
      trace: JSON.parse(JSON.stringify(error.trace ?? null)) };
  }
}
function installed(test: CorpusCase): HeldProgram {
  return { generation: `durable-corpus:${test.name}`, schemaHash: schemaDigest(test.schema), schema: test.schema,
    programs: { query: { kind: 'query', ir: test.program, certificate: test.certificate } } } as unknown as HeldProgram;
}
function initial(test: CorpusCase, program: HeldProgram): NativeState {
  return { principal: test.context.viewer, tokenHash: 'test', authEpoch: test.context.auth_epoch,
    generation: program.generation, schemaHash: program.schemaHash, seq: 0, readTime: 0, serial: 0,
    sealed: false, logs: {}, packets: [] };
}
function rows(store: ClientStore, program: HeldProgram, seq: number): NativeRow[] {
  return Object.keys(program.schema.tables).flatMap(table => store.rows(table).map(row => ({ table,
    id: asString(field(row, 'id')), row: RowImage.prepare(program.schema, table, row, program.schemaHash), seq })));
}
async function corpusControl(test: CorpusCase): Promise<void> {
  const program = installed(test), state = initial(test, program), name = `durable-query:${crypto.randomUUID()}`;
  const store = new ClientStore(test.schema, test.receipt, { program: test.program,
    readable: Object.entries<any>(test.schema.tables).filter(([, t]) => t.retain === 'delivered-history').map(([t]) => t) });
  store.registerHeld(program.programs, test.context);
  let custody = await DurableCustody.open(name, program, state);
  try {
    const first = rows(store, program, 1);
    await custody.commit({ state: { ...custody.state, seq: 1 }, rows: first,
      proofs: { seed: { receipt: test.receipt, program: test.program } } });
    for (const step of test.prelude) store.applyMutation(step.program, step.context, false, step.certificate);
    if (test.replacementReceipt !== null) store.rehydrate(test.replacementReceipt);
    if (test.prelude.length || test.replacementReceipt !== null) {
      const current = rows(store, program, 2), ids = new Set(current.map(row => JSON.stringify([row.table, row.id])));
      const removed = first.filter(row => !ids.has(JSON.stringify([row.table, row.id]))).map(row => ({ ...row, row: null, seq: 2 }));
      await custody.commit({ state: { ...custody.state, seq: 2 }, rows: [...current, ...removed],
        ...(test.replacementReceipt !== null ? { proofs: { seed: { receipt: test.replacementReceipt, program: test.program } } } : {}) });
    }
    const expected = await outcome(() => store.reexecute(test.program, test.context, test.certificate));
    equal(await outcome(() => custody.execute('query', test.context)), expected, 'warm durable/sync execution');
    custody.close(); custody = await DurableCustody.open(name, program, state);
    equal(await outcome(() => custody.execute('query', test.context)), expected, 'reopened durable/sync execution');
  } finally { custody.close(); await request(indexedDB.deleteDatabase(name)); }
}

/** Same certified programs and exact traces run through actual asynchronous IDB reads. */
export async function runDurableQueryControls(): Promise<Array<{ name: string; pass: boolean; error?: string }>> {
  const results: Array<{ name: string; pass: boolean; error?: string }> = [];
  async function test(name: string, run: () => Promise<void>) {
    try { await run(); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: error instanceof Error ? error.stack : String(error) }); }
  }
  for (const entry of corpus.filter(test => !test.serverOnly && test.certificate && test.program.kind === 'Query'))
    await test(`durable corpus ${entry.name}`, () => corpusControl(entry));

  await test('physical encoding preserves the complete Quarry value order and nominal roundtrip', async () => {
    const values: Value[] = ['Null', { Bool: false }, { Bool: true }, { Int: -2 }, { Int: 0 }, { Int: 2 },
      ...['', 'a', 'aa', '\ue000', '\u{10000}'].flatMap(value => [{ String: value }, { Id: value }] as Value[]),
      { Bytes: '' }, { Bytes: '00' }, { Row: {} }, { Row: { a: { Int: 2 } } },
      { Array: [] }, { Array: ['Null'] }, { Array: [{ Array: [] }] }, { Map: {} },
      { Map: { z: 'Null' } }, { Map: { a: { Int: 2 }, b: { Array: [{ Map: { z: 'Null' } }] } } },
      { Map: { '\ue000': 'Null' } }, { Map: { '\u{10000}': 'Null' } }];
    for (const value of values) equal(scalarFromKey(scalarKey(value)), value, 'nominal index roundtrip');
    for (const a of values) for (const b of values)
      equal(Math.sign(indexedDB.cmp(scalarKey(a), scalarKey(b))), Math.sign(totalCompare(a, b)), 'physical versus logical total order');
  });

  await test('seek bounds, ties and abandoned pulls match HeldIndex in a single readonly transaction', async () => {
    const sample = corpus.find(test => test.name === 'merge-ties-and-empty-lane')!, program = installed(sample);
    const name = `durable-bounds:${crypto.randomUUID()}`, disk = await DurableRows.open(name, program);
    const store = new ClientStore(sample.schema, sample.receipt, { program: sample.program });
    const state = { ...initial(sample, program), seq: 1 };
    try {
      for (const [id, at] of [['\ue000', 2], ['\u{10000}', 2], ['later', 3]] as const)
        store.put('posts', { Row: { id: { Id: id }, at: { Int: at }, author: { Id: 'u1' } } });
      await disk.transaction('readwrite', tx => tx.putRows(rows(store, program, 1), 1));
      const ends: Array<Value | null> = [null, { Array: [{ Int: 1 }, { Id: 'a' }] }, { Array: [{ Int: 2 }, { Id: '\ue000' }] }];
      for (const order of ['Asc', 'Desc'] as const) for (const after of ends) for (const before of ends)
        for (const bound of [null, { gt: { Int: 1 } }, { gte: { Int: 2 } }, { lt: { Int: 2 } }, { lte: { Int: 2 } }]) {
          await disk.transaction('readonly', async tx => {
            const host = await DurableQueryHost.open(tx, state, () => undefined);
            const prefix = [{ Scalar: { Id: 'u1' } }];
            const expected = [...store.seek('posts', 'byAuthorAt', prefix, after, before, bound, order)];
            const cursor = host.seek('posts', 'byAuthorAt', prefix, after, before, bound, order), actual: Value[] = [];
            for (;;) { const next = await cursor.next(); if (next.done) break; actual.push(next.value); }
            await cursor.return?.(); equal(actual, expected, 'physical seek');
          });
        }
      await disk.transaction('readonly', async tx => {
        const host = await DurableQueryHost.open(tx, state, () => undefined), old = tx.row.bind(tx); let read = 0;
        tx.row = async record => { read++; return old(record); };
        const cursor = host.seek('posts', 'byAuthorAt', [{ Scalar: { Id: 'u1' } }], null, null, null, 'Asc');
        await cursor.next(); await cursor.return?.(); await cursor.next(); equal(read, 1, 'abandoned pull reads no next body');
      });
    } finally { disk.close(); await request(indexedDB.deleteDatabase(name)); }
  });

  await test('a touched search-scope representative cannot be ahead of the query snapshot', async () => {
    const sample = corpus.find(test => test.name === 'search-held-global-first-page')!, program = installed(sample);
    const name = `durable-scope-version:${crypto.randomUUID()}`, disk = await DurableRows.open(name, program);
    try {
      const current = rows(new ClientStore(sample.schema, sample.receipt, { program: sample.program }), program, 2);
      await disk.transaction('readwrite', tx => tx.putRows(current, 2));
      let refused = false;
      try {
        await disk.transaction('readonly', async tx => {
          const host = await DurableQueryHost.open(tx, { ...initial(sample, program), seq: 1 }, () => undefined);
          const prefix = preparePrefix(sample.schema, 'messages', 'byConversationWords', [
            { Scalar: { Id: 'c1' } }, { WordPrefix: { source: 'CA', contract: SEARCH_CONTRACT } },
          ], [undefined, 2000]);
          await host.missingSearchAuthority('messages', 'byConversationWords', prefix, sample.context);
        });
      } catch (error) { refused = String(error).includes('ahead of its snapshot'); }
      check(refused, 'scope representative bypassed snapshot integrity');
    } finally { disk.close(); await request(indexedDB.deleteDatabase(name)); }
  });

  await test('selected stale block postings fail before returning a mismatched body', async () => {
    const sample = corpus.find(test => test.name === 'merge-ties-and-empty-lane')!, program = installed(sample);
    const name = `durable-posting-integrity:${crypto.randomUUID()}`, disk = await DurableRows.open(name, program);
    try {
      const admitted = rows(new ClientStore(sample.schema, sample.receipt, { program: sample.program }), program, 1);
      const row = admitted.find(row => row.table === 'posts')!;
      const start = indexPrefix('posts', 'byAuthorAt', []);
      const real = directoryKeys('posts', row.row!).find(key => indexedDB.cmp(key.slice(0, 2), start) === 0)!;
      const forged = [...real]; forged[2] = scalarKey({ Id: 'forged-author' });
      await disk.transaction('readwrite', async tx => {
        await tx.putRows(admitted, 1);
        await tx.postings.apply([{ kind: 'put', key: forged, value: null }]);
      });
      let refused = false;
      try {
        await disk.transaction('readonly', async tx => {
          const host = await DurableQueryHost.open(tx, { ...initial(sample, program), seq: 1 }, () => undefined);
          tx.row = async () => { throw Error('forged posting reached a body read'); };
          const cursor = host.seek('posts', 'byAuthorAt', [{ Scalar: { Id: 'forged-author' } }], null, null, null, 'Asc');
          try { await cursor.next(); } finally { await cursor.return?.(); }
        });
      } catch (error) { refused = String(error).includes('posting disagrees'); }
      check(refused, 'stale posting did not fail at its directory agreement check');

      const unicode = { table: 'posts', id: 'noncanonical-key', seq: 2,
        row: RowImage.prepare(program.schema, 'posts', { Row: {
          id: { Id: 'noncanonical-key' }, author: { Id: '\u{10000}' }, at: { Int: 1 },
        } }, program.schemaHash) };
      const canonical = directoryKeys('posts', unicode.row).find(key => indexedDB.cmp(key.slice(0, 2), start) === 0)!;
      const aliased = [...canonical];
      // Two encoded surrogate halves decode to the same JS text, but occupy a
      // different physical order from the single admitted Unicode codepoint.
      aliased[2] = [4, new Uint8Array([0, 0xd8, 0, 0, 0xdc, 0]).buffer];
      equal(scalarFromKey(aliased[2]), { Id: '\u{10000}' }, 'counterexample has identical decoded text');
      check(indexedDB.cmp(aliased, canonical) !== 0, 'counterexample must have a different physical order');
      await disk.transaction('readwrite', async tx => {
        await tx.putRows([unicode], 2);
        await tx.postings.apply([{ kind: 'delete', key: forged }, { kind: 'put', key: aliased, value: null }]);
      });
      refused = false;
      try {
        await disk.transaction('readonly', async tx => {
          const host = await DurableQueryHost.open(tx, { ...initial(sample, program), seq: 2 }, () => undefined);
          const read = tx.row.bind(tx);
          tx.row = record => {
            if (record.id === unicode.id) throw Error('noncanonical posting reached a body read');
            return read(record);
          };
          const cursor = host.seek('posts', 'byAuthorAt', [], null, null, null, 'Asc');
          try { while (!(await cursor.next()).done) { /* Scan to the malformed tuple. */ } }
          finally { await cursor.return?.(); }
        });
      } catch (error) { refused = String(error).includes('posting disagrees'); }
      check(refused, 'decoded equality admitted a noncanonical posting key');
    } finally { disk.close(); await request(indexedDB.deleteDatabase(name)); }
  });

  await test('selected scope memberships must agree with current logical row parts', async () => {
    const sample = corpus.find(test => test.name === 'search-held-global-first-page')!, program = installed(sample);
    const name = `durable-member-integrity:${crypto.randomUUID()}`, disk = await DurableRows.open(name, program);
    try {
      const admitted = rows(new ClientStore(sample.schema, sample.receipt, { program: sample.program }), program, 1);
      const row = admitted.find(row => row.table === 'messages')!;
      const scope = indexPrefix('messages', 'byConversationWords', [{ Scalar: { Id: 'forged-conversation' } }]);
      await disk.transaction('readwrite', async tx => {
        await tx.putRows(admitted, 1);
        await tx.memberships.apply([{ kind: 'put', key: [...scope, scalarKey({ Id: row.id })], value: null }]);
      });
      let refused = false;
      try {
        await disk.transaction('readonly', async tx => {
          const host = await DurableQueryHost.open(tx, { ...initial(sample, program), seq: 1 }, () => undefined);
          const prefix = preparePrefix(sample.schema, 'messages', 'byConversationWords', [
            { Scalar: { Id: 'forged-conversation' } }, { WordPrefix: { source: 'CA', contract: SEARCH_CONTRACT } },
          ], [undefined, 2000]);
          await host.missingSearchAuthority('messages', 'byConversationWords', prefix, sample.context);
        });
      } catch (error) { refused = String(error).includes('scope membership disagrees'); }
      check(refused, 'stale scope membership silently selected an unrelated row');
    } finally { disk.close(); await request(indexedDB.deleteDatabase(name)); }
  });

  await test('receipt packets, body and metadata rollback together; poisoned writer reopens to the prior revision', async () => {
    const sample = corpus.find(test => test.name === 'merge-ties-and-empty-lane')!, program = installed(sample), state = initial(sample, program);
    const name = `durable-custody-abort:${crypto.randomUUID()}`;
    let custody = await DurableCustody.open(name, program, state);
    try {
      const first = rows(new ClientStore(sample.schema, sample.receipt, { program: sample.program }), program, 1);
      await custody.commit({ state: { ...custody.state, seq: 1 }, rows: first });
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(...args: Parameters<IDBObjectStore['put']>) {
        if (this.transaction.db.name === name && this.name === 'meta' && args[1] === 'state') throw Error('late state write injected');
        return original.apply(this, args);
      };
      try {
        let refused = false;
        try { await custody.commit({ state: { ...custody.state, seq: 2, serial: 1, packets: [{ id: 'packet', log: 'test', events: ['e'] }] },
          rows: [{ ...first[0], seq: 2, row: null }] }); } catch (error) { refused = String(error).includes('late state write injected'); }
        check(refused, 'injected late write must refuse'); equal(custody.state.seq, 1, 'failed state must not publish');
      } finally { IDBObjectStore.prototype.put = original; }
      let poisoned = false;
      try { await custody.rows('posts'); } catch { poisoned = true; }
      check(poisoned, 'failed instance must refuse'); custody.close(); custody = await DurableCustody.open(name, program, state);
      equal(custody.state.seq, 1, 'cold state rollback'); equal(custody.state.packets, [], 'unearned packet rollback');
      equal((await custody.rows('posts')).length, first.length, 'body rollback');
      await custody.commit({ state: { ...custody.state, seq: 2 }, rows: [{ ...first[0], seq: 2, row: null }] });
      equal((await custody.rows('posts')).length, first.length - 1, 'cold retry commits');
    } finally { custody.close(); await request(indexedDB.deleteDatabase(name)); }
  });
  return results;
}
