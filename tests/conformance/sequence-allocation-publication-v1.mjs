import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const receiptBytes = await readFile(new URL('./sequence-allocation-publication-v1.receipt.json', import.meta.url));
const receipt = JSON.parse(receiptBytes);
const carrierBytes = await readFile(new URL('../../src/local-sequence-allocation-publication.v1.json', import.meta.url));
const carrier = JSON.parse(carrierBytes);
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

assert.equal(receipt.repositoryLocal.status, 'passed');
assert.equal(receipt.repositoryLocal.targetProfileId, 'local-dev-sqlite-ibex');
assert.equal(receipt.publication.status, 'published-local-source');
assert.equal(receipt.publication.authority, 'LocalCapabilityPublicationV1');
assert.deepEqual(receipt.publication.targetProfileIds, ['local-dev-sqlite-ibex']);
assert.deepEqual(receipt.publication.capabilityIds, ['sequence_allocation_v1']);
assert.equal(receipt.publication.maturity, 'experimental');
assert.equal(receipt.publication.capabilitiesPublished, true);
assert.equal(receipt.publication.acknowledgmentRequired, true);
assert.equal(receipt.publication.artifactAuthority, false);
assert.equal(receipt.publication.hostedAuthority, false);
assert.deepEqual(receipt.publicPackage.capabilityGaps, ['sequence_allocation_v1']);
assert.deepEqual(receipt.hostedTargets.capabilityGaps, ['sequence_allocation_v1']);
assert.deepEqual(
  receipt.repositoryLocal.cases.map((entry) => entry.id),
  [
    'dense-abort-and-commit-order-contention',
    'two-transaction-stale-first-writer',
    'console-and-throw-abort-disclosure-trace-free',
    'delete-recreate-incarnation-prefixed-uniqueness',
    'brownfield-reviewed-backfill',
    'sequential-and-concurrent-exact-settlement-replay',
    'lane-q-cross-projection-mutation-atomic-withholding',
    'exhaustion-oracle-collapse-and-closed-api',
    'relay-move-card-generated-write-activity',
    'campfire-anonymous-public-concurrent-send',
  ],
);
const contention = receipt.repositoryLocal.cases[0].observation;
assert.equal(contention.writers, 24);
assert.ok(contention.elapsedMs <= contention.maximumQualifiedElapsedMs);
assert.deepEqual(contention.commitOrderValues, Array.from({ length: 24 }, (_, index) => index + 1));
const campfire = receipt.repositoryLocal.cases.at(-1).observation;
assert.equal(campfire.anonymousSenders, 8);
assert.equal(campfire.rangeReads, 0);
assert.deepEqual(campfire.commitOrderValues, [1, 2, 3, 4, 5, 6, 7, 8]);

assert.equal(carrier.schemaVersion, 'snapback.local-capability-publication.v1');
assert.equal(carrier.targetProfileId, 'local-dev-sqlite-ibex');
assert.deepEqual(carrier.capabilityIds, ['sequence_allocation_v1']);
assert.equal(carrier.maturity, 'experimental');
assert.equal(carrier.qualificationReceiptSha256, sha256(receiptBytes));
assert.equal(
  sha256(carrierBytes),
  'sha256:9888ac4df098d07ba86e1422b3e195e466e20740a28375b19bbbb9ece0d69aea',
);
for (const [source, expected] of Object.entries({
  ...carrier.executorSourceSha256,
  ...carrier.schemaSourceSha256,
  ...carrier.clientSourceSha256,
})) {
  const sourceBytes = await readFile(new URL(`../../${source}`, import.meta.url));
  assert.equal(sha256(sourceBytes), expected, `${source} drifted from the sequence publication carrier`);
}
assert.equal(carrier.packageClosureSha256, null);
assert.equal(carrier.buildProvenanceRequirement, 'source-commit-and-embedded-carrier-sha256');

console.log(JSON.stringify({
  schemaVersion: 'snapback.sequence-allocation-publication-evidence.v1',
  status: 'passed',
  targetProfileId: carrier.targetProfileId,
  capabilityIds: carrier.capabilityIds,
  maturity: carrier.maturity,
  carrierSha256: sha256(carrierBytes),
  qualifiedCases: receipt.repositoryLocal.cases.length,
  publicPackage: receipt.publicPackage.status,
  hostedTargets: receipt.hostedTargets.status,
}));
