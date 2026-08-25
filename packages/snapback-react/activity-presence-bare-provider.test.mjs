import assert from 'node:assert/strict';

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  SnapbackProvider,
  useSnapbackActivityPresence,
} from './index.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let publishCalls = 0;
let deleteCalls = 0;
let observedAppState = 'active';
const appStateListeners = new Set();
const appState = Object.freeze({
  addEventListener(type, listener) {
    assert.equal(type, 'change');
    appStateListeners.add(listener);
    return Object.freeze({ remove: () => appStateListeners.delete(listener) });
  },
  transition(nextState) {
    for (const listener of appStateListeners) listener(nextState);
  },
});
const presenceSnapshot = Object.freeze({
  status: 'ready',
  entries: Object.freeze([]),
  selfKey: null,
  diagnostic: null,
  connection: 'live',
  publisher: Object.freeze({ status: 'observing', diagnostic: null }),
  publish: async () => { publishCalls += 1; },
  delete: async () => { deleteCalls += 1; },
});
const registry = Object.freeze({
  createPresenceToken: () => Object.freeze({}),
  presenceDescriptor: () => Object.freeze({ key: 'bare-provider-presence' }),
  subscribePresence: () => Object.freeze({ release() {} }),
  presenceSnapshot: () => presenceSnapshot,
});
const provider = Object.freeze({
  kind: 'snapback.react-provider.v1',
  binding: Object.freeze({}),
  registry,
  start() {},
});
const stringContract = Object.freeze({ kind: 'string', maxBytes: 32 });
const typing = Object.freeze({
  name: 'typing',
  scopeContract: Object.freeze({
    kind: 'object',
    fields: Object.freeze([
      Object.freeze({ name: 'roomId', required: true, value: stringContract }),
    ]),
    allowExtra: false,
  }),
  valueContract: Object.freeze({
    kind: 'object',
    fields: Object.freeze([
      Object.freeze({ name: 'name', required: true, value: stringContract }),
    ]),
    allowExtra: false,
  }),
});

let activity = null;
function Probe() {
  // @ref LLP 0257#design — the React hook is the supported activity-presence
  // contract for a bare SnapbackProvider; Expo lifecycle wrapping is separate.
  activity = useSnapbackActivityPresence(typing, {
    scope: { roomId: 'room-one' },
    value: () => ({ name: 'Ada' }),
    idleMs: 250,
  });
  return null;
}

function HostAppStateProbe() {
  React.useEffect(() => {
    const subscription = appState.addEventListener('change', (nextState) => {
      observedAppState = nextState;
    });
    return () => subscription.remove();
  }, []);
  return null;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
let renderer;
await act(async () => {
  renderer = TestRenderer.create(React.createElement(
    SnapbackProvider,
    { provider },
    React.createElement(React.Fragment, null,
      React.createElement(Probe),
      React.createElement(HostAppStateProbe),
    ),
  ));
  await flush();
});

assert.equal(activity.active, false);
const touchedAt = Date.now();
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
let idleTimer = null;
globalThis.setTimeout = (callback, delay) => {
  idleTimer = { callback, delay, cleared: false, unref() {} };
  return idleTimer;
};
globalThis.clearTimeout = (timer) => { timer.cleared = true; };
try {
  act(() => activity.touch());
} finally {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}
await act(async () => { await flush(); });
assert.equal(activity.active, true);
assert.equal(publishCalls, 1, 'the React hook publishes under a bare SnapbackProvider');
assert.equal(idleTimer?.delay, 250, 'touch arms only the activity deadline');

await act(async () => {
  appState.transition('background');
  await flush();
});
assert.equal(observedAppState, 'background', 'the host tree observed the AppState transition');
assert.equal(activity.active, true, 'background does not disarm the bare-provider React hook');
assert.equal(deleteCalls, 0, 'background does not withdraw the bare-provider React hook');
assert.equal(idleTimer.cleared, false, 'background leaves deadline-only expiry armed');

const originalNow = Date.now;
Date.now = () => touchedAt + 1_000;
try {
  await act(async () => {
    idleTimer.callback();
    await flush();
  });
} finally {
  Date.now = originalNow;
}
assert.equal(activity.active, false, 'the activity deadline disarms the React hook');
assert.equal(deleteCalls, 1, 'the activity deadline withdraws the React hook');

assert.equal(appStateListeners.size, 1, 'only the host probe observes AppState');
await act(async () => {
  renderer.unmount();
});
assert.equal(appStateListeners.size, 0, 'host AppState observation cleans up on unmount');

console.log('activity-presence-bare-provider.test.mjs: bare-provider React hook publishes and uses deadline-only background expiry');
