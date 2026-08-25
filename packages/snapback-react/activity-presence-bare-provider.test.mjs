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
    idleMs: 60_000,
  });
  return null;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
let renderer;
await act(async () => {
  renderer = TestRenderer.create(React.createElement(
    SnapbackProvider,
    { provider },
    React.createElement(Probe),
  ));
  await flush();
});

assert.equal(activity.active, false);
act(() => activity.touch());
await act(async () => { await flush(); });
assert.equal(activity.active, true);
assert.equal(publishCalls, 1, 'the React hook publishes under a bare SnapbackProvider');

await act(async () => {
  await activity.withdraw();
  await flush();
});
assert.equal(activity.active, false);
assert.equal(deleteCalls, 1, 'the React hook withdraws under a bare SnapbackProvider');
await act(async () => { renderer.unmount(); });

console.log('activity-presence-bare-provider.test.mjs: React hook works under bare SnapbackProvider');
