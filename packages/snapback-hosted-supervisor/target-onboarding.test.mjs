import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertTargetTigrisCredentialPair } from './internal/target-tigris-credentials.mjs';
import {
  buildTargetOnboardingPlan,
  TARGET_DEFAULTS,
  TARGET_SUPERVISOR_SECRET_FILES,
  TARGET_TIGRIS_ROLES,
  targetRolePolicy,
} from './target-onboarding.mjs';

const targetOnboardingSource = readFileSync(
  new URL('./target-onboarding.mjs', import.meta.url),
  'utf8',
);
const targetTigrisCredentialsSource = readFileSync(
  new URL('./internal/target-tigris-credentials.mjs', import.meta.url),
  'utf8',
);
const packageManifest = JSON.parse(readFileSync(
  new URL('./package.json', import.meta.url),
  'utf8',
));

const plan = buildTargetOnboardingPlan();
assert.equal(plan.schemaVersion, 'snapback.hosted-target-onboarding.v1');
assert.match(plan.planSha256, /^sha256:[0-9a-f]{64}$/);
assert.equal(plan.config.targetApp, 'snapback-drill');
assert.equal(plan.config.supervisorApp, 'snapback-hosted-supervisor-sjc');
assert.equal(plan.config.targetId, 'snapback-drill-hosted-v2-20260728');
assert.equal(plan.refusalBoundaryMicros, 3_000_000);
assert.equal(plan.providerEnforcedCap, false);
assert.ok(plan.forbiddenEffects.includes('update legacy product Machine'));
assert.ok(plan.forbiddenEffects.includes('advertise hosted capability'));
const expectedSecretProjectionCount = 4 + Object.keys(TARGET_TIGRIS_ROLES).length * 2;
assert.equal(
  new Set(TARGET_SUPERVISOR_SECRET_FILES.map(([path]) => path)).size,
  expectedSecretProjectionCount,
);
assert.equal(
  new Set(TARGET_SUPERVISOR_SECRET_FILES.map(([, secret]) => secret)).size,
  expectedSecretProjectionCount,
);
assert.deepEqual(Object.keys(TARGET_TIGRIS_ROLES).sort(), [
  'artifact',
  'audit',
  'backup',
  'cleanup',
  'control-state',
  'logs',
]);
assert.throws(
  () => assertTargetTigrisCredentialPair('control-state', {
    accessKeyId: 'present-without-secret',
  }),
  /SNAPBACK_HOSTED_TARGET_TIGRIS_CONTROL_STATE_PARTIAL/,
);
assert.throws(
  () => assertTargetTigrisCredentialPair('unknown-role'),
  /SNAPBACK_HOSTED_TARGET_TIGRIS_BOOTSTRAP_INVALID/,
);
assert.equal(
  Object.keys(packageManifest.exports).some((specifier) => specifier.includes('target-tigris')),
  false,
  'the credential-pair validator has no package export',
);
const partialCredentialCodes = Object.fromEntries([
  ...targetTigrisCredentialsSource.matchAll(
    /^\s*(?:'([^']+)'|([a-z][a-z-]*)):\s*'(SNAPBACK_HOSTED_TARGET_TIGRIS_[A-Z_]+_PARTIAL)',?$/gmu,
  ),
].map((match) => [match[1] ?? match[2], match[3]]));
assert.deepEqual(partialCredentialCodes, {
  artifact: 'SNAPBACK_HOSTED_TARGET_TIGRIS_ARTIFACT_PARTIAL',
  backup: 'SNAPBACK_HOSTED_TARGET_TIGRIS_BACKUP_PARTIAL',
  'control-state': 'SNAPBACK_HOSTED_TARGET_TIGRIS_CONTROL_STATE_PARTIAL',
  audit: 'SNAPBACK_HOSTED_TARGET_TIGRIS_AUDIT_PARTIAL',
  logs: 'SNAPBACK_HOSTED_TARGET_TIGRIS_LOGS_PARTIAL',
  cleanup: 'SNAPBACK_HOSTED_TARGET_TIGRIS_CLEANUP_PARTIAL',
});
assert.match(
  targetTigrisCredentialsSource,
  /if\s*\(!Object\.hasOwn\(TARGET_TIGRIS_PARTIAL_CREDENTIAL_CODES, role\)\)\s*\{\s*throw new Error\('SNAPBACK_HOSTED_TARGET_TIGRIS_BOOTSTRAP_INVALID'\);\s*\}/u,
  'unknown roles must fail closed with a registered code',
);
assert.match(
  targetTigrisCredentialsSource,
  /if\s*\(Boolean\(accessKeyId\)\s*!==\s*Boolean\(secretAccessKey\)\)\s*\{[\s\S]*?throw new Error\(TARGET_TIGRIS_PARTIAL_CREDENTIAL_CODES\[role\]\);\s*\}/u,
  'partial credentials must throw the private exhaustive role mapping entry',
);
assert.match(
  targetOnboardingSource,
  /async function ensureTargetTigrisRole\([^)]*\)\s*\{[\s\S]*?assertTargetTigrisCredentialPair\(role, \{ accessKeyId, secretAccessKey \}\);/u,
  'the effectful onboarding path must call the pure credential-pair validator',
);
const artifactPolicy = targetRolePolicy(
  TARGET_DEFAULTS,
  'artifact',
  TARGET_TIGRIS_ROLES.artifact,
);
assert.deepEqual(artifactPolicy.Statement, [{
  Sid: 'ExactTargetPrefix',
  Effect: 'Allow',
  Action: ['s3:GetObject'],
  Resource: 'arn:aws:s3:::snapback-drill-backups/snapback-hosted-v2/artifact/*',
}]);
const cleanupPolicy = targetRolePolicy(
  TARGET_DEFAULTS,
  'cleanup',
  TARGET_TIGRIS_ROLES.cleanup,
);
assert.equal(
  cleanupPolicy.Statement[0].Resource,
  'arn:aws:s3:::snapback-drill-backups/snapback-hosted-v2/*',
);
assert.deepEqual(cleanupPolicy.Statement[0].Action, ['s3:DeleteObject']);
assert.equal(cleanupPolicy.Statement[1].Resource, 'arn:aws:s3:::snapback-drill-backups');
assert.equal(cleanupPolicy.Statement[1].Condition, undefined);

const changed = buildTargetOnboardingPlan({ targetId: 'fresh-target-id' });
assert.notEqual(changed.planSha256, plan.planSha256);
assert.notEqual(changed.ownershipSentinel, plan.ownershipSentinel);
assert.throws(
  () => buildTargetOnboardingPlan({
    ...TARGET_DEFAULTS,
    refusalBoundaryMicros: 3_000_001,
  }),
  /SNAPBACK_HOSTED_TARGET_SPEND_REFUSED/,
);

console.log('snapback-hosted-supervisor: target onboarding plan corpus passed');
