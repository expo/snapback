import assert from 'node:assert/strict';

import { EphemeralOverlay, SnapbackClient } from './index.mjs';

const admitted = Object.freeze({
  reference: Object.freeze({
    artifactKind: 'ephemeralCollectionReference',
    name: 'presence',
    scopeContract: Object.freeze({
      kind: 'object',
      fields: Object.freeze([
        Object.freeze({ name: 'roomId', required: true, value: Object.freeze({ kind: 'string' }) }),
      ]),
      allowExtra: false,
    }),
    valueContract: Object.freeze({ kind: 'json' }),
  }),
  definition: Object.freeze({ name: 'presence' }),
  connectionId: 'room-test',
});

function overlay() {
  let disposed = false;
  let publishes = 0;
  let deletes = 0;
  const listeners = new Set();
  const value = {
    grantedConnectionId: 'granted-room-test',
    terminalDiagnostic: null,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    currentEntries() { return []; },
    msUntilEarliestExpiry() { return Infinity; },
    pruneExpired() {},
    emit(result, diagnostic = null) {
      if (result === 'terminal_error') value.terminalDiagnostic = diagnostic;
      for (const listener of [...listeners]) listener(result, value);
    },
    async publish() { publishes += 1; return { accepted: true }; },
    async delete() { deletes += 1; return { removed: true }; },
    dispose() { disposed = true; listeners.clear(); },
    inspection() { return { disposed, publishes, deletes, listeners: listeners.size }; },
  };
  return value;
}

function fake({ protocol = 1, subscribe = async () => overlay(), alreadyOpen = false } = {}) {
  let unsubscribes = 0;
  let managerListeners = 0;
  // Mirror the real LiveStreamManager contract: onState delivers transitions
  // only — registration never replays the current level. An `alreadyOpen`
  // manager models a socket whose demand another consumer (live queries)
  // already owns: isOpen() is true from the start and no fresh 'open' edge
  // will ever fire (0137 A2 f1).
  let open = alreadyOpen;
  const manager = {
    onState(listener) {
      managerListeners += 1;
      manager.listener = listener;
      if (!alreadyOpen) {
        open = true;
        listener('open');
      }
      return () => {
        managerListeners -= 1;
        manager.listener = null;
      };
    },
    isOpen() { return open; },
    async waitUntilReady() {},
    emit(state) {
      open = state === 'open';
      manager.listener?.(state);
    },
  };
  return {
    liveStreamManager() { return manager; },
    async connectionGrant() { return { id: 'granted-room-test', ephemeralExpiryProtocol: protocol }; },
    subscribeEphemeral: subscribe,
    async unsubscribeEphemeral() { unsubscribes += 1; return { removed: true }; },
    inspection() { return { unsubscribes, managerListeners }; },
    emitManager(state) { manager.emit(state); },
  };
}

const firstFake = fake();
const first = SnapbackClient.prototype.startEphemeralRoom.call(
  firstFake,
  admitted,
  { roomId: 'one' },
);
await first.started();
assert.equal(first.getSnapshot().status, 'ready');
assert.equal(first.grantedConnectionId, 'granted-room-test');
await first.publish({ name: 'Ada' });
await first.delete();
first.dispose();
await first.settled();
assert.equal(firstFake.inspection().unsubscribes, 1);
assert.equal(firstFake.inspection().managerListeners, 0);

const unsupportedFake = fake({ protocol: null });
const unsupported = SnapbackClient.prototype.startEphemeralRoom.call(
  unsupportedFake,
  admitted,
  { roomId: 'one' },
);
await assert.rejects(
  unsupported.started(),
  (error) => error?.code === 'SNAPBACK_EPHEMERAL_EXPIRY_UNSUPPORTED',
);
assert.equal(unsupported.getSnapshot().status, 'unsupported');
unsupported.dispose();
await unsupported.settled();

let resolveLate;
const lateOverlay = overlay();
const lateFake = fake({
  subscribe: () => new Promise((resolve) => { resolveLate = resolve; }),
});
const late = SnapbackClient.prototype.startEphemeralRoom.call(
  lateFake,
  admitted,
  { roomId: 'one' },
);
while (typeof resolveLate !== 'function') {
  await new Promise((resolve) => setImmediate(resolve));
}
late.dispose();
resolveLate(lateOverlay);
await late.settled();
assert.equal(lateOverlay.inspection().disposed, true);
assert.equal(lateFake.inspection().managerListeners, 0);
assert(lateFake.inspection().unsubscribes >= 1);

let resolveSuperseded;
const initialOverlay = overlay();
const supersededOverlay = overlay();
const successorOverlay = overlay();
let subscribeAttempt = 0;
const replacementFake = fake({
  subscribe: async () => {
    subscribeAttempt += 1;
    if (subscribeAttempt === 1) return initialOverlay;
    if (subscribeAttempt === 2) {
      return new Promise((resolve) => { resolveSuperseded = resolve; });
    }
    return successorOverlay;
  },
});
const replacement = SnapbackClient.prototype.startEphemeralRoom.call(
  replacementFake,
  admitted,
  { roomId: 'one' },
);
await replacement.started();
initialOverlay.emit('needs_resync');
while (typeof resolveSuperseded !== 'function') {
  await new Promise((resolve) => setImmediate(resolve));
}
replacementFake.emitManager('lost');
replacementFake.emitManager('open');
while (subscribeAttempt < 3 || replacement.getSnapshot().status !== 'ready') {
  await new Promise((resolve) => setImmediate(resolve));
}
resolveSuperseded(supersededOverlay);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(supersededOverlay.inspection().disposed, true);
assert.equal(successorOverlay.inspection().disposed, false);
assert.equal(
  replacementFake.inspection().unsubscribes,
  0,
  'a superseded subscribe cannot unsubscribe the current generation',
);
replacement.dispose();
await replacement.settled();
assert.equal(replacementFake.inspection().unsubscribes, 1);

// Regression (0137 A2 f1): a provider whose live queries already opened the
// managed socket starts the presence room against an already-open manager.
// No 'open' transition will ever fire, so the room must adopt the proven
// readiness level instead of wedging at connection 'connecting'/status
// 'stale' with remote deltas still arriving.
const preOpenedFake = fake({ alreadyOpen: true });
const preOpened = SnapbackClient.prototype.startEphemeralRoom.call(
  preOpenedFake,
  admitted,
  { roomId: 'one' },
);
await preOpened.started();
assert.equal(preOpened.getSnapshot().connection, 'live');
assert.equal(preOpened.getSnapshot().status, 'ready');
await preOpened.publish({ name: 'Ada' });
// Loss and reconnect on the shared socket still resynchronize the room.
preOpenedFake.emitManager('lost');
assert.equal(preOpened.getSnapshot().status, 'stale');
preOpenedFake.emitManager('open');
while (preOpened.getSnapshot().status !== 'ready') {
  await new Promise((resolve) => setImmediate(resolve));
}
assert.equal(preOpened.getSnapshot().connection, 'live');
preOpened.dispose();
await preOpened.settled();
assert.equal(preOpenedFake.inspection().managerListeners, 0);

const terminalOverlay = overlay();
const terminalFake = fake({ subscribe: async () => terminalOverlay });
const terminal = SnapbackClient.prototype.startEphemeralRoom.call(
  terminalFake,
  admitted,
  { roomId: 'one' },
);
await terminal.started();
let terminalNotifications = 0;
terminal.subscribe(() => { terminalNotifications += 1; });
const terminalDiagnostic = Object.freeze({
  schemaVersion: 'snapback.client-diagnostic.v1',
  code: 'SNAPBACK_AUTH_PERMISSION_DENIED',
  severity: 'error',
  message: 'membership was revoked',
  details: Object.freeze({ reason: 'AuthRevoked' }),
});
terminalOverlay.emit('terminal_error', terminalDiagnostic);
assert.equal(terminalNotifications, 1);
assert.deepEqual(terminal.getSnapshot(), {
  status: 'error',
  entries: [],
  selfKey: null,
  diagnostic: terminalDiagnostic,
  connection: 'live',
  reason: 'auth_revoked',
});
await assert.rejects(
  terminal.publish({ name: 'Ada' }),
  (error) => error?.code === 'SNAPBACK_REACT_PRESENCE_NOT_AUTHORITATIVE',
);
terminal.dispose();
await terminal.settled();

// @ref LLP 0257#offline — an overlay write is best-effort ephemeral intent:
// a transport-dispatch outage is classified and dropped, never queued and
// never exposed as an unhandled rejection. Other refusals remain rejecting.
{
  const events = [];
  const offlineError = () => Object.assign(new TypeError('intentional offline'), {
    fetchDispatchFailed: true,
  });
  const offlineClient = {
    registerEphemeralConsumer() { return () => {}; },
    registerAuthMaterialization() { return () => {}; },
    diagnosticsChannel() { return { emit: (event) => events.push(event) }; },
    async publishEphemeral() { throw offlineError(); },
    async deleteEphemeral() { throw offlineError(); },
  };
  const bestEffort = new EphemeralOverlay(offlineClient, admitted.reference, {
    connectionId: 'offline-room',
    scope: { roomId: 'one' },
  });
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    void bestEffort.publish({ name: 'ignored-result' });
    await new Promise((resolve) => setImmediate(resolve));
    const publish = await bestEffort.publish({ name: 'Ada' });
    const withdrawal = await bestEffort.delete();
    assert.deepEqual(
      { status: publish.status, reason: publish.reason, queued: publish.queued },
      { status: 'dropped', reason: 'offline', queued: false },
    );
    assert.equal(publish.diagnostic.code, 'SNAPBACK_EPHEMERAL_OFFLINE_DROPPED');
    assert.equal(withdrawal.diagnostic.code, 'SNAPBACK_EPHEMERAL_OFFLINE_DROPPED');
    assert.equal(unhandled.length, 0);
    assert.equal(events.length, 3);
    assert(events.every((event) => event.severity === 'warning'));
  } finally {
    process.off('unhandledRejection', onUnhandled);
    bestEffort.dispose();
  }

  const refusedClient = {
    ...offlineClient,
    async publishEphemeral() {
      const error = new Error('permission denied');
      error.code = 'SNAPBACK_AUTH_PERMISSION_DENIED';
      throw error;
    },
  };
  const refused = new EphemeralOverlay(refusedClient, admitted.reference, {
    connectionId: 'refused-room',
    scope: { roomId: 'one' },
  });
  await assert.rejects(
    refused.publish({ name: 'Ada' }),
    (error) => error?.code === 'SNAPBACK_AUTH_PERMISSION_DENIED',
  );
  refused.dispose();
}

console.log('ephemeral-room.test.mjs: negotiation, offline best-effort classification, terminal errors, late cleanup, pre-opened socket readiness, and settlement pass');
