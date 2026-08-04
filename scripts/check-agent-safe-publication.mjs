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

export function implementationDigestWorkingTree(root) {
  const names = execFileSync('git', ['ls-files', '-z', '--', ...ROOTS], { cwd: root })
    .toString()
    .split('\0')
    .filter(Boolean)
    .filter((path) => !PUBLICATION_CYCLE_ALLOWLIST.has(path))
    .sort();
  const hash = createHash('sha256');
  hash.update('snapback:agent-safe-implementation-tree:v1\n');
  for (const path of names) updateTreeDigest(hash, path, readFileSync(join(root, path)));
  updateTreeDigest(hash, 'vendor/ibex', Buffer.from(git(root, ['rev-parse', 'HEAD:vendor/ibex'])));
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

function validatePairedPerformance(root, commit) {
  const path = EVIDENCE[1][1];
  const value = readEvidenceJson(root, path, 'paired performance');
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
  requireEvidence(Array.isArray(value.rawPairs) && value.rawPairs.length === 11,
    'paired raw observation population drifted');
  requireEvidence(Array.isArray(value.comparisons) && value.comparisons.length === 9
    && value.comparisons.every(({ passed }) => passed === true),
  'paired registered thresholds did not all pass');
  requireEvidence(value.idleGates?.passed === true
    && value.measuredComparativeThresholdsPassed === true,
  'paired CPU/RSS/disk or aggregate threshold failed');
  requireEvidence(value.fullRow13ProtocolQualified === false,
    'paired artifact must defer full row 13 to composed evidence');
}

function validateAbsolutePerformance(root, commit) {
  const path = EVIDENCE[2][1];
  const value = readEvidenceJson(root, path, 'absolute performance');
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
  requireEvidence(value.absoluteBoundsPassed === true,
    'absolute operation bound failed');
  requireEvidence(value.absoluteBounds?.forkCreationMedianUs === 1_000
    && value.absoluteBounds?.exactDiffMedianUs === 2_500
    && value.absoluteBounds?.promotionMedianUs === 7_500
    && value.absoluteBounds?.ttlReapMedianUs === 250
    && value.absoluteBounds?.ordinaryWriterContentionP99Us === 1_250_000,
  'absolute author-ratified bounds drifted');
  requireEvidence(Array.isArray(value.contention?.rawRequestToCommitUs)
    && value.contention.rawRequestToCommitUs.length === 128
    && value.contention.initialDeferredWorkerCount === 8
    && value.contention.deferredSampleCount > 0
    && value.contention.p99Us <= 1_250_000,
  'active-carrier contention population or p99 failed');
  requireEvidence(value.promotionEgressScope
    === 'DenyAll/no-effects only; CaptureOnly intent publication and settlement are not measured',
  'absolute artifact widened its egress scope');
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
    if (git(root, ['status', '--porcelain']) !== '') fail(`${result.id} publication tree is dirty`);
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
