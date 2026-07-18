import assert from 'node:assert/strict';

import {
  closeAcceptanceSession,
  OwnedLiveSubscriptions,
  TerminalAcceptanceWatchdog,
} from './owned-live-subscriptions.mjs';

let resolveDeferred;
const deferred = new Promise((resolve) => { resolveDeferred = resolve; });
const events = [];
const owned = new OwnedLiveSubscriptions();

const shortFailure = owned.start({
  label: 'short failure',
  settlementDeadlineMs: 1_000,
  create: async () => { throw new Error('short failure'); },
  dispose: async () => assert.fail('a failed creation has nothing to dispose'),
});
const deferredSuccess = owned.start({
  label: 'deferred success',
  settlementDeadlineMs: 1,
  create: () => deferred,
  dispose: async ({ subscriptionId }) => {
    events.push(`disposed:${subscriptionId}`);
  },
});

const teardown = owned.closeAndDispose({ strict: true }).then(() => {
  events.push('teardown-complete');
});
await Promise.resolve();
assert.deepEqual(events, [], 'teardown must wait for every started creation');
await new Promise((resolve) => setTimeout(resolve, 10));
resolveDeferred({ subscriptionId: 'late-success' });

const outcomes = await Promise.allSettled([shortFailure, deferredSuccess]);
assert.equal(outcomes[0].status, 'rejected');
assert.equal(outcomes[1].status, 'rejected');
assert.equal(outcomes[1].reason.code, 'SNAPBACK_RBAC_ACCEPTANCE_TIMEOUT');
await teardown;
events.push('auth-close');
assert.deepEqual(events, [
  'disposed:late-success',
  'teardown-complete',
  'auth-close',
]);
assert.equal(owned.size, 0);

// A raw subscribe can succeed before fallible scope validation or an initial
// invalidation ACK. Immediate adoption keeps that handle owned even when the
// rest of creation rejects.
const postSubscribeFailure = new Error('post-subscribe initialization failed');
const adoptedAfterSubscribe = new OwnedLiveSubscriptions();
let adoptedDisposals = 0;
const adoptedTask = adoptedAfterSubscribe.start({
  label: 'adopt before initialization',
  settlementDeadlineMs: 1_000,
  create: async (adopt) => {
    const live = { subscriptionId: 'raw-success' };
    adopt(live);
    throw postSubscribeFailure;
  },
  dispose: async ({ subscriptionId }) => {
    assert.equal(subscriptionId, 'raw-success');
    adoptedDisposals += 1;
  },
});
await assert.rejects(adoptedTask, (error) => error === postSubscribeFailure);
assert.equal(adoptedAfterSubscribe.size, 1);
await adoptedAfterSubscribe.closeAndDispose({ strict: true });
assert.equal(adoptedDisposals, 1);
assert.equal(adoptedAfterSubscribe.size, 0);

// A settlement deadline does not pretend that Promise.race cancelled work.
// The outer process watchdog cancels the transport (the rejection below), and
// teardown still joins that exact task before completing.
let rejectHung;
const hungTransport = new Promise((_, reject) => { rejectHung = reject; });
const hungOwned = new OwnedLiveSubscriptions();
const hungTask = hungOwned.start({
  label: 'hung transport',
  settlementDeadlineMs: 1,
  create: () => hungTransport,
  dispose: async () => assert.fail('a cancelled creation has nothing to dispose'),
});
let hungTeardownComplete = false;
const hungTeardown = hungOwned.closeAndDispose({ strict: true }).then(() => {
  hungTeardownComplete = true;
});
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(hungTeardownComplete, false);
rejectHung(new Error('outer watchdog stopped the server'));
await assert.rejects(
  hungTask,
  (error) => (
    error?.code === 'SNAPBACK_RBAC_ACCEPTANCE_TIMEOUT'
    && error?.cause?.message === 'outer watchdog stopped the server'
  ),
);
await hungTeardown;
assert.equal(hungTeardownComplete, true);

// Closing linearizes before its first await. A dispose that is itself pending
// cannot admit a late successful start behind the cleanup snapshot.
let releaseRacingDispose;
let signalRacingDispose;
const racingDispose = new Promise((resolve) => { releaseRacingDispose = resolve; });
const racingDisposeStarted = new Promise((resolve) => { signalRacingDispose = resolve; });
const racing = new OwnedLiveSubscriptions();
await racing.start({
  label: 'racing subscription',
  settlementDeadlineMs: 1_000,
  create: async () => ({ subscriptionId: 'racing' }),
  dispose: async () => {
    signalRacingDispose();
    await racingDispose;
  },
});
const racingClose = racing.disposeAll({ strict: true });
await racingDisposeStarted;
assert.throws(
  () => racing.start({
    label: 'late subscription',
    settlementDeadlineMs: 1_000,
    create: async () => ({ subscriptionId: 'late' }),
    dispose: async () => {},
  }),
  /creation is closed/u,
);
releaseRacingDispose();
await racingClose;
assert.equal(racing.size, 0);

// Concurrent close calls share one disposal pass, including while disposal is
// pending. The handle is invoked exactly once.
let releaseSingleDispose;
let signalSingleDispose;
const singleDisposeRelease = new Promise((resolve) => { releaseSingleDispose = resolve; });
const singleDisposeStarted = new Promise((resolve) => { signalSingleDispose = resolve; });
const concurrent = new OwnedLiveSubscriptions();
let disposeCount = 0;
await concurrent.start({
  label: 'single-flight subscription',
  settlementDeadlineMs: 1_000,
  create: async () => ({ subscriptionId: 'single-flight' }),
  dispose: async () => {
    disposeCount += 1;
    signalSingleDispose();
    await singleDisposeRelease;
  },
});
const closeA = concurrent.closeAndDispose({ strict: true });
const closeB = concurrent.closeAndDispose({ strict: true });
await singleDisposeStarted;
assert.equal(disposeCount, 1);
releaseSingleDispose();
await Promise.all([closeA, closeB]);
assert.equal(disposeCount, 1);
await concurrent.closeAndDispose({ strict: true });
assert.equal(disposeCount, 1, 'a later idempotent close does not retry disposal');

const disposalFailure = new Error('owned unsubscribe failed');
const failing = new OwnedLiveSubscriptions();
let failingDisposeCount = 0;
await failing.start({
  label: 'failing subscription',
  settlementDeadlineMs: 1_000,
  create: async () => ({ subscriptionId: 'failing' }),
  dispose: async () => {
    failingDisposeCount += 1;
    throw disposalFailure;
  },
});
const failingOutcomes = await Promise.allSettled([
  failing.closeAndDispose({ strict: true }),
  failing.closeAndDispose({ strict: true }),
  failing.closeAndDispose({ strict: false }),
]);
assert.deepEqual(failingOutcomes.map(({ status }) => status), [
  'rejected',
  'rejected',
  'fulfilled',
]);
assert.equal(failingOutcomes[0].reason, disposalFailure);
assert.equal(failingOutcomes[1].reason, disposalFailure);
assert.equal(failingDisposeCount, 1, 'failed disposal is not repeated by concurrent close');
assert.equal(failing.size, 1, 'failed terminal disposal remains visible as owned residue');

// Session cleanup attempts both independently owned resources, latches its
// result for every caller, and never converts teardown failure into success.
const clientCloseFailure = new Error('client close failed');
const coordinatorCloseFailure = new Error('coordinator close failed');
let clientCloseCount = 0;
let coordinatorCloseCount = 0;
const failingSession = {
  closePromise: null,
  client: {
    async closeAuth() {
      clientCloseCount += 1;
      throw clientCloseFailure;
    },
  },
  coordinator: {
    async close() {
      coordinatorCloseCount += 1;
      throw coordinatorCloseFailure;
    },
  },
};
const sessionCloseA = closeAcceptanceSession(failingSession);
const sessionCloseB = closeAcceptanceSession(failingSession);
assert.equal(sessionCloseB, sessionCloseA, 'session close remains single-flight');
await assert.rejects(
  sessionCloseA,
  (error) => (
    error instanceof AggregateError
    && error.errors[0] === clientCloseFailure
    && error.errors[1] === coordinatorCloseFailure
  ),
);
assert.equal(clientCloseCount, 1);
assert.equal(coordinatorCloseCount, 1, 'coordinator close still runs after client close fails');
await assert.rejects(
  closeAcceptanceSession(failingSession),
  (error) => error instanceof AggregateError,
  'later cleanup callers observe the latched teardown failure',
);

// The terminal boundary invokes abort once, keeps its terminal backstop live
// while abort work is joined, and cancels that backstop only after close.
const scheduled = [];
const cleared = new Set();
const fakeClock = {
  setTimeout(callback, milliseconds) {
    const timer = { callback, milliseconds };
    scheduled.push(timer);
    return timer;
  },
  clearTimeout(timer) {
    cleared.add(timer);
  },
};
let releaseAbort;
const abortPending = new Promise((resolve) => { releaseAbort = resolve; });
let abortCount = 0;
let terminalCount = 0;
const watchdog = new TerminalAcceptanceWatchdog({
  deadlineMs: 100,
  terminalGraceMs: 25,
  clock: fakeClock,
  onDeadline(error) {
    abortCount += 1;
    assert.equal(error.code, 'SNAPBACK_RBAC_ACCEPTANCE_WATCHDOG');
    return abortPending;
  },
  onTerminal(error) {
    terminalCount += 1;
    assert.equal(error.code, 'SNAPBACK_RBAC_ACCEPTANCE_WATCHDOG');
  },
});
assert.deepEqual(scheduled.map(({ milliseconds }) => milliseconds), [100]);
scheduled[0].callback();
assert.equal(watchdog.expired, true);
assert.equal(abortCount, 1);
assert.deepEqual(scheduled.map(({ milliseconds }) => milliseconds), [100, 25]);
scheduled[1].callback();
assert.equal(terminalCount, 1, 'a hung abort path reaches the terminal backstop');
const watchdogClose = watchdog.close();
let watchdogSettled = false;
void watchdogClose.then(
  () => { watchdogSettled = true; },
  () => { watchdogSettled = true; },
);
await Promise.resolve();
assert.equal(watchdogSettled, false, 'close joins actual abort work');
releaseAbort();
await assert.rejects(
  watchdogClose,
  (error) => error?.code === 'SNAPBACK_RBAC_ACCEPTANCE_WATCHDOG',
  'joined teardown cannot erase a terminal deadline failure',
);
assert.equal(watchdog.expired, true, 'deadline expiry remains latched after close');
assert(cleared.has(scheduled[1]));

// Even when deadline-triggered teardown resolves immediately, close retains
// and reports the watchdog failure instead of converting the run to success.
const gracefulScheduled = [];
const gracefulClock = {
  setTimeout(callback, milliseconds) {
    const timer = { callback, milliseconds };
    gracefulScheduled.push(timer);
    return timer;
  },
  clearTimeout() {},
};
const gracefulWatchdog = new TerminalAcceptanceWatchdog({
  deadlineMs: 100,
  terminalGraceMs: 25,
  clock: gracefulClock,
  onDeadline: async () => {},
  onTerminal: () => assert.fail('settled teardown must cancel the terminal backstop'),
});
gracefulScheduled[0].callback();
await Promise.resolve();
const gracefulClose = gracefulWatchdog.close();
assert.equal(gracefulWatchdog.close(), gracefulClose, 'close remains single-flight');
await assert.rejects(
  gracefulClose,
  (error) => error?.code === 'SNAPBACK_RBAC_ACCEPTANCE_WATCHDOG',
  'a resolved deadline cleanup still fails acceptance',
);
assert.equal(gracefulWatchdog.expired, true);

// A graceful teardown that has already rejected still leaves a live terminal
// backstop. The caller can trigger it with the exact cleanup failure instead
// of disarming the only process bound in a normal finally block.
const failedScheduled = [];
const failedClock = {
  setTimeout(callback, milliseconds) {
    const timer = { callback, milliseconds };
    failedScheduled.push(timer);
    return timer;
  },
  clearTimeout() {},
};
const stopFailure = new Error('server process tree cleanup failed');
let failedTerminalError = null;
const failedWatchdog = new TerminalAcceptanceWatchdog({
  deadlineMs: 100,
  terminalGraceMs: 25,
  clock: failedClock,
  onDeadline: async () => { throw stopFailure; },
  onTerminal(error) { failedTerminalError = error; },
});
assert.equal(failedWatchdog.trigger(stopFailure), true);
await Promise.resolve();
assert.deepEqual(failedScheduled.map(({ milliseconds }) => milliseconds), [100, 25]);
failedScheduled[1].callback();
assert.equal(failedTerminalError, stopFailure);
await assert.rejects(failedWatchdog.close(), (error) => error === stopFailure);

console.log('PASS RBAC owned live subscriptions — linearized close and terminal teardown');
