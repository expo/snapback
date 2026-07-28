#!/usr/bin/env node

// CI review-surface gate: a manifest is the review unit; every ignored cache
// graph is independently digest-verified, and only explicitly policy-required
// projections are returned to the shell diff gate.

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CUSTODY,
  verifyGeneratedGraph,
} from '../packages/snapback-codegen/review-surface.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arguments_ = process.argv.slice(2);
const checkIndex = arguments_.includes('--check-index');
const roots = arguments_.filter((argument) => argument !== '--check-index').map((path) => resolve(path));
if (roots.length === 0) {
  process.stderr.write('usage: verify-generated-review-surface.mjs <generated-root> ...\n');
  process.exit(2);
}

const reviewPaths = [];
for (const root of roots) {
  const result = verifyGeneratedGraph(root);
  if (result.layout !== 'review-cache') {
    throw new Error(`SNAPBACK_CODEGEN_LEGACY_LAYOUT_IN_CI: ${root} must be regenerated to a v2 review manifest`);
  }
  reviewPaths.push(join(root, 'artifacts.json'));
  for (const file of result.manifest.files) {
    if (file.custody !== CUSTODY.consumerCommitted) continue;
    const committed = join(root, ...file.path.split('/'));
    if (!existsSync(committed)) {
      throw new Error(`SNAPBACK_CODEGEN_COMMITTED_PROJECTION_MISSING: ${committed}`);
    }
    const cached = readFileSync(join(result.graphRoot, ...file.path.split('/')));
    const materialized = readFileSync(committed);
    if (!cached.equals(materialized)) {
      throw new Error(`SNAPBACK_CODEGEN_COMMITTED_PROJECTION_STALE: ${committed}`);
    }
    reviewPaths.push(committed);
  }
  if (checkIndex) {
    const rootRelative = relative(repositoryRoot, root);
    const tracked = new Set(
      execFileSync('git', ['-C', repositoryRoot, 'ls-files', '--', rootRelative], { encoding: 'utf8' })
        .split(/\r?\n/u)
        .filter(Boolean),
    );
    const reviewRelative = relative(repositoryRoot, join(root, 'artifacts.json'));
    if (!tracked.has(reviewRelative)) {
      throw new Error(`SNAPBACK_CODEGEN_REVIEW_MANIFEST_UNTRACKED: ${reviewRelative}`);
    }
    for (const file of result.manifest.files) {
      const repositoryPath = relative(repositoryRoot, join(root, ...file.path.split('/')));
      const isTracked = tracked.has(repositoryPath);
      if (file.custody === CUSTODY.regenerableCache && isTracked) {
        throw new Error(`SNAPBACK_CODEGEN_REGENERABLE_PROJECTION_TRACKED: ${repositoryPath}`);
      }
      if (file.custody === CUSTODY.consumerCommitted && !isTracked) {
        throw new Error(`SNAPBACK_CODEGEN_COMMITTED_PROJECTION_UNTRACKED: ${repositoryPath}`);
      }
    }
  }
}

for (const path of reviewPaths.sort()) {
  process.stdout.write(`${relative(repositoryRoot, path)}\n`);
}
