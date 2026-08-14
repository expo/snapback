#!/usr/bin/env node

import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ref LLP 0010#ci-and-review-gates — canonical proof inventories every
// maintained package test instead of sampling filenames by hand.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IGNORED_TEST_DIRS = new Set(['.git', 'coverage', 'dist', 'node_modules']);

export const PACKAGE_TEST_INVENTORIES = [
  {
    id: 'snapback-maturity-records',
    packageDir: '.',
    testDir: 'tests',
    suffix: '.test.mjs',
    scriptNames: ['test:maturity'],
    expectedFiles: [
      'tests/capability-maturity.test.mjs',
      'tests/check-inventories.test.mjs',
    ],
  },
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
    id: '@expo/snapback-sidecar',
    packageDir: 'packages/snapback-sidecar',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: ['package.test.mjs'],
  },
  {
    id: 'create-snapback-app',
    packageDir: 'packages/create-snapback-app',
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
      'agent-setup.test.mjs',
      'application-ready.test.mjs',
      'cli-help.test.mjs',
      'comparator-profile.test.mjs',
      'data-promotion.test.mjs',
      'declaration-suggestion-cli.test.mjs',
      'dev-cli-diagnostics.test.mjs',
      'dev-loop.test.mjs',
      'expo-bootstrap-exchange.test.mjs',
      'expo-device-forwarding.test.mjs',
      'expo-dev-loop.test.mjs',
      'expo-metro-watch-advisory.test.mjs',
      'fake-expo-push.test.mjs',
      'generate-check.test.mjs',
      'hosted-admission-producer.test.mjs',
      'hosted-control.test.mjs',
      'load-generated.test.mjs',
      'mcp-control.test.mjs',
      'package.test.mjs',
      'packaged-store-qualification.test.mjs',
      'reset-dev-fresh.test.mjs',
      'reference-lookup.test.mjs',
      'sessions-dev-loop.test.mjs',
      'verify.test.mjs',
    ],
  },
  {
    id: '@expo/snapback-vite',
    packageDir: 'packages/snapback-vite',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: ['bun-relay.test.mjs', 'channel-a.test.mjs', 'package.test.mjs', 'rqs-serializer.test.mjs'],
  },
  {
    id: '@expo/snapback-client',
    packageDir: 'packages/snapback-client',
    testDir: '.',
    suffix: '.test.mjs',
    scriptNames: ['pretest', 'test'],
    expectedFiles: [
      'app-data.test.mjs',
      'argument-normalization.test.mjs',
      'argument-validation.test.mjs',
      'answer-classes.test.mjs',
      'assets-watch-authorization.test.mjs',
      'assets.test.mjs',
      'attribution.test.mjs',
      'auth-anonymous-read-recovery.test.mjs',
      'auth-exchange-concurrency.test.mjs',
      'authorization-invalidation.test.mjs',
      'bearer-rotation.test.mjs',
      'browser-closure.test.mjs',
      'bundle.test.mjs',
      'carrier-capability-honesty.test.mjs',
      'client-diagnostics.test.mjs',
      'data-client.test.mjs',
      'commands.test.mjs',
      'connection-open-stream-reset-retry.test.mjs',
      'demand-broker.test.mjs',
      'diagnostic-error.test.mjs',
      'ephemeral-room.test.mjs',
      'evaluation-floor.test.mjs',
      'export-parity.test.mjs',
      'external-store.test.mjs',
      'generated-mutation-ir.test.mjs',
      'hosted-browser.test.mjs',
      'hosted-ephemeral.test.mjs',
      'ir-evaluator.test.mjs',
      'lifecycle-disposal.test.mjs',
      'lease-convergence.test.mjs',
      'local-read-admission.test.mjs',
      'logout-v3-bridge.test.mjs',
      'materialization-bridge.test.mjs',
      'materialization-store.test.mjs',
      'mixed-route-v2.test.mjs',
      'micro-operational.test.mjs',
      'micro.test.mjs',
      'optimistic-rebase-acceptance.test.mjs',
      'optimistic-rebase.test.mjs',
      'outbox-custody.test.mjs',
      'outbox-drain.test.mjs',
      'outbox-quarantine.test.mjs',
      'outbox-store.test.mjs',
      'package.test.mjs',
      'password-auth.test.mjs',
      'push-registry.test.mjs',
      'registration-ledger.test.mjs',
      'reference-kind.test.mjs',
      'remediation.test.mjs',
      'reservation-retry.test.mjs',
      'result-transform.test.mjs',
      'rqs-digest-parity.test.mjs',
      'rqs-resume-expo.test.mjs',
      'rqs-resume-memory.test.mjs',
      'rqs-resume-native.test.mjs',
      'rqs-resume.test.mjs',
      'rqs-store-expo.test.mjs',
      'rqs-store-file.test.mjs',
      'rqs-store-v3.test.mjs',
      'rqs-store.test.mjs',
      'sender-proof.test.mjs',
      'sender-transport.test.mjs',
      'search.test.mjs',
      'store-policy.test.mjs',
      'store-runtime-wiring.test.mjs',
      'unrecognized-authority-recovery.test.mjs',
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
    scriptNames: ['pretest', 'test'],
    expectedFiles: [
      'assets.test.mjs',
      'auth-blocked-resource.test.mjs',
      'authorization-denial.test.mjs',
      'binding-development-sync.test.mjs',
      'cold-boot-binding-indexeddb.test.mjs',
      'cold-boot-binding.test.mjs',
      'commands.test.mjs',
      'dev-diagnostics-acceptance.test.mjs',
      'dev-diagnostics.test.mjs',
      'familiar.test.mjs',
      'hmr-generation-handoff.test.mjs',
      'lifecycle.test.mjs',
      'offline.test.mjs',
      'optimistic-create.test.mjs',
      'optimistic.test.mjs',
      'package.test.mjs',
      'presence.test.mjs',
      'subscribe-retry.test.mjs',
      'subscribe-runtime-import-failure.test.mjs',
      'surface.test.mjs',
      'webcrypto-fallback.test.mjs',
    ],
  },
  {
    id: '@expo/snapback',
    packageDir: 'packages/snapback-umbrella',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: [
      'package.test.mjs',
    ],
  },
  {
    id: '@expo/snapback-expo',
    packageDir: 'packages/snapback-expo',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: [
      'app-binding.test.mjs',
      'asset-source.test.mjs',
      'config-plugin.test.mjs',
      'package-closure.test.mjs',
      'package.test.mjs',
      'provider.test.mjs',
      'release-export-vocabulary.test.mjs',
      'supervised-environment.test.mjs',
      'supervised-offline-fallback.test.mjs',
    ],
  },
  {
    id: '@expo/snapback-app-cli',
    packageDir: 'packages/snapback-app-cli',
    testDir: '.',
    suffix: '.test.mjs',
    expectedFiles: [
      'attribution.test.mjs',
      'auth.test.mjs',
      'cli.test.mjs',
      'code-mode-ibex.test.mjs',
      'code-mode.test.mjs',
      'digest.test.mjs',
      'envelope.test.mjs',
      'ibex-bundle.test.mjs',
      'package.test.mjs',
      'result-core.test.mjs',
      'schema-interpreter.test.mjs',
    ],
  },
  {
    id: '@expo/snapback-codegen',
    packageDir: 'packages/snapback-codegen',
    testDir: '.',
    suffix: '.test.mjs',
    scriptNames: ['pretest', 'test'],
    expectedFiles: [
      'api-envelope-members.test.mjs',
      'app-descriptor.test.mjs',
      'app-inspection.test.mjs',
      'args-contract-goldens.test.mjs',
      'asset-thumbhash-vector.test.mjs',
      'asset-upload-authoring.test.mjs',
      'auth-artifacts.test.mjs',
      'auth-crypto-vectors.test.mjs',
      'authoring-validation.test.mjs',
      'client-lifecycle.test.mjs',
      'contract-binding-reads.test.mjs',
      'contract-output-mode.test.mjs',
      'data-query.test.mjs',
      'data-resource.test.mjs',
      'data-transaction.test.mjs',
      'data-tier-corpus.test.mjs',
      'declaration-suggestion.test.mjs',
      'dependency-graph.test.mjs',
      'effect-ceiling.test.mjs',
      'familiar-phase-a.test.mjs',
      'familiar-phase-b.test.mjs',
      'function-id.test.mjs',
      'generated-mutation-ir.test.mjs',
      'generation-lock.test.mjs',
      'guide-pointer.test.mjs',
      'handler-graph-parity.test.mjs',
      'handler-runtime-profile.test.mjs',
      'identifier-validation.test.mjs',
      'inline-helper-sharing.test.mjs',
      'inline-result-contracts.test.mjs',
      'live-search-authoring.test.mjs',
      'maintained-projections.test.mjs',
      'media-field-authoring.test.mjs',
      'membership-search-authoring.test.mjs',
      'micro-profile.test.mjs',
      'mixed-route-v2.test.mjs',
      'omission-defaults.test.mjs',
      'operation-schemas.test.mjs',
      'plain-join-advisory.test.mjs',
      'provider-introspection.test.mjs',
      'protected-query-profile.test.mjs',
      'refusal-tracking-authoring.test.mjs',
      'rbac-authoring.test.mjs',
      'jobs-authoring.test.mjs',
      'receipt-capability.test.mjs',
      'relation-activity-authoring.test.mjs',
      'relational-authoring.test.mjs',
      'remote-service-publication.test.mjs',
      'retainability-profile.test.mjs',
      'review-surface.test.mjs',
      'schema-reference-type-flow.test.mjs',
      'search-ast-fixtures.test.mjs',
      'search-result-contracts.test.mjs',
      'semantic-generation-golden.test.mjs',
      'semantic-generation-rotation.test.mjs',
      'sequence-authoring.test.mjs',
      'seed-artifact.test.mjs',
      'seed-asset-fixtures.test.mjs',
      'settlement-bounded-skew.test.mjs',
      'snapshot-batch-v2-authoring.test.mjs',
      'standard-patterns.test.mjs',
      'stored-enum-authoring.test.mjs',
      'structured-stored-values.test.mjs',
      'table-visibility-authoring.test.mjs',
      'typed-search-wrapper.test.mjs',
      'typescript-profile.test.mjs',
      'vector-authoring.test.mjs',
      'vector-distance-profile.test.mjs',
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
      'convergence-gating.test.mjs',
      'derived-overlay-duplicate-reapply.test.mjs',
      'derived-overlay-reconcile-failure.test.mjs',
      'derived-overlay.test.mjs',
      'ephemeral-resubscribe-race.test.mjs',
      'error-tracking-vectors.test.mjs',
      'exact-conformance.test.mjs',
      'exact-package.test.mjs',
      'ids.test.mjs',
      'index.test.mjs',
      'keyed-ephemeral-links.test.mjs',
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
      'tests/brand-mark-theme.mjs',
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

function multisetDifference(left, right) {
  const remaining = new Map();
  for (const value of right) remaining.set(value, (remaining.get(value) ?? 0) + 1);
  const difference = [];
  for (const value of left) {
    const count = remaining.get(value) ?? 0;
    if (count === 0) difference.push(value);
    else remaining.set(value, count - 1);
  }
  return difference.sort();
}

export function auditInventory({ root = ROOT, inventory }) {
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
    ...command.matchAll(/(?:^|&&)\s*(?:node|bun)\s+([^\s&]+\.mjs)(?=\s|$)/g),
  ])
    .map((match) => match[1].replace(/^\.\//, ''))
    .filter((path) => path.endsWith(inventory.suffix))
    .sort();

  const expected = [...inventory.expectedFiles].sort();
  return {
    id: inventory.id,
    count: discovered.length,
    files: discovered,
    unexpectedOnDisk: multisetDifference(discovered, expected),
    missingOnDisk: multisetDifference(expected, discovered),
    undeclaredInScripts: multisetDifference(discovered, declared),
    missingFromDiskButDeclared: multisetDifference(declared, discovered),
  };
}

export function inspectInventory(options) {
  const result = auditInventory(options);
  assert.deepEqual(
    { unexpected: result.unexpectedOnDisk, missing: result.missingOnDisk },
    { unexpected: [], missing: [] },
    `${result.id} maintained test IDs/count changed; review and update the canonical inventory`,
  );
  assert.deepEqual(
    {
      undeclared: result.undeclaredInScripts,
      missing: result.missingFromDiskButDeclared,
    },
    { undeclared: [], missing: [] },
    `${result.id} configured test scripts must name every maintained test exactly once`,
  );
  return result;
}

export function auditPackageTestInventories({
  root = ROOT,
  inventories = PACKAGE_TEST_INVENTORIES,
  expectedTotal = 281,
} = {}) {
  const results = inventories.map((inventory) => auditInventory({ root, inventory }));
  const total = results.reduce((sum, result) => sum + result.count, 0);
  return { results, total, expectedTotal, totalDrift: total - expectedTotal };
}

export function checkPackageTestInventories(options = {}) {
  const audit = auditPackageTestInventories(options);
  for (const result of audit.results) {
    assert.deepEqual(
      { unexpected: result.unexpectedOnDisk, missing: result.missingOnDisk },
      { unexpected: [], missing: [] },
      `${result.id} maintained test IDs/count changed; review and update the canonical inventory`,
    );
    assert.deepEqual(
      {
        undeclared: result.undeclaredInScripts,
        missing: result.missingFromDiskButDeclared,
      },
      { undeclared: [], missing: [] },
      `${result.id} configured test scripts must name every maintained test exactly once`,
    );
  }
  assert.equal(audit.total, audit.expectedTotal, 'reviewed package/admin test count changed');
  return audit;
}

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
// 156 -> 158 (2026-08-02, settlement and LLP 0143 registry slices):
// @expo/snapback-codegen gains the bounded-skew settlement authoring suite;
// @expo/snapback-client gains the explicit push-registry subpath custody and
// protocol suite.
// 158 -> 159 (2026-08-02, LLP 0127 Move-1 type flow):
// @expo/snapback-codegen gains the schema-reference expansion, generated
// handler/context interior, authority-capability, and checkJs mismatch suite.
// 159 -> 162 (2026-08-02, LLP 0147 Micro Phase B): @expo/snapback-client gains
// the maintained Micro core/live behavior and operational comparison suites;
// @expo/snapback-codegen gains the compiled-profile generation suite.
// 162 -> 163 (2026-08-02, LLP 0134): the repository-level maturity-record
// suite exercises a real capability pair through soak, promotion, and demotion.
// 163 -> 164 (2026-08-02, LLP 0156 D-05): @expo/snapback-contract gains the
// independent JavaScript replay of the Rust-generated fingerprint vectors.
// 164 -> 165 (2026-08-02, LLP 0156 D-05): @expo/snapback-codegen gains the
// tracked application-refusal authoring and manifest-subset suite.
// 165 -> 166 (2026-08-02, LLP 0135 sequence half): @expo/snapback-codegen
// gains declared sequence, order-field-bound, A6 replacement, and capability
// emission acceptance.
// 166 -> 167 (2026-08-02, LLP 0136 live-search authoring):
// @expo/snapback-codegen gains the maintained live-search declaration,
// validation, manifest, and type-flow suite.
// 167 -> 169 (2026-08-03, LLP 0132 batched reconciliation): the vector
// authoring and distance-profile suites deferred by the VEC-2 wave policy are
// registered; the superseded parallel-landing fixture suites are removed.
// 169 -> 170 (2026-08-03, LLP 0143): the packaged fake-Expo push acceptance
// suite is registered with the push01 landing.
// 170 -> 172 (2026-08-03, LLP 0166 L1): @expo/snapback-client gains the
// memory-carrier S4 parity run and the format-v3 migration/wipe/reset suite.
// 172 -> 173 (2026-08-03, LLP 0166 L2): @expo/snapback-client gains the
// materialization operations, proof, retained-boot, fence, and compaction suite.
// 173 -> 175 (2026-08-03, LLP 0166 L8 + L7 convergence): the client gains
// the pre-admission evaluation floor and close-predecessor-first crash corpus.
// 175 -> 177 (2026-08-03, LLP 0166 L4/L5): @expo/snapback-client gains the
// multi-context demand broker and lifecycle/budget/policy-inspection suites.
// 177 -> 179 (2026-08-03, LLP 0166 L3/L6): @expo/snapback-client gains the
// registration/sync-set and completeness-honest 15-row answer-table suites.
// 179 -> 180 (2026-08-03, LLP 0114 local-development synchronization):
// @expo/snapback-react gains the bounded binding mismatch recovery and strict
// hosted/sessions refusal suite.
// 180 -> 181 (2026-08-03, LLP 0166 logout bridge): @expo/snapback-client gains
// the public AuthCoordinator-to-v3-store logout transition suite.
// 181 -> 183 (2026-08-03, LLP 0090 mixed-route successor): codegen and client
// gain the version-2 artifact, explicit-liveness, and refusal witnesses.
// 183 -> 185 (2026-08-03, P2 hydration bridge landing): @expo/snapback-client
// gains the materialization-bridge suite, and the already configured admin
// brand-mark theme suite is registered (main had omitted it here).
// 185 -> 186 (2026-08-03, Move-3 Phase-1 lane M1): @expo/snapback-client
// gains the shipping browser-safe IR evaluator, closed-admission,
// private-layer, and complete 37-case D5 conformance suite.
// 186 -> 187 (2026-08-03, P5 result-transform lane): @expo/snapback-client
// gains the dormant result-transform.v1 D5-extension suite.
// 187 -> 188 (2026-08-04, RN carrier retry-storm fix 5fbea8e4d):
// @expo/snapback-react gains subscribe-retry.test.mjs (bounded per-store
// failure window); that landing updated the package test script but not
// this canonical inventory, which broke this check on main.
// 188 -> 190 (2026-08-04, LLP 0146 D2/D3): @expo/snapback-cli gains the
// done-oracle suite and @expo/snapback-app-cli gains the agent-digest suite.
// 190 -> 191 (2026-08-04, Move-3 Phase-1 lane M2): @expo/snapback-client
// gains the local-read admission matrix over demanded QMK answers.
// 191 -> 193 (2026-08-04, Move-3 Phase-1 lane M3): @expo/snapback-client
// gains the optimistic layer/rebase unit suite and the three-leg in-process
// acceptance (20 rapid moves, locked card, reload during settlement).
// 193 -> 195 (2026-08-04, Move-3 Phase-1 lane M4): codegen gains the
// generated mutation-IR identity/read-requirement suite; the client gains the
// no-duplicate-transform, pre-settlement paint, and boot-replay suite.
// 195 -> 198 (2026-08-04, LLP 0062 Phase 2): @expo/snapback-app-cli gains
// the app-bound Ibex coordinator, bundle, and inert-schema suites.
// 198 -> 199 (2026-08-04, LLP 0166 finish-out Lane A): @expo/snapback-client
// gains the shipped policy-controller and demand-broker construction suite.
// 199 -> 200 (2026-08-04, LLP 0166 finish-out Lane D): @expo/snapback-client
// gains the consolidated S8 carrier-capability honesty suite.
// 200 -> 201 (2026-08-04, LLP 0166 finish-out Lane F): @expo/snapback-react
// gains the inline subscribe-failure fallback regression for an optional
// react-runtime chunk rejection.
// 201 -> 202 (2026-08-05, authoring omission audit): @expo/snapback-codegen
// gains explicit visibility/delete-filter omission refusal coverage.
// 202 -> 203 (2026-08-05, unattended authoring audit): @expo/snapback-cli
// gains composed and non-executing CLI help acceptance coverage.
// 203 -> 204 (2026-08-05, LLP 0129 Phase 2b): the desktop-sidecar package
// gains its descriptor/capability/publication contract suite.
// 204 -> 205 (2026-08-05, LLP 0176 G0 reconciliation): @expo/snapback-cli's
// agent-setup.test.mjs (landed 753191e46 with its test-script entry) is
// registered here — that landing added the file without updating this
// canonical inventory; caught while landing the G0 lane.
// 205 -> 206 (2026-08-05, LLP 0176 G0 reconciliation): @expo/snapback-react's
// hmr-generation-handoff.test.mjs (landed 8ce5ca33e with its test-script
// entry) is registered here — that landing added the file without updating
// this canonical inventory; caught while landing the G0 A2 lane.
// 206 -> 207 (2026-08-05, LLP 0179 S0): @expo/snapback-codegen gains the
// generated descriptor identity, inspection, aliasing, and refusal suite.
// 207 -> 212 (2026-08-05, LLP 0181 E0): @expo/snapback-expo gains the closed
// AppBinding union/admission matrix, config-plugin and value-free receipt,
// provider/boot/lifecycle composition, package surface, and packed nested
// clean-room closure suites.
// 212 -> 214 (2026-08-05, LLP 0181 E1): the Expo package gains the transient
// supervised-environment exchange suite and the CLI gains the real-runtime
// backend/Metro/provider/routing/leak/cleanup acceptance loop.
// 214 -> 215 (2026-08-06, LLP 0114 receipt race): @expo/snapback-react gains
// the IndexedDB/Web Locks cold-boot binding regression.
// 215 -> 216 (2026-08-06, LLP 0081 quarantine seam): @expo/snapback-client
// gains the upgrade-required tombstone, dependent hold, and re-entry suite.
// 216 -> 217 (2026-08-06, LLP 0179 S1): @expo/snapback-react gains the
// generated-surface canonical-store/room, replacement, and cleanup suite.
// 217 -> 218 (2026-08-06, LLP 0178/LLP 0187 T2): @expo/snapback-codegen's
// guidePointer remediation-kind suite landed in the configured test script
// without a canonical inventory entry (`6da170bf1`); registered here.
// 218 -> 220 (2026-08-06, LLP 0180 / LLP 0179 S2): the client and React
// packages gain the command phase/outcome and named-projection suites.
// 220 -> 221 (2026-08-06, LLP 0157 §D8): @expo/snapback-codegen gains the
// mixed/all-relational snapshot-batch.v2 authoring and identity-mirror suite.
// 221 -> 222 (2026-08-06, LLP 0179 S2): @expo/snapback-codegen gains the
// non-React descriptor inspection consumer suite.
// 222 -> 223 (2026-08-06): @expo/snapback-client's auth-exchange concurrency
// suite from `f782431bd fix(auth): custody lock must not span the transition
// participant barrier` — registered in that package's test script but not
// here, which left this gate red on main. Registered on sight, not owned.
// 223 -> 224 (2026-08-06, LLP 0181 E2): @expo/snapback-expo gains the
// picker/content-URI asset-source adapter suite.
// 224 -> 225 (2026-08-06, LLP 0176 OQ4): @expo/snapback-cli gains the
// headless physical-device inventory, network-refusal, exact adb-reverse
// ownership/rollback, readiness-shape, and iOS tooling-direction suite.
// 225 -> 226 (2026-08-06): the root inventory gains the maintained synthetic
// drift corpus for the fast pre-push inventory checker.
// 226 -> 227 (2026-08-06, LLP 0110/0166 public-package amendment):
// @expo/snapback-cli gains the packaged-store qualification receipt
// plumbing suite.
// 227 -> 228 (2026-08-07, LLP 0186 W2): the new `create-snapback-app`
// wrapper package gains its scaffold-delegation suite (identical output to
// `snapback new`, registry-derived help, CLI-owned refusal codes).
// 228 -> 229 (2026-08-07, LLP 0176 G4): @expo/snapback-expo gains the
// release-vocabulary repair suite for production export bundles.
// 229 -> 230 (2026-08-07, auth stream reset boot flake):
// @expo/snapback-client gains the bounded anonymous connection-open and
// connection-operation retry suite from
// issues/20260807-auth-stream-reset-boot-flake.md.
// 230 -> 231 (2026-08-07, LLP 0176 reachability boundary): @expo/snapback-cli
// gains scoped browser CORS and preflight coverage for the supervised
// bootstrap exchange.
// 231 -> 232 (2026-08-07, LLP 0114/0181 offline binding): @expo/snapback-expo
// gains the supervised warm-receipt and cold persisted-receipt fallback suite.
// 232 -> 233 (2026-08-06, LLP 0043 sessions-custody queue):
// @expo/snapback-client gains the custody matrix, cold replay, recovery,
// privacy deletion, and zerobugs regression suite.
// 233 -> 234 (2026-08-08, supervisor Metro watch-inertness advisory):
// @expo/snapback-cli gains the pure CI/watcher-blind-root assessment suite
// (issues/20260808-supervisor-warn-metro-watch-blind.md).
// 234 -> 235 (2026-08-08,
// issues/20260807-client-root-export-createassetclient.md): @expo/snapback-client
// gains the general declared-vs-runtime export parity check across every typed
// export entry.
// 235 -> 236 (2026-08-08, reset --dev-fresh): @expo/snapback-cli gains the
// standalone/supervised deterministic reset, auth-boundary, delegation, and
// lifecycle-refusal acceptance suite.
// 236 -> 237 (2026-08-08, stored literal-union enums):
// @expo/snapback-codegen gains end-to-end stored enum authoring coverage.
// 237 -> 238 (2026-08-08, LLP 0194): @expo/snapback-cli gains build-bound,
// budgeted exact symbol and module-slice Guide lookup coverage.
// 238 -> 239 (2026-08-08, LLP 0200 Phase 1): @expo/snapback-contract gains
// the watermark-gated optimistic-release and server-version regression suite.
// 239 -> 240 (2026-08-09, typed search same-release qualification):
// @expo/snapback-codegen gains the real-codegen-to-client wrapper composition
// suite for plain and resource-scoped generated search references.
// 240 -> 241 (2026-08-09, LLP 0200 Phase 2): @expo/snapback-client gains the
// same-envelope authorization resolution and no-resolution quarantine suite.
// 241 -> 242 (2026-08-09, LLP 0211 Phase A): @expo/snapback-codegen gains the
// typed opaque structured stored-value carrier, dispatch, refusal, type-flow,
// and retained-client round-trip acceptance corpus.
// 242 -> 243 (2026-08-10, generated-directory regeneration serialization):
// @expo/snapback-codegen gains deterministic overlapping-writer and killed
// stale-lock-holder coverage for the LLP 0041 watch/codegen boundary.
// 243 -> 244 (2026-08-10, LLP 0146 OQ6 option B): @expo/snapback-client gains
// the shared remediation-set v1 decoder's version, unknown-member,
// unknown-kind, and exact artifact-hash binding suite.
// 244 -> 245 (2026-08-10, LLP 0178/0187 plain-join advisory):
// @expo/snapback-codegen gains the positive equivalence fixture, rejected-
// construct matrix, and retained demo/Guide zero-false-positive corpus scan.
// 245 -> 246 (2026-08-10, LLP 0218 P2): @expo/snapback-client gains the
// platform-owned outbox drain controller suite (barrier gating, cold-start
// scan, backoff, writer takeover, custody wakes, dedup/teardown).
// 246 -> 247 (2026-08-10, fix-forward registration): @expo/snapback-react's
// optimistic-create.test.mjs (useSnapbackOptimisticCreate landing 26fb0b948)
// was in the package test chain but missing here; registered at the LLP 0218
// P2 landing.
// 247 -> 248 (2026-08-10, LLP 0034 §10.11): @expo/snapback-contract gains
// keyed-surface ephemeral link, boot-refusal, publish-splitting, and
// authority-wiring swap coverage.
// 248 -> 249 (2026-08-10, LLP 0219 P1): @expo/snapback-client gains the
// bounded client diagnostics channel and per-client outbox bridge proof.
// 249 -> 250 (2026-08-10, LLP 0219 P2 React): @expo/snapback-react gains the
// live-hook churn, queued compatibility, and diagnostics consumer proof.
// 250 -> 251 (2026-08-10, LLP 0219 P3): @expo/snapback-react gains the
// app-shaped Clique churn and silent queued-wedge acceptance bar.
// 251 -> 252 (2026-08-10, LLP 0224 Phase 1): @expo/snapback-cli gains the
// application-ready receipt lifecycle and native-wait process suite.
// 252 -> 253 (2026-08-11, LLP 0231 D1/D2 warn phase):
// @expo/snapback-codegen gains the table visibility union, strict declaration
// refusals, implicit-policy warning/remediation, and summary projection suite.
// 253 -> 254 (2026-08-11, LLP 0021 Exact-optional implementation note):
// @expo/snapback-codegen gains deterministic neutral-versus-Exact metadata
// output, artifact-inventory/hash rotation, and no-package-probing coverage.
// 254 -> 255 (2026-08-12, LLP 0227 password-auth client surface):
// @expo/snapback-client gains anonymous-issuance adoption, same-authority
// password rotation, strict recovery-code projection, and secret-redaction
// coverage.
// 255 -> 256 (2026-08-12, unrecognized session custody recovery):
// @expo/snapback-client gains cold/warm reset recovery and the negative
// different-incarnation witness suite.
// 256 -> 257 (2026-08-12,
// issues/closed/20260812-vite-ws-relay-black-holed-under-bun.md):
// @expo/snapback-vite gains the Bun-runtime real-Vite websocket relay and
// refused-upgrade regression suite.
// 257 -> 259 (2026-08-12, LLP 0237 rollout 1): @expo/snapback-codegen gains
// generated handler-profile, preflight, and definition-attribution coverage;
// @expo/snapback-cli gains packaged `generate --check` no-replacement proof.
// 259 -> 260 (2026-08-12, LLP 0237 rollout 2): @expo/snapback-codegen gains
// the same-file graph representation byte-parity, identity, refusal, and demo
// golden corpus.
// 260 -> 262 (2026-08-12, LLP 0241 rollout 1): @expo/snapback-codegen gains
// semantic-generation golden/no-self-hash and rotation/envelope coverage.
// 262 -> 264 (2026-08-12, LLP 0238 rollout 1): @expo/snapback-codegen gains
// lifecycle-manifest/JSDoc parity proof; @expo/snapback-client gains the
// complete pre-transport generated-reference mismatch matrix.
// 264 -> 265 (2026-08-12, LLP 0244 media projection):
// @expo/snapback-codegen gains descriptor/lowering, result-contract identity,
// RQS demotion, and action-refusal coverage for v.media().
// 265 -> 266 (2026-08-12, LLP 0246 rollouts 1-2):
// @expo/snapback-codegen gains the frozen TypeScript handler profile,
// syntax-erasure, refusal, identity, and atomic type-check corpus.
// 266 -> 268 (2026-08-12, LLP 0247 rollouts 1+2): the client gains
// anonymous protected one-shot/auth-exchange recovery coverage, and React
// gains the stable auth-blocked resource plus barrier-resume suite.
// 268 -> 270 (2026-08-12, LLP 0247 rollouts 3-5): the client gains shared
// argument-normalization and typed-diagnostic-error contract suites.
// 270 -> 272 (2026-08-12, LLP 0245 rollout 1): codegen and CLI gain the
// DeclarationSuggestionV1 analyzer/apply and machine-output acceptance suites.
// 272 -> 273 (2026-08-13, LLP 0253 Phase A): @expo/snapback-codegen gains the
// normalized-definition, profile-custody, disposition, and no-branch suite.
// 273 -> 274 (2026-08-13, LLP 0253 Phase B): @expo/snapback-codegen gains the
// familiar discovery, lowering, facade, dotted-name, and equivalence suite.
// 274 -> 276 (2026-08-13, LLP 0253 Phase C): @expo/snapback-react gains the
// familiar projection/admission suite and @expo/snapback gains its thin-package
// identity/metadata suite.
// 276 -> 278 (2026-08-13, LLP 0254 Phase 1): @expo/snapback-codegen gains
// the DataResourceV1 declaration/lowering/witness/refusal corpus and
// @expo/snapback-cli gains the preview/approval/promotion custody suite.
// 278 -> 279 (2026-08-13, LLP 0254 Phase 2): @expo/snapback-codegen gains
// the static DataQueryV1 catalogue, resolution, builder, and refusal corpus.
// 279 -> 281 (2026-08-14, LLP 0254 Phase 3): @expo/snapback-codegen gains
// generated transaction lowering/refusal proofs and @expo/snapback-client
// gains handle, custody, real-store crash-cut, and pendingWrites coverage.
const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg === -1 ? ROOT : resolve(process.argv[rootArg + 1]);
  const { results, total } = checkPackageTestInventories({ root });
  for (const result of results) {
    process.stdout.write(`[package-test-inventory] ${result.id}: ${result.count}\n`);
  }
  process.stdout.write(`[package-test-inventory] PASS: ${total} declared test files\n`);
}
