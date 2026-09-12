// @ref LLP 1012#native-acquisition-restart — native receipt coverage cannot become global, negative, rule, or mutation authority.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeCursor } from './cursor';
import { FixtureStore as ClientStore } from './test-certificate';
import { schemaDigest, scopedRuleHash, wireJson } from './value-runtime';
import type { ClosureReceipt, Trace, Value } from './types';

const fixture = JSON.parse(readFileSync(new URL('../../../corpus/deliver-insert-cap3.json', import.meta.url), 'utf8'));
const schema = fixture.schema, context = fixture.context, recipient = context.viewer, log = 'deliveries';
const empty = (): ClosureReceipt => ({ rows: [], ranges: [], absences: [], verdicts: [] });
const event = (id = 'event1', seq = 1, principal = recipient): Value => ({ Row: {
  id: { Id: id }, recipient: { Id: principal }, row: { Id: `message${seq}` }, conversationId: { Id: 'c1' },
  incarnation: { Int: 0 }, kind: { String: 'delivered' }, audience: { Int: 1 }, seq: { Int: seq }, at: { Int: seq },
} });
const cursor = (id = 'event1', seq = 1, table = log): string => encodeCursor({ table, index: 'byRecipient', order: 'Asc',
  suffix: [{ name: 'seq', kind: 'Int' }, { name: 'id', kind: 'Id' }], values: [{ Int: seq }, { Id: id }] });
const query = (table = log, index = 'byRecipient', prefix: any[] = [{ Scalar: { Input: 'Viewer' } }]): any => ({
  name: 'nativeRead', kind: 'Query', args: {}, read_time_granularity_ms: null,
  body: [{ Return: { Scan: { site: 'native-range', table, index, prefix, order: 'Asc', take: { Literal: 50 },
    after: null, before: null, range: null } } }],
});
const program = query();
const admit = (store: ClientStore, after: string | null = null, end: string | null = cursor(), exhausted = true) =>
  store.admitNativeCoverage({ log, recipient, after, cursor: end, exhausted });
const seeded = () => { const store = new ClientStore(schema); store.put(log, event()); return store; };
const state = (store: ClientStore) => store.reexecute(program, context).state;
let passed = 0, failed = 0;
function check(label: string, run: () => void): void {
  try { run(); passed++; } catch (error) { failed++; console.error(label, error); }
}

check('native exhaustion covers the retained recipient log only after the final contiguous page', () => {
  const store = seeded();
  assert.equal(state(store), 'partial');
  admit(store, null, cursor(), false);
  assert.equal(state(store), 'partial');
  store.put(log, event('event2', 2));
  admit(store, cursor(), cursor('event2', 2));
  const result = store.reexecute(program, context);
  assert.equal(result.state, 'fresh');
  assert.deepEqual((wireJson(result.execution.result) as any[]).map(r => r.id), ['event1', 'event2']);
});
check('an exhausted empty initial prefix is covered and an empty final page preserves its cursor', () => {
  const emptyStore = new ClientStore(schema);
  admit(emptyStore, null, null);
  assert.equal(state(emptyStore), 'fresh');
  const store = seeded();
  admit(store, null, cursor(), false); admit(store, cursor(), cursor());
  assert.equal(state(store), 'fresh');
});
check('precommit batch validation checks continuity without publishing any coverage or cursor progress', () => {
  const store = seeded();
  const pages = [
    { log, recipient, after: null, cursor: cursor(), exhausted: false },
    { log, recipient, after: cursor(), cursor: cursor('event2', 2), exhausted: true },
  ];
  store.validateNativeCoverage(pages);
  assert.equal(state(store), 'partial');
  assert.throws(() => admit(store, cursor(), cursor('event2', 2)), /contiguous/);
  assert.throws(() => store.validateNativeCoverage([pages[0], { ...pages[1], after: cursor('gap', 3) }]), /contiguous/);
  admit(store);
  store.validateNativeCoverage([{ ...pages[1], exhausted: false }]);
  assert.equal(state(store), 'fresh');
  assert.throws(() => store.validateNativeCoverage([{ ...pages[1], cursor: 'bad-cursor' }]), /E_INPUT/);
  assert.equal(state(store), 'fresh');
});
check('gaps, backwards boundaries, stalled nonfinal pages and foreign cursor indexes are rejected without changing coverage', () => {
  const store = seeded(); admit(store);
  assert.throws(() => admit(store, cursor('missing', 2), cursor('event3', 3)), /contiguous/);
  assert.throws(() => admit(store, cursor(), cursor('before', 0)), /advance/);
  assert.throws(() => admit(store, cursor(), cursor(), false), /advance/);
  assert.throws(() => admit(store, cursor(), null), /advance/);
  assert.throws(() => admit(store, null, cursor('event1', 1, 'messages')), /different table/);
  assert.throws(() => admit(store, null, 'not-a-cursor'), /E_INPUT/);
  assert.equal(state(store), 'fresh');
});
check('foreign viewers and prefixes cannot use another recipient native proof', () => {
  const store = seeded(); admit(store);
  const trace = store.reexecute(program, context).execution.trace;
  assert.deepEqual(store.uncoveredSites(trace, [], program, undefined, 'u2'), ['native-range']);
  const foreign: Trace = { ...trace, ranges: trace.ranges.map(r => ({ ...r, prefix: [{ Scalar: { Id: 'u2' } }] })) };
  assert.deepEqual(store.uncoveredSites(foreign, [], program, undefined, recipient), ['native-range']);
  assert.equal(store.reexecute(program, { ...context, viewer: 'u2' }).state, 'partial');
});
check('native coverage grants neither another log index nor the unprefixed log', () => {
  const store = seeded(); admit(store);
  assert.equal(store.reexecute(query(log, 'byId', []), context).state, 'partial');
  assert.equal(store.reexecute(query(log, 'byRecipient', []), context).state, 'partial');
  assert.equal(store.reexecute(query(log, 'byRecipientGroup'), context).state, 'partial');
});
check('a generated-looking authored log has no native authority', () => {
  const authored = structuredClone(schema); delete authored.tables.messages.deliver;
  assert.throws(() => admit(new ClientStore(authored)), /generated delivery log/);
  for (const tamper of [
    (s: any) => { s.tables.deliveries.rules.read = 'Allow'; },
    (s: any) => { s.tables.deliveries.indexes.byRecipient.components.reverse(); },
    (s: any) => { s.tables.deliveries.constraints = []; },
    (s: any) => { s.tables.deliveries.tombstones = []; },
    (s: any) => { s.tables.memberships.constraints = []; },
    (s: any) => { s.tables.conversations.deliver = s.tables.messages.deliver; },
  ]) {
    const forged = structuredClone(schema); tamper(forged);
    assert.throws(() => admit(new ClientStore(forged)), /native coverage/);
  }
});
check('native log completeness grants no content completeness, primary absence, or mutation prediction', () => {
  const store = seeded(); admit(store);
  assert.equal(store.reexecute(query('messages', 'byId', []), context).state, 'partial');
  assert.equal(store.hasCompleteRange(log, 'byRecipient', [{ Id: recipient }]), false);
  assert.equal(store.hasCompleteRange('messages', 'byId', []), false);
  assert.equal(store.hasAbsence(log, 'byId', [{ Id: 'missing' }]), false);
  assert.equal(store.authorityAbsence('messages', 'missing'), false);
  const missingRead = { name: 'missingLogPoint', kind: 'Query', args: {}, read_time_granularity_ms: null,
    body: [{ Return: { Get: { site: 'missing-log-point', table: log, index: 'byId', key: [{ Literal: { Id: 'missing' } }] } } }] };
  assert.deepEqual(store.reexecute(missingRead, context).partialSites, ['missing-log-point']);
  const mutation = { name: 'deleteMissing', kind: 'Mutation', args: {}, read_time_granularity_ms: null,
    body: [{ Delete: { table: 'messages', key: { Literal: { Id: 'missing' } } } }] };
  const prediction = store.applyMutation(mutation, context);
  assert.equal(prediction.state, 'partial'); assert(prediction.partialSites.includes('missing-authority'));
  const trace = store.reexecute(program, context).execution.trace;
  assert.deepEqual(store.uncoveredSites(trace, [], { ...program, kind: 'Mutation' }, undefined, recipient), ['native-range']);
  assert.equal(state(store), 'fresh');
});
check('native coverage does not grant missing rule authority or make retained content readable', () => {
  const protectedSchema = structuredClone(schema);
  protectedSchema.tables.memberships.rules.read = 'Deny';
  protectedSchema.tables.messages.rules.read = { Exists: { table: 'memberships', index: 'byConversationPrincipal',
    key: [{ Field: 'conversationId' }, 'Viewer'], provenance: 'Shape' } };
  const store = new ClientStore(protectedSchema);
  store.put(log, event());
  store.put('messages', { Row: { id: { Id: 'message1' }, conversationId: { Id: 'c1' }, authorId: { Id: recipient }, body: { String: 'hello' } } });
  admit(store);
  const result = store.reexecute(query('messages', 'byId', []), context);
  assert.equal(result.state, 'partial'); assert(result.partialSites.includes('missing-authority'));
  assert.equal(store.verdict(scopedRuleHash(protectedSchema, protectedSchema.tables.messages.rules.read), 'absent', context), null);
  assert.equal(store.readable('messages'), false);
});
check('deleting or replacing covered log evidence invalidates the prefix and rejects continuation', () => {
  for (const remove of [true, false]) {
    const store = seeded(); admit(store);
    if (remove) store.remove(log, 'event1'); else store.put(log, event('event1', 2));
    assert.equal(state(store), 'partial');
    assert.throws(() => admit(store, cursor(), cursor('event2', 3)), /contiguous/);
  }
});
check('unchanged images and another recipient leave native coverage intact; an append needs a new final page', () => {
  const store = seeded(); admit(store);
  store.put(log, event()); store.put(log, event('foreign', 2, 'u2'));
  assert.equal(state(store), 'fresh');
  store.put(log, event('event2', 2)); assert.equal(state(store), 'partial');
  admit(store, cursor(), cursor('event2', 2)); assert.equal(state(store), 'fresh');
});
check('prediction rollback does not discard unrelated native coverage', () => {
  const store = seeded(); admit(store);
  const mutation = { name: 'localWrite', kind: 'Mutation', args: {}, read_time_granularity_ms: null,
    body: [{ Insert: { table: 'conversations', row: { Literal: { Row: { id: { Id: 'temporary' } } } } } }] };
  assert.equal(store.applyMutation(mutation, context, true).state, 'predicted');
  assert.equal(store.byId('conversations', 'temporary'), null);
  assert.equal(state(store), 'fresh');
});
check('ordinary receipts keep their own coverage and replacement clears native coverage', () => {
  const store = seeded(), trace = store.reexecute(program, context).execution.trace.ranges[0];
  const { lastReturnedSuffix: _last, ...range } = trace;
  const receipt: ClosureReceipt = { ...empty(), schema_hash: schemaDigest(schema), rows: [{ table: log, id: 'event1', row: event() }],
    ranges: [{ ...range, row_ids: ['event1'], stop: 'Exhausted', absence: false }] };
  store.setReceipt('ordinary', receipt, program);
  assert.equal(state(store), 'fresh');
  admit(store); store.setReceipt('ordinary'); assert.equal(state(store), 'fresh');
  store.rehydrate({ ...empty(), rows: receipt.rows }); assert.equal(state(store), 'partial');
  store.setReceipt('ordinary', receipt, program); assert.equal(state(store), 'fresh');
  store.setReceipt('ordinary'); assert.equal(state(store), 'partial');
});
check('ordinary negative and private verdict authority survives native admission and can still be withdrawn', () => {
  const store = seeded(), rule = scopedRuleHash(schema, schema.tables.deliveries.rules.read);
  store.setReceipt('ordinary-authority', { ...empty(), schema_hash: schemaDigest(schema),
    absences: [['messages', 'byId', [{ Id: 'missing' }]]],
    verdicts: [{ rule_hash: rule, pinned_inputs_digest: 'pinned', principal: recipient, auth_epoch: context.auth_epoch, result: false }],
  });
  admit(store);
  assert.equal(store.authorityAbsence('messages', 'missing'), true);
  assert.equal(store.verdict(rule, 'pinned', context), false);
  store.setReceipt('ordinary-authority');
  assert.equal(store.authorityAbsence('messages', 'missing'), false);
  assert.equal(store.verdict(rule, 'pinned', context), null);
  assert.equal(state(store), 'fresh');
});
check('point lookup closes the held index iterator before returning', () => {
  const store = seeded(); let closed = false;
  store.seek = function* () { try { yield event(); } finally { closed = true; } };
  assert(store.lookup(log, 'byId', [{ Id: 'event1' }])); assert.equal(closed, true);
});
console.log(`Native coverage checks: ${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} native coverage checks failed`);
