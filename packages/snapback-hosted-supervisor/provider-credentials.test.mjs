import assert from 'node:assert/strict';

import {
  credentialBindingFor,
  providerSecretPath,
} from './provider-credentials.mjs';

const base = {
  appId: 'snapback-app-a',
  tigrisBucket: 'snapback-control',
  controlStatePrefix: 'targets/target-a/control/',
  externalHeadKey: 'targets/target-a/control/head.json',
  credentials: [{
    role: 'flyControl',
    credentialRef: 'provider-secret://supervisor/fly-a',
    fingerprint: `sha256:${'1'.repeat(64)}`,
    allowedVerbs: ['control'],
    resourcePrefixes: ['fly://apps/snapback-app-a'],
  }, {
    role: 'tigrisControlState',
    credentialRef: 'provider-secret://supervisor/tigris-a',
    fingerprint: `sha256:${'2'.repeat(64)}`,
    allowedVerbs: ['s3:GetObject', 's3:PutObject'],
    resourcePrefixes: ['s3://snapback-control/targets/target-a/control/'],
  }],
};

assert.equal(
  credentialBindingFor({
    binding: base,
    role: 'flyControl',
    requiredVerb: 'control',
  }).role,
  'flyControl',
);
assert.equal(
  credentialBindingFor({
    binding: base,
    role: 'tigrisControlState',
    requiredVerb: 's3:GetObject',
    objectKey: base.externalHeadKey,
  }).role,
  'tigrisControlState',
);
assert.equal(providerSecretPath('provider-secret://supervisor/fly-a'), '/run/secrets/fly-a');

for (const [name, mutate, input] of [
  ['wrong role', (value) => { value.credentials[0].role = 'tigrisControlState'; }, {
    role: 'flyControl', requiredVerb: 'control',
  }],
  ['cross app', (value) => { value.credentials[0].resourcePrefixes = ['fly://apps/snapback-app-b']; }, {
    role: 'flyControl', requiredVerb: 'control',
  }],
  ['cross bucket', (value) => { value.credentials[1].resourcePrefixes = ['s3://other/targets/target-a/control/']; }, {
    role: 'tigrisControlState', requiredVerb: 's3:GetObject', objectKey: base.externalHeadKey,
  }],
  ['cross key', () => {}, {
    role: 'tigrisControlState', requiredVerb: 's3:GetObject', objectKey: 'targets/target-b/control/head.json',
  }],
  ['wrong verb', () => {}, {
    role: 'tigrisControlState', requiredVerb: 's3:DeleteObject', objectKey: base.externalHeadKey,
  }],
]) {
  const binding = structuredClone(base);
  mutate(binding);
  assert.throws(
    () => credentialBindingFor({ binding, ...input }),
    { code: 'SNAPBACK_SUPERVISOR_CREDENTIAL_INVALID' },
    name,
  );
}

console.log('provider credential binding tests passed');
