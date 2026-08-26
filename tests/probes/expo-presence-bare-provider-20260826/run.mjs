// LLP 0310 P20 / LLP 0310.000 D2 — does `@expo/snapback-expo`'s
// `useSnapbackActivityPresence` work under a bare URL-first `SnapbackProvider`
// on web, with no `SnapbackExpoProvider` and no
// `SnapbackExpoLifecycleContextProvider` anywhere in the tree?
//
// The 0.1.27 Clique familiar lane concluded from reading `index.d.mts` that the
// facade *requires* `SnapbackExpoLifecycleContext`, and switched packages. It
// never observed a refusal. This probe observes the real chain:
//
//   useSnapbackActivityPresence (packages/snapback-expo/activity-presence.mjs)
//     -> useSnapbackExpoLifecycleContext() === null
//     -> resolveSnapbackExpoLifecycleSource(null)   (lifecycle-source.mjs)
//     -> import('#app-state') under the `browser` condition
//     -> resolveDefaultAppState()                   (app-state.web.mjs)
//     -> react-native-web AppState
//
// Every Snapback module above is the shipped source. The one substitution is
// `react-native-web/dist/exports/AppState/index.js`, which is not a workspace
// dependency; it is stubbed with an AppState-shaped object (see
// rnw-appstate-stub.mjs). `admitSource` accepts any object with
// `addEventListener`, so the stub is faithful to the predicate under test. The
// residual question the stub cannot answer — whether the real react-native-web
// module resolves under Metro's web bundling — is recorded as a limit below.
//
// Run: node --conditions=browser --import ./register.mjs run.mjs
// (or `node tests/probes/expo-presence-bare-provider-20260826/probe.test.mjs`,
// which spawns that command and asserts the recorded outcome).
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { prepareReactBindingForClient } from '../../../packages/snapback-client/react-binding.mjs';
// Bare `@expo/...` specifiers do not resolve from this directory: bun links the
// workspace packages under `packages/snapback-expo/node_modules`, not the repo
// root. These paths are the exact files each package's `exports` map names, and
// `#app-state` still resolves through `packages/snapback-expo/package.json`'s
// `imports` map, which is what this probe is testing.
import {
  SnapbackProvider,
  createSnapbackReactProvider,
} from '../../../packages/snapback-react/index.mjs';

// The public package entry, exactly as an app would import it.
import { useSnapbackActivityPresence } from '../../../packages/snapback-expo/index.mjs';

const probeRoot = dirname(fileURLToPath(import.meta.url));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => new Promise((resolve) => setImmediate(resolve));
const valueContract = Object.freeze({
  kind: 'object',
  fields: Object.freeze([
    Object.freeze({ name: 'userHandle', required: true, value: { kind: 'string', maxBytes: 32 } }),
    Object.freeze({ name: 'name', required: true, value: { kind: 'string', maxBytes: 32 } }),
  ]),
  allowExtra: false,
});
const scopeContract = Object.freeze({
  kind: 'object',
  fields: Object.freeze([
    Object.freeze({ name: 'roomId', required: true, value: { kind: 'string', maxBytes: 32 } }),
  ]),
  allowExtra: false,
});
const collection = Object.freeze({
  name: 'typing',
  scopeFields: ['roomId'],
  scopeContract,
  valueContract,
  keyMode: 'Connection',
  routingFields: ['roomId'],
  defaultTtlMs: 6_000,
  maxTtlMs: 10_000,
  withdrawalVisibilityDeadlineMs: 500,
  maxValueBytes: 256,
  hardMaxValueBytes: 4_096,
  sustainedHz: 4,
  burst: 8,
  dispatchMs: 33,
  publish: 'AllowAll',
  subscribe: 'AllowAll',
  maxPendingEphemeralKeys: 1_024,
});
const schema = Object.freeze({
  artifactKind: 'schemaManifest',
  schemaVersion: 'snapback.v0',
  appId: 'expo-activity-presence-fixture',
  schemaHash: 'sha256:expo-activity-presence-schema',
  ephemeralCollections: [collection],
  tables: [],
});
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'expo-activity-presence-fixture',
  bundleHash: 'sha256:expo-activity-presence-functions',
  functions: [],
});
const capabilityManifest = Object.freeze({
  artifactKind: 'capabilityManifest',
  schemaVersion: 'snapback.v0',
  targetProfileId: 'local-dev-sqlite-ibex',
  supportedCapabilities: ['live_subscriptions'],
});

function fakeClient() {
  const authorityCapture = Object.freeze({ revision: 1 });
  let publishAttempts = 0;
  let deletes = 0;
  const published = [];
  return {
    liveQuery() {},
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema,
        functions,
        capabilityManifest,
      };
    },
    async authSession() { return { activeMode: 'dev' }; },
    registerAuthBarrierParticipant() { return async () => {}; },
    captureAuthority: () => authorityCapture,
    authorityCaptureFor: () => authorityCapture,
    isAuthorityCaptureCurrent: (capture) => capture === authorityCapture,
    liveStreamManager() { return { async settled() {} }; },
    registerEphemeralRepublisher() { return Object.freeze({ dispose() {} }); },
    startEphemeralRoom() {
      const listeners = new Set();
      let disposed = false;
      let selfEntry = null;
      let peerEntries = [];
      let snapshot = Object.freeze({
        status: 'pending',
        entries: Object.freeze([]),
        selfKey: null,
        diagnostic: null,
        connection: 'connecting',
        reason: null,
      });
      const notify = () => {
        snapshot = Object.freeze({
          ...snapshot,
          entries: Object.freeze([
            ...(selfEntry === null ? [] : [selfEntry]),
            ...peerEntries,
          ]),
        });
        for (const listener of [...listeners]) listener();
      };
      let settleStarted;
      const started = new Promise((resolve) => { settleStarted = resolve; });
      queueMicrotask(() => {
        if (disposed) return;
        snapshot = Object.freeze({
          ...snapshot,
          status: 'ready',
          selfKey: 'expo-self',
          connection: 'live',
        });
        notify();
        settleStarted();
      });
      return Object.freeze({
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        getSnapshot: () => snapshot,
        getServerSnapshot: () => snapshot,
        get grantedConnectionId() { return snapshot.selfKey; },
        started: () => started,
        async publish(value, { ttlMs }) {
          publishAttempts += 1;
          const retained = Object.freeze({ ...value });
          published.push(retained);
          selfEntry = Object.freeze({
            key: 'expo-self',
            value: retained,
            expiresAtMs: Date.now() + ttlMs,
            receivedAtMs: Date.now(),
            scopeEpoch: 1,
            entryVersion: publishAttempts,
          });
          notify();
          return { accepted: true, scope_epoch: 1, entry_version: publishAttempts };
        },
        async delete() {
          deletes += 1;
          selfEntry = null;
          notify();
          return { status: 'deleted' };
        },
        setPeers(entries) {
          peerEntries = entries;
          notify();
        },
        dispose() {
          disposed = true;
          listeners.clear();
          settleStarted();
        },
        async settled() {},
      });
    },
    inspection: () => ({ publishAttempts, deletes, published: [...published] }),
  };
}


// The bare URL-first tree: SnapbackProvider only. No SnapbackExpoProvider, no
// SnapbackExpoLifecycleContextProvider, no injected environment.
const client = fakeClient();
const binding = await prepareReactBindingForClient(client, {
  generatedManifest: { functions, schema, capabilityManifest },
});
const provider = createSnapbackReactProvider(binding, {
  connectionId: 'expo-presence-bare-provider-probe',
});
let current = null;
const diagnostics = [];
function Probe() {
  current = useSnapbackActivityPresence(binding.ephemeral.typing, {
    scope: { roomId: 'room-one' },
    value: () => ({ userHandle: 'probe', name: 'Probe' }),
    idleMs: 60_000,
    onError(diagnostic) { diagnostics.push(diagnostic); },
  });
  return null;
}
let renderer;
await act(async () => {
  renderer = TestRenderer.create(React.createElement(
    SnapbackProvider,
    { provider },
    React.createElement(Probe),
  ));
  await flush();
});
// Let the facade's lifecycle establish() effect settle.
for (let turn = 0; turn < 20; turn += 1) {
  await act(async () => { await flush(); });
}

const lifecycleDiagnostic = diagnostics.find((diagnostic) => (
  diagnostic?.code === 'SNAPBACK_EXPO_ACTIVITY_LIFECYCLE_UNAVAILABLE'
));
let touchOutcome = null;
if (lifecycleDiagnostic === undefined) {
  await act(async () => {
    current.touch();
    await flush();
  });
  for (let turn = 0; turn < 20; turn += 1) {
    await act(async () => { await flush(); });
  }
  touchOutcome = {
    active: current.active,
    publishAttempts: client.inspection().publishAttempts,
    published: client.inspection().published,
  };
}

const observation = {
  schemaVersion: 'snapback.probe.expo-presence-bare-provider.v1',
  llp: ['0310 P20', '0310.000 D2'],
  tree: 'SnapbackProvider only — no SnapbackExpoProvider, no SnapbackExpoLifecycleContextProvider',
  condition: 'browser',
  outcome: lifecycleDiagnostic === undefined ? 'works' : 'fails-with-code',
  diagnosticCode: lifecycleDiagnostic?.code ?? null,
  diagnosticDetails: lifecycleDiagnostic?.details ?? null,
  gatedAdmissionOpened: touchOutcome !== null && touchOutcome.active === true,
  touch: touchOutcome,
  diagnostics,
  limits: [
    'react-native-web/dist/exports/AppState/index.js is stubbed; it is not a workspace dependency.',
    'Node with --conditions=browser stands in for Metro web bundling of the package `imports` map.',
  ],
};
writeFileSync(join(probeRoot, 'observation.json'), `${JSON.stringify(observation, null, 2)}\n`);
console.log(JSON.stringify(observation, null, 2));

await act(async () => {
  renderer.unmount();
  await flush();
});
await provider.dispose();
assert.ok(true);
