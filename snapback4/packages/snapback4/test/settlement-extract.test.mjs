import test from 'node:test';
import assert from 'node:assert/strict';
import { canRevoke } from '../dist/change-evidence.js';
import { initialState, step, atSettlement } from '../dist/settlement-reducer.js';
import { decideRefusal } from '../dist/refusal-decision.js';
import { extract } from '../dist/settlement-extract.js';

const snapshot = { closed: false, sessionDead: false, credentialRevision: 4, incarnation: 8,
  storeIdentity: 'A', onlineStore: 'lagging', generation: 1, onlineHead: 30, onlineGeneration: 3, dispatchWatermark: 20, dispatchSendRevision: 0, dispatchStore: 'A', dispatchIncarnation: 8, requestRevision: 4, requestStore: 'A' };
const request = { kind: 'response', source: 'journal-wrapper', id: 'write-id', op: 'write', footprintKnown: true, restoreConfirmed: false };
const sent = { state: 'sent', seq: 21, head: 21, store_id: 'A', generation: 1, replayed: false };
const outcome = { state: 'sent', id: 'write-id', seq: 21, replayed: false };
const parts = { lifetimeLive: true, credentialCurrent: true, incarnationCurrent: true, dispatchStoreCurrent: true };
const certificate = { outcome, storeId: 'A', generation: 1, preserved: undefined, op: 'write', authorityCurrent: true };
const base = { snapshot, outcome, certificate, storeId: 'A', namedStoreId: 'A', head: 21, generation: 1, storeRelation: 'same', generationRelation: 'same',
  authorityCurrent: true, authorityParts: parts, preservedKind: 'absent', footprintKnown: true, op: 'write',
  source: 'journal-wrapper', code: 'other', retryable: false, storeNamed: 'equals-dispatch', requestStore: 'equals-dispatch', authority: 'current', restoreConfirmed: false };
const failed = { state: 'failed', id: 'write-id', why: { code: 'E_STORE_REPLACED', family: 'store', message: 'request belongs to another store', retryable: false } };
const authOutcome = { state: 'failed', id: 'write-id', why: { code: 'E_AUTH', family: 'auth', message: 'expired', retryable: false } };
const plainOutcome = { state: 'sent', id: 'write-id', seq: 21 };
const auth = { state: 'failed', why: { code: 'E_AUTH', family: 'auth', message: 'expired', retryable: false } };
// The replacement row is the HTTP-200 body from helpers/progressive-writes and
// serve_operation.rs, not the old HTTP-409 {denied} approximation.
const rows = [
  { name: 'HTTP 200 judged replacement refusal', json: { state: 'failed', why: { code: 'E_STORE_REPLACED', family: 'store', message: 'request belongs to another store', retryable: false }, store_id: 'B', head: 0, generation: 2 },
    expected: { namedStoreId: 'B', head: 0, generation: 2, outcome: failed, certificate: { ...certificate, outcome: failed, storeId: 'B', generation: 2 }, storeId: 'B', storeRelation: 'other', generationRelation: 'differs', storeNamed: 'differs', code: 'E_STORE_REPLACED' } },
  { name: 'known empty under rotated credential', json: { ...sent, preserved: [] }, pin: { credentialRevision: 5 },
    expected: { certificate: { ...certificate, preserved: [], authorityCurrent: false }, authorityCurrent: false, authorityParts: { ...parts, credentialCurrent: false }, preservedKind: 'empty', authority: 'obsolete' } },
  { name: 'sent with a different execution generation', json: { ...sent, generation: 2, preserved: ['items'] },
    expected: { generation: 2, certificate: { ...certificate, generation: 2, preserved: ['items'] }, generationRelation: 'differs', preservedKind: 'list' } },
  { name: 'inspected legacy peer has no certificate', json: { state: 'sent', seq: 21, replayed: true }, input: { kind: 'observed' },
    expected: { namedStoreId: undefined, head: undefined, generation: undefined, outcome: { ...plainOutcome, replayed: true }, certificate: undefined, authorityCurrent: false, generationRelation: 'unknown', storeNamed: 'absent', authority: 'obsolete' } },
  { name: 'E_AUTH after rotation retries the old credential', json: auth, pin: { credentialRevision: 5 },
    expected: { namedStoreId: undefined, head: undefined, generation: undefined, outcome: undefined, certificate: undefined, authorityCurrent: false, authorityParts: { ...parts, credentialCurrent: false }, generationRelation: 'unknown', storeNamed: 'absent', authority: 'obsolete', code: 'E_AUTH' } },
  { name: 'older server absent store_id uses the dispatch binding', json: { state: 'sent', seq: 21, generation: 1 }, expected: { namedStoreId: undefined, head: undefined, outcome: plainOutcome, certificate: { ...certificate, outcome: plainOutcome }, storeNamed: 'absent' } },
  { name: 'inspected additive peer execution metadata never certifies preservation', json: { state: 'sent', seq: 21, storeId: 'A', generation: 1, op: 'write', preserved: ['items'] }, input: { kind: 'observed' },
    expected: { namedStoreId: undefined, head: undefined, outcome: plainOutcome, certificate: { ...certificate, outcome: plainOutcome, authorityCurrent: false }, authorityCurrent: false, storeNamed: 'absent', authority: 'obsolete' } },
  { name: 'E_AUTH after incarnation movement still belongs to the current credential', json: auth, pin: { incarnation: 9 },
    expected: { namedStoreId: undefined, head: undefined, generation: undefined, outcome: undefined, certificate: undefined, authorityCurrent: false, authorityParts: { ...parts, incarnationCurrent: false }, generationRelation: 'unknown', storeNamed: 'absent', code: 'E_AUTH' } },
  { name: 'closed lifetime overrides otherwise current authority', json: sent, pin: { closed: true },
    expected: { certificate: { ...certificate, authorityCurrent: false }, authorityCurrent: false, authorityParts: { ...parts, lifetimeLive: false }, authority: 'lifetime-ended' } },
  { name: 'malformed non-null preservation is known conservative revocation', json: { ...sent, preserved: { items: true } },
    expected: { certificate: { ...certificate, preserved: [] }, preservedKind: 'empty' } },
  { name: 'unknown store generation and footprint remain unknown', json: { state: 'sent', seq: 21 }, pin: { storeIdentity: undefined, onlineStore: undefined, dispatchStore: undefined, requestStore: undefined, generation: undefined }, input: { op: undefined, footprintKnown: false },
    expected: { namedStoreId: undefined, head: undefined, generation: undefined, outcome: plainOutcome, certificate: { ...certificate, outcome: plainOutcome, storeId: undefined, generation: undefined, op: undefined }, storeId: undefined, storeRelation: 'unknown', generationRelation: 'unknown', requestStore: 'absent', storeNamed: 'absent', op: undefined, footprintKnown: false } },
];
function values(facts) {
  return { ...facts, authorityCurrent: facts.authorityCurrent(),
    certificate: facts.certificate && { ...facts.certificate, authorityCurrent: facts.certificate.authorityCurrent() } };
}
for (const row of rows) test(`extract: ${row.name}`, () => {
  const pin = { ...snapshot, ...row.pin }, input = { ...request, ...row.input }, original = structuredClone({ json: row.json, pin, input });
  const facts = extract(row.json, input, pin);
  const metadata = [
    { storeId: 'B', head: 0, generation: 2 }, { storeId: 'A', head: 21, generation: 1 },
    { storeId: 'A', head: 21, generation: 2 }, { storeId: undefined, head: undefined, generation: undefined },
    { storeId: undefined, head: undefined, generation: undefined }, { storeId: undefined, head: 21, generation: 1 },
    { storeId: undefined, head: 21, generation: 1 }, { storeId: undefined, head: undefined, generation: undefined },
    { storeId: 'A', head: 21, generation: 1 }, { storeId: 'A', head: 21, generation: 1 },
    { storeId: undefined, head: 21, generation: undefined },
  ][rows.indexOf(row)];
  assert.deepEqual(values(facts), { ...base, ...row.expected, snapshot: pin, kind: input.kind,
    capture: { store_id: pin.dispatchStore ?? null, watermark: 20, send_revision: 0 }, onlineMetadata: metadata,
    refusal: row.json.why }, 'every Facts field, including all certificate and authority decomposition fields');
  assert.deepEqual({ json: row.json, pin, input }, original, 'extraction is pure');
  const atArrival = facts.authorityCurrent();
  pin.closed = !pin.closed; pin.credentialRevision++;
  assert.equal(facts.authorityCurrent(), atArrival, 'the closure pins caller-owned values');
  assert.equal(facts.authorityCurrent({ ...snapshot, closed: true }), false);
  assert.equal(facts.authorityCurrent({ ...snapshot, credentialRevision: 99 }), false);
  assert.equal(facts.authorityCurrent({ ...snapshot, incarnation: 99 }), false);
  assert.equal(facts.authorityCurrent({ ...snapshot, storeIdentity: 'B' }), false);
});
test('extract: preservation and wire mutations cannot mutate the pinned certificate', () => {
  const json = { ...sent, preserved: ['items'] }, facts = extract(json, request, snapshot);
  json.preserved.push('other'); json.generation = 8;
  assert.deepEqual(facts.certificate.preserved, ['items']); assert.equal(facts.certificate.generation, 1);
});
test('extract: live outcomes retain results and refusal details for their owner only', () => {
  const result = { value: 'live result' }, why = { family: 'input', code: 'NO', message: 'live detail', details: ['private'] };
  assert.deepEqual(extract({ ...sent, result }, request, snapshot).outcome, { ...outcome, result });
  assert.deepEqual(extract({ state: 'failed', why }, request, snapshot).outcome, { state: 'failed', id: request.id, why });
  assert.deepEqual(extract({ ...sent, replayed: true, result }, request, snapshot).outcome, { state: 'sent', id: request.id, seq: 21, replayed: true });
});

test('S2a 6: overload retains refusal facts without a terminal outcome or certificate', () => {
  const f = extract({ state: 'failed', why: { family: 'input', message: 'refused', code: 'E_OVERLOADED', retryable: true } }, request, snapshot);
  assert.deepEqual(f.refusal, { family: 'input', message: 'refused', code: 'E_OVERLOADED', retryable: true }); assert.equal(f.retryable, true); assert.equal(f.outcome, undefined); assert.equal(f.certificate, undefined);
});
test('S2a 7: paired B requests keep their different dispatch watermarks and online metadata', () => {
  const pin = { ...snapshot, storeIdentity: 'B', onlineStore: 'B', dispatchStore: 'B', requestStore: 'B', onlineHead: 30, onlineGeneration: 9, generation: 1, dispatchSendRevision: 6 };
  const json = { ...sent, store_id: 'B', head: 30, generation: 10 };
  const facts = [20, 40].map(dispatchWatermark => extract(json, request, { ...pin, dispatchWatermark }));
  for (const [i, f] of facts.entries()) {
    assert.deepEqual(f.capture, { store_id: 'B', watermark: [20, 40][i], send_revision: 6 });
    assert.deepEqual(f.onlineMetadata, { storeId: 'B', head: 30, generation: 10 });
    assert.equal(f.snapshot.onlineGeneration, 9); assert.equal(f.snapshot.generation, 1);
  }
  assert.deepEqual(facts.map(f => f.onlineMetadata.head < f.capture.watermark), [false, true]);
});
for (const length of [129, 512, 513]) test(`S2a 8: preservation name length ${length}`, () => {
  const name = 'x'.repeat(length), f = extract({ ...sent, preserved: [name] }, request, snapshot);
  assert.deepEqual(f.certificate.preserved, length <= 512 ? [name] : []);
  assert.equal(canRevoke(new Set([name]), { [name]: [] }, [name]), length > 512);
});
test('S2a 9: observation kind survives extraction', () => {
  assert.equal(extract({ state: 'failed', why: { family: 'input', message: 'refused', code: 'E_STORE_REPLACED' }, storeId: 'A', generation: 1, op: 'write' }, { ...request, kind: 'observed' }, snapshot).kind, 'observed');
});
test('S2a 10: failed certificates never carry preservation', () => {
  const f = extract({ state: 'failed', why: { family: 'input', message: 'refused', code: 'NO' }, preserved: ['items'] }, request, snapshot);
  assert.equal(f.certificate.preserved, undefined); assert.equal(f.preservedKind, 'absent');
});

for (const code of ['E_AUTH', 'E_CLOSED']) test(`S2c 4: ${code} keeps admitted custody across retirement and rotation`, () => {
  for (const retryable of [false, true]) for (const closed of [false, true])
  for (const sessionDead of [false, true]) for (const credentialRevision of [4, 5]) {
    const why = { code, family: 'auth', message: 'retired', retryable };
    const facts = extract({ state: 'failed', why }, request, { ...snapshot, closed, sessionDead, credentialRevision });
    assert.deepEqual(facts.refusal, why);
    assert.equal(facts.outcome, undefined, 'a session/transport refusal does not settle the admitted intent');
    assert.equal(facts.certificate, undefined);
    if (code === 'E_AUTH') assert.equal(facts.authority, credentialRevision !== 4 ? 'obsolete' : closed || sessionDead ? 'lifetime-ended' : 'current');
  }
});

test('S2c 1: credential freshness cannot authorize metadata after store or incarnation movement', () => {
  for (const retryable of [false, true]) for (const incarnation of [8, 9])
  for (const storeIdentity of ['A', 'B']) for (const sessionDead of [false, true]) {
    const f = extract({ state: 'failed', why: { family: 'input', message: 'refused', code: 'E_AUTH', retryable }, store_id: 'A', head: 21, generation: 1 },
      request, { ...snapshot, incarnation, storeIdentity, sessionDead });
    assert.equal(f.authorityParts.credentialCurrent, true);
    assert.equal(f.authority, sessionDead ? 'lifetime-ended' : 'current');
    assert.equal(decideRefusal(f).transport, 'settle', 'incarnation movement does not retry current credentials');
    assert.equal(decideRefusal(f).metadata, retryable && !sessionDead && incarnation === 8 && storeIdentity === 'A' ? 'through-online-evidence' : 'none');
  }
  const rotated = extract(auth, request, { ...snapshot, closed: true, credentialRevision: 5 });
  assert.equal(decideRefusal(rotated).transport, 'retry', 'rotation outranks lifetime end');
});

test('S2c 2: replay serving generation cannot qualify an earlier execution footprint', () => {
  const replay = { ...sent, replayed: true, generation: 2, head: 40, preserved: ['items'] };
  const f = extract(replay, request, { ...snapshot, generation: 2 });
  assert.equal(f.onlineMetadata.generation, 2);
  assert.equal(f.generation, 2, 'direct wire generation is still serving metadata');
  assert.equal(f.certificate.generation, undefined);
  assert.equal(f.generationRelation, 'unknown');
  const arrived = step(initialState(), { type: 'response', certificate: f.certificate }, f);
  assert.deepEqual(atSettlement(arrived.state, f), { invalidate: true, cut: 21, preserved: [], footprint: 'unknown' });
  const observed = extract({ state: 'sent', seq: 21, replayed: true, storeId: 'A', generation: 1, op: 'write' },
    { ...request, kind: 'observed' }, { ...snapshot, generation: 2 });
  assert.equal(observed.certificate.generation, 1, 'a separately proven persisted execution keeps its generation');
});

for (const [name, why] of Object.entries({ missing: undefined, null: null, string: 'refused', array: [], empty: {}, badCode: { code: 7, family: 'input', message: 'bad' }, emptyCode: { code: '', family: 'input', message: 'bad' }, missingFamily: { code: 'NO', message: 'bad' }, badMessage: { code: 'NO', family: 'input', message: null }, badRetryable: { code: 'NO', family: 'input', message: 'bad', retryable: 'no' } }))
test(`S2c 3: malformed failed ${name} cannot settle admitted custody`, () => {
  const f = extract({ state: 'failed', why }, request, snapshot);
  assert.equal(f.outcome, undefined); assert.equal(f.certificate, undefined); assert.equal(f.refusal, undefined);
  assert.deepEqual(step(initialState(), { type: 'persisted' }, f).effects, []);
});
