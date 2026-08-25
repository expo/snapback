import assert from 'node:assert/strict';
import { join } from 'node:path';

import { resolveVisibilityGovernanceServerProfile } from '@expo/snapback-codegen/visibility-governance-dev-config';

import { __test } from './index.mjs';
import { DEV_IDENTITY_ENFORCEMENT_FLIP } from './dev-identity.mjs';

const database = join(process.cwd(), '.missing-dev-identity-notice.sqlite3');
const descriptor = { database: { mode: 'file', path: database } };
let stderr = '';
const originalStderrWrite = process.stderr.write;
process.stderr.write = (chunk) => {
  stderr += String(chunk);
  return true;
};

try {
  const frontedProdProfile = resolveVisibilityGovernanceServerProfile({
    SNAPBACK_EXPOSURE: 'fronted',
  });
  assert.equal(frontedProdProfile, 'prod');
  assert.equal(__test.resolveDevIdentityCapabilityForCli(descriptor, {
    database,
    serverProfile: frontedProdProfile,
  }), null);
  assert.equal(stderr, '', 'fronted/Prod without an advertised sidecar emits no absence notice');

  const devProfile = resolveVisibilityGovernanceServerProfile({});
  assert.equal(devProfile, 'dev');
  assert.equal(__test.resolveDevIdentityCapabilityForCli(descriptor, {
    database,
    serverProfile: devProfile,
  }), null);
} finally {
  process.stderr.write = originalStderrWrite;
}

assert.equal(
  stderr,
  `SNAPBACK_DEV_IDENTITY_ABSENT: no usable dev-identity capability was found at ${database}.dev-identity; continuing without it during Stage 2; enforcement flip ${DEV_IDENTITY_ENFORCEMENT_FLIP} remains acceptance-gated; see LLP 0262#d5-rollout-stages\n`,
  'dev profile emits the Stage-2 absence notice',
);

console.log('dev-identity-absence-notice.test.mjs: profile-aware absence notice passed');
