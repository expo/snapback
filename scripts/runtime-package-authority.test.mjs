import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PUBLIC_PACKAGE_BUILD_DISTRIBUTION,
  assertPublicPackageBuildIdentity,
} from './runtime-package-authority.mjs';

const valid = {
  schemaVersion: 'snapback.binary-identity.v1',
  buildDistribution: PUBLIC_PACKAGE_BUILD_DISTRIBUTION,
  binary: {
    crateVersion: '0.1.0',
    gitCommit: 'a'.repeat(40),
    gitDirty: false,
    buildProfile: 'release',
    startupNonce: 'fixture',
  },
};

test('admits only a clean release binary compiled for public packaging', () => {
  assert.equal(assertPublicPackageBuildIdentity(valid), valid);
});

for (const [name, mutate] of [
  ['source-build substitution', (value) => { value.buildDistribution = 'contributor-source'; }],
  ['unknown distribution', (value) => { value.buildDistribution = 'candidate'; }],
  ['dirty binary', (value) => { value.binary.gitDirty = true; }],
  ['unknown source', (value) => { value.binary.gitCommit = 'unknown'; }],
  ['debug binary', (value) => { value.binary.buildProfile = 'debug'; }],
  ['tampered identity shape', (value) => { value.schemaVersion = 'snapback.binary-identity.v2'; }],
]) {
  test(`refuses ${name} before runtime package assembly`, () => {
    const attempted = structuredClone(valid);
    mutate(attempted);
    assert.throws(
      () => assertPublicPackageBuildIdentity(attempted),
      (error) => error.code === 'SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED',
    );
  });
}
