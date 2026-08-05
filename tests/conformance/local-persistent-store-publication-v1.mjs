import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url));
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const carrierExitBytes = await read('../acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-04.v1.json');
const carrierExit = JSON.parse(carrierExitBytes);
const triageFixtureUrl = new URL('../acceptance/fixtures/triage-graph/', import.meta.url);
const triageDates = (await readdir(triageFixtureUrl))
  .map((name) => name.match(/^move1-exit\.(\d{4}-\d{2}-\d{2})\.v1\.json$/u)?.[1])
  .filter(Boolean)
  .sort();
assert.ok(triageDates.length > 0, 'a retained Triage Move-1 receipt is required');
const triageDate = triageDates.at(-1);
const triageMove1Bytes = await read(`../acceptance/fixtures/triage-graph/move1-exit.${triageDate}.v1.json`);
const triageMove1 = JSON.parse(triageMove1Bytes);
const triageBudgetBytes = await read(`../acceptance/fixtures/triage-graph/budget-freeze.${triageDate}.v1.json`);
const triageBudget = JSON.parse(triageBudgetBytes);
const carrierBytes = await read('../../src/local-persistent-store-publication.v1.json');
const carrier = JSON.parse(carrierBytes);

assert.equal(carrierExit.schemaVersion, 'snapback.local-persistent-store.carrier-exit.v1');
assert.equal(carrierExit.partial, false);
assert.equal(carrierExit.summary.pass, 16);
assert.equal(carrierExit.summary.gap, 1);
assert.equal(carrierExit.summary.skipped, 0);
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
assert.equal(retainedTriage.status, 'PASS');
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
assert.equal(triageBudget.measured.custody.materializationRecords, 21);
assert.equal(triageBudget.measured.custody.storedResultRows, 120);
assert.equal(triageBudget.measured.custody.logicalBytes, 48_016);
assert.equal(triageBudget.measured.hydration.attempts, 1);
assert.equal(triageBudget.measured.hydration.rowsInstalled, 100);
assert.equal(triageBudget.measured.hydration.payloadBytes, 14_981);
assert.ok(
  triageBudget.measured.hydration.elapsedMs <= triageBudget.frozenCeilings.hydration.elapsedMs,
  'Triage hydration stays below its frozen ceiling',
);

assert.equal(carrier.schemaVersion, 'snapback.local-capability-publication.v1');
assert.equal(carrier.targetProfileId, 'local-dev-sqlite-ibex');
assert.deepEqual(carrier.capabilityIds, ['single_table_v1']);
assert.equal(carrier.maturity, 'experimental');
assert.equal(carrier.qualificationReceiptSha256, sha256(carrierExitBytes));
assert.deepEqual(carrier.supportingReceiptSha256, {
  triageBudgetFreeze: sha256(triageBudgetBytes),
  triageMove1Exit: sha256(triageMove1Bytes),
});
assert.equal(
  sha256(carrierBytes),
  'sha256:eb2aa9237457ab44a48cddcd5414832211a32539353c9fe9ad9be2f131657d97',
);
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

console.log(JSON.stringify({
  schemaVersion: 'snapback.local-persistent-store-publication-evidence.v1',
  status: 'passed',
  targetProfileId: carrier.targetProfileId,
  capabilityIds: carrier.capabilityIds,
  maturity: carrier.maturity,
  carrierSha256: sha256(carrierBytes),
  carrierExit: `${carrierExit.summary.pass} PASS / ${carrierExit.summary.gap} GAP`,
  triageMove1: `${triageMove1.summary.pass}/${triageMove1.summary.total} PASS`,
  fleetBoundary: retainedFleet.reason,
  publicPackage: 'withheld-structured-gap',
  hostedTargets: 'withheld-structured-gap',
}));
