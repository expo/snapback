// React-side characterization evidence, not a regression test for the
// LLP 0310.000 Ruling 3 versus implemented LLP 0257 conflict ticket. It
// characterizes the React module graph and its bare-provider deadline behavior;
// the RFC owner still owns the facade-boundary decision.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  SnapbackProvider,
  useSnapbackActivityPresence,
} from './index.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let publishCalls = 0;
let deleteCalls = 0;
const entrySource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

const localModuleSpecifiers = (source) => [
  ...source.matchAll(/\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gu),
  ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu),
].map((match) => match[1]).filter((specifier) => specifier.startsWith('.'));

const implementationModules = new Map();
function walkLocalImplementationImports(moduleUrl) {
  const path = fileURLToPath(moduleUrl);
  if (implementationModules.has(path)) return;
  const source = readFileSync(moduleUrl, 'utf8');
  implementationModules.set(path, source);
  for (const specifier of localModuleSpecifiers(source)) {
    walkLocalImplementationImports(new URL(specifier, moduleUrl));
  }
}
walkLocalImplementationImports(new URL('./implementation.mjs', import.meta.url));

assert.match(
  entrySource,
  /useSnapbackActivityPresence,[\s\S]*?from '\.\/implementation\.mjs';/u,
  'the React entry must source useSnapbackActivityPresence from implementation.mjs',
);
for (const [path, source] of [
  [fileURLToPath(new URL('./index.mjs', import.meta.url)), entrySource],
  ...implementationModules,
]) {
  assert.doesNotMatch(
    source,
    /(?:from\s+|import\s*\()\s*['"]react-native(?:\/[^'"]*)?['"]/u,
    `${path} must not import React Native lifecycle state`,
  );
  assert.doesNotMatch(source, /\bAppState\b/u, `${path} must not reference AppState`);
  assert.doesNotMatch(
    source,
    /\.addEventListener\(\s*['"]change['"]/u,
    `${path} must not attach a platform lifecycle change listener`,
  );
}
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
  // React has no platform listener; Expo wrapping is a separate package.
  activity = useSnapbackActivityPresence(typing, {
    scope: { roomId: 'room-one' },
    value: () => ({ name: 'Ada' }),
    idleMs: 250,
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
const touchedAt = Date.now();
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const originalTouchNow = Date.now;
let idleTimer = null;
globalThis.setTimeout = (callback, delay) => {
  idleTimer = { callback, delay, cleared: false, unref() {} };
  return idleTimer;
};
globalThis.clearTimeout = (timer) => { timer.cleared = true; };
Date.now = () => touchedAt;
try {
  act(() => activity.touch());
} finally {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  Date.now = originalTouchNow;
}
await act(async () => { await flush(); });
assert.equal(activity.active, true);
assert.equal(publishCalls, 1, 'the React hook publishes under a bare SnapbackProvider');
assert.equal(idleTimer?.delay, 250, 'touch arms only the activity deadline');
assert.equal(deleteCalls, 0, 'touch does not withdraw before the activity deadline');
assert.equal(idleTimer.cleared, false, 'touch leaves deadline-only expiry armed');

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

await act(async () => {
  renderer.unmount();
});

console.log('activity-presence-react-characterization.test.mjs: React local module graph has no platform lifecycle listener; bare-provider touch publishes and expires only at its deadline');
