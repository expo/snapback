import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  validateExistingLatestReceipt,
  validateGithubLatestProofCollection,
} from './snapback-github-latest-proof.mjs';

const NOW = Date.parse('2026-07-28T22:05:00.000Z');
const CONTEXT = {
  repository: 'ccheever/snapback',
  workflow: 'public-package-proof.yml',
  ref: 'agent/release',
  expectedHeadSha: 'a'.repeat(40),
  operationId: 'release-proof-test',
  ledgerRevision: 'b'.repeat(40),
  runId: 123456789,
  runAttempt: 2,
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function receipt(platform = 'darwin', architecture = 'arm64') {
  return {
    schemaVersion: 'snapback.package-cold-install.v1',
    ok: true,
    rootSelector: 'latest',
    installSource: 'public',
    sourceCheckout: {
      headSha: CONTEXT.ledgerRevision,
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
    schemaVersion: 'snapback.github-latest-root-proof-collection.v2',
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
    (candidate) => { candidate.rootSelector = 'exact'; },
    (candidate) => { candidate.sourceCheckout.dirty = true; },
    (candidate) => { candidate.sourceCheckout.headSha = 'c'.repeat(40); },
    (candidate) => { candidate.githubProof.operationId = 'other-operation'; },
    (candidate) => { candidate.githubProof.runId = '999'; },
    (candidate) => { candidate.githubProof.runAttempt = '1'; },
    (candidate) => { candidate.githubProof.runHeadSha = 'd'.repeat(40); },
    (candidate) => { candidate.githubProof.workflowRef = 'ccheever/snapback/.github/workflows/evil.yml@refs/heads/main'; },
    (candidate) => { candidate.machine.runnerEnvironment = 'local'; },
  ]) {
    const candidate = structuredClone(value);
    mutate(candidate);
    assert.throws(
      () => validateExistingLatestReceipt(candidate, 'darwin-arm64', CONTEXT),
      /GitHub|fresh|correlation|operation|source checkout/u,
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
    operationId: CONTEXT.operationId,
  };
  assert.equal(validateGithubLatestProofCollection({
    collection: value,
    options,
    ledgerRevision: CONTEXT.ledgerRevision,
    receiptBytesByPlatform: bytes,
    now: NOW,
  }), value);
  for (const mutate of [
    (candidate) => { candidate.runAttempt = 1; },
    (candidate) => { candidate.operationId = 'other-operation'; },
    (candidate) => { candidate.artifacts[0].artifactId = 0; },
    (candidate) => { candidate.artifacts[0].apiDigest = `sha256:${'f'.repeat(64)}`; },
    (candidate) => { candidate.artifacts[0].receiptSha256 = 'e'.repeat(64); },
    (candidate) => { candidate.dispatchStartedAt = '2026-07-28T21:00:00.000Z'; },
  ]) {
    const candidate = structuredClone(value);
    mutate(candidate);
    assert.throws(() => validateGithubLatestProofCollection({
      collection: candidate,
      options,
      ledgerRevision: CONTEXT.ledgerRevision,
      receiptBytesByPlatform: bytes,
      now: NOW,
    }));
  }
});
