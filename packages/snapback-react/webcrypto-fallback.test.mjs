import assert from 'node:assert/strict';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import {
  createSnapbackReactProvider,
  observeSnapbackQueries,
} from './index.mjs';

// Regression: 0137 A1-Expo f1 — the documented Expo/RN path must reach a
// ready provider and a live query with ZERO consumer polyfills. React
// Native/Hermes ships no `globalThis.crypto`; the provider previously died
// on `crypto.randomUUID` (instance labels) after prepareReactBinding died on
// `crypto.subtle` (binding digests). Local-uniqueness labels fall back to
// time+sequence uniqueness; digests fall back to the parity-tested pure-JS
// SHA-256.

const flush = () => new Promise((resolve) => setImmediate(resolve));
const queryContract = {
  kind: 'records',
  record: {
    kind: 'object',
    fields: [
      { name: 'id', required: true, value: { kind: 'string', maxBytes: 32 } },
    ],
    allowExtra: false,
  },
};
const records = Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: 'rn-crypto-fixture',
  id: 'rn-crypto-fixture:records',
  name: 'records',
  kind: 'LiveQuery',
  implementationHash: 'sha256:records-implementation',
  argsContractHash: 'sha256:records-args',
  argsContract: { kind: 'object', fields: [] },
  resultContractHash: resultContractHash(queryContract),
  resultContract: queryContract,
});
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'rn-crypto-fixture',
  bundleHash: 'sha256:rn-crypto-bundle',
  functions: [records],
});

const ROWS = [{ id: 'rec-1' }, { id: 'rec-2' }];

const fakeClient = () => ({
  liveQuery() {},
  async inspect() {
    return {
      targetProfileId: 'local-dev-sqlite-ibex',
      target: 'local-dev-sqlite-ibex',
      schema: { schemaHash: 'sha256:rn-crypto-schema' },
      functions,
      capabilityManifest: {
        artifactKind: 'capabilityManifest',
        schemaVersion: 'snapback.v0',
        targetProfileId: 'local-dev-sqlite-ibex',
        supportedCapabilities: ['live_subscriptions'],
      },
    };
  },
  async authSession() { return { activeMode: 'dev' }; },
  registerAuthBarrierParticipant() { return async () => {}; },
  liveStreamManager() { return { async settled() {} }; },
  startLiveQuery(_reference, options) {
    const current = { rows: [...ROWS], connection: 'live' };
    const handle = {
      current,
      started: async () => {},
      dispose() {},
      settled: async () => {},
    };
    queueMicrotask(() => options.onUpdate(current.rows, {}));
    return Object.freeze(handle);
  },
});

const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
Object.defineProperty(globalThis, 'crypto', {
  value: undefined,
  configurable: true,
  writable: true,
});
try {
  const binding = await prepareReactBindingForClient(fakeClient(), {
    generatedManifest: functions,
  });
  const provider = createSnapbackReactProvider(binding, { connectionId: 'rn-crypto-test' });
  assert.match(provider.providerInstanceId, /^provider-\d+-/u);
  const observer = observeSnapbackQueries(
    provider,
    { records: { ref: records, args: {} } },
    () => {},
  );
  await flush();
  const state = observer.snapshot().queries.records;
  assert.equal(state.status, 'ready', 'cryptoless carrier reaches a ready live query');
  assert.deepEqual(state.data, ROWS);
  observer.dispose();
  await flush();
} finally {
  Object.defineProperty(globalThis, 'crypto', descriptor);
}

console.log('snapback-react webcrypto fallback tests: ok');
