import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// This is an executable protocol model, not a queue implementation or a
// capability claim. It deliberately has no import path from product runtime.
// @ref LLP 0070#state-machine — exhaustive legal edges, CAS/fence guards,
//   cancellation precedence, reclaim supersession, and terminal immutability.
// @ref LLP 0070#acceptance — one shared corpus must be exercised by multiple
//   language arms before a storage target can seek the profile claim.

const fixtureUrl = new URL('./conformance/durable-work-state-machine-v0.json', import.meta.url);
const corpus = JSON.parse(await readFile(fixtureUrl, 'utf8'));
const transitionByKey = new Map(
  corpus.transitions.map((transition) => [
    `${transition.current}\0${transition.event}`,
    transition,
  ]),
);

function stateFor(state) {
  const claimed = state === 'claimed' || state === 'cancelRequested';
  return {
    state,
    stateVersion: 7,
    attempt: 2,
    fence: 2,
    claimId: claimed ? 'claim-2' : null,
    slotOwner: claimed ? 'claim-2' : null,
    targetIncarnation: 'target-a',
    restoreEpoch: 4,
    executionDomain: 'domain-a',
  };
}

function guardFor(state, override = {}) {
  return {
    stateVersion: state.stateVersion,
    targetIncarnation: state.targetIncarnation,
    restoreEpoch: state.restoreEpoch,
    executionDomain: state.executionDomain,
    claimId: state.claimId,
    fence: state.fence,
    ...override,
  };
}

function refuse(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function applyTransition(state, event, guard, { nextClaimId = 'claim-next' } = {}) {
  if (
    guard.stateVersion !== state.stateVersion
    || guard.targetIncarnation !== state.targetIncarnation
    || guard.restoreEpoch !== state.restoreEpoch
    || guard.executionDomain !== state.executionDomain
  ) {
    refuse('SNAPBACK_JOB_CAS_STALE');
  }

  const transition = transitionByKey.get(`${state.state}\0${event}`);
  if (!transition) {
    refuse('SNAPBACK_JOB_TRANSITION_INVALID');
  }
  if (
    transition.claimGuard
    && (guard.claimId !== state.claimId || guard.fence !== state.fence)
  ) {
    refuse('SNAPBACK_JOB_CLAIM_STALE');
  }

  const next = {
    ...state,
    state: transition.next,
    stateVersion: state.stateVersion + 1,
    attempt: state.attempt + transition.attemptDelta,
    fence: state.fence + transition.fenceDelta,
  };

  switch (transition.slot) {
    case 'acquire':
    case 'transfer':
      next.claimId = nextClaimId;
      next.slotOwner = nextClaimId;
      break;
    case 'retain':
      break;
    case 'release':
    case 'none':
      next.claimId = null;
      next.slotOwner = null;
      break;
    default:
      refuse('SNAPBACK_JOB_CORPUS_INVALID');
  }

  return { next, transition };
}

test('durable-work corpus is explicitly Draft-bound and internally complete', () => {
  assert.equal(corpus.version, 'durable-work-state-machine-v0');
  assert.equal(corpus.rfc, 'LLP 0070');
  assert.equal(corpus.claimClass, 'draft-nonclaim');
  assert.equal(new Set(corpus.states).size, corpus.states.length);
  assert.equal(new Set(corpus.events).size, corpus.events.length);
  assert.equal(new Set(transitionByKey).size, corpus.transitions.length);
  for (const terminal of corpus.terminalStates) {
    assert.ok(corpus.states.includes(terminal));
  }
});

test('every admitted transition applies its version, attempt, fence, and slot rule', () => {
  for (const expected of corpus.transitions) {
    const before = stateFor(expected.current);
    const { next, transition } = applyTransition(
      before,
      expected.event,
      guardFor(before),
    );
    assert.deepEqual(transition, expected);
    assert.equal(next.state, expected.next);
    assert.equal(next.stateVersion, before.stateVersion + 1);
    assert.equal(next.attempt, before.attempt + expected.attemptDelta);
    assert.equal(next.fence, before.fence + expected.fenceDelta);
    if (expected.slot === 'acquire' || expected.slot === 'transfer') {
      assert.equal(next.claimId, 'claim-next');
      assert.equal(next.slotOwner, 'claim-next');
    } else if (expected.slot === 'retain') {
      assert.equal(next.claimId, before.claimId);
      assert.equal(next.slotOwner, before.slotOwner);
    } else {
      assert.equal(next.claimId, null);
      assert.equal(next.slotOwner, null);
    }
  }
});

test('the full state/event cross-product rejects every unspecified edge', () => {
  let rejected = 0;
  for (const stateName of corpus.states) {
    for (const event of corpus.events) {
      if (transitionByKey.has(`${stateName}\0${event}`)) continue;
      const before = stateFor(stateName);
      assert.throws(
        () => applyTransition(before, event, guardFor(before)),
        { code: 'SNAPBACK_JOB_TRANSITION_INVALID' },
        `${stateName} + ${event}`,
      );
      rejected += 1;
    }
  }
  assert.equal(
    rejected,
    corpus.states.length * corpus.events.length - corpus.transitions.length,
  );
});

test('target, restore, domain, version, claim, and fence mismatches fail closed', () => {
  for (const vector of corpus.guardVectors) {
    const before = stateFor(vector.state);
    assert.throws(
      () => applyTransition(
        before,
        vector.event,
        guardFor(before, vector.override),
      ),
      { code: vector.code },
      vector.name,
    );
  }
});

test('success proven after cancellation request wins and releases the slot', () => {
  const claimed = stateFor('claimed');
  const cancelRequested = applyTransition(
    claimed,
    'requestCancel',
    guardFor(claimed),
  ).next;
  assert.equal(cancelRequested.state, 'cancelRequested');
  assert.equal(cancelRequested.slotOwner, 'claim-2');

  const succeeded = applyTransition(
    cancelRequested,
    'terminalSucceeded',
    guardFor(cancelRequested),
  ).next;
  assert.equal(succeeded.state, 'succeeded');
  assert.equal(succeeded.stateVersion, 9);
  assert.equal(succeeded.slotOwner, null);
});

test('reclaim supersedes atomically and the predecessor fence cannot publish', () => {
  const claimed = stateFor('claimed');
  const successor = applyTransition(
    claimed,
    'reclaim',
    guardFor(claimed),
    { nextClaimId: 'claim-3' },
  ).next;
  assert.equal(successor.state, 'claimed');
  assert.equal(successor.attempt, 3);
  assert.equal(successor.fence, 3);
  assert.equal(successor.slotOwner, 'claim-3');
  assert.throws(
    () => applyTransition(
      successor,
      'terminalSucceeded',
      guardFor(claimed),
    ),
    { code: 'SNAPBACK_JOB_CAS_STALE' },
  );
});

test('terminal states never reopen', () => {
  for (const terminal of corpus.terminalStates) {
    for (const event of corpus.events) {
      const before = stateFor(terminal);
      assert.throws(
        () => applyTransition(before, event, guardFor(before)),
        { code: 'SNAPBACK_JOB_TRANSITION_INVALID' },
      );
    }
  }
});
