#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOTS = [
  'Cargo.toml',
  'Cargo.lock',
  'build.rs',
  '.gitmodules',
  'src',
  'packages/snapback-codegen',
  'packages/snapback-contract',
  'tests',
  'scripts/check-agent-safe-publication.mjs',
];

const PUBLICATION_CYCLE_ALLOWLIST = new Set([
  'src/local-agent-safe-storage-publication.anchor.json',
  'src/local-agent-safe-storage-publication.carrier.json',
  'src/local-agent-safe-derived-deployment-fork-publication.anchor.json',
  'src/local-agent-safe-derived-deployment-fork-publication.carrier.json',
  'tests/acceptance/receipts/agent-safe-storage-publication.2026-08-04.v1.json',
  'tests/acceptance/receipts/agent-safe-derived-deployment-fork-publication.2026-08-04.v1.json',
  'tests/acceptance/fixtures/agent-safe-storage/acceptance-corpus.2026-08-04.v1.json',
  'tests/acceptance/fixtures/agent-safe-storage/agent-safe-active-covered-paired.2026-08-04.v1.json',
  'tests/acceptance/fixtures/agent-safe-storage/fork-promotion-performance.2026-08-04.v1.json',
  'tests/acceptance/fixtures/agent-safe-storage/author-acceptance.2026-08-04.v1.json',
  'tests/acceptance/fixtures/latency-kanban/move3-exit.2026-08-04.v1.json',
  'tests/acceptance/latency-kanban-move3-v1-evidence.md',
]);

const EVIDENCE = [
  ['acceptanceCorpus', 'tests/acceptance/fixtures/agent-safe-storage/acceptance-corpus.2026-08-04.v1.json'],
  ['pairedPerformance', 'tests/acceptance/fixtures/agent-safe-storage/agent-safe-active-covered-paired.2026-08-04.v1.json'],
  ['absolutePerformance', 'tests/acceptance/fixtures/agent-safe-storage/fork-promotion-performance.2026-08-04.v1.json'],
  ['independentReviewFable', 'llp/reviews/0162-agent-safe-storage-profile.implementation-2026-08-04.fable.md'],
  ['independentReviewCodex', 'llp/reviews/0162-agent-safe-storage-profile.implementation-2026-08-04.codex.md'],
  ['authorAcceptance', 'tests/acceptance/fixtures/agent-safe-storage/author-acceptance.2026-08-04.v1.json'],
];

const STORAGE_COMPONENTS = [
  'ordinaryMutationHostPlanEnvelope',
  'ordinaryMutationIbexBufferedEnvelope',
  'hostChildMutationHostPlanEnvelope',
  'hostChildMutationIbexBufferedEnvelope',
  'generatedOwnedCrudOwnerCreateHostPlanExplanation',
  'generatedOwnedCrudOwnerUpdateHostPlanExplanation',
];
const DERIVED_COMPONENTS = ['derivedDeploymentForkSafetyV1'];

const RECORDS = [
  {
    id: 'agent_safe_storage_v1',
    anchor: 'src/local-agent-safe-storage-publication.anchor.json',
    carrier: 'src/local-agent-safe-storage-publication.carrier.json',
    receipt: 'tests/acceptance/receipts/agent-safe-storage-publication.2026-08-04.v1.json',
    components: STORAGE_COMPONENTS,
  },
  {
    id: 'agent_safe_derived_deployment_fork_v1',
    anchor: 'src/local-agent-safe-derived-deployment-fork-publication.anchor.json',
    carrier: 'src/local-agent-safe-derived-deployment-fork-publication.carrier.json',
    receipt: 'tests/acceptance/receipts/agent-safe-derived-deployment-fork-publication.2026-08-04.v1.json',
    components: DERIVED_COMPONENTS,
  },
];

const PUBLICATION_ONLY_PATHS = new Set([
  ...PUBLICATION_CYCLE_ALLOWLIST,
  'llp/0158-instance-forking.rfc.md',
  'llp/0000-snapback.explainer.md',
  'llp/0162-agent-safe-storage-profile.rfc.md',
  'llp/0163-operation-identity-and-commit-envelope.spec.md',
  'llp/0164-fork-and-promotion.spec.md',
  'llp/0165-proof-domains-and-checkpoints.spec.md',
  'llp/reviews/0162-agent-safe-storage-profile.implementation-2026-08-04.fable.md',
  'llp/reviews/0162-agent-safe-storage-profile.implementation-2026-08-04.codex.md',
  'issues/20260803-agent-safe-storage-acceptance-tail.md',
  'issues/20260803-0163-public-operation-identity-carrier.md',
  'issues/20260803-guide-gap-instance-forks.md',
  'issues/closed/20260803-agent-safe-storage-acceptance-tail.md',
  'issues/closed/20260803-0163-public-operation-identity-carrier.md',
  'issues/closed/20260803-guide-gap-instance-forks.md',
  'issues/20260803-wave3-program.md',
  'guide/capabilities.md',
  'guide/guide-flat.generated.md',
  'guide/guide-manifest.generated.json',
  'guide/index.md',
  'guide/operating/instance-forks.md',
  'schemas/capability.manifest.local-dev-sqlite-ibex.json',
  'schemas/capability.manifest.local-dev-sqlite-ibex.outbound-actions.json',
  'schemas/capability.manifest.schema.json',
  'schemas/inspect.admin.schema.json',
  'schemas/inspect.public.schema.json',
  'schemas/inspect.schema.json',
  'demos/rbac/snapback/generated/artifacts.json',
  'demos/latency-kanban/snapback/generated/artifacts.json',
  'demos/latency-kanban/snapback/trusted-composition-activation.json',
  'demos/todo-v2/snapback/generated-remote-service/artifacts.json',
  'demos/todo-v2/snapback/generated/artifacts.json',
  'demos/todo/snapback/generated/artifacts.json',
]);

export function allowedPublicationPath(path) {
  return PUBLICATION_ONLY_PATHS.has(path);
}

function fail(message) {
  throw new Error(`agent-safe-publication: ${message}`);
}

function git(root, args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: root, encoding }).toString().trim();
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function isSha256(value, nonzero = false) {
  return /^sha256:[0-9a-f]{64}$/u.test(value ?? '')
    && (!nonzero || value !== `sha256:${'0'.repeat(64)}`);
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value ?? {}).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} keys drifted: ${actual.join(',')}`);
  }
}

function missingFacts() {
  const missingFork = () => ({
    egress: 'Missing', promotion: 'Missing', base: 'Missing', isolation: 'Missing',
  });
  return {
    envelope: {
      ordinaryMutation: { hostPlan: 'Missing', ibexBuffered: 'Missing' },
      hostChildMutation: { hostPlan: 'Missing', ibexBuffered: 'Missing' },
      migration: 'Missing', durableBackgroundWork: 'Missing', push: 'Missing', auth: 'Missing',
    },
    explanation: { scopedFacts: [] },
    forks: { inApp: missingFork(), derivedDeployment: missingFork() },
    diff: { data: 'Missing', effects: 'Missing' },
    history: 'Missing',
    proof: 'Missing',
    replay: { handlers: 'Missing', actions: 'Missing' },
    schemaEvolution: 'Missing',
    resourceBounds: 'Missing',
    aggregate: { core: 'Missing', history: 'Missing' },
  };
}

function ownerFact(profile) {
  return {
    scope: {
      logicalLane: 'ordinaryMutation',
      adapter: 'hostPlan',
      access: 'publicCurrentPolicy',
      profile,
    },
    class: { detail: 'BoundedFacts', retention: 'PolicyBounded' },
  };
}

export function exactCandidate(id) {
  const facts = missingFacts();
  if (id === 'agent_safe_storage_v1') {
    facts.envelope.ordinaryMutation = { hostPlan: 'Covered', ibexBuffered: 'Covered' };
    facts.envelope.hostChildMutation = { hostPlan: 'Covered', ibexBuffered: 'Covered' };
    facts.explanation.scopedFacts = [
      ownerFact('generatedOwnedCrudOwnerCreateV1'),
      ownerFact('generatedOwnedCrudOwnerUpdateV1'),
    ];
    return facts;
  }
  if (id === 'agent_safe_derived_deployment_fork_v1') {
    facts.forks.derivedDeployment = {
      egress: 'denyAll',
      promotion: 'notPromotable',
      base: 'currentHead',
      isolation: 'hostMediated',
    };
    return facts;
  }
  fail(`unknown candidate id ${id}`);
}

function updateTreeDigest(hash, path, bytes) {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(path);
  hash.update(Buffer.from([0]));
  hash.update(length);
  hash.update(bytes);
}

export function implementationDigestAt(root, commit) {
  const names = git(root, ['ls-tree', '-r', '--name-only', commit, '--', ...ROOTS])
    .split('\n')
    .filter(Boolean)
    .filter((path) => !PUBLICATION_CYCLE_ALLOWLIST.has(path))
    .sort();
  if (names.length === 0) fail(`implementation tree at ${commit} is empty`);
  const hash = createHash('sha256');
  hash.update('snapback:agent-safe-implementation-tree:v1\n');
  for (const path of names) {
    updateTreeDigest(hash, path, execFileSync('git', ['show', `${commit}:${path}`], {
      cwd: root,
      maxBuffer: 32 * 1024 * 1024,
    }));
  }
  const gitlink = git(root, ['rev-parse', `${commit}:vendor/ibex`]);
  updateTreeDigest(hash, 'vendor/ibex', Buffer.from(gitlink));
  return `sha256:${hash.digest('hex')}`;
}

function checkedOutImplementationGitlink(root) {
  const expected = git(root, ['rev-parse', 'HEAD:vendor/ibex']);
  const actual = git(root, ['-C', 'vendor/ibex', 'rev-parse', 'HEAD']);
  const rootStatus = git(root, [
    'status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none',
  ]);
  const ibexStatus = git(root, [
    '-C', 'vendor/ibex', 'status', '--porcelain', '--untracked-files=all',
  ]);
  if (actual !== expected || rootStatus !== '' || ibexStatus !== '') {
    fail('publication worktree or checked-out vendor/ibex is dirty/mismatched');
  }
  return actual;
}

export function implementationDigestWorkingTree(root) {
  const checkedOutIbex = checkedOutImplementationGitlink(root);
  const names = execFileSync('git', ['ls-files', '-z', '--', ...ROOTS], { cwd: root })
    .toString()
    .split('\0')
    .filter(Boolean)
    .filter((path) => !PUBLICATION_CYCLE_ALLOWLIST.has(path))
    .sort();
  const hash = createHash('sha256');
  hash.update('snapback:agent-safe-implementation-tree:v1\n');
  for (const path of names) updateTreeDigest(hash, path, readFileSync(join(root, path)));
  updateTreeDigest(hash, 'vendor/ibex', Buffer.from(checkedOutIbex));
  return `sha256:${hash.digest('hex')}`;
}

function validateReceiptShape(receipt, record, published) {
  exactKeys(receipt, [
    'schemaVersion', 'capabilityId', 'qualifiedSourceCommit', 'implementationTreeSha256',
    'candidateFactsSha256', 'qualifiedTargetProfileId', 'negativeTargetProfileIds',
    'negativeBuildDistributions', 'qualifiedComponents', 'evidence',
  ], `${record.id} receipt`);
  if (receipt.schemaVersion !== 'snapback.agent-safe-publication-receipt.v1'
      || receipt.capabilityId !== record.id
      || receipt.qualifiedTargetProfileId !== 'local-dev-sqlite-ibex'
      || JSON.stringify(receipt.negativeTargetProfileIds)
        !== JSON.stringify(['cloudflare-do-sqlite-v8', 'remote-service-sqlite-ibex'])
      || JSON.stringify(receipt.negativeBuildDistributions) !== JSON.stringify(['public-package'])) {
    fail(`${record.id} receipt target/distribution facts drifted`);
  }
  if (receipt.evidence.length !== EVIDENCE.length) fail(`${record.id} evidence count drifted`);
  receipt.evidence.forEach((binding, index) => {
    exactKeys(binding, ['kind', 'path', 'sha256'], `${record.id} evidence ${index}`);
    const [kind, path] = EVIDENCE[index];
    if (binding.kind !== kind || binding.path !== path || !isSha256(binding.sha256, published)) {
      fail(`${record.id} evidence ${index} drifted`);
    }
  });
}

function requireEvidence(condition, message) {
  if (!condition) fail(`published evidence: ${message}`);
}

function readEvidenceJson(root, path, label) {
  try {
    return JSON.parse(readFileSync(join(root, path), 'utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function closeNumber(left, right) {
  return Number.isFinite(left) && Number.isFinite(right)
    && Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
}

function requireClose(left, right, label) {
  requireEvidence(closeNumber(left, right), `${label} disagrees with retained raw observations`);
}

function requireCloseArray(actual, expected, label) {
  requireEvidence(Array.isArray(actual) && actual.length === expected.length,
    `${label} population drifted`);
  actual.forEach((value, index) => requireClose(value, expected[index], `${label}[${index}]`));
}

function upperMedian(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function bootstrapMedianInterval(values) {
  let state = 0x7e57016220260804n;
  const mask = (1n << 64n) - 1n;
  const estimates = [];
  for (let sampleIndex = 0; sampleIndex < 20_000; sampleIndex += 1) {
    const sample = [];
    for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
      state = (state * 6364136223846793005n + 1442695040888963407n) & mask;
      sample.push(values[Number(state % BigInt(values.length))]);
    }
    estimates.push(upperMedian(sample));
  }
  estimates.sort((left, right) => left - right);
  return [estimates[1_000], estimates[19_000]];
}

const PAIRED_METRICS = [
  ['currentPointReadP50Us', 'higherIsWorse', 'twoSidedEquivalence', 5, 'latency'],
  ['currentPointReadP95Us', 'higherIsWorse', 'twoSidedEquivalence', 5, 'latency'],
  ['currentRangeReadP50Us', 'higherIsWorse', 'twoSidedEquivalence', 5, 'latency'],
  ['currentRangeReadP95Us', 'higherIsWorse', 'twoSidedEquivalence', 5, 'latency'],
  ['currentQueryPlanReadP50Us', 'higherIsWorse', 'twoSidedEquivalence', 5, 'latency'],
  ['currentQueryPlanReadP95Us', 'higherIsWorse', 'twoSidedEquivalence', 5, 'latency'],
  ['singleWriterMutationsPerSec', 'lowerIsWorse', 'oneSidedRegression', 15, 'throughput'],
  ['singleWriterMutationP50Us', 'higherIsWorse', 'oneSidedRegression', 15, 'latency'],
  ['singleWriterMutationP95Us', 'higherIsWorse', 'oneSidedRegression', 15, 'latency'],
];

const BYTE_METRICS = [
  'allocatedWriteBytesPerChangedRow',
  'allocatedWriteBytesPerOperation',
  'retainedBytesPerChangedRow',
  'retainedBytesPerOperation',
];

function validatePairedComparisons(value) {
  requireEvidence(Array.isArray(value.rawPairs) && value.rawPairs.length === 11,
    'paired raw observation population drifted');
  value.rawPairs.forEach((pair, index) => {
    requireEvidence(pair.pair === index + 1
      && pair.order === (index % 2 === 0 ? 'baselineThenCandidate' : 'candidateThenBaseline'),
    `paired raw observation ${index + 1} order drifted`);
  });
  requireEvidence(Array.isArray(value.comparisons)
    && value.comparisons.length === PAIRED_METRICS.length,
  'paired comparison vocabulary drifted');
  PAIRED_METRICS.forEach(([metric, direction, boundKind, boundPercent, mode], index) => {
    const comparison = value.comparisons[index];
    requireEvidence(comparison.metric === metric
      && comparison.direction === direction
      && comparison.boundKind === boundKind
      && comparison.boundPercent === boundPercent,
    `paired comparison ${metric} identity/bound drifted`);
    const regressions = value.rawPairs.map((pair) => {
      const baseline = pair.baseline?.[metric];
      const candidate = pair.candidateActiveCovered?.[metric];
      requireEvidence(Number.isFinite(baseline) && baseline > 0 && Number.isFinite(candidate),
        `paired raw metric ${metric} is invalid`);
      return mode === 'throughput'
        ? 100 * (1 - candidate / baseline)
        : 100 * (candidate / baseline - 1);
    });
    const [lower, upper] = bootstrapMedianInterval(regressions);
    const passed = boundKind === 'twoSidedEquivalence'
      ? lower >= -boundPercent && upper <= boundPercent
      : upper <= boundPercent;
    requireCloseArray(comparison.pairedRegressionsPercent, regressions,
      `${metric} paired regressions`);
    requireClose(comparison.pairedMedianRegressionPercent, upperMedian(regressions),
      `${metric} paired median`);
    requireClose(comparison.bootstrap90PercentLower, lower, `${metric} bootstrap lower`);
    requireClose(comparison.bootstrap90PercentUpper, upper, `${metric} bootstrap upper`);
    requireEvidence(comparison.passed === passed && passed,
      `${metric} registered threshold failed`);
  });

  requireEvidence(Array.isArray(value.byteComparisons)
    && value.byteComparisons.length === BYTE_METRICS.length,
  'paired byte observation vocabulary drifted');
  BYTE_METRICS.forEach((metric, index) => {
    const comparison = value.byteComparisons[index];
    const baseline = value.rawPairs.map((pair) => pair.baseline?.[metric]);
    const candidate = value.rawPairs.map((pair) => pair.candidateActiveCovered?.[metric]);
    requireEvidence(comparison.metric === metric
      && comparison.thresholdStatus
        === 'observed; LLP 0162 registers the metric but no numeric byte bound'
      && baseline.every(Number.isSafeInteger)
      && candidate.every(Number.isSafeInteger),
    `${metric} byte observation identity/value drifted`);
    requireEvidence(JSON.stringify(comparison.baselineValues) === JSON.stringify(baseline)
      && JSON.stringify(comparison.candidateActiveCoveredValues) === JSON.stringify(candidate),
    `${metric} byte observations disagree with raw pairs`);
    requireEvidence(comparison.baselineMedian === upperMedian(baseline)
      && comparison.candidateActiveCoveredMedian === upperMedian(candidate),
    `${metric} byte median drifted`);
    const change = baseline.map((base, pairIndex) => (base > 0
      ? 100 * (candidate[pairIndex] / base - 1)
      : null));
    comparison.pairedChangePercent.forEach((actual, pairIndex) => {
      if (change[pairIndex] === null) {
        requireEvidence(actual === null, `${metric} zero-baseline change must be null`);
      } else {
        requireClose(actual, change[pairIndex], `${metric} paired change ${pairIndex}`);
      }
    });
  });
}

function validatePairedIdle(value) {
  const baselineCpu = [];
  const candidateCpu = [];
  const baselineRss = [];
  const candidateRss = [];
  const outputBlocks = [];
  const databaseDeltas = [];
  for (const pair of value.rawPairs) {
    const baseline = pair.baselineIdle;
    const candidate = pair.candidateActiveCoveredIdle;
    requireEvidence(baseline?.durationMs === 5_000 && candidate?.durationMs === 5_000,
      'paired idle duration drifted');
    for (const [label, observation] of [['baseline', baseline], ['candidate', candidate]]) {
      const counters = [
        observation.cpuUserUs,
        observation.cpuSystemUs,
        observation.outputBlockOperations,
        observation.databaseFamilyBytesBefore,
        observation.databaseFamilyBytesAfter,
      ];
      requireEvidence(counters.every((number) => Number.isSafeInteger(number) && number >= 0)
        && Number.isSafeInteger(observation.cpuUserUs + observation.cpuSystemUs)
        && Number.isSafeInteger(
          observation.databaseFamilyBytesAfter - observation.databaseFamilyBytesBefore,
        ),
      `paired ${label} idle counters are invalid`);
      requireEvidence(Number.isFinite(observation.residentKbBefore)
        && observation.residentKbBefore > 0
        && Number.isFinite(observation.residentKbAfter)
        && observation.residentKbAfter > 0,
      `paired ${label} idle RSS observations are invalid`);
    }
    baselineCpu.push(baseline.cpuUserUs + baseline.cpuSystemUs);
    candidateCpu.push(candidate.cpuUserUs + candidate.cpuSystemUs);
    baselineRss.push(baseline.residentKbBefore);
    candidateRss.push(candidate.residentKbBefore);
    outputBlocks.push(candidate.outputBlockOperations);
    databaseDeltas.push(candidate.databaseFamilyBytesAfter - candidate.databaseFamilyBytesBefore);
  }
  const rssRegressions = baselineRss.map((baseline, index) => (
    100 * (candidateRss[index] / baseline - 1)
  ));
  const [rssLower, rssUpper] = bootstrapMedianInterval(rssRegressions);
  const cpuMax = Math.max(...candidateCpu);
  const cpuPassed = cpuMax <= 5_000;
  const rssPassed = rssLower >= -5 && rssUpper <= 5;
  const outputZero = outputBlocks.every((number) => number === 0);
  const databaseZero = databaseDeltas.every((number) => number === 0);
  const diskPassed = outputZero && databaseZero;
  const idle = value.idleGates;
  requireEvidence(idle?.durationMs === 5_000 && idle.cpuResolutionUs === 5_000
    && idle.rssEquivalenceBoundPercent === 5,
  'paired idle gate contract drifted');
  requireEvidence(JSON.stringify(idle.baselineCombinedCpuUs) === JSON.stringify(baselineCpu)
    && JSON.stringify(idle.candidateCombinedCpuUs) === JSON.stringify(candidateCpu)
    && JSON.stringify(idle.candidateOutputBlockOperations) === JSON.stringify(outputBlocks)
    && JSON.stringify(idle.candidateDatabaseFamilyByteDeltas) === JSON.stringify(databaseDeltas),
  'paired idle summaries disagree with raw observations');
  requireCloseArray(idle.baselineRssBeforeKb, baselineRss, 'baseline idle RSS');
  requireCloseArray(idle.candidateRssBeforeKb, candidateRss, 'candidate idle RSS');
  requireCloseArray(idle.pairedRssRegressionsPercent, rssRegressions, 'paired idle RSS regressions');
  requireClose(idle.baselineRssMedianKb, upperMedian(baselineRss), 'baseline RSS median');
  requireClose(idle.candidateRssMedianKb, upperMedian(candidateRss), 'candidate RSS median');
  requireClose(idle.pairedRssMedianRegressionPercent, upperMedian(rssRegressions),
    'paired RSS median regression');
  requireClose(idle.bootstrap90PercentLower, rssLower, 'paired RSS bootstrap lower');
  requireClose(idle.bootstrap90PercentUpper, rssUpper, 'paired RSS bootstrap upper');
  requireEvidence(idle.candidateCpuMaxObservedUs === cpuMax
    && idle.cpuPassed === cpuPassed
    && idle.rssPassed === rssPassed
    && idle.everyCandidateOutputBlockCountZero === outputZero
    && idle.everyCandidateDatabaseFamilyDeltaZero === databaseZero
    && idle.diskPassed === diskPassed
    && idle.passed === (cpuPassed && rssPassed && diskPassed)
    && idle.passed === true,
  'paired idle gate failed or summary drifted');
}

export function validatePairedPerformanceArtifact(value, commit) {
  requireEvidence(value.schemaVersion === 'snapback.agent-safe-active-paired.v2', 'paired schema drifted');
  requireEvidence(value.artifactName === 'agent-safe-active-covered-paired-2026-08-04', 'paired artifact identity drifted');
  requireEvidence(value.date === '2026-08-04', 'paired date drifted');
  requireEvidence(value.candidate?.sourceRevision === commit, 'paired candidate is not exact C');
  requireEvidence(value.candidate?.sourceTreeClean === true, 'paired candidate was dirty');
  requireEvidence(value.candidate?.buildProfile === 'release', 'paired candidate was not release');
  requireEvidence(
    value.candidate?.activeProfile
      === 'serverIssuedClientRange+ordinaryMutationCoverageV1+productionEnvelopeChokePoint',
    'paired candidate did not exercise the active covered carrier',
  );
  requireEvidence(
    value.baseline?.artifactSha256
      === 'sha256:d28d8514f48db3f8a0e4d0c33a1381f12e4ad13eaf6a69187aef9b7fe822ab91',
    'paired baseline digest drifted',
  );
  requireEvidence(value.hardwareClass?.model === 'Mac17,3'
    && value.hardwareClass?.cpu === 'Apple M5'
    && value.hardwareClass?.logicalCpus === 10
    && value.hardwareClass?.memoryBytes === 34_359_738_368,
  'paired hardware class drifted');
  requireEvidence(value.protocol?.recordedPairs === 11
    && value.protocol?.warmupsPerExecutable === 1
    && value.protocol?.bootstrapSamples === 20_000,
  'paired protocol population drifted');
  validatePairedComparisons(value);
  validatePairedIdle(value);
  requireEvidence(value.measuredComparativeThresholdsPassed === true
    && value.comparisons.every(({ passed }) => passed === true)
    && value.idleGates.passed === true,
  'paired aggregate threshold failed');
  requireEvidence(value.fullRow13ProtocolQualified === false,
    'paired artifact must defer full row 13 to composed evidence');
}

function validatePairedPerformance(root, commit) {
  const path = EVIDENCE[1][1];
  validatePairedPerformanceArtifact(readEvidenceJson(root, path, 'paired performance'), commit);
}

function statistics(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const median = upperMedian(sorted);
  return {
    median,
    mad: upperMedian(sorted.map((value) => Math.abs(value - median))),
    min: sorted[0],
    max: sorted.at(-1),
  };
}

function nearestRank(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(quantile * sorted.length);
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))];
}

export function validateAbsolutePerformanceArtifact(value, commit) {
  requireEvidence(value.schemaVersion === 'snapback.fork-promotion-performance.v3', 'absolute schema drifted');
  requireEvidence(value.artifactName === 'agent-safe-fork-promotion-absolute-2026-08-04', 'absolute artifact identity drifted');
  requireEvidence(value.date === '2026-08-04', 'absolute date drifted');
  requireEvidence(value.sourceRevision === commit && value.sourceTreeClean === true,
    'absolute candidate is not exact clean C');
  requireEvidence(
    value.baselineArtifact?.sha256
      === 'sha256:d28d8514f48db3f8a0e4d0c33a1381f12e4ad13eaf6a69187aef9b7fe822ab91',
    'absolute baseline digest drifted',
  );
  requireEvidence(value.hardwareClass?.model === 'Mac17,3'
    && value.hardwareClass?.cpu === 'Apple M5'
    && value.hardwareClass?.logicalCpus === 10
    && value.hardwareClass?.memoryBytes === 34_359_738_368,
  'absolute hardware class drifted');
  requireEvidence(value.fixture?.logicalRows === 512
    && value.fixture?.wholeRunWarmups === 1
    && value.fixture?.perMetricWarmups === 4
    && value.fixture?.recordedRuns === 11
    && value.fixture?.contentionSamples === 128
    && value.fixture?.contentionWorkers === 8,
  'absolute fixture/protocol population drifted');
  requireEvidence(Array.isArray(value.rawRuns) && value.rawRuns.length === 11,
    'absolute raw-run population drifted');
  for (const [summaryName, rawName] of [
    ['forkCreation', 'forkCreationUs'],
    ['exactDiff', 'exactDiffUs'],
    ['promotion', 'promotionUs'],
    ['ttlReap', 'ttlReapUs'],
  ]) {
    const raw = value.rawRuns.map((run) => run[rawName]);
    requireEvidence(raw.every((number) => Number.isFinite(number) && number >= 0),
      `absolute ${summaryName} raw observations are invalid`);
    const computed = statistics(raw);
    for (const key of ['median', 'mad', 'min', 'max']) {
      requireClose(value.summaryUs?.[summaryName]?.[key], computed[key],
        `absolute ${summaryName} ${key}`);
    }
  }
  requireEvidence(value.absoluteBounds?.forkCreationMedianUs === 1_000
    && value.absoluteBounds?.exactDiffMedianUs === 2_500
    && value.absoluteBounds?.promotionMedianUs === 7_500
    && value.absoluteBounds?.ttlReapMedianUs === 250
    && value.absoluteBounds?.ordinaryWriterContentionP99Us === 1_250_000,
  'absolute author-ratified bounds drifted');
  const samples = value.contention?.rawRequestToCommitUs;
  requireEvidence(value.contention?.metric === 'ordinaryWriterReservationRequestToCommitP99Us'
    && value.contention?.reservationIntervalMs === 1_000
    && value.contention?.maximumPromotionCommitDurationMs === 500
    && Array.isArray(samples) && samples.length === 128
    && samples.every((number) => Number.isFinite(number) && number >= 0)
    && value.contention.initialDeferredWorkerCount === 8
    && value.contention.deferredSampleCount > 0,
  'active-carrier contention contract/population drifted');
  for (const [key, quantile] of [['p50Us', 0.5], ['p95Us', 0.95], ['p99Us', 0.99]]) {
    requireClose(value.contention[key], nearestRank(samples, quantile), `contention ${key}`);
  }
  requireClose(value.contention.maxUs, Math.max(...samples), 'contention max');
  const boundsPassed = value.summaryUs.forkCreation.median <= 1_000
    && value.summaryUs.exactDiff.median <= 2_500
    && value.summaryUs.promotion.median <= 7_500
    && value.summaryUs.ttlReap.median <= 250
    && value.contention.p99Us <= 1_250_000;
  requireEvidence(value.absoluteBoundsPassed === boundsPassed && boundsPassed,
    'absolute operation/contention bound failed or summary drifted');
  requireEvidence(value.promotionEgressScope
    === 'DenyAll/no-effects only; CaptureOnly intent publication and settlement are not measured',
  'absolute artifact widened its egress scope');
}

function validateAbsolutePerformance(root, commit) {
  const path = EVIDENCE[2][1];
  const value = readEvidenceJson(root, path, 'absolute performance');
  validateAbsolutePerformanceArtifact(value, commit);
}

function validateAcceptanceCorpus(root, commit, implementationTree) {
  const path = EVIDENCE[0][1];
  const value = readEvidenceJson(root, path, 'acceptance corpus');
  requireEvidence(value.schemaVersion === 'snapback.agent-safe-storage-acceptance-corpus.v1',
    'acceptance corpus schema drifted');
  requireEvidence(value.date === '2026-08-04'
    && value.qualifiedSourceCommit === commit
    && value.implementationTreeSha256 === implementationTree
    && value.qualifiedTargetProfileId === 'local-dev-sqlite-ibex',
  'acceptance corpus source/target identity drifted');
  requireEvidence(JSON.stringify(value.qualifiedComponents) === JSON.stringify(STORAGE_COMPONENTS),
    'acceptance corpus component scope drifted');
  requireEvidence(Array.isArray(value.acceptanceRows)
    && JSON.stringify(value.acceptanceRows.map(({ row }) => row)) === JSON.stringify([1, 2, 3, 4, 13, 14])
    && value.acceptanceRows.every(({ status }) => status === 'PASS'),
  'acceptance rows 1-4, 13, and 14 did not all pass');
  requireEvidence(value.correctness?.ownCorrectness === 'PASS'
    && value.correctness?.applicableCrashReopen === 'PASS'
    && value.correctness?.routePolicy === 'PASS'
    && value.correctness?.referenceIntegrity === 'PASS'
    && value.correctness?.guide === 'PASS',
  'acceptance own-correctness gates did not all pass');
  requireEvidence(value.performance?.pairedThresholdsPassed === true
    && value.performance?.absoluteBoundsPassed === true
    && value.performance?.activeContentionP99Passed === true
    && value.performance?.composedRow13Passed === true,
  'acceptance performance composition failed');
  for (const key of [
    'aggregates', 'specializedWriters', 'migrationEnvelope', 'inAppFork',
    'derivedDeploymentFork', 'effectSettlement', 'nonLocalTargets', 'publicPackage',
  ]) {
    requireEvidence(value.scope?.[key] === 'Missing', `${key} was not explicitly Missing`);
  }
  requireEvidence(value.overallStatus === 'PASS', 'acceptance corpus overall status is not PASS');
}

function markdownField(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = text.match(new RegExp(`^\\*\\*${escaped}:\\*\\*\\s+(.+)$`, 'mu'));
  return match?.[1].replaceAll('`', '').trim();
}

function validateReview(root, path, family, commit, implementationTree) {
  const text = readFileSync(join(root, path), 'utf8');
  requireEvidence(markdownField(text, 'Reviewer family') === family,
    `${family} review family drifted`);
  requireEvidence(markdownField(text, 'Verdict') === 'READY', `${family} review is not READY`);
  requireEvidence(markdownField(text, 'Reviewed commit') === commit,
    `${family} review did not inspect exact C`);
  requireEvidence(markdownField(text, 'Implementation tree SHA-256') === implementationTree,
    `${family} review implementation digest drifted`);
  requireEvidence(markdownField(text, 'Qualified capability') === 'agent_safe_storage_v1',
    `${family} review qualified the wrong capability`);
  requireEvidence(markdownField(text, 'Qualified components') === STORAGE_COMPONENTS.join(', '),
    `${family} review component scope drifted`);
  requireEvidence(markdownField(text, 'Derived capability') === 'WITHHELD (Missing)',
    `${family} review widened the derived capability`);
  requireEvidence(markdownField(text, 'Broader capability facts') === 'Missing',
    `${family} review widened broader facts`);
  requireEvidence(markdownField(text, 'Reviewed LLPs') === '0158, 0163, 0164, 0165',
    `${family} review did not cover every status transition`);
  requireEvidence(markdownField(text, 'Status recommendation') === 'Accepted',
    `${family} review did not recommend Accepted status`);
  requireEvidence(
    markdownField(text, 'LLP 0158 OQ9 disposition')
      === 'READY (in-document amendment pattern sufficient)',
    `${family} review did not adjudicate LLP 0158 OQ9`,
  );
}

function validateAuthorAcceptance(root, commit, implementationTree) {
  const path = EVIDENCE[5][1];
  const value = readEvidenceJson(root, path, 'author acceptance');
  requireEvidence(value.schemaVersion === 'snapback.agent-safe-storage-author-acceptance.v1'
    && value.date === '2026-08-04'
    && value.author === 'Charlie Cheever'
    && value.accepted === true
    && value.authorizationSource === 'explicit-user-instruction-2026-08-04',
  'named-author acceptance identity or decision drifted');
  requireEvidence(value.qualifiedSourceCommit === commit
    && value.implementationTreeSha256 === implementationTree
    && value.qualifiedCapability === 'agent_safe_storage_v1'
    && JSON.stringify(value.qualifiedComponents) === JSON.stringify(STORAGE_COMPONENTS),
  'author acceptance source or component scope drifted');
  requireEvidence(JSON.stringify(value.acceptedLlps) === JSON.stringify(['0158', '0163', '0164', '0165']),
    'author acceptance LLP scope drifted');
  requireEvidence(value.derivedCapabilityState === 'Missing'
    && value.broaderCapabilityFactsState === 'Missing',
  'author acceptance widened withheld facts');
  const reviewDigests = value.reviewSha256 ?? {};
  requireEvidence(reviewDigests.fable === sha256(readFileSync(join(root, EVIDENCE[3][1])))
    && reviewDigests.codex === sha256(readFileSync(join(root, EVIDENCE[4][1]))),
  'author acceptance did not bind both review bytes');
  const evidenceDigests = value.evidenceSha256 ?? {};
  requireEvidence(evidenceDigests.acceptanceCorpus === sha256(readFileSync(join(root, EVIDENCE[0][1])))
    && evidenceDigests.pairedPerformance === sha256(readFileSync(join(root, EVIDENCE[1][1])))
    && evidenceDigests.absolutePerformance === sha256(readFileSync(join(root, EVIDENCE[2][1]))),
  'author acceptance did not bind the corpus and both performance records');
}

export function validatePublishedEvidenceSemantics(root, record, commit) {
  if (record.id !== 'agent_safe_storage_v1') {
    fail(`${record.id} has no dedicated end-to-end F0b performance evidence contract`);
  }
  const implementationTree = implementationDigestAt(root, commit);
  validatePairedPerformance(root, commit);
  validateAbsolutePerformance(root, commit);
  validateAcceptanceCorpus(root, commit, implementationTree);
  validateReview(root, EVIDENCE[3][1], 'Fable', commit, implementationTree);
  validateReview(root, EVIDENCE[4][1], 'Codex', commit, implementationTree);
  validateAuthorAcceptance(root, commit, implementationTree);
}

export function validatePublicationRecord(root, record) {
  const anchorBytes = readFileSync(join(root, record.anchor));
  const carrierBytes = readFileSync(join(root, record.carrier));
  const receiptBytes = readFileSync(join(root, record.receipt));
  const anchor = JSON.parse(anchorBytes);
  const carrier = JSON.parse(carrierBytes);
  const receipt = JSON.parse(receiptBytes);
  exactKeys(anchor, ['schemaVersion', 'capabilityId', 'state', 'carrierSha256'], `${record.id} anchor`);
  exactKeys(carrier, [
    'schemaVersion', 'capabilityId', 'targetProfileId', 'maturity', 'qualifiedSourceCommit',
    'implementationTreeSha256', 'candidateFactsSha256', 'qualificationReceiptSha256',
    'buildProvenanceRequirement', 'candidateFacts',
  ], `${record.id} carrier`);
  if (anchor.schemaVersion !== 'snapback.local-capability-publication-anchor.v1'
      || anchor.capabilityId !== record.id
      || !['withheld', 'published'].includes(anchor.state)) {
    fail(`${record.id} anchor identity/state drifted`);
  }
  const published = anchor.state === 'published';
  validateReceiptShape(receipt, record, published);
  if (!published) {
    if (anchor.carrierSha256 !== null) fail(`${record.id} withheld anchor carries authority`);
    return { id: record.id, state: 'withheld' };
  }
  if (!isSha256(anchor.carrierSha256, true) || anchor.carrierSha256 !== sha256(carrierBytes)) {
    fail(`${record.id} anchor/carrier digest mismatch`);
  }
  if (carrier.schemaVersion !== 'snapback.local-agent-safe-publication.v1'
      || carrier.capabilityId !== record.id
      || carrier.targetProfileId !== 'local-dev-sqlite-ibex'
      || carrier.maturity !== 'experimental'
      || carrier.buildProvenanceRequirement !== 'known-clean-contributor-source'
      || carrier.qualificationReceiptSha256 !== sha256(receiptBytes)
      || JSON.stringify(carrier.candidateFacts) !== JSON.stringify(exactCandidate(record.id))
      || carrier.candidateFactsSha256 !== sha256(Buffer.from(JSON.stringify(carrier.candidateFacts)))
      || receipt.candidateFactsSha256 !== carrier.candidateFactsSha256
      || receipt.implementationTreeSha256 !== carrier.implementationTreeSha256
      || receipt.qualifiedSourceCommit !== carrier.qualifiedSourceCommit
      || JSON.stringify(receipt.qualifiedComponents) !== JSON.stringify(record.components)) {
    fail(`${record.id} exact carrier/candidate/receipt binding failed`);
  }
  if (!/^[0-9a-f]{40}$/u.test(carrier.qualifiedSourceCommit)
      || !isSha256(carrier.implementationTreeSha256, true)) {
    fail(`${record.id} source/tree identity is invalid`);
  }
  for (const binding of receipt.evidence) {
    const path = join(root, binding.path);
    if (!existsSync(path) || sha256(readFileSync(path)) !== binding.sha256) {
      fail(`${record.id} evidence bytes drifted at ${binding.path}`);
    }
  }
  validatePublishedEvidenceSemantics(root, record, carrier.qualifiedSourceCommit);
  return { id: record.id, state: 'published', commit: carrier.qualifiedSourceCommit };
}

export function runChecker(root) {
  const publication = git(root, ['rev-parse', 'HEAD']);
  const results = RECORDS.map((record) => validatePublicationRecord(root, record));
  for (const result of results.filter(({ state }) => state === 'published')) {
    try {
      git(root, ['merge-base', '--is-ancestor', result.commit, publication]);
    } catch {
      fail(`${result.id} qualification commit is not an ancestor of publication HEAD`);
    }
    const carrier = JSON.parse(readFileSync(join(root, RECORDS.find(({ id }) => id === result.id).carrier)));
    const changedAfterQualification = git(root, [
      'diff', '--name-only', `${result.commit}..${publication}`,
    ]).split('\n').filter(Boolean);
    const forbidden = changedAfterQualification.filter((path) => !allowedPublicationPath(path));
    if (forbidden.length > 0) {
      fail(`${result.id} P changed forbidden post-qualification paths: ${forbidden.join(',')}`);
    }
    const atQualification = implementationDigestAt(root, result.commit);
    const atPublication = implementationDigestWorkingTree(root);
    if (carrier.implementationTreeSha256 !== atQualification
        || atQualification !== atPublication) {
      fail(`${result.id} P-vs-C implementation tree drifted`);
    }
    checkedOutImplementationGitlink(root);
  }
  return results;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg >= 0
    ? resolve(process.argv[rootArg + 1])
    : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const results = runChecker(root);
  process.stdout.write(`${results.map(({ id, state }) => `${id}:${state}`).join('\n')}\n`);
}
