// @ref LLP 1012#indexed-held-search — regressions exercise seeks, local authority and durable incremental replay.
import assert from 'node:assert/strict';
import { ClientStore } from './store';
import { preparePrefix } from './index-store';
import { canonicalSchemaJson, canonicalProgramJson } from './certificate-identity';
import { sha256 } from './hash';
import { scopedRuleHash, wireJson } from './value-runtime';
import { Twin } from '../../snapback2/src/twin';
import { emptyState } from '../../snapback2/src/store/range-store';
import { StoreChanges, SwapJournal } from '../../snapback2/src/store/swap-journal';
import { decodeLocalCursor, encodeLocalCursor, localBinding, StaleLocalPage, serverArguments } from '../../snapback2/src/local-cursor';
import { SEARCH_CONTRACT, SearchNormalizer } from './unicode';
import { prepareRange } from './coverage';
import { queryState } from './runner';
import { encodeCursor, decodeCursor } from './cursor';
import historicalFixtures from './test-search-fixtures.json';
import searchFixtures from './test-search-v4-fixtures.json';
import { decodeHeldProgram } from '../../snapback2/src/held-program';
import { tagWireRow } from '../../snapback2/src/offline-protocol';
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
const minPacket = { generation: 'synthetic-v4', schema: clockSchema, schemaHash: clockSchemaHash, programs: { minimum: { kind: 'query', planHash: minHash, ir: minIr,
  certificate: { plan_hash: minHash, schema_hash: clockSchemaHash, evaluator_version: CURRENT_EVALUATOR, value_model_version: CURRENT_VALUE_MODEL_VERSION } } } };
assert.equal(Object.keys(decodeHeldProgram(minPacket)!.programs).length, 1);
assert.equal(Object.keys(decodeHeldProgram({ ...minPacket, programs: { minimum: { ...minPacket.programs.minimum, ir: { ...minIr, args: absentMin.args } } } })!.programs).length, 0);
console.log('public direct/global h1 normalization, reused ordinary site, pinned clock and v4 recursive Text.min regressions passed');

// Actual native minimum query plus channel schema proves JS canonical positive-min custody against emitted v4 hashes.
const minimum = searchFixtures.minimum, minimumHash = sha256(canonicalSchemaJson(minimum.schema));
assert.equal(minimumHash, minimum.certificate.schema_hash);
assert.equal(sha256(canonicalProgramJson(minimum.program)), minimum.certificate.plan_hash);
const minimumPacket = { generation: 'engine-provisional-03-minimum', schema: minimum.schema, schemaHash: minimumHash,
  programs: { minimum: { kind: 'query', ir: minimum.program, planHash: minimum.certificate.plan_hash, certificate: minimum.certificate } } };
assert.equal(Object.keys(decodeHeldProgram(minimumPacket)!.programs).length, 1);
const minimumStore = new ClientStore(minimum.schema);
for (const term of ['ab', '😀😀', 'e\u0301']) assert.deepEqual(minimumStore.reexecute(minimum.program,
  { ...context, args: { term: { String: term } } }, minimum.certificate).execution.result, { String: term });
for (const term of ['', 'a', '😀', '12345', '\ud800']) assert.throws(() => minimumStore.reexecute(minimum.program,
  { ...context, args: { term: { String: term } } }, minimum.certificate), { code: 'E_INPUT' });
console.log('actual native v4 minimum/query/channel schema identities and scalar admission passed');

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
