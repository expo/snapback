import assert from 'node:assert/strict';

import { SnapbackClient } from './index.mjs';

const admitted = Object.freeze({
  reference: Object.freeze({
    artifactKind: 'ephemeralCollectionReference',
    name: 'presence',
  }),
  definition: Object.freeze({ name: 'presence' }),
  connectionId: 'room-test',
});

function overlay() {
  let disposed = false;
  let publishes = 0;
  let deletes = 0;
  const listeners = new Set();
  return {
    grantedConnectionId: 'granted-room-test',
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    currentEntries() { return []; },
    msUntilEarliestExpiry() { return Infinity; },
    pruneExpired() {},
    emit(result) {
      for (const listener of [...listeners]) listener(result);
    },
    async publish() { publishes += 1; return { accepted: true }; },
    async delete() { deletes += 1; return { removed: true }; },
    dispose() { disposed = true; listeners.clear(); },
    inspection() { return { disposed, publishes, deletes, listeners: listeners.size }; },
  };
}

function fake({ protocol = 1, subscribe = async () => overlay() } = {}) {
  let unsubscribes = 0;
  let managerListeners = 0;
  const manager = {
    onState(listener) {
      managerListeners += 1;
      manager.listener = listener;
      listener('open');
      return () => {
        managerListeners -= 1;
        manager.listener = null;
      };
    },
    async waitUntilReady() {},
    emit(state) { manager.listener?.(state); },
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

console.log('ephemeral-room.test.mjs: negotiation, immediate handle, late cleanup, and settlement pass');
