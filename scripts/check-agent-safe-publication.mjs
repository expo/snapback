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
  'guide/capabilities.md',
  'guide/guide-flat.generated.md',
  'guide/guide-manifest.generated.json',
  'guide/index.md',
  'schemas/capability.manifest.local-dev-sqlite-ibex.json',
  'schemas/capability.manifest.local-dev-sqlite-ibex.outbound-actions.json',
  'schemas/capability.manifest.schema.json',
  'schemas/inspect.admin.schema.json',
  'schemas/inspect.public.schema.json',
  'schemas/inspect.schema.json',
  'demos/rbac/snapback/generated/artifacts.json',
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
