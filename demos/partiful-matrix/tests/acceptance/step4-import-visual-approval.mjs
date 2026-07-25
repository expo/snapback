#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '..', '..');
const repoRoot = resolve(demoRoot, '..', '..');
const resultRoot = join(demoRoot, 'acceptance', 'results', 'phase4-visual-baselines');
const defaultIndexPath = join(resultRoot, 'index.json');
const defaultSpecPath = join(demoRoot, 'acceptance', 'visual-spec.v1.json');
const defaultOutputPath = join(resultRoot, 'approval.json');

export function validateVisualApproval({ approval, index, spec, sourceRoot }) {
  assert.equal(approval?.$schema, 'partitime-visual-approval/v1');
  assert.equal(index?.$schema, 'partitime-visual-baseline-index/v1');
  assert.equal(index.captureComplete, true, 'visual capture is incomplete');
  assert.equal(approval.specVersion, spec.specVersion);
  assert.equal(index.specVersion, spec.specVersion);
  assert.deepEqual(approval.revisions, index.revisions, 'approval revision pair does not match capture');
  assertRevisionPair(approval.revisions);
  assert.equal(approval.approved, true, 'top-level approval must be true');
  assertNonEmpty(approval.reviewer, 'reviewer');
  assertIsoTimestamp(approval.reviewedAt, 'reviewedAt');

  const expected = expectedCells(spec);
  const artifacts = new Map();
  for (const artifact of index.artifacts ?? []) {
    const cell = cellKey(artifact);
    assert(expected.has(cell), `capture index contains unexpected cell ${cell}`);
    assert(!artifacts.has(cell), `capture index contains duplicate cell ${cell}`);
    artifacts.set(cell, artifact);
  }
  assert.equal(artifacts.size, expected.size, 'capture index cell count is incomplete');

  const observed = new Set();
  assert(Array.isArray(approval.records), 'approval records must be an array');
  for (const record of approval.records) {
    const cell = cellKey(record);
    assert(expected.has(cell), `approval contains unexpected cell ${cell}`);
    assert(!observed.has(cell), `approval contains duplicate cell ${cell}`);
    observed.add(cell);
    assert.equal(record.specVersion, spec.specVersion, `${cell} spec version drift`);
    assert.equal(record.reviewer, approval.reviewer, `${cell} reviewer drift`);
    assert.equal(record.reviewedAt, approval.reviewedAt, `${cell} review timestamp drift`);
    assert.equal(record.approved, true, `${cell} is not approved`);

    const artifact = artifacts.get(cell);
    assert.equal(record.imagePath, artifact.path, `${cell} image path drift`);
    assert.equal(record.imageSha256, artifact.sha256, `${cell} image digest drift`);
    const imagePath = resolveRetainedPath(sourceRoot, record.imagePath, `${cell} image`);
    assert.equal(sha256(readFileSync(imagePath)), record.imageSha256, `${cell} retained image digest drift`);
  }

  assert.equal(observed.size, expected.size, 'approval cell count is incomplete');
  for (const cell of expected) assert(observed.has(cell), `approval is missing cell ${cell}`);
  return { cells: observed.size, reviewer: approval.reviewer, reviewedAt: approval.reviewedAt };
}

export function importVisualApproval({
  approvalPath,
  indexPath = defaultIndexPath,
  specPath = defaultSpecPath,
  outputPath = defaultOutputPath,
  sourceRoot = repoRoot,
}) {
  const approval = readJson(approvalPath);
  const index = readJson(indexPath);
  const spec = readJson(specPath);
  const result = validateVisualApproval({ approval, index, spec, sourceRoot });

  const approvalBytes = `${JSON.stringify(approval, null, 2)}\n`;
  writeFileSync(outputPath, approvalBytes);
  const outputRelative = relative(sourceRoot, outputPath).split('\\').join('/');
  const updatedIndex = {
    ...index,
    approval: {
      ...index.approval,
      status: 'approved',
      approvedBy: result.reviewer,
      approvedAt: result.reviewedAt,
      specVersion: spec.specVersion,
      artifact: {
        path: outputRelative,
        sha256: sha256(approvalBytes),
      },
    },
    outcome: 'pass',
  };
  writeFileSync(indexPath, `${JSON.stringify(updatedIndex, null, 2)}\n`);
  return {
    ...result,
    approvalPath: outputRelative,
    approvalSha256: sha256(approvalBytes),
  };
}

function expectedCells(spec) {
  const expected = new Set();
  for (const arm of spec.arms ?? []) {
    for (const state of spec.states ?? []) {
      for (const theme of spec.themes ?? []) {
        for (const viewport of spec.viewports ?? []) {
          expected.add([arm, state.id, theme.id, viewport.id].join(':'));
        }
      }
    }
  }
  assert.equal(expected.size, spec.approval?.requiredCells, 'visual-spec cell formula drift');
  return expected;
}

function cellKey(record) {
  return [record.arm, record.state, record.theme, record.viewport].join(':');
}

function resolveRetainedPath(root, repositoryRelativePath, label) {
  assert.equal(typeof repositoryRelativePath, 'string', `${label} path is required`);
  assert(!isAbsolute(repositoryRelativePath), `${label} path must be repository-relative`);
  const absoluteRoot = realpathSync(root);
  const absolute = resolve(absoluteRoot, repositoryRelativePath);
  const inside = relative(absoluteRoot, absolute);
  assert(inside !== '' && !inside.startsWith('..') && !isAbsolute(inside), `${label} escapes repository`);
  const retained = lstatSync(absolute);
  assert(retained.isFile() && !retained.isSymbolicLink(), `${label} must be a retained regular file`);
  assert.equal(realpathSync(absolute), absolute, `${label} resolves through a symlink`);
  return absolute;
}

function assertNonEmpty(value, label) {
  assert(typeof value === 'string' && value.trim().length > 0, `${label} is required`);
}

function assertIsoTimestamp(value, label) {
  assertNonEmpty(value, label);
  assert(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      && Number.isFinite(Date.parse(value)),
    `${label} must be an ISO-8601 timestamp`,
  );
}

function assertRevisionPair(revisions) {
  assert.match(revisions?.snapback ?? '', /^[0-9a-f]{40}$/, 'Snapback revision must be a full commit SHA');
  assert.match(revisions?.exact ?? '', /^[0-9a-f]{40}$/, 'Exact revision must be a full commit SHA');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function option(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const approvalPath = option('approval');
  if (!approvalPath) {
    throw new Error(
      'Usage: node demos/partiful-matrix/tests/acceptance/step4-import-visual-approval.mjs --approval <partitime-visual-approval.json>',
    );
  }
  const result = importVisualApproval({ approvalPath: resolve(approvalPath) });
  console.log(
    `PASS imported ${result.cells} approved visual cells from ${result.reviewer} (${result.approvalSha256})`,
  );
}
