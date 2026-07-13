#!/usr/bin/env node

import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ref LLP 0010#ci-and-review-gates — canonical proof inventories every
// maintained package test instead of sampling filenames by hand.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IGNORED_TEST_DIRS = new Set(['.git', 'coverage', 'dist', 'node_modules']);

const inventories = [
  {
    id: '@snapback/codegen',
    packageDir: 'packages/snapback-codegen',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: [
      'authoring-validation.test.mjs',
      'contract-binding-reads.test.mjs',
      'data-tier-corpus.test.mjs',
      'dependency-graph.test.mjs',
      'identifier-validation.test.mjs',
      'receipt-capability.test.mjs',
    ],
  },
  {
    id: '@snapback/contract',
    packageDir: 'packages/snapback-contract',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: [
      'build-preset.test.mjs',
      'derived-overlay-duplicate-reapply.test.mjs',
      'derived-overlay-reconcile-failure.test.mjs',
      'derived-overlay.test.mjs',
      'ephemeral-resubscribe-race.test.mjs',
      'exact-conformance.test.mjs',
      'exact-package.test.mjs',
      'index.test.mjs',
      'multi-live-poll-reconcile.test.mjs',
      'mutation-reconcile-failure.test.mjs',
      'offline-replay.test.mjs',
      'optimistic-duplicate-reapply.test.mjs',
      'render-first.test.mjs',
      'retained-identity.test.mjs',
      'surface-construction-failure.test.mjs',
    ],
  },
  {
    id: 'snapback-admin-ui',
    packageDir: 'admin-ui',
    testDir: 'tests',
    suffix: '.mjs',
    expectedFiles: [
      'tests/auth-prompt.mjs',
      'tests/contract-bindings.mjs',
      'tests/dev-serve-react-esm.mjs',
      'tests/fatal-rendering.mjs',
      'tests/kv-layout.mjs',
      'tests/static-metadata.mjs',
    ],
  },
];

export function inspectInventory({ root = ROOT, inventory }) {
  const packageRoot = join(root, inventory.packageDir);
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const command = packageJson.scripts?.test;
  assert.equal(typeof command, 'string', `${inventory.id} must declare scripts.test`);

  const discovered = [];
  const pending = [join(packageRoot, inventory.testDir)];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !IGNORED_TEST_DIRS.has(entry.name)) pending.push(path);
      if (entry.isFile() && entry.name.endsWith(inventory.suffix)) {
        discovered.push(relative(packageRoot, path));
      }
    }
  }
  discovered.sort();
  const declared = [...command.matchAll(/(?:^|&&)\s*node\s+([^\s&]+\.mjs)(?=\s|$)/g)]
    .map((match) => match[1].replace(/^\.\//, ''))
    .sort();

  assert.deepEqual(
    discovered,
    [...inventory.expectedFiles].sort(),
    `${inventory.id} maintained test IDs/count changed; review and update the canonical inventory`,
  );

  assert.deepEqual(
    declared,
    discovered,
    `${inventory.id} scripts.test must name every maintained ${inventory.suffix} exactly once`,
  );
  return { id: inventory.id, count: discovered.length, files: discovered };
}

const results = inventories.map((inventory) => inspectInventory({ inventory }));
const total = results.reduce((sum, result) => sum + result.count, 0);
assert.equal(total, 27, 'reviewed package/admin test count changed');
for (const result of results) {
  process.stdout.write(`[package-test-inventory] ${result.id}: ${result.count}\n`);
}
process.stdout.write(`[package-test-inventory] PASS: ${total} declared test files\n`);
