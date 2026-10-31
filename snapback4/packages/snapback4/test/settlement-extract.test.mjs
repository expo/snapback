import test from 'node:test';
import assert from 'node:assert/strict';
import { extract } from '../dist/settlement-extract.js';

const snapshot = { closed: false, sessionDead: false, credentialRevision: 4, incarnation: 8,
  storeIdentity: 'A', onlineStore: 'lagging', generation: 1, dispatchStore: 'A', dispatchIncarnation: 8, requestRevision: 4, requestStore: 'A' };
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
    expected: { namedStoreId: undefined, head: undefined, generation: undefined, outcome: authOutcome, certificate: { ...certificate, outcome: authOutcome, generation: undefined, authorityCurrent: false }, authorityCurrent: false, authorityParts: { ...parts, credentialCurrent: false }, generationRelation: 'unknown', storeNamed: 'absent', authority: 'obsolete', code: 'E_AUTH' } },
  { name: 'older server absent store_id uses the dispatch binding', json: { state: 'sent', seq: 21, generation: 1 }, expected: { namedStoreId: undefined, head: undefined, outcome: plainOutcome, certificate: { ...certificate, outcome: plainOutcome }, storeNamed: 'absent' } },
  { name: 'inspected additive peer execution metadata never certifies preservation', json: { state: 'sent', seq: 21, storeId: 'A', generation: 1, op: 'write', preserved: ['items'] }, input: { kind: 'observed' },
    expected: { namedStoreId: undefined, head: undefined, outcome: plainOutcome, certificate: { ...certificate, outcome: plainOutcome, authorityCurrent: false }, authorityCurrent: false, storeNamed: 'absent', authority: 'obsolete' } },
  { name: 'E_AUTH after incarnation movement still belongs to the current credential', json: auth, pin: { incarnation: 9 },
    expected: { namedStoreId: undefined, head: undefined, generation: undefined, outcome: authOutcome, certificate: { ...certificate, outcome: authOutcome, generation: undefined, authorityCurrent: false }, authorityCurrent: false, authorityParts: { ...parts, incarnationCurrent: false }, generationRelation: 'unknown', storeNamed: 'absent', code: 'E_AUTH' } },
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
  assert.deepEqual(values(facts), { ...base, ...row.expected, snapshot: pin }, 'every Facts field, including all certificate and authority decomposition fields');
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
  const result = { value: 'live result' }, why = { code: 'NO', message: 'live detail', details: ['private'] };
  assert.deepEqual(extract({ ...sent, result }, request, snapshot).outcome, { ...outcome, result });
  assert.deepEqual(extract({ state: 'failed', why }, request, snapshot).outcome, { state: 'failed', id: request.id, why });
  assert.deepEqual(extract({ ...sent, replayed: true, result }, request, snapshot).outcome, { state: 'sent', id: request.id, seq: 21, replayed: true });
});
