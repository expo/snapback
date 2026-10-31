import test from 'node:test';
import assert from 'node:assert/strict';
import { decideRefusal, reachable } from '../dist/refusal-decision.js';

test('refusal: full seven-input product with explicit unreachable reasons and row properties', t => {
  let yes = 0, no = 0;
  const reasons = {}, witnesses = { fence: 0, retirement: 0, direct: 0, terminal: 0, notify: 0, retry: 0, foreign: 0, binding: 0, ended: 0 };
  for (const source of ['journal-wrapper', 'raw-onWrite', 'dispatch-binding'])
  for (const code of ['E_STORE_REPLACED', 'E_DEV_RESET', 'E_STORE_RESTORE', 'E_AUTH', 'other'])
  for (const retryable of [false, true]) for (const storeNamed of ['equals-dispatch', 'differs', 'absent'])
  for (const requestStore of ['equals-dispatch', 'differs', 'absent']) for (const authority of ['current', 'obsolete', 'lifetime-ended'])
  for (const restoreConfirmed of [false, true]) {
    const f = { source, code, retryable, storeNamed, requestStore, authority, restoreConfirmed, authorityCurrent: () => authority === 'current' };
    // Independent actor domains. Invalid rows are checked, not filtered out.
    const confirmation = !restoreConfirmed || code === 'E_STORE_RESTORE' && !retryable;
    const binding = source !== 'dispatch-binding' || code === 'E_STORE_REPLACED' && !retryable && !restoreConfirmed && storeNamed === 'absent' && requestStore !== 'equals-dispatch';
    const raw = source !== 'raw-onWrite' || !retryable && storeNamed === 'absent' && requestStore === 'absent';
    const valid = confirmation && binding && raw, reach = reachable(f);
    assert.equal(reach.reachable, valid, JSON.stringify(f));
    if (!valid) {
      no++;
      const reason = !confirmation ? 'confirmation requires a terminal restore'
        : source === 'dispatch-binding' ? (code !== 'E_STORE_REPLACED' || retryable || restoreConfirmed ? 'binding produces only a terminal replacement' : 'binding has no server reply and refuses a foreign or unbound intent')
        : retryable ? 'raw onWrite emits terminal outcomes, not transport retries' : 'raw onWrite has no request or reply store envelope';
      assert.equal(reach.reason, reason); reasons[reason] = (reasons[reason] ?? 0) + 1;
      assert.deepEqual(decideRefusal(f), !confirmation ? decideRefusal({ ...f, restoreConfirmed: false })
        : { reads: "keep", dispatcher: "keep", reopen: "allowed", metadata: "none", notify: "none", transport: "settle" });
      continue;
    }
    yes++;
    const d = decideRefusal(f), store = ['E_STORE_REPLACED', 'E_DEV_RESET', 'E_STORE_RESTORE'].includes(code);
    const eligible = source !== 'dispatch-binding' && authority !== 'lifetime-ended' && !retryable && store;
    const fences = eligible && source === 'journal-wrapper' && authority === 'current'
      && (code === 'E_STORE_REPLACED' ? storeNamed !== 'equals-dispatch' : requestStore !== 'differs');
    const retires = eligible && (code !== 'E_STORE_RESTORE' || source === 'raw-onWrite' || restoreConfirmed && authority === 'current' || fences);
    assert.equal(d.reads === 'fence', fences); if (fences) witnesses.fence++;
    assert.equal(d.dispatcher !== 'keep', retires); if (retires) witnesses.retirement++;
    assert.equal(d.metadata === 'adopt-directly', fences); if (d.metadata === 'adopt-directly') witnesses.direct++;
    assert.equal(d.reopen === 'terminal', retires && code === 'E_STORE_RESTORE' && (restoreConfirmed || fences)); if (d.reopen === 'terminal') witnesses.terminal++;
    assert.equal(d.notify === 'once', retires && source === 'journal-wrapper' && code !== 'E_STORE_RESTORE'); if (d.notify === 'once') witnesses.notify++;
    assert.equal(d.transport === 'retry', source === 'journal-wrapper' && code === 'E_AUTH' && authority === 'obsolete'); if (d.transport === 'retry') witnesses.retry++;
    if (authority !== 'current') assert.equal(d.metadata, 'none');
    // A fence must retire ALL independently of raw/confirmation predicates.
    if (d.reads === 'fence') assert.equal(d.dispatcher, 'retire-all');
    if (retires && (source === 'raw-onWrite' || restoreConfirmed)) assert.equal(d.dispatcher, 'retire-all');
    if (retires && source === 'journal-wrapper' && !fences && !restoreConfirmed) { assert.equal(d.dispatcher, 'retire-foreign'); witnesses.foreign++; }
    if (source === 'dispatch-binding') { assert.equal(d.dispatcher, 'keep'); witnesses.binding++; }
    if (authority === 'lifetime-ended') { assert.deepEqual(d, { reads: 'keep', dispatcher: 'keep', reopen: 'allowed', metadata: 'none', notify: 'none', transport: 'settle' }); witnesses.ended++; }
    const online = source === 'journal-wrapper' && authority === 'current' && (code !== 'E_AUTH' || retryable) && (retryable || !store || code === 'E_STORE_REPLACED' && storeNamed === 'equals-dispatch');
    assert.equal(d.metadata === 'through-online-evidence', online);
    if (code === 'E_STORE_RESTORE') assert.equal(d.notify, 'none');
  }
  assert.equal(yes + no, 1620);
  for (const [property, count] of Object.entries(witnesses)) assert.ok(count > 0, `${property} must be exercised`);
  t.diagnostic(`refusal product: 1620 rows; reachable ${yes}; unreachable ${no}; six RFC row properties plus actor/scope checks`);
  t.diagnostic(`unreachable reasons: ${JSON.stringify(reasons)}`);
  t.diagnostic(`non-vacuity: ${JSON.stringify(witnesses)}`);
});

const row = { source: 'journal-wrapper', code: 'E_STORE_REPLACED', retryable: false,
  storeNamed: 'equals-dispatch', requestStore: 'differs', authority: 'current', restoreConfirmed: false, authorityCurrent: () => true };
test('S2a 1: already-adopted store still requests dispatcher recovery', () => {
  assert.equal(decideRefusal(row).notify, 'once');
});
for (const authority of ['current', 'obsolete']) test(`S2a 2a: unfenced restore under ${authority} keeps dispatcher`, () => {
  for (const restoreConfirmed of authority === 'obsolete' ? [false, true] : [false]) {
    const d = decideRefusal({ ...row, code: 'E_STORE_RESTORE', authority, restoreConfirmed });
    assert.equal(d.dispatcher, 'keep'); assert.equal(d.notify, 'none');
  }
});
test('S2a 2b: server restore fence confirms terminal retirement itself', () => {
  for (const requestStore of ['equals-dispatch', 'absent']) {
    const d = decideRefusal({ ...row, code: 'E_STORE_RESTORE', requestStore });
    assert.equal(d.reads, 'fence'); assert.equal(d.dispatcher, 'retire-all'); assert.equal(d.reopen, 'terminal');
  }
});
test('S2a 4 / S2c 8: a contradictory confirmation cannot suppress the real refusal', () => {
  const f = { ...row, storeNamed: 'differs', restoreConfirmed: true };
  assert.equal(reachable(f).reachable, false);
  assert.deepEqual(decideRefusal(f), { reads: 'fence', dispatcher: 'retire-all', reopen: 'allowed', metadata: 'adopt-directly', notify: 'once', transport: 'settle' });
});
for (const code of ['other', 'E_AUTH', 'E_STORE_REPLACED', 'E_DEV_RESET', 'E_STORE_RESTORE'])
test(`S2a 5: ordinary or retryable ${code} runs online evidence`, () => {
  assert.equal(decideRefusal({ ...row, code, retryable: code !== 'other' }).metadata, 'through-online-evidence');
});

for (const code of ['E_STORE_REPLACED', 'E_DEV_RESET', 'E_STORE_RESTORE'])
test(`S2c 6: raw ${code} retires without promising an unavailable onStoreChange callback`, () => {
  const decision = decideRefusal({ ...row, source: 'raw-onWrite', storeNamed: 'absent', requestStore: 'absent', code });
  assert.equal(decision.dispatcher, 'retire-all'); assert.equal(decision.notify, 'none');
});
