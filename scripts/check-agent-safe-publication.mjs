#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADMIN_GENERATED_ROOTS,
  FULLY_COMMITTED_ROOTS,
  REVIEW_CACHE_ROOTS,
} from './generated-artifact-policy.mjs';

const STORAGE_EVIDENCE = [
  ['acceptanceCorpus', 'tests/acceptance/fixtures/agent-safe-storage/acceptance-corpus.2026-08-04.v1.json'],
  ['pairedPerformance', 'tests/acceptance/fixtures/agent-safe-storage/agent-safe-active-covered-paired.2026-08-04.v1.json'],
  ['absolutePerformance', 'tests/acceptance/fixtures/agent-safe-storage/fork-promotion-performance.2026-08-04.v1.json'],
  ['independentReviewFable', 'llp/reviews/0162-agent-safe-storage-profile.implementation-2026-08-04.fable.md'],
  ['independentReviewCodex', 'llp/reviews/0162-agent-safe-storage-profile.implementation-2026-08-04.codex.md'],
  ['authorAcceptance', 'tests/acceptance/fixtures/agent-safe-storage/author-acceptance.2026-08-04.v1.json'],
];

// @ref LLP 0158#capability-registry-record — the guide-row witness has a
// closed fork-specific vocabulary; storage evidence cannot substitute for it.
const DERIVED_FORK_EVIDENCE = [
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

export const IMPLEMENTATION_ROOTS = [
  'Cargo.toml',
  'Cargo.lock',
  'build.rs',
  '.gitmodules',
  'src',
  'packages/snapback-codegen',
  'packages/snapback-contract',
  'tests',
  'scripts/check-agent-safe-publication.mjs',
  'scripts/generated-artifact-policy.mjs',
];

export const PUBLICATION_CYCLE_ALLOWLIST = new Set([
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
  // These fork records necessarily name or accept qualification C, so they
  // arise in publication P and must not participate in C's implementation digest.
  'tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json',
  'tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.linux-x86_64.v1.json',
  'tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-06.v1.json',
  'tests/acceptance/fixtures/latency-kanban/move3-exit.2026-08-04.r2.v1.json',
  'tests/acceptance/latency-kanban-move3-v1-evidence.md',
  'tests/acceptance/fixtures/triage-graph/move1-exit.2026-08-06.v1.json',
  'tests/acceptance/fixtures/triage-graph/budget-freeze.2026-08-06.v1.json',
  'tests/acceptance/triage-graph-move1-v1-evidence.md',
  'tests/acceptance/fixtures/fleet-observatory/move1-exit.2026-08-06.v1.json',
  'tests/acceptance/fixtures/fleet-observatory/budget-freeze.2026-08-06.v1.json',
  'tests/acceptance/fleet-observatory-move1-v1-evidence.md',
  'tests/acceptance/fixtures/contention-calendar/rung2-exit.2026-08-04.r1.v1.json',
  'tests/acceptance/contention-calendar-rung2-v1-evidence.md',
  'tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-06.v1.json',
  'tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-06.v1.json',
  'tests/acceptance/local-store-carrier-exit-v1-evidence.md',
  'src/local-persistent-store-publication.anchor.v1.json',
  'src/local-persistent-store-publication.v1.json',
]);

export const LOCAL_STORE_PUBLICATION_TRANSFORM = {
  anchor: 'src/local-persistent-store-publication.anchor.v1.json',
  carrier: 'src/local-persistent-store-publication.v1.json',
  receipts: [
    {
      path: 'tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-06.v1.json',
      value: (carrier) => carrier.qualificationReceiptSha256,
    },
    {
      path: 'tests/acceptance/fixtures/triage-graph/budget-freeze.2026-08-06.v1.json',
      value: (carrier) => carrier.supportingReceiptSha256?.triageBudgetFreeze,
    },
    {
      path: 'tests/acceptance/fixtures/triage-graph/move1-exit.2026-08-06.v1.json',
      value: (carrier) => carrier.supportingReceiptSha256?.triageMove1Exit,
    },
  ],
};

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
  'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.codex.md',
  'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.codex.verdicts.v1.json',
  'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.fable.md',
  'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.fable.verdicts.v1.json',
  'llp/reviews/0158-instance-forking.implementation-2026-08-06.codex.md',
  'llp/reviews/0158-instance-forking.implementation-2026-08-06.codex.verdicts.v1.json',
  'llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.md',
  'llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.verdicts.v1.json',
  'issues/20260803-agent-safe-storage-acceptance-tail.md',
  'issues/20260803-0163-public-operation-identity-carrier.md',
  'issues/20260803-guide-gap-instance-forks.md',
  'issues/20260806-derived-fork-publication-author-gate.md',
  'issues/closed/20260803-agent-safe-storage-acceptance-tail.md',
  'issues/closed/20260803-0163-public-operation-identity-carrier.md',
  'issues/closed/20260803-guide-gap-instance-forks.md',
  'issues/closed/20260806-derived-fork-publication-author-gate.md',
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
  'demos/latency-kanban/snapback/trusted-composition-activation.json',
  'demos/triage-graph/snapback/trusted-composition-activation.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/trusted-composition-activation.json',
]);

export function allowedPublicationPath(path, generatedPaths = new Map()) {
  return PUBLICATION_ONLY_PATHS.has(path) || generatedPaths.has(path);
}

function fail(message) {
  throw new Error(`agent-safe-publication: ${message}`);
}

function git(root, args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: root, encoding }).toString().trim();
}

function committedBytes(root, commit, path) {
  return execFileSync('git', ['show', `${commit}:${path}`], {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function treeEntriesAt(root, commit, roots) {
  const raw = execFileSync('git', ['ls-tree', '-r', '-z', commit, '--', ...roots], { cwd: root });
  const entries = new Map();
  for (const record of raw.toString().split('\0').filter(Boolean)) {
    const match = record.match(/^([0-7]{6}) (blob|tree|commit) ([0-9a-f]+)\t([\s\S]+)$/u);
    if (!match) fail(`could not decode tree entry at ${commit}`);
    const [, mode, type, object, path] = match;
    entries.set(path, { mode, type, object });
  }
  return entries;
}

function portableGeneratedLeaf(path) {
  return typeof path === 'string'
    && path.length > 0
    && !path.startsWith('/')
    && !path.includes('\\')
    && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function requireFrozenBlob(entries, path, label) {
  const entry = entries.get(path);
  if (!entry || entry.type !== 'blob' || !entry.mode.startsWith('100')) {
    fail(`${label} is not a regular blob at qualification C: ${path}`);
  }
  return entry;
}

export function generatedPublicationPathsAt(root, commit) {
  const roots = [...REVIEW_CACHE_ROOTS, ...FULLY_COMMITTED_ROOTS, ...ADMIN_GENERATED_ROOTS];
  const entries = treeEntriesAt(root, commit, roots);
  const allowed = new Map();
  for (const generatedRoot of REVIEW_CACHE_ROOTS) {
    const manifestPath = `${generatedRoot}/artifacts.json`;
    allowed.set(manifestPath, requireFrozenBlob(entries, manifestPath, 'review manifest'));
    let manifest;
    try {
      manifest = JSON.parse(execFileSync('git', ['show', `${commit}:${manifestPath}`], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      }));
    } catch (error) {
      fail(`could not decode qualification-C review manifest ${manifestPath}: ${error.message}`);
    }
    if (manifest?.manifestVersion !== 2 || !Array.isArray(manifest.files)) {
      fail(`qualification-C review manifest is not v2: ${manifestPath}`);
    }
    for (const file of manifest.files) {
      if (file?.custody !== 'consumer-committed') continue;
      if (!portableGeneratedLeaf(file.path)) {
        fail(`qualification-C consumer projection path is invalid: ${manifestPath}`);
      }
      const path = `${generatedRoot}/${file.path}`;
      allowed.set(path, requireFrozenBlob(entries, path, 'consumer-committed projection'));
    }
  }
  for (const generatedRoot of [...FULLY_COMMITTED_ROOTS, ...ADMIN_GENERATED_ROOTS]) {
    for (const [path, entry] of entries) {
      if (path.startsWith(`${generatedRoot}/`)) {
        allowed.set(path, requireFrozenBlob(entries, path, 'fully committed generated projection'));
      }
    }
  }
  return allowed;
}

function diskRegularBlob(root, path, label) {
  let stat;
  try {
    stat = lstatSync(join(root, path));
  } catch {
    fail(`${label} is missing from disk: ${path}`);
  }
  if (!stat.isFile()) fail(`${label} is not a regular blob on disk: ${path}`);
  return { mode: stat.mode & 0o111 ? '100755' : '100644', type: 'blob' };
}

function indexedGeneratedEntriesOnDisk(root) {
  const generatedRoots = [
    ...REVIEW_CACHE_ROOTS,
    ...FULLY_COMMITTED_ROOTS,
    ...ADMIN_GENERATED_ROOTS,
  ];
  const raw = execFileSync('git', ['ls-files', '--stage', '-z', '--', ...generatedRoots], {
    cwd: root,
  });
  const entries = new Map();
  for (const record of raw.toString().split('\0').filter(Boolean)) {
    const match = record.match(/^([0-7]{6}) [0-9a-f]+ 0\t([\s\S]+)$/u);
    if (!match) fail('could not decode indexed generated leaf');
    const [, mode, path] = match;
    entries.set(path, { mode, type: mode === '160000' ? 'commit' : 'blob' });
  }
  return entries;
}

function indexedRegularBlob(root, entries, path, label) {
  const entry = entries.get(path);
  if (!entry || entry.type !== 'blob' || !entry.mode.startsWith('100')) {
    fail(`${label} is not a tracked regular blob on disk: ${path}`);
  }
  diskRegularBlob(root, path, label);
  return entry;
}

// Inventory-only working-tree twin of generatedPublicationPathsAt(). It reads
// reviewed manifests and regular generated leaves without running codegen or
// any publication qualification behavior.
export function generatedPublicationPathsOnDisk(root) {
  const entries = indexedGeneratedEntriesOnDisk(root);
  const allowed = new Map();
  for (const generatedRoot of REVIEW_CACHE_ROOTS) {
    const manifestPath = `${generatedRoot}/artifacts.json`;
    allowed.set(
      manifestPath,
      indexedRegularBlob(root, entries, manifestPath, 'review manifest'),
    );
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(root, manifestPath), 'utf8'));
    } catch (error) {
      fail(`could not decode review manifest on disk ${manifestPath}: ${error.message}`);
    }
    if (manifest?.manifestVersion !== 2 || !Array.isArray(manifest.files)) {
      fail(`review manifest on disk is not v2: ${manifestPath}`);
    }
    for (const file of manifest.files) {
      if (file?.custody !== 'consumer-committed') continue;
      if (!portableGeneratedLeaf(file.path)) {
        fail(`consumer projection path on disk is invalid: ${manifestPath}`);
      }
      const path = `${generatedRoot}/${file.path}`;
      allowed.set(
        path,
        indexedRegularBlob(root, entries, path, 'consumer-committed projection'),
      );
    }
  }
  for (const generatedRoot of [...FULLY_COMMITTED_ROOTS, ...ADMIN_GENERATED_ROOTS]) {
    for (const [path, entry] of entries) {
      if (!path.startsWith(`${generatedRoot}/`)) continue;
      allowed.set(
        path,
        indexedRegularBlob(root, entries, path, 'fully committed generated projection'),
      );
    }
  }
  return allowed;
}

export function allowedPublicationChange(change, generatedPaths, publicationEntries) {
  if (PUBLICATION_ONLY_PATHS.has(change.path)) return true;
  const expected = generatedPaths.get(change.path);
  const published = publicationEntries.get(change.path);
  return change.status === 'M'
    && expected?.type === 'blob'
    && published?.type === 'blob'
    && published.mode === expected.mode;
}

export function qualifiedImplementationChangesBetween(root, from, to) {
  const raw = execFileSync('git', [
    'diff', '--name-status', '--no-renames', '-z', `${from}..${to}`, '--',
    ...IMPLEMENTATION_ROOTS, 'vendor/ibex',
  ], { cwd: root });
  const fields = raw.toString().split('\0').filter(Boolean);
  if (fields.length % 2 !== 0) fail('could not decode qualified implementation drift');
  const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    const change = { status: fields[index], path: fields[index + 1] };
    if (!PUBLICATION_CYCLE_ALLOWLIST.has(change.path)) changes.push(change);
  }
  return changes;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function substituteSinglePinnedDigest(bytes, before, after, label) {
  if (!isSha256(before, true) || !isSha256(after, true)) {
    fail(`${label} digest is invalid`);
  }
  const text = bytes.toString('utf8');
  const occurrences = text.split(before).length - 1;
  if (occurrences !== 1) {
    fail(`${label} expected one qualification-C digest, found ${occurrences}`);
  }
  return Buffer.from(text.replace(before, after));
}

// @ref LLP 0162#source-owned-publication-carrier-amendment--2026-08-04
// Publishing the local agent-safe manifest refreshes signed Triage evidence,
// which is itself an input to the already-published local-store carrier. The
// source-owned anchor and carrier remain a cycle exclusion only for the exact
// mechanical digest substitution rooted in qualification C; Rust and its
// conformance logic remain byte-identical implementation inputs.
export function expectedLocalStorePublicationTransform(root, qualificationCommit) {
  const carrierAtQualification = committedBytes(
    root,
    qualificationCommit,
    LOCAL_STORE_PUBLICATION_TRANSFORM.carrier,
  );
  let carrier;
  try {
    carrier = JSON.parse(carrierAtQualification);
  } catch (error) {
    fail(`qualification-C local-store carrier is not valid JSON: ${error.message}`);
  }

  let expectedCarrier = carrierAtQualification;
  for (const receipt of LOCAL_STORE_PUBLICATION_TRANSFORM.receipts) {
    const recorded = receipt.value(carrier);
    const receiptAtQualification = committedBytes(root, qualificationCommit, receipt.path);
    if (recorded !== sha256(receiptAtQualification)) {
      fail(`qualification-C local-store carrier was stale at ${receipt.path}`);
    }
    const published = sha256(readFileSync(join(root, receipt.path)));
    expectedCarrier = substituteSinglePinnedDigest(
      expectedCarrier,
      recorded,
      published,
      `${LOCAL_STORE_PUBLICATION_TRANSFORM.carrier}:${receipt.path}`,
    );
  }

  const carrierDigestAtQualification = sha256(carrierAtQualification);
  const expectedCarrierDigest = sha256(expectedCarrier);
  const expectedAnchor = substituteSinglePinnedDigest(
    committedBytes(root, qualificationCommit, LOCAL_STORE_PUBLICATION_TRANSFORM.anchor),
    carrierDigestAtQualification,
    expectedCarrierDigest,
    LOCAL_STORE_PUBLICATION_TRANSFORM.anchor,
  );
  return new Map([
    [LOCAL_STORE_PUBLICATION_TRANSFORM.carrier, expectedCarrier],
    [LOCAL_STORE_PUBLICATION_TRANSFORM.anchor, expectedAnchor],
  ]);
}

export function validateLocalStorePublicationTransform(root, qualificationCommit) {
  for (const [path, expected] of expectedLocalStorePublicationTransform(
    root,
    qualificationCommit,
  )) {
    const actual = readFileSync(join(root, path));
    if (!actual.equals(expected)) {
      fail(`${path} drifted beyond the qualification-C local-store digest transform`);
    }
  }
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
  const names = git(root, ['ls-tree', '-r', '--name-only', commit, '--', ...IMPLEMENTATION_ROOTS])
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

// @ref LLP 0162#source-owned-publication-carrier-amendment--2026-08-04
// Qualification custody covers the implementation digest's exact leaf scope,
// not unrelated repository history that happens to land between C and P. The
// receipt must name the committed implementation at C as well as the tree at P.
export function assertQualifiedImplementationDigestAtPublication(root, {
  capabilityId,
  qualificationCommit,
  publicationCommit,
  expectedDigest,
}) {
  const qualificationDigest = implementationDigestAt(root, qualificationCommit);
  const publicationDigest = implementationDigestAt(root, publicationCommit);
  if (qualificationDigest !== expectedDigest || publicationDigest !== expectedDigest) {
    const changes = qualifiedImplementationChangesBetween(
      root,
      qualificationCommit,
      publicationCommit,
    );
    const changedPaths = changes.length > 0
      ? changes.map(({ status, path }) => `${status}:${path}`).join(',')
      : 'none detected between C and P (receipt or digest scope is inconsistent)';
    fail([
      `${capabilityId} qualified implementation digest mismatch`,
      `in-scope paths drifted: ${changedPaths}`,
      `receipt ${expectedDigest}`,
      `qualification C ${qualificationDigest}`,
      `publication P ${publicationDigest}`,
    ].join('; '));
  }
  return publicationDigest;
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
  const names = execFileSync('git', ['ls-files', '-z', '--', ...IMPLEMENTATION_ROOTS], { cwd: root })
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

function evidenceLocatorsFor(record) {
  if (record.id === 'agent_safe_storage_v1') return STORAGE_EVIDENCE;
  if (record.id === 'agent_safe_derived_deployment_fork_v1') return DERIVED_FORK_EVIDENCE;
  fail(`unknown publication record ${record.id}`);
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
  const evidenceLocators = evidenceLocatorsFor(record);
  if (!Array.isArray(receipt.evidence) || receipt.evidence.length !== evidenceLocators.length) {
    fail(`${record.id} evidence count drifted`);
  }
  receipt.evidence.forEach((binding, index) => {
    exactKeys(binding, ['kind', 'path', 'sha256'], `${record.id} evidence ${index}`);
    const [kind, path] = evidenceLocators[index];
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
  ['currentPointReadP50Us', 'current_point_read_p50_us', 'higherIsWorse', 'twoSidedEquivalence', 5, 'latency'],
  ['currentPointReadP95Us', 'current_point_read_p95_us', 'higherIsWorse', 'twoSidedEquivalence', 5, 'latency'],
  ['currentRangeReadP50Us', 'current_range_read_p50_us', 'higherIsWorse', 'twoSidedEquivalence', 5, 'latency'],
  ['currentRangeReadP95Us', 'current_range_read_p95_us', 'higherIsWorse', 'twoSidedEquivalence', 5, 'latency'],
  ['currentQueryPlanReadP50Us', 'current_query_plan_read_p50_us', 'higherIsWorse', 'twoSidedEquivalence', 5, 'latency'],
  ['currentQueryPlanReadP95Us', 'current_query_plan_read_p95_us', 'higherIsWorse', 'twoSidedEquivalence', 5, 'latency'],
  ['singleWriterMutationsPerSec', 'single_writer_mutations_per_sec', 'lowerIsWorse', 'oneSidedRegression', 15, 'throughput'],
  ['singleWriterMutationP50Us', 'single_writer_mutation_p50_us', 'higherIsWorse', 'oneSidedRegression', 15, 'latency'],
  ['singleWriterMutationP95Us', 'single_writer_mutation_p95_us', 'higherIsWorse', 'oneSidedRegression', 15, 'latency'],
];

const BYTE_METRICS = [
  ['allocatedWriteBytesPerChangedRow', 'allocated_write_bytes_per_changed_row'],
  ['allocatedWriteBytesPerOperation', 'allocated_write_bytes_per_operation'],
  ['retainedBytesPerChangedRow', 'retained_bytes_per_changed_row'],
  ['retainedBytesPerOperation', 'retained_bytes_per_operation'],
];

const PAIRED_PROTOCOL = Object.freeze({
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
});

function expectedSubpairOrders(pairIndex) {
  return pairIndex % 2 === 0
    ? ['baselineThenCandidate', 'candidateThenBaseline', 'baselineThenCandidate']
    : ['candidateThenBaseline', 'baselineThenCandidate', 'candidateThenBaseline'];
}

function validatePairedRawPopulation(value) {
  requireEvidence(Array.isArray(value.rawPairs) && value.rawPairs.length === 11,
    'paired raw observation population drifted');
  value.rawPairs.forEach((pair, pairIndex) => {
    const orders = expectedSubpairOrders(pairIndex);
    const orderSequence = pairIndex % 2 === 0 ? 'AB/BA/AB' : 'BA/AB/BA';
    requireEvidence(pair.pair === pairIndex + 1 && pair.orderSequence === orderSequence,
      `paired raw observation ${pairIndex + 1} order drifted`);
    requireEvidence(Array.isArray(pair.rawSubpairs) && pair.rawSubpairs.length === 3,
      `paired raw observation ${pairIndex + 1} subpair population drifted`);
    pair.rawSubpairs.forEach((subpair, subpairIndex) => {
      requireEvidence(subpair.subpair === subpairIndex + 1
        && subpair.order === orders[subpairIndex],
      `paired raw observation ${pairIndex + 1} subpair ${subpairIndex + 1} order drifted`);
      requireEvidence(
        subpair.baselineWorkerProtocol === 'agentSafeDormantBaselineWorkerV1'
          && subpair.candidateActiveCoveredWorkerProtocol
            === 'agentSafeActiveCoveredWorkerV3',
        `paired raw observation ${pairIndex + 1} subpair ${subpairIndex + 1} worker protocol drifted`,
      );
    });
  });
}

function validatePairedComparisons(value) {
  validatePairedRawPopulation(value);
  requireEvidence(Array.isArray(value.comparisons)
    && value.comparisons.length === PAIRED_METRICS.length,
  'paired comparison vocabulary drifted');
  PAIRED_METRICS.forEach(([
    metric, rawMetric, direction, boundKind, boundPercent, mode,
  ], index) => {
    const comparison = value.comparisons[index];
    requireEvidence(comparison.metric === metric
      && comparison.direction === direction
      && comparison.boundKind === boundKind
      && comparison.boundPercent === boundPercent,
    `paired comparison ${metric} identity/bound drifted`);
    const regressions = value.rawPairs.map((pair) => {
      const subpairRegressions = pair.rawSubpairs.map((subpair) => {
        const baseline = subpair.baseline?.[rawMetric];
        const candidate = subpair.candidateActiveCovered?.[rawMetric];
        requireEvidence(Number.isFinite(baseline) && baseline > 0
          && Number.isFinite(candidate) && candidate > 0,
        `paired raw metric ${metric} is invalid`);
        return mode === 'throughput'
          ? 100 * (1 - candidate / baseline)
          : 100 * (candidate / baseline - 1);
      });
      return upperMedian(subpairRegressions);
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
  BYTE_METRICS.forEach(([metric, rawMetric], index) => {
    const comparison = value.byteComparisons[index];
    const baseline = value.rawPairs.map((pair) => upperMedian(
      pair.rawSubpairs.map((subpair) => subpair.baseline?.[rawMetric]),
    ));
    const candidate = value.rawPairs.map((pair) => upperMedian(
      pair.rawSubpairs.map((subpair) => subpair.candidateActiveCovered?.[rawMetric]),
    ));
    const rawBaseline = value.rawPairs.flatMap((pair) => (
      pair.rawSubpairs.map((subpair) => subpair.baseline?.[rawMetric])
    ));
    const rawCandidate = value.rawPairs.flatMap((pair) => (
      pair.rawSubpairs.map((subpair) => subpair.candidateActiveCovered?.[rawMetric])
    ));
    requireEvidence(comparison.metric === metric
      && comparison.thresholdStatus
        === 'observed; LLP 0162 registers the metric but no numeric byte bound'
      && rawBaseline.every((number) => Number.isSafeInteger(number) && number >= 0)
      && rawCandidate.every((number) => Number.isSafeInteger(number) && number >= 0),
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
    requireEvidence(Array.isArray(comparison.pairedChangePercent)
      && comparison.pairedChangePercent.length === change.length,
    `${metric} paired change population drifted`);
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
  const rssRegressions = [];
  for (const pair of value.rawPairs) {
    const pairBaselineRss = [];
    const pairCandidateRss = [];
    const pairRssRegressions = [];
    for (const subpair of pair.rawSubpairs) {
      const baseline = subpair.baselineIdle;
      const candidate = subpair.candidateActiveCoveredIdle;
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
      pairBaselineRss.push(baseline.residentKbBefore);
      pairCandidateRss.push(candidate.residentKbBefore);
      pairRssRegressions.push(100 * (candidate.residentKbBefore / baseline.residentKbBefore - 1));
      outputBlocks.push(candidate.outputBlockOperations);
      databaseDeltas.push(candidate.databaseFamilyBytesAfter - candidate.databaseFamilyBytesBefore);
    }
    baselineRss.push(upperMedian(pairBaselineRss));
    candidateRss.push(upperMedian(pairCandidateRss));
    rssRegressions.push(upperMedian(pairRssRegressions));
  }
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
  requireEvidence(value.schemaVersion === 'snapback.agent-safe-active-paired.v3', 'paired schema drifted');
  requireEvidence(value.artifactName === 'agent-safe-active-covered-paired-2026-08-04', 'paired artifact identity drifted');
  requireEvidence(value.date === '2026-08-04', 'paired date drifted');
  requireEvidence(value.candidate?.sourceRevision === commit, 'paired candidate is not exact C');
  requireEvidence(value.candidate?.sourceTreeClean === true, 'paired candidate was dirty');
  requireEvidence(isSha256(value.candidate?.executableSha256, true),
    'paired candidate executable digest is missing');
  requireEvidence(value.candidate?.buildProfile === 'release', 'paired candidate was not release');
  requireEvidence(
    value.candidate?.activeProfile
      === 'serverIssuedClientRange+ordinaryMutationCoverageV1+productionEnvelopeChokePoint',
    'paired candidate did not exercise the active covered carrier',
  );
  requireEvidence(value.baseline?.artifactName === 'agent-safe-step0-pre-profile-2026-08-03'
    && value.baseline?.artifactSchemaVersion === 'snapback.agent-safe-step0-baseline.v1'
    && value.baseline?.artifactSha256
      === 'sha256:d28d8514f48db3f8a0e4d0c33a1381f12e4ad13eaf6a69187aef9b7fe822ab91'
    && value.baseline?.sourceRevision === '2ab36e28c74c450213b65f17ef81c0d6652ba33a'
    && value.baseline?.buildProvenanceSha256
      === 'sha256:84e288661c3edf5dfaec3690f2fe00335d251d046ac187439ffae37fe9c65991'
    && value.baseline?.sourceRootCargoLockSha256
      === 'sha256:496569d9a3cb87609b6e79974f69126dbaccba53eb71d093f5dcf090fe1a36b1'
    && value.baseline?.externalWorkerCargoLockSha256
      === 'sha256:05bd0af1ed649011354f091e2cd371f38aaf5c229437c6a98b4807c7d0eead3d'
    && value.baseline?.executableSha256
      === 'sha256:b78089dadd8b4966b20eb847d576ed9cd59dbaa96143c81a2c4a8b0a684c0bb8',
  'paired baseline identity/provenance drifted');
  requireEvidence(value.hardwareClass?.os === '26.5.2'
    && value.hardwareClass?.architecture === 'aarch64'
    && value.hardwareClass?.model === 'Mac17,3'
    && value.hardwareClass?.cpu === 'Apple M5'
    && value.hardwareClass?.logicalCpus === 10
    && value.hardwareClass?.memoryBytes === 34_359_738_368,
  'paired hardware class drifted');
  requireEvidence(value.toolchain?.rustc === 'rustc 1.97.0 (2d8144b78 2026-07-07)'
    && value.toolchain?.cargo === 'cargo 1.97.0 (c980f4866 2026-06-30)',
  'paired toolchain drifted');
  requireEvidence(Object.entries(PAIRED_PROTOCOL)
    .every(([key, expected]) => value.protocol?.[key] === expected),
  'paired protocol identity drifted');
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
  const path = STORAGE_EVIDENCE[1][1];
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
  const path = STORAGE_EVIDENCE[2][1];
  const value = readEvidenceJson(root, path, 'absolute performance');
  validateAbsolutePerformanceArtifact(value, commit);
}

function validateAcceptanceCorpus(root, commit, implementationTree) {
  const path = STORAGE_EVIDENCE[0][1];
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

function validateAuthorAcceptance(root, receipt, commit, implementationTree) {
  const path = STORAGE_EVIDENCE[5][1];
  const value = readEvidenceJson(root, path, 'author acceptance');
  requireEvidence(value.schemaVersion === 'snapback.agent-safe-storage-author-acceptance.v1'
    && value.date === '2026-08-04'
    && value.author === 'Charlie Cheever'
    && value.accepted === true
    && value.authorizationSource === 'explicit-user-instruction-2026-08-04',
  'named-author acceptance identity or decision drifted');
  requireEvidence(value.qualifiedSourceCommit === commit
    && value.implementationTreeSha256 === implementationTree
    && value.implementationTreeSha256 === receipt.implementationTreeSha256
    && value.qualifiedCapability === 'agent_safe_storage_v1'
    && JSON.stringify(value.qualifiedComponents) === JSON.stringify(STORAGE_COMPONENTS),
  'author acceptance source or component scope drifted');
  requireEvidence(JSON.stringify(value.acceptedLlps) === JSON.stringify(['0158', '0163', '0164', '0165']),
    'author acceptance LLP scope drifted');
  requireEvidence(value.derivedCapabilityState === 'Missing'
    && value.broaderCapabilityFactsState === 'Missing',
  'author acceptance widened withheld facts');
  const reviewDigests = value.reviewSha256 ?? {};
  requireEvidence(reviewDigests.fable === sha256(readFileSync(join(root, STORAGE_EVIDENCE[3][1])))
    && reviewDigests.codex === sha256(readFileSync(join(root, STORAGE_EVIDENCE[4][1]))),
  'author acceptance did not bind both review bytes');
  const evidenceDigests = value.evidenceSha256 ?? {};
  requireEvidence(evidenceDigests.acceptanceCorpus === sha256(readFileSync(join(root, STORAGE_EVIDENCE[0][1])))
    && evidenceDigests.pairedPerformance === sha256(readFileSync(join(root, STORAGE_EVIDENCE[1][1])))
    && evidenceDigests.absolutePerformance === sha256(readFileSync(join(root, STORAGE_EVIDENCE[2][1]))),
  'author acceptance did not bind the corpus and both performance records');
}

const DERIVED_FORK_BENCH_SCOPE =
  'LLP 0162 row 13, narrow operating.instance-forks claim (author-scoped 2026-08-05)';
const DERIVED_FORK_BENCH_NOTES = [
  'create latency includes server boot, ready handshake, and manifest load — the full product surface',
  'diff spans are 10k journal rows, an order of magnitude under the 100k diff-work bound',
];
const DERIVED_FORK_RATIFIED_BOUNDS = {
  ratifiedBy: 'LLP 0162 author (Charlie), 2026-08-06',
  createColdSmallParentMs: 2_000,
  createColdLargeParent32MiBMs: 3_000,
  createLiveParentMs: 2_000,
  dropMs: 1_000,
  attributedDiff10kRowsMs: 500,
  netDiff10kRowsMs: 750,
  reapSweepMs: 1_000,
  concurrentCreate3WallMs: '<= 3x the sequential create bound',
};
const DERIVED_FORK_STAT_MEASUREMENTS = [
  ['createColdSmallParent', 5, 'createColdSmallParentMs'],
  ['createColdLargeParent32MiB', 3, 'createColdLargeParent32MiBMs'],
  ['createLiveParent', 3, 'createLiveParentMs'],
  ['dropSmall', 5, 'dropMs'],
  ['dropLarge', 3, 'dropMs'],
  ['dropLive', 3, 'dropMs'],
  ['attributedDiff10kRows', 3, 'attributedDiff10kRowsMs'],
  ['netDiff10kRows', 3, 'netDiff10kRowsMs'],
];

function validateDerivedForkRatifiedBounds(value, label) {
  exactKeys(value, Object.keys(DERIVED_FORK_RATIFIED_BOUNDS), `${label} ratifiedBounds`);
  requireEvidence(Object.entries(DERIVED_FORK_RATIFIED_BOUNDS)
    .every(([key, expected]) => value[key] === expected),
  `${label} author-ratified bounds drifted`);
}

export function validateDerivedForkLifecycleBenchArtifact(value, commit, os, arch) {
  const label = `${os}-${arch} fork lifecycle bench`;
  exactKeys(value, [
    'schemaVersion', 'scope', 'environment', 'measurements', 'ratifiedBounds', 'notes',
  ], label);
  requireEvidence(value.schemaVersion === 'snapback.fork-lifecycle-bench.v1'
    && value.scope === DERIVED_FORK_BENCH_SCOPE,
  `${label} identity drifted`);
  exactKeys(value.environment, ['os', 'arch', 'cpus', 'profile', 'commit'], `${label} environment`);
  requireEvidence(value.environment.os === os
    && value.environment.arch === arch
    && Number.isInteger(value.environment.cpus)
    && value.environment.cpus > 0
    && value.environment.profile === 'release'
    && value.environment.commit === commit,
  `${label} environment/qualified commit drifted`);
  validateDerivedForkRatifiedBounds(value.ratifiedBounds, label);
  requireEvidence(JSON.stringify(value.notes) === JSON.stringify(DERIVED_FORK_BENCH_NOTES),
    `${label} notes drifted`);
  exactKeys(value.measurements, [
    ...DERIVED_FORK_STAT_MEASUREMENTS.map(([name]) => name),
    'reapThreeExpiredForks', 'concurrentCreate3WallMs', 'sequentialCreateMedianMs',
  ], `${label} measurements`);
  for (const [name, samples, bound] of DERIVED_FORK_STAT_MEASUREMENTS) {
    const measurement = value.measurements[name];
    exactKeys(measurement, ['samples', 'minMs', 'medianMs', 'maxMs'], `${label} ${name}`);
    requireEvidence(measurement.samples === samples
      && [measurement.minMs, measurement.medianMs, measurement.maxMs]
        .every((number) => Number.isFinite(number) && number >= 0)
      && measurement.minMs <= measurement.medianMs
      && measurement.medianMs <= measurement.maxMs
      && measurement.medianMs <= DERIVED_FORK_RATIFIED_BOUNDS[bound],
    `${label} ${name} median/statistics exceeded or drifted from ratified bounds`);
  }
  const reap = value.measurements.reapThreeExpiredForks;
  exactKeys(reap, ['samples', 'medianMs'], `${label} reapThreeExpiredForks`);
  requireEvidence(reap.samples === 1
    && Number.isFinite(reap.medianMs)
    && reap.medianMs >= 0
    && reap.medianMs <= DERIVED_FORK_RATIFIED_BOUNDS.reapSweepMs,
  `${label} reap median exceeded or drifted from ratified bounds`);
  const concurrent = value.measurements.concurrentCreate3WallMs;
  const sequential = value.measurements.sequentialCreateMedianMs;
  requireEvidence(Number.isFinite(concurrent)
    && concurrent >= 0
    && Number.isFinite(sequential)
    && sequential >= 0
    && sequential === value.measurements.createColdSmallParent.medianMs
    && concurrent <= 3 * DERIVED_FORK_RATIFIED_BOUNDS.createColdSmallParentMs,
  `${label} concurrent-create bound failed`);
}

function validateDerivedForkBoundsRatification(root, commit) {
  const value = readEvidenceJson(root, DERIVED_FORK_EVIDENCE[2][1], 'fork bounds ratification');
  const ratificationCommit = value.environment?.commit;
  requireEvidence(/^[0-9a-f]{40}$/u.test(ratificationCommit ?? ''),
    'fork bounds ratification commit is invalid');
  validateDerivedForkLifecycleBenchArtifact(value, ratificationCommit, 'macos', 'aarch64');
  try {
    git(root, ['merge-base', '--is-ancestor', ratificationCommit, commit]);
  } catch {
    fail('published evidence: fork bounds ratification is not an ancestor of qualification C');
  }
}

// @ref LLP 0162#source-owned-publication-carrier-amendment--2026-08-04 — review authority is a closed,
// digest-bound JSON history. The adjacent Markdown remains required evidence,
// but no heading, table, quotation, or verdict-shaped prose is authoritative.
export function validateDerivedForkReview(root, {
  reviewIndex,
  verdictIndex,
  expectedKind,
  qualificationCommit,
}) {
  const reviewPath = DERIVED_FORK_EVIDENCE[reviewIndex][1];
  const verdictPath = DERIVED_FORK_EVIDENCE[verdictIndex][1];
  requireEvidence(
    expectedKind === 'forkSpecConformance'
      || expectedKind === 'derivedForkPublication',
    `${verdictPath} expected verdict kind is unrecognized`,
  );
  let reviewBytes;
  try {
    reviewBytes = readFileSync(join(root, reviewPath));
  } catch {
    fail(`published evidence: missing or unreadable review ${reviewPath}`);
  }
  const value = readEvidenceJson(root, verdictPath, `${reviewPath} verdict contract`);
  exactKeys(value, ['schemaVersion', 'verdicts'], `${verdictPath} contract`);
  requireEvidence(value.schemaVersion === 'snapback.review-verdicts.v1'
    && Array.isArray(value.verdicts)
    && value.verdicts.length > 0,
  `${verdictPath} contract identity or verdict population drifted`);

  let previousCommit;
  let declaredFamily;
  for (const [index, entry] of value.verdicts.entries()) {
    exactKeys(entry, [
      'reviewArtifact', 'reviewArtifactSha256', 'family', 'round', 'reviewedCommit',
      'verdict',
    ], `${verdictPath} round ${index + 1}`);
    requireEvidence(entry.reviewArtifact === reviewPath
      && entry.reviewArtifactSha256 === sha256(reviewBytes),
    `${verdictPath} round ${index + 1} does not bind its exact prose artifact`);
    requireEvidence(entry.family === 'codex' || entry.family === 'fable',
      `${verdictPath} round ${index + 1} reviewer family is unrecognized`);
    declaredFamily ??= entry.family;
    requireEvidence(entry.family === declaredFamily,
      `${verdictPath} reviewer family changed between rounds`);
    requireEvidence(Number.isSafeInteger(entry.round)
      && entry.round === index + 1,
    `${verdictPath} rounds are missing, duplicated, or non-monotonic`);
    requireEvidence(/^[0-9a-f]{40}$/u.test(entry.reviewedCommit ?? ''),
      `${verdictPath} round ${entry.round} reviewed commit is invalid`);
    if (index === value.verdicts.length - 1) {
      requireEvidence(entry.reviewedCommit === qualificationCommit,
        `${verdictPath} authoritative verdict does not name qualification C`);
    }
    if (previousCommit !== undefined) {
      try {
        git(root, ['merge-base', '--is-ancestor', previousCommit, entry.reviewedCommit]);
      } catch {
        fail(`published evidence: ${verdictPath} reviewed commits are inconsistent`);
      }
    }
    previousCommit = entry.reviewedCommit;

    if (expectedKind === 'forkSpecConformance') {
      exactKeys(entry.verdict, [
        'kind', 'llp0163', 'llp0164', 'llp0165',
      ], `${verdictPath} round ${entry.round} verdict`);
      requireEvidence(entry.verdict.kind === expectedKind
        && ['READY', 'NOT_READY'].includes(entry.verdict.llp0163)
        && ['READY', 'NOT_READY'].includes(entry.verdict.llp0164)
        && ['READY', 'NOT_READY'].includes(entry.verdict.llp0165),
      `${verdictPath} round ${entry.round} spec verdict is invalid`);
    } else {
      exactKeys(entry.verdict, ['kind', 'status'], `${verdictPath} round ${entry.round} verdict`);
      requireEvidence(entry.verdict.kind === 'derivedForkPublication'
        && ['READY', 'NOT_READY'].includes(entry.verdict.status),
      `${verdictPath} round ${entry.round} publication verdict is invalid`);
    }
  }

  const authoritative = value.verdicts.at(-1);
  const ready = expectedKind === 'forkSpecConformance'
    ? ['llp0163', 'llp0164', 'llp0165'].every((key) => (
      authoritative.verdict[key] === 'READY'
    ))
    : authoritative.verdict.status === 'READY';
  return {
    family: authoritative.family,
    ready,
    round: authoritative.round,
    reviewPath,
    verdictPath,
  };
}

function validateDerivedForkAssetEvidence(root) {
  const path = DERIVED_FORK_EVIDENCE[3][1];
  const text = readFileSync(join(root, path), 'utf8');
  requireEvidence(text.startsWith('# LLP 0044 `asset-lifecycle-v1` acceptance evidence (local target)\n')
    && text.includes('<!-- @ref LLP 0044#acceptance'),
  'asset lifecycle evidence identity drifted');
}

function validateDerivedForkAuthorAcceptance(root, receipt, commit, implementationTree) {
  const path = DERIVED_FORK_EVIDENCE.at(-1)[1];
  const value = readEvidenceJson(root, path, 'derived-fork author acceptance');
  exactKeys(value, [
    'schemaVersion', 'capabilityId', 'accepted', 'authorLine', 'qualifiedSourceCommit',
    'implementationTreeSha256', 'candidateFactsSha256', 'qualifiedComponents',
    'evidenceSha256',
  ], 'derived-fork author acceptance');
  requireEvidence(value.schemaVersion === 'snapback.derived-fork-author-acceptance.v1'
    && value.capabilityId === 'agent_safe_derived_deployment_fork_v1'
    && value.accepted === true
    && value.authorLine === 'Charlie Cheever — accepted 2026-08-06'
    && value.qualifiedSourceCommit === commit
    && value.implementationTreeSha256 === implementationTree
    && value.implementationTreeSha256 === receipt.implementationTreeSha256
    && value.candidateFactsSha256 === receipt.candidateFactsSha256
    && JSON.stringify(value.qualifiedComponents) === JSON.stringify(DERIVED_COMPONENTS),
  'derived-fork named-author/source/component acceptance drifted');
  const nonselfBindings = receipt.evidence.slice(0, -1);
  exactKeys(value.evidenceSha256, nonselfBindings.map(({ kind }) => kind),
    'derived-fork author evidence digests');
  requireEvidence(nonselfBindings.every(({ kind, sha256: digest }) => (
    value.evidenceSha256[kind] === digest
  )), 'derived-fork author acceptance did not bind the exact non-self receipt digest set');
}

export function validatePublishedDerivedForkEvidenceSemantics(root, record, commit, receipt) {
  requireEvidence(record.id === 'agent_safe_derived_deployment_fork_v1'
    && /^[0-9a-f]{40}$/u.test(commit),
  'derived-fork capability or qualification commit is invalid');
  requireEvidence(JSON.stringify(record.components) === JSON.stringify(DERIVED_COMPONENTS)
    && JSON.stringify(receipt.qualifiedComponents) === JSON.stringify(DERIVED_COMPONENTS),
  'derived-fork qualified component scope drifted');
  const publication = git(root, ['rev-parse', 'HEAD']);
  try {
    git(root, ['merge-base', '--is-ancestor', commit, publication]);
  } catch {
    fail('published evidence: derived-fork qualification commit is not an ancestor of publication HEAD');
  }
  validateDerivedForkBoundsRatification(root, commit);
  const macos = readEvidenceJson(root, DERIVED_FORK_EVIDENCE[0][1], 'macOS fork lifecycle bench');
  const linux = readEvidenceJson(root, DERIVED_FORK_EVIDENCE[1][1], 'Linux fork lifecycle bench');
  validateDerivedForkLifecycleBenchArtifact(macos, commit, 'macos', 'aarch64');
  validateDerivedForkLifecycleBenchArtifact(linux, commit, 'linux', 'x86_64');
  requireEvidence(new Set([
    `${macos.environment.os}/${macos.environment.arch}`,
    `${linux.environment.os}/${linux.environment.arch}`,
  ]).size === 2, 'both distinct release platforms were not present');
  validateDerivedForkAssetEvidence(root);
  const specCodex = validateDerivedForkReview(root, {
    reviewIndex: 4,
    verdictIndex: 5,
    expectedKind: 'forkSpecConformance',
    qualificationCommit: commit,
  });
  const specFable = validateDerivedForkReview(root, {
    reviewIndex: 6,
    verdictIndex: 7,
    expectedKind: 'forkSpecConformance',
    qualificationCommit: commit,
  });
  const implementationCodex = validateDerivedForkReview(root, {
    reviewIndex: 8,
    verdictIndex: 9,
    expectedKind: 'derivedForkPublication',
    qualificationCommit: commit,
  });
  const implementationFable = validateDerivedForkReview(root, {
    reviewIndex: 10,
    verdictIndex: 11,
    expectedKind: 'derivedForkPublication',
    qualificationCommit: commit,
  });
  requireEvidence(new Set([specCodex.family, specFable.family]).size === 2
    && new Set([implementationCodex.family, implementationFable.family]).size === 2,
  'derived-fork review pairs did not preserve two distinct model families');
  requireEvidence(specCodex.family === 'codex'
    && specFable.family === 'fable'
    && implementationCodex.family === 'codex'
    && implementationFable.family === 'fable'
    && specCodex.family === implementationCodex.family
    && specFable.family === implementationFable.family,
  'derived-fork verdict family did not match its fixed review artifact');
  for (const review of [specCodex, specFable, implementationCodex, implementationFable]) {
    requireEvidence(review.ready, `${review.verdictPath} authoritative verdict is not READY`);
  }
  const implementationTree = implementationDigestAt(root, commit);
  validateDerivedForkAuthorAcceptance(root, receipt, commit, implementationTree);
}

export function validatePublishedEvidenceSemantics(root, record, commit, receipt = undefined) {
  const boundReceipt = receipt ?? JSON.parse(readFileSync(join(root, record.receipt)));
  if (record.id === 'agent_safe_derived_deployment_fork_v1') {
    validatePublishedDerivedForkEvidenceSemantics(root, record, commit, boundReceipt);
    return;
  }
  if (record.id !== 'agent_safe_storage_v1') {
    fail(`${record.id} has no publication evidence contract`);
  }
  const implementationTree = implementationDigestAt(root, commit);
  validatePairedPerformance(root, commit);
  validateAbsolutePerformance(root, commit);
  validateAcceptanceCorpus(root, commit, implementationTree);
  validateReview(root, STORAGE_EVIDENCE[3][1], 'Fable', commit, implementationTree);
  validateReview(root, STORAGE_EVIDENCE[4][1], 'Codex', commit, implementationTree);
  validateAuthorAcceptance(root, boundReceipt, commit, implementationTree);
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
  const candidateFacts = exactCandidate(record.id);
  const candidateFactsSha256 = sha256(Buffer.from(JSON.stringify(candidateFacts)));
  if (carrier.schemaVersion !== 'snapback.local-agent-safe-publication.v1'
      || carrier.capabilityId !== record.id
      || carrier.targetProfileId !== 'local-dev-sqlite-ibex'
      || carrier.maturity !== 'experimental'
      || carrier.buildProvenanceRequirement !== 'known-clean-contributor-source'
      || carrier.qualificationReceiptSha256 !== sha256(receiptBytes)
      || JSON.stringify(carrier.candidateFacts) !== JSON.stringify(candidateFacts)
      || carrier.candidateFactsSha256 !== candidateFactsSha256
      || receipt.candidateFactsSha256 !== candidateFactsSha256
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
  const publication = git(root, ['rev-parse', 'HEAD']);
  try {
    git(root, ['merge-base', '--is-ancestor', carrier.qualifiedSourceCommit, publication]);
  } catch {
    fail(`${record.id} qualification commit is not an ancestor of publication HEAD`);
  }
  const implementationDigest = assertQualifiedImplementationDigestAtPublication(root, {
    capabilityId: record.id,
    qualificationCommit: carrier.qualifiedSourceCommit,
    publicationCommit: publication,
    expectedDigest: receipt.implementationTreeSha256,
  });
  validatePublishedEvidenceSemantics(root, record, carrier.qualifiedSourceCommit, receipt);
  return {
    id: record.id,
    state: 'published',
    commit: carrier.qualifiedSourceCommit,
    implementationDigest,
  };
}

export function runChecker(root) {
  const results = RECORDS.map((record) => validatePublicationRecord(root, record));
  for (const result of results.filter(({ state }) => state === 'published')) {
    validateLocalStorePublicationTransform(root, result.commit);
    const workingTreeDigest = implementationDigestWorkingTree(root);
    if (result.implementationDigest !== workingTreeDigest) {
      fail(`${result.id} publication HEAD and clean working-tree implementation digests differ; `
        + `expected ${result.implementationDigest}; actual ${workingTreeDigest}`);
    }
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
