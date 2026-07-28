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
    id: '@snapback/runtime-linux-x64',
    packageDir: 'packages/snapback-runtime-linux-x64',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: ['package.test.mjs'],
  },
  {
    id: '@snapback/cli',
    packageDir: 'packages/snapback-cli',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: [
      'adapters/fly-machines-vm-driver.test.mjs',
      'comparator-profile.test.mjs',
      'dev-loop.test.mjs',
      'hosted-admission-producer.test.mjs',
      'mcp-control.test.mjs',
      'package.test.mjs',
    ],
  },
  {
    id: '@snapback/vite',
    packageDir: 'packages/snapback-vite',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: ['channel-a.test.mjs', 'package.test.mjs', 'rqs-serializer.test.mjs'],
  },
  {
    id: '@snapback/client',
    packageDir: 'packages/snapback-client',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: [
      'bundle.test.mjs',
      'external-store.test.mjs',
      'hosted-browser.test.mjs',
      'hosted-ephemeral.test.mjs',
      'package.test.mjs',
      'rqs-digest-parity.test.mjs',
      'rqs-resume-native.test.mjs',
      'rqs-resume.test.mjs',
      'rqs-store-file.test.mjs',
      'rqs-store.test.mjs',
      'sender-proof.test.mjs',
      'sender-transport.test.mjs',
      'search.test.mjs',
      'wire-version.test.mjs',
    ],
  },
  {
    id: '@snapback/hosted-supervisor',
    packageDir: 'packages/snapback-hosted-supervisor',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: ['index.test.mjs'],
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
      'effect-ceiling.test.mjs',
      'function-id.test.mjs',
      'identifier-validation.test.mjs',
      'inline-result-contracts.test.mjs',
      'maintained-projections.test.mjs',
      'operation-schemas.test.mjs',
      'provider-introspection.test.mjs',
      'protected-query-profile.test.mjs',
      'rbac-authoring.test.mjs',
      'receipt-capability.test.mjs',
      'relation-activity-authoring.test.mjs',
      'relational-authoring.test.mjs',
      'remote-service-publication.test.mjs',
      'retainability-profile.test.mjs',
      'review-surface.test.mjs',
      'seed-artifact.test.mjs',
      'standard-patterns.test.mjs',
    ],
  },
  {
    id: '@snapback/contract',
    packageDir: 'packages/snapback-contract',
    testDir: '.',
    suffix: '.test.mjs',
    scriptNames: ['pretest', 'test'],
    expectedFiles: [
      'artifact-validation.test.mjs',
      'auth-coordinator-contract.test.mjs',
      'auth-coordinator-missed-wakeup.test.mjs',
      'auth-coordinator.test.mjs',
      'auth-custody-indexeddb.test.mjs',
      'auth-invalidation.test.mjs',
      'auth-sender-custody.test.mjs',
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
      'migration-quarantine.test.mjs',
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
// 77 -> 79 (2026-07-24, ENG-25454): @snapback/vite gains channel-a.test.mjs
// and rqs-serializer.test.mjs (LLP 0092 §0E Channel A seam + serializer).
// 79 -> 82 (2026-07-25, ENG-25456): @snapback/client gains
// rqs-store-file.test.mjs and rqs-resume-native.test.mjs (LLP 0090 step-5
// native arm), and @snapback/codegen's relational-authoring.test.mjs
// (landed f779c35c, LLP 0080 slice 3) is registered here — the landing
// commit added the file and its test script entry without updating this
// canonical inventory.
// 82 -> 83 (2026-07-25, Step 5 witness rerun): @snapback/codegen gains
// maintained-projections.test.mjs (landed 21bb68ff, LLP 0080 §5 authoring
// surface) — the landing added the file and its test-script entry without
// updating this canonical inventory; caught by the cumulative-gate rerun.
// 83 -> 85 (LLP 0074 integration): retain the Linux runtime package proof
// and the CLI hosted-admission producer suite alongside current main.
// 85 -> 86 (LLP 0081 §6): @snapback/contract gains the maintained
// migration-boundary quarantine regression.
// 86 -> 87 (LLP 0072 Fly adapter landing): @snapback/cli gains the
// maintained Fly Machines VM driver suite.
// 87 -> 88 (LLP 0094 B2): @snapback/client gains the wire-version
// negotiation suite (open-time offer, echo witness, §0B.6 fallback).
// 88 -> 89 (package-owned comparator acceptance kit): @snapback/cli gains
// the five-property comparator, failure matrix, receipt, and pack proof.
// 89 -> 91 (codegen review surface): @snapback/codegen gains cache/custody
// conformance and @snapback/contract gains review-manifest projection checks.
// 91 -> 94 (backend-bakeoff reconciliation): @snapback/client gains portable
// search parsing, while @snapback/codegen gains inline/result-contract and
// versioned-seed artifact coverage.
// 94 -> 95 (LLP 0104): @snapback/codegen gains the bounded-relation and
// transactional write/activity authoring corpus.
// 95 -> 97 (LLP 0105): @snapback/client gains hosted ephemeral authority
// replacement/republish coverage and the independently packed supervisor
// gains its deterministic fencing/effect/spend/TLS/cleanup corpus.
assert.equal(total, 97, 'reviewed package/admin test count changed');
for (const result of results) {
  process.stdout.write(`[package-test-inventory] ${result.id}: ${result.count}\n`);
}
process.stdout.write(`[package-test-inventory] PASS: ${total} declared test files\n`);
