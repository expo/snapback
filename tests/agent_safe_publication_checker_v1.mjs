import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  allowedPublicationChange,
  allowedPublicationPath,
  generatedPublicationPathsAt,
  IMPLEMENTATION_ROOTS,
  implementationDigestAt,
  runChecker,
  validateAbsolutePerformanceArtifact,
  validatePairedPerformanceArtifact,
  validatePublishedEvidenceSemantics,
  validatePublicationRecord,
} from '../scripts/check-agent-safe-publication.mjs';
import {
  ADMIN_GENERATED_ROOTS,
  CODEGEN_JOBS,
  FULLY_COMMITTED_ROOTS,
  REVIEW_CACHE_ROOTS,
  codegenOutputRoot,
} from '../scripts/generated-artifact-policy.mjs';

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
  ['currentPointReadP50Us', 'current_point_read_p50_us', 'higherIsWorse', 'twoSidedEquivalence', 5],
  ['currentPointReadP95Us', 'current_point_read_p95_us', 'higherIsWorse', 'twoSidedEquivalence', 5],
  ['currentRangeReadP50Us', 'current_range_read_p50_us', 'higherIsWorse', 'twoSidedEquivalence', 5],
  ['currentRangeReadP95Us', 'current_range_read_p95_us', 'higherIsWorse', 'twoSidedEquivalence', 5],
  ['currentQueryPlanReadP50Us', 'current_query_plan_read_p50_us', 'higherIsWorse', 'twoSidedEquivalence', 5],
  ['currentQueryPlanReadP95Us', 'current_query_plan_read_p95_us', 'higherIsWorse', 'twoSidedEquivalence', 5],
  ['singleWriterMutationsPerSec', 'single_writer_mutations_per_sec', 'lowerIsWorse', 'oneSidedRegression', 15],
  ['singleWriterMutationP50Us', 'single_writer_mutation_p50_us', 'higherIsWorse', 'oneSidedRegression', 15],
  ['singleWriterMutationP95Us', 'single_writer_mutation_p95_us', 'higherIsWorse', 'oneSidedRegression', 15],
];
const byteMetrics = [
  ['allocatedWriteBytesPerChangedRow', 'allocated_write_bytes_per_changed_row'],
  ['allocatedWriteBytesPerOperation', 'allocated_write_bytes_per_operation'],
  ['retainedBytesPerChangedRow', 'retained_bytes_per_changed_row'],
  ['retainedBytesPerOperation', 'retained_bytes_per_operation'],
];

function validPairedEvidence(commit) {
  const report = Object.fromEntries([
    ...pairedMetrics.map(([, rawMetric]) => [rawMetric, 100]),
    ...byteMetrics.map(([, rawMetric]) => [rawMetric, 100]),
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
      artifactName: 'agent-safe-step0-pre-profile-2026-08-03',
      artifactSchemaVersion: 'snapback.agent-safe-step0-baseline.v1',
      artifactSha256: 'sha256:d28d8514f48db3f8a0e4d0c33a1381f12e4ad13eaf6a69187aef9b7fe822ab91',
      sourceRevision: '2ab36e28c74c450213b65f17ef81c0d6652ba33a',
      buildProvenanceSha256: 'sha256:84e288661c3edf5dfaec3690f2fe00335d251d046ac187439ffae37fe9c65991',
      sourceRootCargoLockSha256: 'sha256:496569d9a3cb87609b6e79974f69126dbaccba53eb71d093f5dcf090fe1a36b1',
      externalWorkerCargoLockSha256: 'sha256:05bd0af1ed649011354f091e2cd371f38aaf5c229437c6a98b4807c7d0eead3d',
      executableSha256: 'sha256:b78089dadd8b4966b20eb847d576ed9cd59dbaa96143c81a2c4a8b0a684c0bb8',
    },
    candidate: {
      sourceRevision: commit,
      sourceTreeClean: true,
      executableSha256: `sha256:${'a'.repeat(64)}`,
      buildProfile: 'release',
      activeProfile: 'serverIssuedClientRange+ordinaryMutationCoverageV1+productionEnvelopeChokePoint',
    },
    hardwareClass: {
      os: '26.5.2', architecture: 'aarch64', model: 'Mac17,3', cpu: 'Apple M5',
      logicalCpus: 10, memoryBytes: 34_359_738_368,
    },
    toolchain: {
      rustc: 'rustc 1.97.0 (2d8144b78 2026-07-07)',
      cargo: 'cargo 1.97.0 (c980f4866 2026-06-30)',
    },
    protocol: {
      warmupsPerExecutable: 1,
      recordedPairs: 11,
      pairOrder: 'AB/BA alternating by zero-based pair parity',
      estimator: 'median of 11 time-local paired regression percentages',
      confidenceInterval: 'deterministic bootstrap 90% interval over paired medians; interval must lie wholly inside the registered bound',
      bootstrapSamples: 20_000,
      bootstrapSeed: 'snapback-agent-safe-active-paired-v2/2026-08-04',
      quiescenceRule: 'direct release binary refuses unless no cargo or rustc process exists',
      baselineWorkerProtocol: 'external digest-bound wrapper and lockfile path-linked to the exact pre-profile tree; original baseline product posture remains exactly three instrumentation paths',
      candidateWorkerProtocol: 'same release executable: --active-covered-worker records active-covered read/write metrics; a fresh --active-covered-idle-worker first runs the dormant comparator workload, then holds the armed storage connection and server-issued range across the five-second idle observation',
    },
    rawPairs,
    comparisons: pairedMetrics.map(([
      metric, , direction, boundKind, boundPercent,
    ]) => ({
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
    byteComparisons: byteMetrics.map(([metric]) => ({
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
  const liveCarrier = JSON.parse(readFileSync(join(root, storage.carrier)));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const revision = /^[0-9a-f]{40}$/u.test(liveCarrier.qualifiedSourceCommit)
      && liveCarrier.qualifiedSourceCommit !== '0'.repeat(40)
    ? liveCarrier.qualifiedSourceCommit
    : head;
  for (const record of [storage, derived]) {
    for (const path of [record.anchor, record.carrier, record.receipt]) {
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(
        join(scratch, path),
        execFileSync('git', ['show', `${revision}:${path}`], { cwd: root }),
      );
    }
  }
  return scratch;
}

test('frozen C validates both independent records as withheld', () => {
  const scratch = fixture();
  assert.deepEqual(
    [storage, derived].map((record) => validatePublicationRecord(scratch, record).state),
    ['withheld', 'withheld'],
  );
  const live = runChecker(root);
  assert.equal(live[1].state, 'withheld');
  if (live[0].state === 'published') {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    assert.notEqual(live[0].commit, head, 'publication P must be later than qualification C');
  }
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
    valid.rawPairs[index].candidateActiveCovered.current_point_read_p50_us = 200;
  }
  assert.throws(
    () => validatePairedPerformanceArtifact(valid, commit),
    /disagrees with retained raw observations/u,
  );
});

test('paired raw reports reject camelCase metric aliases', () => {
  const commit = 'd'.repeat(40);
  const invalid = validPairedEvidence(commit);
  for (const pair of invalid.rawPairs) {
    for (const report of [pair.baseline, pair.candidateActiveCovered]) {
      report.currentPointReadP50Us = report.current_point_read_p50_us;
      delete report.current_point_read_p50_us;
    }
  }
  assert.throws(
    () => validatePairedPerformanceArtifact(invalid, commit),
    /paired raw metric currentPointReadP50Us is invalid/u,
  );
});

test('paired raw reports reject camelCase byte aliases', () => {
  const commit = 'e'.repeat(40);
  const invalid = validPairedEvidence(commit);
  for (const pair of invalid.rawPairs) {
    for (const report of [pair.baseline, pair.candidateActiveCovered]) {
      report.allocatedWriteBytesPerChangedRow = report.allocated_write_bytes_per_changed_row;
      delete report.allocated_write_bytes_per_changed_row;
    }
  }
  assert.throws(
    () => validatePairedPerformanceArtifact(invalid, commit),
    /allocatedWriteBytesPerChangedRow byte observation identity\/value drifted/u,
  );
});

test('paired evidence rejects the old or missing candidate worker protocol', () => {
  const commit = 'f'.repeat(40);
  for (const protocol of [
    undefined,
    'same executable --active-covered-worker on fresh active-covered mutation and idle fixtures per observation',
  ]) {
    const invalid = validPairedEvidence(commit);
    if (protocol === undefined) delete invalid.protocol.candidateWorkerProtocol;
    else invalid.protocol.candidateWorkerProtocol = protocol;
    assert.throws(
      () => validatePairedPerformanceArtifact(invalid, commit),
      /paired protocol identity drifted/u,
    );
  }
});

test('paired evidence binds Air, toolchain, and candidate executable identities', () => {
  const commit = '1'.repeat(40);
  const mutations = [
    (value) => { delete value.hardwareClass.os; },
    (value) => { value.hardwareClass.architecture = 'x86_64'; },
    (value) => { delete value.toolchain.rustc; },
    (value) => { value.candidate.executableSha256 = `sha256:${'0'.repeat(64)}`; },
  ];
  for (const mutate of mutations) {
    const invalid = validPairedEvidence(commit);
    mutate(invalid);
    assert.throws(() => validatePairedPerformanceArtifact(invalid, commit));
  }
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

test('build and checker bind the shared generated-artifact policy', () => {
  assert.ok(IMPLEMENTATION_ROOTS.includes('scripts/check-agent-safe-publication.mjs'));
  assert.ok(IMPLEMENTATION_ROOTS.includes('scripts/generated-artifact-policy.mjs'));
  const build = readFileSync(join(root, 'build.rs'), 'utf8');
  for (const path of IMPLEMENTATION_ROOTS) {
    assert.ok(build.includes(`"${path}"`), `build digest omits ${path}`);
  }
  assert.ok(build.includes(
    'cargo:rerun-if-changed=scripts/generated-artifact-policy.mjs',
  ));
  assert.equal(allowedPublicationPath('scripts/generated-artifact-policy.mjs'), false);
  assert.equal(allowedPublicationPath('scripts/check-generated-artifacts'), false);
});

test('generated-artifact registry covers every codegen job exactly once', () => {
  const jobs = CODEGEN_JOBS.map(codegenOutputRoot).sort();
  const policies = [...REVIEW_CACHE_ROOTS, ...FULLY_COMMITTED_ROOTS].sort();
  assert.deepEqual(jobs, policies);
  assert.equal(new Set(jobs).size, jobs.length);
  assert.ok(REVIEW_CACHE_ROOTS.includes('demos/party-wall/snapback/generated'));
  assert.deepEqual(ADMIN_GENERATED_ROOTS, ['admin-ui/generated']);
});

test('P-vs-C generated allowance is the exact qualification-C leaf set', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const generated = generatedPublicationPathsAt(root, head);
  assert.equal(generated.size, 175);
  const unchangedPublicationEntries = new Map(
    [...generated].map(([path, entry]) => [path, { ...entry }]),
  );
  for (const path of generated.keys()) {
    assert.equal(allowedPublicationPath(path, generated), true, path);
    assert.equal(allowedPublicationChange(
      { status: 'M', path }, generated, unchangedPublicationEntries,
    ), true, path);
  }
  for (const path of [
    'demos/party-wall/snapback/generated/artifacts.json',
    'demos/competitive-checkpoint/snapback/generated/api.d.ts',
    'demos/competitive-checkpoint/snapback/generated/api.mjs',
    'demos/partiful-matrix/snapback/generated/api.mjs',
    'demos/team-chat/snapback/generated/artifacts.json',
    'packages/snapback-cli/fixtures/comparator/app/snapback/generated/api.mjs',
    'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/api.mjs',
    'admin-ui/generated/contract/runtime-links.ts',
  ]) {
    assert.equal(allowedPublicationPath(path, generated), true, path);
  }
  for (const path of [
    'demos/todo/snapback/generated/api.mjs',
    'demos/todo/snapback/generated/evil.mjs',
    'demos/todo/snapback/generatedness/artifacts.json',
    'demos/todo/snapback/generated-evil/artifacts.json',
    'demos/todo/.snapback/codegen-cache/forged/api.mjs',
    'demos/chirp/snapback/generated/artifacts.json',
    'demos/todo/snapback/schema.ts',
    'packages/snapback-cli/index.mjs',
    'packages/snapback-cli/fixtures/comparator/app/snapback/generated/evil.mjs',
    'admin-ui/generated/contract/evil.ts',
  ]) {
    assert.equal(allowedPublicationPath(path, generated), false, path);
  }

  const generatedPath = 'demos/todo/snapback/generated/artifacts.json';
  const expected = generated.get(generatedPath);
  const sameMode = new Map([[generatedPath, { ...expected }]]);
  assert.equal(allowedPublicationChange(
    { status: 'M', path: generatedPath }, generated, sameMode,
  ), true);
  for (const status of ['A', 'D', 'R100', 'T']) {
    assert.equal(allowedPublicationChange(
      { status, path: generatedPath }, generated, sameMode,
    ), false, status);
  }
  assert.equal(allowedPublicationChange(
    { status: 'M', path: generatedPath },
    generated,
    new Map([[generatedPath, { mode: '120000', type: 'blob' }]]),
  ), false);
  // A P manifest cannot widen this set: only paths frozen from C are queried.
  assert.equal(generated.has('demos/todo/snapback/generated/evil.mjs'), false);
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
