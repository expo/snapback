import assert from 'node:assert/strict';
import {
  buildBootstrapPlan,
  ownershipSentinel,
  SUPERVISOR_RUNTIME_CLOSURE,
  TIGRIS_ROLES,
} from './bootstrap.mjs';

const plan = buildBootstrapPlan();
assert.equal(plan.schemaVersion, 'snapback.hosted-supervisor-bootstrap.v1');
assert.match(plan.planSha256, /^sha256:[0-9a-f]{64}$/);
assert.match(plan.ownershipSentinel, /^snapback:hosted-supervisor:v1:[0-9a-f]{24}$/);
assert.equal(plan.ownershipSentinel, ownershipSentinel());
assert.equal(plan.tariffs.maximumMonthlyMicros, 2_633_000);
assert.equal(plan.tariffs.refusalBoundaryMicros, 3_000_000);
assert.equal(plan.tariffs.providerEnforcedCap, false);
assert.equal(new Set(plan.effects.map((effect) => effect.semanticEffectId)).size, plan.effects.length);
assert.deepEqual(
  Object.keys(plan.credentials.tigris),
  Object.keys(TIGRIS_ROLES).sort(),
);
assert.equal(plan.credentials.fly.read, 'org-readonly-provider-enforced');
assert.equal(plan.credentials.fly.control, 'app-deploy-provider-enforced');
assert.equal(plan.credentials.fly.registry, 'app-deploy-custody-separated');
assert.equal(plan.nonclaims.some((claim) => claim.includes('not an HA')), true);
for (const required of [
  'operator-authority.mjs',
  'operator-authority-transaction.mjs',
  'operator-service.mjs',
  'provider-credentials.mjs',
  'provider-executor.mjs',
  'supervisor-response.mjs',
]) {
  assert(SUPERVISOR_RUNTIME_CLOSURE.includes(required));
}

const drifted = buildBootstrapPlan({ app: 'different-app' });
assert.notEqual(drifted.planSha256, plan.planSha256);
assert.notEqual(drifted.ownershipSentinel, plan.ownershipSentinel);

console.log('snapback-hosted-supervisor: bootstrap plan corpus passed');
