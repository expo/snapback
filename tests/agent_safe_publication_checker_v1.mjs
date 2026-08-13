import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import nodeTest from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  allowedPublicationChange,
  allowedPublicationPath,
  assertCoverageTransfers,
  assertQualifiedImplementationDigestAtPublication,
  DERIVED_FORK_COVERAGE_TRANSFERS,
  DERIVED_FORK_IMPLEMENTATION_SCOPE,
  DERIVED_FORK_SIBLING_CHAIN_PATHS,
  DERIVED_FORK_SIBLING_CUSTODY_GATES,
  DERIVED_FORK_SIBLING_CUSTODY_TRANSFERS,
  evaluateClaimSnapshot,
  exactCandidate,
  generatedPublicationPathsAt,
  generatedPublicationPathsOnDisk,
  IMPLEMENTATION_DIGEST_VERSION,
  IMPLEMENTATION_ROOTS,
  IMPLEMENTATION_SCOPE_SCHEMA_VERSION,
  implementationDigestAt,
  expectedLocalStorePublicationTransform,
  LOCAL_STORE_PUBLICATION_TRANSFORM,
  PUBLICATION_CYCLE_ALLOWLIST,
  SCOPED_IMPLEMENTATION_DIGEST_VERSION,
  validateAbsolutePerformanceArtifact,
  validateAgentSafeCodegenDeclarations,
  validatePairedPerformanceArtifact,
  validatePublicationRecord,
  validatePublishedResultCustody,
  validateReview,
  validateLocalStorePublicationTransform,
  validateDerivedForkCoverageTransfers,
} from '../scripts/check-agent-safe-publication.mjs';
import {
  loadSelectionContext,
  selectDriftProneGates,
} from '../scripts/select-local-proof.mjs';
import {
  ADMIN_GENERATED_ROOTS,
  CODEGEN_JOBS,
  FULLY_COMMITTED_ROOTS,
  REVIEW_CACHE_ROOTS,
  codegenOutputRoot,
  isContentAddressedFullyCommittedLeaf,
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

function withheldFixture() {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-agent-safe-publication-'));
  for (const record of [storage, derived]) {
    const evidence = record.id === storage.id ? storageEvidence : historicalDerivedEvidence;
    writeJson(scratch, record.anchor, {
      schemaVersion: 'snapback.local-capability-publication-anchor.v1',
      capabilityId: record.id,
      state: 'withheld',
      carrierSha256: null,
    });
    writeJson(scratch, record.carrier, {});
    writeJson(scratch, record.receipt, {
      schemaVersion: 'snapback.agent-safe-publication-receipt.v2',
      capabilityId: record.id,
      qualifiedSourceCommit: '0'.repeat(40),
      implementationDigestVersion: IMPLEMENTATION_DIGEST_VERSION,
      implementationTreeSha256: `sha256:${'0'.repeat(64)}`,
      candidateFactsSha256: `sha256:${'0'.repeat(64)}`,
      qualifiedTargetProfileId: 'local-dev-sqlite-ibex',
      negativeTargetProfileIds: ['cloudflare-do-sqlite-v8', 'remote-service-sqlite-ibex'],
      negativeBuildDistributions: ['public-package'],
      qualifiedComponents: [...record.components],
      evidence: evidence.map(([kind, path]) => ({
        kind,
        path,
        sha256: `sha256:${'0'.repeat(64)}`,
      })),
    });
  }
  return scratch;
}

const storageEvidence = [
  ['acceptanceCorpus', 'tests/acceptance/fixtures/agent-safe-storage/acceptance-corpus.2026-08-04.v1.json'],
  ['pairedPerformance', 'tests/acceptance/fixtures/agent-safe-storage/agent-safe-active-covered-paired.2026-08-04.v1.json'],
  ['absolutePerformance', 'tests/acceptance/fixtures/agent-safe-storage/fork-promotion-performance.2026-08-04.v1.json'],
  ['independentReviewFable', 'llp/reviews/0162-agent-safe-storage-profile.implementation-2026-08-04.fable.md'],
  ['independentReviewCodex', 'llp/reviews/0162-agent-safe-storage-profile.implementation-2026-08-04.codex.md'],
  ['authorAcceptance', 'tests/acceptance/fixtures/agent-safe-storage/author-acceptance.2026-08-04.v1.json'],
];

const historicalDerivedEvidence = [
  ['lifecycleBenchMacos', 'tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json'],
  ['lifecycleBenchLinux', 'tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.linux-x86_64.v1.json'],
  ['boundsRatification', 'tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.v1.json'],
  ['assetLifecycleEvidence', 'tests/acceptance/asset-lifecycle-v1-evidence.md'],
  ['specReviewCodex', 'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.codex.md'],
  ['specReviewCodexVerdicts', 'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.codex.verdicts.v1.json'],
  ['specReviewFable', 'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.fable.md'],
  ['specReviewFableVerdicts', 'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.fable.verdicts.v1.json'],
  ['implementationReviewCodex', 'llp/reviews/0158-instance-forking.implementation-2026-08-06.codex.md'],
  ['implementationReviewCodexVerdicts', 'llp/reviews/0158-instance-forking.implementation-2026-08-06.codex.verdicts.v1.json'],
  ['implementationReviewFable', 'llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.md'],
  ['implementationReviewFableVerdicts', 'llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.verdicts.v1.json'],
  ['authorAcceptance', 'tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-06.v1.json'],
];

const DERIVED_FIXTURE_DATE = '2026-08-07';
const DERIVED_FORK_SELECTION_POLICY_PATH =
  'scripts/local-proof-selection-policy.v1.json';

function currentDerivedEvidence({
  platformDate = DERIVED_FIXTURE_DATE,
  boundsDate = DERIVED_FIXTURE_DATE,
  acceptanceDate = DERIVED_FIXTURE_DATE,
  authorAcceptancePath =
    `tests/acceptance/fixtures/instance-forks/author-acceptance.${acceptanceDate}.v3.json`,
} = {}) {
  return [
    ['lifecycleBenchMacos', `tests/acceptance/instance-fork-lifecycle-bench.${platformDate}.macos-aarch64.v1.json`],
    ['lifecycleBenchLinux', `tests/acceptance/instance-fork-lifecycle-bench.${platformDate}.linux-x86_64.v1.json`],
    ['boundsRatification', `tests/acceptance/instance-fork-lifecycle-bench.${boundsDate}.v1.json`],
    ...historicalDerivedEvidence.slice(3, -1),
    ['authorAcceptance', authorAcceptancePath],
  ];
}

const derivedEvidence = currentDerivedEvidence();

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function committedDigestAt(rootPath, commit, path) {
  return digest(execFileSync('git', ['show', `${commit}:${path}`], { cwd: rootPath }));
}

function legacyImplementationDigestV1At(rootPath, commit) {
  const names = execFileSync('git', [
    'ls-tree', '-r', '--name-only', commit, '--', ...IMPLEMENTATION_ROOTS,
  ], { cwd: rootPath, encoding: 'utf8' }).split('\n').filter(Boolean)
    .filter((path) => !PUBLICATION_CYCLE_ALLOWLIST.has(path)).sort();
  const hash = createHash('sha256');
  hash.update('snapback:agent-safe-implementation-tree:v1\n');
  const update = (path, bytes) => {
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.length));
    hash.update(path);
    hash.update(Buffer.from([0]));
    hash.update(length);
    hash.update(bytes);
  };
  for (const path of names) {
    update(path, execFileSync('git', ['show', `${commit}:${path}`], { cwd: rootPath }));
  }
  update('vendor/ibex', Buffer.from(execFileSync('git', [
    'rev-parse', `${commit}:vendor/ibex`,
  ], { cwd: rootPath, encoding: 'utf8' }).trim()));
  return `sha256:${hash.digest('hex')}`;
}

function qualifiedImplementationScopeFixture() {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-qualified-implementation-scope-'));
  execFileSync('git', ['init', '--quiet'], { cwd: scratch });
  execFileSync('git', ['config', 'user.name', 'Snapback Test'], { cwd: scratch });
  execFileSync('git', ['config', 'user.email', 'snapback-test@example.invalid'], { cwd: scratch });
  execFileSync('git', ['config', 'core.filemode', 'true'], { cwd: scratch });
  mkdirSync(join(scratch, 'src'), { recursive: true });
  writeFileSync(join(scratch, 'src/qualified.rs'), 'pub const QUALIFIED: bool = true;\n');
  writeFileSync(join(scratch, 'src/type-swap'), 'qualified-target.rs');
  execFileSync('git', ['add', 'src/qualified.rs', 'src/type-swap'], { cwd: scratch });
  const ibexGitlink = execFileSync('git', ['rev-parse', 'HEAD:vendor/ibex'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  execFileSync('git', [
    'update-index', '--add', '--cacheinfo', `160000,${ibexGitlink},vendor/ibex`,
  ], { cwd: scratch });
  execFileSync('git', ['commit', '--quiet', '-m', 'qualification C'], { cwd: scratch });
  const qualification = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: scratch,
    encoding: 'utf8',
  }).trim();
  const scoped = {
    schemaVersion: IMPLEMENTATION_SCOPE_SCHEMA_VERSION,
    roots: ['src'],
    files: ['vendor/ibex'],
  };
  return {
    scratch,
    qualification,
    expectedDigest: implementationDigestAt(scratch, qualification),
    scoped,
    scopedDigest: implementationDigestAt(scratch, qualification, scoped),
  };
}

function commitFixture(rootPath, message, ...paths) {
  execFileSync('git', ['add', '--', ...paths], { cwd: rootPath });
  execFileSync('git', ['commit', '--quiet', '-m', message], { cwd: rootPath });
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: rootPath,
    encoding: 'utf8',
  }).trim();
}

function writeJson(rootPath, path, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  mkdirSync(dirname(join(rootPath, path)), { recursive: true });
  writeFileSync(join(rootPath, path), bytes);
  return bytes;
}

function duplicateTopLevelMember(canonicalBytes, key, visibleValue) {
  const text = canonicalBytes.toString();
  const needle = `  ${JSON.stringify(key)}: `;
  assert.ok(text.includes(needle), `missing top-level fixture member ${key}`);
  const visible = `${needle}${JSON.stringify(visibleValue, null, 2).replaceAll('\n', '\n  ')},\n`;
  return Buffer.from(text.replace(needle, `${visible}${needle}`));
}

// Governing invariant: validator fixtures may not depend on live mutable
// records. Every review, verdict, bench, and acceptance byte used below is
// synthesized in the scratch repository; appending a real review round never
// requires editing this implementation-digest-covered self-test.
function derivedReviewBytes(kind, family, roundCount) {
  return Buffer.from([
    `# ${kind}`,
    `**Family:** ${family}`,
    '**Provider/runtime:** synthetic checker self-test',
    '**Date:** 2026-08-06',
    '**Redacted:** no',
    '**Method:** generated-fixture',
    ...Array.from({ length: roundCount }, (_, index) => [
      `## Round ${index + 1}`,
      '',
      `Synthetic prose for round ${index + 1}; the structured sidecar carries authority.`,
      '',
    ]).flat(),
  ].join('\n'));
}

function derivedVerdictContract(
  kind,
  family,
  commit,
  reviewPath,
  reviewBytes,
  ready,
  roundCount,
) {
  const spec = kind.startsWith('specReview');
  let previousEntrySha256 = null;
  return {
    schemaVersion: 'snapback.review-verdicts.v2',
    verdicts: Array.from({ length: roundCount }, (_, index) => index + 1).map((round) => {
      const authoritative = round === roundCount;
      const reviewBytesAtRound = authoritative
        ? reviewBytes
        : derivedReviewBytes(kind, family, round);
      const entry = {
        reviewArtifact: reviewPath,
        reviewArtifactSha256: digest(reviewBytes),
        proseHistoryBinding: 'frozen-per-round',
        reviewArtifactByteLengthAtRound: reviewBytesAtRound.length,
        reviewArtifactSha256AtRound: digest(reviewBytesAtRound),
        family,
        round,
        reviewedCommit: commit,
        previousEntrySha256,
        verdict: spec
          ? {
            kind: 'forkSpecConformance',
            llp0163: round === 1 ? 'NOT_READY' : 'READY',
            llp0164: round === 1 ? 'NOT_READY' : 'READY',
            llp0165: authoritative && ready ? 'READY' : 'NOT_READY',
          }
          : {
            kind: 'derivedForkPublication',
            status: authoritative && ready ? 'READY' : 'NOT_READY',
          },
      };
      previousEntrySha256 = digest(Buffer.from(`${JSON.stringify(entry, null, 2)}\n`));
      return entry;
    }),
  };
}

function syntheticLifecycleBench(commit, os, arch) {
  const stats = (samples, medianMs) => ({
    samples,
    minMs: medianMs,
    medianMs,
    maxMs: medianMs,
  });
  return {
    schemaVersion: 'snapback.fork-lifecycle-bench.v1',
    scope: 'LLP 0162 row 13, narrow operating.instance-forks claim (author-scoped 2026-08-05)',
    environment: {
      os,
      arch,
      cpus: 4,
      profile: 'release',
      commit,
    },
    measurements: {
      createColdSmallParent: stats(5, 100),
      createColdLargeParent32MiB: stats(3, 200),
      createLiveParent: stats(3, 100),
      dropSmall: stats(5, 20),
      dropLarge: stats(3, 20),
      dropLive: stats(3, 20),
      attributedDiff10kRows: stats(3, 50),
      netDiff10kRows: stats(3, 60),
      reapThreeExpiredForks: { samples: 1, medianMs: 10 },
      concurrentCreate3WallMs: 250,
      sequentialCreateMedianMs: 100,
    },
    ratifiedBounds: {
      ratifiedBy: 'LLP 0162 author (Charlie), 2026-08-06',
      createColdSmallParentMs: 2_000,
      createColdLargeParent32MiBMs: 3_000,
      createLiveParentMs: 2_000,
      dropMs: 1_000,
      attributedDiff10kRowsMs: 500,
      netDiff10kRowsMs: 750,
      reapSweepMs: 1_000,
      concurrentCreate3WallMs: '<= 3x the sequential create bound',
    },
    notes: [
      'create latency includes server boot, ready handshake, and manifest load — the full product surface',
      'diff spans are 10k journal rows, an order of magnitude under the 100k diff-work bound',
    ],
  };
}

function reviewHistoryHead(value) {
  return {
    roundCount: value.verdicts.length,
    headEntrySha256: digest(Buffer.from(`${JSON.stringify(value.verdicts.at(-1), null, 2)}\n`)),
  };
}

function rechainVerdicts(entries) {
  let previousEntrySha256 = null;
  entries.forEach((entry, index) => {
    entry.round = index + 1;
    entry.previousEntrySha256 = previousEntrySha256;
    previousEntrySha256 = digest(Buffer.from(`${JSON.stringify(entry, null, 2)}\n`));
  });
}

function storageReviewBytes(family, commit, implementationTree) {
  return Buffer.from([
    `**Reviewer family:** ${family}`,
    '**Verdict:** READY',
    `**Reviewed commit:** ${commit}`,
    `**Implementation tree SHA-256:** ${implementationTree}`,
    '**Qualified capability:** agent_safe_storage_v1',
    `**Qualified components:** ${storage.components.join(', ')}`,
    '**Derived capability:** WITHHELD (Missing)',
    '**Broader capability facts:** Missing',
    '**Reviewed LLPs:** 0158, 0163, 0164, 0165',
    '**Status recommendation:** Accepted',
    '**LLP 0158 OQ9 disposition:** READY (in-document amendment pattern sufficient)',
    '',
  ].join('\n'));
}

function publishedDerivedFixture({
  acceptanceDate = DERIVED_FIXTURE_DATE,
  acceptMutatedReviewHistories = false,
  authorAcceptancePath,
  boundsDate = DERIVED_FIXTURE_DATE,
  platformDate = DERIVED_FIXTURE_DATE,
  omitReview,
  omitAuthor = false,
  preexistingDatedEvidenceKind,
  zeroAuthorDigest = false,
  mutateMacos,
  mutateAcceptance,
  mutateQualificationPolicy,
  notReadyReview,
  malformedVerdict,
  mutateReceipt,
  mutateReview,
  mutateVerdict,
  serializeJson,
  serializeVerdict,
  reviewRoundCount = 3,
} = {}) {
  const fixtureEvidence = currentDerivedEvidence({
    acceptanceDate,
    authorAcceptancePath,
    boundsDate,
    platformDate,
  });
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-derived-fork-publication-'));
  execFileSync('git', ['init', '--quiet'], { cwd: scratch });
  execFileSync('git', ['config', 'user.name', 'Snapback Test'], { cwd: scratch });
  execFileSync('git', ['config', 'user.email', 'snapback-test@example.invalid'], { cwd: scratch });
  mkdirSync(join(scratch, 'src'), { recursive: true });
  writeFileSync(join(scratch, 'src/qualification-marker.txt'), 'derived-fork qualification C\n');
  for (const path of DERIVED_FORK_SIBLING_CHAIN_PATHS) {
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    writeFileSync(join(scratch, path), readFileSync(join(root, path)));
  }
  for (const path of DERIVED_FORK_IMPLEMENTATION_SCOPE.files) {
    if (path === 'vendor/ibex') continue;
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    writeFileSync(join(scratch, path), readFileSync(join(root, path)));
  }
  const sourceSelectionPolicy = JSON.parse(readFileSync(
    join(root, DERIVED_FORK_SELECTION_POLICY_PATH),
    'utf8',
  ));
  const qualificationContextPaths = [...new Set([
    DERIVED_FORK_SELECTION_POLICY_PATH,
    ...DERIVED_FORK_COVERAGE_TRANSFERS.map(({ path }) => path),
    ...DERIVED_FORK_SIBLING_CUSTODY_GATES.flatMap((gate) => (
      sourceSelectionPolicy.driftProneGates[gate].recordPaths
    )),
  ])];
  for (const path of qualificationContextPaths) {
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    writeFileSync(join(scratch, path), readFileSync(join(root, path)));
  }
  if (mutateQualificationPolicy !== undefined) {
    const policy = JSON.parse(readFileSync(
      join(scratch, DERIVED_FORK_SELECTION_POLICY_PATH),
      'utf8',
    ));
    mutateQualificationPolicy(policy);
    writeJson(scratch, DERIVED_FORK_SELECTION_POLICY_PATH, policy);
  }
  const preexistingDatedEvidencePath = fixtureEvidence.find(
    ([kind]) => kind === preexistingDatedEvidenceKind,
  )?.[1];
  if (preexistingDatedEvidencePath !== undefined) {
    mkdirSync(dirname(join(scratch, preexistingDatedEvidencePath)), { recursive: true });
    writeFileSync(join(scratch, preexistingDatedEvidencePath), 'retained historical bytes\n');
  }
  execFileSync('git', [
    'add', 'src/qualification-marker.txt',
    ...DERIVED_FORK_SIBLING_CHAIN_PATHS,
    ...DERIVED_FORK_IMPLEMENTATION_SCOPE.files.filter((path) => path !== 'vendor/ibex'),
    ...qualificationContextPaths,
    ...(preexistingDatedEvidencePath === undefined ? [] : [preexistingDatedEvidencePath]),
  ], { cwd: scratch });
  const ibexGitlink = execFileSync('git', ['rev-parse', 'HEAD:vendor/ibex'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  execFileSync('git', [
    'update-index', '--add', '--cacheinfo', `160000,${ibexGitlink},vendor/ibex`,
  ], { cwd: scratch });
  const qualificationDate = `${DERIVED_FIXTURE_DATE}T12:00:00Z`;
  execFileSync('git', ['commit', '--quiet', '-m', 'qualification C'], {
    cwd: scratch,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: qualificationDate,
      GIT_COMMITTER_DATE: qualificationDate,
    },
  });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: scratch,
    encoding: 'utf8',
  }).trim();
  const implementationScope = structuredClone(DERIVED_FORK_IMPLEMENTATION_SCOPE);
  const implementationTree = implementationDigestAt(scratch, commit, implementationScope);
  const selectionPolicySha256 = committedDigestAt(
    scratch,
    commit,
    DERIVED_FORK_SELECTION_POLICY_PATH,
  );

  const bindings = [];
  const reviewBytes = new Map();
  const acceptedReviewHistoryHeads = new Map();
  for (const [kind, path] of fixtureEvidence.slice(0, -1)) {
    let bytes;
    if (kind === 'lifecycleBenchMacos' || kind === 'lifecycleBenchLinux'
        || kind === 'boundsRatification') {
      const value = kind === 'lifecycleBenchLinux'
        ? syntheticLifecycleBench(commit, 'linux', 'x86_64')
        : syntheticLifecycleBench(commit, 'macos', 'aarch64');
      if (kind === 'lifecycleBenchMacos') mutateMacos?.(value);
      const canonicalBytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
      bytes = serializeJson?.(kind, value, canonicalBytes) ?? canonicalBytes;
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(join(scratch, path), bytes);
    } else if (kind === 'assetLifecycleEvidence') {
      bytes = Buffer.from([
        '# LLP 0044 `asset-lifecycle-v1` acceptance evidence (local target)',
        '',
        '<!-- @ref LLP 0044#acceptance — synthetic publication-checker fixture -->',
        '',
      ].join('\n'));
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(join(scratch, path), bytes);
    } else if (kind.endsWith('Verdicts')) {
      const reviewKind = kind.slice(0, -'Verdicts'.length);
      const reviewPath = fixtureEvidence.find(([candidate]) => candidate === reviewKind)[1];
      const family = kind.includes('Codex') ? 'codex' : 'fable';
      const value = derivedVerdictContract(
        reviewKind,
        family,
        commit,
        reviewPath,
        reviewBytes.get(reviewKind),
        reviewKind !== notReadyReview,
        reviewRoundCount,
      );
      const originalHistoryHead = reviewHistoryHead(value);
      mutateVerdict?.(kind, value, { scratch, commit });
      acceptedReviewHistoryHeads.set(
        kind,
        acceptMutatedReviewHistories ? reviewHistoryHead(value) : originalHistoryHead,
      );
      const canonicalBytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
      bytes = kind === malformedVerdict
        ? Buffer.from('{"schemaVersion":')
        : serializeVerdict?.(kind, value, canonicalBytes)
          ?? serializeJson?.(kind, value, canonicalBytes)
          ?? canonicalBytes;
      if (path !== omitReview) {
        mkdirSync(dirname(join(scratch, path)), { recursive: true });
        writeFileSync(join(scratch, path), bytes);
      }
    } else {
      const family = kind.endsWith('Codex') ? 'codex' : 'fable';
      bytes = derivedReviewBytes(kind, family, reviewRoundCount);
      bytes = mutateReview?.(kind, bytes) ?? bytes;
      reviewBytes.set(kind, bytes);
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
    schemaVersion: 'snapback.derived-fork-author-acceptance.v3',
    capabilityId: derived.id,
    accepted: true,
    authorLine: `Charlie Cheever — accepted ${acceptanceDate}`,
    qualifiedSourceCommit: commit,
    implementationDigestVersion: SCOPED_IMPLEMENTATION_DIGEST_VERSION,
    implementationTreeSha256: implementationTree,
    candidateFactsSha256,
    implementationScope: structuredClone(implementationScope),
    selectionPolicySha256,
    residualV2DepartingClass: {
      schemaVersion: 'snapback.derived-fork-residual-v2-departing-class.v1',
      departingRoots: [
        'packages/snapback-codegen',
        'packages/snapback-contract',
        'tests',
      ],
      separatelyLedgeredPaths: DERIVED_FORK_COVERAGE_TRANSFERS.map(({ path }) => path),
      disposition:
        'qualification-time evidence and non-claim-semantics support; re-inspected at each fresh qualification',
    },
    qualifiedComponents: [...derived.components],
    evidenceSha256: Object.fromEntries(bindings.map(({ kind, sha256 }) => [kind, sha256])),
    reviewHistoryHeads: Object.fromEntries(acceptedReviewHistoryHeads),
  };
  mutateAcceptance?.(acceptance);
  const [authorKind, authorPath] = fixtureEvidence.at(-1);
  const canonicalAuthorBytes = Buffer.from(`${JSON.stringify(acceptance, null, 2)}\n`);
  const authorBytes = serializeJson?.(authorKind, acceptance, canonicalAuthorBytes)
    ?? canonicalAuthorBytes;
  mkdirSync(dirname(join(scratch, authorPath)), { recursive: true });
  writeFileSync(join(scratch, authorPath), authorBytes);
  if (omitAuthor) unlinkSync(join(scratch, authorPath));
  bindings.push({
    kind: authorKind,
    path: authorPath,
    sha256: zeroAuthorDigest ? `sha256:${'0'.repeat(64)}` : digest(authorBytes),
  });

  const receipt = {
    schemaVersion: 'snapback.agent-safe-publication-receipt.v3',
    capabilityId: derived.id,
    qualifiedSourceCommit: commit,
    implementationDigestVersion: SCOPED_IMPLEMENTATION_DIGEST_VERSION,
    implementationScope,
    selectionPolicySha256,
    implementationTreeSha256: implementationTree,
    candidateFactsSha256,
    qualifiedTargetProfileId: 'local-dev-sqlite-ibex',
    negativeTargetProfileIds: ['cloudflare-do-sqlite-v8', 'remote-service-sqlite-ibex'],
    negativeBuildDistributions: ['public-package'],
    qualifiedComponents: [...derived.components],
    evidence: bindings,
  };
  mutateReceipt?.(receipt);
  const canonicalReceiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const receiptBytes = serializeJson?.('receipt', receipt, canonicalReceiptBytes)
    ?? canonicalReceiptBytes;
  mkdirSync(dirname(join(scratch, derived.receipt)), { recursive: true });
  writeFileSync(join(scratch, derived.receipt), receiptBytes);
  const carrier = {
    schemaVersion: 'snapback.local-agent-safe-publication.v2',
    capabilityId: derived.id,
    targetProfileId: 'local-dev-sqlite-ibex',
    maturity: 'experimental',
    qualifiedSourceCommit: commit,
    implementationDigestVersion: SCOPED_IMPLEMENTATION_DIGEST_VERSION,
    implementationTreeSha256: implementationTree,
    candidateFactsSha256,
    qualificationReceiptSha256: digest(receiptBytes),
    buildProvenanceRequirement: 'known-clean-contributor-source',
    candidateFacts,
  };
  const canonicalCarrierBytes = Buffer.from(`${JSON.stringify(carrier, null, 2)}\n`);
  const carrierBytes = serializeJson?.('carrier', carrier, canonicalCarrierBytes)
    ?? canonicalCarrierBytes;
  mkdirSync(dirname(join(scratch, derived.carrier)), { recursive: true });
  writeFileSync(join(scratch, derived.carrier), carrierBytes);
  const anchor = {
    schemaVersion: 'snapback.local-capability-publication-anchor.v1',
    capabilityId: derived.id,
    state: 'published',
    carrierSha256: digest(carrierBytes),
  };
  const canonicalAnchorBytes = Buffer.from(`${JSON.stringify(anchor, null, 2)}\n`);
  const anchorBytes = serializeJson?.('anchor', anchor, canonicalAnchorBytes)
    ?? canonicalAnchorBytes;
  mkdirSync(dirname(join(scratch, derived.anchor)), { recursive: true });
  writeFileSync(join(scratch, derived.anchor), anchorBytes);
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
    const value = JSON.parse(readFileSync(join(scratch, path)));
    value.publicationTransformTestNonce = 'rotated-canonical-receipt';
    writeJson(scratch, path, value);
  }
  const expected = expectedLocalStorePublicationTransform(scratch, qualification);
  for (const [path, bytes] of expected) writeFileSync(join(scratch, path), bytes);
  return { scratch, qualification };
}

test('synthetic withheld records validate without consulting live publication records', () => {
  const scratch = withheldFixture();
  assert.deepEqual(
    [storage, derived].map((record) => validatePublicationRecord(scratch, record).state),
    ['withheld', 'withheld'],
  );
});

test('withheld anchor cannot smuggle a carrier digest', () => {
  const scratch = withheldFixture();
  const path = join(scratch, storage.anchor);
  const value = JSON.parse(readFileSync(path));
  value.carrierSha256 = `sha256:${'a'.repeat(64)}`;
  writeJson(scratch, storage.anchor, value);
  assert.throws(() => validatePublicationRecord(scratch, storage), /carries authority/u);
});

test('target, evidence locator, and receipt shape tampering fail before publication', () => {
  for (const mutate of [
    (value) => { value.negativeTargetProfileIds.pop(); },
    (value) => { value.evidence[0].path = 'tests/forged.json'; },
    (value) => { value.unregistered = true; },
  ]) {
    const scratch = withheldFixture();
    const path = join(scratch, storage.receipt);
    const value = JSON.parse(readFileSync(path));
    mutate(value);
    writeJson(scratch, storage.receipt, value);
    assert.throws(() => validatePublicationRecord(scratch, storage));
  }
});

test('derived receipt rejects storage-evidence substitution while withheld', () => {
  const scratch = withheldFixture();
  const path = join(scratch, derived.receipt);
  const value = JSON.parse(readFileSync(path));
  value.evidence[0] = {
    kind: 'acceptanceCorpus',
    path: 'tests/acceptance/fixtures/agent-safe-storage/acceptance-corpus.2026-08-04.v1.json',
    sha256: `sha256:${'0'.repeat(64)}`,
  };
  writeJson(scratch, derived.receipt, value);
  assert.throws(() => validatePublicationRecord(scratch, derived), /evidence 0 drifted/u);
});

test('synthetic verdict history length can advance without live-record test edits', () => {
  for (const reviewRoundCount of [3, 4]) {
    const scratch = publishedDerivedFixture({ reviewRoundCount });
    assert.equal(validatePublicationRecord(scratch, derived).state, 'published');
  }
});

const derivedScopeOmissionCases = [
  ['src root', (scope) => { scope.roots = []; }],
  ...DERIVED_FORK_IMPLEMENTATION_SCOPE.files.map((path) => [
    path,
    (scope) => { scope.files = scope.files.filter((candidate) => candidate !== path); },
  ]),
  [
    'content-pinned selection policy redundantly scoped',
    (scope) => {
      scope.files.push(DERIVED_FORK_SELECTION_POLICY_PATH);
      scope.files.sort();
    },
  ],
  [
    'otherwise valid nonempty substitute',
    (scope) => {
      scope.roots = [];
      scope.files = ['scripts/check-agent-safe-publication.mjs'];
    },
  ],
];

for (const [label, mutateScope] of derivedScopeOmissionCases) {
  test(`published derived-fork receipt refuses noncanonical scope: ${label}`, () => {
    const scratch = publishedDerivedFixture({
      notReadyReview: 'implementationReviewCodex',
      mutateReceipt: (receipt) => {
        mutateScope(receipt.implementationScope);
        receipt.evidence[0].sha256 = `sha256:${'0'.repeat(64)}`;
      },
    });
    assert.throws(
      () => validatePublicationRecord(scratch, derived),
      /receipt scope does not equal the canonical derived-fork scope/u,
    );
  });
}

test('named-author acceptance binds the exact canonical derived-fork scope', () => {
  const scratch = publishedDerivedFixture({
    mutateAcceptance: (acceptance) => {
      acceptance.implementationScope.files = acceptance.implementationScope.files.filter(
        (path) => path !== 'vendor/ibex',
      );
    },
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /named-author\/source\/component acceptance drifted/u,
  );
});

test('named-author acceptance names the residual v2-to-v3 departing class', () => {
  const scratch = publishedDerivedFixture({
    mutateAcceptance: (acceptance) => {
      acceptance.residualV2DepartingClass.departingRoots.pop();
    },
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /named-author\/source\/component acceptance drifted/u,
  );
});

test('historical author-acceptance locator cannot be rewritten as the current v3 acceptance', () => {
  const scratch = publishedDerivedFixture({
    authorAcceptancePath: historicalDerivedEvidence.at(-1)[1],
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /evidence 12 drifted/u,
  );
});

test('named-author acceptance line date must equal its own locator date', () => {
  const scratch = publishedDerivedFixture({
    mutateAcceptance: (acceptance) => {
      acceptance.authorLine = 'Charlie Cheever — accepted 2026-08-08';
    },
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /named-author\/source\/component acceptance drifted/u,
  );
});

test('named-author acceptance locator cannot predate qualification C', () => {
  const scratch = publishedDerivedFixture({ acceptanceDate: '2026-08-06' });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /authorAcceptance locator date 2026-08-06 predates qualification C commit date 2026-08-07/u,
  );
});

test('current author-acceptance locator cannot rewrite bytes already present at C', () => {
  const scratch = publishedDerivedFixture({
    preexistingDatedEvidenceKind: 'authorAcceptance',
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /authorAcceptance locator already existed at qualification C; dated evidence is append-only/u,
  );
});

test('platform and bounds evidence locators cannot reuse pre-C dated history', () => {
  for (const [options, expectedKind] of [
    [{ platformDate: '2026-08-06' }, 'lifecycleBenchMacos'],
    [{ boundsDate: '2026-08-06' }, 'boundsRatification'],
  ]) {
    const scratch = publishedDerivedFixture(options);
    assert.throws(
      () => validatePublicationRecord(scratch, derived),
      new RegExp(`${expectedKind} locator date 2026-08-06 predates qualification C`),
    );
  }
});

test('published oracle reports out-of-scope post-qualification drift as a standing snapshot', () => {
  const scratch = publishedDerivedFixture();
  commitFixture(
    scratch,
    'publication P with bound evidence',
    ...derivedEvidence.map(([, path]) => path),
    derived.receipt,
    derived.carrier,
    derived.anchor,
  );
  const result = validatePublicationRecord(scratch, derived);
  assert.equal(result.state, 'published');
  assert.equal(result.snapshot.state, 'stands');
  assert.deepEqual(result.snapshot.scopedChanges, []);
  assert.ok(result.snapshot.outOfScopeChanges.length > 0);
  assert.ok(result.snapshot.outOfScopeChanges.some(({ path }) => path.startsWith('llp/reviews/')));
});

test('publication-chain JSON has one canonical parser boundary and no legacy evidence reader', () => {
  const source = readFileSync(join(root, 'scripts/check-agent-safe-publication.mjs'), 'utf8');
  assert.match(source, /no publication-chain JSON is ever read non-canonically/u);
  assert.doesNotMatch(source, /function readEvidenceJson/u);
  const parseSites = source.split('\n').filter((line) => line.includes('JSON.parse('));
  assert.equal(parseSites.length, 5, `unexpected bare JSON.parse site:\n${parseSites.join('\n')}`);
  assert.ok(parseSites.some((line) => line.includes('value = JSON.parse(text)')));
  assert.ok(parseSites.some((line) => line.includes('const schema = JSON.parse(')));
  assert.ok(parseSites.some((line) => line.includes('policy = JSON.parse(')));
});

test('published derived-fork chain accepts final READY after historical NOT READY verdicts', () => {
  const scratch = publishedDerivedFixture();
  assert.equal(validatePublicationRecord(scratch, derived).state, 'published');
});

test('published derived-fork chain refuses an authoritative Scope 1 NOT READY cell', () => {
  const scratch = publishedDerivedFixture({ notReadyReview: 'specReviewCodex' });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /authoritative verdict is not READY/u,
  );
});

test('published derived-fork chain refuses Scope 2 NOT READY despite a quoted READY needle', () => {
  const scratch = publishedDerivedFixture({ notReadyReview: 'implementationReviewFable' });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /authoritative verdict is not READY/u,
  );
});

test('fenced Markdown quotation cannot override a structured NOT READY verdict', () => {
  const scratch = publishedDerivedFixture({
    notReadyReview: 'implementationReviewCodex',
    mutateReview: (kind, bytes) => kind === 'implementationReviewCodex'
      ? Buffer.concat([bytes, Buffer.from([
        '',
        '~~~markdown',
        '## Round 99 — quoted review',
        '### Scope 2 verdict',
        '**READY for implementation/security publication of the narrow local `operating.instance-forks` surface.**',
        '~~~',
        '',
      ].join('\n'))])
      : bytes,
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /authoritative verdict is not READY/u,
  );
});

test('a lower-numbered prose round appended last cannot override structured authority', () => {
  const scratch = publishedDerivedFixture({
    notReadyReview: 'implementationReviewFable',
    mutateReview: (kind, bytes) => kind === 'implementationReviewFable'
      ? Buffer.concat([bytes, Buffer.from([
        '',
        '## Round 1 — historical appendix appended last',
        '### Scope 2 verdict',
        '**READY for publication of the narrow local `operating.instance-forks` surface.**',
        '',
      ].join('\n'))])
      : bytes,
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /authoritative verdict is not READY/u,
  );
});

test('tab-delimited CommonMark headings cannot hide a structured blocking verdict', () => {
  const scratch = publishedDerivedFixture({
    notReadyReview: 'implementationReviewCodex',
    mutateReview: (kind, bytes) => kind === 'implementationReviewCodex'
      ? Buffer.concat([bytes, Buffer.from([
        '',
        '##\tRound 4 — rendered final review',
        '###\tScope 2 verdict',
        '**NOT READY for implementation/security publication of the narrow local `operating.instance-forks` surface.**',
        '',
      ].join('\n'))])
      : bytes,
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /authoritative verdict is not READY/u,
  );
});

test('conflicting duplicate prose tables cannot override a structured Scope 1 refusal', () => {
  const scratch = publishedDerivedFixture({
    notReadyReview: 'specReviewCodex',
    mutateReview: (kind, bytes) => kind === 'specReviewCodex'
      ? Buffer.concat([bytes, Buffer.from([
        '',
        '### Scope 1 re-verdict',
        '| Document | Fork-relevant verdict |',
        '| --- | --- |',
        '| LLP 0163 | **READY** |',
        '| LLP 0164 | **READY** |',
        '| LLP 0165 | **READY** |',
        '',
        '| Document | Fork-relevant verdict |',
        '| --- | --- |',
        '| LLP 0163 | **NOT READY** |',
        '| LLP 0164 | **NOT READY** |',
        '| LLP 0165 | **NOT READY** |',
        '',
      ].join('\n'))])
      : bytes,
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /authoritative verdict is not READY/u,
  );
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

test('published derived-fork chain refuses a missing verdict file', () => {
  const path = 'llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.verdicts.v1.json';
  const scratch = publishedDerivedFixture({ omitReview: path });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /evidence bytes drifted.*verdicts\.v1\.json/u,
  );
});

test('published derived-fork chain refuses malformed verdict JSON', () => {
  const scratch = publishedDerivedFixture({
    malformedVerdict: 'implementationReviewCodexVerdicts',
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /verdict contract is not valid JSON/u,
  );
});

test('published derived-fork chain refuses duplicate status members', () => {
  const scratch = publishedDerivedFixture({
    serializeVerdict: (kind, _value, canonicalBytes) => {
      if (kind !== 'implementationReviewCodexVerdicts') return canonicalBytes;
      const text = canonicalBytes.toString();
      const ready = '        "status": "READY"';
      assert.ok(text.includes(ready));
      return Buffer.from(text.replace(
        ready,
        '        "status": "NOT_READY",\n        "status": "READY"',
      ));
    },
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /verdict contract is not canonical JSON/u,
  );
});

test('published derived-fork chain refuses duplicate verdict members', () => {
  const scratch = publishedDerivedFixture({
    serializeVerdict: (kind, _value, canonicalBytes) => {
      if (kind !== 'implementationReviewCodexVerdicts') return canonicalBytes;
      const text = canonicalBytes.toString();
      const ready = [
        '      "verdict": {',
        '        "kind": "derivedForkPublication",',
        '        "status": "READY"',
        '      }',
      ].join('\n');
      const blocking = [
        '      "verdict": {',
        '        "kind": "derivedForkPublication",',
        '        "status": "NOT_READY"',
        '      }',
      ].join('\n');
      assert.ok(text.includes(ready));
      return Buffer.from(text.replace(ready, `${blocking},\n${ready}`));
    },
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /verdict contract is not canonical JSON/u,
  );
});

test('published derived-fork chain refuses duplicate verdict histories', () => {
  const scratch = publishedDerivedFixture({
    serializeVerdict: (kind, value, canonicalBytes) => {
      if (kind !== 'implementationReviewCodexVerdicts') return canonicalBytes;
      const visiblyBlocking = structuredClone(value.verdicts);
      visiblyBlocking.forEach((entry) => { entry.verdict.status = 'NOT_READY'; });
      const indent = (candidate) => JSON.stringify(candidate, null, 2).replaceAll('\n', '\n  ');
      return Buffer.from([
        '{',
        `  "schemaVersion": ${JSON.stringify(value.schemaVersion)},`,
        `  "verdicts": ${indent(visiblyBlocking)},`,
        `  "verdicts": ${indent(value.verdicts)}`,
        '}',
        '',
      ].join('\n'));
    },
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /verdict contract is not canonical JSON/u,
  );
});

test('A4 refuses a visibly false named-author acceptance with a later duplicate true', () => {
  const scratch = publishedDerivedFixture({
    serializeJson: (kind, _value, canonicalBytes) => {
      if (kind !== 'authorAcceptance') return canonicalBytes;
      const bytes = duplicateTopLevelMember(canonicalBytes, 'accepted', false);
      assert.equal(JSON.parse(bytes).accepted, true, 'fixture must exercise JSON last-wins');
      assert.match(bytes.toString(), /"accepted": false,\n  "accepted": true/u);
      return bytes;
    },
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /derived-fork author acceptance is not canonical JSON/u,
  );
});

test('A5 refuses a restarted READY history hidden behind duplicate accepted history heads', () => {
  const scratch = publishedDerivedFixture({
    acceptMutatedReviewHistories: true,
    mutateVerdict: (kind, value) => {
      if (kind !== 'implementationReviewFableVerdicts') return;
      const final = value.verdicts.at(-1);
      value.verdicts = [{
        ...final,
        round: 1,
        reviewedCommit: final.reviewedCommit,
        previousEntrySha256: null,
        verdict: { kind: 'derivedForkPublication', status: 'READY' },
      }];
    },
    serializeJson: (kind, value, canonicalBytes) => {
      if (kind !== 'authorAcceptance') return canonicalBytes;
      const visibleRoundCount = Math.max(
        ...Object.values(value.reviewHistoryHeads).map(({ roundCount }) => roundCount),
      ) + 3;
      const visibleHeads = Object.fromEntries(Object.entries(value.reviewHistoryHeads).map(([
        historyKind,
      ]) => [historyKind, {
        roundCount: visibleRoundCount,
        headEntrySha256: `sha256:${'a'.repeat(64)}`,
      }]));
      const bytes = duplicateTopLevelMember(
        canonicalBytes,
        'reviewHistoryHeads',
        visibleHeads,
      );
      assert.equal(
        JSON.parse(bytes).reviewHistoryHeads.implementationReviewFableVerdicts.roundCount,
        1,
        'fixture must parse the hidden restarted history head',
      );
      assert.ok(bytes.toString().includes(`"roundCount": ${visibleRoundCount}`));
      return bytes;
    },
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /derived-fork author acceptance is not canonical JSON/u,
  );
});

test('every distinct derived publication-chain JSON artifact rejects duplicate members', () => {
  const cases = [
    ['lifecycleBenchMacos', 'schemaVersion', 'visible.invalid'],
    ['lifecycleBenchLinux', 'schemaVersion', 'visible.invalid'],
    ['boundsRatification', 'schemaVersion', 'visible.invalid'],
    ['specReviewCodexVerdicts', 'schemaVersion', 'visible.invalid'],
    ['specReviewFableVerdicts', 'schemaVersion', 'visible.invalid'],
    ['implementationReviewCodexVerdicts', 'schemaVersion', 'visible.invalid'],
    ['implementationReviewFableVerdicts', 'schemaVersion', 'visible.invalid'],
    ['authorAcceptance', 'accepted', false],
    ['receipt', 'schemaVersion', 'visible.invalid'],
    ['carrier', 'schemaVersion', 'visible.invalid'],
    ['anchor', 'state', 'withheld'],
  ];
  for (const [targetKind, key, visibleValue] of cases) {
    const scratch = publishedDerivedFixture({
      serializeJson: (kind, _value, canonicalBytes) => kind === targetKind
        ? duplicateTopLevelMember(canonicalBytes, key, visibleValue)
        : canonicalBytes,
    });
    assert.throws(
      () => validatePublicationRecord(scratch, derived),
      /is not canonical JSON/u,
      targetKind,
    );
  }
});

test('published derived-fork chain refuses byte-level non-canonical verdict forms', () => {
  const serializers = [
    (_value, canonicalBytes) => Buffer.from(canonicalBytes.toString().trim()),
    (_value, canonicalBytes) => Buffer.concat([Buffer.from(' '), canonicalBytes]),
    (_value, canonicalBytes) => Buffer.from(canonicalBytes.toString().replaceAll('\n', '\r\n')),
    (value) => Buffer.from(`${JSON.stringify(value)}\n`),
  ];
  for (const serialize of serializers) {
    const scratch = publishedDerivedFixture({
      serializeVerdict: (kind, value, canonicalBytes) => (
        kind === 'implementationReviewFableVerdicts'
          ? serialize(value, canonicalBytes)
          : canonicalBytes
      ),
    });
    assert.throws(
      () => validatePublicationRecord(scratch, derived),
      /verdict contract is not canonical JSON/u,
    );
  }
});

test('storage review refuses duplicate fields instead of shadowing a later blocker', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-storage-review-'));
  const path = 'review.md';
  const commit = 'a'.repeat(40);
  const implementationTree = `sha256:${'b'.repeat(64)}`;
  writeFileSync(join(scratch, path), storageReviewBytes('Fable', commit, implementationTree));
  validateReview(scratch, path, 'Fable', commit, implementationTree);
  writeFileSync(join(scratch, path), Buffer.concat([
    readFileSync(join(scratch, path)),
    Buffer.from('**Verdict:** NOT_READY\n'),
  ]));
  assert.throws(
    () => validateReview(scratch, path, 'Fable', commit, implementationTree),
    /review is not READY/u,
  );
});

test('published derived-fork chain refuses a verdict for the wrong commit', () => {
  const scratch = publishedDerivedFixture({
    mutateVerdict: (kind, value) => {
      if (kind === 'implementationReviewCodexVerdicts') {
        value.verdicts.at(-1).reviewedCommit = '0'.repeat(40);
      }
    },
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /reviewed commits are inconsistent|does not name qualification C/u,
  );
});

test('published derived-fork chain refuses nonexistent, uppercase, and sibling ancestry commits', () => {
  const spoofers = [
    (_context) => 'f'.repeat(40),
    ({ commit }) => commit.toUpperCase(),
    ({ scratch, commit }) => execFileSync('git', [
      'commit-tree', `${commit}^{tree}`, '-m', 'synthetic sibling review commit',
    ], { cwd: scratch, encoding: 'utf8' }).trim(),
  ];
  for (const spoof of spoofers) {
    const scratch = publishedDerivedFixture({
      mutateVerdict: (kind, value, context) => {
        if (kind !== 'implementationReviewCodexVerdicts') return;
        value.verdicts[1].reviewedCommit = spoof(context);
        rechainVerdicts(value.verdicts);
      },
    });
    assert.throws(
      () => validatePublicationRecord(scratch, derived),
      /reviewed commit is invalid|reviewed commits are inconsistent/u,
    );
  }
});

test('published derived-fork chain refuses a verdict detached from its prose artifact', () => {
  for (const mutate of [
    (entry) => { entry.reviewArtifact = 'llp/reviews/forged.md'; },
    (entry) => { entry.reviewArtifactSha256 = `sha256:${'0'.repeat(64)}`; },
  ]) {
    const scratch = publishedDerivedFixture({
      mutateVerdict: (kind, value) => {
        if (kind === 'implementationReviewCodexVerdicts') {
          mutate(value.verdicts.at(-1));
        }
      },
    });
    assert.throws(
      () => validatePublicationRecord(scratch, derived),
      /does not bind its exact prose artifact/u,
    );
  }
});

test('published derived-fork chain refuses rewritten prose from an earlier frozen round', () => {
  const scratch = publishedDerivedFixture();
  const reviewKind = 'implementationReviewFable';
  const verdictKind = `${reviewKind}Verdicts`;
  const reviewPath = derivedEvidence.find(([kind]) => kind === reviewKind)[1];
  const verdictPath = derivedEvidence.find(([kind]) => kind === verdictKind)[1];
  const reviewBytes = Buffer.from(readFileSync(join(scratch, reviewPath), 'utf8').replace(
    'Synthetic prose for round 1; the structured sidecar carries authority.',
    'All rounds were READY; the structured sidecar carries authority.',
  ));
  writeFileSync(join(scratch, reviewPath), reviewBytes);

  const verdicts = JSON.parse(readFileSync(join(scratch, verdictPath)));
  verdicts.verdicts.forEach((entry) => {
    entry.reviewArtifactSha256 = digest(reviewBytes);
  });
  rechainVerdicts(verdicts.verdicts);
  const verdictBytes = writeJson(scratch, verdictPath, verdicts);

  const [authorKind, authorPath] = derivedEvidence.at(-1);
  const acceptance = JSON.parse(readFileSync(join(scratch, authorPath)));
  acceptance.evidenceSha256[reviewKind] = digest(reviewBytes);
  acceptance.evidenceSha256[verdictKind] = digest(verdictBytes);
  acceptance.reviewHistoryHeads[verdictKind] = reviewHistoryHead(verdicts);
  const authorBytes = writeJson(scratch, authorPath, acceptance);

  const receipt = JSON.parse(readFileSync(join(scratch, derived.receipt)));
  const rebound = new Map([
    [reviewKind, digest(reviewBytes)],
    [verdictKind, digest(verdictBytes)],
    [authorKind, digest(authorBytes)],
  ]);
  receipt.evidence.forEach((binding) => {
    if (rebound.has(binding.kind)) binding.sha256 = rebound.get(binding.kind);
  });
  const receiptBytes = writeJson(scratch, derived.receipt, receipt);
  const carrier = JSON.parse(readFileSync(join(scratch, derived.carrier)));
  carrier.qualificationReceiptSha256 = digest(receiptBytes);
  const carrierBytes = writeJson(scratch, derived.carrier, carrier);
  const anchor = JSON.parse(readFileSync(join(scratch, derived.anchor)));
  anchor.carrierSha256 = digest(carrierBytes);
  writeJson(scratch, derived.anchor, anchor);

  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /round 1 frozen prose history digest no longer matches/u,
  );
});

test('published derived-fork chain refuses verdict files assigned to the wrong families', () => {
  const scratch = publishedDerivedFixture({
    mutateVerdict: (kind, value) => {
      if (kind === 'specReviewCodexVerdicts') {
        value.verdicts.forEach((entry) => { entry.family = 'fable'; });
        rechainVerdicts(value.verdicts);
      }
      if (kind === 'specReviewFableVerdicts') {
        value.verdicts.forEach((entry) => { entry.family = 'codex'; });
        rechainVerdicts(value.verdicts);
      }
    },
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /verdict family did not match its fixed review artifact/u,
  );
});

test('published derived-fork chain refuses duplicate or missing rounds', () => {
  for (const mutate of [
    (value) => value.verdicts.splice(1, 0, structuredClone(value.verdicts[0])),
    (value) => value.verdicts.splice(1, 1),
  ]) {
    const scratch = publishedDerivedFixture({
      mutateVerdict: (kind, value) => {
        if (kind === 'specReviewCodexVerdicts') mutate(value);
      },
    });
    assert.throws(
      () => validatePublicationRecord(scratch, derived),
      /rounds are missing, duplicated, or non-monotonic/u,
    );
  }
});

test('published derived-fork chain refuses a deleted-and-restarted verdict history', () => {
  const scratch = publishedDerivedFixture({
    mutateVerdict: (kind, value) => {
      if (kind !== 'implementationReviewCodexVerdicts') return;
      const final = value.verdicts.at(-1);
      value.verdicts = [{
        ...final,
        round: 1,
        reviewedCommit: final.reviewedCommit,
        previousEntrySha256: null,
        verdict: {
          kind: 'derivedForkPublication',
          status: 'READY',
        },
      }];
    },
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /does not match the named-author accepted complete history/u,
  );
});

test('published derived-fork chain refuses a truncated and rechained verdict history', () => {
  const scratch = publishedDerivedFixture({
    mutateVerdict: (kind, value) => {
      if (kind !== 'implementationReviewFableVerdicts') return;
      value.verdicts = value.verdicts.slice(1);
      rechainVerdicts(value.verdicts);
    },
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /does not match the named-author accepted complete history/u,
  );
});

test('published derived-fork chain refuses non-monotonic rounds', () => {
  const scratch = publishedDerivedFixture({
    mutateVerdict: (kind, value) => {
      if (kind === 'specReviewFableVerdicts') {
        [value.verdicts[0], value.verdicts[1]] = [value.verdicts[1], value.verdicts[0]];
      }
    },
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /rounds are missing, duplicated, or non-monotonic/u,
  );
});

test('published derived-fork chain refuses unknown verdict fields', () => {
  const scratch = publishedDerivedFixture({
    mutateVerdict: (kind, value) => {
      if (kind === 'implementationReviewFableVerdicts') {
        value.verdicts.at(-1).verdict.unregistered = true;
      }
    },
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /keys drifted/u,
  );
});

test('published derived-fork chain refuses a same-family review pair', () => {
  const scratch = publishedDerivedFixture({
    mutateVerdict: (kind, value) => {
      if (kind === 'implementationReviewFableVerdicts') {
        value.verdicts.forEach((entry) => { entry.family = 'codex'; });
        rechainVerdicts(value.verdicts);
      }
    },
  });
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /did not preserve two distinct model families/u,
  );
});

test('published derived-fork chain refuses zero or missing author acceptance', () => {
  assert.throws(
    () => validatePublicationRecord(publishedDerivedFixture({ zeroAuthorDigest: true }), derived),
    /evidence 12 drifted/u,
  );
  assert.throws(
    () => validatePublicationRecord(publishedDerivedFixture({ omitAuthor: true }), derived),
    /evidence bytes drifted.*author-acceptance\.2026-08-07\.v3\.json/u,
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

test('v3 binds the reviewed scope even when two scopes select the same leaves', () => {
  const { scratch, qualification, scoped, scopedDigest } = qualifiedImplementationScopeFixture();
  const sameLeavesDifferentDeclaration = {
    schemaVersion: IMPLEMENTATION_SCOPE_SCHEMA_VERSION,
    roots: [],
    files: ['src/qualified.rs', 'src/type-swap', 'vendor/ibex'],
  };
  assert.notEqual(
    scopedDigest,
    implementationDigestAt(scratch, qualification, sameLeavesDifferentDeclaration),
  );
  assert.match(scopedDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(scoped, {
    schemaVersion: IMPLEMENTATION_SCOPE_SCHEMA_VERSION,
    roots: ['src'],
    files: ['vendor/ibex'],
  });
});

test('current HEAD policy passes C-bound wave and sibling custody validation', () => {
  const qualificationCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  assert.equal(validateDerivedForkCoverageTransfers(
    root,
    qualificationCommit,
    committedDigestAt(root, qualificationCommit, DERIVED_FORK_SELECTION_POLICY_PATH),
  ).length, 9);
});

test('coverage transfer refuses any departing leaf without a registered frozen-record gate', () => {
  const policy = JSON.parse(readFileSync(
    join(root, DERIVED_FORK_SELECTION_POLICY_PATH),
    'utf8',
  ));
  const departingPaths = DERIVED_FORK_COVERAGE_TRANSFERS.map(({ path }) => path);
  assert.throws(
    () => assertCoverageTransfers({
      root,
      scope: DERIVED_FORK_IMPLEMENTATION_SCOPE,
      departingPaths: [...departingPaths, 'tests/uncovered-wave-record.json'],
      transfers: DERIVED_FORK_COVERAGE_TRANSFERS,
      driftProneGates: policy.driftProneGates,
    }),
    /coverage moved without a frozen-record gate; missing tests\/uncovered-wave-record\.json/u,
  );
});

test('coverage transfer refuses a named gate that does not canonically cover its leaf', () => {
  const policy = JSON.parse(readFileSync(
    join(root, DERIVED_FORK_SELECTION_POLICY_PATH),
    'utf8',
  ));
  const transfers = DERIVED_FORK_COVERAGE_TRANSFERS.map((transfer) => ({ ...transfer }));
  transfers[0].gate = 'client-bundle-metrology';
  assert.throws(
    () => assertCoverageTransfers({
      root,
      scope: DERIVED_FORK_IMPLEMENTATION_SCOPE,
      departingPaths: DERIVED_FORK_COVERAGE_TRANSFERS.map(({ path }) => path),
      transfers,
      driftProneGates: policy.driftProneGates,
    }),
    /tests\/agent_safe_publication_checker_v1\.mjs is not covered by registered drift gate client-bundle-metrology/u,
  );
});

test('coverage transfers require the exact admitted records, triggers, and regeneration command', () => {
  const source = JSON.parse(readFileSync(
    join(root, DERIVED_FORK_SELECTION_POLICY_PATH),
    'utf8',
  ));
  const mutations = [
    (policy) => { delete policy.driftProneGates['local-proof-inventory']; },
    (policy) => {
      policy.driftProneGates['local-proof-inventory'].recordPaths = ['tests/ci_workflows_v0.mjs'];
      policy.driftProneGates['local-proof-inventory'].triggerRules.files = [
        'tests/ci_workflows_v0.mjs',
      ];
    },
    (policy) => {
      policy.driftProneGates['local-proof-inventory'].regenerateCommand = 'true';
    },
  ];
  for (const mutate of mutations) {
    const policy = structuredClone(source);
    mutate(policy);
    assert.throws(
      () => assertCoverageTransfers({
        root,
        scope: DERIVED_FORK_IMPLEMENTATION_SCOPE,
        departingPaths: DERIVED_FORK_COVERAGE_TRANSFERS.map(({ path }) => path),
        transfers: DERIVED_FORK_COVERAGE_TRANSFERS,
        driftProneGates: policy.driftProneGates,
      }),
      /is not covered by registered drift gate/u,
    );
  }
});

test('C-bound sibling custody refuses a policy missing any required gate', () => {
  for (const gate of DERIVED_FORK_SIBLING_CUSTODY_GATES) {
    const scratch = publishedDerivedFixture({
      mutateQualificationPolicy: (policy) => {
        delete policy.driftProneGates[gate];
      },
    });
    assert.throws(
      () => validatePublicationRecord(scratch, derived),
      (error) => {
        assert.match(
          error.message,
          /sibling custody (?:gate .* exact registered definition|transfer .* is not covered)/u,
        );
        assert.ok(error.message.includes(gate), error.message);
        return true;
      },
      gate,
    );
  }
});

test('C-bound sibling custody refuses a trigger that no longer covers its mapped path', () => {
  for (const { path, gate } of DERIVED_FORK_SIBLING_CUSTODY_TRANSFERS) {
    const scratch = publishedDerivedFixture({
      mutateQualificationPolicy: (policy) => {
        const trigger = policy.driftProneGates[gate].triggerRules;
        trigger.files = trigger.files.filter((candidate) => candidate !== path);
      },
    });
    assert.throws(
      () => validatePublicationRecord(scratch, derived),
      (error) => {
        assert.match(error.message, /sibling custody transfer .* is not covered/u);
        assert.ok(error.message.includes(path), error.message);
        assert.ok(error.message.includes(gate), error.message);
        return true;
      },
      path,
    );
  }
});

test('C-bound transfer validation ignores different post-C working-tree policy bytes', () => {
  const scratch = publishedDerivedFixture();
  const receipt = JSON.parse(readFileSync(join(scratch, derived.receipt), 'utf8'));
  const livePolicy = JSON.parse(readFileSync(
    join(scratch, DERIVED_FORK_SELECTION_POLICY_PATH),
    'utf8',
  ));
  delete livePolicy.driftProneGates['local-proof-inventory'];
  writeJson(scratch, DERIVED_FORK_SELECTION_POLICY_PATH, livePolicy);

  assert.throws(
    () => assertCoverageTransfers({
      root: scratch,
      recordCommit: receipt.qualifiedSourceCommit,
      scope: DERIVED_FORK_IMPLEMENTATION_SCOPE,
      departingPaths: DERIVED_FORK_COVERAGE_TRANSFERS.map(({ path }) => path),
      transfers: DERIVED_FORK_COVERAGE_TRANSFERS,
      driftProneGates: livePolicy.driftProneGates,
    }),
    /is not covered by registered drift gate/u,
  );
  assert.equal(validateDerivedForkCoverageTransfers(
    scratch,
    receipt.qualifiedSourceCommit,
    receipt.selectionPolicySha256,
  ).length, 9);
  assert.equal(validatePublicationRecord(scratch, derived).state, 'published');
});

test('receipt and named-author acceptance bind the exact C selection-policy digest', () => {
  for (const [options, refusal] of [
    [{
      mutateReceipt: (receipt) => {
        receipt.selectionPolicySha256 = `sha256:${'e'.repeat(64)}`;
      },
    }, /selection policy digest does not match qualification-C bytes/u],
    [{
      mutateAcceptance: (acceptance) => {
        acceptance.selectionPolicySha256 = `sha256:${'e'.repeat(64)}`;
      },
    }, /named-author\/source\/component acceptance drifted/u],
  ]) {
    assert.throws(
      () => validatePublicationRecord(publishedDerivedFixture(options), derived),
      refusal,
    );
  }
});

test('post-C transfer-policy evolution is out-of-scope and leaves the claim standing', () => {
  const mutations = [
    (policy) => { delete policy.driftProneGates['local-proof-inventory']; },
    (policy) => {
      policy.driftProneGates['local-proof-inventory'].recordPaths = ['tests/ci_workflows_v0.mjs'];
      policy.driftProneGates['local-proof-inventory'].triggerRules.files = [
        'tests/ci_workflows_v0.mjs',
      ];
    },
    (policy) => {
      policy.driftProneGates['local-proof-inventory'].regenerateCommand = 'true';
    },
  ];
  for (const mutate of mutations) {
    const scratch = publishedDerivedFixture();
    const policyPath = DERIVED_FORK_SELECTION_POLICY_PATH;
    const policy = JSON.parse(readFileSync(join(scratch, policyPath), 'utf8'));
    mutate(policy);
    writeJson(scratch, policyPath, policy);
    commitFixture(
      scratch,
      'publication P with tampered transfer policy',
      ...derivedEvidence.map(([, path]) => path),
      derived.receipt,
      derived.carrier,
      derived.anchor,
      policyPath,
    );
    const result = validatePublicationRecord(scratch, derived);
    assert.equal(result.snapshot.state, 'stands');
    assert.deepEqual(result.snapshot.scopedChanges, []);
    assert.ok(result.snapshot.outOfScopeChanges.some(({ status, path }) => (
      status === 'M' && path === policyPath
    )));
  }
});

test('claim snapshot stands when only out-of-scope files change', () => {
  const { scratch, qualification, scoped, scopedDigest } = qualifiedImplementationScopeFixture();
  mkdirSync(join(scratch, 'tests'), { recursive: true });
  writeFileSync(join(scratch, 'tests/wave-shared-proof.mjs'), 'export const wave = 2;\n');
  const publication = commitFixture(
    scratch,
    'change out-of-scope wave proof',
    'tests/wave-shared-proof.mjs',
  );
  const snapshot = evaluateClaimSnapshot(scratch, {
    qualificationCommit: qualification,
    publicationCommit: publication,
    scope: scoped,
  });
  assert.deepEqual(snapshot, {
    state: 'stands',
    scopedChanges: [],
    outOfScopeChanges: [{ status: 'A', path: 'tests/wave-shared-proof.mjs' }],
  });
  assert.equal(assertQualifiedImplementationDigestAtPublication(scratch, {
    capabilityId: 'fixture_capability_v1',
    qualificationCommit: qualification,
    publicationCommit: publication,
    expectedDigest: scopedDigest,
    expectedDigestVersion: SCOPED_IMPLEMENTATION_DIGEST_VERSION,
    implementationScope: scoped,
  }), scopedDigest);
});

test('one-byte src change yields requalificationDue and the published derived-fork claim stands', () => {
  const scratch = publishedDerivedFixture();
  const sourcePath = 'src/qualification-marker.txt';
  writeFileSync(join(scratch, sourcePath), 'derived-fork qualification D\n');
  const publication = commitFixture(scratch, 'change one qualified source byte', sourcePath);

  const result = validatePublicationRecord(scratch, derived);
  assert.equal(result.state, 'published');
  assert.equal(result.snapshot.state, 'stands');
  assert.deepEqual(result.requalificationDue, {
    scopedChanges: [{ status: 'M', path: sourcePath }],
    since: result.commit,
  });
  assert.deepEqual(result.snapshot.requalificationDue, result.requalificationDue);
  assert.equal(result.implementationDigest, implementationDigestAt(
    scratch,
    publication,
    DERIVED_FORK_IMPLEMENTATION_SCOPE,
  ));
});

test('published fork treats structurally regenerated sibling carriers as scoped evolution', () => {
  const scratch = publishedDerivedFixture();
  for (const path of DERIVED_FORK_SIBLING_CHAIN_PATHS) {
    const value = JSON.parse(readFileSync(join(scratch, path), 'utf8'));
    value.fixtureStructuralRegeneration = { afterQualificationC: true };
    writeJson(scratch, path, value);
  }
  const publication = commitFixture(
    scratch,
    'structurally regenerate sibling capability carriers after C',
    ...DERIVED_FORK_SIBLING_CHAIN_PATHS,
  );

  const result = validatePublicationRecord(scratch, derived);
  validatePublishedResultCustody(scratch, result);
  assert.equal(result.state, 'published');
  assert.equal(result.snapshot.state, 'stands');
  assert.deepEqual(
    result.requalificationDue.scopedChanges,
    DERIVED_FORK_SIBLING_CHAIN_PATHS.map((path) => ({ status: 'M', path })),
  );
  assert.equal(result.requalificationDue.since, result.commit);
  assert.equal(result.implementationDigest, implementationDigestAt(
    scratch,
    publication,
    DERIVED_FORK_IMPLEMENTATION_SCOPE,
  ));
});

test('publication-chain tampering still refuses with requalificationDue pending', () => {
  const scratch = publishedDerivedFixture();
  const sourcePath = 'src/qualification-marker.txt';
  writeFileSync(join(scratch, sourcePath), 'derived-fork qualification D\n');
  commitFixture(scratch, 'change one qualified source byte', sourcePath);

  const pending = validatePublicationRecord(scratch, derived);
  assert.equal(pending.state, 'published');
  assert.ok(pending.requalificationDue);

  const [tamperedKind, tamperedPath] = derivedEvidence[3];
  writeFileSync(join(scratch, tamperedPath), 'tampered historical evidence\n');
  assert.throws(
    () => validatePublicationRecord(scratch, derived),
    /evidence bytes drifted at tests\/acceptance\/asset-lifecycle-v1-evidence\.md/u,
    `${tamperedKind} tampering must remain fatal while requalification is due`,
  );
});

test('withdrawal scenario keeps all nine wave leaves out of scope while generic custody stays strict', () => {
  const { scratch, qualification, scoped, scopedDigest } = qualifiedImplementationScopeFixture();
  const ninePaths = DERIVED_FORK_COVERAGE_TRANSFERS.map(({ path }) => path);
  for (const path of ninePaths) {
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    writeFileSync(join(scratch, path), `wave drift at ${path}\n`);
  }
  const waveCommit = commitFixture(scratch, 'reproduce nine wave changes', ...ninePaths);
  const waveSnapshot = evaluateClaimSnapshot(scratch, {
    qualificationCommit: qualification,
    publicationCommit: waveCommit,
    scope: scoped,
  });
  assert.equal(waveSnapshot.state, 'stands');
  assert.deepEqual(waveSnapshot.scopedChanges, []);
  assert.deepEqual(waveSnapshot.outOfScopeChanges.map(({ path }) => path), ninePaths);
  assert.equal(assertQualifiedImplementationDigestAtPublication(scratch, {
    capabilityId: 'fixture_capability_v1',
    qualificationCommit: qualification,
    publicationCommit: waveCommit,
    expectedDigest: scopedDigest,
    expectedDigestVersion: SCOPED_IMPLEMENTATION_DIGEST_VERSION,
    implementationScope: scoped,
  }), scopedDigest);

  writeFileSync(join(scratch, 'src/qualified.rs'), 'pub const QUALIFIED: bool = falsE;\n');
  const runtimeCommit = commitFixture(scratch, 'change one runtime byte', 'src/qualified.rs');
  const runtimeSnapshot = evaluateClaimSnapshot(scratch, {
    qualificationCommit: qualification,
    publicationCommit: runtimeCommit,
    scope: scoped,
  });
  assert.equal(runtimeSnapshot.state, 'invalid');
  assert.deepEqual(runtimeSnapshot.scopedChanges, [{ status: 'M', path: 'src/qualified.rs' }]);
  assert.deepEqual(runtimeSnapshot.outOfScopeChanges.map(({ path }) => path), ninePaths);
  assert.throws(
    () => assertQualifiedImplementationDigestAtPublication(scratch, {
      capabilityId: 'fixture_capability_v1',
      qualificationCommit: qualification,
      publicationCommit: runtimeCommit,
      expectedDigest: scopedDigest,
      expectedDigestVersion: SCOPED_IMPLEMENTATION_DIGEST_VERSION,
      implementationScope: scoped,
    }),
    /scoped surface changed without requalification: M:src\/qualified\.rs/u,
  );
});

test('publication records and fresh dated evidence stay outside the scoped v3 digest', () => {
  const {
    scratch,
    qualification,
    scoped,
    scopedDigest,
  } = qualifiedImplementationScopeFixture();
  const publicationRecords = [
    derived.receipt,
    derived.carrier,
    derived.anchor,
    ...derivedEvidence.slice(0, 3).map(([, path]) => path),
    derivedEvidence.at(-1)[1],
  ];
  for (const path of publicationRecords) {
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    writeFileSync(join(scratch, path), '{"state":"withheld"}\n');
  }
  const carrierCommit = commitFixture(
    scratch,
    'add publication-cycle records',
    ...publicationRecords,
  );
  assert.equal(implementationDigestAt(scratch, qualification, scoped), scopedDigest);
  assert.equal(implementationDigestAt(scratch, carrierCommit, scoped), scopedDigest);

  for (const path of publicationRecords) {
    writeFileSync(join(scratch, path), '{"state":"published"}\n');
  }
  const publication = commitFixture(
    scratch,
    'rotate publication-cycle records',
    ...publicationRecords,
  );
  assert.equal(implementationDigestAt(scratch, publication, scoped), scopedDigest);
});

test('ordinary test files remain implementation-digest-covered', () => {
  const { scratch, qualification, expectedDigest } = qualifiedImplementationScopeFixture();
  mkdirSync(join(scratch, 'tests'), { recursive: true });
  writeFileSync(join(scratch, 'tests/post-qualification-gutting.mjs'), 'process.exit(0);\n');
  const publication = commitFixture(
    scratch,
    'add post-qualification test drift',
    'tests/post-qualification-gutting.mjs',
  );
  assert.equal(implementationDigestAt(scratch, qualification), expectedDigest);
  assert.notEqual(implementationDigestAt(scratch, publication), expectedDigest);
});

test('C-to-P custody permits unrelated demo and LLP churn outside the qualified digest', () => {
  const { scratch, qualification, expectedDigest } = qualifiedImplementationScopeFixture();
  mkdirSync(join(scratch, 'demos/unrelated'), { recursive: true });
  mkdirSync(join(scratch, 'llp'), { recursive: true });
  writeFileSync(join(scratch, 'demos/unrelated/README.md'), 'concurrent demo change\n');
  writeFileSync(join(scratch, 'llp/9999-unrelated.explainer.md'), 'concurrent LLP change\n');
  const publication = commitFixture(
    scratch,
    'unrelated publication churn',
    'demos/unrelated/README.md',
    'llp/9999-unrelated.explainer.md',
  );

  assert.equal(assertQualifiedImplementationDigestAtPublication(scratch, {
    capabilityId: 'fixture_capability_v1',
    qualificationCommit: qualification,
    publicationCommit: publication,
    expectedDigest,
    expectedDigestVersion: IMPLEMENTATION_DIGEST_VERSION,
  }), expectedDigest);
});

test('C-to-P custody refuses a receipt rotated to P that does not match C', () => {
  const { scratch, qualification, expectedDigest: qualificationDigest } =
    qualifiedImplementationScopeFixture();
  writeFileSync(join(scratch, 'src/qualified.rs'), 'pub const QUALIFIED: bool = false;\n');
  const publication = commitFixture(scratch, 'drift qualified source', 'src/qualified.rs');
  const receiptDigest = implementationDigestAt(scratch, publication);

  assert.throws(
    () => assertQualifiedImplementationDigestAtPublication(scratch, {
      capabilityId: 'fixture_capability_v1',
      qualificationCommit: qualification,
      publicationCommit: publication,
      expectedDigest: receiptDigest,
      expectedDigestVersion: IMPLEMENTATION_DIGEST_VERSION,
    }),
    (error) => {
      assert.match(error.message, /in-scope paths drifted: M:src\/qualified\.rs/u);
      assert.ok(error.message.includes(`receipt ${receiptDigest}`));
      assert.ok(error.message.includes(`qualification C ${qualificationDigest}`));
      assert.ok(error.message.includes(`publication P ${receiptDigest}`));
      return true;
    },
  );
});

test('C-to-P custody refuses a receipt matching C when P drifted in scope', () => {
  const { scratch, qualification, expectedDigest } = qualifiedImplementationScopeFixture();
  writeFileSync(join(scratch, 'src/qualified.rs'), 'pub const QUALIFIED: bool = false;\n');
  const publication = commitFixture(scratch, 'drift qualified source', 'src/qualified.rs');
  const actualDigest = implementationDigestAt(scratch, publication);

  assert.throws(
    () => assertQualifiedImplementationDigestAtPublication(scratch, {
      capabilityId: 'fixture_capability_v1',
      qualificationCommit: qualification,
      publicationCommit: publication,
      expectedDigest,
      expectedDigestVersion: IMPLEMENTATION_DIGEST_VERSION,
    }),
    (error) => {
      assert.match(error.message, /in-scope paths drifted: M:src\/qualified\.rs/u);
      assert.ok(error.message.includes(`receipt ${expectedDigest}`));
      assert.ok(error.message.includes(`qualification C ${expectedDigest}`));
      assert.ok(error.message.includes(`publication P ${actualDigest}`));
      return true;
    },
  );
});

test('C-to-P custody refuses a vendor/ibex gitlink change', () => {
  const { scratch, qualification, expectedDigest } = qualifiedImplementationScopeFixture();
  execFileSync('git', [
    'update-index', '--cacheinfo', `160000,${qualification},vendor/ibex`,
  ], { cwd: scratch });
  execFileSync('git', ['commit', '--quiet', '-m', 'drift vendor gitlink'], { cwd: scratch });
  const publication = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: scratch,
    encoding: 'utf8',
  }).trim();
  const actualDigest = implementationDigestAt(scratch, publication);

  assert.throws(
    () => assertQualifiedImplementationDigestAtPublication(scratch, {
      capabilityId: 'fixture_capability_v1',
      qualificationCommit: qualification,
      publicationCommit: publication,
      expectedDigest,
      expectedDigestVersion: IMPLEMENTATION_DIGEST_VERSION,
    }),
    (error) => {
      assert.match(error.message, /in-scope paths drifted: M:vendor\/ibex/u);
      assert.ok(error.message.includes(`receipt ${expectedDigest}`));
      assert.ok(error.message.includes(`qualification C ${expectedDigest}`));
      assert.ok(error.message.includes(`publication P ${actualDigest}`));
      return true;
    },
  );
});

test('C-to-P custody refuses an in-scope executable-mode-only change', () => {
  const { scratch, qualification, expectedDigest } = qualifiedImplementationScopeFixture();
  chmodSync(join(scratch, 'src/qualified.rs'), 0o755);
  const publication = commitFixture(scratch, 'make qualified source executable', 'src/qualified.rs');
  const actualDigest = implementationDigestAt(scratch, publication);
  assert.notEqual(actualDigest, expectedDigest);
  assert.throws(
    () => assertQualifiedImplementationDigestAtPublication(scratch, {
      capabilityId: 'fixture_capability_v1',
      qualificationCommit: qualification,
      publicationCommit: publication,
      expectedDigest,
      expectedDigestVersion: IMPLEMENTATION_DIGEST_VERSION,
    }),
    /in-scope paths drifted: M:src\/qualified\.rs/u,
  );
});

test('C-to-P custody refuses an in-scope file-to-symlink type swap', () => {
  const { scratch, qualification, expectedDigest } = qualifiedImplementationScopeFixture();
  unlinkSync(join(scratch, 'src/type-swap'));
  symlinkSync('qualified-target.rs', join(scratch, 'src/type-swap'));
  const publication = commitFixture(scratch, 'swap qualified file for symlink', 'src/type-swap');
  const actualDigest = implementationDigestAt(scratch, publication);
  assert.notEqual(actualDigest, expectedDigest);
  assert.throws(
    () => assertQualifiedImplementationDigestAtPublication(scratch, {
      capabilityId: 'fixture_capability_v1',
      qualificationCommit: qualification,
      publicationCommit: publication,
      expectedDigest,
      expectedDigestVersion: IMPLEMENTATION_DIGEST_VERSION,
    }),
    /in-scope paths drifted: T:src\/type-swap/u,
  );
});

test('v1-era implementation digests refuse explicitly under the v2 algorithm', () => {
  const { scratch, qualification } = qualifiedImplementationScopeFixture();
  const v1EraDigest = legacyImplementationDigestV1At(scratch, qualification);
  assert.notEqual(v1EraDigest, implementationDigestAt(scratch, qualification));
  assert.throws(
    () => assertQualifiedImplementationDigestAtPublication(scratch, {
      capabilityId: 'fixture_capability_v1',
      qualificationCommit: qualification,
      publicationCommit: qualification,
      expectedDigest: v1EraDigest,
      expectedDigestVersion: 'snapback:agent-safe-implementation-tree:v1',
    }),
    /presents v1-era implementation digest version.*re-qualification.*v2/u,
  );
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
  const buildCycleMirror = build.match(
    /fn agent_safe_publication_cycle_path\(path: &str\) -> bool \{([\s\S]*?)\n\}/u,
  );
  assert.ok(buildCycleMirror, 'build cycle-exclusion mirror is missing');
  const buildCyclePaths = [...buildCycleMirror[1].matchAll(/"([^"]+)"/gu)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(
    buildCyclePaths,
    [...PUBLICATION_CYCLE_ALLOWLIST].sort(),
    'build/checker publication-cycle allowlists drifted in either direction',
  );
  assert.ok(build.includes(
    'cargo:rerun-if-changed=scripts/generated-artifact-policy.mjs',
  ));
  assert.equal(allowedPublicationPath('scripts/generated-artifact-policy.mjs'), false);
  assert.equal(allowedPublicationPath('scripts/check-generated-artifacts'), false);
});

function agentSafeDeclarationFixture(mutate) {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-agent-safe-declaration-'));
  const declarationPath = 'packages/snapback-codegen/index.d.mts';
  const schemaPaths = [
    'schemas/capability.manifest.schema.json',
    'schemas/inspect.schema.json',
    'schemas/inspect.admin.schema.json',
    'schemas/inspect.public.schema.json',
  ];
  for (const path of [declarationPath, ...schemaPaths]) {
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    writeFileSync(join(scratch, path), readFileSync(join(root, path)));
  }
  const declaration = readFileSync(join(scratch, declarationPath), 'utf8');
  writeFileSync(join(scratch, declarationPath), mutate(declaration));
  return scratch;
}

test('AgentSafe codegen declarations match all four Rust-owned schema projections', () => {
  assert.deepEqual(validateAgentSafeCodegenDeclarations(root), {
    definitions: 33,
    schemas: 4,
  });
});

test('AgentSafe declaration gate catches the R11-1 enum spelling drift', () => {
  const scratch = agentSafeDeclarationFixture((declaration) => declaration
    .replace("'denyAll' | 'captureOnly'", "'DenyAll' | 'CaptureOnly'")
    .replace("'notPromotable' | 'promotable'", "'NotPromotable' | 'Promotable'"));
  assert.throws(
    () => validateAgentSafeCodegenDeclarations(scratch),
    /AgentSafeForkEgressV1 enum drifted from committed schemas/u,
  );
});

test('AgentSafe declaration gate catches both R12-1 nested shape drifts', () => {
  const envelopeScratch = agentSafeDeclarationFixture((declaration) => declaration.replace(
    [
      '  readonly ordinaryMutation: AgentSafeEnvelopeCoverageByAdapterV1;',
      '  readonly hostChildMutation: AgentSafeEnvelopeCoverageByAdapterV1;',
    ].join('\n'),
    [
      '  readonly ordinaryIbexMutation: AgentSafeEnvelopeCoverageV1;',
      '  readonly hostPlanSettlement: AgentSafeEnvelopeCoverageV1;',
    ].join('\n'),
  ));
  assert.throws(
    () => validateAgentSafeCodegenDeclarations(envelopeScratch),
    /AgentSafeEnvelopeCoverageByScopeV1 object shape drifted from committed schemas/u,
  );

  const explanationScratch = agentSafeDeclarationFixture((declaration) => declaration.replace(
    '  readonly scopedFacts: readonly AgentSafeScopedExplanationFactV1[];',
    [
      '  readonly ordinaryIbexMutation: AgentSafeExplanationClassV1;',
      '  readonly hostPlanSettlement: AgentSafeExplanationClassV1;',
      '  readonly migration: AgentSafeExplanationClassV1;',
      '  readonly durableBackgroundWork: AgentSafeExplanationClassV1;',
      '  readonly push: AgentSafeExplanationClassV1;',
      '  readonly auth: AgentSafeExplanationClassV1;',
    ].join('\n'),
  ));
  assert.throws(
    () => validateAgentSafeCodegenDeclarations(explanationScratch),
    /AgentSafeExplanationFactsV1 object shape drifted from committed schemas/u,
  );
});

test('generated-artifact registry covers every codegen job exactly once', () => {
  const jobs = CODEGEN_JOBS.map(codegenOutputRoot).sort();
  const policies = [...REVIEW_CACHE_ROOTS, ...FULLY_COMMITTED_ROOTS].sort();
  assert.deepEqual(jobs, policies);
  assert.equal(new Set(jobs).size, jobs.length);
  assert.ok(REVIEW_CACHE_ROOTS.includes('demos/party-wall/snapback/generated'));
  assert.ok(REVIEW_CACHE_ROOTS.includes('demos/triage-graph/snapback/generated'));
  assert.ok(REVIEW_CACHE_ROOTS.includes('demos/chirp/snapback/generated'));
  assert.ok(REVIEW_CACHE_ROOTS.includes('demos/browser-local-first/snapback/generated'));
  assert.ok(REVIEW_CACHE_ROOTS.includes('demos/browser-local-first/snapback-sessions/generated'));
  assert.ok(FULLY_COMMITTED_ROOTS.includes(
    'demos/zero-bakeoff/apps/contention-calendar/snapback/generated',
  ));
  assert.deepEqual(ADMIN_GENERATED_ROOTS, ['admin-ui/generated']);
});

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
  'demos/browser-local-first/snapback-sessions/generated/artifacts.json',
  'demos/browser-local-first/snapback/generated/artifacts.json',
  'demos/campfire/snapback/generated/artifacts.json',
  'demos/card-game/snapback/generated/artifacts.json',
  'demos/catalog-lens/snapback/generated/artifacts.json',
  'demos/chirp/snapback/generated/artifacts.json',
  'demos/competitive-checkpoint/snapback/generated/api.d.ts',
  'demos/competitive-checkpoint/snapback/generated/api.mjs',
  'demos/competitive-checkpoint/snapback/generated/artifacts.json',
  'demos/competitive-checkpoint/snapback/generated/functions.manifest.json',
  'demos/competitive-checkpoint/snapback/generated/schema.manifest.json',
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
  'demos/pointing-room/snapback/generated/artifacts.json',
  'demos/pointing-room/snapback/generated/functions.manifest.json',
  'demos/pointing-room/snapback/generated/schema.manifest.json',
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
  'demos/todo-v2/snapback/generated-remote-service/functions.manifest.json',
  'demos/todo-v2/snapback/generated-remote-service/schema.manifest.json',
  'demos/todo-v2/snapback/generated/artifacts.json',
  'demos/todo-v2/snapback/generated/functions.manifest.json',
  'demos/todo-v2/snapback/generated/schema.manifest.json',
  'demos/todo/snapback/generated/artifacts.json',
  'demos/todo/snapback/generated/functions.manifest.json',
  'demos/todo/snapback/generated/schema.manifest.json',
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
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/client-lifecycle.v1.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/client-lifecycle.manifest.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract-data.manifest.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract/clearReservations.mutation.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract/reservationsForSlot.query.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract/reserve.mutation.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract/resourceList.query.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract/runtime-links.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract/schedule.query.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/functions.manifest.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/handler-runtime-profile.v1.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/handler-typescript-profile.v1.json',
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
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/api-envelope.members.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/api.d.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/api.mjs',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.binding.mjs',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.d.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.descriptor.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.mjs',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/artifacts.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/capability.manifest.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/client-lifecycle.v1.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/client-lifecycle.manifest.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract-data.manifest.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/activityRows.query.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/fixturePresence.ephemeral.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/fixturePresence.publish.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/liveRows.query.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/primaryRows.query.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/publishLiveRow.mutation.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/rejectInvalidWrite.mutation.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/rejectionRows.query.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/runtime-links.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract/writePrimaryAndActivity.mutation.ts',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/functions.manifest.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/handler-runtime-profile.v1.json',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated/handler-typescript-profile.v1.json',
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
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/client-lifecycle.v1.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/client-lifecycle.manifest.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/contract-data.manifest.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/contract/joinAsHost.mutation.ts',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/contract/leaveHost.mutation.ts',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/contract/pushLedger.query.ts',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/contract/runtime-links.ts',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/functions.manifest.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/handler-runtime-profile.v1.json',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated/handler-typescript-profile.v1.json',
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
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/client-lifecycle.v1.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/client-lifecycle.manifest.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract-data.manifest.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/addReaction.mutation.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/annotateMessage.mutation.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/conversationDetails.query.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/membershipsForConversation.query.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/messagesForConversation.query.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/reactionsForConversation.query.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/removeReaction.mutation.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/runtime-links.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/sendMessage.mutation.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/sendReply.mutation.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/sendText.mutation.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/typing.ephemeral.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/typing.publish.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/contract/users.query.ts',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/functions.manifest.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/handler-runtime-profile.v1.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/handler-typescript-profile.v1.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/operations/addReaction.args.schema.json',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated/operations/annotateMessage.args.schema.json',
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
    [...generated.keys()].filter((path) => !isContentAddressedFullyCommittedLeaf(path)),
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

function currentGeneratedPublicationPaths() {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  return generatedPublicationPathsAt(root, head);
}

function assertUnexpectedGeneratedLeaf(generated, unexpectedPath, entry) {
  const widened = new Map(generated).set(unexpectedPath, entry);
  assert.throws(
    () => assertReviewedGeneratedPublicationPaths(widened),
    (error) => {
      assert.deepEqual(error.actual, { unexpected: [unexpectedPath], missing: [] });
      return true;
    },
    unexpectedPath,
  );
}

test('P-vs-C generated allowance exactly enumerates non-content-addressed leaves', () => {
  const generated = currentGeneratedPublicationPaths();
  assertReviewedGeneratedPublicationPaths(generated);

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

test('reviewed leaf set survives app content-address rotation under a fully committed root', () => {
  const generated = currentGeneratedPublicationPaths();

  const registeredRoot = 'packages/snapback-cli/fixtures/comparator/app/snapback/generated';
  const validDigest = '0'.repeat(64);
  const existingBinding = [...generated.keys()].find((path) => (
    path.startsWith(`${registeredRoot}/app.binding.`)
    && isContentAddressedFullyCommittedLeaf(path)
  ));
  const existingDescriptor = [...generated.keys()].find((path) => (
    path.startsWith(`${registeredRoot}/app.descriptor.`)
    && isContentAddressedFullyCommittedLeaf(path)
  ));
  assert.ok(existingBinding, 'comparator fixture has no content-addressed binding leaf');
  assert.ok(existingDescriptor, 'comparator fixture has no content-addressed descriptor leaf');
  const churnedBinding = `${registeredRoot}/app.binding.${validDigest}.mjs`;
  const churnedDescriptor = `${registeredRoot}/app.descriptor.${validDigest}.json`;
  const churned = new Map(generated);
  const bindingEntry = churned.get(existingBinding);
  const descriptorEntry = churned.get(existingDescriptor);
  for (const path of generated.keys()) {
    if (isContentAddressedFullyCommittedLeaf(path)
        && path.startsWith(`${registeredRoot}/`)) {
      churned.delete(path);
    }
  }
  churned.set(churnedBinding, bindingEntry);
  churned.set(churnedDescriptor, descriptorEntry);
  assertReviewedGeneratedPublicationPaths(churned);
});

test('reviewed leaf set rejects a new content-addressed path kind under a registered root', () => {
  const generated = currentGeneratedPublicationPaths();
  const registeredRoot = 'packages/snapback-cli/fixtures/comparator/app/snapback/generated';
  const unexpectedPath = `${registeredRoot}/app.runtime.${'0'.repeat(64)}.mjs`;
  assertUnexpectedGeneratedLeaf(generated, unexpectedPath, generated.values().next().value);
});

test('reviewed leaf set rejects a content-addressed-looking leaf under an unregistered root', () => {
  const generated = currentGeneratedPublicationPaths();
  const registeredRoot = 'packages/snapback-cli/fixtures/comparator/app/snapback/generated';
  const unexpectedPath = `${registeredRoot}/unregistered/app.binding.${'0'.repeat(64)}.mjs`;
  assertUnexpectedGeneratedLeaf(generated, unexpectedPath, generated.values().next().value);
});

test('reviewed leaf set rejects every new non-content-addressed leaf', () => {
  const generated = currentGeneratedPublicationPaths();
  const registeredRoot = 'packages/snapback-cli/fixtures/comparator/app/snapback/generated';
  const unexpectedPath = `${registeredRoot}/brand-new-non-hash.mjs`;
  assertUnexpectedGeneratedLeaf(generated, unexpectedPath, generated.values().next().value);
});

test('content-addressed generated leaf matching is strict', () => {
  const registeredRoot = 'packages/snapback-cli/fixtures/comparator/app/snapback/generated';
  const reviewCacheRoot = 'demos/todo/snapback/generated';
  const validDigest = '0'.repeat(64);
  for (const invalidContentAddressedPath of [
    `${registeredRoot}/app.binding.${'0'.repeat(63)}.mjs`,
    `${registeredRoot}/app.binding.${'A'.repeat(64)}.mjs`,
    `${registeredRoot}/app.binding.${validDigest}.json`,
    `${registeredRoot}/app.descriptor.${validDigest}.mjs`,
    `${registeredRoot}/arbitrary.${validDigest}.mjs`,
    `${reviewCacheRoot}/app.binding.${validDigest}.mjs`,
    `admin-ui/generated/app.binding.${validDigest}.mjs`,
  ]) {
    assert.equal(
      isContentAddressedFullyCommittedLeaf(invalidContentAddressedPath),
      false,
      invalidContentAddressedPath,
    );
  }
  assert.equal(
    isContentAddressedFullyCommittedLeaf(
      `${registeredRoot}/app.binding.${validDigest}.mjs`,
    ),
    true,
  );
  assert.equal(
    isContentAddressedFullyCommittedLeaf(
      `${registeredRoot}/app.descriptor.${validDigest}.json`,
    ),
    true,
  );
});

test('P-vs-C generated allowance admits only qualification-C paths', () => {
  const generated = currentGeneratedPublicationPaths();
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
    'tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.v1.json',
    'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.codex.md',
    'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.fable.md',
    'llp/reviews/0158-instance-forking.implementation-2026-08-06.codex.md',
    'llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.md',
    'tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-06.v1.json',
  ]) {
    assert.equal(allowedPublicationPath(path), true, path);
  }
  for (const [, path] of [
    ...derivedEvidence.slice(0, 3),
    derivedEvidence.at(-1),
  ]) {
    assert.equal(allowedPublicationPath(path), true, path);
    assert.equal(allowedPublicationChange(
      { status: 'A', path }, new Map(), new Map(),
    ), true, `${path} may be appended`);
    assert.equal(allowedPublicationChange(
      { status: 'M', path }, new Map(), new Map(),
    ), false, `${path} may not be rewritten`);
  }
  assert.equal(
    allowedPublicationPath(
      'tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-07.v2.json',
    ),
    false,
  );
  for (const path of ['tests/acceptance/asset-lifecycle-v1-evidence.md']) {
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

test('structural store-carrier tampering belongs to its registered drift gate', () => {
  const carrierPath = LOCAL_STORE_PUBLICATION_TRANSFORM.carrier;
  for (const { path, gate } of DERIVED_FORK_SIBLING_CUSTODY_TRANSFERS) {
    const selection = selectDriftProneGates([path], loadSelectionContext());
    assert.ok(selection.selectedDriftProneGates.includes(gate), `${path} -> ${gate}`);
  }

  const scratch = mkdtempSync(join(tmpdir(), 'snapback-local-store-own-gate-'));
  const carrier = JSON.parse(readFileSync(join(root, carrierPath), 'utf8'));
  const requiredPaths = [
    'tests/conformance/local-persistent-store-publication-v1.mjs',
    'tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-06.v1.json',
    'tests/acceptance/fixtures/triage-graph/budget-freeze.2026-08-06.v1.json',
    'tests/acceptance/fixtures/triage-graph/move1-exit.2026-08-06.v1.json',
    'tests/acceptance/fixtures/fleet-observatory/budget-freeze.2026-08-06.v1.json',
    'tests/acceptance/fixtures/fleet-observatory/move1-exit.2026-08-06.v1.json',
    'src/local-persistent-store-publication.anchor.v1.json',
    carrierPath,
    'schemas/capability.manifest.local-dev-sqlite-ibex.json',
    ...Object.keys(carrier.executorSourceSha256),
    ...Object.keys(carrier.schemaSourceSha256),
    ...Object.keys(carrier.clientSourceSha256),
  ];
  for (const path of new Set(requiredPaths)) {
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    writeFileSync(join(scratch, path), readFileSync(join(root, path)));
  }
  carrier.fixtureStructuralTampering = { ownGateMustRefuse: true };
  writeJson(scratch, carrierPath, carrier);

  // LLP 0175 registers local-store-publication as the recomputing owner for
  // this carrier. The derived-fork checker may report evolution, but this gate
  // must still catch an internally inconsistent carrier/anchor pair.
  const gate = spawnSync(
    process.execPath,
    ['tests/conformance/local-persistent-store-publication-v1.mjs'],
    { cwd: scratch, encoding: 'utf8' },
  );
  assert.notEqual(gate.status, 0);
  assert.match(
    `${gate.stdout ?? ''}${gate.stderr ?? ''}`,
    /Expected values to be strictly deep-equal/u,
  );
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
