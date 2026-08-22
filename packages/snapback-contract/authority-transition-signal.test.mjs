import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AuthCoordinator, createMemoryAuthCustodyStorage } from './auth-coordinator.mjs';

const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const anonymous = () => ({
  kind: 'anonymous',
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
});
const session = (sessionId = '018f0d90-7b12-7a22-8c33-445566778899') => ({
  kind: 'session',
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
  sessionId,
  userId: '018f0d90-7b14-7a22-8c33-445566778899',
});

test('provider readiness is level-triggered through phase-9 authority settlement', async () => {
  const coordinator = new AuthCoordinator({
    appId: 'snapback.test/authority-transition-signal',
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const observed = [];
  const unsubscribe = coordinator.subscribeAuthorityTransition((status) => observed.push(status));
  const anonymousCapture = await coordinator.establishAnonymous(anonymous());
  assert.equal(coordinator.authorityTransitionStatus().settled, true);

  let releaseCommit;
  let enteredCommit;
  const commitEntered = new Promise((resolve) => { enteredCommit = resolve; });
  const commitHeld = new Promise((resolve) => { releaseCommit = resolve; });
  const unregister = coordinator.registerParticipant({
    name: 'authority-transition-signal-gate',
    async commitDurable() {
      enteredCommit();
      await commitHeld;
    },
  });
  const transitioning = coordinator.transition(anonymousCapture, {
    authority: session(),
    bearer: 'sbs_authority_transition_signal',
    refreshAfterMs: Date.now() + 60_000,
  });
  await commitEntered;
  const active = coordinator.authorityTransitionStatus();
  assert.equal(active.state, 'authenticating');
  assert.equal(active.settled, false);
  assert.equal(active.subscribeSafe, false);
  assert.equal(active.transitionOwner, 'auth-coordinator');
  // One held transition is enough to exercise the missed-wakeup boundary at
  // scale: every waiter must join the same phase-9 settlement and observe the
  // successor as safe for ephemeral authority before returning.
  const settledWaiters = Array.from(
    { length: 200 },
    () => coordinator.whenAuthoritySettled(),
  );
  releaseCommit();
  await transitioning;
  const settledStatuses = await Promise.all(settledWaiters);
  assert.equal(settledStatuses.length, 200);
  for (const settled of settledStatuses) {
    assert.equal(settled.state, 'authenticated');
    assert.equal(settled.subscribeSafe, true);
    assert.equal(settled.ephemeralAuthorityUsable, true);
  }
  assert.equal(observed.some((status) => status.barrierPhase === 'resume'), true);
  await unregister();
  unsubscribe();
  await coordinator.close();
});

test('same-user new-session readiness revokes the predecessor then re-admits authenticated surfaces', async () => {
  const coordinator = new AuthCoordinator({
    appId: 'snapback.test/authority-transition-same-user',
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const anonymousCapture = await coordinator.establishAnonymous(anonymous());
  const sessionCapture = await coordinator.transition(anonymousCapture, {
    authority: session(),
    bearer: 'sbs_authority_transition_same_user_first',
    refreshAfterMs: Date.now() + 60_000,
  });

  let releaseCommit;
  let enteredCommit;
  const commitEntered = new Promise((resolve) => { enteredCommit = resolve; });
  const commitHeld = new Promise((resolve) => { releaseCommit = resolve; });
  const unregister = coordinator.registerParticipant({
    name: 'authority-transition-same-user-gate',
    async commitDurable() {
      enteredCommit();
      await commitHeld;
    },
  });
  const nextSession = coordinator.transition(sessionCapture, {
    authority: session('018f0d90-7b13-7a22-8c33-445566778899'),
    bearer: 'sbs_authority_transition_same_user_second',
    refreshAfterMs: Date.now() + 60_000,
  });
  await commitEntered;
  assert.equal(coordinator.authorityTransitionStatus().state, 'revoking');
  assert.equal(coordinator.authorityTransitionStatus().subscribeSafe, false);
  releaseCommit();
  await nextSession;
  const settled = coordinator.authorityTransitionStatus();
  assert.equal(settled.state, 'authenticated');
  assert.equal(settled.subscribeSafe, true);
  assert.equal(coordinator.settledView().authority.userId, session().userId);
  await unregister();
  await coordinator.close();
});
