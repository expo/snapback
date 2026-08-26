import assert from 'node:assert/strict';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';

const generatedManifest = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'binding-sync-fixture',
  bundleHash: 'sha256:generated-successor',
  functions: Object.freeze([]),
});

function inspection(bundleHash, {
  targetProfileId = 'local-dev-sqlite-ibex',
} = {}) {
  return {
    targetProfileId,
    target: targetProfileId,
    schema: { schemaHash: 'sha256:schema' },
    functions: { ...generatedManifest, bundleHash },
    routeManifestHash: null,
    capabilityManifest: {
      artifactKind: 'capabilityManifest',
      schemaVersion: 'snapback.v0',
      targetProfileId,
      supportedCapabilities: [],
    },
  };
}

function createSequenceClient(initialInspections, {
  authMode = 'dev',
  store = null,
} = {}) {
  let inspections = [...initialInspections];
  let inspectionIndex = 0;
  return {
    rqsStore: store,
    liveQuery() {},
    async inspect() {
      const value = inspections[Math.min(inspectionIndex, inspections.length - 1)];
      inspectionIndex += 1;
      if (value instanceof Error) throw value;
      return value;
    },
    async authSession() { return { activeMode: authMode }; },
    reset(nextInspections) {
      inspections = [...nextInspections];
      inspectionIndex = 0;
    },
    inspectionCount() { return inspectionIndex; },
  };
}

// A prior successful admission leaves a receipt. The live mismatch loop must
// not adopt it while the backend restarts: only a later live successor can
// complete preparation.
let persistedReceipt = null;
const receiptStore = {
  commitReactBindingReceipt(receipt) { persistedReceipt = structuredClone(receipt); },
  loadReactBindingReceipt() { return structuredClone(persistedReceipt); },
};
const changing = createSequenceClient([
  inspection(generatedManifest.bundleHash),
], { store: receiptStore });
await prepareReactBindingForClient(changing, { generatedManifest });
assert(persistedReceipt, 'online preparation persists the binding receipt');
changing.reset([
  inspection('sha256:deployed-predecessor'),
  new TypeError('fetch failed'),
  inspection(generatedManifest.bundleHash),
]);
const transientStates = [];
const synchronized = await prepareReactBindingForClient(changing, {
  generatedManifest,
  developmentSync: {
    timeoutMs: 100,
    pollIntervalMs: 0,
    onStateChange(state) { transientStates.push(state); },
  },
});
assert.equal(synchronized.source, 'deployment');
assert.equal(changing.inspectionCount(), 3);
assert.deepEqual(
  transientStates.map((state) => state.status),
  ['waiting', 'waiting', 'ready'],
);
assert.equal(transientStates[0].message, 'Updating local backend…');
assert.equal(
  transientStates[0].diagnostic.code,
  'SNAPBACK_REACT_BINDING_MISMATCH',
);
assert.equal(transientStates[0].diagnostic.details.targetProfileId, 'local-dev-sqlite-ibex');
assert.equal(transientStates[0].diagnostic.details.authMode, 'dev');

// Synchronization is the local-dev default, not an opt-in callback feature.
const automatic = createSequenceClient([
  inspection('sha256:deployed-predecessor'),
  inspection(generatedManifest.bundleHash),
]);
const automaticallySynchronized = await prepareReactBindingForClient(automatic, {
  generatedManifest,
});
assert.equal(automaticallySynchronized.source, 'deployment');
assert.equal(automatic.inspectionCount(), 2);

// Persistent local drift is bounded. Product copy remains the primary error;
// the stable code and concrete recovery actions remain structured details.
const persistentStates = [];
const persistent = createSequenceClient([
  inspection('sha256:deployed-predecessor'),
]);
await assert.rejects(
  () => prepareReactBindingForClient(persistent, {
    generatedManifest,
    developmentSync: {
      timeoutMs: 0,
      pollIntervalMs: 0,
      onStateChange(state) { persistentStates.push(state); },
    },
  }),
  (error) => {
    assert.equal(error.code, 'SNAPBACK_REACT_BINDING_MISMATCH');
    assert.equal(error.diagnostic.code, 'SNAPBACK_REACT_BINDING_MISMATCH');
    assert.doesNotMatch(error.message, /SNAPBACK_REACT_BINDING_MISMATCH/u);
    assert.match(error.message, /still out of sync/u);
    assert.deepEqual(
      error.diagnostic.details.developmentSynchronization.actions,
      persistentStates[0].actions,
    );
    return true;
  },
);
assert.deepEqual(persistentStates.map((state) => state.status), ['timed-out']);
assert.match(persistentStates[0].actions.join('\n'), /development bundler has served the successor generated binding/u);
assert.match(persistentStates[0].actions.join('\n'), /needs no bundler restart unless a watch-inert advisory/u);
assert.equal(persistent.inspectionCount(), 1);

// The caller can opt out, and any mismatch outside the exact local-dev/dev
// tuple stays an immediate loud refusal with no synchronization projection.
const optedOut = createSequenceClient([
  inspection('sha256:deployed-predecessor'),
]);
await assert.rejects(
  () => prepareReactBindingForClient(optedOut, {
    generatedManifest,
    developmentSync: false,
  }),
  (error) => error.code === 'SNAPBACK_REACT_BINDING_MISMATCH'
    && /SNAPBACK_REACT_BINDING_MISMATCH/u.test(error.message),
);
assert.equal(optedOut.inspectionCount(), 1);

const productionStates = [];
const production = createSequenceClient([
  inspection('sha256:deployed-predecessor', { targetProfileId: 'hosted-sessions' }),
], { authMode: 'sessions' });
await assert.rejects(
  () => prepareReactBindingForClient(production, {
    generatedManifest,
    developmentSync: {
      onStateChange(state) { productionStates.push(state); },
    },
  }),
  (error) => error.code === 'SNAPBACK_REACT_BINDING_MISMATCH'
    && /SNAPBACK_REACT_BINDING_MISMATCH/u.test(error.message)
    && error.diagnostic.details.targetProfileId === 'hosted-sessions'
    && error.diagnostic.details.authMode === 'sessions',
);
assert.equal(production.inspectionCount(), 1);
assert.deepEqual(productionStates, []);

console.log('snapback-react binding development synchronization tests: ok');
