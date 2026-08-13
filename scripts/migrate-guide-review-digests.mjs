#!/usr/bin/env node
// One-shot migration from commit-pinned Guide review anchors to authority-byte
// digests. Each old verdict is evaluated at its historical commit rather than
// being silently reset to the current tree.
// @ref LLP 0232#d-2-prepared-execution-and-rebase-stable-records — frozen Guide records must survive gate-disjoint rebases.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  authoritiesDigest,
  authoritiesDigestAtRevision,
  listGuidePages,
  parseFrontmatter,
  repoRoot,
} from './guide-lib.mjs';

function replaceReviewAnchor(root, path, digest, source) {
  const next = source.replace(
    /^(?:reviewed-commit|reviewed-authorities-digest): .*$/m,
    `reviewed-authorities-digest: ${digest}`,
  );
  if (next === source) throw new Error(`${path}: could not replace review anchor`);
  writeFileSync(join(root, path), next);
}

export function migrateGuideReviewDigests(root, paths = listGuidePages(root)) {
  const migrated = [];
  for (const path of paths) {
    const absolute = join(root, path);
    const source = readFileSync(absolute, 'utf8');
    const errors = [];
    const { frontmatter } = parseFrontmatter(source, path, errors);
    if (errors.length > 0 || !frontmatter) {
      throw new Error(errors.join('\n') || `${path}: missing frontmatter`);
    }
    const reviewedCommit = frontmatter['reviewed-commit'];
    if (!reviewedCommit) continue;
    const digest = authoritiesDigestAtRevision(
      root,
      frontmatter.authorities ?? [],
      reviewedCommit,
    );
    replaceReviewAnchor(root, path, digest, source);
    migrated.push({ path, reviewedCommit, digest });
  }
  return migrated;
}

export function refreshGuideReviewDigests(root, paths) {
  const refreshed = [];
  for (const path of paths) {
    const source = readFileSync(join(root, path), 'utf8');
    const errors = [];
    const { frontmatter } = parseFrontmatter(source, path, errors);
    if (errors.length > 0 || !frontmatter) {
      throw new Error(errors.join('\n') || `${path}: missing frontmatter`);
    }
    const digest = authoritiesDigest(root, frontmatter.authorities ?? []);
    replaceReviewAnchor(root, path, digest, source);
    refreshed.push({ path, digest });
  }
  return refreshed;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const root = repoRoot();
  const args = process.argv.slice(2);
  if (args[0] === '--refresh') {
    const paths = args.slice(1);
    if (paths.length === 0) throw new Error('--refresh requires at least one Guide page path');
    const refreshed = refreshGuideReviewDigests(root, paths);
    for (const { path, digest } of refreshed) {
      console.log(`[guide-review-refresh] ${path}: ${digest}`);
    }
    console.log(`[guide-review-refresh] refreshed ${refreshed.length} page review anchors`);
    process.exit(0);
  }
  const migrated = migrateGuideReviewDigests(root, args.length > 0 ? args : undefined);
  for (const { path, reviewedCommit, digest } of migrated) {
    console.log(`[guide-review-migration] ${path}: ${reviewedCommit} -> ${digest}`);
  }
  console.log(`[guide-review-migration] migrated ${migrated.length} page review anchors`);
}
