import assert from 'node:assert/strict';
import { mock } from 'node:test';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import { createSnapbackReactProvider } from './index.mjs';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const queryContract = {
  kind: 'records',
  record: {
    kind: 'object',
    fields: [{ name: 'id', required: true, value: { kind: 'string', maxBytes: 32 } }],
    allowExtra: false,
  },
};
const records = Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: 'runtime-import-failure',
  id: 'runtime-import-failure:records',
  name: 'records',
  kind: 'LiveQuery',
  implementationHash: 'sha256:runtime-import-failure-implementation',
  argsContractHash: 'sha256:runtime-import-failure-args',
  argsContract: { kind: 'object', fields: [] },
  resultContractHash: resultContractHash(queryContract),
  resultContract: queryContract,
});
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'runtime-import-failure',
  bundleHash: 'sha256:runtime-import-failure-bundle',
  functions: [records],
});

let attempts = 0;
let loadAttempts = 0;
const client = {
  liveQuery() {},
  async inspect() {
    return {
      targetProfileId: 'local-dev-sqlite-ibex',
      target: 'local-dev-sqlite-ibex',
      schema: { schemaHash: 'sha256:runtime-import-failure-schema' },
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
  startLiveQuery() {
    attempts += 1;
    const error = new Error('SNAPBACK_TEST_SUBSCRIBE_FAILED: subscribe failed');
    error.code = 'SNAPBACK_TEST_SUBSCRIBE_FAILED';
    const rejection = Promise.reject(error);
    rejection.catch(() => {});
    return Object.freeze({
      current: null,
      started: () => rejection,
      dispose() {},
      settled: async () => {},
    });
  },
};

mock.timers.enable({ apis: ['setTimeout'] });
const binding = await prepareReactBindingForClient(client, { generatedManifest: functions });
const provider = createSnapbackReactProvider(binding, {
  connectionId: 'runtime-import-failure',
  __loadReactRuntime: async () => {
    loadAttempts += 1;
    throw new Error('simulated optional react-runtime chunk rejection');
  },
});
const descriptor = provider.registry.descriptor(records, {});
const lease = provider.registry.subscribe(descriptor, () => {});
await flush();

assert.equal(loadAttempts, 1, 'the regression forces the optional runtime import to reject');
assert.equal(attempts, 1);
let snapshot = provider.registry.snapshot(descriptor);
assert.equal(snapshot.status, 'error', 'the inline fallback publishes the subscribe error');
assert.equal(snapshot.error?.code, 'SNAPBACK_TEST_SUBSCRIBE_FAILED');

mock.timers.tick(249);
await flush();
assert.equal(attempts, 1, 'the inline retry is timer-owned');
mock.timers.tick(1);
await flush();
assert.equal(attempts, 2, 'the fixed-delay fallback retries instead of wedging');
snapshot = provider.registry.snapshot(descriptor);
assert.equal(snapshot.status, 'error');

lease.release();
await flush();
await provider.dispose();
mock.timers.reset();
console.log('snapback-react runtime import failure fallback tests: ok');
