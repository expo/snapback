import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import nodeTest from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  allowedPublicationChange,
  allowedPublicationPath,
  exactCandidate,
  generatedPublicationPathsAt,
  generatedPublicationPathsOnDisk,
  IMPLEMENTATION_ROOTS,
  implementationDigestAt,
  expectedLocalStorePublicationTransform,
  LOCAL_STORE_PUBLICATION_TRANSFORM,
  PUBLICATION_CYCLE_ALLOWLIST,
  runChecker,
  validateAbsolutePerformanceArtifact,
  validatePairedPerformanceArtifact,
  validatePublicationRecord,
  validateLocalStorePublicationTransform,
} from '../scripts/check-agent-safe-publication.mjs';
import {
  ADMIN_GENERATED_ROOTS,
  CODEGEN_JOBS,
  FULLY_COMMITTED_ROOTS,
  REVIEW_CACHE_ROOTS,
  codegenOutputRoot,
} from '../scripts/generated-artifact-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const leafSetOnly = invoked && process.argv.includes('--leaf-set-only');
const test = invoked && !leafSetOnly ? nodeTest : () => {};
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
  const rawPairs = Array.from({ length: 11 }, (_, pairIndex) => {
    const orders = pairIndex % 2 === 0
      ? ['baselineThenCandidate', 'candidateThenBaseline', 'baselineThenCandidate']
      : ['candidateThenBaseline', 'baselineThenCandidate', 'candidateThenBaseline'];
    return {
      pair: pairIndex + 1,
      orderSequence: pairIndex % 2 === 0 ? 'AB/BA/AB' : 'BA/AB/BA',
      rawSubpairs: orders.map((order, subpairIndex) => ({
        subpair: subpairIndex + 1,
        order,
        baselineWorkerProtocol: 'agentSafeDormantBaselineWorkerV1',
        candidateActiveCoveredWorkerProtocol: 'agentSafeActiveCoveredWorkerV3',
        baseline: { ...report },
        baselineIdle: { ...idle },
        candidateActiveCovered: { ...report },
        candidateActiveCoveredIdle: { ...idle },
      })),
    };
  });
  return {
    schemaVersion: 'snapback.agent-safe-active-paired.v3',
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
      rawSubpairsPerRecordedPair: 3,
      pairOrder: 'even zero-based outer pairs AB/BA/AB; odd zero-based outer pairs BA/AB/BA',
      estimator: 'compute each raw subpair regression, take the median of three within each of 11 outer pairs, then take the median of the 11 outer values',
      confidenceInterval: 'deterministic bootstrap 90% interval over 11 outer median-of-three regressions; interval must lie wholly inside the registered bound',
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
      baselineCombinedCpuUs: Array(33).fill(0),
      candidateCombinedCpuUs: Array(33).fill(0),
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
      candidateOutputBlockOperations: Array(33).fill(0),
      candidateDatabaseFamilyByteDeltas: Array(33).fill(0),
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
        revision === head
          ? readFileSync(join(root, path))
          : execFileSync('git', ['show', `${revision}:${path}`], { cwd: root }),
      );
    }
  }
  return scratch;
}

const derivedEvidence = [
  ['lifecycleBenchMacos', 'tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json'],
  ['lifecycleBenchLinux', 'tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.linux-x86_64.v1.json'],
  ['boundsRatification', 'tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.v1.json'],
  ['assetLifecycleEvidence', 'tests/acceptance/asset-lifecycle-v1-evidence.md'],
  ['specReviewCodex', 'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.codex.md'],
  ['specReviewFable', 'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.fable.md'],
  ['implementationReviewCodex', 'llp/reviews/0158-instance-forking.implementation-2026-08-06.codex.md'],
  ['implementationReviewFable', 'llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.md'],
  ['authorAcceptance', 'tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-06.v1.json'],
];

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function writeJson(rootPath, path, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  mkdirSync(dirname(join(rootPath, path)), { recursive: true });
  writeFileSync(join(rootPath, path), bytes);
  return bytes;
}

function publishedDerivedFixture({
  omitReview,
  omitAuthor = false,
  zeroAuthorDigest = false,
  mutateMacos,
} = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-derived-fork-publication-'));
  execFileSync('git', ['init', '--quiet'], { cwd: scratch });
  execFileSync('git', ['config', 'user.name', 'Snapback Test'], { cwd: scratch });
  execFileSync('git', ['config', 'user.email', 'snapback-test@example.invalid'], { cwd: scratch });
  mkdirSync(join(scratch, 'src'), { recursive: true });
  writeFileSync(join(scratch, 'src/qualification-marker.txt'), 'derived-fork qualification C\n');
  execFileSync('git', ['add', 'src/qualification-marker.txt'], { cwd: scratch });
  const ibexGitlink = execFileSync('git', ['rev-parse', 'HEAD:vendor/ibex'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  execFileSync('git', [
    'update-index', '--add', '--cacheinfo', `160000,${ibexGitlink},vendor/ibex`,
  ], { cwd: scratch });
  execFileSync('git', ['commit', '--quiet', '-m', 'qualification C'], { cwd: scratch });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: scratch,
    encoding: 'utf8',
  }).trim();
  const implementationTree = implementationDigestAt(scratch, commit);

  const bindings = [];
  for (const [kind, path] of derivedEvidence.slice(0, -1)) {
    let bytes;
    if (kind === 'lifecycleBenchMacos' || kind === 'lifecycleBenchLinux'
        || kind === 'boundsRatification') {
      const value = JSON.parse(readFileSync(join(root, path)));
      value.environment.commit = commit;
      if (kind === 'lifecycleBenchMacos') mutateMacos?.(value);
      bytes = writeJson(scratch, path, value);
    } else if (kind === 'assetLifecycleEvidence') {
      bytes = readFileSync(join(root, path));
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(join(scratch, path), bytes);
    } else {
      const family = kind.endsWith('Codex') ? 'OpenAI Codex' : 'Claude Fable';
      bytes = Buffer.from([
        `# ${kind}`,
        `**Reviewer family:** ${family}`,
        '**Provider / runtime:** checker self-test',
        '**Date:** 2026-08-06',
        '**Redacted:** no',
        '**Method:** cli-runner',
        '**Verdict:** READY',
        '',
      ].join('\n'));
      if (path !== omitReview) {
        mkdirSync(dirname(join(scratch, path)), { recursive: true });
        writeFileSync(join(scratch, path), bytes);
      }
    }
    bindings.push({
      kind,
      path,
      sha256: path === omitReview ? `sha256:${'d'.repeat(64)}` : digest(bytes),
    });
  }

  const candidateFacts = exactCandidate(derived.id);
  const candidateFactsSha256 = digest(Buffer.from(JSON.stringify(candidateFacts)));
  const acceptance = {
    schemaVersion: 'snapback.derived-fork-author-acceptance.v1',
    capabilityId: derived.id,
    accepted: true,
    authorLine: 'Charlie Cheever — accepted 2026-08-06',
    qualifiedSourceCommit: commit,
    implementationTreeSha256: implementationTree,
    candidateFactsSha256,
    qualifiedComponents: [...derived.components],
    evidenceSha256: Object.fromEntries(bindings.map(({ kind, sha256 }) => [kind, sha256])),
  };
  const [authorKind, authorPath] = derivedEvidence.at(-1);
  const authorBytes = writeJson(scratch, authorPath, acceptance);
  if (omitAuthor) unlinkSync(join(scratch, authorPath));
  bindings.push({
    kind: authorKind,
    path: authorPath,
    sha256: zeroAuthorDigest ? `sha256:${'0'.repeat(64)}` : digest(authorBytes),
  });

  const receipt = {
    schemaVersion: 'snapback.agent-safe-publication-receipt.v1',
    capabilityId: derived.id,
    qualifiedSourceCommit: commit,
    implementationTreeSha256: implementationTree,
    candidateFactsSha256,
    qualifiedTargetProfileId: 'local-dev-sqlite-ibex',
    negativeTargetProfileIds: ['cloudflare-do-sqlite-v8', 'remote-service-sqlite-ibex'],
    negativeBuildDistributions: ['public-package'],
    qualifiedComponents: [...derived.components],
    evidence: bindings,
  };
  const receiptBytes = writeJson(scratch, derived.receipt, receipt);
  const carrier = {
    schemaVersion: 'snapback.local-agent-safe-publication.v1',
    capabilityId: derived.id,
    targetProfileId: 'local-dev-sqlite-ibex',
    maturity: 'experimental',
    qualifiedSourceCommit: commit,
    implementationTreeSha256: implementationTree,
    candidateFactsSha256,
    qualificationReceiptSha256: digest(receiptBytes),
    buildProvenanceRequirement: 'known-clean-contributor-source',
    candidateFacts,
  };
  const carrierBytes = writeJson(scratch, derived.carrier, carrier);
  writeJson(scratch, derived.anchor, {
    schemaVersion: 'snapback.local-capability-publication-anchor.v1',
    capabilityId: derived.id,
    state: 'published',
    carrierSha256: digest(carrierBytes),
  });
  return scratch;
}

const localStoreTransformPaths = [
  LOCAL_STORE_PUBLICATION_TRANSFORM.anchor,
  LOCAL_STORE_PUBLICATION_TRANSFORM.carrier,
  ...LOCAL_STORE_PUBLICATION_TRANSFORM.receipts.map(({ path }) => path),
];

function localStoreTransformFixture() {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-local-store-publication-transform-'));
  for (const path of localStoreTransformPaths) {
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    writeFileSync(join(scratch, path), readFileSync(join(root, path)));
  }
  execFileSync('git', ['init', '--quiet'], { cwd: scratch });
  execFileSync('git', ['config', 'user.name', 'Snapback Test'], { cwd: scratch });
  execFileSync('git', ['config', 'user.email', 'snapback-test@example.invalid'], { cwd: scratch });
  execFileSync('git', ['add', '.'], { cwd: scratch });
  execFileSync('git', ['commit', '--quiet', '-m', 'qualification C'], { cwd: scratch });
  const qualification = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: scratch,
    encoding: 'utf8',
  }).trim();
  for (const { path } of LOCAL_STORE_PUBLICATION_TRANSFORM.receipts) {
    writeFileSync(join(scratch, path), Buffer.concat([
      readFileSync(join(scratch, path)),
      Buffer.from(' '),
    ]));
  }
  const expected = expectedLocalStorePublicationTransform(scratch, qualification);
  for (const [path, bytes] of expected) writeFileSync(join(scratch, path), bytes);
  return { scratch, qualification };
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

test('derived receipt rejects storage-evidence substitution while withheld', () => {
  const scratch = fixture();
  const path = join(scratch, derived.receipt);
  const value = JSON.parse(readFileSync(path));
  value.evidence[0] = {
    kind: 'acceptanceCorpus',
    path: 'tests/acceptance/fixtures/agent-safe-storage/acceptance-corpus.2026-08-04.v1.json',
    sha256: `sha256:${'0'.repeat(64)}`,
  };
  writeFileSync(path, JSON.stringify(value));
  assert.throws(() => validatePublicationRecord(scratch, derived), /evidence 0 drifted/u);
});

test('published derived-fork chain accepts its exact dedicated witness', () => {
  const scratch = publishedDerivedFixture();
  assert.equal(validatePublicationRecord(scratch, derived).state, 'published');
});

test('published derived-fork chain refuses a missing review', () => {
  const scratch = publishedDerivedFixture({
    omitReview: 'llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.md',
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /evidence bytes drifted.*implementation-2026-08-06\.fable\.md/u,
  );
});

test('published derived-fork chain refuses zero or missing author acceptance', () => {
  assert.throws(
    () => validatePublicationRecord(publishedDerivedFixture({ zeroAuthorDigest: true }), derived),
    /evidence 8 drifted/u,
  );
  assert.throws(
    () => validatePublicationRecord(publishedDerivedFixture({ omitAuthor: true }), derived),
    /evidence bytes drifted.*author-acceptance\.2026-08-06\.v1\.json/u,
  );
});

test('published derived-fork chain refuses an out-of-bounds lifecycle median', () => {
  const scratch = publishedDerivedFixture({
    mutateMacos: (value) => {
      value.measurements.createColdSmallParent.medianMs = 2_001;
      value.measurements.createColdSmallParent.maxMs = 2_001;
      value.measurements.sequentialCreateMedianMs = 2_001;
    },
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /median\/statistics exceeded or drifted from ratified bounds/u,
  );
});

test('published derived-fork chain refuses a mismatched benchmark commit', () => {
  const scratch = publishedDerivedFixture({
    mutateMacos: (value) => { value.environment.commit = 'f'.repeat(40); },
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /environment\/qualified commit drifted/u,
  );
});

test('paired evidence is recomputed from raw observations', () => {
  const commit = 'a'.repeat(40);
  const valid = validPairedEvidence(commit);
  validatePairedPerformanceArtifact(valid, commit);
  for (let index = 0; index < 6; index += 1) {
    for (let subpair = 0; subpair < 2; subpair += 1) {
      valid.rawPairs[index].rawSubpairs[subpair]
        .candidateActiveCovered.current_point_read_p50_us = 200;
    }
  }
  assert.throws(
    () => validatePairedPerformanceArtifact(valid, commit),
    /disagrees with retained raw observations/u,
  );
});

test('paired evidence rejects legacy v2 and missing or reordered raw subpairs', () => {
  const commit = '2'.repeat(40);
  const mutations = [
    (value) => { value.schemaVersion = 'snapback.agent-safe-active-paired.v2'; },
    (value) => { value.rawPairs[0].rawSubpairs.pop(); },
    (value) => { value.rawPairs[0].rawSubpairs.reverse(); },
    (value) => { value.rawPairs[1].orderSequence = 'AB/BA/AB'; },
    (value) => { delete value.rawPairs[0].rawSubpairs[0].candidateActiveCovered; },
    (value) => { delete value.rawPairs[0].rawSubpairs[0].baselineWorkerProtocol; },
    (value) => {
      value.rawPairs[0].rawSubpairs[0].candidateActiveCoveredWorkerProtocol
        = 'agentSafeActiveCoveredWorkerV2';
    },
  ];
  for (const mutate of mutations) {
    const invalid = validPairedEvidence(commit);
    mutate(invalid);
    assert.throws(() => validatePairedPerformanceArtifact(invalid, commit));
  }
});

test('paired outer summaries use the median of all three raw subpair ratios', () => {
  const commit = '3'.repeat(40);
  const valid = validPairedEvidence(commit);
  valid.rawPairs[0].rawSubpairs[0]
    .candidateActiveCovered.current_point_read_p50_us = 1_000;
  validatePairedPerformanceArtifact(valid, commit);

  valid.rawPairs[0].rawSubpairs[1]
    .candidateActiveCovered.current_point_read_p50_us = 1_000;
  assert.throws(
    () => validatePairedPerformanceArtifact(valid, commit),
    /disagrees with retained raw observations/u,
  );
});

test('paired byte and RSS summaries independently use raw median-of-three values', () => {
  const commit = '6'.repeat(40);
  const bytes = validPairedEvidence(commit);
  bytes.rawPairs[0].rawSubpairs[0]
    .candidateActiveCovered.allocated_write_bytes_per_changed_row = 1_000;
  validatePairedPerformanceArtifact(bytes, commit);
  bytes.rawPairs[0].rawSubpairs[1]
    .candidateActiveCovered.allocated_write_bytes_per_changed_row = 1_000;
  assert.throws(
    () => validatePairedPerformanceArtifact(bytes, commit),
    /byte observations disagree with raw pairs/u,
  );

  const rss = validPairedEvidence(commit);
  rss.rawPairs[0].rawSubpairs[0].candidateActiveCoveredIdle.residentKbBefore = 1_000;
  validatePairedPerformanceArtifact(rss, commit);
  rss.rawPairs[0].rawSubpairs[1].candidateActiveCoveredIdle.residentKbBefore = 1_000;
  assert.throws(
    () => validatePairedPerformanceArtifact(rss, commit),
    /disagrees with retained raw observations/u,
  );
});

test('paired raw reports reject camelCase metric aliases', () => {
  const commit = 'd'.repeat(40);
  const invalid = validPairedEvidence(commit);
  for (const pair of invalid.rawPairs) {
    for (const subpair of pair.rawSubpairs) {
      for (const report of [subpair.baseline, subpair.candidateActiveCovered]) {
        report.currentPointReadP50Us = report.current_point_read_p50_us;
        delete report.current_point_read_p50_us;
      }
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
    for (const subpair of pair.rawSubpairs) {
      for (const report of [subpair.baseline, subpair.candidateActiveCovered]) {
        report.allocatedWriteBytesPerChangedRow = report.allocated_write_bytes_per_changed_row;
        delete report.allocated_write_bytes_per_changed_row;
      }
    }
  }
  assert.throws(
    () => validatePairedPerformanceArtifact(invalid, commit),
    /allocatedWriteBytesPerChangedRow byte observation identity\/value drifted/u,
  );
});

test('paired byte summaries reject a truncated outer population', () => {
  const commit = '7'.repeat(40);
  const invalid = validPairedEvidence(commit);
  invalid.byteComparisons[0].pairedChangePercent.pop();
  assert.throws(
    () => validatePairedPerformanceArtifact(invalid, commit),
    /paired change population drifted/u,
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

test('paired evidence rejects a forged median-of-three protocol', () => {
  const commit = '4'.repeat(40);
  const mutations = [
    (value) => { delete value.protocol.rawSubpairsPerRecordedPair; },
    (value) => { value.protocol.rawSubpairsPerRecordedPair = 1; },
    (value) => { value.protocol.pairOrder = 'AB/BA alternating by zero-based pair parity'; },
    (value) => { value.protocol.estimator = 'median of 11 time-local paired regression percentages'; },
  ];
  for (const mutate of mutations) {
    const invalid = validPairedEvidence(commit);
    mutate(invalid);
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
    for (const subpair of pair.rawSubpairs) {
      subpair.candidateActiveCoveredIdle.cpuUserUs = -1;
    }
  }
  invalid.idleGates.candidateCombinedCpuUs = Array(33).fill(-1);
  invalid.idleGates.candidateCpuMaxObservedUs = -1;
  assert.throws(
    () => validatePairedPerformanceArtifact(invalid, commit),
    /candidate idle counters are invalid/u,
  );
});

test('paired idle gates inspect every raw candidate, not just outer medians', () => {
  const commit = '5'.repeat(40);
  for (const mutate of [
    (subpair) => { subpair.candidateActiveCoveredIdle.cpuUserUs = 5_001; },
    (subpair) => { subpair.candidateActiveCoveredIdle.outputBlockOperations = 1; },
    (subpair) => { subpair.candidateActiveCoveredIdle.databaseFamilyBytesAfter = 101; },
  ]) {
    const invalid = validPairedEvidence(commit);
    mutate(invalid.rawPairs[0].rawSubpairs[0]);
    assert.throws(() => validatePairedPerformanceArtifact(invalid, commit));
  }
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
  for (const path of PUBLICATION_CYCLE_ALLOWLIST) {
    if (!IMPLEMENTATION_ROOTS.some((rootPath) => (
      path === rootPath || path.startsWith(`${rootPath}/`)
    ))) continue;
    assert.ok(build.includes(`"${path}"`), `build cycle exclusions omit ${path}`);
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
  assert.ok(REVIEW_CACHE_ROOTS.includes('demos/triage-graph/snapback/generated'));
  assert.ok(REVIEW_CACHE_ROOTS.includes('demos/chirp/snapback/generated'));
  assert.ok(FULLY_COMMITTED_ROOTS.includes(
    'demos/zero-bakeoff/apps/contention-calendar/snapback/generated',
  ));
  assert.deepEqual(ADMIN_GENERATED_ROOTS, ['admin-ui/generated']);
});

const CONTENT_ADDRESSED_GENERATED_ROOTS = new Set(CODEGEN_JOBS.map(codegenOutputRoot));
const CONTENT_ADDRESSED_APP_BINDING = /^app\.binding\.[0-9a-f]{64}\.mjs$/u;
const CONTENT_ADDRESSED_APP_DESCRIPTOR = /^app\.descriptor\.[0-9a-f]{64}\.json$/u;

function isRegisteredContentAddressedGeneratedLeaf(path) {
  const separator = path.lastIndexOf('/');
  if (separator === -1) return false;
  return CONTENT_ADDRESSED_GENERATED_ROOTS.has(path.slice(0, separator))
    && (
      CONTENT_ADDRESSED_APP_BINDING.test(path.slice(separator + 1))
      || CONTENT_ADDRESSED_APP_DESCRIPTOR.test(path.slice(separator + 1))
    );
}

const REVIEWED_GENERATED_PUBLICATION_PATHS = new Set([
  // BEGIN GENERATED PUBLICATION LEAF SET
  'admin-ui/generated/contract/activateNetworkProfile.mutation.contract-meta.ts',
  'admin-ui/generated/contract/activateNetworkProfile.mutation.ts',
  'admin-ui/generated/contract/cleanup.mutation.contract-meta.ts',
  'admin-ui/generated/contract/cleanup.mutation.ts',
  'admin-ui/generated/contract/errorDetail.query.contract-meta.ts',
  'admin-ui/generated/contract/errorDetail.query.ts',
  'admin-ui/generated/contract/errorIssues.query.contract-meta.ts',
  'admin-ui/generated/contract/errorIssues.query.ts',
  'admin-ui/generated/contract/guidePage.query.contract-meta.ts',
  'admin-ui/generated/contract/guidePage.query.ts',
  'admin-ui/generated/contract/inspect.query.contract-meta.ts',
  'admin-ui/generated/contract/inspect.query.ts',
  'admin-ui/generated/contract/loadErrorDetail.mutation.contract-meta.ts',
  'admin-ui/generated/contract/loadErrorDetail.mutation.ts',
  'admin-ui/generated/contract/loadGuidePage.mutation.contract-meta.ts',
  'admin-ui/generated/contract/loadGuidePage.mutation.ts',
  'admin-ui/generated/contract/loadOlderTelemetryLogs.mutation.contract-meta.ts',
  'admin-ui/generated/contract/loadOlderTelemetryLogs.mutation.ts',
  'admin-ui/generated/contract/loadTable.mutation.contract-meta.ts',
  'admin-ui/generated/contract/loadTable.mutation.ts',
  'admin-ui/generated/contract/loadTelemetryLogs.mutation.contract-meta.ts',
  'admin-ui/generated/contract/loadTelemetryLogs.mutation.ts',
  'admin-ui/generated/contract/networkProfile.query.contract-meta.ts',
  'admin-ui/generated/contract/networkProfile.query.ts',
  'admin-ui/generated/contract/refresh.mutation.contract-meta.ts',
  'admin-ui/generated/contract/refresh.mutation.ts',
  'admin-ui/generated/contract/refreshTelemetry.mutation.contract-meta.ts',
  'admin-ui/generated/contract/refreshTelemetry.mutation.ts',
  'admin-ui/generated/contract/runFunction.mutation.contract-meta.ts',
  'admin-ui/generated/contract/runFunction.mutation.ts',
  'admin-ui/generated/contract/runResult.query.contract-meta.ts',
  'admin-ui/generated/contract/runResult.query.ts',
  'admin-ui/generated/contract/runtime-links.ts',
  'admin-ui/generated/contract/tableScan.query.contract-meta.ts',
  'admin-ui/generated/contract/tableScan.query.ts',
  'admin-ui/generated/contract/telemetryLogs.query.contract-meta.ts',
  'admin-ui/generated/contract/telemetryLogs.query.ts',
  'admin-ui/generated/contract/transitionError.mutation.contract-meta.ts',
  'admin-ui/generated/contract/transitionError.mutation.ts',
  'admin-ui/generated/contract/verifyConfig.mutation.contract-meta.ts',
  'admin-ui/generated/contract/verifyConfig.mutation.ts',
  'demos/access-desk/snapback/generated/artifacts.json',
  'demos/all-aboard/snapback/generated/artifacts.json',
  'demos/all-aboard/tests/egress-probe/generated/artifacts.json',
  'demos/campfire/snapback/generated/artifacts.json',
  'demos/card-game/snapback/generated/artifacts.json',
  'demos/catalog-lens/snapback/generated/artifacts.json',
  'demos/chirp/snapback/generated/artifacts.json',
  'demos/competitive-checkpoint/snapback/generated/api.d.ts',
  'demos/competitive-checkpoint/snapback/generated/api.mjs',
  'demos/competitive-checkpoint/snapback/generated/artifacts.json',
  'demos/cursors-web/snapback/generated/artifacts.json',
  'demos/dispatch-board/snapback/generated/artifacts.json',
  'demos/file-drop/snapback/generated/artifacts.json',
  'demos/fleet-observatory-move1/snapback/generated/artifacts.json',
  'demos/graffiti/snapback/generated/artifacts.json',
  'demos/latency-kanban/snapback/generated/artifacts.json',
  'demos/messaging-snapback/snapback/generated/artifacts.json',
  'demos/partiful-matrix/snapback/generated/api.mjs',
  'demos/partiful-matrix/snapback/generated/artifacts.json',
  'demos/party-wall/snapback/generated/artifacts.json',
  'demos/public-dashboard/snapback/generated/artifacts.json',
  'demos/pulse-monitor/snapback/generated/artifacts.json',
  'demos/rbac/snapback/generated/artifacts.json',
  'demos/shindig/snapback/generated/artifacts.json',
  'demos/signal-desk/snapback/generated/artifacts.json',
  'demos/team-chat/snapback/generated/api.d.ts',
  'demos/team-chat/snapback/generated/api.mjs',
  'demos/team-chat/snapback/generated/app.binding.mjs',
  'demos/team-chat/snapback/generated/app.d.ts',
  'demos/team-chat/snapback/generated/app.descriptor.json',
  'demos/team-chat/snapback/generated/app.mjs',
  'demos/team-chat/snapback/generated/artifacts.json',
  'demos/team-chat/snapback/generated/capability.manifest.json',
  'demos/team-chat/snapback/generated/contract-data.manifest.json',
  'demos/team-chat/snapback/generated/contract/acceptInvite.mutation.contract-meta.ts',
  'demos/team-chat/snapback/generated/contract/acceptInvite.mutation.ts',
  'demos/team-chat/snapback/generated/contract/createRoom.mutation.contract-meta.ts',
  'demos/team-chat/snapback/generated/contract/createRoom.mutation.ts',
  'demos/team-chat/snapback/generated/contract/firstInboxPage.query.contract-meta.ts',
  'demos/team-chat/snapback/generated/contract/firstInboxPage.query.ts',
  'demos/team-chat/snapback/generated/contract/inviteMember.mutation.contract-meta.ts',
  'demos/team-chat/snapback/generated/contract/inviteMember.mutation.ts',
  'demos/team-chat/snapback/generated/contract/leaveRoom.mutation.contract-meta.ts',
  'demos/team-chat/snapback/generated/contract/leaveRoom.mutation.ts',
  'demos/team-chat/snapback/generated/contract/listMyRooms.query.contract-meta.ts',
  'demos/team-chat/snapback/generated/contract/listMyRooms.query.ts',
  'demos/team-chat/snapback/generated/contract/markRoomRead.mutation.contract-meta.ts',
  'demos/team-chat/snapback/generated/contract/markRoomRead.mutation.ts',
  'demos/team-chat/snapback/generated/contract/nextInboxPage.query.contract-meta.ts',
  'demos/team-chat/snapback/generated/contract/nextInboxPage.query.ts',
  'demos/team-chat/snapback/generated/contract/roomDetails.query.contract-meta.ts',
  'demos/team-chat/snapback/generated/contract/roomDetails.query.ts',
  'demos/team-chat/snapback/generated/contract/roomMessages.query.contract-meta.ts',
  'demos/team-chat/snapback/generated/contract/roomMessages.query.ts',
  'demos/team-chat/snapback/generated/contract/runtime-links.ts',
  'demos/team-chat/snapback/generated/contract/sendMessage.mutation.contract-meta.ts',
  'demos/team-chat/snapback/generated/contract/sendMessage.mutation.ts',
  'demos/team-chat/snapback/generated/contract/unreadDeliveries.query.contract-meta.ts',
  'demos/team-chat/snapback/generated/contract/unreadDeliveries.query.ts',
  'demos/team-chat/snapback/generated/functions.manifest.json',
  'demos/team-chat/snapback/generated/operations/acceptInvite.args.schema.json',
  'demos/team-chat/snapback/generated/operations/createRoom.args.schema.json',
  'demos/team-chat/snapback/generated/operations/firstInboxPage.args.schema.json',
  'demos/team-chat/snapback/generated/operations/inviteMember.args.schema.json',
  'demos/team-chat/snapback/generated/operations/leaveRoom.args.schema.json',
  'demos/team-chat/snapback/generated/operations/listMyRooms.args.schema.json',
  'demos/team-chat/snapback/generated/operations/markRoomRead.args.schema.json',
  'demos/team-chat/snapback/generated/operations/nextInboxPage.args.schema.json',
  'demos/team-chat/snapback/generated/operations/roomDetails.args.schema.json',
  'demos/team-chat/snapback/generated/operations/roomMessages.args.schema.json',
  'demos/team-chat/snapback/generated/operations/sendMessage.args.schema.json',
  'demos/team-chat/snapback/generated/operations/unreadDeliveries.args.schema.json',
  'demos/team-chat/snapback/generated/package.json',
  'demos/team-chat/snapback/generated/provider-bindings.d.ts',
  'demos/team-chat/snapback/generated/provider-bindings.json',
  'demos/team-chat/snapback/generated/provider-introspection.json',
  'demos/team-chat/snapback/generated/schema.manifest.json',
  'demos/todo-v2/snapback/generated-remote-service/artifacts.json',
  'demos/todo-v2/snapback/generated/artifacts.json',
  'demos/todo/snapback/generated/artifacts.json',
  'demos/triage-graph/snapback/generated/artifacts.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/api-envelope.members.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/api.d.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/api.mjs',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/app.binding.mjs',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/app.d.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/app.descriptor.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/app.mjs',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/artifacts.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/capability.manifest.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract-data.manifest.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract/clearReservations.mutation.contract-meta.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract/clearReservations.mutation.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract/reservationsForSlot.query.contract-meta.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract/reservationsForSlot.query.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract/reserve.mutation.contract-meta.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract/reserve.mutation.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract/resourceList.query.contract-meta.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract/resourceList.query.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract/runtime-links.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract/schedule.query.contract-meta.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract/schedule.query.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/functions.manifest.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/operations/clearReservations.args.schema.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/operations/reservationsForSlot.args.schema.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/operations/reserve.args.schema.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/operations/resourceList.args.schema.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/operations/schedule.args.schema.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/package.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/provider-bindings.d.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/provider-bindings.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/provider-introspection.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/schema.manifest.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/seed.artifact.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/trusted-composition-activation.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/api-envelope.members.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/api.d.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/api.mjs',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.binding.mjs',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.d.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.descriptor.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.mjs',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/artifacts.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/capability.manifest.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract-data.manifest.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/activityRows.query.contract-meta.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/activityRows.query.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/fixturePresence.ephemeral.contract-meta.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/fixturePresence.ephemeral.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/fixturePresence.publish.contract-meta.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/fixturePresence.publish.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/liveRows.query.contract-meta.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/liveRows.query.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/primaryRows.query.contract-meta.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/primaryRows.query.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/publishLiveRow.mutation.contract-meta.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/publishLiveRow.mutation.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/rejectInvalidWrite.mutation.contract-meta.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/rejectInvalidWrite.mutation.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/rejectionRows.query.contract-meta.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/rejectionRows.query.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/runtime-links.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/writePrimaryAndActivity.mutation.contract-meta.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/writePrimaryAndActivity.mutation.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/functions.manifest.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/operations/activityRows.args.schema.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/operations/liveRows.args.schema.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/operations/primaryRows.args.schema.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/operations/publishLiveRow.args.schema.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/operations/rejectInvalidWrite.args.schema.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/operations/rejectionRows.args.schema.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/operations/writePrimaryAndActivity.args.schema.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/package.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/provider-bindings.d.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/provider-bindings.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/provider-introspection.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/schema.manifest.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/api-envelope.members.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/api.d.ts',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/api.mjs',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/app.binding.mjs',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/app.d.ts',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/app.descriptor.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/app.mjs',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/artifacts.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/capability.manifest.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/contract-data.manifest.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/contract/joinAsHost.mutation.contract-meta.ts',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/contract/joinAsHost.mutation.ts',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/contract/leaveHost.mutation.contract-meta.ts',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/contract/leaveHost.mutation.ts',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/contract/pushLedger.query.contract-meta.ts',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/contract/pushLedger.query.ts',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/contract/runtime-links.ts',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/functions.manifest.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/operations/joinAsHost.args.schema.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/operations/leaveHost.args.schema.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/operations/pushLedger.args.schema.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/operations/sendSelected.args.schema.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/package.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/provider-bindings.d.ts',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/provider-bindings.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/provider-introspection.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/schema.manifest.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/api-envelope.members.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/api.d.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/api.mjs',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/app.binding.mjs',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/app.d.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/app.descriptor.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/app.mjs',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/artifacts.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/capability.manifest.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract-data.manifest.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/addReaction.mutation.contract-meta.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/addReaction.mutation.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/conversationDetails.query.contract-meta.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/conversationDetails.query.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/membershipsForConversation.query.contract-meta.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/membershipsForConversation.query.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/messagesForConversation.query.contract-meta.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/messagesForConversation.query.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/reactionsForConversation.query.contract-meta.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/reactionsForConversation.query.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/removeReaction.mutation.contract-meta.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/removeReaction.mutation.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/runtime-links.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/sendMessage.mutation.contract-meta.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/sendMessage.mutation.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/sendReply.mutation.contract-meta.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/sendReply.mutation.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/sendText.mutation.contract-meta.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/sendText.mutation.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/typing.ephemeral.contract-meta.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/typing.ephemeral.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/typing.publish.contract-meta.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/typing.publish.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/users.query.contract-meta.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/users.query.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/functions.manifest.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/operations/addReaction.args.schema.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/operations/conversationDetails.args.schema.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/operations/membershipsForConversation.args.schema.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/operations/messagesForConversation.args.schema.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/operations/reactionsForConversation.args.schema.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/operations/removeReaction.args.schema.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/operations/sendMessage.args.schema.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/operations/sendReply.args.schema.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/operations/sendText.args.schema.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/operations/users.args.schema.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/package.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/provider-bindings.d.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/provider-bindings.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/provider-introspection.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/schema.manifest.json',
  // END GENERATED PUBLICATION LEAF SET
]);

export function auditReviewedGeneratedPublicationPaths(generated) {
  const actual = new Set(
    [...generated.keys()].filter((path) => !isRegisteredContentAddressedGeneratedLeaf(path)),
  );
  const unexpected = [...actual]
    .filter((path) => !REVIEWED_GENERATED_PUBLICATION_PATHS.has(path))
    .sort();
  const missing = [...REVIEWED_GENERATED_PUBLICATION_PATHS]
    .filter((path) => !actual.has(path))
    .sort();
  return { actual, unexpected, missing };
}

export function assertReviewedGeneratedPublicationPaths(generated) {
  const { unexpected, missing } = auditReviewedGeneratedPublicationPaths(generated);
  assert.deepEqual(
    { unexpected, missing },
    { unexpected: [], missing: [] },
    'generated publication paths drifted from the reviewed qualification-C leaf set',
  );
}

export function auditAgentSafePublicationLeafSet({
  rootPath = root,
  generated = generatedPublicationPathsOnDisk(rootPath),
} = {}) {
  return auditReviewedGeneratedPublicationPaths(generated);
}

test('P-vs-C generated allowance is the exact qualification-C leaf set', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const generated = generatedPublicationPathsAt(root, head);
  assertReviewedGeneratedPublicationPaths(generated);

  const registeredRoot = 'packages/snapback-cli/fixtures/comparator/app/snapback/generated';
  const validDigest = '0'.repeat(64);
  const existingBinding = [...generated.keys()].find((path) => (
    path.startsWith(`${registeredRoot}/app.binding.`)
    && CONTENT_ADDRESSED_APP_BINDING.test(path.slice(registeredRoot.length + 1))
  ));
  assert.ok(existingBinding, 'comparator fixture has no content-addressed binding leaf');
  const churnedBinding = `${registeredRoot}/app.binding.${validDigest}.mjs`;
  const churned = new Map(generated);
  const bindingEntry = churned.get(existingBinding);
  churned.delete(existingBinding);
  churned.set(churnedBinding, bindingEntry);
  assertReviewedGeneratedPublicationPaths(churned);

  for (const unexpectedPath of [
    `${registeredRoot}/brand-new-non-hash.mjs`,
    `${registeredRoot}/unregistered/app.binding.${validDigest}.mjs`,
  ]) {
    const widened = new Map(generated).set(unexpectedPath, bindingEntry);
    assert.throws(
      () => assertReviewedGeneratedPublicationPaths(widened),
      (error) => {
        assert.deepEqual(error.actual, { unexpected: [unexpectedPath], missing: [] });
        return true;
      },
      unexpectedPath,
    );
  }

  for (const invalidContentAddressedPath of [
    `${registeredRoot}/app.binding.${'0'.repeat(63)}.mjs`,
    `${registeredRoot}/app.binding.${'A'.repeat(64)}.mjs`,
    `${registeredRoot}/app.binding.${validDigest}.json`,
    `${registeredRoot}/app.descriptor.${validDigest}.mjs`,
    `${registeredRoot}/arbitrary.${validDigest}.mjs`,
    `admin-ui/generated/app.binding.${validDigest}.mjs`,
  ]) {
    assert.equal(
      isRegisteredContentAddressedGeneratedLeaf(invalidContentAddressedPath),
      false,
      invalidContentAddressedPath,
    );
  }

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
    'demos/triage-graph/snapback/generated/artifacts.json',
    'demos/chirp/snapback/generated/artifacts.json',
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
  assert.equal(allowedPublicationPath('src/manifest.rs'), false);
  assert.equal(
    allowedPublicationPath('tests/conformance/local-persistent-store-publication-v1.mjs'),
    false,
  );
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
  for (const path of [
    'tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json',
    'tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.linux-x86_64.v1.json',
    'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.codex.md',
    'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.fable.md',
    'llp/reviews/0158-instance-forking.implementation-2026-08-06.codex.md',
    'llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.md',
    'tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-06.v1.json',
  ]) {
    assert.equal(allowedPublicationPath(path), true, path);
  }
  for (const path of [
    'tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.v1.json',
    'tests/acceptance/asset-lifecycle-v1-evidence.md',
  ]) {
    assert.equal(allowedPublicationPath(path), false, `${path} must stay frozen in C`);
  }
  assert.equal(
    allowedPublicationPath('demos/latency-kanban/snapback/trusted-composition-activation.json'),
    true,
  );
  assert.equal(
    allowedPublicationPath('tests/acceptance/fixtures/latency-kanban/move3-exit.2026-08-04.r2.v1.json'),
    true,
  );
  for (const path of [
    'demos/triage-graph/snapback/trusted-composition-activation.json',
    'tests/acceptance/fixtures/triage-graph/move1-exit.2026-08-06.v1.json',
    'tests/acceptance/fixtures/triage-graph/budget-freeze.2026-08-06.v1.json',
    'tests/acceptance/triage-graph-move1-v1-evidence.md',
    'tests/acceptance/fixtures/fleet-observatory/move1-exit.2026-08-06.v1.json',
    'tests/acceptance/fixtures/fleet-observatory/budget-freeze.2026-08-06.v1.json',
    'tests/acceptance/fleet-observatory-move1-v1-evidence.md',
    'demos/zero-bakeoff/apps/contention-calendar/snapback/trusted-composition-activation.json',
    'tests/acceptance/fixtures/contention-calendar/rung2-exit.2026-08-04.r1.v1.json',
    'tests/acceptance/contention-calendar-rung2-v1-evidence.md',
    'tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-06.v1.json',
    'tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-06.v1.json',
    'tests/acceptance/local-store-carrier-exit-v1-evidence.md',
    'src/local-persistent-store-publication.anchor.v1.json',
    'src/local-persistent-store-publication.v1.json',
  ]) {
    assert.equal(allowedPublicationPath(path), true, path);
  }
  assert.equal(
    allowedPublicationPath('tests/acceptance/fixtures/latency-kanban/move3-exit.2026-08-04.v1.json'),
    false,
  );
  for (const path of [
    'tests/acceptance/fixtures/triage-graph/move1-exit.2026-08-04.v1.json',
    'tests/acceptance/fixtures/triage-graph/budget-freeze.2026-08-04.v1.json',
    'tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-04.v1.json',
    'tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-04.v1.json',
  ]) {
    assert.equal(allowedPublicationPath(path), false, `${path} is retired publication lineage`);
  }
  assert.equal(allowedPublicationPath('guide/arbitrary-executable.mjs'), false);
});

test('P-vs-C local-store carrier refresh is an exact digest-only transform', () => {
  const { scratch, qualification } = localStoreTransformFixture();
  validateLocalStorePublicationTransform(scratch, qualification);
});

test('P-vs-C local-store transform rejects extra carrier or anchor edits', () => {
  for (const path of [
    'src/local-persistent-store-publication.anchor.v1.json',
    'src/local-persistent-store-publication.v1.json',
  ]) {
    const { scratch, qualification } = localStoreTransformFixture();
    writeFileSync(join(scratch, path), Buffer.concat([
      readFileSync(join(scratch, path)),
      Buffer.from('\nforged-publication-edit\n'),
    ]));
    assert.throws(
      () => validateLocalStorePublicationTransform(scratch, qualification),
      /drifted beyond the qualification-C local-store digest transform/u,
      path,
    );
  }
});

if (leafSetOnly) {
  const rootArg = process.argv.indexOf('--root');
  const rootPath = rootArg === -1 ? root : resolve(process.argv[rootArg + 1]);
  const { actual, unexpected, missing } = auditAgentSafePublicationLeafSet({ rootPath });
  assert.deepEqual(
    { unexpected, missing },
    { unexpected: [], missing: [] },
    'generated publication paths drifted from the reviewed qualification-C leaf set',
  );
  process.stdout.write(
    `[agent-safe-publication-leaf-set] PASS: ${actual.size} reviewed regular leaves\n`,
  );
}
