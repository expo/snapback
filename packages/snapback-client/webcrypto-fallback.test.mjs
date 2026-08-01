import assert from 'node:assert/strict';

import { newSeedOperationIdV1, SnapbackClient } from './index.mjs';
import { prepareReactBindingForClient } from './react-binding.mjs';
import { createClientMutationId } from '@expo/snapback-contract';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';

// Regression: 0137 A1-Expo f1 — React Native/Hermes ships no
// `globalThis.crypto`, and the packaged client previously died with
// `Cannot read property 'subtle' of undefined` inside prepareReactBinding
// before any session existed. The documented Expo path must now boot with
// zero consumer polyfills for the digest surfaces (deterministic integrity
// metadata computed by the parity-tested pure-JS SHA-256), while
// security-bearing random identity refuses with ONE named actionable code
// (never a Math.random synthesis, never a bare carrier TypeError).

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
const reference = Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: 'webcrypto-fixture',
  id: 'webcrypto-fixture:records',
  name: 'records',
  kind: 'LiveQuery',
  implementationHash: 'sha256:records-implementation',
  argsContractHash: 'sha256:records-args',
  resultContractHash: resultContractHash(queryContract),
  resultContract: queryContract,
});
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'webcrypto-fixture',
  bundleHash: 'sha256:webcrypto-bundle',
  functions: [reference],
});

const fakeClient = () => ({
  liveQuery() {},
  async inspect() {
    return {
      targetProfileId: 'local-dev-sqlite-ibex',
      target: 'local-dev-sqlite-ibex',
      schema: { schemaHash: 'sha256:webcrypto-schema' },
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
});

const withoutGlobalCrypto = async (run) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  try {
    return await run();
  } finally {
    Object.defineProperty(globalThis, 'crypto', descriptor);
  }
};

// --- 1: the documented RN boot path (prepareReactBinding) works with no
// --- WebCrypto at all, and its digests match the subtle-backed run exactly.
const withCrypto = await prepareReactBindingForClient(fakeClient(), {
  generatedManifest: functions,
});
const withoutCrypto = await withoutGlobalCrypto(() => prepareReactBindingForClient(
  fakeClient(),
  { generatedManifest: functions },
));
assert.equal(
  withoutCrypto.routeManifestHash,
  withCrypto.routeManifestHash,
  'pure-JS digest fallback is byte-identical to the SubtleCrypto path',
);
assert.deepEqual(
  { appId: withoutCrypto.appId, bundleHash: withoutCrypto.deploymentIdentity.bundleHash },
  { appId: withCrypto.appId, bundleHash: withCrypto.deploymentIdentity.bundleHash },
);

// --- 2: security-bearing random identity refuses with the named code and
// --- actionable guidance, never a bare carrier TypeError.
await withoutGlobalCrypto(() => {
  assert.throws(
    () => newSeedOperationIdV1(),
    (error) => error?.code === 'SNAPBACK_CLIENT_WEBCRYPTO_RNG_MISSING'
      && /expo-crypto/u.test(error.message),
    'seed operation identity names the missing RNG and the polyfill path',
  );
  assert.throws(
    () => SnapbackClient.mintBundleBootKey(),
    (error) => error?.code === 'SNAPBACK_CLIENT_WEBCRYPTO_RNG_MISSING',
    'bundle boot idempotency keys refuse with the same named code',
  );
});

// --- 3: mutation identity (the M2 queue's exactly-once id) still mints on a
// --- cryptoless carrier via its established non-crypto uniqueness fallback.
await withoutGlobalCrypto(() => {
  assert.match(createClientMutationId(), /^cm_/u);
});

console.log('snapback-client webcrypto fallback tests: ok');
