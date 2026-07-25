import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  importVisualApproval,
  validateVisualApproval,
} from './step4-import-visual-approval.mjs';

const temporaryRoots = [];

test.afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'partitime-visual-approval-'));
  temporaryRoots.push(root);
  const imagePath = 'evidence/react/light/compact/feed.png';
  const absoluteImagePath = join(root, imagePath);
  mkdirSync(dirname(absoluteImagePath), { recursive: true });
  const imageBytes = Buffer.from('retained-image');
  writeFileSync(absoluteImagePath, imageBytes);
  const imageSha256 = sha256(imageBytes);
  const revisions = { snapback: 'a'.repeat(40), exact: 'b'.repeat(40) };
  const spec = {
    specVersion: 'partitime.visual.v1',
    arms: ['react'],
    states: [{ id: 'feed' }],
    themes: [{ id: 'light' }],
    viewports: [{ id: 'compact' }],
    approval: { requiredCells: 1 },
  };
  const index = {
    $schema: 'partitime-visual-baseline-index/v1',
    specVersion: spec.specVersion,
    revisions: { ...revisions },
    captureComplete: true,
    approval: { status: 'pending-human-review' },
    outcome: 'pending-human-review',
    artifacts: [{
      arm: 'react',
      state: 'feed',
      theme: 'light',
      viewport: 'compact',
      path: imagePath,
      sha256: imageSha256,
    }],
  };
  const record = {
    arm: 'react',
    state: 'feed',
    theme: 'light',
    viewport: 'compact',
    imagePath,
    imageSha256,
    specVersion: spec.specVersion,
    reviewer: 'Visual reviewer',
    reviewedAt: '2026-07-25T02:00:00.000Z',
    approved: true,
  };
  const approval = {
    $schema: 'partitime-visual-approval/v1',
    revisions: { ...revisions },
    specVersion: spec.specVersion,
    reviewer: record.reviewer,
    reviewedAt: record.reviewedAt,
    approved: true,
    records: [record],
  };
  return { root, spec, index, approval };
}

test('validates and imports one complete approval set', () => {
  const { root, spec, index, approval } = fixture();
  const specPath = join(root, 'spec.json');
  const indexPath = join(root, 'index.json');
  const approvalPath = join(root, 'review.json');
  const outputPath = join(root, 'approval.json');
  writeJson(specPath, spec);
  writeJson(indexPath, index);
  writeJson(approvalPath, approval);

  const result = importVisualApproval({
    approvalPath,
    indexPath,
    specPath,
    outputPath,
    sourceRoot: root,
  });
  assert.equal(result.cells, 1);
  assert.equal(result.reviewer, 'Visual reviewer');

  const updatedIndex = JSON.parse(readFileSync(indexPath, 'utf8'));
  assert.equal(updatedIndex.approval.status, 'approved');
  assert.equal(updatedIndex.approval.approvedBy, 'Visual reviewer');
  assert.equal(updatedIndex.outcome, 'pass');
  assert.equal(
    updatedIndex.approval.artifact.sha256,
    sha256(readFileSync(outputPath)),
  );
});

test('rejects incomplete, unapproved, or revision-mismatched reviews', () => {
  const missing = fixture();
  missing.approval.records = [];
  assert.throws(
    () => validateVisualApproval({
      approval: missing.approval,
      index: missing.index,
      spec: missing.spec,
      sourceRoot: missing.root,
    }),
    /cell count is incomplete|missing cell/,
  );

  const unapproved = fixture();
  unapproved.approval.records[0].approved = false;
  assert.throws(
    () => validateVisualApproval({
      approval: unapproved.approval,
      index: unapproved.index,
      spec: unapproved.spec,
      sourceRoot: unapproved.root,
    }),
    /is not approved/,
  );

  const wrongRevision = fixture();
  wrongRevision.approval.revisions.exact = 'c'.repeat(40);
  assert.throws(
    () => validateVisualApproval({
      approval: wrongRevision.approval,
      index: wrongRevision.index,
      spec: wrongRevision.spec,
      sourceRoot: wrongRevision.root,
    }),
    /revision pair does not match/,
  );
});

test('rejects forged image identities and paths outside the repository', () => {
  const forged = fixture();
  forged.approval.records[0].imageSha256 = '0'.repeat(64);
  assert.throws(
    () => validateVisualApproval({
      approval: forged.approval,
      index: forged.index,
      spec: forged.spec,
      sourceRoot: forged.root,
    }),
    /image digest drift/,
  );

  const escaped = fixture();
  escaped.approval.records[0].imagePath = '../outside.png';
  escaped.index.artifacts[0].path = '../outside.png';
  assert.throws(
    () => validateVisualApproval({
      approval: escaped.approval,
      index: escaped.index,
      spec: escaped.spec,
      sourceRoot: escaped.root,
    }),
    /escapes repository/,
  );
});

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
