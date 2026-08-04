import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  allowedPublicationPath,
  implementationDigestAt,
  runChecker,
  validateAbsolutePerformanceArtifact,
  validatePairedPerformanceArtifact,
  validatePublishedEvidenceSemantics,
  validatePublicationRecord,
} from '../scripts/check-agent-safe-publication.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const storage = {
  id: 'agent_safe_storage_v1',
  anchor: 'src/local-agent-safe-storage-publication.anchor.json',
  carrier: 'src/local-agent-safe-storage-publication.carrier.json',
  receipt: 'tests/acceptance/receipts/agent-safe-storage-publication.2026-08-04.v1.json',
  components: [
    'ordinaryMutationHostPlanEnvelope',
    'ordinaryMutationIbexBufferedEnvelope',
    'hostChildMutationHostPlanEnvelope',
    'hostChildMutationIbexBufferedEnvelope',
    'generatedOwnedCrudOwnerCreateHostPlanExplanation',
    'generatedOwnedCrudOwnerUpdateHostPlanExplanation',
  ],
};
const derived = {
  id: 'agent_safe_derived_deployment_fork_v1',
  anchor: 'src/local-agent-safe-derived-deployment-fork-publication.anchor.json',
  carrier: 'src/local-agent-safe-derived-deployment-fork-publication.carrier.json',
  receipt: 'tests/acceptance/receipts/agent-safe-derived-deployment-fork-publication.2026-08-04.v1.json',
  components: ['derivedDeploymentForkSafetyV1'],
};

const pairedMetrics = [
  ['currentPointReadP50Us', 'higherIsWorse', 'twoSidedEquivalence', 5],
  ['currentPointReadP95Us', 'higherIsWorse', 'twoSidedEquivalence', 5],
  ['currentRangeReadP50Us', 'higherIsWorse', 'twoSidedEquivalence', 5],
  ['currentRangeReadP95Us', 'higherIsWorse', 'twoSidedEquivalence', 5],
  ['currentQueryPlanReadP50Us', 'higherIsWorse', 'twoSidedEquivalence', 5],
  ['currentQueryPlanReadP95Us', 'higherIsWorse', 'twoSidedEquivalence', 5],
  ['singleWriterMutationsPerSec', 'lowerIsWorse', 'oneSidedRegression', 15],
  ['singleWriterMutationP50Us', 'higherIsWorse', 'oneSidedRegression', 15],
  ['singleWriterMutationP95Us', 'higherIsWorse', 'oneSidedRegression', 15],
];
const byteMetrics = [
  'allocatedWriteBytesPerChangedRow',
  'allocatedWriteBytesPerOperation',
  'retainedBytesPerChangedRow',
  'retainedBytesPerOperation',
];

function validPairedEvidence(commit) {
  const report = Object.fromEntries([
    ...pairedMetrics.map(([metric]) => [metric, 100]),
    ...byteMetrics.map((metric) => [metric, 100]),
  ]);
  const idle = {
    durationMs: 5_000,
    cpuUserUs: 0,
    cpuSystemUs: 0,
    outputBlockOperations: 0,
    residentKbBefore: 100,
    residentKbAfter: 100,
    databaseFamilyBytesBefore: 100,
    databaseFamilyBytesAfter: 100,
  };
  const rawPairs = Array.from({ length: 11 }, (_, index) => ({
    pair: index + 1,
    order: index % 2 === 0 ? 'baselineThenCandidate' : 'candidateThenBaseline',
    baseline: { ...report },
    baselineIdle: { ...idle },
    candidateActiveCovered: { ...report },
    candidateActiveCoveredIdle: { ...idle },
  }));
  return {
    schemaVersion: 'snapback.agent-safe-active-paired.v2',
    artifactName: 'agent-safe-active-covered-paired-2026-08-04',
    date: '2026-08-04',
    baseline: {
      artifactSha256: 'sha256:d28d8514f48db3f8a0e4d0c33a1381f12e4ad13eaf6a69187aef9b7fe822ab91',
    },
    candidate: {
      sourceRevision: commit,
      sourceTreeClean: true,
      buildProfile: 'release',
      activeProfile: 'serverIssuedClientRange+ordinaryMutationCoverageV1+productionEnvelopeChokePoint',
    },
    hardwareClass: {
      model: 'Mac17,3', cpu: 'Apple M5', logicalCpus: 10, memoryBytes: 34_359_738_368,
    },
    protocol: { recordedPairs: 11, warmupsPerExecutable: 1, bootstrapSamples: 20_000 },
    rawPairs,
    comparisons: pairedMetrics.map(([metric, direction, boundKind, boundPercent]) => ({
      metric,
      direction,
      boundKind,
      boundPercent,
      pairedRegressionsPercent: Array(11).fill(0),
      pairedMedianRegressionPercent: 0,
      bootstrap90PercentLower: 0,
      bootstrap90PercentUpper: 0,
      passed: true,
    })),
    byteComparisons: byteMetrics.map((metric) => ({
      metric,
      baselineValues: Array(11).fill(100),
      candidateActiveCoveredValues: Array(11).fill(100),
      baselineMedian: 100,
      candidateActiveCoveredMedian: 100,
      pairedChangePercent: Array(11).fill(0),
      thresholdStatus: 'observed; LLP 0162 registers the metric but no numeric byte bound',
    })),
    idleGates: {
      durationMs: 5_000,
      baselineCombinedCpuUs: Array(11).fill(0),
      candidateCombinedCpuUs: Array(11).fill(0),
      candidateCpuMaxObservedUs: 0,
      cpuResolutionUs: 5_000,
      cpuPassed: true,
      baselineRssBeforeKb: Array(11).fill(100),
      candidateRssBeforeKb: Array(11).fill(100),
      baselineRssMedianKb: 100,
      candidateRssMedianKb: 100,
      pairedRssRegressionsPercent: Array(11).fill(0),
      pairedRssMedianRegressionPercent: 0,
      bootstrap90PercentLower: 0,
      bootstrap90PercentUpper: 0,
      rssEquivalenceBoundPercent: 5,
      rssPassed: true,
      candidateOutputBlockOperations: Array(11).fill(0),
      candidateDatabaseFamilyByteDeltas: Array(11).fill(0),
      everyCandidateOutputBlockCountZero: true,
      everyCandidateDatabaseFamilyDeltaZero: true,
      diskPassed: true,
      passed: true,
    },
    measuredComparativeThresholdsPassed: true,
    fullRow13ProtocolQualified: false,
  };
}

function validAbsoluteEvidence(commit) {
  const rawRuns = Array.from({ length: 11 }, () => ({
    forkCreationUs: 100,
    exactDiffUs: 200,
    promotionUs: 300,
    ttlReapUs: 10,
  }));
  return {
    schemaVersion: 'snapback.fork-promotion-performance.v3',
    artifactName: 'agent-safe-fork-promotion-absolute-2026-08-04',
    date: '2026-08-04',
    sourceRevision: commit,
    sourceTreeClean: true,
    baselineArtifact: {
      sha256: 'sha256:d28d8514f48db3f8a0e4d0c33a1381f12e4ad13eaf6a69187aef9b7fe822ab91',
    },
    hardwareClass: {
      model: 'Mac17,3', cpu: 'Apple M5', logicalCpus: 10, memoryBytes: 34_359_738_368,
    },
    fixture: {
      logicalRows: 512,
      wholeRunWarmups: 1,
      perMetricWarmups: 4,
      recordedRuns: 11,
      contentionSamples: 128,
      contentionWorkers: 8,
    },
    rawRuns,
    summaryUs: {
      forkCreation: { median: 100, mad: 0, min: 100, max: 100 },
      exactDiff: { median: 200, mad: 0, min: 200, max: 200 },
      promotion: { median: 300, mad: 0, min: 300, max: 300 },
      ttlReap: { median: 10, mad: 0, min: 10, max: 10 },
    },
    contention: {
      metric: 'ordinaryWriterReservationRequestToCommitP99Us',
      reservationIntervalMs: 1_000,
      maximumPromotionCommitDurationMs: 500,
      rawRequestToCommitUs: Array(128).fill(1_000),
      deferredSampleCount: 8,
      initialDeferredWorkerCount: 8,
      p50Us: 1_000,
      p95Us: 1_000,
      p99Us: 1_000,
      maxUs: 1_000,
    },
    absoluteBounds: {
      forkCreationMedianUs: 1_000,
      exactDiffMedianUs: 2_500,
      promotionMedianUs: 7_500,
      ttlReapMedianUs: 250,
      ordinaryWriterContentionP99Us: 1_250_000,
    },
    absoluteBoundsPassed: true,
    promotionEgressScope: 'DenyAll/no-effects only; CaptureOnly intent publication and settlement are not measured',
  };
}

function fixture() {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-agent-safe-publication-'));
  for (const path of [storage.anchor, storage.carrier, storage.receipt]) {
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    cpSync(join(root, path), join(scratch, path));
  }
  return scratch;
}

test('frozen C validates both independent records as withheld', () => {
  assert.deepEqual(runChecker(root).map(({ state }) => state), ['withheld', 'withheld']);
});

test('withheld anchor cannot smuggle a carrier digest', () => {
  const scratch = fixture();
  const path = join(scratch, storage.anchor);
  const value = JSON.parse(readFileSync(path));
  value.carrierSha256 = `sha256:${'a'.repeat(64)}`;
  writeFileSync(path, JSON.stringify(value));
  assert.throws(() => validatePublicationRecord(scratch, storage), /carries authority/u);
});

test('target, evidence locator, and receipt shape tampering fail before publication', () => {
  for (const mutate of [
    (value) => { value.negativeTargetProfileIds.pop(); },
    (value) => { value.evidence[0].path = 'tests/forged.json'; },
    (value) => { value.unregistered = true; },
  ]) {
    const scratch = fixture();
    const path = join(scratch, storage.receipt);
    const value = JSON.parse(readFileSync(path));
    mutate(value);
    writeFileSync(path, JSON.stringify(value));
    assert.throws(() => validatePublicationRecord(scratch, storage));
  }
});

test('derived publication has no storage-evidence substitution path', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.throws(
    () => validatePublishedEvidenceSemantics(root, derived, head),
    /no dedicated end-to-end F0b performance evidence contract/u,
  );
});

test('paired evidence is recomputed from raw observations', () => {
  const commit = 'a'.repeat(40);
  const valid = validPairedEvidence(commit);
  validatePairedPerformanceArtifact(valid, commit);
  for (let index = 0; index < 6; index += 1) {
    valid.rawPairs[index].candidateActiveCovered.currentPointReadP50Us = 200;
  }
  assert.throws(
    () => validatePairedPerformanceArtifact(valid, commit),
    /disagrees with retained raw observations/u,
  );
});

test('paired idle gate rejects impossible raw counters', () => {
  const commit = 'c'.repeat(40);
  const invalid = validPairedEvidence(commit);
  for (const pair of invalid.rawPairs) {
    pair.candidateActiveCoveredIdle.cpuUserUs = -1;
  }
  invalid.idleGates.candidateCombinedCpuUs = Array(11).fill(-1);
  invalid.idleGates.candidateCpuMaxObservedUs = -1;
  assert.throws(
    () => validatePairedPerformanceArtifact(invalid, commit),
    /candidate idle counters are invalid/u,
  );
});

test('absolute summaries and p99 are recomputed from raw observations', () => {
  const commit = 'b'.repeat(40);
  const valid = validAbsoluteEvidence(commit);
  validateAbsolutePerformanceArtifact(valid, commit);
  valid.rawRuns[0].forkCreationUs = 2_000;
  assert.throws(
    () => validateAbsolutePerformanceArtifact(valid, commit),
    /disagrees with retained raw observations/u,
  );
  const contention = validAbsoluteEvidence(commit);
  contention.contention.rawRequestToCommitUs[0] = 2_000_000;
  contention.contention.rawRequestToCommitUs[1] = 2_000_000;
  assert.throws(
    () => validateAbsolutePerformanceArtifact(contention, commit),
    /contention p99Us disagrees with retained raw observations/u,
  );
});

test('history digest is deterministic for an immutable qualification commit', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const first = implementationDigestAt(root, head);
  const second = implementationDigestAt(root, head);
  assert.match(first, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(first, second);
});

test('P-vs-C publication path allowlist rejects executable drift', () => {
  assert.equal(allowedPublicationPath('src/local.rs'), false);
  assert.equal(allowedPublicationPath('packages/snapback-client/index.mjs'), false);
  assert.equal(
    allowedPublicationPath('src/local-agent-safe-storage-publication.anchor.json'),
    true,
  );
  assert.equal(
    allowedPublicationPath('tests/acceptance/fixtures/agent-safe-storage/author-acceptance.2026-08-04.v1.json'),
    true,
  );
  assert.equal(allowedPublicationPath('issues/20260803-wave3-program.md'), true);
  assert.equal(allowedPublicationPath('guide/operating/instance-forks.md'), true);
  assert.equal(
    allowedPublicationPath('demos/latency-kanban/snapback/trusted-composition-activation.json'),
    true,
  );
  assert.equal(
    allowedPublicationPath('tests/acceptance/fixtures/latency-kanban/move3-exit.2026-08-04.v1.json'),
    true,
  );
  assert.equal(allowedPublicationPath('guide/arbitrary-executable.mjs'), false);
});
