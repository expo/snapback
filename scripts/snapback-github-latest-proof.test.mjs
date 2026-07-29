import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  parseArgs,
  validateExistingLatestReceipt,
  validateGithubLatestProofCollection,
} from './snapback-github-latest-proof.mjs';
import {
  LATEST_ROOT_PROPAGATION_MAX_ATTEMPTS,
  LATEST_ROOT_PROPAGATION_RETRY_DELAY_MS,
  LATEST_ROOT_PROPAGATION_WALL_BOUND_MS,
} from './snapback-package-cold-install-lib.mjs';
import {
  canonicalJcs,
  sha256Hex,
} from './snapback-promotion-core.mjs';

const NOW = Date.parse('2026-07-28T22:05:00.000Z');
const CONTEXT = {
  repository: 'ccheever/snapback',
  workflow: 'public-package-proof.yml',
  ref: 'agent/release',
  expectedHeadSha: 'a'.repeat(40),
  expectedPriorRootVersion: '0.1.0',
  authorizedLeaseSha256: 'c'.repeat(64),
  publicationEpoch: 17,
  operationId: 'release-proof-test',
  ledgerRevision: 'b'.repeat(40),
  candidateLedgerSha256: 'd'.repeat(64),
  candidateRootVersion: '0.1.1',
  runId: 123456789,
  runAttempt: 2,
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('helper arguments close the signed prior retry authority', () => {
  const options = parseArgs([
    'dispatch',
    '--repository', CONTEXT.repository,
    '--workflow', CONTEXT.workflow,
    '--ref', CONTEXT.ref,
    '--expected-head-sha', CONTEXT.expectedHeadSha,
    '--expected-prior-root-version', CONTEXT.expectedPriorRootVersion,
    '--authorized-lease-sha256', CONTEXT.authorizedLeaseSha256,
    '--publication-epoch', String(CONTEXT.publicationEpoch),
    '--ledger-path', 'demos/partiful-matrix/acceptance/evidence/ledger.json',
    '--operation-id', CONTEXT.operationId,
    '--darwin-receipt', 'darwin.json',
    '--linux-receipt', 'linux.json',
    '--collection', 'collection.json',
  ]);
  assert.equal(options.expectedPriorRootVersion, CONTEXT.expectedPriorRootVersion);
  assert.equal(options.authorizedLeaseSha256, CONTEXT.authorizedLeaseSha256);
  assert.equal(options.publicationEpoch, CONTEXT.publicationEpoch);
  for (const omitted of [
    '--expected-prior-root-version',
    '--authorized-lease-sha256',
    '--publication-epoch',
  ]) {
    const argv = [
      'dispatch',
      '--repository', CONTEXT.repository,
      '--workflow', CONTEXT.workflow,
      '--ref', CONTEXT.ref,
      '--expected-head-sha', CONTEXT.expectedHeadSha,
      '--expected-prior-root-version', CONTEXT.expectedPriorRootVersion,
      '--authorized-lease-sha256', CONTEXT.authorizedLeaseSha256,
      '--publication-epoch', String(CONTEXT.publicationEpoch),
      '--ledger-path', 'ledger.json',
      '--operation-id', CONTEXT.operationId,
      '--darwin-receipt', 'darwin.json',
      '--linux-receipt', 'linux.json',
      '--collection', 'collection.json',
    ];
    const index = argv.indexOf(omitted);
    argv.splice(index, 2);
    assert.throws(() => parseArgs(argv), /requires/u);
  }
});

function receipt(platform = 'darwin', architecture = 'arm64') {
  const platformId = `${platform}-${architecture}`;
  const latestRootResolution = {
    root: '@snapback/cli',
    selected: CONTEXT.candidateRootVersion,
  };
  const attemptStartedAt = '2026-07-28T22:00:10.000Z';
  const attemptCompletedAt = '2026-07-28T22:00:11.000Z';
  return {
    schemaVersion: 'snapback.package-cold-install.v2',
    ok: true,
    rootSelector: 'latest',
    installSource: 'public',
    version: CONTEXT.candidateRootVersion,
    candidateLedgerSha256: CONTEXT.candidateLedgerSha256,
    latestRootResolution,
    latestRootPropagation: {
      schemaVersion: 'snapback.latest-root-host-retry.v1',
      authorizedLeaseSha256: CONTEXT.authorizedLeaseSha256,
      publicationEpoch: CONTEXT.publicationEpoch,
      operationId: CONTEXT.operationId,
      platform: platformId,
      candidateLedgerSha256: CONTEXT.candidateLedgerSha256,
      package: '@ccheever/snapback-cli',
      candidateRootVersion: CONTEXT.candidateRootVersion,
      expectedPriorRootVersion: CONTEXT.expectedPriorRootVersion,
      registry: 'https://registry.npmjs.org',
      wallBoundMs: LATEST_ROOT_PROPAGATION_WALL_BOUND_MS,
      maxAttempts: LATEST_ROOT_PROPAGATION_MAX_ATTEMPTS,
      retryDelayMs: LATEST_ROOT_PROPAGATION_RETRY_DELAY_MS,
      cachePolicy: 'unique-empty-per-attempt',
      lifecycleScripts: 'disabled',
      startedAt: attemptStartedAt,
      completedAt: attemptCompletedAt,
      status: 'candidate-complete',
      distinctCacheCount: 1,
      attempts: [{
        attempt: 1,
        startedAt: attemptStartedAt,
        completedAt: attemptCompletedAt,
        durationMs: 1_000,
        installTimeoutMs: 45_000,
        cacheIdentitySha256: '1'.repeat(64),
        rootVersion: CONTEXT.candidateRootVersion,
        classification: 'candidate-complete',
        npmTreeSha256: '2'.repeat(64),
        tagVectorSha256: '3'.repeat(64),
      }],
      finalCandidateClosureSha256: sha256Hex(canonicalJcs(latestRootResolution)),
    },
    sourceCheckout: {
      headSha: CONTEXT.ledgerRevision,
      dirty: false,
    },
    proofHarnessCheckout: {
      headSha: CONTEXT.expectedHeadSha,
      dirty: false,
    },
    githubProof: {
      repository: CONTEXT.repository,
      workflowRef:
        `${CONTEXT.repository}/.github/workflows/${CONTEXT.workflow}@refs/heads/${CONTEXT.ref}`,
      ref: `refs/heads/${CONTEXT.ref}`,
      eventName: 'workflow_dispatch',
      runId: String(CONTEXT.runId),
      runAttempt: String(CONTEXT.runAttempt),
      runHeadSha: CONTEXT.expectedHeadSha,
      operationId: CONTEXT.operationId,
    },
    machine: {
      platform,
      architecture,
      runnerEnvironment: 'github-hosted',
      separatelyProvisionedCleanMachine: true,
      githubRunId: String(CONTEXT.runId),
      githubRunAttempt: String(CONTEXT.runAttempt),
      githubRepository: CONTEXT.repository,
      githubWorkflowSha: CONTEXT.expectedHeadSha,
      proofHarnessRevision: CONTEXT.expectedHeadSha,
    },
  };
}

function collection(bytesByPlatform) {
  const artifacts = [...bytesByPlatform.entries()].map(([platform, bytes], index) => {
    const archiveSha256 = String(index + 1).repeat(64);
    return {
      platform,
      artifactId: 700 + index,
      artifactName:
        `snapback-${platform}-latest-public-package-receipt-${CONTEXT.runId}`,
      apiDigest: `sha256:${archiveSha256}`,
      archiveSha256,
      receiptFilename: `snapback-${platform}-public-package-receipt.json`,
      receiptSha256: sha256(bytes),
    };
  });
  return {
    schemaVersion: 'snapback.github-latest-root-proof-collection.v3',
    authorizedLeaseSha256: CONTEXT.authorizedLeaseSha256,
    publicationEpoch: CONTEXT.publicationEpoch,
    expectedPriorRootVersion: CONTEXT.expectedPriorRootVersion,
    candidateLedgerSha256: CONTEXT.candidateLedgerSha256,
    candidateRootVersion: CONTEXT.candidateRootVersion,
    repository: CONTEXT.repository,
    workflow: CONTEXT.workflow,
    workflowId: 42,
    workflowPath:
      `.github/workflows/${CONTEXT.workflow}@refs/heads/${CONTEXT.ref}`,
    ref: CONTEXT.ref,
    expectedHeadSha: CONTEXT.expectedHeadSha,
    runHeadSha: CONTEXT.expectedHeadSha,
    operationId: CONTEXT.operationId,
    ledgerRevision: CONTEXT.ledgerRevision,
    runId: CONTEXT.runId,
    runAttempt: CONTEXT.runAttempt,
    dispatchStartedAt: '2026-07-28T22:00:00.000Z',
    runCreatedAt: '2026-07-28T22:00:02.000Z',
    runStartedAt: '2026-07-28T22:00:05.000Z',
    collectedAt: '2026-07-28T22:04:00.000Z',
    artifacts,
  };
}

test('admits only the exact GitHub-hosted latest-root run correlation', () => {
  const value = receipt();
  assert.equal(
    validateExistingLatestReceipt(value, 'darwin-arm64', CONTEXT),
    value,
  );
  for (const mutate of [
    (candidate) => { candidate.schemaVersion = 'snapback.package-cold-install.v1'; },
    (candidate) => { candidate.rootSelector = 'exact'; },
    (candidate) => { candidate.sourceCheckout.dirty = true; },
    (candidate) => { candidate.sourceCheckout.headSha = 'c'.repeat(40); },
    (candidate) => { delete candidate.proofHarnessCheckout; },
    (candidate) => { candidate.proofHarnessCheckout.dirty = true; },
    (candidate) => { candidate.proofHarnessCheckout.headSha = 'c'.repeat(40); },
    (candidate) => { candidate.githubProof.operationId = 'other-operation'; },
    (candidate) => { candidate.githubProof.runId = '999'; },
    (candidate) => { candidate.githubProof.runAttempt = '1'; },
    (candidate) => { candidate.githubProof.runHeadSha = 'd'.repeat(40); },
    (candidate) => { candidate.githubProof.workflowRef = 'ccheever/snapback/.github/workflows/evil.yml@refs/heads/main'; },
    (candidate) => { candidate.machine.runnerEnvironment = 'local'; },
    (candidate) => { candidate.latestRootPropagation.expectedPriorRootVersion = '0.0.9'; },
    (candidate) => { candidate.latestRootPropagation.retryDelayMs = 0; },
    (candidate) => { candidate.version = '0.1.2'; },
  ]) {
    const candidate = structuredClone(value);
    mutate(candidate);
    assert.throws(
      () => validateExistingLatestReceipt(candidate, 'darwin-arm64', CONTEXT),
      /GitHub|fresh|correlation|operation|source checkout|proof harness|propagation/u,
    );
  }
});

test('collection binds run attempt, artifact ids/digests, receipt bytes, and freshness', () => {
  const bytes = new Map([
    ['darwin-arm64', Buffer.from(JSON.stringify(receipt()))],
    ['linux-x64', Buffer.from(JSON.stringify(receipt('linux', 'x64')))],
  ]);
  const value = collection(bytes);
  const options = {
    repository: CONTEXT.repository,
    workflow: CONTEXT.workflow,
    ref: CONTEXT.ref,
    expectedHeadSha: CONTEXT.expectedHeadSha,
    expectedPriorRootVersion: CONTEXT.expectedPriorRootVersion,
    authorizedLeaseSha256: CONTEXT.authorizedLeaseSha256,
    publicationEpoch: CONTEXT.publicationEpoch,
    operationId: CONTEXT.operationId,
  };
  assert.equal(validateGithubLatestProofCollection({
    collection: value,
    options,
    ledgerIdentity: {
      revision: CONTEXT.ledgerRevision,
      candidateLedgerSha256: CONTEXT.candidateLedgerSha256,
      version: CONTEXT.candidateRootVersion,
    },
    receiptBytesByPlatform: bytes,
    now: NOW,
  }), value);
  for (const mutate of [
    (candidate) => { candidate.runAttempt = 1; },
    (candidate) => { candidate.operationId = 'other-operation'; },
    (candidate) => { candidate.expectedPriorRootVersion = '0.0.9'; },
    (candidate) => { candidate.authorizedLeaseSha256 = 'e'.repeat(64); },
    (candidate) => { candidate.publicationEpoch = 18; },
    (candidate) => { candidate.candidateLedgerSha256 = 'f'.repeat(64); },
    (candidate) => { candidate.candidateRootVersion = '0.1.2'; },
    (candidate) => { candidate.artifacts[0].artifactId = 0; },
    (candidate) => { candidate.artifacts[1].artifactId = candidate.artifacts[0].artifactId; },
    (candidate) => { candidate.artifacts[0].apiDigest = `sha256:${'f'.repeat(64)}`; },
    (candidate) => { candidate.artifacts[0].receiptSha256 = 'e'.repeat(64); },
    (candidate) => { candidate.dispatchStartedAt = '2026-07-28T21:00:00.000Z'; },
  ]) {
    const candidate = structuredClone(value);
    mutate(candidate);
    assert.throws(() => validateGithubLatestProofCollection({
      collection: candidate,
      options,
      ledgerIdentity: {
        revision: CONTEXT.ledgerRevision,
        candidateLedgerSha256: CONTEXT.candidateLedgerSha256,
        version: CONTEXT.candidateRootVersion,
      },
      receiptBytesByPlatform: bytes,
      now: NOW,
    }));
  }
});
