import { RowImage, ImageKeys, imageCanonical, imageWire } from './row-image';
import { prepareWireRow } from '../../snapback2/src/offline-protocol';
import { assetIdsIn } from '../../snapback2/src/store/byte-cache';
// @ref LLP 1012#indexed-held-search — regressions exercise seeks, local authority and durable incremental replay.
import assert from 'node:assert/strict';
import { ClientStore, immutable } from './store';
import { HeldIndex, preparePrefix } from './index-store';
import { canonicalSchemaJson, canonicalProgramJson } from './certificate-identity';
import { sha256 } from './hash';
import { scopedRuleHash, wireJson } from './value-runtime';
import { Twin } from '../../snapback2/src/twin';
import { emptyState, PersistentRangeStore } from '../../snapback2/src/store/range-store';
import { StoreChanges, SwapJournal } from '../../snapback2/src/store/swap-journal';
import { decodeLocalCursor, encodeLocalCursor, localBinding, StaleLocalPage, serverArguments } from '../../snapback2/src/local-cursor';
import { SEARCH_CONTRACT, SearchNormalizer } from './unicode';
import { prepareRange } from './coverage';
import { queryState } from './runner';
import { encodeCursor, decodeCursor } from './cursor';
import historicalFixtures from './test-search-fixtures.json';
import v4Fixtures from './test-search-v4-fixtures.json';
import searchFixtures from './test-search-v5-fixtures.json';
import { decodeHeldProgram } from '../../snapback2/src/held-program';
import { tagWireRow, deliveryRangeExtent, decodeDeliveryEnvelope, tagReceipt } from '../../snapback2/src/offline-protocol';
import { tagArguments } from '../../snapback2/src/twin-hydrate';
import { tagWireRangePrefix } from '../../snapback2/src/offline-protocol';
const col = (Column: string) => ({ Column });
const rules = { read: 'Allow', insert: 'Allow', update: 'Allow', delete: 'Allow' };
const schema: any = { tables: { messages: { columns: { id: 'Id', room: { Text: { max: 20 } }, body: { Text: { max: 2000 } }, caption: { Optional: { Text: { max: 50 } } }, at: 'Int' }, indexes: {
  byId: { components: [col('id')], unique: true }, ordinary: { components: [col('room'), col('at'), col('id')], unique: false },
  search: { components: [col('room'), { WordPrefixes: { fields: ['body', 'caption'], contract: SEARCH_CONTRACT } }, col('at'), col('id')], unique: false },
}, rules, constraints: [], retain: 'delivered-history' } }, maintains: [] };
const typed = (id: string, body: string, at = 1, caption: string | null = null): any => ({ Row: { id: { Id: id }, room: { String: 'r' }, body: { String: body }, caption: caption === null ? 'Null' : { String: caption }, at: { Int: at } } });
const atoms = (term: string): any => [{ Scalar: { String: 'r' } }, { WordPrefix: { source: term, contract: SEARCH_CONTRACT } }];
const prefix = (term: string) => preparePrefix(schema, 'messages', 'search', atoms(term), [undefined, 2000]);
// Hermes treats TypedArray.from as array-like-only. Search posting custody must
// not depend on Set's iterator being honored by that platform implementation.
const typedArrayFrom = Object.getOwnPropertyDescriptor(Uint32Array, 'from');
Object.defineProperty(Uint32Array, 'from', { configurable: true, value: (source: ArrayLike<number>) => {
  const result = new Uint32Array(Number.isSafeInteger(source?.length) ? source.length : 0);
  for (let i = 0; i < result.length; i++) result[i] = source[i]!;
  return result;
} });
try {
  const compatible = new HeldIndex<any>(schema, 'messages', 'search', schema.tables.messages.indexes.search.components);
  const row = typed('hermes-posting', 'Café'); compatible.put(row);
  assert.deepEqual([...compatible.scan({ prefix: prefix('café'), after: null, before: null, range: null, order: 'Asc' })], [row]);
} finally {
  if (typedArrayFrom) Object.defineProperty(Uint32Array, 'from', typedArrayFrom);
  else delete (Uint32Array as any).from;
}
const store = new ClientStore(schema);
for (let i = 0; i < 300; i++) store.put('messages', typed(`m${i}`, i % 2 ? 'Cafe\u0301 Straße' : 'quiet', i));
store.put('messages', typed('caption', 'unrelated', 500, 'CAFÉ'));
assert.equal(store.scan('messages', 'search', prefix('CaFÉ'), null, null, null, 'Asc', 400).length, 151);
assert.equal(store.scan('messages', 'search', prefix('stra'), null, null, null, 'Asc', 400).length, 150);
const oldRows = store.rows;
store.rows = () => { throw new Error('a warm seek enumerated table history'); };
assert.equal(store.scan('messages', 'search', prefix('unseen'), null, null, null, 'Asc', 10).length, 0);
assert.equal(store.lookup('messages', 'byId', [{ Id: 'm2' }]) && true, true);
assert.equal(store.scan('messages', 'ordinary', [{ Scalar: { String: 'r' } }], null, null, null, 'Desc', 2).length, 2);
store.rows = oldRows;
store.remove('messages', 'caption');
assert.equal(store.scan('messages', 'search', prefix('café'), null, null, null, 'Asc', 400).length, 150);
assert.throws(() => prefix('same same'), /one word/);
assert.throws(() => prefix('\ud800'), { code: 'E_INPUT' });
assert.throws(() => store.put('messages', typed('x'.repeat(136), 'too long id')), /144/);
assert.equal(prefix('e\u0301'.repeat(1000)).length, 2, 'Q independent of the optional source maximum');

const scan: any = { site: 'search', table: 'messages', index: 'search', prefix: [{ Scalar: { Variable: 'room' } }, { WordPrefix: { source: { Variable: 'term' }, contract: SEARCH_CONTRACT, source_max: 2000 } }], order: 'Asc', take: { Literal: 2 }, after: { Variable: 'c' }, before: null, range: null, opaque_cursor: true, merge_site: null, provenance: 'Arg' };
const ir: any = { name: 'search', kind: 'Query', args: { room: { Text: { max: 20 } }, term: { Text: { max: 2000 } }, c: { Optional: 'Cursor' } }, read_time_granularity_ms: null, body: [{ Return: { Scan: scan } }] };
const schemaHash = sha256(canonicalSchemaJson(schema)), planHash = sha256(canonicalProgramJson(ir));
const operation: any = { kind: 'query', planHash, ir, certificate: { plan_hash: planHash, schema_hash: schemaHash, completeness: 'Complete', max_steps: 1_000_000, read_sites: [{ site: 'search', hoist: true, decided_true: true }], result_pages: { '0': { site: 'search', table: 'messages', index: 'search', order: 'Asc', suffix: [{ name: 'at', kind: 'Int' }, { name: 'id', kind: 'Id' }] } } } };
const program: any = { generation: 'g', schemaHash, schema, programs: { search: operation } };
// Public derived extents order by ordinary suffix values; the query descriptor remains an equality meaning.
const extentRows = ['e0', 'e1', 'e2'].map((id, at) => ({ table: 'messages', id, row: wireJson(typed(id, 'café', at)) }));
const extentRange: any = { site: 'search', table: 'messages', index: 'search', prefix: [{ Scalar: 'r' },
  { WordPrefix: { source: 'CAFE\u0301', contract: SEARCH_CONTRACT } }], order: 'Asc', take: 2,
  after: null, before: null, gt: null, gte: null, lt: null, lte: null, ruleHash: scopedRuleHash(schema, rules.read),
  rowIds: ['e0', 'e1'], stop: 'Limit', absence: false, haloId: 'e2' };
const extentEnvelope: any = { protocol: 1, generation: 'a'.repeat(64), schemaHash, planHash, authority: { principal: 'viewer', authEpoch: 0 },
  state: 'capped', data: [], next: null, seq: 1, rows: extentRows, receipt: { ranges: [extentRange], absences: [], verdicts: [] }, validator: 'b'.repeat(64) };
assert.deepEqual(deliveryRangeExtent(extentEnvelope, schema, extentRange, ir), { stop: 'Limit', prefix: extentRange.prefix,
  firstKey: [0, 'e0'], lastKey: [1, 'e1'], presentIds: ['e0', 'e1', 'e2'] });
assert.throws(() => deliveryRangeExtent(extentEnvelope, schema, extentRange), /issuing/);
const state = emptyState(), changes = new StoreChanges<typeof state>(); changes.reset();
for (let i = 0; i < 4; i++) { state.rows[`messages\0m${i}`] = { table: 'messages', id: `m${i}`, row: wireJson(typed(`m${i}`, 'café', i)) as any }; state.rowSeq[`messages\0m${i}`] = 1; }
state.facts = { generation: 'g', schemaHash, authEpoch: 0 };
let snapshots = 0;
const twin = new Twin({ program: () => program, changes: async since => { const c = changes.read(state, since); if (c.snapshot) snapshots++; return c; }, principal: () => 'viewer', now: () => 1, seq: () => 1 });
const args = { room: 'r', term: 'café', c: null };
const first = await twin.evaluate('search', args);
assert.equal(first?.state, 'capped'); assert(first?.next?.startsWith('h1.'));
assert.deepEqual((first.data as any[]).map(r => r.id), ['m0', 'm1']);
const second = await twin.evaluate('search', { ...args, term: 'CAFE\u0301', c: first.next });
assert.equal(second?.state, 'held'); assert.deepEqual((second?.data as any[]).map(r => r.id), ['m2', 'm3']);
assert.equal(snapshots, 1, 'one cold snapshot, no warm snapshot');
assert.deepEqual(serverArguments({ ...args, c: first.next }, 'c'), args);
await assert.rejects(twin.evaluate('search', { ...args, room: 'other', c: first.next }), /E_INPUT/);
const journal = new SwapJournal(state);
journal.draft.negative['messages\0m0'] = 2; delete journal.draft.rows['messages\0m0']; delete journal.draft.rowSeq['messages\0m0']; changes.publish(state, journal.changed);
const restarted = await twin.evaluate('search', { ...args, c: first.next });
assert.deepEqual((restarted?.data as any[]).map(r => r.id), ['m1', 'm2'], 'stale local cursor restarts once at null');
const f = { partition: 'viewer', operation: 'search', program: planHash, schema: schemaHash, generation: 'g', incarnation: 'i', revisions: [1, 2, 3] };
const binding = localBinding(operation, args);
const token = encodeLocalCursor(f, binding, { table: 'messages', index: 'search', order: 'Asc', suffix: [{ name: 'id', kind: 'Id' }], values: [{ Id: 'm0' }] });
assert.throws(() => decodeLocalCursor(token, { ...f, revisions: [2, 2, 3] }, binding), StaleLocalPage);
assert.throws(() => decodeLocalCursor(token, { ...f, partition: 'other' }, binding), /E_INPUT/);
const before = state.rows['messages\0m1'];
const rollback = new SwapJournal(state); rollback.draft.rows['messages\0m1'].row.body = 'changed'; rollback.rollback();
assert.equal(state.rows['messages\0m1'], before); assert.equal(before.row.body, 'café');
console.log('indexed seek, incremental twin, Unicode and h1 regressions passed');

// A complete ordinary source scope covers every term, but a term receipt never covers the whole scope.
const ordinaryReceipt: any = { schema_hash: schemaHash, rows: [], ranges: [{ site: 'ordinary', table: 'messages', index: 'ordinary', prefix: [{ Scalar: { String: 'r' } }], order: 'Asc', take: 1000, after: null, before: null, gt: null, gte: null, lt: null, lte: null, rule_hash: scopedRuleHash(schema, rules.read), row_ids: [], stop: 'Exhausted', absence: false, halo: null, n2_suffix: null }], absences: [], verdicts: [] };
const covered = new ClientStore(schema, ordinaryReceipt);
const context: any = { viewer: 'viewer', principal_kind: 'user', auth_epoch: 0, args: { room: { String: 'r' }, term: { String: 'never' }, c: 'Null' }, now: 1, new_ids: [], read_time: null };
assert.equal(covered.reexecute(ir, context, operation.certificate).state, 'fresh');
const termReceipt = structuredClone(ordinaryReceipt);
termReceipt.ranges[0] = { ...termReceipt.ranges[0], site: 'search', index: 'search', prefix: atoms('never'), take: 2 };
const termsOnly = new ClientStore(schema, termReceipt, { program: ir });
assert.equal(termsOnly.hasCompleteRange('messages', 'ordinary', [{ String: 'r' }]), false);
assert.equal(termsOnly.reexecute(ir, context, operation.certificate).state, 'fresh');
assert.equal(termsOnly.reexecute(ir, { ...context, args: { ...context.args, term: { String: 'else' } } }, operation.certificate).state, 'partial');

// FIFO assignment journals discard a rejected predecessor without discarding a later independent assignment.
const mutate = (run: (draft: typeof state) => void) => { const j = new SwapJournal(state); run(j.draft); changes.publish(state, j.changed); };
const entry = (intent: string, order: number): any => ({ intent, grant: 'grant', offset: 0, count: 0, ids: [], op: 'write', args: {}, issuedSeq: 1, state: 'queued', createdAt: 1, updatedAt: 1, order });
mutate(s => {
  s.outbox.a = entry('a', 1); s.outbox.b = entry('b', 2);
  s.overlay.a = [{ table: 'messages', id: 'm1', row: { ...s.rows['messages\0m1'].row, body: 'different' }, fields: ['body'] }];
  s.overlay.b = [{ table: 'messages', id: 'm1', row: { ...s.rows['messages\0m1'].row, body: 'different', at: 40 }, fields: ['at'] }];
});
assert(!((await twin.evaluate('search', args))?.data as any[]).some(r => r.id === 'm1'));
mutate(s => { s.outbox.a.state = 'rejected'; delete s.overlay.a; });
const afterRejection = await twin.evaluate('search', { ...args, c: null });
assert(afterRejection?.next);
const rejectionLast = await twin.evaluate('search', { ...args, c: afterRejection.next });
assert.equal((rejectionLast?.data as any[]).find(r => r.id === 'm1')?.at, 40);
mutate(s => { s.negative['messages\0m1'] = 2; delete s.rows['messages\0m1']; delete s.rowSeq['messages\0m1']; s.outbox.b.state = 'committed'; s.outbox.b.response = { seq: 3 }; });
assert(!((await twin.evaluate('search', args))?.data as any[]).some(r => r.id === 'm1'), 'negative dominates a committed but unretired contribution');

const membershipSchema: any = structuredClone(schema);
membershipSchema.tables.members = { columns: { id: 'Id', room: { Text: { max: 20 } }, viewer: 'Principal' }, indexes: {
  byId: { components: [col('id')], unique: true }, byRoomViewer: { components: [col('room'), col('viewer')], unique: true },
  byViewer: { components: [col('viewer'), col('room'), col('id')], unique: false },
}, rules, constraints: [], retain: 'until-revoked' };
membershipSchema.tables.messages.rules = { ...rules, read: { Exists: { table: 'members', index: 'byRoomViewer', key: [{ Field: 'room' }, 'Viewer'], provenance: 'Shape' } } };
const discovery: any = { ...scan, site: 'members', table: 'members', index: 'byViewer', prefix: [{ Scalar: { Input: 'Viewer' } }], take: { Literal: 5 }, after: null, opaque_cursor: false, merge_site: null, provenance: 'Viewer' };
const laneScan: any = { ...scan, prefix: [{ Scalar: { Field: { base: { Variable: 'member' }, name: 'room' } } }, scan.prefix[1]], merge_site: 'global' };
const descriptor: any = { table: 'messages', index: 'search', term: scan.prefix[1].WordPrefix, scope: [{ column: 'room', value: laneScan.prefix[0].Scalar }], suffix: ['at', 'id'], order: 'Asc', take: laneScan.take, after: laneScan.after, discovery: { scan: discovery, binding: 'member', authorization_index: 'byRoomViewer' } };
const globalIr: any = { ...ir, body: [{ Return: { Merge: { site: 'global', lanes: [{ scan: laneScan, source: discovery, binding: 'member' }], held_search: descriptor } } }] };
const globalCert: any = { ...operation.certificate, max_examined: 100, max_rule_probes: 100, merge_sites: [{ site: 'global', take: 2, lane_sites: ['search'] }], result_pages: { '0': { ...operation.certificate.result_pages['0'], site: 'global', merge: true } } };
const hiddenHistory = new ClientStore(membershipSchema, undefined, { readable: ['messages'] });
hiddenHistory.put('messages', typed('hidden', 'café'));
hiddenHistory.registerHeld({ global: { ir: globalIr } }, context);
const hiddenResult = hiddenHistory.reexecute(globalIr, { ...context, args: { ...context.args, term: { String: 'café' } } }, globalCert);
assert.equal((wireJson(hiddenResult.execution.result) as any[])[0]?.id, 'hidden', 'delivered history is readable with an incomplete membership download');
assert.equal(hiddenResult.execution.held, true);
const unknownAuthority = new ClientStore(membershipSchema);
unknownAuthority.put('messages', typed('secret', 'café')); unknownAuthority.registerHeld({ global: { ir: globalIr } }, context);
const unknownResult = unknownAuthority.reexecute(globalIr, context, globalCert);
assert.equal(unknownResult.execution.result, 'Null'); assert.deepEqual(unknownResult.partialSites, ['missing-authority']);
unknownAuthority.setReceipt('deny', { schema_hash: sha256(canonicalSchemaJson(membershipSchema)), rows: [], ranges: [], absences: [['members', 'byRoomViewer', [{ String: 'r' }, { Id: 'viewer' }]]], verdicts: [] });
const deniedDomain = unknownAuthority.reexecute(globalIr, context, globalCert);
assert.deepEqual(wireJson(deniedDomain.execution.result), []); assert(!deniedDomain.partialSites.includes('missing-authority'));
console.log('scope coverage, FIFO negative dominance, partial membership and directory authority regressions passed');

const boundedDirectory = new ClientStore(membershipSchema, undefined, { readable: ['messages'] });
for (let i = 0; i < 6; i++) { const row = typed(`scope${i}`, 'quiet'); row.Row.room = { String: `room${i}` }; boundedDirectory.put('messages', row); }
boundedDirectory.registerHeld({ global: { ir: globalIr } }, context);
const overflow = boundedDirectory.reexecute(globalIr, context, globalCert);
assert.deepEqual(wireJson(overflow.execution.result), []);
assert.equal(queryState(globalCert, overflow.execution.trace, context.viewer), 'capped', 'L+1 readable scopes cap even an empty posting result');
boundedDirectory.remove('messages', 'scope5');
assert.equal(queryState(globalCert, boundedDirectory.reexecute(globalIr, context, globalCert).execution.trace, context.viewer), 'complete', 'removing the overflow scope restores full local enumeration, without granting server coverage');
for (const change of [{ before: { Literal: 'Null' } }, { range: { gt: { Literal: { Int: 0 } } } }]) {
  const invalid = structuredClone(globalIr); Object.assign(invalid.body[0].Return.Merge.lanes[0].scan, change);
  assert.throws(() => boundedDirectory.registerHeld({ invalid: { ir: invalid } }, context), { code: 'E_TRACE_SUBSET' });
}
const narrower = structuredClone(globalIr); delete narrower.body[0].Return.Merge.held_search;
narrower.body[0].Return.Merge.lanes[0].source.prefix = [{ Scalar: { Literal: { Id: 'different-principal' } } }];
const narrowerResult = hiddenHistory.reexecute(narrower, context, globalCert);
assert.deepEqual(wireJson(narrowerResult.execution.result), []);
assert(!narrowerResult.execution.held, 'readable source rows do not expand an uncertified narrower discovery domain');

const { PersistentRangeStore } = await import('../../snapback2/src/store/range-store');
const { ProjectionCache, projectState, unprojectState } = await import('../../snapback2/src/store/projection');
let durable: any, failCommit = false;
const projection = new ProjectionCache();
let lastDelta: any;
const carrier = new PersistentRangeStore({ carrier: 'test', open: async () => durable, wipe: async () => { durable = undefined; }, close: async () => {},
  replace: async (s, _bytes, previous, changed) => {
    if (failCommit) throw new Error('carrier transaction failed');
    const p = projection.prepare(s, previous, changed); lastDelta = p.delta; p.committed(); durable = s;
  } });
await carrier.open('viewer');
await carrier.commit({ schema, programs: { g: program }, facts: { generation: 'g', schemaHash, authEpoch: 0 } });
const deliver = (id: string, seq: number): any => ({ op: 'search', args: { ...args, term: id }, state: 'complete', data: [{ $row: { table: 'messages', id } }], next: null, seq,
  rows: [{ table: 'messages', id, row: wireJson(typed(id, 'café', seq)) }], receipt: { ranges: [], absences: [], verdicts: [] }, deliveredAt: seq });
await carrier.commit({ deliveries: Array.from({ length: 100 }, (_, i) => deliver(`c${i}`, 1)), schema });
const cold = await carrier.changes(); assert(cold.snapshot); const retainedRow = cold.snapshot.rows['messages\0c0'];
await carrier.commit({ deliveries: [deliver('c0', 2)], schema });
const warm = await carrier.changes(cold);
assert.equal(warm.snapshot, undefined); assert.equal(Object.keys(warm.records?.rows ?? {}).length, 1);
assert.equal(retainedRow.row.at, 1, 'a delivered snapshot record is immutable across a later commit');
assert.equal(lastDelta.rows.put.length, 1); assert(lastDelta.meta.put.length <= 3, 'metadata writes are bounded changed records');
assert.deepEqual(unprojectState(projectState(durable)), durable, 'carrier projection round trips per-record metadata');
failCommit = true;
await assert.rejects(carrier.commit({ deliveries: [deliver('c0', 3)], schema }), /carrier transaction failed/);
failCommit = false;
const afterFailed = await carrier.changes(warm);
assert.equal(afterFailed.revision, warm.revision); assert.equal(durable.rows['messages\0c0'].row.at, 2);
await carrier.commit({ tombstones: [{ table: 'messages', id: 'c0', seq: 3 }], schema });
const negativeDelta = await carrier.changes(warm);
assert.equal(negativeDelta.records?.negative?.['messages\0c0'], 3);
assert(negativeDelta.removed?.rows?.includes('messages\0c0'));
assert.equal(durable.answers['search\0' + JSON.stringify({ c: null, room: 'r', term: 'c0' })]?.state, 'partial');
console.log('atomic carrier delta, immutable snapshot, metadata and rollback regressions passed');

// A single Q2000 source shared by 100 disjoint ranges is normalized once, including post-execution coverage.
const staticLanes = Array.from({ length: 100 }, (_, i) => ({ scan: { ...scan, site: `lane${i}`, merge_site: 'many',
  prefix: [{ Scalar: { Literal: { String: `r${i}` } } }, scan.prefix[1]] } }));
const manyIr = { ...ir, body: [{ Return: { Merge: { site: 'many', lanes: staticLanes } } }] };
const manyCert = { ...globalCert, read_sites: staticLanes.map(l => ({ site: l.scan.site, hoist: true, decided_true: true })),
  merge_sites: [{ site: 'many', take: 2, lane_sites: staticLanes.map(l => l.scan.site) }], result_pages: {} };
const maximumSource = '\u{10ffff}'.repeat(2000);
const normalize = SearchNormalizer.prototype.normalize;
let normalizations = 0;
SearchNormalizer.prototype.normalize = function (...args) { normalizations++; return normalize.apply(this, args); };
try {
  const many = new ClientStore(schema).reexecute(manyIr, { ...context, args: { ...context.args, term: { String: maximumSource } } }, manyCert);
  assert.equal(many.execution.trace.ranges.length, 100);
  assert.equal(normalizations, 1, 'coverage consumes execution-prepared meaning without unmetered normalization');
  assert((many.execution.trace.derived_steps ?? 0) > 60000);
  assert((many.execution.trace.steps ?? 0) >= (many.execution.trace.derived_steps ?? 0));
  normalizations = 0;
  const admissionIr = structuredClone(manyIr);
  const incoming = staticLanes.map((lane, i) => ({ site: lane.scan.site, table: 'messages', index: 'search',
    prefix: [{ Scalar: `r${i}` }, { WordPrefix: { source: maximumSource, contract: SEARCH_CONTRACT } }] }));
  for (const range of incoming) {
    const atoms = tagWireRangePrefix(schema, range as any, admissionIr);
    prepareRange(schema, { ...range, prefix: atoms }, admissionIr);
  }
  assert.equal(normalizations, 1, 'repeated admission stages and disjoint ranges share bounded prepared meaning');
} finally { SearchNormalizer.prototype.normalize = normalize; }
const wrongTable = structuredClone(schema); wrongTable.tables.other = wrongTable.tables.messages;
assert.throws(() => prepareRange(wrongTable, { site: 'search', table: 'other', index: 'search', prefix: atoms('x') }, ir), /issuing scan/);
assert.throws(() => prepareRange(schema, { site: 'missing', table: 'messages', index: 'search', prefix: atoms('x') }, ir), /issuing scan/);
assert.throws(() => prepareRange(schema, { site: 'search', table: 'messages', index: 'search', prefix: atoms('x') }), /issuing scan/);
assert.throws(() => store.scan('messages', 'search', prefix('unseen'), { Int: 1 }, null, null, 'Asc', 2), /suffix/);

// Later full-image intent timestamps are not positive authority after a tombstone.
for (const status of ['queued', 'sent', 'committed']) {
  mutate(s => {
    s.outbox.newer = { ...entry('newer', 3), issuedSeq: 3, state: status, ...(status === 'committed' ? { response: { seq: 4 } } : {}) };
    s.overlay.newer = [{ table: 'messages', id: 'm1', row: wireJson(typed('m1', 'café', 9)) as any }];
  });
  assert(!((await twin.evaluate('search', args))?.data as any[]).some(r => r.id === 'm1'), `${status} full-image overlay cannot resurrect without authoritative positive`);
}
mutate(s => { s.rows['messages\0m1'] = { table: 'messages', id: 'm1', row: wireJson(typed('m1', 'café', -1)) as any }; s.rowSeq['messages\0m1'] = 5; });
const resurrected = await twin.evaluate('search', args);
assert(resurrected?.next);
assert(((await twin.evaluate('search', { ...args, c: resurrected.next }))?.data as any[]).some(r => r.id === 'm1'), 'new positive authorizes subsequent FIFO image');
assert.deepEqual(serverArguments({ term: 'h1.valid ordinary text', c: 'h1.also text' }), { term: 'h1.valid ordinary text', c: 'h1.also text' });
const replacementPosition: any = { table: 'messages', index: 'ordinary', order: 'Asc', suffix: [{ name: 'id', kind: 'Id' }], values: [{ Id: '\ufffd' }] };
assert.deepEqual(decodeCursor(encodeCursor(replacementPosition)), replacementPosition, 'valid replacement scalar is not malformed UTF-8');

// Several durable swaps between reads remain incremental, and delta retention contains no purged body.
const revisionJournal = new StoreChanges<any>(); revisionJournal.reset();
const inventory: any = { rows: {}, negative: {} }; const startRevision = revisionJournal.read(inventory);
for (let i = 0; i < 4; i++) { inventory.rows.r = { body: `purge-payload-${i}` }; revisionJournal.publish(inventory, new Map([['rows', new Set(['r'])]])); }
delete inventory.rows.r; inventory.negative.r = 5;
revisionJournal.publish(inventory, new Map([['rows', new Set(['r'])], ['negative', new Set(['r'])]]));
const purged = revisionJournal.read(inventory, startRevision);
assert.equal(purged.snapshot, undefined); assert.deepEqual(purged.removed?.rows, ['r']);
assert.equal(purged.records?.negative?.r, 5);
assert(!JSON.stringify(revisionJournal, (_k, v) => v instanceof Map ? [...v] : v instanceof Set ? [...v] : v).includes('purge-payload'), 'retained delta inventory must contain no old row bodies');
const beforeSwaps = await carrier.changes();
for (let i = 0; i < 4; i++) await carrier.commit({ deliveries: [deliver(`c${i + 1}`, i + 3)], schema });
const afterSwaps = await carrier.changes(beforeSwaps);
assert.equal(afterSwaps.snapshot, undefined); assert.equal(Object.keys(afterSwaps.records?.rows ?? {}).length, 4);
console.log('100-lane metering, issuing-site custody, post-negative overlays and payload-free delta history regressions passed');

// Bounded receipt replacement evidence pays for one missing member, not two.
const pageScan = { ...scan, site: 'page', index: 'ordinary', prefix: [{ Scalar: { Variable: 'room' } }], take: { Literal: 20 } };
const pageIr = { ...ir, body: [{ Return: { Scan: pageScan } }] };
const pageCert = { ...operation.certificate, read_sites: [{ site: 'page', hoist: true, decided_true: true }], result_pages: {} };
const pagePool = Array.from({ length: 21 }, (_, i) => ({ table: 'messages', id: `p${i}`, row: typed(`p${i}`, 'body', i) }));
const boundedReceipt: any = { ...ordinaryReceipt, rows: pagePool,
  ranges: [{ ...ordinaryReceipt.ranges[0], site: 'page', take: 20, row_ids: pagePool.slice(0, 20).map(r => r.id), stop: 'Limit', halo: { table: 'messages', id: 'p20' } }] };
const bounded = new ClientStore(schema, boundedReceipt, { program: pageIr });
assert.equal(bounded.reexecute(pageIr, context, pageCert).state, 'fresh');
bounded.remove('messages', 'p0');
assert.equal(bounded.reexecute(pageIr, context, pageCert).state, 'fresh', 'retained halo replaces one deleted member');
bounded.put('messages', { Row: { ...typed('p1', 'body', 1).Row, room: { String: 'elsewhere' } } });
const twoLost = bounded.reexecute(pageIr, context, pageCert);
assert.equal(twoLost.state, 'partial'); assert.equal((wireJson(twoLost.execution.result) as any[]).length, 19);
bounded.put('messages', typed('p0', 'body', 0));
assert.equal(bounded.reexecute(pageIr, context, pageCert).state, 'fresh', 'undo restores the bounded replacement evidence');

// A retained halo proves replacement values, not exhaustion or a terminal cursor.
const pageCursorCert = { ...pageCert, result_pages: { '0': { site: 'page', table: 'messages', index: 'ordinary', order: 'Asc',
  suffix: [{ name: 'at', kind: 'Int' }, { name: 'id', kind: 'Id' }] } } };
for (const id of ['p0','p20']) {
  const page = new ClientStore(schema,boundedReceipt,{ program: pageIr }); page.remove('messages',id);
  const local = page.reexecute(pageIr,context,pageCursorCert);
  assert.equal(local.state,'fresh'); assert.equal(queryState(pageCursorCert,local.execution.trace,context.viewer),'capped');
  assert(local.execution.next); assert.equal(decodeCursor(local.execution.next).values.at(-1).Id,id === 'p0' ? 'p20' : 'p19');
  // Exact Exhausted and Limit owners share an identity but retain different stop evidence.
  const exhausted = structuredClone(boundedReceipt); exhausted.ranges[0].stop = 'Exhausted'; exhausted.ranges[0].halo = null;
  exhausted.rows = exhausted.rows.filter(r => r.id !== id); exhausted.ranges[0].row_ids = exhausted.rows.map(r => r.id);
  page.setReceipt('exhausted1',exhausted); page.setReceipt('exhausted2',exhausted);
  assert.equal(queryState(pageCursorCert,page.reexecute(pageIr,context,pageCursorCert).execution.trace,context.viewer),'complete');
  page.setReceipt('exhausted1');
  assert.equal(queryState(pageCursorCert,page.reexecute(pageIr,context,pageCursorCert).execution.trace,context.viewer),'complete');
  page.setReceipt('exhausted2');
  assert.equal(queryState(pageCursorCert,page.reexecute(pageIr,context,pageCursorCert).execution.trace,context.viewer),'capped');
  page.setReceipt('seed'); assert.equal(page.reexecute(pageIr,context,pageCursorCert).state,'partial');
}
const keyAdmission = new ClientStore(schema,boundedReceipt,{ program: pageIr });
const keyAdmissionBefore = keyAdmission.reexecute(pageIr,context,pageCursorCert);
assert.throws(() => keyAdmission.setReceipt('seed',boundedReceipt,pageIr,() => [{ String: 'wrong-width' }]),/suffix width/);
assert.deepEqual(keyAdmission.reexecute(pageIr,context,pageCursorCert),keyAdmissionBefore,'invalid issuing key preparation preserves the old page proof and rows');

// Wire receipt conversion must validate full suffixes independently of held rows.
for (const index of ['ordinary','search','byId']) {
  const prefix = index === 'search' ? atoms('café') : index === 'ordinary' ? [{ Scalar: { String: 'r' } }] : [];
  const privateRange = { ...boundedReceipt.ranges[0],site: index === 'search' ? 'search' : 'page',index,prefix };
  const wireRange = { ...privateRange,prefix: prefix.map(a => 'Scalar' in a ? { Scalar: wireJson(a.Scalar) } : a),
    ruleHash: privateRange.rule_hash,rowIds: [],stop: 'Exhausted',haloId: undefined };
  const receipt = { ranges: [wireRange],absences: [],verdicts: [] } as any;
  for (const side of ['after','before']) {
    const valid = index === 'byId' ? 'edge' : [0,'edge'];
    assert.doesNotThrow(() => tagReceipt(schema,{ ...receipt,ranges: [{ ...wireRange,[side]: valid }] },ir));
    for (const invalid of index === 'byId' ? [0,['edge','extra']] : [0,[0],['wrong','edge'],[0,7]])
      assert.throws(() => tagReceipt(schema,{ ...receipt,ranges: [{ ...wireRange,[side]: invalid }] },ir));
  }
  const scalar = index === 'byId' ? 'edge' : 0;
  for (const side of ['gt','gte','lt','lte']) {
    assert.doesNotThrow(() => tagReceipt(schema,{ ...receipt,ranges: [{ ...wireRange,[side]: scalar }] },ir));
    assert.throws(() => tagReceipt(schema,{ ...receipt,ranges: [{ ...wireRange,[side]: [scalar] }] },ir));
  }
}

// Page extents remain complete after a local endpoint move; deleting a proof link creates a gap.
const chained = new ClientStore(schema);
for (let i = 0; i < 150; i++) {
  const id = `chain${i}`, row = typed(id, 'café', i); chained.put('messages', row);
  chained.setReceipt(id, { ...ordinaryReceipt, rows: [{ table: 'messages', id, row }], ranges: [{ ...ordinaryReceipt.ranges[0],
    row_ids: [id], take: 1, after: i ? { Array: [{ Int: i - 1 }, { Id: `chain${i - 1}` }] } : null, stop: i === 149 ? 'Exhausted' : 'Limit' }] });
}
assert(chained.hasCompleteRange('messages', 'ordinary', [{ String: 'r' }]));
chained.put('messages', typed('chain70', 'café', 300));
assert(chained.hasCompleteRange('messages', 'ordinary', [{ String: 'r' }]), 'local row motion does not rewrite issued page endpoints');
chained.setReceipt('chain80');
assert(!chained.hasCompleteRange('messages', 'ordinary', [{ String: 'r' }]), 'a missing page proof is a real gap');
const tailOnly = new ClientStore(schema, { ...ordinaryReceipt, ranges: [{ ...ordinaryReceipt.ranges[0], after: { Array: [{ Int: 1 }, { Id: 'a' }] } }] });
assert(!tailOnly.hasCompleteRange('messages', 'ordinary', [{ String: 'r' }]), 'an exhausted tail alone never grants the head');

// A nonempty term with no postings still checks held source authority, independently of membership enumeration.
const directUnknown = new ClientStore(membershipSchema);
directUnknown.put('messages', typed('direct-secret', 'unrelated'));
const directUnknownResult = directUnknown.reexecute(ir, context, operation.certificate);
assert.equal(directUnknownResult.execution.result, 'Null'); assert(directUnknownResult.partialSites.includes('missing-authority'));
assert.equal(directUnknownResult.execution.next, null);
const emptyTerm = directUnknown.reexecute(ir, { ...context, args: { ...context.args, term: { String: '' } } }, operation.certificate);
assert.deepEqual(wireJson(emptyTerm.execution.result), []); assert(!emptyTerm.partialSites.includes('missing-authority'));
const otherRoom = directUnknown.reexecute(ir, { ...context, args: { ...context.args, room: { String: 'other' } } }, operation.certificate);
assert(!otherRoom.partialSites.includes('missing-authority'), 'explicit ordinary scope excludes unrelated unknown authority');
const publicUnseen = await twin.evaluate('search', { ...args, term: 'absent' });
assert.equal(publicUnseen?.state, 'held'); assert.deepEqual(publicUnseen?.data, []);

// Captured aliases and arguments shared by ordinary/search uses preserve exact ordinary bindings.
const aliasIr: any = { ...ir, args: { first: { Text: { max: 2000 } }, scope: { Text: { max: 2000 } } }, body: [
  { Const: { name: 'x', value: { Variable: 'first' } } }, { Const: { name: 'captured', value: { Variable: 'x' } } },
  { Const: { name: 'x', value: { Variable: 'scope' } } }, { Return: { Scan: { ...scan, prefix: [
    { Scalar: { Variable: 'x' } }, { WordPrefix: { ...scan.prefix[1].WordPrefix, source: { Variable: 'captured' } } }] } } },
] };
const aliasOp = { ...operation, ir: aliasIr };
assert.notEqual(localBinding(aliasOp, { first: 'needle', scope: 'Café' }), localBinding(aliasOp, { first: 'needle', scope: 'CAFE\u0301' }));
assert.equal(localBinding(aliasOp, { first: 'Café', scope: 'exact' }), localBinding(aliasOp, { first: 'CAFE\u0301', scope: 'exact' }));
const sharedOp = { ...operation, ir: { ...ir, body: [{ Return: { Scan: { ...scan, prefix: [{ Scalar: { Variable: 'term' } }, scan.prefix[1]] } } }] } };
assert.notEqual(localBinding(sharedOp, { ...args, term: 'Café' }), localBinding(sharedOp, { ...args, term: 'CAFE\u0301' }));
console.log('bounded halo loss, incremental page proof, unseen-term authority and lexical h1 bindings passed');

// Frozen public inConversation recipe shape, actual tagged UTF-8 serialization at the accepted maxima.
const wideId = '"'.repeat(67) + 'a';
assert.equal(Buffer.byteLength(JSON.stringify({ Id: wideId })), 144);
const wideIr = { ...ir, name: 'search.inConversation', args: { c: { Optional: 'Cursor' }, conversation: { Ref: { table: 'conversations' } }, term: { Text: { max: 2000 } } },
  body: [{ Return: { Scan: { ...scan, site: 'search.inConversation.0', index: 'byConversationWords', order: 'Desc', take: { Literal: 20 },
    prefix: [{ Scalar: { Variable: 'conversation' } }, scan.prefix[1]] } } }] };
const wideArgs = { conversation: wideId, term: maximumSource, c: null };
const wideBinding = localBinding({ ...operation, ir: wideIr }, wideArgs);
const wideFence = { partition: wideId, operation: wideIr.name, program: 'p'.repeat(64), schema: 's'.repeat(64), generation: 'g'.repeat(64),
  incarnation: 'i'.repeat(64), revisions: [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER] };
const widePosition: any = { table: 'messages', index: 'byConversationWords', order: 'Desc', suffix: [{ name: 'at', kind: 'Time' }, { name: 'id', kind: 'Id' }],
  values: [{ Int: Number.MAX_SAFE_INTEGER }, { Id: wideId }] };
const wideToken = encodeLocalCursor(wideFence, wideBinding, widePosition);
assert.equal(decodeLocalCursor(wideToken, wideFence, wideBinding), encodeCursor(widePosition));
const wideTagged = tagArguments(wideIr.args, { ...wideArgs, c: wideToken });
const cursorReservation = Buffer.byteLength(JSON.stringify(wideTagged)) + Buffer.byteLength(JSON.stringify({ String: wideToken }));
assert.equal(Buffer.byteLength(maximumSource), 8000);
assert(cursorReservation <= 32768, `actual tagged args plus input/output h1 requires ${cursorReservation} bytes`);
const timedWideFence = { ...wideFence, timed: true, readTime: -Number.MAX_SAFE_INTEGER };
const timedWideToken = encodeLocalCursor(timedWideFence, wideBinding, widePosition);
assert.equal(decodeLocalCursor(timedWideToken, timedWideFence, wideBinding), encodeCursor(widePosition));
const timedReservation = Buffer.byteLength(JSON.stringify(tagArguments(wideIr.args, { ...wideArgs, c: timedWideToken }))) + Buffer.byteLength(JSON.stringify({ String: timedWideToken }));
assert(timedReservation <= 32768);
console.log(`maximum Q2000/144-byte tagged identity h1 reservation: ${cursorReservation} untimed / ${timedReservation} timed bytes of 32768`);

// Actual native v4 provisional-03 artifacts; historical provisional-01 remains a separate custody refusal control.
const actualProgram: any = { generation: 'engine-provisional-03', schema: searchFixtures.schema,
  schemaHash: sha256(canonicalSchemaJson(searchFixtures.schema)), programs: Object.fromEntries(Object.entries(searchFixtures.operations).map(([name, fixture]) => [name, {
    kind: 'query', planHash: fixture.certificate.plan_hash, ir: fixture.program, certificate: fixture.certificate,
  }])) };
for (const op of Object.values<any>(actualProgram.programs)) {
  assert.equal(sha256(canonicalProgramJson(op.ir)), op.certificate.plan_hash);
  assert.equal(actualProgram.schemaHash, op.certificate.schema_hash);
}
assert.equal(Object.keys(decodeHeldProgram(actualProgram)!.programs).length, 4, 'actual provisional03 v4 custody is admitted');
assert.equal(Object.keys(decodeHeldProgram({ ...actualProgram, programs: Object.fromEntries(Object.entries(historicalFixtures.operations).map(([name, fixture]) => [name, {
  kind: 'query', planHash: fixture.certificate.plan_hash, ir: fixture.program, certificate: fixture.certificate,
}])) })!.programs).length, 0, 'v4 custody refuses unchanged historical provisional01 v3 certificates');
const actualGlobal = actualProgram.programs['search.global'];
const actualStore = new ClientStore(searchFixtures.schema);
for (let i = 0; i < 100; i++) {
  const suffix = String(i).padStart(3, '0');
  actualStore.put('memberships', tagWireRow(searchFixtures.schema, 'memberships', { id: `member${suffix}`, conversation: `room${suffix}`, principal: 'viewer' }));
  actualStore.put('messages', tagWireRow(searchFixtures.schema, 'messages', { id: `message${suffix}`, conversation: `room${suffix}`, body: maximumSource, caption: null, at: i }));
}
const actualContext = { ...context, args: { term: { String: maximumSource }, c: 'Null' } };
actualStore.registerHeld(actualProgram.programs, actualContext);
normalizations = 0;
SearchNormalizer.prototype.normalize = function (...args) { normalizations++; return normalize.apply(this, args); };
try {
  const execution = actualStore.reexecute(actualGlobal.ir, actualContext, actualGlobal.certificate).execution;
  assert.equal(normalizations, 1, '100 dynamic required lanes, held preflight and coverage share one source/contract/Q meaning');
  assert.equal(execution.trace.ranges.length, 100);
  assert.deepEqual((wireJson(execution.result) as any[]).map(r => r.id), Array.from({ length: 20 }, (_, i) => `message${String(99 - i).padStart(3, '0')}`));
  assert((execution.trace.steps ?? 0) <= actualGlobal.certificate.max_steps);
  assert((execution.trace.derived_scratch_bytes ?? 0) <= actualGlobal.certificate.derived_scratch_bytes);
} finally { SearchNormalizer.prototype.normalize = normalize; }
// Both descriptor member orders are accepted, but a cached valid descriptor cannot mask extra fields.
const { SearchExecution } = await import('./search-runtime');
const cachedSearch = new SearchExecution(() => {});
const component: any = { WordPrefixes: { fields: ['body'], contract: SEARCH_CONTRACT } };
const canonicalAtom = cachedSearch.atom(component, { WordPrefix: { contract: SEARCH_CONTRACT, source: 'Café' } }, 2000);
assert.equal(cachedSearch.atom(component, { WordPrefix: { source: 'Café', contract: SEARCH_CONTRACT } }, 2000), canonicalAtom);
assert.throws(() => cachedSearch.atom(component, { WordPrefix: { source: 'Café', contract: SEARCH_CONTRACT, extra: 1 } }, 2000), { code: 'E_INPUT' });
assert.throws(() => cachedSearch.atom(component, 2, 2000), { code: 'E_INPUT' });
console.log('actual Rust certificate identities and 100 required dynamic lane normalization passed');

// Public warm direct/global execution shares cursor normalization and accounts for preparation in the Runner ledger.
const publicState = emptyState(), publicChanges = new StoreChanges<typeof publicState>(); publicChanges.reset();
publicState.facts = { generation: actualProgram.generation, schemaHash: actualProgram.schemaHash, authEpoch: 0 };
for (let i = 0; i < 25; i++) {
  const id = `equivalent${String(i).padStart(2, '0')}`;
  publicState.rows[`messages\0${id}`] = { table: 'messages', id, row: { id, conversation: 'one-room', body: 'Café', caption: null, at: i } };
  publicState.rowSeq[`messages\0${id}`] = 1;
}
publicState.rows['memberships\0member'] = { table: 'memberships', id: 'member', row: { id: 'member', conversation: 'one-room', principal: 'viewer' } };
publicState.rowSeq['memberships\0member'] = 1;
const publicTwin = new Twin({ program: () => actualProgram, changes: async since => publicChanges.read(publicState, since), principal: () => 'viewer', now: () => 1, seq: () => 1 });
await publicTwin.evaluate('search.global', { term: 'warmup', c: null });
for (const op of ['search.findPeople', 'search.global']) {
  normalizations = 0; SearchNormalizer.prototype.normalize = function (...args) { normalizations++; return normalize.apply(this, args); };
  let page: any;
  try { page = await publicTwin.evaluate(op, { term: 'Café', c: null }); assert.equal(normalizations, 1, `warm public ${op} normalizes once`); }
  finally { SearchNormalizer.prototype.normalize = normalize; }
  assert.equal(localBinding(actualProgram.programs[op], { term: 'Café', c: null }), localBinding(actualProgram.programs[op], { term: 'CAFE\u0301', c: null }));
  if (op === 'search.global') {
    assert.equal(page.state, 'capped'); assert(page.next.startsWith('h1.'));
    const rest = await publicTwin.evaluate(op, { term: 'CAFE\u0301', c: page.next });
    assert.equal(rest?.state, 'held'); assert.equal((rest?.data as any[]).length, 5);
    assert.equal(new Set([...page.data, ...(rest?.data as any[])].map(row => row.id)).size, 25);
  }
}
const preparedWork = new SearchExecution(); localBinding(actualGlobal, { term: maximumSource, c: null }, preparedWork);
const metered = actualStore.reexecute(actualGlobal.ir, actualContext, actualGlobal.certificate, preparedWork);
assert((metered.execution.trace.derived_steps ?? 0) > 60000, 'cursor preparation is charged to the same execution');
assert.throws(() => actualStore.reexecute(actualGlobal.ir, actualContext, { ...actualGlobal.certificate, max_steps: 1 },
  (() => { const work = new SearchExecution(); localBinding(actualGlobal, { term: maximumSource, c: null }, work); return work; })()), { code: 'E_STEPS' });

// Historical ordinary receipts at a reused site stay pooled; they cannot establish another table/index's coverage.
const reused = { ...ordinaryReceipt, ranges: [{ ...ordinaryReceipt.ranges[0], site: 'page' }] };
const otherScan = { ...pageScan, index: 'byId', prefix: [], after: null, opaque_cursor: false };
const otherIr = { ...pageIr, body: [{ Return: { Scan: otherScan } }] };
const unrelated = new ClientStore(schema, reused, { program: otherIr }).reexecute(otherIr, context, pageCert);
assert.equal(unrelated.state, 'partial'); assert.deepEqual(wireJson(unrelated.execution.result), []);
assert.throws(() => prepareRange(schema, { ...reused.ranges[0], prefix: atoms('Café'), index: 'search' }, otherIr), { code: 'E_INPUT' });

// A declared local query read clock samples once, including cold open; reception time does not stand in for it.
const clockSchema = { tables: {}, maintains: [] }, clockSchemaHash = sha256(canonicalSchemaJson(clockSchema));
const clockIr: any = { name: 'clock', kind: 'Query', args: {}, read_time_granularity_ms: 1, body: [{ Return: { Array: [
  { Input: 'ReadTime' }, { Input: 'ReadTime' }, { Binary: { op: 'Sub', left: { Input: 'ReadTime' }, right: { Literal: { Int: 10 } } } },
] } }] };
const clockOperation: any = { kind: 'query', planHash: sha256(canonicalProgramJson(clockIr)), ir: clockIr,
  certificate: { max_steps: 1000, completeness: 'Complete', read_sites: [], result_pages: {}, read_time_granularity_ms: 1 } };
const clockProgram: any = { generation: 'clock', schemaHash: clockSchemaHash, schema: clockSchema, programs: { clock: clockOperation } };
const clockState = emptyState(), clockChanges = new StoreChanges<typeof clockState>(); clockChanges.reset();
clockState.facts = { generation: 'clock', schemaHash: clockSchemaHash, authEpoch: 0 };
let clock = -7, clockSamples = 0;
const clockTwin = new Twin({ program: () => clockProgram, changes: async since => clockChanges.read(clockState, since), principal: () => 'viewer', now: () => { clockSamples++; return clock; }, seq: () => 1 });
assert.deepEqual((await clockTwin.evaluate('clock', {}))?.data, [-7, -7, -17]); assert.equal(clockSamples, 1);
clock = 23; assert.deepEqual((await clockTwin.evaluate('clock', {}))?.data, [23, 23, 13]); assert.equal(clockSamples, 2);
// Coverage for a time-bounded ordinary scan cannot be reused after its bound changes.
const timedScan = { ...pageScan, after: null, opaque_cursor: false, range: { gt: null, gte: { Input: 'ReadTime' }, lt: null, lte: null } };
const timedIr = { ...pageIr, read_time_granularity_ms: 1, body: [{ Return: { Scan: timedScan } }] };
const timedOp = { ...operation, planHash: sha256(canonicalProgramJson(timedIr)), ir: timedIr, certificate: { ...pageCert, read_time_granularity_ms: 1 } };
const timedProgram = { ...program, programs: { search: timedOp } }, timedState = emptyState(), timedChanges = new StoreChanges<typeof timedState>(); timedChanges.reset();
timedState.facts = state.facts;
const timedReceipt: any = { ranges: [{ ...boundedReceipt.ranges[0], prefix: [{ Scalar: 'r' }], rowIds: [], stop: 'Exhausted', halo: undefined,
  ruleHash: boundedReceipt.ranges[0].rule_hash, gte: 5 }], absences: [], verdicts: [] };
timedState.answers.timed = { op: 'search', args: {}, state: 'complete', data: [], seq: 1, next: null, refs: [], receipt: timedReceipt, deliveredAt: 9000, order: 1 };
clock = 5;
const timedTwin = new Twin({ program: () => timedProgram, changes: async since => timedChanges.read(timedState, since), principal: () => 'viewer', now: () => clock, seq: () => 1 });
assert.equal((await timedTwin.evaluate('search', args))?.state, 'complete');
clock = 6;
const staleTime = await timedTwin.evaluate('search', args);
assert.equal(staleTime?.state, 'partial'); assert.equal(staleTime?.since, 9000, 'receipt reception time is informational only');

// ArgType.Text minima are scalar counts, recursively enforced before any body effect; source columns stay max-only.
const { validateInputs, validateWriteRow } = await import('./value-runtime');
const { CURRENT_EVALUATOR, CURRENT_VALUE_MODEL_VERSION } = await import('./runner');
const minIr = { name: 'minimum', kind: 'Query', args: { text: { Text: { max: 5, min: 2 } }, nested: { Optional: { List: { max: 2, of: { Optional: { Text: { max: 3, min: 1 } } } } } } }, read_time_granularity_ms: null, body: [{ Return: { Literal: 'Null' } }] };
assert.throws(() => new ClientStore(clockSchema).reexecute(minIr, { ...context, args: { text: { String: '😀' }, nested: 'Null' } }), { code: 'E_INPUT' });
validateInputs(clockSchema, minIr, { text: { String: 'e\u0301' }, nested: { Array: ['Null', { String: '😀' }] } });
for (const value of ['', '\ud800', '\u0000']) assert.throws(() => validateInputs(clockSchema, minIr,
  { text: { String: 'ok' }, nested: { Array: [{ String: value }] } }), { code: 'E_INPUT' });
const zeroMin = { ...minIr, args: { text: { Text: { max: 5, min: 0 } } } }, absentMin = { ...zeroMin, args: { text: { Text: { max: 5 } } } };
assert.equal(canonicalProgramJson(zeroMin), canonicalProgramJson(absentMin));
assert.notEqual(canonicalProgramJson(minIr), canonicalProgramJson({ ...minIr, args: { ...minIr.args, text: { Text: { max: 5 } } } }));
assert.match(canonicalProgramJson(minIr), /"Text":\{"max":3,"min":1\}/);
validateWriteRow(schema, 'messages', typed('empty-column', ''));
assert.throws(() => canonicalSchemaJson({ ...schema, tables: { messages: { ...schema.tables.messages, columns: { ...schema.tables.messages.columns, body: { Text: { max: 2000, min: 1 } } } } } }));
// Synthetic custody control, explicitly not an engine-emitted certificate.
const minHash = sha256(canonicalProgramJson(minIr));
const minPacket = { generation: 'synthetic-v5', schema: clockSchema, schemaHash: clockSchemaHash, programs: { minimum: { kind: 'query', planHash: minHash, ir: minIr,
  certificate: { plan_hash: minHash, schema_hash: clockSchemaHash, evaluator_version: CURRENT_EVALUATOR, value_model_version: CURRENT_VALUE_MODEL_VERSION } } } };
assert.equal(Object.keys(decodeHeldProgram(minPacket)!.programs).length, 1);
assert.equal(Object.keys(decodeHeldProgram({ ...minPacket, programs: { minimum: { ...minPacket.programs.minimum, ir: { ...minIr, args: absentMin.args } } } })!.programs).length, 0);
console.log('public direct/global h1 normalization, reused ordinary site, pinned clock and v5 recursive Text.min regressions passed');

// Actual native minimum query plus channel schema proves JS canonical positive-min custody against newly emitted v5 hashes.
const minimum = searchFixtures.minimum, minimumHash = sha256(canonicalSchemaJson(minimum.schema));
assert.equal(minimumHash, minimum.certificate.schema_hash);
assert.equal(sha256(canonicalProgramJson(minimum.program)), minimum.certificate.plan_hash);
const minimumPacket = { generation: 'engine-final-26c9-minimum', schema: minimum.schema, schemaHash: minimumHash,
  programs: { minimum: { kind: 'query', ir: minimum.program, planHash: minimum.certificate.plan_hash, certificate: minimum.certificate } } };
assert.equal(Object.keys(decodeHeldProgram(minimumPacket)!.programs).length, 1);
const minimumStore = new ClientStore(minimum.schema);
for (const term of ['ab', '😀😀', 'e\u0301']) assert.deepEqual(minimumStore.reexecute(minimum.program,
  { ...context, args: { term: { String: term } } }, minimum.certificate).execution.result, { String: term });
for (const term of ['', 'a', '😀', '12345', '\ud800']) assert.throws(() => minimumStore.reexecute(minimum.program,
  { ...context, args: { term: { String: term } } }, minimum.certificate), { code: 'E_INPUT' });
console.log('actual native v5 minimum/query/channel schema identities and scalar admission passed');

// Actual V5 format certificates bind recursive query/channel refinements. The final native raw-IR admission rejects null format.
const formats = searchFixtures.format, formatStore = new ClientStore(formats.schema);
for (const fixture of [formats]) {
  assert.equal(sha256(canonicalProgramJson(fixture.program)), fixture.certificate.plan_hash);
  assert.equal(sha256(canonicalSchemaJson(fixture.schema)), fixture.certificate.schema_hash);
}
const formatPacket = { generation: 'engine-final-26c9-format', schema: formats.schema, schemaHash: formats.certificate.schema_hash,
  programs: { formats: { kind: 'query', ir: formats.program, planHash: formats.certificate.plan_hash, certificate: formats.certificate } } };
assert.equal(Object.keys(decodeHeldProgram(formatPacket)!.programs).length, 1);
const replacedFormat = (format: any) => ({ ...formats.program, args: { ...formats.program.args, handle: { Text: { max: 200, format } } } });
for (const format of [undefined, 'url']) assert.equal(Object.keys(decodeHeldProgram({ ...formatPacket, programs: { formats: {
  ...formatPacket.programs.formats, ir: replacedFormat(format),
} } })!.programs).length, 0, 'omitting or changing a certified format loses custody');
for (const key of ['value_model_version', 'evaluator_version']) assert.equal(Object.keys(decodeHeldProgram({ ...formatPacket,
  programs: { formats: { ...formatPacket.programs.formats, certificate: { ...formats.certificate,
    [key]: (v4Fixtures.minimum.certificate as any)[key] } } } })!.programs).length, 0, `old ${key} cannot admit refined execution`);
assert.equal(Object.keys(decodeHeldProgram({ ...minimumPacket, programs: { minimum: { ...minimumPacket.programs.minimum,
  certificate: v4Fixtures.minimum.certificate } } })!.programs).length, 0, 'historical actual V4 custody is refused');
assert.throws(() => canonicalProgramJson(replacedFormat(null)), /format/);
assert.throws(() => canonicalProgramJson(replacedFormat('email')), /format/);
assert.match(canonicalProgramJson({ ...formats.program, args: { handle: { Text: { format: 'handle', min: 1, max: 200 } } } }),
  /"Text":\{"max":200,"min":1,"format":"handle"\}/);
assert.throws(() => canonicalSchemaJson({ ...schema, tables: { messages: { ...schema.tables.messages,
  columns: { ...schema.tables.messages.columns, body: { Text: { max: 2000, format: 'handle' } } } } } }));
const formatArgs = { handle: { String: 'valid_09' }, items: { Array: [{ String: '' }, { String: 'ok' }] }, link: 'Null' } as any;
const runFormat = (args: any) => formatStore.reexecute(formats.program, { ...context, args }, formats.certificate).execution.result;
assert.equal(runFormat(formatArgs), 'Null');
for (const handle of ['', 'a', '_0', 'a'.repeat(200)]) assert.equal(runFormat({ ...formatArgs, handle: { String: handle } }), 'Null');
for (const handle of ['A', 'é', 'a-b', 'a.b', 'a b', '\t', '\n', '\r', '😀', '\ud800', 'a'.repeat(201)]) {
  assert.throws(() => runFormat({ ...formatArgs, handle: { String: handle } }), { code: 'E_INPUT' });
  assert.throws(() => runFormat({ ...formatArgs, items: { Array: [{ String: handle }] } }), { code: 'E_INPUT' });
}
// These are the existing lexical URL rules: no parser, trim or JS \s (FEFF is admitted; NEL is not).
for (const link of ['http://x', 'https:///', 'https://\u180e', 'https://\u200b', 'https://\ufeff', 'https://😀'])
  assert.deepEqual(runFormat({ ...formatArgs, link: { String: link } }), { String: link });
for (const link of ['', 'http://', 'https://', 'HTTP://x', ' https://x', ...[0, 9, 10, 13, 32, 0x7f, 0x85, 0xa0, 0x1680,
  0x2000, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xd800].map(c => `https://x${String.fromCharCode(c)}`)])
  assert.throws(() => runFormat({ ...formatArgs, link: { String: link } }), { code: 'E_INPUT' });
const guardedFormat = { ...formats.program, kind: 'Mutation', body: [{ Require: { condition: { Literal: { Bool: false } }, code: 'BODY_EXECUTED' } }] };
assert.throws(() => formatStore.applyMutation(guardedFormat, { ...context, args: { ...formatArgs, handle: { String: 'BAD' } } }), { code: 'E_INPUT' });
assert.throws(() => formatStore.applyMutation(guardedFormat, { ...context, args: formatArgs }), { code: 'E_REQUIRE' });
const refinedText = { Text: { max: 10, min: 1, format: 'handle' } };
const nestedFormats = { ...formats.program, args: { nested: { Optional: { List: { max: 2, of: { Optional: refinedText } } } } } };
validateInputs(formats.schema, nestedFormats, { nested: { Array: ['Null', { String: 'good_0' }] } });
for (const value of ['', 'BAD']) assert.throws(() => validateInputs(formats.schema, nestedFormats,
  { nested: { Array: ['Null', { String: value }] } }), { code: 'E_INPUT' });
assert.throws(() => validateInputs(formats.schema, replacedFormat(null), formatArgs), { code: 'E_INPUT' });
const formatState = emptyState(), formatChanges = new StoreChanges<typeof formatState>(); formatChanges.reset();
formatState.facts = { generation: formatPacket.generation, schemaHash: formatPacket.schemaHash, authEpoch: 0 };
const formatTwin = new Twin({ program: () => decodeHeldProgram(formatPacket), changes: async since => formatChanges.read(formatState, since),
  principal: () => 'viewer', now: () => 1, seq: () => 1 });
assert.equal((await formatTwin.evaluate('formats', { handle: '', items: ['a'], link: 'https://\ufeff' }))?.data, 'https://\ufeff');
for (const args of [{ handle: 'UPPER', items: [], link: null }, { handle: 'a', items: ['BAD'], link: null },
  { handle: 'a', items: [], link: 'https://\u0085' }]) await assert.rejects(formatTwin.evaluate('formats', args), /E_INPUT/);
console.log('actual native V5 format/channel custody, recursive scalar admission, preexecution refusal and public Twin parity passed');

// Public is a struct rule, and an explicit Deny is known authority even for an unseen term.
const peopleOp = actualProgram.programs['search.findPeople'];
for (const read of [searchFixtures.schema.tables.people.rules.read, 'Deny']) {
  const definition = { ...searchFixtures.schema, tables: { ...searchFixtures.schema.tables, people: { ...searchFixtures.schema.tables.people,
    rules: { ...searchFixtures.schema.tables.people.rules, read } } } };
  const heldPeople = new ClientStore(definition);
  heldPeople.put('people', tagWireRow(definition, 'people', { id: 'one', name: 'Café', handle: null }));
  for (const term of ['café', 'unseen']) {
    const result = heldPeople.reexecute(peopleOp.ir, { ...context, args: { term: { String: term }, c: 'Null' } }, typeof read === 'string' ? null : peopleOp.certificate);
    assert(!result.partialSites.includes('missing-authority'));
    assert.equal((wireJson(result.execution.result) as any[]).length, typeof read === 'string' || term === 'unseen' ? 0 : 1);
  }
}
// Ordered summaries under insertion/deletion maintain the same union-of-page coverage as an independent interval oracle.
const { CoverageSpans } = await import('./coverage-spans');
let seed = 391;
for (const descending of [false, true]) {
  const spans = new CoverageSpans(descending), intervals = new Map<number, [number | null, number | null]>();
  const tuple = (n: number | null): any => n === null ? null : [{ Int: descending ? -n : n }];
  for (let i = 0; i < 3000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const id = seed % 45, prior = intervals.get(id);
    if (prior) { intervals.delete(id); spans.change(tuple(prior[0]), tuple(prior[1]), -1); }
    else { const start = (seed >>> 8) % 9, end = start + 1 + (seed >>> 16) % 10;
      const pair: [number | null, number | null] = [start === 0 ? null : start, end > 9 ? null : end];
      intervals.set(id, pair); spans.change(tuple(pair[0]), tuple(pair[1]), 1); }
    const expected = [-1, ...Array.from({ length: 10 }, (_, j) => j + 0.5), 100].every(point =>
      [...intervals.values()].some(([a, b]) => (a === null || point > a) && (b === null || point <= b)));
    assert.equal(spans.complete, expected, `page union ${descending}/${i}`);
  }
}
console.log('actual Public/Deny authority and incremental AVL page-union oracle passed');

// Every identity fence refuses before a stale-page restart, including the certified page/suffix layout.
for (const key of ['partition', 'operation', 'program', 'schema', 'generation'] as const)
  assert.throws(() => decodeLocalCursor(token, { ...f, [key]: 'different', revisions: [9, 9, 9] }, binding), error =>
    (error as any).code === 'E_INPUT' && !(error instanceof StaleLocalPage));
assert.throws(() => decodeLocalCursor(token, f, 'other-args'), { code: 'E_INPUT' });
assert.throws(() => decodeLocalCursor('h1.invalid', f, binding), { code: 'E_INPUT' });
assert.throws(() => decodeLocalCursor(token, { ...f, revisions: [9, 9, 9] }, binding,
  [{ table: 'different', index: 'search', order: 'Asc', suffix: [{ name: 'id', kind: 'Id' }] }]), error =>
  (error as any).code === 'E_INPUT' && !(error instanceof StaleLocalPage));
const wrongPageToken = encodeLocalCursor(f, binding, { table: 'messages', index: 'search', order: 'Asc', suffix: [{ name: 'at', kind: 'Int' }], values: [{ Int: 0 }] });
assert.throws(() => decodeLocalCursor(wrongPageToken, { ...f, incarnation: 'reopened' }, binding,
  [{ table: 'messages', index: 'search', order: 'Asc', suffix: [{ name: 'id', kind: 'Id' }] }]), error =>
  (error as any).code === 'E_INPUT' && !(error instanceof StaleLocalPage));
console.log('local cursor operation, binding, partition, schema, program, generation and page/suffix fences passed');

// Independent source/ordering oracle stresses compact posting removal, slot reuse, shared trie nodes and ordinary seeks.
const indexedOracle = new ClientStore(schema), oracleRows = new Map<string, { body: number; room: string; at: number }>();
const oracleBodies = ['Café dog', 'CAFE\u0301 dog', 'quiet', 'Straße', 'STRASSE'], oracleWords = [['café', 'dog'], ['café', 'dog'], ['quiet'], ['straße'], ['strasse']];
for (let i = 0; i < 3000; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const id = `o${seed % 97}`;
  if (seed % 4 === 0) { indexedOracle.remove('messages', id); oracleRows.delete(id); }
  else {
    const row = { body: (seed >>> 7) % oracleBodies.length, room: `r${(seed >>> 12) % 5}`, at: (seed >>> 18) % 20 };
    const value = typed(id, oracleBodies[row.body], row.at); value.Row.room = { String: row.room };
    indexedOracle.put('messages', value); oracleRows.set(id, row);
  }
  if (i % 3) continue;
  const room = `r${(seed >>> 2) % 5}`, term = ['ca', 'café', 'str', 'dog', 'none'][(seed >>> 5) % 5], desc = !!(seed & 1);
  const expected = [...oracleRows].filter(([, row]) => row.room === room && oracleWords[row.body].some(word => word.startsWith(term)))
    .sort(([a, x], [b, y]) => (x.at - y.at || (a < b ? -1 : a > b ? 1 : 0)) * (desc ? -1 : 1)).slice(0, 7).map(([id]) => id);
  const meaning = preparePrefix(schema, 'messages', 'search', [{ Scalar: { String: room } }, { WordPrefix: { source: term, contract: SEARCH_CONTRACT } }], [undefined, 2000]);
  const result = indexedOracle.scan('messages', 'search', meaning, null, null, null, desc ? 'Desc' : 'Asc', 7);
  assert.deepEqual(result.map(row => (wireJson(row) as any).id), expected);
  const ordinaryExpected = [...oracleRows].filter(([, row]) => row.room === room).sort(([a, x], [b, y]) => x.at - y.at || (a < b ? -1 : a > b ? 1 : 0)).slice(0, 7).map(([id]) => id);
  assert.deepEqual(indexedOracle.scan('messages', 'ordinary', [{ Scalar: { String: room } }], null, null, null, 'Asc', 7).map(row => (wireJson(row) as any).id), ordinaryExpected);
}
console.log('3000 compact posting mutations and 2000 ordinary/derived oracle seeks passed');

// Wide supplementary-scalar branches exercise dictionary deletion without changing live prefix identities.
const branches = new ClientStore(schema), branchRows = new Map<string, string>();
for (let i = 0; i < 4096; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const id = `b${seed % 521}`, word = String.fromCodePoint(0xf0000 + (seed >>> 12) % 257, 0xf0200 + (seed >>> 22) % 31) + 'tail';
  if (seed % 5 === 0) { branches.remove('messages', id); branchRows.delete(id); }
  else { branches.put('messages', typed(id, word)); branchRows.set(id, word); }
  if (i % 4) continue;
  const term = [...word].slice(0, i % 8 ? 1 : 2).join('');
  const expected = [...branchRows].filter(([, source]) => source.startsWith(term)).map(([id]) => id).sort();
  assert.deepEqual(branches.scan('messages', 'search', prefix(term), null, null, null, 'Asc', 600).map(row => (wireJson(row) as any).id), expected);
}
for (const id of branchRows.keys()) branches.remove('messages', id);
branches.put('messages', typed('reborn', '\u{f0100}\u{f0200}tail'));
assert.deepEqual(branches.scan('messages', 'search', prefix('\u{f0100}'), null, null, null, 'Asc', 600).map(row => (wireJson(row) as any).id), ['reborn']);
assert.equal(branches.scan('messages', 'search', prefix('\u{f0101}'), null, null, null, 'Asc', 600).length, 0);
console.log('4096 wide Unicode dictionary mutations, 1024 reference seeks and empty-store reuse passed');

// Timed h1 continuations pin the first local execution, without sampling transport or reception clocks.
const pinnedIr = { ...ir, read_time_granularity_ms: 1, body: [{ Return: { Scan: { ...scan,
  range: { gt: null, gte: { Input: 'ReadTime' }, lt: null, lte: null } } } }] };
const pinnedOp = { ...operation, ir: pinnedIr, planHash: sha256(canonicalProgramJson(pinnedIr)),
  certificate: { ...operation.certificate, read_time_granularity_ms: 1 } };
const pinnedProgram = { ...program, programs: { search: pinnedOp } };
const pinnedState = emptyState(), pinnedChanges = new StoreChanges<typeof pinnedState>(); pinnedChanges.reset();
pinnedState.facts = state.facts;
for (let i = 0; i < 4; i++) { const key = `messages\0t${i}`;
  pinnedState.rows[key] = { table: 'messages', id: `t${i}`, row: wireJson(typed(`t${i}`, 'café', i)) as any }; pinnedState.rowSeq[key] = 1; }
let pinnedClock = 0, samples = 0;
const pinnedTwin = new Twin({ program: () => pinnedProgram, changes: async since => pinnedChanges.read(pinnedState, since),
  principal: () => 'viewer', now: () => { samples++; return pinnedClock; }, seq: () => 1 });
const pinnedFirst = await pinnedTwin.evaluate('search', args); assert(pinnedFirst?.next?.startsWith('h1.')); assert.equal(samples, 1);
assert.deepEqual(pinnedFirst.data.map((r: any) => r.id), ['t0', 't1']);
pinnedClock = 2;
const pinnedNext = await pinnedTwin.evaluate('search', { ...args, c: pinnedFirst.next });
assert.deepEqual(pinnedNext.data.map((r: any) => r.id), ['t2', 't3']); assert.equal(samples, 1, 'continuation reuses its first local clock');
assert.deepEqual((await pinnedTwin.evaluate('search', args)).data.map((r: any) => r.id), ['t2', 't3']); assert.equal(samples, 2);
const timedPayload = JSON.parse(pinnedFirst.next.slice(3)); timedPayload[5] = '0';
await assert.rejects(pinnedTwin.evaluate('search', { ...args, c: `h1.${JSON.stringify(timedPayload)}` }), { code: 'E_INPUT' });
console.log('timed local h1 continuation pins one signed execution clock and preserves malformed refusal');

// R1 review: exact native-certified ownership search through public Twin, plus scope-dependent adverse rules.
const { Runner } = await import('./runner');
const { ReadableDirectory } = await import('./held-directory');
const { canonicalJson } = await import('./value-runtime');
const ownershipSchema: any = { tables: { notes: { columns: { id: 'Id', owner: 'Principal', text: { Text: { max: 32 } } },
  indexes: { byId: { components: [col('id')], unique: true }, search: { components: [col('owner'),
    { WordPrefixes: { fields: ['text'], contract: SEARCH_CONTRACT } }, col('id')], unique: false } },
  rules: { read: { Eq: [{ Field: 'owner' }, 'Viewer'] }, insert: 'Deny', update: 'Deny', delete: 'Deny' }, constraints: [], retain: 'until-revoked' } }, maintains: [] };
const ownershipIr: any = { name: 'ownedSearch', kind: 'Query', args: { owner: 'Principal', term: { Text: { max: 32 } }, c: { Optional: 'Cursor' } },
  read_time_granularity_ms: null, body: [{ Return: { Scan: { site: 'owned', table: 'notes', index: 'search',
    prefix: [{ Scalar: { Variable: 'owner' } }, { WordPrefix: { source: { Variable: 'term' }, contract: SEARCH_CONTRACT, source_max: 32 } }],
    order: 'Asc', take: { Literal: 2 }, after: { Variable: 'c' }, before: null, range: null, opaque_cursor: true, merge_site: null, provenance: 'Arg' } } }] };
const ownershipCertificate = searchFixtures.ownershipCertificate;
assert.equal(sha256(canonicalSchemaJson(ownershipSchema)), ownershipCertificate.schema_hash);
assert.equal(sha256(canonicalProgramJson(ownershipIr)), ownershipCertificate.plan_hash);
const ownershipPacket = decodeHeldProgram({ generation: 'a'.repeat(64), schemaHash: ownershipCertificate.schema_hash, schema: ownershipSchema,
  programs: { ownedSearch: { kind: 'query', ir: ownershipIr, planHash: ownershipCertificate.plan_hash, certificate: ownershipCertificate } } })!;
assert(ownershipPacket.programs.ownedSearch);
const ownershipState = emptyState(), ownershipChanges = new StoreChanges<typeof ownershipState>(); ownershipChanges.reset();
ownershipState.facts = { generation: ownershipPacket.generation, schemaHash: ownershipPacket.schemaHash, authEpoch: 0 };
for (const owner of ['viewer', 'other']) {
  ownershipState.rows[`notes\0${owner}`] = { table: 'notes', id: owner, row: { id: owner, owner, text: 'Café' } };
  ownershipState.rowSeq[`notes\0${owner}`] = 1;
}
const ownershipTwin = new Twin({ program: () => ownershipPacket, changes: async since => ownershipChanges.read(ownershipState, since),
  principal: () => 'viewer', now: () => 1, seq: () => 1 });
const ownedAnswer = await ownershipTwin.evaluate('ownedSearch', { owner: 'viewer', term: 'café', c: null });
assert.equal(ownedAnswer?.state, 'held'); assert.deepEqual(ownedAnswer.data, [{ id: 'viewer', owner: 'viewer', text: 'Café' }]);
for (const [owner, term] of [['other', 'café'], ['viewer', 'unseen']]) {
  const answer = await ownershipTwin.evaluate('ownedSearch', { owner, term, c: null });
  assert.equal(answer?.state, 'held'); assert.deepEqual(answer.data, []);
}
const eqOwner = ownershipSchema.tables.notes.rules.read, bodyRule = { Eq: [{ Field: 'text' }, { Literal: { String: 'Café' } }] };
for (const [read, expected] of [[eqOwner, 'allow'], [{ Not: { Ne: eqOwner.Eq } }, 'allow'],
  [{ And: [eqOwner, { Not: 'Deny' }] }, 'allow'], [{ Or: [eqOwner, bodyRule] }, 'allow'],
  [{ And: ['Deny', bodyRule] }, 'deny'], [bodyRule, 'unknown'], [{ Or: [bodyRule, eqOwner] }, 'unknown']] as const) {
  const definition = structuredClone(ownershipSchema); definition.tables.notes.rules.read = read;
  const held = new ClientStore(definition), row = tagWireRow(definition, 'notes', { id: 'one', owner: 'viewer', text: 'Café' }); held.put('notes', row);
  const ctx = { ...context, args: { owner: { Id: 'viewer' }, term: { String: 'café' }, c: 'Null' } };
  assert.equal(new Runner(held, definition, ctx, null).readAuthority('notes', row), expected !== 'deny');
  const result = held.reexecute(ownershipIr, ctx);
  assert.equal(result.partialSites.includes('missing-authority'), expected === 'unknown');
  assert.deepEqual(wireJson(result.execution.result), expected === 'unknown' ? null : expected === 'deny' ? [] : [{ id: 'one', owner: 'viewer', text: 'Café' }]);
  held.remove('notes', 'one'); assert.deepEqual(wireJson(held.reexecute(ownershipIr, ctx).execution.result), []);
}
console.log('native-certified ownership/public Twin allow/deny/unseen and scope-uniform compound rule controls passed');

// After unrelated hydration, first direct search must not enumerate or refresh retained scope history.
for (const count of [20, 80]) {
  const state = emptyState(), changes = new StoreChanges<typeof state>(); changes.reset();
  state.facts = { generation: actualProgram.generation, schemaHash: actualProgram.schemaHash, authEpoch: 0 };
  for (let i = 0; i < count; i++) for (const record of [
    { table: 'messages', id: `m${i}`, row: { id: `m${i}`, conversation: `room${i}`, body: 'Café', caption: null, at: i } },
    { table: 'memberships', id: `u${i}`, row: { id: `u${i}`, conversation: `room${i}`, principal: 'viewer' } },
  ]) { state.rows[`${record.table}\0${record.id}`] = record; state.rowSeq[`${record.table}\0${record.id}`] = 1; }
  const twin = new Twin({ program: () => actualProgram, changes: async since => changes.read(state, since), principal: () => 'viewer', now: () => 1, seq: () => 1 });
  await twin.evaluate('search.findPeople', { term: 'warm', c: null });
  const index = (twin as any).indexed.store.index('messages', 'byConversationWords');
  const seek = index.scopes.seek, refresh = ReadableDirectory.prototype.refresh;
  index.scopes.seek = () => { throw new Error('warm direct query enumerated scopes'); };
  ReadableDirectory.prototype.refresh = () => { throw new Error('warm direct query refreshed a directory'); };
  try {
    const first = await twin.evaluate('search.inConversation', { conversation: 'room0', term: 'café', c: null });
    assert.equal(first?.state, 'held'); assert.equal((first.data as any[])[0].id, 'm0');
    assert.deepEqual((await twin.evaluate('search.inConversation', { conversation: 'room0', term: 'unseen', c: null }))?.data, []);
  } finally { index.scopes.seek = seek; ReadableDirectory.prototype.refresh = refresh; }
}
console.log('first warm direct operation at 20/80 retained scopes performs no scope enumeration/directory refresh');

// Receipt ownership contributes to a maintained verdict; identical history cannot make warm reads more expensive.
const authoritySchema = structuredClone(searchFixtures.schema); authoritySchema.tables.memberships.rules.read = 'Deny' as any;
authoritySchema.tables.messages.rules.delete = 'Allow' as any; // Synthetic rollback must reach its write before the explicit refusal.
const authorityHash = sha256(canonicalSchemaJson(authoritySchema));
const authorityRule = scopedRuleHash(authoritySchema, authoritySchema.tables.messages.rules.read);
const authorityDigest = sha256(canonicalJson(['memberships', 'byConversationPrincipal', ['room', 'viewer']]));
const authorityContext = { ...context, args: { conversation: { Id: 'room' }, term: { String: 'café' }, c: 'Null' } };
const directIr = searchFixtures.operations['search.inConversation'].program;
const authorityVerdict = { rule_hash: authorityRule, pinned_inputs_digest: authorityDigest, principal: 'viewer', auth_epoch: 0, result: true };
for (const count of [20, 80, 2000]) {
  const held = new ClientStore(authoritySchema), row = tagWireRow(authoritySchema, 'messages', { id: 'one', conversation: 'room', body: 'Café', caption: null, at: 1 });
  held.put('messages', row); let reads = 0;
  const verdict = { ...authorityVerdict, get result() { reads++; return true; } };
  const receipt = { schema_hash: authorityHash, rows: [], ranges: [], absences: [], verdicts: [verdict] };
  for (let i = 0; i < count; i++) held.setReceipt(`owner${i}`, receipt);
  reads = 0;
  const result = held.reexecute(directIr, authorityContext);
  assert(!result.partialSites.includes('missing-authority')); assert.equal((wireJson(result.execution.result) as any[]).length, 1);
  assert.equal(reads, 0, `${count} held receipts must not be consulted on a warm read`);
  const check = (expected: boolean | null) => {
    assert.equal(held.verdict(authorityRule, authorityDigest, authorityContext), expected);
    const result = held.reexecute(directIr, authorityContext);
    assert.equal(result.partialSites.includes('missing-authority'), expected === null);
    assert.deepEqual(wireJson(result.execution.result), expected === null ? null : expected ? [wireJson(row)] : []);
  };
  held.setReceipt('conflict', { ...receipt, verdicts: [{ ...authorityVerdict, result: false }] }); check(null);
  held.setReceipt('conflict', { ...receipt, verdicts: [{ ...authorityVerdict, result: true }] }); check(true);
  held.setReceipt('conflict');
  for (let i = 0; i < count - 1; i++) held.setReceipt(`owner${i}`); check(true);
  held.setReceipt(`owner${count - 1}`, { ...receipt, verdicts: [{ ...authorityVerdict, result: false }] }); check(false);
  held.setReceipt(`owner${count - 1}`); check(null);
  held.setReceipt('duplicates', { ...receipt, verdicts: [authorityVerdict, authorityVerdict, { ...authorityVerdict, result: false }] }); check(null);
  held.setReceipt('duplicates', { ...receipt, verdicts: [authorityVerdict, authorityVerdict] }); check(true);
  assert.throws(() => held.setReceipt('duplicates', { ...receipt, verdicts: [{ ...authorityVerdict, result: 1 } as any] }), { code: 'E_INPUT' }); check(true);
  const badRange = { ...ordinaryReceipt.ranges[0], table: 'missing' };
  assert.throws(() => held.setReceipt('duplicates', { ...receipt, ranges: [badRange], verdicts: [{ ...authorityVerdict, result: false }] })); check(true);
  const beforeRow = held.byId('messages', 'one');
  assert.throws(() => held.applyMutation({ name: 'rollback', kind: 'Mutation', args: {}, body: [
    { Delete: { table: 'messages', key: { Literal: { Id: 'one' } } } }, { Require: { condition: { Literal: { Bool: false } }, code: 'ROLLBACK' } },
  ] }, { ...authorityContext, args: {} }), { code: 'E_REQUIRE' });
  assert.equal(held.byId('messages', 'one'), beforeRow); check(true);
  assert.equal(held.verdict(authorityRule, authorityDigest, { ...authorityContext, auth_epoch: 1 }), null);
  assert.equal(held.verdict(authorityRule, authorityDigest, { ...authorityContext, viewer: 'other' }), null);
  held.setReceipt('duplicates'); check(null);
}
console.log('20/80/2000-owner verdict work stays constant; disagreement, duplicates, replacement/removal and rollback controls passed');

// Scope churn must reclaim dependency metadata, and shared dependencies survive until their last scope disappears.
const churn = new ClientStore(searchFixtures.schema); churn.registerHeld({ global: { ir: searchFixtures.operations['search.global'].program } }, context);
const directory: any = [...(churn as any).directories.values()][0];
for (let i = 0; i < 2000; i++) {
  churn.put('messages', tagWireRow(searchFixtures.schema, 'messages', { id: 'one', conversation: `old${i}`, body: 'Café', caption: null, at: 1 }));
  churn.remove('messages', 'one');
}
assert.equal(churn.rows('messages').length, 0);
for (const name of ['entries', 'allowed', 'unknown', 'dependencies', 'digests']) assert.equal(directory[name].size, 0, name);
// Synthetic directory-level control: two scopes depend on the same constant authority point.
const sharedSchema = structuredClone(authoritySchema), sharedRule: any = sharedSchema.tables.messages.rules.read;
sharedRule.Exists.key[0] = { Literal: { Id: 'room' } };
const shared = new ClientStore(sharedSchema), sharedHash = sha256(canonicalSchemaJson(sharedSchema));
const sharedVerdict = { ...authorityVerdict, rule_hash: scopedRuleHash(sharedSchema, sharedRule) };
const sharedReceipt = { schema_hash: sharedHash, rows: [], ranges: [], absences: [], verdicts: [sharedVerdict] };
const sharedIndex = shared.index('messages', 'byConversationWords');
const sharedDirectory: any = new ReadableDirectory(sharedIndex, { scope: [{ value: { Field: { base: { Variable: 'm' }, name: 'conversation' } } }],
  discovery: { binding: 'm' } }, 'viewer', row => new Runner(shared, sharedSchema, context, null).readAuthority('messages', row));
const scope = (room: string): any[] => [{ Id: room }];
for (const room of ['left', 'right']) {
  shared.put('messages', tagWireRow(sharedSchema, 'messages', { id: room, conversation: room, body: 'Café', caption: null, at: 1 })); sharedDirectory.refresh(scope(room));
}
assert(sharedDirectory.select([], 10).missing); assert.equal(sharedDirectory.dependencies.size, 1); assert.equal(sharedDirectory.digests.size, 1);
shared.setReceipt('proof', sharedReceipt); sharedDirectory.touchDigest(authorityDigest);
assert.equal(sharedDirectory.select([], 10).scopes.length, 2);
shared.remove('messages', 'left'); sharedDirectory.refresh(scope('left'));
assert.equal(sharedDirectory.dependencies.size, 1); assert.equal(sharedDirectory.select([], 10).scopes.length, 1);
shared.setReceipt('proof', { ...sharedReceipt, verdicts: [{ ...sharedVerdict, result: false }] });
sharedDirectory.touch(canonicalJson(['memberships', 'byConversationPrincipal', ['room', 'viewer']]));
assert.deepEqual(sharedDirectory.select([], 10), { scopes: [], overflow: false, missing: false });
shared.setReceipt('proof'); sharedDirectory.touchDigest(authorityDigest); assert(sharedDirectory.select([], 10).missing);
shared.remove('messages', 'right'); sharedDirectory.refresh(scope('right'));
for (const name of ['entries', 'allowed', 'unknown', 'dependencies', 'digests']) assert.equal(sharedDirectory[name].size, 0, name);
shared.put('messages', tagWireRow(sharedSchema, 'messages', { id: 'left', conversation: 'left', body: 'Café', caption: null, at: 1 }));
sharedDirectory.refresh(scope('left')); shared.setReceipt('proof', sharedReceipt); sharedDirectory.touchDigest(authorityDigest);
assert.deepEqual(sharedDirectory.select([], 10).scopes, [scope('left')]);
console.log('2000 deleted scopes reclaim directory metadata; shared dependency touch/digest, denial, clear and repopulation passed');

{
  const held = new ClientStore(authoritySchema);
  held.registerHeld({ global: { ir: searchFixtures.operations['search.global'].program } }, context);
  held.put('messages', tagWireRow(authoritySchema, 'messages', { id: 'one', conversation: 'room', body: 'Café', caption: null, at: 1 }));
  const directory: any = [...(held as any).directories.values()][0];
  const receipt: any = { schema_hash: authorityHash, rows: [], ranges: [], absences: [], verdicts: [authorityVerdict] };
  const selection = () => directory.select([], 10);
  const check = (expected: boolean | null) => {
    assert.equal(held.verdict(authorityRule, authorityDigest, authorityContext), expected);
    assert.deepEqual(selection(), { scopes: expected === true ? [[{ Id: 'room' }]] : [], overflow: false, missing: expected === null });
  };
  check(null); held.setReceipt('proof', receipt); check(true);
  const refresh = directory.refresh, observed: Array<boolean | null> = [];
  directory.refresh = function(scope: any) {
    observed.push(held.verdict(authorityRule, authorityDigest, authorityContext)); return refresh.call(this, scope);
  };
  held.setReceipt('proof', { ...receipt, verdicts: [{ ...authorityVerdict, result: false }] }); check(false);
  assert(observed.length > 0); assert(observed.every(v => v === false), 'old and new invalidations see installed denial');
  held.setReceipt('proof', receipt); check(true);
  const range = { ...ordinaryReceipt.ranges[0], table: 'messages', index: 'byConversationWords', prefix: [], row_ids: ['one'] };
  for (const malformed of [
    { ...receipt, ranges: [range] }, // A held row elsewhere is not the replacement's receipt pool.
    { ...receipt, ranges: [{ ...range, row_ids: [], halo: { table: 'messages', id: 'one' } }] },
    { ...receipt, ranges: [{ ...range, row_ids: [], halo: { table: 'memberships', id: 'one' } }] },
    { ...receipt, ranges: [{ ...range, site: 'missing-Q', row_ids: [], prefix: [{ Scalar: { Id: 'room' } }, atoms('café')[1]] }] },
    { ...receipt, verdicts: [{ ...authorityVerdict, result: 1 }] },
  ]) {
    observed.length = 0;
    assert.throws(() => held.setReceipt('proof', malformed), { code: 'E_INPUT' });
    assert.deepEqual(observed, [], 'invalid replacement must notify no directory'); check(true);
  }
  observed.length = 0; held.setReceipt('proof'); check(null);
  assert(observed.length > 0); assert(observed.every(v => v === null));
  held.remove('messages', 'one');
  for (const name of ['entries', 'allowed', 'unknown', 'dependencies', 'digests']) assert.equal(directory[name].size, 0, name);

  // Readable authority points use absence invalidation, including removal of the old point.
  const points = new ClientStore(membershipSchema);
  points.registerHeld({ global: { ir: globalIr } }, context); points.put('messages', typed('one', 'Café'));
  const pointDirectory: any = [...(points as any).directories.values()][0];
  const absent = { schema_hash: sha256(canonicalSchemaJson(membershipSchema)), rows: [], ranges: [],
    absences: [['members', 'byRoomViewer', [{ String: 'r' }, { Id: 'viewer' }]]], verdicts: [] } as any;
  assert(pointDirectory.select([], 10).missing);
  points.setReceipt('point', absent); assert.equal(pointDirectory.select([], 10).missing, false);
  points.setReceipt('point', { ...absent, absences: [['members', 'byRoomViewer', [{ String: 'other' }, { Id: 'viewer' }]]] });
  assert(pointDirectory.select([], 10).missing, 'replacement invalidates the removed authority point');
  points.setReceipt('point', absent); points.setReceipt('point'); assert(pointDirectory.select([], 10).missing);
}
console.log('registered directory receipt replacement observes final authority and failed admission changes nothing passed');

// Deterministic strong-reference witness over own data properties, Maps and Sets;
// it does not depend on GC scheduling and does not claim a whole-process heap measurement.
function reachableValue(root: unknown, predicate: (value: any) => boolean): boolean {
  const seen = new Set<object>(), pending: unknown[] = [root];
  while (pending.length) {
    const value = pending.pop(); if (predicate(value)) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (value instanceof Map) for (const [key, item] of value) pending.push(key, item);
    else if (value instanceof Set) pending.push(...value);
    else if (!ArrayBuffer.isView(value)) for (const property of Object.values(Object.getOwnPropertyDescriptors(value)))
      if ('value' in property) pending.push(property.value);
  }
  return false;
}
{
  const row = tagWireRow(authoritySchema, 'messages', { id: 'one', conversation: 'room', body: 'Café', caption: null, at: 1 });
  const receipt = { schema_hash: authorityHash, rows: [{ table: 'messages', id: 'one', row }], ranges: [], absences: [], verdicts: [authorityVerdict] };
  const held = new ClientStore(authoritySchema, receipt);
  held.registerHeld({ global: { ir: searchFixtures.operations['search.global'].program } }, context);
  const directory: any = [...(held as any).directories.values()][0];
  assert.equal(directory.select([], 10).scopes.length, 1);
  assert.equal(held.rehydrate({ ...receipt, verdicts: [] }), 0);
  assert.equal(held.verdict(authorityRule, authorityDigest, authorityContext), null);
  assert.deepEqual(directory.select([], 10), { scopes: [], missing: true, overflow: false });
  held.setReceipt('later-owner', receipt);
  assert.equal(directory.select([], 10).scopes.length, 1);
  held.rehydrate({ ...receipt, verdicts: [] });
  assert.deepEqual(directory.select([], 10), { scopes: [], missing: true, overflow: false });
  held.rehydrate({ ...receipt, rows: [], verdicts: [] });
  for (const name of ['entries', 'allowed', 'unknown', 'dependencies', 'digests']) assert.equal(directory[name].size, 0, name);
}
console.log('standalone rehydrate invalidates removed receipt authority after installing replacement coverage passed');
{
  const held = new ClientStore(schema), payload = 'obsolete receipt body with several distinct words';
  const query = { ...pageIr, body: [{ Return: { Scan: { ...pageScan, take: { Literal: 2 } } } }] };
  (() => {
    const rows = ['owned-a', 'owned-b', 'owned-halo'].map((id, at) => ({ table: 'messages', id, row: typed(id, payload, at) }));
    for (const row of rows) held.put(row.table, row.row);
    held.setReceipt('page', { ...ordinaryReceipt, rows, ranges: [{ ...ordinaryReceipt.ranges[0], site: 'page', take: 2,
      row_ids: ['owned-a', 'owned-b'], stop: 'Limit', halo: { table: 'messages', id: 'owned-halo' } }],
      absences: [['messages', 'byId', [{ Id: 'missing' }]]],
      verdicts: [{ rule_hash: 'retained-rule', pinned_inputs_digest: 'retained-inputs', principal: 'viewer', auth_epoch: 0, result: true }] });
  })(); // No test-owned receipt/row object survives this input lifetime.
  assert.equal(held.reexecute(query, context, pageCert).state, 'fresh');
  assert(reachableValue(held, value => value === payload), 'current row table owns the live payload');
  for (const id of ['owned-a', 'owned-b', 'owned-halo']) held.remove('messages', id);
  assert.equal(held.rows('messages').length, 0);
  assert.equal(held.reexecute(query, context, pageCert).state, 'partial', 'lost member/halo coverage remains in force');
  assert(held.hasAbsence('messages', 'byId', [{ Id: 'missing' }]));
  assert.equal(held.verdict('retained-rule', 'retained-inputs', context), true);
  assert(reachableValue(held, value => value?.Id === 'owned-a'), 'coverage keeps the expected ordinary index key');
  assert.equal(reachableValue(held, value => value === payload), false, 'no obsolete full receipt payload survives current-row removal');
  assert.equal(reachableValue(held, value => !!value && typeof value === 'object' && Object.hasOwn(value, 'Row')), false);
  for (const [at, id] of ['owned-a', 'owned-b', 'owned-halo'].entries()) held.put('messages', typed(id, 'replacement payload', at));
  assert.equal(held.reexecute(query, context, pageCert).state, 'fresh', 'expected positions still restore exact coverage');
  held.setReceipt('page');
  assert.equal(held.reexecute(query, context, pageCert).state, 'partial');
  assert.equal(held.hasAbsence('messages', 'byId', [{ Id: 'missing' }]), false);
  assert.equal(held.verdict('retained-rule', 'retained-inputs', context), null);
}
console.log('receipt coverage retains expected keys and authority without retaining removed full row bodies passed');

// Closed-extent admission seeks in both directions; the independent oracle uses plain scoped numeric intervals.
const { FactIndex } = await import('../../snapback2/src/store/fact-index');
const { ExtentIndex } = await import('../../snapback2/src/store/extent-index');
const factIndex = new FactIndex(schema,true), extentIndex = new ExtentIndex();
const facts: any[] = [], extents: any[] = [];
for (let i = 0; i < 2000; i++) {
  const room = `r${i % 40}`, at = (i * 17) % 1000, id = `f${i}`, seq = i % 3;
  const keys = { ordinary: [{ Scalar: { String: room } },{ Scalar: { Int: at } },{ Scalar: { Id: id } }],
    search: [{ Scalar: { String: room } },{ Words: i % 2 ? ['café','東京'] : ['quiet'] },{ Scalar: { Int: at } },{ Scalar: { Id: id } }] };
  const fact = { id,key: id,table: 'messages',rowId: id,seq,digest: id,keys };
  factIndex.change(fact,2); facts.push({ ...fact,room,at });
  const term = i % 3 ? 'caf' : '東', derived = i % 2 !== 0;
  const condition: any = { site: id,ruleHash: 'oracle-rule',op: 'oracle',table: 'messages',index: derived ? 'search' : 'ordinary',
    prefix: derived ? preparePrefix(schema,'messages','search',[{ Scalar: { String: room } },{ WordPrefix: { source: term,contract: SEARCH_CONTRACT } }],[undefined,2000]) : [{ Scalar: { String: room } }],
    order: i % 3 ? 'Asc' : 'Desc',after: null,before: null,gt: [{ Int: at - 1 }],gte: null,lt: [{ Int: at + 85 }],lte: null,present: [] };
  extentIndex.change(id,condition,seq,2); extents.push({ id,condition,seq,room,at,term,derived });
}
for (let i = 0; i < 100; i++) {
  const f = facts[(i * 37) % facts.length], c = extents[(i * 41) % extents.length];
  const expectedExtents = extents.filter(e => e.seq >= f.seq && e.room === f.room && f.at >= e.at && f.at < e.at + 85
    && (!e.derived || f.keys.search[1].Words.some((w: string) => w.startsWith(e.term)))).map(e => e.id).sort();
  assert.deepEqual([...extentIndex.matching('messages',f.keys,f.seq)].map(e => e.id).sort(),expectedExtents);
  const expectedFacts = facts.filter(f => f.seq === c.seq && f.room === c.room && f.at >= c.at && f.at < c.at + 85
    && (!c.derived || f.keys.search[1].Words.some((w: string) => w.startsWith(c.term)))).map(f => f.id).sort();
  assert.deepEqual([...factIndex.matching(c.condition,c.seq)].map(f => f.id).sort(),expectedFacts);
}
for (let i = facts.length - 1; i >= 0; i--) {
  factIndex.change(facts[i],-1); extentIndex.change(extents[i].id,extents[i].condition,extents[i].seq,-1);
}
assert.equal((factIndex as any).records.size,2000,'shared proof owners preserve indexed facts');
for (let i = 0; i < facts.length; i++) {
  factIndex.change(facts[i],-1); extentIndex.change(extents[i].id,extents[i].condition,extents[i].seq,-1);
}
for (const name of ['records','indexes','missing']) assert.equal((factIndex as any)[name].size,0,`fact ${name} leaves after its last owner`);
for (const name of ['entries','buckets','tables']) assert.equal((extentIndex as any)[name].size,0,`extent ${name} leaves after its last owner`);
const opaque = { ...facts[0],keys: undefined };
factIndex.change(opaque,2); assert.equal(factIndex.opaque('messages',opaque.seq)?.id,opaque.id);
factIndex.change(facts[0],1); assert.equal(factIndex.opaque('messages',opaque.seq),undefined,'authenticated full keys upgrade shared opaque custody');
factIndex.change(facts[0],-3); assert.equal((factIndex as any).indexes.size,0);
const emptyCondition = { ...extents[1].condition,prefix: preparePrefix(schema,'messages','search',[
  { Scalar: { String: 'r1' } },{ WordPrefix: { source: '',contract: SEARCH_CONTRACT } }],[undefined,2000]) };
factIndex.change(facts[1],1);
assert.deepEqual([...factIndex.matching(JSON.parse(JSON.stringify(emptyCondition)),facts[1].seq)],[],'persisted empty search never becomes a wildcard');
assert.throws(() => factIndex.change({ ...facts[0],id: 'oversize',keys: { search: [facts[0].keys.search[0],{ Words: ['x'.repeat(4 * 2050 + 1)] },...facts[0].keys.search.slice(2)] } },1), /source bounds/);
console.log('2000 scoped ordinary/Unicode extent and positive indexes match 200 independent oracles; shared GC, opaque upgrade and posting bounds passed');

// Live and immutable assertions share prepared images while keeping exact indexed namespaces.
const history = new FactIndex(schema,true), live = new FactIndex(schema,false,history);
const current = facts.filter((_,i) => i % 3 === 0);
for (const fact of facts) history.change(fact,2);
for (const fact of current) live.change({ ...fact,seq: 99 },1);
for (const index of (history as any).indexes.values()) {
  assert.equal(index.scopes.size,0,'fact namespaces do not build an unused readable directory');
  const records = [...index.reverse.values()] as any[];
  assert.equal(new Set(records.map(r => r.keys)).size,facts.length,'one prepared tuple/word-handle array per immutable image');
}
for (let i = 0; i < 100; i++) {
  const c = extents[(i * 41) % extents.length];
  const matches = (f: any) => f.room === c.room && f.at >= c.at && f.at < c.at + 85
    && (!c.derived || f.keys.search[1].Words.some((w: string) => w.startsWith(c.term)));
  assert.deepEqual([...live.matching(c.condition)].map(f => f.id).sort(),current.filter(matches).map(f => f.id).sort());
  assert.deepEqual([...history.matching(c.condition,c.seq)].map(f => f.id).sort(),facts.filter(f => f.seq === c.seq && matches(f)).map(f => f.id).sort());
}
for (const fact of facts) history.change(fact,-2);
assert.equal((history as any).records.size,0);
assert.ok((history as any).indexes.size,'live ownership keeps shared dictionaries and postings after proof GC');
for (const fact of current) live.change(fact,-1);
assert.equal((history as any).indexes.size,0,'the last live owner reclaims shared physical indexes');
for (const fact of facts.slice(0,20)) { history.change(fact,1); live.change(fact,1); }
for (const fact of facts.slice(0,20)) { live.change(fact,-1); history.change(fact,-1); }
assert.equal((history as any).indexes.size,0,'reverse deletion order and reused key identities also release every owner');
console.log('shared live/proof postings preserve 200 independent exact-namespace oracles and last-owner GC');


// Keep the inherited cases independent so the direct assertion entry reports both.
const coverageFailures: unknown[] = [];
for (const [name, exercise] of [
  ['duplicate absence ownership', () => {
    const held = new ClientStore(membershipSchema);
    held.registerHeld({ global: { ir: globalIr } },context); held.put('messages',typed('one','Café'));
    const directory: any = [...(held as any).directories.values()][0], key = [{ String: 'r' },{ Id: 'viewer' }];
    const hash = sha256(canonicalSchemaJson(membershipSchema));
    // Real decoder/tagger, synthetic input; no native emission claim.
    const wire = decodeDeliveryEnvelope({ protocol: 1,generation: 'a'.repeat(64),schemaHash: hash,planHash: 'b'.repeat(64),
      authority: { principal: 'viewer',authEpoch: 0 },state: 'complete',data: null,next: null,seq: 1,rows: [],
      receipt: { ranges: [],absences: [['messages','byId',['missing']],['messages','byId',['missing']]],verdicts: [] },validator: 'c'.repeat(64) });
    const decoded: any = { schema_hash: hash,rows: [],...tagReceipt(membershipSchema,wire.receipt) };
    const publicPoints = new ClientStore(membershipSchema); publicPoints.setReceipt('decoded',decoded);
    assert(publicPoints.hasAbsence('messages','byId',[{ Id: 'missing' }])); publicPoints.setReceipt('decoded');
    assert(!publicPoints.hasAbsence('messages','byId',[{ Id: 'missing' }]));
    // Standalone readable-input authority also uses indexed point identities.
    const proof: any = { ...decoded,absences: [['members','byRoomViewer',key],['members','byRoomViewer',key]] };
    const verdict = { rule_hash: 'test-rule',pinned_inputs_digest: 'test-digest',principal: 'viewer',auth_epoch: 0,result: true };
    const refresh = directory.refresh, observed: any[] = [];
    directory.refresh = function(scope: any) { observed.push([held.hasAbsence('members','byRoomViewer',key),held.verdict('test-rule','test-digest',context)]); return refresh.call(this,scope); };
    const expect = (absent: boolean, verdict: boolean|null) => {
      assert.equal(held.hasAbsence('members','byRoomViewer',key),absent); assert.equal(directory.select([],10).missing,!absent);
      assert.equal(held.verdict('test-rule','test-digest',context),verdict); assert(observed.length > 0);
      assert(observed.every(v => v[0] === absent && v[1] === verdict)); observed.length = 0;
    };
    held.setReceipt('one',{ ...proof,verdicts: [verdict,verdict] }); expect(true,true);
    held.setReceipt('two',{ ...proof,verdicts: [{ ...verdict,result: false }] }); expect(true,null);
    held.setReceipt('one'); expect(true,false);
    held.setReceipt('two',{ ...proof,absences: [],verdicts: [{ ...verdict,result: false }] }); expect(false,false);
    held.setReceipt('two',proof); expect(true,null); held.setReceipt('two'); expect(false,null);
    held.setReceipt('last',proof); expect(true,null); held.setReceipt('last'); expect(false,null);
    held.remove('messages','one');
    for (const field of ['entries','allowed','unknown','dependencies','digests']) assert.equal(directory[field].size,0,field);
  }],
  ['atomic standalone rehydrate', () => {
    const issuing = searchFixtures.operations['search.global'].program;
    const row = tagWireRow(authoritySchema,'messages',{ id: 'one',conversation: 'room',body: 'Café',caption: null,at: 1 });
    const seed: any = { schema_hash: authorityHash,rows: [{ table: 'messages',id: 'one',row }],ranges: [],
      absences: [['messages','byId',[{ Id: 'missing' }]]],verdicts: [authorityVerdict] };
    const held = new ClientStore(authoritySchema,seed,{ program: issuing });
    held.registerHeld({ global: { ir: issuing } },context); held.setReceipt('nonseed',seed);
    const directory: any = [...(held as any).directories.values()][0], initial = held.byId('messages','one');
    const roots = ['tables','indexes','facts','directories'].map(k => [k,(held as any)[k]] as const);
    const indexState = () => [...(held as any).indexes].map(([key,i]: any) => [key,i.size,i.generation]);
    const indexesBefore = indexState(), directoryState = () => ['entries','allowed','unknown','dependencies','digests'].map(k => [k,directory[k].size]);
    const directoryBefore = directoryState(), selection = directory.select([],10), refresh = directory.refresh; const notifications: Array<boolean|null> = [];
    directory.refresh = function(scope: any) { notifications.push(held.verdict(authorityRule,authorityDigest,authorityContext));return refresh.call(this,scope); };
    const range: any = { ...ordinaryReceipt.ranges[0],table: 'messages',index: 'byConversationWords',row_ids: [],prefix: [],rule_hash: authorityRule };
    const badRows = [
      { table: 'missing-table',id: 'one',row }, { table: 'messages',id: 'mismatched',row },
      ...[{ at: { Int: 1.5 } },{ caption: { String: 'x'.repeat(51) } },{ body: { String: '\ud800' } }].map(fields =>
        ({ table: 'messages',id: 'bad',row: { Row: { ...(row as any).Row,id: { Id: 'bad' },...fields } } })),
    ];
    const refusals: any[] = [
      { ...seed,rows: [],verdicts: [{ ...authorityVerdict,result: 1 }] },
      { ...seed,rows: [],absences: [['messages','byId',[{ Unsupported: 'bad' }]]] },
      { ...seed,rows: [],ranges: [{ ...range,row_ids: ['one'] }] },
      { ...seed,rows: [],ranges: [{ ...range,halo: { table: 'messages',id: 'one' } }] },
      { ...seed,ranges: [{ ...range,halo: { table: 'memberships',id: 'one' } }] },
      { ...seed,ranges: [{ ...range,site: 'missing-issuing-Q',prefix: [{ Scalar: { Id: 'room' } },atoms('café')[1]] }] },
      ...badRows.map(bad => ({ ...seed,rows: [{ ...seed.rows[0],row: tagWireRow(authoritySchema,'messages',
        { id: 'one',conversation: 'room',body: 'replacement',caption: null,at: 2 }) },bad] })),
    ];
    for (const replacement of refusals) {
      assert.throws(() => held.rehydrate(replacement)); assert.equal(held.byId('messages','one'),initial); assert.equal(held.rows('messages').length,1);
      assert(held.hasAbsence('messages','byId',[{ Id: 'missing' }])); assert.equal(held.verdict(authorityRule,authorityDigest,authorityContext),true);
      for (const [key,value] of roots) assert.equal((held as any)[key],value,key);
      assert.deepEqual(indexState(),indexesBefore); assert.deepEqual(directoryState(),directoryBefore);
      assert.deepEqual(directory.select([],10),selection); assert.equal(notifications.length,0,'refusal publishes no directory change');
    }
    assert.equal(held.rehydrate({ ...seed,absences: [],verdicts: [{ ...authorityVerdict,result: false }] }),0);
    assert.equal(held.verdict(authorityRule,authorityDigest,authorityContext),false,'both old allow owners leave');
    assert(notifications.length > 0 && notifications.every(v => v === false),'every rehydrate invalidation sees the final denial');
    assert(!held.hasAbsence('messages','byId',[{ Id: 'missing' }])); assert.deepEqual(directory.select([],10),{ scopes: [],overflow: false,missing: false });
    held.setReceipt('later',seed); assert.equal(held.verdict(authorityRule,authorityDigest,authorityContext),null);
    held.rehydrate({ ...seed,verdicts: [] }); assert.equal(held.verdict(authorityRule,authorityDigest,authorityContext),null); assert(directory.select([],10).missing);
    held.rehydrate({ ...seed,schema_hash: 'mismatch',verdicts: [] }); assert(!held.hasAbsence('messages','byId',[{ Id: 'missing' }]));
    assert.equal(held.rehydrate({ ...seed,rows: [],absences: [],verdicts: [] }),1);
    for (const field of ['entries','allowed','unknown','dependencies','digests']) assert.equal(directory[field].size,0,field);
    assert(!reachableValue(held,value => value === initial || value === 'Café'),'no old body retained through transaction ownership');
    const replacement = new ClientStore(schema,undefined,{ program: ir,readable: ['messages'] });
    replacement.put('messages',typed('old','quiet'));
    const incoming = typed('new','Cafe\u0301'); delete incoming.Row.caption;
    const full: any = { ...ordinaryReceipt,rows: [{ table: 'messages',id: 'new',row: incoming }],ranges: [
      { ...ordinaryReceipt.ranges[0],site: 'search',index: 'search',prefix: atoms('CAFÉ'),take: 2,row_ids: ['new'] }] };
    assert.equal(replacement.rehydrate(full),1); assert(replacement.readable('messages'));
    assert.equal((replacement.byId('messages','new') as any).Row.caption,'Null');
    assert.equal(replacement.reexecute(ir,{ ...context,args: { ...context.args,term: { String: 'café' } } },operation.certificate).state,'fresh');
    replacement.rehydrate({ ...full,ranges: [{ ...ordinaryReceipt.ranges[0],row_ids: ['new'] }] });
    assert.equal(replacement.reexecute(ir,context,operation.certificate).state,'fresh','ordinary scope still covers an unseen term');
    const noIssuer = new ClientStore(schema); noIssuer.put('messages',typed('old','quiet'));
    const prior = noIssuer.byId('messages','old'); assert.throws(() => noIssuer.rehydrate(full),{ code: 'E_INPUT' });
    assert.equal(noIssuer.byId('messages','old'),prior);
  }],
] as Array<[string,()=>void]>) {
  try { exercise();console.log(name + ' regression passed'); }
  catch (error) { coverageFailures.push(error);console.error(name,error); }
}
assert.equal(coverageFailures.length,0,'coverage ownership and replacement admission regressions');

// Standalone inputs are synthetic, including their malformed variants; no native/public bypass claim.
const entrypointFailures: unknown[] = [];
for (const entry of ['put','constructor','rehydrate']) {
  try {
    const nestedSchema = structuredClone(membershipSchema);
    nestedSchema.tables.messages.columns.notes = { Optional: { List: { of: { Text: { max: 20 } },max: 4 } } };
    const row = typed('one','Cafe\u0301'); delete row.Row.caption;
    row.Row.notes = { Array: [{ String: 'original' }] }; Object.freeze(row);
    const seed: any = { ...ordinaryReceipt,schema_hash: sha256(canonicalSchemaJson(nestedSchema)),
      rows: [{ table: 'messages',id: 'one',row }],ranges: [] };
    const held = entry === 'constructor' ? new ClientStore(nestedSchema,seed) : new ClientStore(nestedSchema);
    if (entry === 'put') held.put('messages',row);
    if (entry === 'rehydrate') held.rehydrate(seed);
    held.registerHeld({ global: { ir: globalIr } },context);
    const directory: any = [...(held as any).directories.values()][0], selection = directory.select([],10);
    const owned: any = held.byId('messages','one'), before = structuredClone(owned);
    row.Row.body.String = 'quiet'; row.Row.at.Int = 9; row.Row.notes.Array[0].String = 'mutated'; row.Row.room.String = 'other';
    assert.deepEqual(owned,before,entry); assert.equal(owned.Row.caption,'Null');
    assert.equal(owned.Row.notes.Array[0].String,'original'); assert.equal(owned.Row.at.Int,1);
    assert.deepEqual(held.scan('messages','search',prefix('café'),null,null,null,'Asc',10),[owned]);
    assert.deepEqual(held.scan('messages','search',prefix('quiet'),null,null,null,'Asc',10),[]);
    assert.deepEqual(directory.select([],10),selection);
    held.put('messages',owned); assert.equal(held.byId('messages','one'),owned,'verified internal row identity is reusable');
    const invalid = typed('one','x'.repeat(2001)); Object.freeze(invalid);
    assert.throws(() => held.put('messages',invalid),{ code: 'E_INPUT' });
    assert.equal(held.byId('messages','one'),owned); assert.deepEqual(directory.select([],10),selection);
    const externallyImmutable = immutable(Object.freeze(typed('next','café')));
    assert(Object.isFrozen(externallyImmutable.Row.body));
    held.put('messages',externallyImmutable);
    assert.notEqual(held.byId('messages','next'),externallyImmutable,'external deep freeze does not establish normalized store custody');
    held.remove('messages','one'); held.remove('messages','next');
    for (const key of ['entries','allowed','unknown','dependencies','digests']) assert.equal(directory[key].size,0);
    assert(!reachableValue(held,value => value === owned),'weak custody does not retain removed row bodies');
    console.log(`${entry} shallow-frozen nested input isolation passed`);
  } catch (error) { entrypointFailures.push(error); console.error(entry,error); }
}

const receiptState = (held: any) => JSON.stringify([held.facts,...held.directories.values()],(_key,value) =>
  value instanceof Map || value instanceof Set ? [...value] : value);
const endpointVariants: any[] = [
  ...['after','before'].flatMap(key => [
    { [key]: { Id: null } },{ [key]: { Id: 42 } },{ [key]: { String: 'wrong tag' } },
    { [key]: { Array: [] } },{ [key]: { Array: [{ Id: 'one' },{ Id: 'two' }] } },{ [key]: { Array: null } },
    { [key]: { Array: [{ Id: 'one' }],Id: 'extra tag' } },
  ]),
  ...['gt','gte','lt','lte'].flatMap(key => [{ [key]: { Id: null } },{ [key]: { Int: 1 } },{ [key]: { Array: [{ Id: 'one' }] } }]),
  { held_suffix: [{ Id: null }] },{ held_suffix: [] },{ held_suffix: [{ Id: 'one' },{ Id: 'two' }] },
];
for (const patch of endpointVariants) {
  try {
    const held = new ClientStore(membershipSchema); held.put('messages',typed('one','Café'));
    held.registerHeld({ global: { ir: globalIr } },context);
    const owned = held.byId('messages','one'), directory: any = [...(held as any).directories.values()][0];
    const proof: any = { ...ordinaryReceipt,schema_hash: sha256(canonicalSchemaJson(membershipSchema)),ranges: [],rows: [],
      absences: [['messages','byId',[{ Id: 'missing' }]],['members','byRoomViewer',[{ String: 'r' },{ Id: 'viewer' }]]],
      verdicts: [{ rule_hash: 'rule',pinned_inputs_digest: 'digest',principal: 'viewer',auth_epoch: 0,result: true }] };
    held.setReceipt('owned',proof); held.setReceipt('other',{ ...proof,absences: [proof.absences[1]],verdicts: [{ ...proof.verdicts[0],result: false }] });
    const prior = receiptState(held), selection = directory.select([],10), roots = ['facts','indexes','tables','directories'].map(k => (held as any)[k]);
    const r = { ...ordinaryReceipt.ranges[0],index: 'byId',prefix: [],row_ids: ['one'],...patch };
    const replacement = { ...proof,rows: [{ table: 'messages',id: 'one',row: owned }],ranges: [r],absences: [],verdicts: [] };
    assert.throws(() => held.setReceipt('owned',replacement));
    assert.equal(receiptState(held),prior,'refused direct replacement preserves exact proof/span/directory contents');
    assert.deepEqual(['facts','indexes','tables','directories'].map(k => (held as any)[k]),roots);
    assert.equal(held.byId('messages','one'),owned); assert.deepEqual(directory.select([],10),selection);
    assert(held.hasAbsence('messages','byId',[{ Id: 'missing' }])); assert.equal(held.verdict('rule','digest',context),null);
    assert.throws(() => held.rehydrate(replacement)); assert.equal(receiptState(held),prior);
    held.setReceipt('owned',{ ...replacement,ranges: [{ ...r,...Object.fromEntries(Object.keys(patch).map(k => [k,k === 'held_suffix' ? [{ Id: 'one' }] : null])) }] });
    assert(!held.hasAbsence('messages','byId',[{ Id: 'missing' }])); assert.equal(held.verdict('rule','digest',context),false);
    held.setReceipt('owned'); held.setReceipt('other'); held.remove('messages','one');
    for (const key of ['entries','allowed','unknown','dependencies','digests']) assert.equal(directory[key].size,0);
  } catch (error) { entrypointFailures.push(error); console.error(patch,error); }
}
// Scalar range predicates differ from full after/before tuples, including on derived indexes.
for (const index of ['ordinary','search']) {
  const held = new ClientStore(schema); const row = typed('one','Café'); held.put('messages',row);
  const r: any = { ...ordinaryReceipt.ranges[0],site: index === 'search' ? 'search' : 'ordinary',index,
    prefix: index === 'search' ? atoms('café') : [{ Scalar: { String: 'r' } }],row_ids: ['one'],
    after: { Array: [{ Int: 0 },{ Id: 'zero' }] },before: { Array: [{ Int: 2 },{ Id: 'two' }] },gte: { Int: 1 },lte: { Int: 1 } };
  const receipt = { ...ordinaryReceipt,rows: [{ table: 'messages',id: 'one',row }],ranges: [r] };
  held.setReceipt('bounds',receipt,ir);
  assert.deepEqual(held.scan('messages',index,prepareRange(schema,r,ir),r.after,r.before,{ gte: r.gte,lte: r.lte },'Asc',10).map(wireJson),[wireJson(row)]);
  for (const bad of [{ after: { Int: 1 } },{ after: { Array: [{ Int: 0.5 },{ Id: 'zero' }] } },{ gt: { Array: [{ Int: 0 },{ Id: 'zero' }] } }]) {
    const before = receiptState(held); assert.throws(() => held.setReceipt('bounds',{ ...receipt,ranges: [{ ...r,...bad }] },ir));
    assert.equal(receiptState(held),before);
  }
  const before = receiptState(held); row.Row.at.Int = 9; r.after.Array[0].Int = 100;
  assert.equal(receiptState(held),before,'retained key/endpoint proof does not alias incoming row or range objects');
  held.setReceipt('bounds');
}
assert.equal(entrypointFailures.length,0,'standalone entrypoint isolation and endpoint refusal atomicity');
console.log('standalone typed endpoint, suffix, proof isolation, replacement and GC regressions passed');


// Sparse authenticated images and materialized execution values have distinct, exact meanings.
{
  const imageSchema = structuredClone(schema);
  Object.assign(imageSchema.tables.messages.columns, { notes: { Json: { max_bytes: 4096 } },
    photo: { Optional: { Image: { max: 1000000 } } },tags: { List: { max: 4,of: { Optional: { Text: { max: 20 } } } } },
    '\uE000': { Optional: { Text: { max: 20 } } },'\u{10000}': { Optional: { Text: { max: 20 } } } });
  // Actual asset spelling from frozen final26c9 asset-valid-video-list-insert; this new row/schema is a synthetic unit input.
  const asset = 's2id-00000000000000000000000000000006-0000000000000002';
  Object.defineProperty(imageSchema.tables.messages.columns,'__proto__',{ value: { Optional: { Text: { max: 20 } } },enumerable: true });
  const input: any = { id: 'image',room: 'r',body: 'Cafe\u0301',at: 1,
    notes: { '\u{10000}': [null,{ Bytes: 'not a byte variant',nested: null }],'\uE000': { omittedInside: [] } },
    tags: [null,'word'],photo: { id: asset,width: 1920,height: 1080 },'\u{10000}': null };
  const original = JSON.parse(JSON.stringify(input)), held = new ClientStore(imageSchema);
  const image = prepareWireRow(imageSchema,'messages',Object.freeze(input)); held.put('messages',image);
  assert.equal(held.byId('messages','image'),image,'unchanged execution borrows the same deeply owned image');
  assert.equal(Object.hasOwn(image.Row,'__proto__'),true); assert.equal(image.Row.__proto__,'Null');
  assert.equal(image.Row.caption,'Null'); assert.equal(image.Row['\uE000'],'Null');
  assert.equal(imageCanonical(image),imageCanonical(original),'UTF-16 canonical image order and omission are unchanged');
  assert.deepEqual(JSON.parse(JSON.stringify(imageWire(image))),original,'nested JSON/map/list/media keys and nulls roundtrip exactly');
  assert.deepEqual([...assetIdsIn(image)],[asset]); assert.deepEqual([...assetIdsIn(original)],[asset]);
  input.notes['\u{10000}'][1].nested = 'changed'; input.tags[1] = 'changed'; input.photo.width = 1;
  assert.equal(imageCanonical(image),imageCanonical(original),'nested external mutation cannot change authenticated bytes');
  assert.deepEqual(held.scan('messages','search',prefix('café'),null,null,null,'Asc',2),[image]);
  const explicit = prepareWireRow(imageSchema,'messages',{ ...original,caption: null });
  assert.deepEqual(wireJson(explicit),wireJson(image),'execution normalizes absent and explicit optional null identically');
  assert.notEqual(RowImage.digest(explicit),RowImage.digest(image),'immutable wire-image custody distinguishes them');
  const alternate = prepareWireRow(imageSchema,'messages',original);
  assert.equal(RowImage.keys(alternate,RowImage.keys(image)),RowImage.keys(image),'equivalent immutable proof keys share exact component ownership');
  const currentIndex: any = held.index('messages','search'), beforeGeneration = currentIndex.generation;
  const scopeRows = currentIndex.scopes.get([{ String: 'r' }]);
  assert.equal(held.put('messages',alternate),false,'equal refresh is an ownership change, not an execution change');
  assert.equal(held.byId('messages','image'),alternate);
  assert.equal(currentIndex.generation,beforeGeneration,'equal refresh preserves posting/cursor generation');
  assert.equal(currentIndex.scopes.get([{ String: 'r' }]),scopeRows); assert(scopeRows.has(alternate)); assert(!scopeRows.has(image));
  assert.deepEqual(held.scan('messages','search',prefix('café'),null,null,null,'Asc',2),[alternate]);
  assert(!reachableValue(held,v => v === image || v === image.Row.notes),'replaced current body has no obsolete effective/index owner');
  const differentTags: any = structuredClone(RowImage.tagged(alternate)); differentTags.Row.notes = { Row: differentTags.Row.notes.Map };
  assert.equal(imageCanonical(RowImage.prepare(imageSchema,'messages',differentTags)),imageCanonical(alternate));
  assert.equal(held.put('messages',differentTags),true,'equal wire JSON does not erase standalone nested Row versus Map execution meaning');
  assert.equal(held.put('messages',alternate),true);
  const successor = structuredClone(imageSchema); successor.tables.messages.columns.later = { Optional: 'Int' };
  const rebound = RowImage.prepare(successor,'messages',image);
  assert.equal(imageCanonical(rebound),imageCanonical(original),'cross-schema reconstruction preserves original omissions');
  assert.equal(rebound.Row.later,'Null'); assert.notEqual(rebound,image);
  const mapped: any = { Map: structuredClone(typed('map','café').Row) }; delete mapped.Map.caption;
  const ordinary = new ClientStore(schema); ordinary.put('messages',mapped);
  assert.deepEqual(ordinary.byId('messages','map'),mapped,'established standalone Map admission keeps kind and missing-key semantics');
  const proof = new FactIndex(imageSchema,true), keys = RowImage.keys(image);
  const fact = { id: 'image-proof',key: '["row","messages","image"]',table: 'messages',rowId: 'image',seq: 1,digest: RowImage.digest(image),keys };
  proof.change(fact,2); held.remove('messages','image');
  assert(!reachableValue(held,v => v === image));
  assert(!reachableValue(proof,v => v === image || v === image.Row || v === image.Row.notes),'historical keys retain no full body or unindexed nested payload');
  assert(ImageKeys.is(keys)); assert.equal(proof.get('image-proof')?.refs,2);
  const temporal = new HeldIndex<any>(imageSchema,'messages','ordinary',imageSchema.tables.messages.indexes.ordinary.components,r => r.seq);
  temporal.putPrepared('one',{ seq: 1 },keys.ordinary); temporal.putPrepared('two',{ seq: 2 },keys.ordinary);
  temporal.putPrepared('one',{ seq: 3 },keys.ordinary);
  const scan = { prefix: [{ Scalar: { String: 'r' } }],after: null,before: null,range: null,order: 'Asc' as const };
  assert.equal([...temporal.scan(scan,1)].length,0,'shared key ownership does not erase the immutable sequence partition');
  assert.deepEqual([...temporal.scan(scan,3)],[{ seq: 3 }]); temporal.remove('one'); temporal.remove('two'); assert.equal(temporal.size,0);
  proof.change(fact,-1); assert.equal(proof.get('image-proof')?.refs,1);
  proof.change(fact,-1); assert.equal((proof as any).indexes.size,0); assert.equal((proof as any).records.size,0);
  assert.equal(imageCanonical(image),imageCanonical(original),'caller-held image remains immutable after all store owners leave');
}
console.log('shared immutable image omission/null, schema reprepare, media, Map, canonical bytes and body-free proof reclamation passed');

// Whole-value malformed scalar admission precedes reserved principals and descriptor errors.
{
  const { validateTypedValue, assertValue } = await import('./value-runtime');
  const system = (await import('../../../crates/snapback2-core/ir-contract.json')).default.systemPrincipalId;
  const check = (descriptor: any, value: any, code: string, message: string, fanout = true) => {
    assert.throws(() => validateTypedValue(descriptor,value,'input',fanout), (error: any) => error.code === code && error.message === `${code}: ${message}`);
  };
  const list = { Optional: { List: { max: 1,of: { Optional: { Text: { max: 3,min: 2,format: 'handle' } } } } } };
  check(list,{ Array: [{ Id: system },{ String: '\uD800' }] },'E_INPUT','invalid Unicode scalar text');
  check(list,{ Array: [{ Id: system },{ Bool: true }] },'E_INPUT','input cannot carry the reserved system principal');
  check(list,{ Array: [{ String: 'ok' },{ String: 'ok' }] },'E_FANOUT','input exceeds list max 1');
  check(list,{ Array: [{ String: 'a' }] },'E_INPUT','input is shorter than text min 2');
  check(list,{ Array: [{ String: 'A!' }] },'E_INPUT','input has invalid handle format');
  validateTypedValue(list,{ Array: ['Null'] },'input',true);
  const asset = { Map: { id: { String: 's2id-00000000000000000000000000000006-0000000000000002' },width: { Int: 20 },height: { Int: 10 } } };
  const media = { Optional: { List: { max: 3,of: { Optional: { List: { max: 2,of: { Image: { max: 1000 } } } } } } } };
  validateTypedValue(media,{ Array: ['Null',{ Array: [asset] }] } as any,'input',true);
  check(media,{ Array: [{ Array: [asset] },{ Array: [asset] }] },'E_ASSET_TYPE',
    'input repeats asset id s2id-00000000000000000000000000000006-0000000000000002; asset ids in a list must be unique');
  check(media,{ Array: [{ Array: [{ Map: { ...asset.Map,width: { Int: 0 } } }] }] },'E_ASSET_TYPE','input[0][0].width must be a positive i53 integer');
  check(media,{ Array: ['Null','Null','Null','Null'] },'E_ASSET_TYPE','input exceeds list max 3');
  assertValue({ Array: [{ Id: system }] },'input');
  validateTypedValue('Scalar',{ Id: system },'input',false,true);
  for (const row of [ { id: 'bad',room: 'r',body: 'ok',at: 0.5 },{ id: 'bad',room: 'r',body: '\uD800',at: 0.5 },
    { id: 'bad',body: 7,at: 1 },{ id: 'bad',room: 'r',body: 'ok',at: 1,extra: true } ]) {
    const errors = [tagWireRow,prepareWireRow].map(convert => { try { convert(schema,'messages',row); } catch (error: any) { return [error.constructor.name,error.code,error.path,error.message]; } });
    assert(errors[0]); assert.deepEqual(errors[0],errors[1],'owned construction and mutable adapter preserve exact input refusal ordering');
  }
}

// Synthetic standalone schema, including ordinary and derived optional property-name indexes.
{
  const definition = structuredClone(schema);
  Object.defineProperty(definition.tables.messages.columns,'__proto__',{ value: { Optional: { Text: { max: 20 } } },enumerable: true });
  definition.tables.messages.indexes.proto = { unique: false,components: [col('__proto__'),col('id')] };
  definition.tables.messages.indexes.protoWords = { unique: false,components: [{ WordPrefixes: { fields: ['__proto__'],contract: SEARCH_CONTRACT } },col('id')] };
  const raw: any = { id: 'proto',room: 'r',body: 'Café',at: 1 }, hash = sha256(canonicalSchemaJson(definition));
  const prepared = prepareWireRow(definition,'messages',raw);
  assert.deepEqual(RowImage.keys(prepared).proto,[{ Scalar: 'Null' },{ Scalar: { Id: 'proto' } }]);
  assert.deepEqual(RowImage.keys(prepared).protoWords,[{ Words: [] },{ Scalar: { Id: 'proto' } }]);
  const { preparedDeliveryRows } = await import('./row-image');
  for (const owned of [false,true]) {
    let saved: any; const factory = () => new PersistentRangeStore({ carrier: 'json',open: async () => saved,
      replace: async state => { saved = JSON.parse(JSON.stringify(state)); },close() {},wipe: async () => {} });
    let carrier = factory(); await carrier.open('viewer');
    const frame: any = { op: 'raw',args: {},state: 'complete',seq: 1,data: { $row: { table: 'messages',id: 'proto' } },
      rows: [{ table: 'messages',id: 'proto',row: raw }],receipt: { ranges: [],absences: [],verdicts: [] } };
    if (owned) frame[preparedDeliveryRows] = [{ table: 'messages',id: 'proto',row: prepared }];
    await carrier.commit({ schema: definition,facts: { generation: 'unit',schemaHash: hash,authEpoch: 0 },
      programs: { unit: { generation: 'unit',schemaHash: hash,schema: definition,programs: {} } },deliveries: [frame] });
    const before = JSON.stringify(saved); assert(!Object.hasOwn(saved.rows['messages\0proto'].row,'__proto__'));
    assert.equal(imageCanonical((await carrier.answer('raw',{}))!.data),imageCanonical(raw));
    await carrier.close(); carrier = factory(); await carrier.open('viewer');
    assert.equal((await carrier.coverage()).rows.length,1);
    assert.equal(imageCanonical((await carrier.answer('raw',{}))!.data),imageCanonical(raw),'cold raw index preparation uses own optional fields');
    assert.equal(JSON.stringify(saved),before); await carrier.close();
  }
}
console.log('raw/prepared/cold optional indexed __proto__ admission preserves sparse ordinary and Unicode keys');

// One prepared parameter meaning crosses receipt/current coverage ownership without retaining issuing bodies.
{
  const { PreparedRange,RangeReceipt,preparedDeliveryRanges } = await import('./range-preparation');
  const { prepareReceipt,prepareWireReceiptRanges } = await import('../../snapback2/src/offline-protocol');
  const { CarrierIndex } = await import('../../snapback2/src/store/carrier-index');
  const source = structuredClone(extentEnvelope.receipt), inputBytes = JSON.stringify(source);
  const prepared = prepareReceipt(schema,source,ir), raw = prepared[preparedDeliveryRanges][0];
  const meaning = RangeReceipt.get(raw,true)!;
  assert.equal(RangeReceipt.get(prepared.ranges[0],false),meaning);
  assert(Object.isFrozen((meaning.meaning.prefix[1] as any).WordPrefix));
  source.ranges[0].prefix[1].WordPrefix.source = 'different'; source.ranges[0].rowIds.pop();
  assert.equal(JSON.stringify(raw),JSON.stringify(JSON.parse(inputBytes).ranges[0]),'recursive external source isolation keeps exact original spelling');
  const current = new ClientStore(schema); for (const r of extentRows) current.put(r.table,tagWireRow(schema,r.table,r.row as any));
  const receipt: any = { schema_hash:schemaHash,rows:extentRows.map(r => ({ ...r,row:tagWireRow(schema,r.table,r.row as any) })),...prepared };
  let constructions = 0; const finish = PreparedRange.finish;
  PreparedRange.finish = (...args: Parameters<typeof finish>) => { constructions++; return finish(...args); };
  try {
    current.setReceipt('prepared',receipt,ir);
    const carrierState = emptyState(); carrierState.facts = { generation:'g',schemaHash,authEpoch:0 }; carrierState.programs.g = program;
    const carrier = new CarrierIndex(carrierState,schema);
    carrier.rangeKey(raw as any,'search');
    assert.equal(constructions,0,'carrier and coverage consume the checked parameter object without another constructor');
    const installed = (current as any).facts.owners.get('prepared').ranges[0];
    assert.equal(installed.logical,meaning.meaning.prefix); assert.equal(installed.value.prefix,meaning.value.prefix);
    const equal = prepareReceipt(schema,JSON.parse(inputBytes),ir), refreshed = RangeReceipt.get(equal.ranges[0],false)!;
    const counts = [...(current as any).facts.exact], dependencies = (current as any).facts.rowRanges;
    assert.equal(current.setReceipt('prepared',{ ...receipt,...equal },ir),false,'equal refresh reports no semantic invalidation');
    assert.equal((current as any).facts.owners.get('prepared').ranges[0],installed,'equal refresh keeps the indexed owner');
    assert.equal(installed.logical,refreshed.meaning.prefix); assert.equal(RangeReceipt.get(installed.value,false),refreshed);
    assert.deepEqual([...(current as any).facts.exact],counts);
    assert.equal((current as any).facts.rowRanges,dependencies);
    const snapshot = [current.rows('messages'),[...installed.expected],current.hasCompleteRange('messages','ordinary',[{ String:'r' }])];
    const wrong = structuredClone(receipt); wrong.ranges[0].after = { Array:[{ Int:0 }] };
    assert.throws(() => current.setReceipt('prepared',wrong,ir),/suffix width/);
    assert.equal((current as any).facts.owners.get('prepared').ranges[0],installed);
    assert.deepEqual([current.rows('messages'),[...installed.expected],current.hasCompleteRange('messages','ordinary',[{ String:'r' }])],snapshot);
    const outward = tagReceipt(schema,JSON.parse(inputBytes),ir); (outward.ranges[0].prefix[1] as any).WordPrefix.source = 'mutable';
    assert.equal((meaning.value.prefix[1] as any).WordPrefix.source,'CAFE\u0301');
    const smaller = structuredClone(ir); smaller.body[0].Return.Scan.prefix[1].WordPrefix.source_max = 1;
    assert.throws(() => prepareWireReceiptRanges(schema,[raw],smaller),/bound|exceed/i);
    assert.throws(() => prepareWireReceiptRanges(schema,[raw]),/issuing/);
    const isolated = structuredClone(raw); isolated.prefix[0].Scalar = 'elsewhere';
    const replacement = prepareReceipt(schema,{ ...JSON.parse(inputBytes),ranges:[isolated] },ir);
    assert.notEqual(RangeReceipt.get(replacement.ranges[0],false),meaning);
    // A failed backend swap must retain the exact old range owner as well as all serialized facts/outbox.
    const owner = { answers:{ a:{ receipt:{ ranges:[raw] } } } }, journal = new SwapJournal(owner);
    journal.draft.answers.a.receipt.ranges[0] = RangeReceipt.change(raw,{ haloId:undefined } as any);
    assert(!Object.hasOwn(journal.draft.answers.a.receipt.ranges[0],'haloId'));
    journal.rollback(); assert.equal(owner.answers.a.receipt.ranges[0],raw);
    current.setReceipt('prepared'); assert.equal((current as any).facts.rowRanges.size,0);
    assert.equal((current as any).facts.groups.size,0); assert.equal((current as any).facts.owners.size,1,'only the empty constructor seed remains');
  } finally { PreparedRange.finish = finish; }
  // Keep the original public ordering: all range field errors precede full cursor width errors.
  const badWidth = { ...JSON.parse(inputBytes).ranges[0],after:[0] };
  const badField = { ...JSON.parse(inputBytes).ranges[0],prefix:[{ WordPrefix:{ contract:SEARCH_CONTRACT,source:'café' } }] };
  assert.throws(() => tagReceipt(schema,{ ranges:[badWidth,badField],absences:[],verdicts:[] },ir),/atom does not match/);
  const custom = JSON.parse(inputBytes).ranges[0]; Object.defineProperty(custom,'__proto__',{ value:{ opaque:'source' },enumerable:true });
  const isolatedCustom = prepareWireReceiptRanges(schema,[custom],ir)[0];
  assert.equal(JSON.stringify(isolatedCustom),JSON.stringify(custom),'generic raw owner preserves every own source field');
  custom.__proto__.opaque = 'mutated'; assert.equal((isolatedCustom as any).__proto__.opaque,'source');
}
console.log('prepared range custody, constructor reuse, isolation, field ordering and owner rollback passed');
