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
    id: '@snapback/runtime-darwin-arm64',
    packageDir: 'packages/snapback-runtime-darwin-arm64',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: ['package.test.mjs'],
  },
  {
    id: '@snapback/cli',
    packageDir: 'packages/snapback-cli',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: ['dev-loop.test.mjs', 'mcp-control.test.mjs', 'package.test.mjs'],
  },
  {
    id: '@snapback/vite',
    packageDir: 'packages/snapback-vite',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: ['package.test.mjs'],
  },
  {
    id: '@snapback/client',
    packageDir: 'packages/snapback-client',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: ['external-store.test.mjs', 'package.test.mjs'],
  },
  {
    id: '@snapback/react',
    packageDir: 'packages/snapback-react',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: ['package.test.mjs'],
  },
  {
    id: '@snapback/app-cli',
    packageDir: 'packages/snapback-app-cli',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: ['package.test.mjs'],
  },
  {
    id: '@snapback/codegen',
    packageDir: 'packages/snapback-codegen',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: [
      'auth-artifacts.test.mjs',
      'auth-crypto-vectors.test.mjs',
      'authoring-validation.test.mjs',
      'contract-binding-reads.test.mjs',
      'data-tier-corpus.test.mjs',
      'dependency-graph.test.mjs',
      'function-id.test.mjs',
      'identifier-validation.test.mjs',
      'operation-schemas.test.mjs',
      'provider-introspection.test.mjs',
      'protected-query-profile.test.mjs',
      'rbac-authoring.test.mjs',
      'receipt-capability.test.mjs',
      'remote-service-publication.test.mjs',
      'retainability-profile.test.mjs',
      'standard-patterns.test.mjs',
    ],
  },
  {
    id: '@snapback/contract',
    packageDir: 'packages/snapback-contract',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: [
      'auth-coordinator-contract.test.mjs',
      'auth-coordinator-missed-wakeup.test.mjs',
      'auth-coordinator.test.mjs',
      'auth-custody-indexeddb.test.mjs',
      'auth-invalidation.test.mjs',
      'agent-authority-contract.test.mjs',
      'authorized-contract.test.mjs',
      'authorized-lease.test.mjs',
      'authorized-retained-store.test.mjs',
      'build-preset.test.mjs',
      'client-store-authority.test.mjs',
      'client-store-queue-authorization.test.mjs',
      'cold-offline-authorized-retention.test.mjs',
      'derived-overlay-duplicate-reapply.test.mjs',
      'derived-overlay-reconcile-failure.test.mjs',
      'derived-overlay.test.mjs',
      'ephemeral-resubscribe-race.test.mjs',
      'exact-conformance.test.mjs',
      'exact-package.test.mjs',
      'index.test.mjs',
      'keyed-provider.test.mjs',
      'lifecycle-generation-exhaustion.test.mjs',
      'multi-live-poll-reconcile.test.mjs',
      'mutation-reconcile-failure.test.mjs',
      'offline-replay.test.mjs',
      'online-surface.test.mjs',
      'optimistic-duplicate-reapply.test.mjs',
      'query-authorization.test.mjs',
      'render-first.test.mjs',
      'retained-identity.test.mjs',
      'session-queue-axis.test.mjs',
      'surface-construction-failure.test.mjs',
      'unsolicited-protocol-echo.test.mjs',
    ],
  },
  {
    id: 'snapback-admin-ui',
    packageDir: 'admin-ui',
    testDir: 'tests',
    suffix: '.mjs',
    scriptNames: ['test', 'test:browser-security'],
    expectedFiles: [
      'tests/acceptance/csp-browser.mjs',
      'tests/admin-client-credentials.mjs',
      'tests/auth-prompt.mjs',
      'tests/contract-bindings.mjs',
      'tests/dev-serve-react-esm.mjs',
      'tests/fatal-rendering.mjs',
      'tests/kv-layout.mjs',
      'tests/setup-credential-errors.mjs',
      'tests/static-metadata.mjs',
      'tests/theme-import-dependencies.mjs',
    ],
  },
];

export function inspectInventory({ root = ROOT, inventory }) {
  const packageRoot = join(root, inventory.packageDir);
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const scriptNames = inventory.scriptNames ?? ['test'];
  const commands = scriptNames.map((name) => {
    const command = packageJson.scripts?.[name];
    assert.equal(typeof command, 'string', `${inventory.id} must declare scripts.${name}`);
    return command;
  });

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
  const declared = commands.flatMap((command) => [
    ...command.matchAll(/(?:^|&&)\s*node\s+([^\s&]+\.mjs)(?=\s|$)/g),
  ])
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
    `${inventory.id} configured test scripts must name every maintained ${inventory.suffix} exactly once`,
  );
  return { id: inventory.id, count: discovered.length, files: discovered };
}

const results = inventories.map((inventory) => inspectInventory({ inventory }));
const total = results.reduce((sum, result) => sum + result.count, 0);
assert.equal(total, 67, 'reviewed package/admin test count changed');
for (const result of results) {
  process.stdout.write(`[package-test-inventory] ${result.id}: ${result.count}\n`);
}
process.stdout.write(`[package-test-inventory] PASS: ${total} declared test files\n`);
