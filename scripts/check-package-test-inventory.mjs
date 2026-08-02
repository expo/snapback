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
    id: '@expo/snapback-runtime-darwin-arm64',
    packageDir: 'packages/snapback-runtime-darwin-arm64',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: ['package.test.mjs'],
  },
  {
    id: '@expo/snapback-runtime-linux-x64',
    packageDir: 'packages/snapback-runtime-linux-x64',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: ['package.test.mjs'],
  },
  {
    id: '@expo/snapback-cli',
    packageDir: 'packages/snapback-cli',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: [
      'adapters/fly-machines-vm-driver.test.mjs',
      'comparator-profile.test.mjs',
      'dev-cli-diagnostics.test.mjs',
      'dev-loop.test.mjs',
      'hosted-admission-producer.test.mjs',
      'hosted-control.test.mjs',
      'load-generated.test.mjs',
      'mcp-control.test.mjs',
      'package.test.mjs',
      'sessions-dev-loop.test.mjs',
    ],
  },
  {
    id: '@expo/snapback-vite',
    packageDir: 'packages/snapback-vite',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: ['channel-a.test.mjs', 'package.test.mjs', 'rqs-serializer.test.mjs'],
  },
  {
    id: '@expo/snapback-client',
    packageDir: 'packages/snapback-client',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: [
      'app-data.test.mjs',
      'argument-validation.test.mjs',
      'assets-watch-authorization.test.mjs',
      'assets.test.mjs',
      'attribution.test.mjs',
      'bearer-rotation.test.mjs',
      'browser-closure.test.mjs',
      'bundle.test.mjs',
      'ephemeral-room.test.mjs',
      'external-store.test.mjs',
      'hosted-browser.test.mjs',
      'hosted-ephemeral.test.mjs',
      'lifecycle-disposal.test.mjs',
      'outbox-store.test.mjs',
      'package.test.mjs',
      'reservation-retry.test.mjs',
      'rqs-digest-parity.test.mjs',
      'rqs-resume-expo.test.mjs',
      'rqs-resume-native.test.mjs',
      'rqs-resume.test.mjs',
      'rqs-store-expo.test.mjs',
      'rqs-store-file.test.mjs',
      'rqs-store.test.mjs',
      'sender-proof.test.mjs',
      'sender-transport.test.mjs',
      'search.test.mjs',
      'webcrypto-fallback.test.mjs',
      'wire-version.test.mjs',
    ],
  },
  {
    id: '@expo/snapback-hosted-supervisor',
    packageDir: 'packages/snapback-hosted-supervisor',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: [
      'bootstrap.test.mjs',
      'external-store.test.mjs',
      'hosted-edge-admission.test.mjs',
      'index.test.mjs',
      'operator-authority-transaction.test.mjs',
      'operator-authority.test.mjs',
      'operator-service.test.mjs',
      'package.test.mjs',
      'provider-credentials.test.mjs',
      'provider-executor.test.mjs',
      'supervisor-response.test.mjs',
      'target-onboarding.test.mjs',
    ],
  },
  {
    id: '@expo/snapback-publication-authority',
    packageDir: 'packages/snapback-publication-authority',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: [
      'authority.test.mjs',
      'request.test.mjs',
      'schema.test.mjs',
      'server.test.mjs',
    ],
  },
  {
    id: '@expo/snapback-react',
    packageDir: 'packages/snapback-react',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: [
      'assets.test.mjs',
      'authorization-denial.test.mjs',
      'cold-boot-binding.test.mjs',
      'lifecycle.test.mjs',
      'offline.test.mjs',
      'optimistic.test.mjs',
      'package.test.mjs',
      'presence.test.mjs',
      'webcrypto-fallback.test.mjs',
    ],
  },
  {
    id: '@expo/snapback-app-cli',
    packageDir: 'packages/snapback-app-cli',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: [
      'attribution.test.mjs',
      'envelope.test.mjs',
      'package.test.mjs',
      'result-core.test.mjs',
    ],
  },
  {
    id: '@expo/snapback-codegen',
    packageDir: 'packages/snapback-codegen',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: [
      'api-envelope-members.test.mjs',
      'args-contract-goldens.test.mjs',
      'asset-thumbhash-vector.test.mjs',
      'asset-upload-authoring.test.mjs',
      'auth-artifacts.test.mjs',
      'auth-crypto-vectors.test.mjs',
      'authoring-validation.test.mjs',
      'contract-binding-reads.test.mjs',
      'data-tier-corpus.test.mjs',
      'dependency-graph.test.mjs',
      'effect-ceiling.test.mjs',
      'function-id.test.mjs',
      'identifier-validation.test.mjs',
      'inline-helper-sharing.test.mjs',
      'inline-result-contracts.test.mjs',
      'maintained-projections.test.mjs',
      'membership-search-authoring.test.mjs',
      'operation-schemas.test.mjs',
      'provider-introspection.test.mjs',
      'protected-query-profile.test.mjs',
      'rbac-authoring.test.mjs',
      'jobs-authoring.test.mjs',
      'receipt-capability.test.mjs',
      'relation-activity-authoring.test.mjs',
      'relational-authoring.test.mjs',
      'remote-service-publication.test.mjs',
      'retainability-profile.test.mjs',
      'review-surface.test.mjs',
      'search-ast-fixtures.test.mjs',
      'search-result-contracts.test.mjs',
      'seed-artifact.test.mjs',
      'seed-asset-fixtures.test.mjs',
      'standard-patterns.test.mjs',
    ],
  },
  {
    id: '@expo/snapback-contract',
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
      'result-contract-validator.test.mjs',
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
    .filter((path) => path.endsWith(inventory.suffix))
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
// 77 -> 79 (2026-07-24, ENG-25454): @expo/snapback-vite gains channel-a.test.mjs
// and rqs-serializer.test.mjs (LLP 0092 §0E Channel A seam + serializer).
// 79 -> 82 (2026-07-25, ENG-25456): @expo/snapback-client gains
// rqs-store-file.test.mjs and rqs-resume-native.test.mjs (LLP 0090 step-5
// native arm), and @expo/snapback-codegen's relational-authoring.test.mjs
// (landed f779c35c, LLP 0080 slice 3) is registered here — the landing
// commit added the file and its test script entry without updating this
// canonical inventory.
// 82 -> 83 (2026-07-25, Step 5 witness rerun): @expo/snapback-codegen gains
// maintained-projections.test.mjs (landed 21bb68ff, LLP 0080 §5 authoring
// surface) — the landing added the file and its test-script entry without
// updating this canonical inventory; caught by the cumulative-gate rerun.
// 83 -> 85 (LLP 0074 integration): retain the Linux runtime package proof
// and the CLI hosted-admission producer suite alongside current main.
// 85 -> 86 (LLP 0081 §6): @expo/snapback-contract gains the maintained
// migration-boundary quarantine regression.
// 86 -> 87 (LLP 0072 Fly adapter landing): @expo/snapback-cli gains the
// maintained Fly Machines VM driver suite.
// 87 -> 88 (LLP 0094 B2): @expo/snapback-client gains the wire-version
// negotiation suite (open-time offer, echo witness, §0B.6 fallback).
// 88 -> 89 (package-owned comparator acceptance kit): @expo/snapback-cli gains
// the five-property comparator, failure matrix, receipt, and pack proof.
// 89 -> 91 (codegen review surface): @expo/snapback-codegen gains cache/custody
// conformance and @expo/snapback-contract gains review-manifest projection checks.
// 91 -> 94 (backend-bakeoff reconciliation): @expo/snapback-client gains portable
// search parsing, while @expo/snapback-codegen gains inline/result-contract and
// versioned-seed artifact coverage.
// 94 -> 95 (LLP 0110): @expo/snapback-codegen gains the bounded-relation and
// transactional write/activity authoring corpus.
// 95 -> 98 (LLP 0111): @expo/snapback-client gains hosted ephemeral authority
// replacement/republish coverage and the independently packed supervisor
// gains deterministic protocol and provider-bootstrap plan corpora.
// 98 -> 99 (LLP 0111): the supervisor adds immutable external-mirror,
// conditional-anchor, chain-recovery, and stale-writer coverage.
// 99 -> 103 (LLP 0107): @expo/snapback-client gains the negotiated-expiry room
// lifecycle suite, @expo/snapback-react gains optimistic and presence lifecycle
// suites, and @expo/snapback-contract gains the shared result-contract validator.
// 103 -> 104 (LLP 0111): the independently packed supervisor gains the
// hosted-edge admission lifecycle and refusal matrix.
// 104 -> 105 (LLP 0111): target onboarding gains a confirmation-bound,
// legacy-preserving credential-staging plan corpus.
// 105 -> 106 (LLP 0107): @expo/snapback-react gains the maintained lifecycle
// wrapper corpus alongside its optimistic and presence suites.
// 106 -> 109 (backend-bakeoff first-rerun corrections): @expo/snapback-cli gains
// maintained generated-load identity diagnostics and sessions-mode one-command
// dev-loop coverage, while @expo/snapback-codegen gains maintained search
// result-contract coverage.
// 109 -> 112 (LLP 0111 hosted completion tranche): @expo/snapback-cli gains the
// checkout-free hosted command/package corpus, while the supervisor gains
// operator-authority semantics and its own extracted-tarball proof.
// 112 -> 113 (LLP 0111 hosted completion tranche): the supervisor gains the
// canonical operator request/response transaction and recovery corpus.
// 113 -> 116 (LLP 0041 external publication authority): retain the durable
// epoch/lease protocol, authenticated HTTP surface, and closed-schema corpus.
// 116 -> 119 (LLP 0111 hosted operator transport): retain the mTLS operator
// service, closed signed response, and provider-executor corpora.
// 119 -> 120 (LLP 0111 corrective operator tranche): the supervisor adds the
// exact credential-role/resource custody corpus.
// 120 -> 121 (2026-07-27 workout merge): generated-reference argument validation
// refuses closed-schema mismatches before transport.
// 121 -> 122 (LLP 0041 final publication hardening): the publication authority
// client retains bounded response-stream and deadline refusal coverage.
// 122 -> 123 (2026-07-28, SB-004): @expo/snapback-client gains the maintained
// effect-free authorization-reservation retry matrix.
// 123 -> 124 (2026-07-28, SB-002): @expo/snapback-client gains the maintained
// live-handle authority-retirement disposal matrix.
// 124 -> 126 (2026-07-30, attribution wire seams): @expo/snapback-client gains the
// byte-level non-2xx attribution pass-through matrix and @expo/snapback-app-cli
// gains the HTTP/client/CLI per-principal-class attribution parity matrix.
// 126 -> 127 (2026-07-30, LLP 0062 app-data façade lift): @expo/snapback-client
// gains the app-data-only façade posture suite (planted admin token,
// redirect-terminal credentialed requests, per-class ingress bounds, bare
// artifact fetch path).
// 127 -> 132 (2026-07-31, wave-1 lane landings reconciled): @expo/snapback-client
// gains the M2 outbox store suite (`2a7bf058`, LLP 0129 Phase 0);
// @expo/snapback-codegen gains jobs authoring (`64dc60ef`, LLP 0070 first slice —
// its landing updated the file list but not this reviewed total), same-file
// inline-helper sharing (`4d72c407`, LLP 0118 option 1a), and the
// one-argument-grammar goldens plus search-AST fixtures (`16595117`,
// LLP 0131). Reconciled by the SD-6 scope migration's baseline pass.
// 132 -> 134 (2026-07-31, staged cold-install lane repair): @expo/snapback-client
// gains the maintained root-export browser-closure bundling witness (the
// packaged Expo/Metro + browser/esbuild release-proof closure guarded
// repo-side after node:fs reached index.mjs via the LLP 0129 Phase 0 default
// store), and the asset-pipeline landings' assets.test.mjs
// (@expo/snapback-client) plus asset-upload-authoring.test.mjs and
// asset-thumbhash-vector.test.mjs (@expo/snapback-codegen, LLP 0044
// P-03..P-05) are registered here — those landings added the files and their
// test-script entries without updating this canonical inventory.
// 136 -> 141 (2026-08-01, 0137 between-arms fix lane plus asset watchStore
// ACK riding): @expo/snapback-cli
// gains dev-cli-diagnostics.test.mjs (a4-f2: `snapback dev` must print its
// failed envelope and reject flag-shaped positionals); and three earlier
// landings that added files plus test-script entries without updating this
// canonical inventory are registered — @expo/snapback-react's
// offline.test.mjs and assets.test.mjs (`c40dbd1a`, 0137 a1-f4/f5/f6) and
// @expo/snapback-codegen's seed-asset-fixtures.test.mjs (`a22fd5fd`,
// LLP 0044 W2f). @expo/snapback-client also gains the focused LLP 0053
// post-commit ACK, exact-redelivery, and apply-failure regression.
// 141 -> 149 (2026-08-01, membership-visible search authoring):
// @expo/snapback-codegen gains membership-search-authoring.test.mjs for the
// LLP 0073 §membership visibility generated manifests, refusal matrix, and
// required resource-argument types. The same inventory pass reconciles seven
// already-configured suites that were added without a canonical inventory
// update: @expo/snapback-client's bearer-rotation, Expo RQS store/resume, and
// WebCrypto fallback; plus @expo/snapback-react's authorization-denial,
// cold-boot-binding, and WebCrypto fallback.
assert.equal(total, 152, 'reviewed package/admin test count changed');
for (const result of results) {
  process.stdout.write(`[package-test-inventory] ${result.id}: ${result.count}\n`);
}
process.stdout.write(`[package-test-inventory] PASS: ${total} declared test files\n`);
