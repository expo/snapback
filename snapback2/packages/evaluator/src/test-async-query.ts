// @ref LLP 1018.008.007.002#10-receipt-groups-and-the-full-application-client — one execution survives real read
// suspensions without replay, reordered rule probes, or changed cursor evidence.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ClientStore } from './store';
import { Runner } from './runner';
import { executeQuery, readQueryAuthority, type QueryHost, type Awaitable } from './query';
import { fixtureCertificate } from './test-certificate';
import { canonicalJson, clone, schemaDigest, scopedRuleHash } from './value-runtime';
import { sha256 } from './hash';
import { EvalError } from './errors';
import type { Context, CorpusCase, Value } from './types';

const corpus: CorpusCase[] = JSON.parse(readFileSync(process.env.SNAPBACK2_CORPUS
  ? resolve(process.env.SNAPBACK2_CORPUS, 'manifest.json') : new URL('../../../corpus/manifest.json', import.meta.url), 'utf8'));
let passed = 0, failed = 0;
async function check(label: string, run: () => Promise<void>): Promise<void> {
  try { await run(); passed++; } catch (error) { failed++; console.error(label, error); }
}
function prepared(test: CorpusCase): ClientStore {
  const store = new ClientStore(test.schema, test.receipt, { program: test.program });
  for (const step of test.prelude) store.applyMutation(step.program, step.context, false, step.certificate);
  if (test.replacementReceipt !== null) store.rehydrate(test.replacementReceipt);
  return store;
}
function host(store: ClientStore, delayed = true) {
  const calls: string[] = [], opened: number[] = [], closed: number[] = [];
  let serial = 0;
  const perform = <T>(name: string, body: () => T): Awaitable<T> => {
    calls.push(name);
    return delayed ? Promise.resolve().then(body) : body();
  };
  const read: QueryHost = {
    lookup: (...args) => perform(`lookup:${canonicalJson(args)}`, () => store.lookup(...args)),
    seek: (...args) => perform(`seek:${canonicalJson(args)}`, () => {
      const cursor = store.seek(...args), id = ++serial; opened.push(id);
      return {
        next: () => perform(`next:${id}`, () => cursor.next()),
        return: () => perform(`close:${id}`, () => { closed.push(id); return cursor.return(undefined); }),
      };
    }),
    readable: table => perform(`readable:${table}`, () => store.readable(table)),
    missingSearchAuthority: (...args) => perform('search-authority', () => store.missingSearchAuthority(...args)),
    heldDirectory: descriptor => perform('directory', () => {
      const directory = store.heldDirectory(descriptor);
      return directory && { fixed: directory.fixed,
        select: (values, limit) => perform('select', () => directory.select(values, limit)) };
    }),
    verdict: (...args) => perform('verdict', () => store.verdict(...args)),
    hasAbsence: (...args) => perform('absence', () => store.hasAbsence(...args)),
    hasCompleteRange: (...args) => perform('complete-range', () => store.hasCompleteRange(...args)),
    rangeStop: (...args) => perform('stop', () => store.rangeStop(...args)),
    coversRange: (...args) => perform('covers', () => store.coversRange(...args)),
  };
  return { read, calls, opened, closed };
}
async function outcome(run: () => unknown): Promise<unknown> {
  try { return { value: JSON.parse(JSON.stringify(await run())) }; }
  catch (error) {
    if (!(error instanceof EvalError)) throw error;
    return { code: error.code, authoredCode: error.authoredCode, partialSites: error.partialSites,
      trace: JSON.parse(JSON.stringify(error.trace ?? null)) };
  }
}

// Rust-issued query certificates retain their expected synchronous oracle in
// test.ts. Compare every trace, meter, state, error and cursor across suspension.
for (const test of corpus.filter(test => !test.serverOnly && test.certificate && test.program.kind === 'Query')) {
  await check(`async corpus ${test.name}`, async () => {
    const store = prepared(test), backend = host(store);
    const expected = await outcome(() => store.reexecute(test.program, test.context, test.certificate));
    const actual = await outcome(() => executeQuery(backend.read, test.schema, test.program, test.context, test.certificate));
    assert.deepEqual(actual, expected);
    assert.deepEqual([...backend.closed].sort(), [...backend.opened].sort(), 'every opened cursor closes');
  });
}

const merged = corpus.find(test => test.name === 'merge-ties-and-empty-lane')!;
await check('merge suspension preserves exact logical pull and authority order', async () => {
  const immediate = host(prepared(merged), false), delayed = host(prepared(merged));
  const expected = new Runner(immediate.read, merged.schema, merged.context, merged.certificate).execute(merged.program);
  const actual = await new Runner(delayed.read, merged.schema, merged.context, merged.certificate).executeAsync(merged.program);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  assert.deepEqual(delayed.calls, immediate.calls);
  assert.equal(delayed.opened.length, 3);
});
await check('failure and early merge exit close all cursors without hiding the original error', async () => {
  const backend = host(prepared(merged)), seek = backend.read.seek, failure = Error('disk read failed');
  let first = true;
  backend.read.seek = async (...args) => {
    const cursor = await seek(...args);
    return { next: async () => { throw failure; }, return: async () => {
      await cursor.return!(undefined);
      if (first) { first = false; throw Error('close failed'); }
      return { done: true, value: undefined };
    } };
  };
  await assert.rejects(executeQuery(backend.read, merged.schema, merged.program, merged.context, merged.certificate), (error: unknown) => error === failure);
  assert.deepEqual(backend.closed, backend.opened);
});
await check('a later lane admission failure releases previously opened cursors', async () => {
  const backend = host(prepared(merged)), seek = backend.read.seek, failure = Error('later lane failed');
  let calls = 0;
  backend.read.seek = (...args) => ++calls === 2 ? Promise.reject(failure) : seek(...args);
  await assert.rejects(executeQuery(backend.read, merged.schema, merged.program, merged.context, merged.certificate), (error: unknown) => error === failure);
  assert.deepEqual(backend.closed, backend.opened);
  assert.equal(backend.opened.length, 1);
});

const query = (value: unknown): any => ({ name: 'suspended-control', kind: 'Query', args: {},
  read_time_granularity_ms: null, body: [{ Return: value }] });
const point: any = { Get: { site: 'point', table: 'posts', index: 'byId',
  key: [{ Literal: { Id: 'missing' } }], provenance: 'Const' } };
await check('binary short circuit never requests its unused read', async () => {
  for (const [op, left] of [['And', false], ['Or', true]] as const) {
    const program = query({ Binary: { op, left: { Literal: { Bool: left } }, right: { Exists: point.Get } } });
    const backend = host(prepared(merged));
    const result = await executeQuery(backend.read, merged.schema, program, merged.context, fixtureCertificate(merged.schema, program));
    assert.deepEqual(result.execution.result, { Bool: left });
    assert.deepEqual(backend.calls, []);
  }
});
await check('mutation IR and invalid certificates refuse before host access', async () => {
  const backend = host(prepared(merged)), mutation = { ...merged.program, kind: 'Mutation' };
  await assert.rejects(executeQuery(backend.read, merged.schema, mutation, merged.context, merged.certificate), /requires a query/);
  await assert.rejects(executeQuery(backend.read, merged.schema, merged.program, merged.context,
    { ...(merged.certificate as any), plan_hash: 'changed' }), /E_TRACE_SUBSET/);
  assert.deepEqual(backend.calls, []);
});
await check('context ownership survives a pending read through completeness classification', async () => {
  const store = prepared(merged), backend = host(store), context = clone(merged.context);
  const expected = store.reexecute(merged.program, context, merged.certificate);
  let resume!: () => void, reached!: () => void;
  const paused = new Promise<void>(resolve => { resume = resolve; }), started = new Promise<void>(resolve => { reached = resolve; });
  const seek = backend.read.seek;
  backend.read.seek = async (...args) => { reached(); await paused; return seek(...args); };
  const pending = executeQuery(backend.read, merged.schema, merged.program, context, merged.certificate);
  await started;
  context.viewer = 'changed'; context.args = {}; context.auth_epoch++;
  resume();
  assert.equal(JSON.stringify(await pending), JSON.stringify(expected));
});

const schema: any = { tables: {
  items: { columns: { id: 'Id', owner: 'Principal' }, indexes: { byId: { components: [{ Column: 'id' }], unique: true } },
    rules: { read: { Exists: { table: 'authority', index: 'byId', key: [{ Field: 'owner' }], provenance: 'Shape' } }, insert: 'Deny', update: 'Deny', delete: 'Deny' } },
  authority: { columns: { id: 'Id' }, indexes: { byId: { components: [{ Column: 'id' }], unique: true } },
    rules: { read: 'Deny', insert: 'Deny', update: 'Deny', delete: 'Deny' } },
} };
const context: Context = { viewer: 'viewer', principal_kind: 'user', auth_epoch: 1, args: {}, now: null, read_time: null, new_ids: [] };
const row: Value = { Row: { id: { Id: 'item' }, owner: { Id: 'viewer' } } };
await check('async directory authorization distinguishes true false and missing private evidence', async () => {
  const store = new ClientStore(schema), backend = host(store);
  backend.read.lookup = () => { throw Error('private rows cannot replace a verdict'); };
  for (const result of [null, true, false] as const) {
    store.setReceipt('authority', { schema_hash: schemaDigest(schema), rows: [], ranges: [], absences: [], verdicts: result === null ? [] : [{
      rule_hash: scopedRuleHash(schema, schema.tables.items.rules.read),
      pinned_inputs_digest: sha256(canonicalJson(['authority', 'byId', ['viewer']])),
      principal: context.viewer, auth_epoch: context.auth_epoch, result,
    }] });
    assert.equal(await readQueryAuthority(backend.read, schema, context, 'items', row, ['owner']), result);
    assert.equal(await readQueryAuthority(backend.read, schema, { ...context, auth_epoch: 2 }, 'items', row, ['owner']), null);
    assert.equal(await readQueryAuthority(backend.read, schema, context, 'items', row, ['id']), null);
  }
});
await check('held Unicode search selects directory scopes before term postings and matches synchronous state', async () => {
  const test = corpus.find(test => test.name === 'search-held-global-first-page')!, store = prepared(test);
  store.registerHeld({ search: { ir: test.program } }, test.context);
  for (const term of ['CA', 'cafe\u0301', '\u{10400}', 'absent']) {
    const context = { ...test.context, args: { ...test.context.args, term: { String: term } } }, backend = host(store);
    const expected = store.reexecute(test.program, context, test.certificate);
    assert.equal(JSON.stringify(await executeQuery(backend.read, test.schema, test.program, context, test.certificate)), JSON.stringify(expected));
    assert(backend.calls.includes('select'));
    assert(backend.calls.findIndex(call => call === 'select') < backend.calls.findIndex(call => call.startsWith('seek:')));
  }
  for (const term of ['not-present', '\ud800', 'x'.repeat(2001)]) {
    const context = { ...test.context, args: { ...test.context.args, term: { String: term } } }, backend = host(store);
    assert.deepEqual(await outcome(() => executeQuery(backend.read, test.schema, test.program, context, test.certificate)),
      await outcome(() => store.reexecute(test.program, context, test.certificate)));
  }
  const backend = host(store), directory = backend.read.heldDirectory;
  backend.read.heldDirectory = async descriptor => {
    const current = await directory(descriptor);
    return { fixed: current!.fixed, select: async () => ({ scopes: [], overflow: false, missing: true }) };
  };
  const result = await executeQuery(backend.read, test.schema, test.program, test.context, test.certificate);
  assert(result.partialSites.includes('missing-authority'));
  assert(!backend.calls.some(call => call.startsWith('seek:')));
});

console.log(`async query machine: ${passed} passed, ${failed} failed`);
assert.equal(failed, 0, 'async query controls failed');
