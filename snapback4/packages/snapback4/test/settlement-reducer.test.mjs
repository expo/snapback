import test from 'node:test';
import assert from 'node:assert/strict';
import { extract } from '../dist/settlement-extract.js';
import { initialState, step, atArrival, atSettlement } from '../dist/settlement-reducer.js';

const pin = { closed: false, sessionDead: false, credentialRevision: 1, incarnation: 1, storeIdentity: 'A', onlineStore: 'A',
  generation: 1, dispatchStore: 'A', dispatchIncarnation: 1, requestRevision: 1, requestStore: 'A' };
const request = { kind: 'response', source: 'journal-wrapper', id: 'x', op: 'write', footprintKnown: true, restoreConfirmed: false };
const body = { state: 'sent', seq: 21, store_id: 'A', generation: 1, preserved: ['items'] };
const receipt = { state: 'sent', id: 'x', seq: 21 };
const context = (snapshot = pin, json = body, input = request) => extract(json, input, snapshot);
const publications = effects => effects.filter(e => e.type === 'publish');
const episodes = effects => effects.filter(e => e.type === 'startEpisode');

function sequences() {
  const result = [];
  function visit(prefix) {
    result.push(prefix);
    if (prefix.length === 5) return;
    for (const event of ['admitted', 'response', 'observed', 'persisted', 'evicted']) {
      if ((event === 'admitted' || event === 'persisted') && prefix.includes(event)) continue;
      visit([...prefix, event]);
    }
  }
  visit([]); return result;
}

test('reducer: every event interleaving through length five crossed with certificate qualification', { timeout: 120_000 }, t => {
  const paths = sequences(), hits = [0, 0, 0, 0, 0, 0], checks = [0, 0, 0, 0, 0, 0];
  let traces = 0, transitions = 0;
  // The required 36-way certificate product, additionally crossed with both
  // outcomes and both footprint states. No event-order pruning except the two
  // requested multiplicity limits; even early persisted/evicted events run.
  for (const authority of ['current', 'obsolete']) for (const generation of [1, 2, undefined])
  for (const store of ['A', 'B']) for (const preserved of [['items'], [], undefined])
  for (const outcome of ['sent', 'failed']) for (const known of [true, false]) {
    const arrivalPin = { ...pin, credentialRevision: authority === 'current' ? 1 : 2 };
    const json = { ...body, state: outcome, store_id: store, generation, preserved,
      ...(outcome === 'failed' ? { why: { code: 'NOT_ALLOWED', retryable: false } } : {}) };
    const arrival = context(arrivalPin, json, { ...request, footprintKnown: known }), certificate = arrival.certificate;
    for (const path of paths) {
      traces++;
      let state = initialState(), published = 0, settled = 0, delivered = 0;
      for (const [index, type] of path.entries()) {
        // Qualification changes between the two decision points. Cover each
        // boundary across the generated traces without a random seed.
        const boundary = (traces + index) % 6;
        const now = { ...arrivalPin, ...(boundary === 1 ? { credentialRevision: 9 } : boundary === 2 ? { incarnation: 9 }
          : boundary === 3 ? { storeIdentity: 'B' } : boundary === 4 ? { generation: 2 } : boundary === 5 ? { closed: true } : {}) };
        const facts = context(now, json, { ...request, footprintKnown: known });
        const event = type === 'admitted' ? { type, op: 'write', footprintKnown: known }
          : type === 'response' ? { type, certificate }
          : type === 'observed' ? { type, receipt: certificate.outcome } : { type };
        const before = state, beforeCopy = { ...before }, { state: next, effects } = step(state, event, facts);
        transitions++;
        assert.deepEqual(before, beforeCopy, 'step does not mutate its input');
        const ep = episodes(effects), pub = publications(effects);
        // P1: each live same-store known arrival starts revocation now, even
        // with no persistence in the prefix; unknown evidence never invents it.
        checks[0]++;
        if (type === 'response') {
          const starts = !now.closed && !now.sessionDead && store === now.storeIdentity && preserved !== undefined;
          assert.equal(ep.length, starts ? 1 : 0);
          if (starts) {
            hits[0]++;
            const qualified = authority === 'current' && now.credentialRevision === 1 && now.incarnation === 1 && now.storeIdentity === 'A' && generation !== undefined && generation === now.generation;
            assert.deepEqual(ep[0].preserved, qualified ? preserved : []);
            assert.equal(ep[0].scope, !known || generation === undefined || generation !== now.generation ? 'every-watch' : qualified ? 'qualified' : 'all-columns-of-known-tables');
          }
        }
        // P2: exactly one publication on the first meaningful pending exit,
        // with its cut carried in the same effect. Arrival never publishes.
        checks[1]++; published += pub.length;
        settled += effects.filter(e => e.type === 'settle').length;
        delivered += effects.filter(e => e.type === 'deliverOutcome').length;
        assert.ok(published <= 1 && settled <= 1 && delivered <= 1);
        const exits = before.phase !== 'settled' && (type === 'observed' || type === 'persisted' && before.outcome !== undefined);
        assert.equal(pub.length, exits ? 1 : 0);
        if (exits) { hits[1]++; assert.equal(next.published, true); }
        // P3: an actual response certificate wins over every inspected placeholder.
        checks[2]++;
        if (before.certificate && type === 'observed') { hits[2]++; assert.equal(next.certificate, before.certificate); }
        // P4: no outcome/settlement/publication/retention after peer completion.
        checks[3]++;
        if (type === 'response' && before.phase === 'settled') { hits[3]++; assert.ok(effects.every(e => e.type === 'startEpisode')); assert.equal(next.certificate, before.certificate); }
        // P5: independently derive the publication from the *current* pin and
        // stored receipt, never reuse arrival qualification or inspection generation.
        checks[4]++;
        if (pub.length) {
          hits[4]++;
          const c = before.certificate, effective = c?.outcome ?? event.receipt ?? before.outcome;
          const effectiveStore = c?.storeId ?? before.storeId ?? facts.storeId;
          const sameStore = effectiveStore !== undefined && effectiveStore === now.storeIdentity;
          const sameGeneration = c !== undefined && c.generation !== undefined && c.generation === now.generation;
          const current = c !== undefined && authority === 'current' && now.credentialRevision === 1 && now.incarnation === 1 && now.storeIdentity === 'A';
          const live = !now.closed && !now.sessionDead;
          assert.deepEqual(pub[0].publication, {
            cut: live && sameStore && effective.state === 'sent' ? effective.seq : undefined,
            preserved: live && sameStore && c?.preserved !== undefined ? current && sameGeneration ? c.preserved : [] : undefined,
            footprint: known && (!live || !sameStore || effective.state === 'failed' || sameGeneration) ? 'qualified' : 'unknown',
          });
        }
        // P6: eviction preserves pending, unpublished and outstanding own work.
        checks[5]++;
        if (type === 'evicted') {
          hits[5]++;
          assert.deepEqual(effects, [{ type: before.phase !== 'settled' || !before.published || before.responseOutstanding ? 'refuseEviction' : 'discard' }]);
        }
        state = next;
      }
    }
  }
  for (const n of hits) assert.ok(n > 0);
  t.diagnostic(`reducer generated: ${paths.length} sequences (including empty); 36 certificate qualifications x 2 outcomes x 2 footprints; ${traces} traces; ${transitions} transitions; 6 properties; ${checks.reduce((a,b)=>a+b,0)} predicate evaluations`);
  t.diagnostic(`property non-vacuity counts P1..P6: ${JSON.stringify(hits)}`);
});

test('row: late own response after peer completion revokes only and releases the eviction pin', () => {
  const f = context(); let state = initialState();
  ({ state } = step(state, { type: 'admitted', op: 'write', footprintKnown: true }, f));
  ({ state } = step(state, { type: 'observed', receipt }, f));
  assert.deepEqual(step(state, { type: 'evicted' }, f).effects, [{ type: 'refuseEviction' }]);
  const late = step(state, { type: 'response', certificate: f.certificate }, f);
  assert.deepEqual(late.effects, [{ type: 'startEpisode', preserved: ['items'], scope: 'qualified' }]);
  assert.deepEqual(step(late.state, { type: 'evicted' }, f).effects, [{ type: 'discard' }]);
});
test('row: stored certificate beats inspection placeholder and starts before a stalled save', () => {
  const f = context(), first = step(initialState(), { type: 'response', certificate: f.certificate }, f);
  assert.equal(episodes(first.effects).length, 1); assert.equal(publications(first.effects).length, 0);
  const placeholder = context(pin, { state: 'sent', seq: 99 }, { ...request, kind: 'observed' });
  const result = step(first.state, { type: 'observed', receipt: { ...receipt, seq: 99 } }, placeholder);
  assert.deepEqual(publications(result.effects)[0].publication, { cut: 21, preserved: ['items'], footprint: 'qualified' });
});
test('row: failed receipts keep the operation footprint across generations', () => {
  const f = context(pin, { state: 'failed', why: { code: 'NO' }, store_id: 'A', generation: 2 });
  const { state } = step(initialState(), { type: 'response', certificate: f.certificate }, f);
  assert.deepEqual(atSettlement(state, f), { cut: undefined, preserved: undefined, footprint: 'qualified' });
});
test('row: differing success generation publishes an unknown footprint and revokes every watch', () => {
  const f = context(pin, { ...body, generation: 2 });
  assert.deepEqual(atArrival(f.certificate, f).episode, { preserved: [], scope: 'every-watch' });
  const { state } = step(initialState(), { type: 'response', certificate: f.certificate }, f);
  assert.deepEqual(publications(step(state, { type: 'persisted' }, f).effects)[0].publication, { cut: 21, preserved: [], footprint: 'unknown' });
});
test('row: inspected legacy peer installs the conservative all-table cut without an episode', () => {
  const f = context(pin, { state: 'sent', seq: 21 }, { ...request, kind: 'observed' });
  const result = step(initialState(false), { type: 'observed', receipt }, f);
  assert.deepEqual(publications(result.effects)[0].publication, { cut: 21, preserved: undefined, footprint: 'unknown' });
  assert.deepEqual(episodes(result.effects), []);
});
test('row: another store delivers its outcome without installing a cut', () => {
  const f = context(pin, { ...body, store_id: 'B' });
  const first = step(initialState(), { type: 'response', certificate: f.certificate }, f);
  assert.deepEqual(first.effects.find(e => e.type === 'deliverOutcome').outcome, receipt);
  assert.equal(publications(step(first.state, { type: 'persisted' }, f).effects)[0].publication.cut, undefined);
});
test('row: lifetime-ended still delivers the owner terminal outcome', () => {
  const f = context({ ...pin, closed: true });
  const result = step(initialState(), { type: 'response', certificate: f.certificate }, f);
  assert.deepEqual(result.effects, [{ type: 'deliverOutcome', outcome: receipt }, { type: 'retain' }]);
  assert.deepEqual(publications(step(result.state, { type: 'persisted' }, f).effects)[0].publication, { cut: undefined, preserved: undefined, footprint: 'qualified' });
});
test('owner delivery preserves full live success and failure details across lifetime end', () => {
  for (const json of [{ ...body, result: { value: 'owner result' } }, { state: 'failed', why: { code: 'NO', message: 'owner detail', details: [1] } }]) {
    const f = context({ ...pin, sessionDead: true }, json);
    const delivered = step(initialState(), { type: 'response', certificate: f.certificate }, f).effects.find(e => e.type === 'deliverOutcome');
    assert.deepEqual(delivered.outcome, f.outcome);
    if (json.result) assert.deepEqual(delivered.outcome.result, json.result);
    else assert.deepEqual(delivered.outcome.why, json.why);
  }
});
test('observed certificate starts its episode immediately and retains execution generation', () => {
  const f = context(), result = step(initialState(false), { type: 'observed', receipt, certificate: f.certificate }, f);
  assert.equal(result.effects[0].type, 'startEpisode');
  assert.deepEqual(publications(result.effects)[0].publication, { cut: 21, preserved: ['items'], footprint: 'qualified' });
});
test('second decision rechecks store, credential, incarnation, generation and lifetime independently', () => {
  const arrival = context(), { state } = step(initialState(), { type: 'response', certificate: arrival.certificate }, arrival);
  for (const [change, expected] of [
    [{ storeIdentity: 'B' }, { cut: undefined, preserved: undefined, footprint: 'qualified' }],
    [{ credentialRevision: 2 }, { cut: 21, preserved: [], footprint: 'qualified' }],
    [{ incarnation: 2 }, { cut: 21, preserved: [], footprint: 'qualified' }],
    [{ generation: 2 }, { cut: 21, preserved: [], footprint: 'unknown' }],
    [{ sessionDead: true }, { cut: undefined, preserved: undefined, footprint: 'qualified' }],
  ]) assert.deepEqual(atSettlement(state, context({ ...pin, ...change })), expected);
});
