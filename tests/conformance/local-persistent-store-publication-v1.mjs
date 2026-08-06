import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url));
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const carrierExitBytes = await read('../acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-04.v1.json');
const carrierExit = JSON.parse(carrierExitBytes);
const triageFixtureUrl = new URL('../acceptance/fixtures/triage-graph/', import.meta.url);
const triageNames = await readdir(triageFixtureUrl);
const budgetDates = new Set(triageNames
  .map((name) => name.match(/^budget-freeze\.(\d{4}-\d{2}-\d{2})\.v1\.json$/u)?.[1])
  .filter(Boolean));
const triageDates = triageNames
  .map((name) => name.match(/^move1-exit\.(\d{4}-\d{2}-\d{2})\.v1\.json$/u)?.[1])
  .filter((date) => date && budgetDates.has(date))
  .sort();
assert.ok(triageDates.length > 0, 'a retained Triage Move-1 receipt is required');
const triageDate = triageDates.at(-1);
const triageMove1Bytes = await read(`../acceptance/fixtures/triage-graph/move1-exit.${triageDate}.v1.json`);
const triageMove1 = JSON.parse(triageMove1Bytes);
const triageBudgetBytes = await read(`../acceptance/fixtures/triage-graph/budget-freeze.${triageDate}.v1.json`);
const triageBudget = JSON.parse(triageBudgetBytes);
const anchorBytes = await read('../../src/local-persistent-store-publication.anchor.v1.json');
const anchor = JSON.parse(anchorBytes);
const carrierBytes = await read('../../src/local-persistent-store-publication.v1.json');
const carrier = JSON.parse(carrierBytes);
const localManifest = JSON.parse(await read('../../schemas/capability.manifest.local-dev-sqlite-ibex.json'));

assert.equal(carrierExit.schemaVersion, 'snapback.local-persistent-store.carrier-exit.v1');
assert.equal(carrierExit.partial, false);
assert.deepEqual(carrierExit.summary, {
  pass: carrierExit.legs.filter((leg) => leg.status === 'PASS').length,
  gap: carrierExit.legs.filter((leg) => leg.status === 'GAP').length,
  skipped: carrierExit.legs.filter((leg) => leg.status === 'SKIPPED').length,
  capabilityClaimsChanged: false,
});
for (const leg of [
  'browser-terminate-relaunch',
  'file-process-terminate-relaunch',
  'retained-render-server-unreachable',
  'authority-logout',
  'authority-user-switch',
  'authority-revocation',
  'bounded-custody-query-churn',
  'bundle-attribution',
]) {
  assert.equal(carrierExit.legs.find((row) => row.leg === leg)?.status, 'PASS', `${leg}: qualified`);
}
const retainedTriage = carrierExit.legs.find((row) => row.leg === 'footprint-hydration-triage');
assert.ok(['PASS', 'GAP'].includes(retainedTriage.status));
if (retainedTriage.status === 'GAP') {
  assert.match(retainedTriage.reason, /^SNAPBACK_CARRIER_EXIT_TRIAGE_SUCCESSOR_MISSING:/u);
}
const retainedFleet = carrierExit.legs.find((row) => row.leg === 'footprint-hydration-fleet');
assert.equal(retainedFleet.status, 'GAP');
assert.match(retainedFleet.reason, /^SNAPBACK_CARRIER_EXIT_FLEET_SUCCESSOR_BLOCKED:/u);

assert.equal(triageMove1.schemaVersion, 'snapback.triage-graph.move1-exit.v1');
assert.equal(triageMove1.date, triageDate);
assert.equal(triageBudget.date, triageDate);
assert.equal(triageMove1.controlledRun.status, 'PASS');
assert.equal(triageMove1.summary.blocked, 0);
assert.equal(triageMove1.summary.pass, triageMove1.summary.total);
assert.deepEqual(triageMove1.budgetFreeze, triageBudget);
if (triageBudget.custodySemantics === 'store-policy-reasons-v1') {
  assert.equal(triageBudget.measured.custody.payloadBearingRecords, 1);
  assert.equal(triageBudget.measured.custody.releasedVolatilePayloadRecords, 0);
  assert.equal(triageBudget.measured.custody.releaseGraceRecords, 0);
  assert.equal(triageBudget.measured.custody.safetyBlockerRecords, 0);
  assert.equal(
    triageBudget.measured.custody.materializationRecords,
    triageBudget.measured.custody.payloadBearingRecords
      + triageBudget.measured.custody.instanceBookkeepingStubs,
  );
  assert.equal(triageBudget.measured.custody.storedResultRows, 100);
}
for (const [name, ceiling] of Object.entries(triageBudget.frozenCeilings.custody)) {
  assert.ok(triageBudget.measured.custody[name] <= ceiling, `${name}: within frozen custody ceiling`);
}
assert.equal(triageBudget.measured.hydration.attempts, 1);
assert.equal(triageBudget.measured.hydration.rowsInstalled, 100);
assert.ok(
  triageBudget.measured.hydration.elapsedMs <= triageBudget.frozenCeilings.hydration.elapsedMs,
  'Triage hydration stays below its frozen ceiling',
);

assert.equal(carrier.schemaVersion, 'snapback.local-capability-publication.v1');
assert.deepEqual(anchor, {
  schemaVersion: 'snapback.local-capability-publication-anchor.v1',
  capabilityId: 'single_table_v1',
  state: 'published',
  carrierSha256: sha256(carrierBytes),
});
assert.equal(carrier.targetProfileId, 'local-dev-sqlite-ibex');
assert.deepEqual(carrier.capabilityIds, ['single_table_v1']);
assert.equal(carrier.maturity, 'experimental');
assert.equal(carrier.qualificationReceiptSha256, sha256(carrierExitBytes));
assert.deepEqual(carrier.supportingReceiptSha256, {
  triageBudgetFreeze: sha256(triageBudgetBytes),
  triageMove1Exit: sha256(triageMove1Bytes),
});
const newlyQualifiedClientSources = [
  'packages/snapback-client/materialization-store-runtime.mjs',
  'packages/snapback-client/rqs-preload-core.mjs',
  'packages/snapback-client/store-runtime.mjs',
];
for (const source of newlyQualifiedClientSources) {
  assert.match(carrier.clientSourceSha256[source] ?? '', /^sha256:[0-9a-f]{64}$/u);
  assert.ok(
    carrierExit.source.files.some((entry) => entry.path === source),
    `${source}: carrier-exit receipt pins the refactored behavior owner`,
  );
  assert.ok(
    triageMove1.source.files.some((entry) => entry.path === source),
    `${source}: Triage receipt pins the refactored behavior owner`,
  );
}
for (const [source, expected] of Object.entries({
  ...carrier.executorSourceSha256,
  ...carrier.schemaSourceSha256,
  ...carrier.clientSourceSha256,
})) {
  const sourceBytes = await read(`../../${source}`);
  assert.equal(sha256(sourceBytes), expected, `${source} drifted from the store publication carrier`);
}
assert.equal(carrier.packageClosureSha256, null);
assert.equal(carrier.buildProvenanceRequirement, 'source-commit-and-embedded-carrier-sha256');
const qualified = carrierExit.summary.pass === 16
  && carrierExit.summary.gap === 1
  && carrierExit.summary.skipped === 0
  && retainedTriage.status === 'PASS'
  && retainedFleet.status === 'GAP'
  && triageMove1.summary.pass === 8
  && triageMove1.summary.blocked === 0;
assert.equal(localManifest.supportedCapabilities.includes('single_table_v1'), qualified);
assert.equal(localManifest.capabilityGaps.includes('single_table_v1'), !qualified);

console.log(JSON.stringify({
  schemaVersion: 'snapback.local-persistent-store-publication-evidence.v1',
  status: qualified ? 'published' : 'withheld',
  targetProfileId: carrier.targetProfileId,
  capabilityIds: carrier.capabilityIds,
  maturity: carrier.maturity,
  carrierSha256: sha256(carrierBytes),
  carrierExit: `${carrierExit.summary.pass} PASS / ${carrierExit.summary.gap} GAP`,
  triageMove1: `${triageMove1.summary.pass}/${triageMove1.summary.total} PASS`,
  withholdingReason: qualified
    ? null
    : 'SNAPBACK_LOCAL_PERSISTENT_STORE_FRESH_RECEIPTS_REQUIRED: the retained carrier/Triage evidence does not satisfy 16 PASS / 1 GAP / 0 skipped plus Triage 8/8',
  fleetBoundary: retainedFleet.reason,
  publicPackage: 'withheld-structured-gap',
  hostedTargets: 'withheld-structured-gap',
}));
