#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADMIN_GENERATED_ROOTS,
  FULLY_COMMITTED_ROOTS,
  REVIEW_CACHE_ROOTS,
} from './generated-artifact-policy.mjs';

const STORAGE_EVIDENCE = [
  ['acceptanceCorpus', 'tests/acceptance/fixtures/agent-safe-storage/acceptance-corpus.2026-08-04.v1.json'],
  ['pairedPerformance', 'tests/acceptance/fixtures/agent-safe-storage/agent-safe-active-covered-paired.2026-08-04.v1.json'],
  ['absolutePerformance', 'tests/acceptance/fixtures/agent-safe-storage/fork-promotion-performance.2026-08-04.v1.json'],
  ['independentReviewFable', 'llp/reviews/0162-agent-safe-storage-profile.implementation-2026-08-04.fable.md'],
  ['independentReviewCodex', 'llp/reviews/0162-agent-safe-storage-profile.implementation-2026-08-04.codex.md'],
  ['authorAcceptance', 'tests/acceptance/fixtures/agent-safe-storage/author-acceptance.2026-08-04.v1.json'],
];

// @ref LLP 0158#capability-registry-record — the guide-row witness has a
// closed fork-specific vocabulary; storage evidence cannot substitute for it.
// The 2026-08-06 evidence chain is retained history. Legacy v1/v2 receipts may
// continue to name these exact locators while withheld, but a v3 publication
// must allocate fresh dated lifecycle/bounds evidence and a dated v3 author
// acceptance rather than rewriting this chain in place.
const DERIVED_FORK_HISTORICAL_EVIDENCE = [
  ['lifecycleBenchMacos', 'tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json'],
  ['lifecycleBenchLinux', 'tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.linux-x86_64.v1.json'],
  ['boundsRatification', 'tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.v1.json'],
  ['assetLifecycleEvidence', 'tests/acceptance/asset-lifecycle-v1-evidence.md'],
  ['specReviewCodex', 'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.codex.md'],
  ['specReviewCodexVerdicts', 'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.codex.verdicts.v1.json'],
  ['specReviewFable', 'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.fable.md'],
  ['specReviewFableVerdicts', 'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.fable.verdicts.v1.json'],
  ['implementationReviewCodex', 'llp/reviews/0158-instance-forking.implementation-2026-08-06.codex.md'],
  ['implementationReviewCodexVerdicts', 'llp/reviews/0158-instance-forking.implementation-2026-08-06.codex.verdicts.v1.json'],
  ['implementationReviewFable', 'llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.md'],
  ['implementationReviewFableVerdicts', 'llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.verdicts.v1.json'],
  ['authorAcceptance', 'tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-06.v1.json'],
];

const DERIVED_FORK_DATED_LOCATOR_PATTERNS = Object.freeze({
  lifecycleBenchMacos:
    /^tests\/acceptance\/instance-fork-lifecycle-bench\.(?<date>[0-9]{4}-[0-9]{2}-[0-9]{2})\.macos-aarch64\.v1\.json$/u,
  lifecycleBenchLinux:
    /^tests\/acceptance\/instance-fork-lifecycle-bench\.(?<date>[0-9]{4}-[0-9]{2}-[0-9]{2})\.linux-x86_64\.v1\.json$/u,
  boundsRatification:
    /^tests\/acceptance\/instance-fork-lifecycle-bench\.(?<date>[0-9]{4}-[0-9]{2}-[0-9]{2})\.v1\.json$/u,
  authorAcceptance:
    /^tests\/acceptance\/fixtures\/instance-forks\/author-acceptance\.(?<date>[0-9]{4}-[0-9]{2}-[0-9]{2})\.v3\.json$/u,
});

export const IMPLEMENTATION_ROOTS = [
  'Cargo.toml',
  'Cargo.lock',
  'crates/snapback-activation/Cargo.toml',
  'crates/snapback-activation/src',
  'crates/snapback-auth/Cargo.toml',
  'crates/snapback-auth/src',
  'crates/snapback-cli/Cargo.toml',
  'crates/snapback-cli/build.rs',
  'crates/snapback-cli/src',
  'crates/snapback-conformance/Cargo.toml',
  'crates/snapback-conformance/build.rs',
  'crates/snapback-conformance/src',
  'crates/snapback-engine/Cargo.toml',
  'crates/snapback-engine/build.rs',
  'crates/snapback-engine/src',
  'crates/snapback-kernel/Cargo.toml',
  'crates/snapback-kernel/src',
  'crates/snapback-runtime/Cargo.toml',
  'crates/snapback-runtime/build.rs',
  'crates/snapback-runtime/src',
  'crates/snapback-server/Cargo.toml',
  'crates/snapback-server/build.rs',
  'crates/snapback-server/src',
  'crates/snapback/Cargo.toml',
  'crates/snapback/build.rs',
  'crates/snapback-services/Cargo.toml',
  'crates/snapback-services/src',
  'crates/snapback-sync/Cargo.toml',
  'crates/snapback-sync/src',
  'crates/snapback-tools/Cargo.toml',
  'crates/snapback-tools/build.rs',
  'crates/snapback-tools/src',
  'crates/snapback-types/Cargo.toml',
  'crates/snapback-types/src',
  '.gitmodules',
  'crates/snapback/src',
  'crates/snapback/tests',
  'packages/snapback-codegen',
  'packages/snapback-contract',
  'tests',
  'scripts/check-agent-safe-publication.mjs',
  'scripts/generated-artifact-policy.mjs',
];

export const IMPLEMENTATION_DIGEST_VERSION =
  'snapback:agent-safe-implementation-tree:v4';
export const SCOPED_IMPLEMENTATION_DIGEST_VERSION =
  'snapback:agent-safe-implementation-tree:v3';
export const IMPLEMENTATION_SCOPE_SCHEMA_VERSION =
  'snapback.agent-safe-implementation-scope.v1';
const LEGACY_IMPLEMENTATION_DIGEST_VERSION =
  'snapback:agent-safe-implementation-tree:v1';

// @ref LLP 0189#decision — D-4 binds only the claim-relevant surface; the
// derived-fork record binds the native runtime and the checker code that
// defines publication semantics, rather than every wave-shared proof leaf.
export const DERIVED_FORK_IMPLEMENTATION_SCOPE = Object.freeze({
  schemaVersion: IMPLEMENTATION_SCOPE_SCHEMA_VERSION,
  // @ref LLP 0276#phases — the scoped claim must continue to bind fork
  // implementation after its service owner leaves the remainder.
  roots: Object.freeze([
    'crates/snapback-activation/src',
    'crates/snapback-cli/src',
    'crates/snapback-engine/src',
    'crates/snapback-kernel/src',
    'crates/snapback-server/src',
    'crates/snapback-services/src',
    'crates/snapback/src',
  ]),
  files: Object.freeze([
    '.gitmodules',
    'Cargo.lock',
    'Cargo.toml',
    'crates/snapback-activation/Cargo.toml',
    'crates/snapback-cli/Cargo.toml',
    'crates/snapback-cli/build.rs',
    'crates/snapback-engine/Cargo.toml',
    'crates/snapback-kernel/Cargo.toml',
    'crates/snapback-server/Cargo.toml',
    'crates/snapback-server/build.rs',
    'crates/snapback-services/Cargo.toml',
    'crates/snapback/Cargo.toml',
    'crates/snapback/build.rs',
    'scripts/check-agent-safe-publication.mjs',
    'scripts/generated-artifact-policy.mjs',
    'vendor/ibex',
  ]),
});

// Receipts qualified after the workspace path migration but before the
// services carve retain their exact historical closure. New qualifications
// use the expanded scope above.
const PRE_SERVICES_DERIVED_FORK_IMPLEMENTATION_SCOPE = Object.freeze({
  schemaVersion: IMPLEMENTATION_SCOPE_SCHEMA_VERSION,
  roots: Object.freeze(['crates/snapback/src']),
  files: Object.freeze([
    '.gitmodules',
    'Cargo.lock',
    'Cargo.toml',
    'crates/snapback/Cargo.toml',
    'crates/snapback/build.rs',
    'scripts/check-agent-safe-publication.mjs',
    'scripts/generated-artifact-policy.mjs',
    'vendor/ibex',
  ]),
});

const LEGACY_DERIVED_FORK_IMPLEMENTATION_SCOPE = Object.freeze({
  schemaVersion: IMPLEMENTATION_SCOPE_SCHEMA_VERSION,
  roots: Object.freeze(['src']),
  files: Object.freeze([
    '.gitmodules',
    'Cargo.lock',
    'Cargo.toml',
    'build.rs', // path-migration: historical
    'scripts/check-agent-safe-publication.mjs',
    'scripts/generated-artifact-policy.mjs',
    'vendor/ibex',
  ]),
});

function derivedForkImplementationScopeAt(root, commit) {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}:crates/snapback-services/Cargo.toml`], {
      cwd: root,
      stdio: 'ignore',
    });
    execFileSync('git', ['cat-file', '-e', `${commit}:crates/snapback-services/src`], {
      cwd: root,
      stdio: 'ignore',
    });
    return DERIVED_FORK_IMPLEMENTATION_SCOPE;
  } catch {
    // Continue through the earlier path epochs below.
  }
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}:crates/snapback/Cargo.toml`], {
      cwd: root,
      stdio: 'ignore',
    });
    return PRE_SERVICES_DERIVED_FORK_IMPLEMENTATION_SCOPE;
  } catch {
    return LEGACY_DERIVED_FORK_IMPLEMENTATION_SCOPE;
  }
}

const DERIVED_FORK_SELECTION_POLICY_PATH =
  'scripts/local-proof-selection-policy.v1.json';

// D-4 transfer custody is admitted against these exact registry entries. The
// policy's qualification-C content digest is bound by the receipt and named-
// author acceptance, and this in-checker mirror keeps a shape-valid prose stub
// from impersonating a recomputed frozen-record gate.
const DERIVED_FORK_ADMITTED_COVERAGE_GATES = Object.freeze({
  'agent-safe-publication-fixtures': Object.freeze({
    records: Object.freeze([
      'tests/agent_safe_publication_checker_v1.mjs (reviewed generated-publication leaf set)',
    ]),
    recordPaths: Object.freeze(['tests/agent_safe_publication_checker_v1.mjs']),
    triggerRules: Object.freeze({
      files: Object.freeze([
        'scripts/generated-artifact-policy.mjs',
        'tests/agent_safe_publication_checker_v1.mjs',
      ]),
      prefixes: Object.freeze([
        'admin-ui/generated/',
        'demos/',
        'packages/snapback-cli/fixtures/',
        'packages/snapback-codegen/',
        'packages/snapback-react/fixtures/',
      ]),
    }),
    regenerateCommand: 'node scripts/update-agent-safe-publication-leaf-set.mjs',
  }),
  'ci-workflow-fixtures': Object.freeze({
    records: Object.freeze([
      'tests/ci_workflows_v0.mjs (reviewed workflow, action, toolchain, and package-engine invariants)',
    ]),
    recordPaths: Object.freeze(['tests/ci_workflows_v0.mjs']),
    triggerRules: Object.freeze({
      files: Object.freeze([
        '.node-version',
        'package.json',
        'scripts/check-toolchain-authority.mjs',
        'scripts/cold-clone-check.sh',
        'scripts/verify-local-proof',
        'tests/ci_workflows_v0.mjs',
      ]),
      prefixes: Object.freeze(['.github/workflows/', 'packages/']),
    }),
    regenerateCommand: 'node tests/ci_workflows_v0.mjs',
  }),
  'client-bundle-metrology': Object.freeze({
    records: Object.freeze([
      'tests/fixtures/client-bundle-metrology/current.v1.json and its active profile/baseline ledgers',
    ]),
    recordPaths: Object.freeze(['tests/fixtures/client-bundle-metrology']),
    triggerRules: Object.freeze({
      files: Object.freeze(['scripts/client-bundle-metrology.mjs']),
      prefixes: Object.freeze([
        'packages/snapback-client/',
        'packages/snapback-contract/',
        'packages/snapback-react/',
        'tests/fixtures/client-bundle-metrology/',
      ]),
    }),
    regenerateCommand: 'node scripts/client-bundle-metrology.mjs --write-current',
    blessedRegenerateCommand:
      'node scripts/client-bundle-metrology.mjs --write-rollover-baseline',
    requiredModules: Object.freeze(['esbuild']),
  }),
  'local-proof-inventory': Object.freeze({
    records: Object.freeze([
      'tests/local_proof_inventory_v0.mjs (reviewed canonical gate inventory and versioned-seed carrier invariants)',
    ]),
    recordPaths: Object.freeze(['tests/local_proof_inventory_v0.mjs']),
    triggerRules: Object.freeze({
      files: Object.freeze([
        'scripts/check-local-proof-gates.mjs',
        'scripts/verify-local-proof',
        'tests/conformance/run-versioned-seed-v1.mjs',
        'tests/conformance/versioned-seed-v1-suite.mjs',
        'tests/local_proof_inventory_v0.mjs',
      ]),
    }),
    regenerateCommand: 'node --test tests/local_proof_inventory_v0.mjs',
  }),
  'local-store-publication': Object.freeze({
    records: Object.freeze([
      'crates/snapback-engine/src/local-persistent-store-publication.v1.json and crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json',
    ]),
    recordPaths: Object.freeze([
      'crates/snapback-engine/src/local-persistent-store-publication.v1.json',
      'crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json',
    ]),
    triggerRules: Object.freeze({
      files: Object.freeze([
        'packages/snapback-client/local-read-admission.mjs',
        'packages/snapback-client/materialization-bridge.mjs',
        'packages/snapback-client/materialization-store.mjs',
        'packages/snapback-client/materialization-store-runtime.mjs',
        'packages/snapback-client/rqs-preload-core.mjs',
        'packages/snapback-client/store-runtime.mjs',
        'packages/snapback-codegen/index.mjs',
        'schemas/capability.manifest.local-dev-sqlite-ibex.json',
        'crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json',
        'crates/snapback-engine/src/local-persistent-store-publication.v1.json',
        'crates/snapback-engine/src/local.rs',
        'crates/snapback-types/src/local/config_types.rs',
        'crates/snapback-engine/src/local/inspection.rs',
        'crates/snapback-sync/src/local/live_protocol.rs',
        'crates/snapback-sync/src/local/receipt_log.rs',
        'crates/snapback-engine/src/local/tests.rs',
        'crates/snapback-kernel/src/storage.rs',
        'tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-04.v1.json',
        'tests/acceptance/fixtures/triage-graph/budget-freeze.2026-08-04.v1.json',
        'tests/acceptance/fixtures/triage-graph/move1-exit.2026-08-04.v1.json',
      ]),
      prefixes: Object.freeze([
        'scripts/finalize-local-persistent-store-publication',
        'crates/snapback-kernel/src/storage/',
      ]),
    }),
    regenerateCommand: 'scripts/finalize-local-persistent-store-publication',
  }),
  'local-store-carrier-receipt': Object.freeze({
    records: Object.freeze([
      'tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-06.v1.json',
      'tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-06.v1.json',
    ]),
    recordPaths: Object.freeze([
      'tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-06.v1.json',
      'tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-06.v1.json',
    ]),
    triggerRules: Object.freeze({
      files: Object.freeze([
        'demos/_kit/chrome-process.mjs',
        'demos/triage-graph/demo.snapback.json',
        'demos/triage-graph/snapback/functions.mjs',
        'demos/triage-graph/snapback/schema.mjs',
        'packages/snapback-client/answer-classes.mjs',
        'packages/snapback-client/demand-broker.mjs',
        'packages/snapback-client/evaluation-floor.mjs',
        'packages/snapback-client/index.mjs',
        'packages/snapback-client/lease-convergence.mjs',
        'packages/snapback-client/materialization-bridge.mjs',
        'packages/snapback-client/materialization-store.mjs',
        'packages/snapback-client/materialization-store-runtime.mjs',
        'packages/snapback-client/registration-ledger.mjs',
        'packages/snapback-client/rqs-preload-core.mjs',
        'packages/snapback-client/rqs-store.mjs',
        'packages/snapback-client/rqs-store-file.mjs',
        'packages/snapback-client/rqs-store-meta.mjs',
        'packages/snapback-client/store-policy.mjs',
        'packages/snapback-client/store-runtime.mjs',
        'packages/snapback-contract/auth-coordinator.mjs',
        'packages/snapback-contract/client-store.mjs',
        'tests/acceptance/local-store-carrier-exit-v1.mjs',
      ]),
      prefixes: Object.freeze([
        'tests/acceptance/fixtures/local-persistent-store/',
        'tests/acceptance/fixtures/triage-graph/',
      ]),
    }),
    regenerateCommand: 'node tests/acceptance/local-store-carrier-exit-v1.mjs',
    requiredModules: Object.freeze(['esbuild']),
  }),
  'relation-activity-publication': Object.freeze({
    records: Object.freeze([
      'crates/snapback-engine/src/local-relation-activity-publication.v1.json and its pinned readers',
    ]),
    recordPaths: Object.freeze([
      'crates/snapback-engine/src/local-relation-activity-publication.v1.json',
      'tests/conformance/relation-activity-publication-v1.mjs',
      'crates/snapback-engine/src/manifest.rs',
    ]),
    triggerRules: Object.freeze({
      files: Object.freeze([
        'packages/snapback-codegen/define.mjs',
        'scripts/refresh-publication-carrier.mjs',
        'crates/snapback-engine/src/local-relation-activity-publication.v1.json',
        'crates/snapback-engine/src/local.rs',
        'crates/snapback-types/src/local/config_types.rs',
        'crates/snapback-engine/src/local/inspection.rs',
        'crates/snapback-sync/src/local/live_protocol.rs',
        'crates/snapback-sync/src/local/receipt_log.rs',
        'crates/snapback-engine/src/local/tests.rs',
        'crates/snapback-engine/src/manifest.rs',
        'crates/snapback-kernel/src/storage.rs',
        'tests/conformance/relation-activity-publication-v1.receipt.json',
        'tests/conformance/relation-activity-publication-v1.mjs',
      ]),
      prefixes: Object.freeze(['crates/snapback-kernel/src/storage/']),
    }),
    regenerateCommand: 'node scripts/refresh-publication-carrier.mjs',
  }),
  'sequence-allocation-publication': Object.freeze({
    records: Object.freeze([
      'crates/snapback-engine/src/local-sequence-allocation-publication.v1.json and its pinned readers',
    ]),
    recordPaths: Object.freeze([
      'crates/snapback-engine/src/local-sequence-allocation-publication.v1.json',
      'tests/conformance/sequence-allocation-publication-v1.mjs',
      'tests/conformance/sequence-allocation-publication-v1.receipt.json',
      'crates/snapback-engine/src/manifest.rs',
    ]),
    triggerRules: Object.freeze({
      files: Object.freeze([
        'packages/snapback-codegen/define.mjs',
        'packages/snapback-contract/derived-overlay.mjs',
        'packages/snapback-contract/index.mjs',
        'scripts/refresh-publication-carrier.mjs',
        'crates/snapback-engine/src/local/auth_room_kick_acceptance.rs',
        'crates/snapback-engine/src/local-sequence-allocation-publication.v1.json',
        'crates/snapback-engine/src/manifest.rs',
        'crates/snapback-engine/src/runtime.rs',
        'crates/snapback-kernel/src/storage.rs',
        'tests/conformance/sequence-allocation-publication-v1.mjs',
        'tests/conformance/sequence-allocation-publication-v1.receipt.json',
      ]),
      prefixes: Object.freeze(['crates/snapback-kernel/src/storage/']),
    }),
    regenerateCommand: 'node scripts/refresh-publication-carrier.mjs',
  }),
});

// Qualification C remains authoritative after a live drift gate evolves. C
// binds the governed 2026-08-04 local-store receipt pair; 3d8d89a83 later
// replaced that pair with the 2026-08-06 records. Commit 444b52089 correctly
// added auth_room_kick_acceptance.rs to the live sequence selector, but C also
// predates that trigger. Admit only those reviewed historical definitions
// alongside the current ones; the receipt digest, exact-definition comparison,
// record existence, and transferred-path trigger checks below remain mandatory.
const DERIVED_FORK_HISTORICAL_GATE_COMMIT =
  '04332ab8b73799bd3279b3150dbd8598df275530';
const DERIVED_FORK_ADMITTED_COVERAGE_GATE_VARIANTS = Object.freeze({
  'local-store-carrier-receipt': Object.freeze([
    Object.freeze({
      definition: DERIVED_FORK_ADMITTED_COVERAGE_GATES['local-store-carrier-receipt'],
    }),
    Object.freeze({
      recordCommit: DERIVED_FORK_HISTORICAL_GATE_COMMIT,
      definition: Object.freeze({
        ...DERIVED_FORK_ADMITTED_COVERAGE_GATES['local-store-carrier-receipt'],
        records: Object.freeze([
          'tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-04.v1.json',
          'tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-04.v1.json',
        ]),
        recordPaths: Object.freeze([
          'tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-04.v1.json',
          'tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-04.v1.json',
        ]),
      }),
    }),
  ]),
  'sequence-allocation-publication': Object.freeze([
    Object.freeze({
      definition: DERIVED_FORK_ADMITTED_COVERAGE_GATES['sequence-allocation-publication'],
    }),
    Object.freeze({
      recordCommit: DERIVED_FORK_HISTORICAL_GATE_COMMIT,
      definition: Object.freeze({
        ...DERIVED_FORK_ADMITTED_COVERAGE_GATES['sequence-allocation-publication'],
        triggerRules: Object.freeze({
          ...DERIVED_FORK_ADMITTED_COVERAGE_GATES['sequence-allocation-publication'].triggerRules,
          files: Object.freeze(
            DERIVED_FORK_ADMITTED_COVERAGE_GATES[
              'sequence-allocation-publication'
            ].triggerRules.files.filter((path) => (
              path !== 'crates/snapback-engine/src/local/auth_room_kick_acceptance.rs'
            )),
          ),
        }),
      }),
    }),
  ]),
});

// These are the exact nine leaves that rotated the 2026-08-07 withdrawn
// publication between 7cada777b and a5465b4a2. Each transfer names the
// canonical frozen-record gate that assumes custody when v3 narrows scope.
export const DERIVED_FORK_COVERAGE_TRANSFERS = Object.freeze([
  Object.freeze({
    path: 'tests/agent_safe_publication_checker_v1.mjs',
    gate: 'agent-safe-publication-fixtures',
  }),
  Object.freeze({ path: 'tests/ci_workflows_v0.mjs', gate: 'ci-workflow-fixtures' }),
  Object.freeze({
    path: 'tests/conformance/run-versioned-seed-v1.mjs',
    gate: 'local-proof-inventory',
  }),
  Object.freeze({
    path: 'tests/conformance/versioned-seed-v1-suite.mjs',
    gate: 'local-proof-inventory',
  }),
  Object.freeze({
    path: 'tests/fixtures/client-bundle-metrology/baseline.asset-delivery-selection.v1.json',
    gate: 'client-bundle-metrology',
  }),
  Object.freeze({
    path: 'tests/fixtures/client-bundle-metrology/baseline.client-bundle-disposition.v1.json',
    gate: 'client-bundle-metrology',
  }),
  Object.freeze({
    path: 'tests/fixtures/client-bundle-metrology/baseline.client-bundle-disposition.v2.json',
    gate: 'client-bundle-metrology',
  }),
  Object.freeze({
    path: 'tests/fixtures/client-bundle-metrology/baseline.s2-commands.v1.json',
    gate: 'client-bundle-metrology',
  }),
  Object.freeze({ path: 'tests/local_proof_inventory_v0.mjs', gate: 'local-proof-inventory' }),
]);

// @ref LLP 0189#decision — D-4 sibling custody stays mechanically present even
// while legitimate post-C regeneration is typed claim evolution.
// Sibling publication-chain paths remain claim-scoped source, so they are not
// departing coverage transfers. Their integrity custody is nevertheless bound
// to qualification C by the same exact registry-admission checks. The
// persistent-store receipt gate is a required chain owner even though the
// publication gate is the direct recomputing owner for both source records.
export const DERIVED_FORK_SIBLING_CUSTODY_GATES = Object.freeze([
  'local-store-publication',
  'local-store-carrier-receipt',
  'relation-activity-publication',
  'sequence-allocation-publication',
]);

export const DERIVED_FORK_SIBLING_CUSTODY_TRANSFERS = Object.freeze([
  Object.freeze({
    path: 'crates/snapback-engine/src/local-persistent-store-publication.v1.json',
    gate: 'local-store-publication',
  }),
  Object.freeze({
    path: 'crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json',
    gate: 'local-store-publication',
  }),
  Object.freeze({
    path: 'crates/snapback-engine/src/local-relation-activity-publication.v1.json',
    gate: 'relation-activity-publication',
  }),
  Object.freeze({
    path: 'crates/snapback-engine/src/local-sequence-allocation-publication.v1.json',
    gate: 'sequence-allocation-publication',
  }),
]);

// Fable round-1 F3: the named author must acknowledge the residual v2 -> v3
// departing class, not only the nine drift-prone leaves with explicit transfer
// rows. The retained scope remains the authority; this makes the corresponding
// exclusion classification legible in the accepted record.
const DERIVED_FORK_RESIDUAL_V2_DEPARTING_CLASS = Object.freeze({
  schemaVersion: 'snapback.derived-fork-residual-v2-departing-class.v1',
  departingRoots: Object.freeze([
    'packages/snapback-codegen',
    'packages/snapback-contract',
    'tests',
  ]),
  separatelyLedgeredPaths: Object.freeze(
    DERIVED_FORK_COVERAGE_TRANSFERS.map(({ path }) => path),
  ),
  disposition:
    'qualification-time evidence and non-claim-semantics support; re-inspected at each fresh qualification',
});
const REVIEW_HISTORY_SCHEMA_VERSION = 'snapback.review-verdicts.v2';
const AGENT_SAFE_SCHEMA_PATHS = [
  'schemas/capability.manifest.schema.json',
  'schemas/inspect.schema.json',
  'schemas/inspect.admin.schema.json',
  'schemas/inspect.public.schema.json',
];

// Rounds 1-12 predate frozen prose-prefix bindings. Their stable review
// identity is enumerated here so an unbound round cannot be introduced after
// the cutoff by merely omitting the new fields. The current-artifact digest
// remains mandatory for these legacy entries; only the historical prefix
// digest is unavailable.
const LEGACY_REVIEW_COMMITS = [
  '7c2a27e0e90cf1d19b57825a187cb3be041ab92f',
  '96fd0ad1c38109aa524e4cbc39439c8982e18766',
  'cdc0fe03e8d75c4a1d1d25f79fe820f20b772ef7',
  '0b8b0ff71bfc3eaa968b53a694a61f8a472ee295',
  'b08e835f112517cf1629a842f5bcae12841ddcf0',
  'bdc68296499298f634d9aa461e90fb8d1a7d4ab0',
  '2a5a6291a137ca3df41cfc826017e4de324b65a5',
  '0e778b9a85f26c45df8af0068979e355893baaa3',
  '42f699749699f416b0015781a6bb729414db4464',
  'fac516e9aaa83fda398ca684285f45a57192e826',
  'a127e9b474dd5bedb31c73afa57022f4d8b82aed',
  'ad0ad58748981010204b61eb5002e35b887a5093',
];
const LEGACY_REVIEW_VERDICT_CODES = new Map([
  [DERIVED_FORK_HISTORICAL_EVIDENCE[5][1], ['NNN', 'RRN', 'RRR', 'RRR', 'RRR', 'RRR', 'RRR', 'RRR', 'RRR', 'RRR', 'RNR', 'RRR']],
  [DERIVED_FORK_HISTORICAL_EVIDENCE[7][1], ['RNR', 'RRR', 'RRR', 'RRR', 'RRR', 'RRR', 'RRR', 'RRR', 'RRR', 'RRR', 'RRR', 'RRR']],
  [DERIVED_FORK_HISTORICAL_EVIDENCE[9][1], ['N', 'N', 'R', 'N', 'N', 'N', 'N', 'N', 'R', 'R', 'N', 'R']],
  [DERIVED_FORK_HISTORICAL_EVIDENCE[11][1], ['R', 'N', 'R', 'N', 'N', 'N', 'N', 'N', 'R', 'R', 'N', 'R']],
]);

export const PUBLICATION_CYCLE_ALLOWLIST = new Set([
  'crates/snapback-activation/src/local-agent-safe-storage-publication.anchor.json',
  'crates/snapback-activation/src/local-agent-safe-storage-publication.carrier.json',
  'crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json',
  'crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.carrier.json',
  // Path-epoch aliases remain exact cycle exclusions when a historical C is
  // recomputed. Dropping the old spellings changes the digest of the frozen
  // commit by accidentally hashing the carrier that the digest certifies.
  'crates/snapback/src/local-agent-safe-storage-publication.anchor.json',
  'crates/snapback/src/local-agent-safe-storage-publication.carrier.json',
  'crates/snapback/src/local-agent-safe-derived-deployment-fork-publication.anchor.json',
  'crates/snapback/src/local-agent-safe-derived-deployment-fork-publication.carrier.json',
  'src/local-agent-safe-storage-publication.anchor.json', // path-migration: historical
  'src/local-agent-safe-storage-publication.carrier.json', // path-migration: historical
  'src/local-agent-safe-derived-deployment-fork-publication.anchor.json', // path-migration: historical
  'src/local-agent-safe-derived-deployment-fork-publication.carrier.json', // path-migration: historical
  'tests/acceptance/receipts/agent-safe-storage-publication.2026-08-04.v1.json',
  'tests/acceptance/receipts/agent-safe-derived-deployment-fork-publication.2026-08-04.v1.json',
  'tests/acceptance/fixtures/agent-safe-storage/acceptance-corpus.2026-08-04.v1.json',
  'tests/acceptance/fixtures/agent-safe-storage/agent-safe-active-covered-paired.2026-08-04.v1.json',
  'tests/acceptance/fixtures/agent-safe-storage/fork-promotion-performance.2026-08-04.v1.json',
  'tests/acceptance/fixtures/agent-safe-storage/author-acceptance.2026-08-04.v1.json',
  // @ref LLP 0162#source-owned-publication-carrier-amendment--2026-08-04
  // Governing invariant: an artifact may not be inside the implementation
  // digest that certifies it, and the validator's fixtures may not depend on
  // live mutable records. Closed evidence minted at or after qualification C
  // is excluded here and remains canonical-byte- and receipt-digest-bound at
  // publication P.
  // @ref LLP 0189#decision — digests are scoped to the claim: the checkers
  // defining the claim's semantics stay in IMPLEMENTATION_ROOTS; wave-shared
  // proof/metrology/fixture files leave the digest only in the same change
  // that lands (or names) their qualifying frozen-record drift gate. Digest
  // re-scope mechanics: issues/20260807-llp-0189-claim-snapshot-implementation.md.
  'tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json',
  'tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.linux-x86_64.v1.json',
  'tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.v1.json',
  'tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-06.v1.json',
  'tests/acceptance/fixtures/latency-kanban/move3-exit.2026-08-04.r2.v1.json',
  'tests/acceptance/latency-kanban-move3-v1-evidence.md',
  'tests/acceptance/fixtures/triage-graph/move1-exit.2026-08-06.v1.json',
  'tests/acceptance/fixtures/triage-graph/budget-freeze.2026-08-06.v1.json',
  'tests/acceptance/triage-graph-move1-v1-evidence.md',
  'tests/acceptance/fixtures/fleet-observatory/move1-exit.2026-08-06.v1.json',
  'tests/acceptance/fixtures/fleet-observatory/budget-freeze.2026-08-06.v1.json',
  'tests/acceptance/fleet-observatory-move1-v1-evidence.md',
  'tests/acceptance/fixtures/contention-calendar/rung2-exit.2026-08-04.r1.v1.json',
  'tests/acceptance/contention-calendar-rung2-v1-evidence.md',
  'tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-06.v1.json',
  'tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-06.v1.json',
  'tests/acceptance/local-store-carrier-exit-v1-evidence.md',
  'crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json',
  'crates/snapback-engine/src/local-persistent-store-publication.v1.json',
  'crates/snapback/src/local-persistent-store-publication.anchor.v1.json',
  'crates/snapback/src/local-persistent-store-publication.v1.json',
  'src/local-persistent-store-publication.anchor.v1.json', // path-migration: historical
  'src/local-persistent-store-publication.v1.json', // path-migration: historical
]);

// The persistent-store carrier and anchor are publication-cycle exclusions
// for their own storage claim, but remain ordinary scoped source evolution for
// the derived-fork snapshot. The two other sibling carriers already have that
// classification because they are not cycle exclusions.
export const DERIVED_FORK_SIBLING_CHAIN_PATHS = Object.freeze([
  'crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json',
  'crates/snapback-engine/src/local-persistent-store-publication.v1.json',
  'crates/snapback-engine/src/local-relation-activity-publication.v1.json',
  'crates/snapback-engine/src/local-sequence-allocation-publication.v1.json',
]);

export const LOCAL_STORE_PUBLICATION_TRANSFORM = {
  anchor: 'crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json',
  carrier: 'crates/snapback-engine/src/local-persistent-store-publication.v1.json',
  receipts: [
    {
      path: 'tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-06.v1.json',
    },
    {
      path: 'tests/acceptance/fixtures/triage-graph/budget-freeze.2026-08-06.v1.json',
    },
    {
      path: 'tests/acceptance/fixtures/triage-graph/move1-exit.2026-08-06.v1.json',
    },
  ],
};

const STORAGE_COMPONENTS = [
  'ordinaryMutationHostPlanEnvelope',
  'ordinaryMutationIbexBufferedEnvelope',
  'hostChildMutationHostPlanEnvelope',
  'hostChildMutationIbexBufferedEnvelope',
  'generatedOwnedCrudOwnerCreateHostPlanExplanation',
  'generatedOwnedCrudOwnerUpdateHostPlanExplanation',
];
const DERIVED_COMPONENTS = ['derivedDeploymentForkSafetyV1'];

const RECORDS = [
  {
    id: 'agent_safe_storage_v1',
    anchor: 'crates/snapback-activation/src/local-agent-safe-storage-publication.anchor.json',
    carrier: 'crates/snapback-activation/src/local-agent-safe-storage-publication.carrier.json',
    receipt: 'tests/acceptance/receipts/agent-safe-storage-publication.2026-08-04.v1.json',
    components: STORAGE_COMPONENTS,
  },
  {
    id: 'agent_safe_derived_deployment_fork_v1',
    anchor: 'crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json',
    carrier: 'crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.carrier.json',
    receipt: 'tests/acceptance/receipts/agent-safe-derived-deployment-fork-publication.2026-08-04.v1.json',
    components: DERIVED_COMPONENTS,
  },
];

const PUBLICATION_ONLY_PATHS = new Set([
  ...PUBLICATION_CYCLE_ALLOWLIST,
  'llp/0158-instance-forking.rfc.md',
  'llp/0000-snapback.explainer.md',
  'llp/0162-agent-safe-storage-profile.rfc.md',
  'llp/0163-operation-identity-and-commit-envelope.spec.md',
  'llp/0164-fork-and-promotion.spec.md',
  'llp/0165-proof-domains-and-checkpoints.spec.md',
  'llp/reviews/0162-agent-safe-storage-profile.implementation-2026-08-04.fable.md',
  'llp/reviews/0162-agent-safe-storage-profile.implementation-2026-08-04.codex.md',
  'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.codex.md',
  'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.codex.verdicts.v1.json',
  'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.fable.md',
  'llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.fable.verdicts.v1.json',
  'llp/reviews/0158-instance-forking.implementation-2026-08-06.codex.md',
  'llp/reviews/0158-instance-forking.implementation-2026-08-06.codex.verdicts.v1.json',
  'llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.md',
  'llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.verdicts.v1.json',
  'issues/20260803-agent-safe-storage-acceptance-tail.md',
  'issues/20260803-0163-public-operation-identity-carrier.md',
  'issues/20260803-guide-gap-instance-forks.md',
  'issues/20260806-derived-fork-publication-author-gate.md',
  'issues/closed/20260803-agent-safe-storage-acceptance-tail.md',
  'issues/closed/20260803-0163-public-operation-identity-carrier.md',
  'issues/closed/20260803-guide-gap-instance-forks.md',
  'issues/closed/20260806-derived-fork-publication-author-gate.md',
  'issues/20260803-wave3-program.md',
  'guide/capabilities.md',
  'guide/guide-flat.generated.md',
  'guide/guide-manifest.generated.json',
  'guide/index.md',
  'guide/operating/instance-forks.md',
  'schemas/capability.manifest.local-dev-sqlite-ibex.json',
  'schemas/capability.manifest.local-dev-sqlite-ibex.outbound-actions.json',
  'schemas/capability.manifest.schema.json',
  'schemas/inspect.admin.schema.json',
  'schemas/inspect.public.schema.json',
  'schemas/inspect.schema.json',
  'demos/latency-kanban/snapback/trusted-composition-activation.json',
  'demos/triage-graph/snapback/trusted-composition-activation.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/trusted-composition-activation.json',
]);

export function allowedPublicationPath(path, generatedPaths = new Map()) {
  return PUBLICATION_ONLY_PATHS.has(path)
    || isCurrentDerivedForkDatedEvidencePath(path)
    || generatedPaths.has(path);
}

function fail(message) {
  throw new Error(`agent-safe-publication: ${message}`);
}

function git(root, args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: root, encoding }).toString().trim();
}

function committedBytes(root, commit, path) {
  return execFileSync('git', ['show', `${commit}:${path}`], {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function treeEntriesAt(root, commit, roots) {
  const raw = execFileSync('git', ['ls-tree', '-r', '-z', commit, '--', ...roots], { cwd: root });
  const entries = new Map();
  for (const record of raw.toString().split('\0').filter(Boolean)) {
    const match = record.match(/^([0-7]{6}) (blob|tree|commit) ([0-9a-f]+)\t([\s\S]+)$/u);
    if (!match) fail(`could not decode tree entry at ${commit}`);
    const [, mode, type, object, path] = match;
    entries.set(path, { mode, type, object });
  }
  return entries;
}

function portableGeneratedLeaf(path) {
  return typeof path === 'string'
    && path.length > 0
    && !path.startsWith('/')
    && !path.includes('\\')
    && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function requireFrozenBlob(entries, path, label) {
  const entry = entries.get(path);
  if (!entry || entry.type !== 'blob' || !entry.mode.startsWith('100')) {
    fail(`${label} is not a regular blob at qualification C: ${path}`);
  }
  return entry;
}

export function generatedPublicationPathsAt(root, commit) {
  const roots = [...REVIEW_CACHE_ROOTS, ...FULLY_COMMITTED_ROOTS, ...ADMIN_GENERATED_ROOTS];
  const entries = treeEntriesAt(root, commit, roots);
  const allowed = new Map();
  for (const generatedRoot of REVIEW_CACHE_ROOTS) {
    const manifestPath = `${generatedRoot}/artifacts.json`;
    allowed.set(manifestPath, requireFrozenBlob(entries, manifestPath, 'review manifest'));
    let manifest;
    try {
      manifest = JSON.parse(execFileSync('git', ['show', `${commit}:${manifestPath}`], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      }));
    } catch (error) {
      fail(`could not decode qualification-C review manifest ${manifestPath}: ${error.message}`);
    }
    if (manifest?.manifestVersion !== 2 || !Array.isArray(manifest.files)) {
      fail(`qualification-C review manifest is not v2: ${manifestPath}`);
    }
    for (const file of manifest.files) {
      if (file?.custody !== 'consumer-committed') continue;
      if (!portableGeneratedLeaf(file.path)) {
        fail(`qualification-C consumer projection path is invalid: ${manifestPath}`);
      }
      const path = `${generatedRoot}/${file.path}`;
      allowed.set(path, requireFrozenBlob(entries, path, 'consumer-committed projection'));
    }
  }
  for (const generatedRoot of [...FULLY_COMMITTED_ROOTS, ...ADMIN_GENERATED_ROOTS]) {
    for (const [path, entry] of entries) {
      if (path.startsWith(`${generatedRoot}/`)) {
        allowed.set(path, requireFrozenBlob(entries, path, 'fully committed generated projection'));
      }
    }
  }
  return allowed;
}

function diskRegularBlob(root, path, label) {
  let stat;
  try {
    stat = lstatSync(join(root, path));
  } catch {
    fail(`${label} is missing from disk: ${path}`);
  }
  if (!stat.isFile()) fail(`${label} is not a regular blob on disk: ${path}`);
  return { mode: stat.mode & 0o111 ? '100755' : '100644', type: 'blob' };
}

function indexedGeneratedEntriesOnDisk(root) {
  const generatedRoots = [
    ...REVIEW_CACHE_ROOTS,
    ...FULLY_COMMITTED_ROOTS,
    ...ADMIN_GENERATED_ROOTS,
  ];
  const raw = execFileSync('git', ['ls-files', '--stage', '-z', '--', ...generatedRoots], {
    cwd: root,
  });
  const entries = new Map();
  for (const record of raw.toString().split('\0').filter(Boolean)) {
    const match = record.match(/^([0-7]{6}) [0-9a-f]+ 0\t([\s\S]+)$/u);
    if (!match) fail('could not decode indexed generated leaf');
    const [, mode, path] = match;
    entries.set(path, { mode, type: mode === '160000' ? 'commit' : 'blob' });
  }
  return entries;
}

function indexedRegularBlob(root, entries, path, label) {
  const entry = entries.get(path);
  if (!entry || entry.type !== 'blob' || !entry.mode.startsWith('100')) {
    fail(`${label} is not a tracked regular blob on disk: ${path}`);
  }
  diskRegularBlob(root, path, label);
  return entry;
}

// Inventory-only working-tree twin of generatedPublicationPathsAt(). It reads
// reviewed manifests and regular generated leaves without running codegen or
// any publication qualification behavior.
export function generatedPublicationPathsOnDisk(root) {
  const entries = indexedGeneratedEntriesOnDisk(root);
  const allowed = new Map();
  for (const generatedRoot of REVIEW_CACHE_ROOTS) {
    const manifestPath = `${generatedRoot}/artifacts.json`;
    allowed.set(
      manifestPath,
      indexedRegularBlob(root, entries, manifestPath, 'review manifest'),
    );
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(root, manifestPath), 'utf8'));
    } catch (error) {
      fail(`could not decode review manifest on disk ${manifestPath}: ${error.message}`);
    }
    if (manifest?.manifestVersion !== 2 || !Array.isArray(manifest.files)) {
      fail(`review manifest on disk is not v2: ${manifestPath}`);
    }
    for (const file of manifest.files) {
      if (file?.custody !== 'consumer-committed') continue;
      if (!portableGeneratedLeaf(file.path)) {
        fail(`consumer projection path on disk is invalid: ${manifestPath}`);
      }
      const path = `${generatedRoot}/${file.path}`;
      allowed.set(
        path,
        indexedRegularBlob(root, entries, path, 'consumer-committed projection'),
      );
    }
  }
  for (const generatedRoot of [...FULLY_COMMITTED_ROOTS, ...ADMIN_GENERATED_ROOTS]) {
    for (const [path, entry] of entries) {
      if (!path.startsWith(`${generatedRoot}/`)) continue;
      allowed.set(
        path,
        indexedRegularBlob(root, entries, path, 'fully committed generated projection'),
      );
    }
  }
  return allowed;
}

export function allowedPublicationChange(change, generatedPaths, publicationEntries) {
  if (PUBLICATION_ONLY_PATHS.has(change.path)) return true;
  if (isCurrentDerivedForkDatedEvidencePath(change.path)) return change.status === 'A';
  const expected = generatedPaths.get(change.path);
  const published = publicationEntries.get(change.path);
  return change.status === 'M'
    && expected?.type === 'blob'
    && published?.type === 'blob'
    && published.mode === expected.mode;
}

function repositoryRelativePath(path) {
  return typeof path === 'string'
    && path.length > 0
    && !path.startsWith('/')
    && !path.endsWith('/')
    && !path.split('/').includes('..')
    && !path.includes('\\');
}

function codePointOrder(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => codePointOrder(left, right))
    .map(([key, member]) => [key, canonicalValue(member)]));
}

function canonicallyEqual(left, right) {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

export function validateImplementationScope(scope, label = 'implementation scope') {
  exactKeys(scope, ['schemaVersion', 'roots', 'files'], label);
  if (scope.schemaVersion !== IMPLEMENTATION_SCOPE_SCHEMA_VERSION) {
    fail(`${label} schema is stale or unsupported`);
  }
  for (const member of ['roots', 'files']) {
    if (!Array.isArray(scope[member])
        || scope[member].some((path) => !repositoryRelativePath(path))) {
      fail(`${label} ${member} are not portable repository-relative paths`);
    }
    const ordered = [...scope[member]].sort(codePointOrder);
    if (JSON.stringify(scope[member]) !== JSON.stringify(ordered)
        || new Set(scope[member]).size !== scope[member].length) {
      fail(`${label} ${member} must be sorted and unique`);
    }
  }
  if (scope.roots.length + scope.files.length === 0) fail(`${label} is empty`);
  for (const rootPath of scope.roots) {
    if (scope.roots.some((other) => other !== rootPath && rootPath.startsWith(`${other}/`))) {
      fail(`${label} root ${rootPath} is redundantly nested`);
    }
  }
  for (const path of scope.files) {
    if (scope.roots.some((rootPath) => path === rootPath || path.startsWith(`${rootPath}/`))) {
      fail(`${label} file ${path} is already covered by a root`);
    }
    if (PUBLICATION_CYCLE_ALLOWLIST.has(path)) {
      fail(`${label} file ${path} is a publication-cycle leaf`);
    }
  }
  return scope;
}

function implementationScopePaths(scope) {
  if (scope === undefined) return [...IMPLEMENTATION_ROOTS, 'vendor/ibex'];
  validateImplementationScope(scope);
  return [...scope.roots, ...scope.files];
}

export function implementationScopeCoversPath(scope, path) {
  if (scope === undefined) {
    return [...IMPLEMENTATION_ROOTS, 'vendor/ibex'].some((rootPath) => (
      path === rootPath || path.startsWith(`${rootPath}/`)
    ));
  }
  validateImplementationScope(scope);
  return scope.files.includes(path) || scope.roots.some((rootPath) => (
    path === rootPath || path.startsWith(`${rootPath}/`)
  ));
}

function decodeNameStatus(bytes, label) {
  const fields = bytes.toString().split('\0').filter(Boolean);
  if (fields.length % 2 !== 0) fail(`could not decode ${label}`);
  const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    changes.push({ status: fields[index], path: fields[index + 1] });
  }
  return changes;
}

export function qualifiedImplementationChangesBetween(root, from, to, scope = undefined) {
  const raw = execFileSync('git', [
    'diff', '--name-status', '--no-renames', '-z', `${from}..${to}`, '--',
    ...implementationScopePaths(scope),
  ], { cwd: root });
  return decodeNameStatus(raw, 'qualified implementation drift')
    .filter(({ path }) => !PUBLICATION_CYCLE_ALLOWLIST.has(path));
}

// @ref LLP 0189#decision — D-3 snapshot evaluation keeps unrelated post-C
// landings visible and lets an authorized published claim stand with typed
// requalification due instead of racing normal fleet evolution.
export function evaluateClaimSnapshot(root, {
  qualificationCommit,
  publicationCommit,
  scope = undefined,
  allowRequalificationDue = false,
  publicationCycleEvolutionPaths = [],
}) {
  const publicationCycleEvolution = new Set(publicationCycleEvolutionPaths);
  const raw = execFileSync('git', [
    'diff', '--name-status', '--no-renames', '-z',
    `${qualificationCommit}..${publicationCommit}`,
  ], { cwd: root });
  const changes = decodeNameStatus(raw, 'claim snapshot drift')
    .filter(({ path }) => (
      !PUBLICATION_CYCLE_ALLOWLIST.has(path) || publicationCycleEvolution.has(path)
    ));
  const scopedChanges = changes.filter(({ path }) => implementationScopeCoversPath(scope, path));
  const outOfScopeChanges = changes.filter(
    ({ path }) => !implementationScopeCoversPath(scope, path),
  );
  const requalificationDue = allowRequalificationDue && scopedChanges.length > 0
    ? { scopedChanges, since: qualificationCommit }
    : undefined;
  return {
    state: scopedChanges.length === 0 || requalificationDue !== undefined ? 'stands' : 'invalid',
    scopedChanges,
    outOfScopeChanges,
    ...(requalificationDue === undefined ? {} : { requalificationDue }),
  };
}

function gateTriggerMatchesPath(metadata, path) {
  const trigger = metadata.triggerRules ?? {};
  return (trigger.files ?? []).includes(path)
    || (trigger.prefixes ?? []).some((prefix) => path.startsWith(prefix))
    || (trigger.suffixes ?? []).some((suffix) => path.endsWith(suffix));
}

function gateRecordsExistAtCommit(root, commit, metadata) {
  const entries = treeEntriesAt(root, commit, metadata.recordPaths);
  return metadata.recordPaths.every((recordPath) => [...entries].some(([path, entry]) => (
    entry.type === 'blob'
      && entry.mode.startsWith('100')
      && (path === recordPath || path.startsWith(`${recordPath}/`))
  )));
}

function normalizeCoverageGatePathEpoch(root, commit, value) {
  if (typeof value === 'string') {
    let normalized = value;
    if (derivedForkImplementationScopeAt(root, commit)
        === LEGACY_DERIVED_FORK_IMPLEMENTATION_SCOPE) {
      normalized = normalized.replaceAll('src/', 'crates/snapback/src/'); // path-migration: historical
    }
    // @ref LLP 0276#phases — qualification-C policy bytes retain the source
    // paths that existed at C. Compare them to the current admitted gate only
    // after applying the same file-for-file crate carve mapping; record
    // existence is still checked against the unmodified C paths below.
    return normalized
      .replaceAll('crates/snapback/src/local-persistent-store-publication', 'crates/snapback-engine/src/local-persistent-store-publication')
      .replaceAll('crates/snapback/src/local-relation-activity-publication', 'crates/snapback-engine/src/local-relation-activity-publication')
      .replaceAll('crates/snapback/src/local-sequence-allocation-publication', 'crates/snapback-engine/src/local-sequence-allocation-publication')
      .replaceAll('crates/snapback/src/local/config_types.rs', 'crates/snapback-types/src/local/config_types.rs')
      .replaceAll('crates/snapback/src/local/inspection.rs', 'crates/snapback-engine/src/local/inspection.rs')
      .replaceAll('crates/snapback/src/local/live_protocol.rs', 'crates/snapback-sync/src/local/live_protocol.rs')
      .replaceAll('crates/snapback/src/local/receipt_log.rs', 'crates/snapback-sync/src/local/receipt_log.rs')
      .replaceAll('crates/snapback/src/local/tests.rs', 'crates/snapback-engine/src/local/tests.rs')
      .replaceAll('crates/snapback/src/local.rs', 'crates/snapback-engine/src/local.rs')
      .replaceAll('crates/snapback/src/manifest.rs', 'crates/snapback-engine/src/manifest.rs')
      .replaceAll('crates/snapback/src/runtime.rs', 'crates/snapback-engine/src/runtime.rs')
      .replaceAll('crates/snapback/src/storage/', 'crates/snapback-kernel/src/storage/')
      .replaceAll('crates/snapback/src/storage.rs', 'crates/snapback-kernel/src/storage.rs');
  }
  if (Array.isArray(value)) return value.map((member) => (
    normalizeCoverageGatePathEpoch(root, commit, member)
  ));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, member]) => [
      key,
      normalizeCoverageGatePathEpoch(root, commit, member),
    ]));
  }
  return value;
}

function admittedCoverageGateAtCommit(root, recordCommit, driftProneGates, gate) {
  const metadata = driftProneGates?.[gate];
  const admitted = DERIVED_FORK_ADMITTED_COVERAGE_GATES[gate];
  const admittedVariants = DERIVED_FORK_ADMITTED_COVERAGE_GATE_VARIANTS[gate]
    ?? (admitted === undefined ? [] : [{ definition: admitted }]);
  const normalizedMetadata = metadata === undefined
    ? undefined
    : normalizeCoverageGatePathEpoch(root, recordCommit, metadata);
  if (metadata === undefined || admitted === undefined
      || !admittedVariants.some(({ recordCommit: requiredCommit, definition }) => (
        (requiredCommit === undefined || recordCommit === requiredCommit)
        && canonicallyEqual(normalizedMetadata, definition)
      ))
      || !gateRecordsExistAtCommit(root, recordCommit, metadata)) {
    return null;
  }
  return normalizedMetadata;
}

// The caller supplies the reviewed previous-record departure set. Exact set
// equality prevents a transfer annotation from covering only the convenient
// subset, while the registry lookup proves that every named replacement is a
// real canonical frozen-record gate rather than prose or a stub.
export function assertCoverageTransfers({
  root,
  recordCommit = 'HEAD',
  scope,
  departingPaths,
  transfers,
  driftProneGates,
}) {
  validateImplementationScope(scope);
  if (typeof root !== 'string' || root.length === 0
      || typeof recordCommit !== 'string' || recordCommit.length === 0
      || !Array.isArray(departingPaths) || !Array.isArray(transfers)) {
    fail('coverage transfer inputs must be arrays');
  }
  const expectedPaths = [...departingPaths].sort(codePointOrder);
  if (expectedPaths.some((path) => !repositoryRelativePath(path))
      || new Set(expectedPaths).size !== expectedPaths.length) {
    fail('departing coverage paths must be portable and unique');
  }
  for (const transfer of transfers) exactKeys(transfer, ['path', 'gate'], 'coverage transfer');
  const transferredPaths = transfers.map(({ path }) => path).sort(codePointOrder);
  if (JSON.stringify(transferredPaths) !== JSON.stringify(expectedPaths)) {
    const missing = expectedPaths.filter((path) => !transferredPaths.includes(path));
    const extra = transferredPaths.filter((path) => !expectedPaths.includes(path));
    fail(`coverage moved without a frozen-record gate; missing ${missing.join(',') || 'none'}; `
      + `extra ${extra.join(',') || 'none'}`);
  }
  for (const { path, gate } of transfers) {
    if (implementationScopeCoversPath(scope, path)) {
      fail(`coverage transfer ${path} did not leave the claim scope`);
    }
    const metadata = admittedCoverageGateAtCommit(
      root,
      recordCommit,
      driftProneGates,
      gate,
    );
    if (metadata === null
        || !gateTriggerMatchesPath(metadata, path)) {
      fail(`coverage transfer ${path} is not covered by registered drift gate ${gate}`);
    }
  }
  return transfers;
}

function assertSiblingChainCustodyTransfers({
  root,
  recordCommit,
  transfers,
  driftProneGates,
}) {
  const expectedPaths = [...DERIVED_FORK_SIBLING_CHAIN_PATHS].sort(codePointOrder);
  for (const transfer of transfers) {
    exactKeys(transfer, ['path', 'gate'], 'sibling custody transfer');
  }
  const transferredPaths = transfers.map(({ path }) => path).sort(codePointOrder);
  if (JSON.stringify(transferredPaths) !== JSON.stringify(expectedPaths)) {
    const missing = expectedPaths.filter((path) => !transferredPaths.includes(path));
    const extra = transferredPaths.filter((path) => !expectedPaths.includes(path));
    fail(`sibling custody moved without a frozen-record gate; missing ${missing.join(',') || 'none'}; `
      + `extra ${extra.join(',') || 'none'}`);
  }
  for (const { path, gate } of transfers) {
    const metadata = admittedCoverageGateAtCommit(
      root,
      recordCommit,
      driftProneGates,
      gate,
    );
    if (metadata === null || !gateTriggerMatchesPath(metadata, path)) {
      fail(`sibling custody transfer ${path} is not covered by registered drift gate ${gate}`);
    }
  }
  for (const gate of DERIVED_FORK_SIBLING_CUSTODY_GATES) {
    if (admittedCoverageGateAtCommit(
      root,
      recordCommit,
      driftProneGates,
      gate,
    ) === null) {
      fail(`sibling custody gate ${gate} does not retain its exact registered definition`);
    }
  }
  return transfers;
}

export function validateDerivedForkCoverageTransfers(
  root,
  qualificationCommit,
  selectionPolicySha256,
) {
  // @ref LLP 0189#decision — D-4 closes this semantics-affecting checker input
  // by content in the claim record. Read the exact qualification-C bytes so
  // later fleet-selector evolution cannot change the standing snapshot's
  // transfer verdict.
  if (!/^[0-9a-f]{40}$/u.test(qualificationCommit ?? '')
      || !isSha256(selectionPolicySha256, true)) {
    fail('derived-fork selection policy binding is invalid');
  }
  let policyBytes;
  try {
    policyBytes = committedBytes(root, qualificationCommit, DERIVED_FORK_SELECTION_POLICY_PATH);
  } catch (error) {
    fail(`could not read qualification-C selection policy: ${error.message}`);
  }
  const actualSelectionPolicySha256 = sha256(policyBytes);
  if (selectionPolicySha256 !== actualSelectionPolicySha256) {
    fail('derived-fork selection policy digest does not match qualification-C bytes; '
      + `expected ${selectionPolicySha256}; actual ${actualSelectionPolicySha256}`);
  }
  let policy;
  try {
    policy = JSON.parse(policyBytes.toString('utf8'));
  } catch (error) {
    fail(`qualification-C selection policy is not valid JSON: ${error.message}`);
  }
  const coverageTransfers = assertCoverageTransfers({
    root,
    recordCommit: qualificationCommit,
    scope: DERIVED_FORK_IMPLEMENTATION_SCOPE,
    departingPaths: DERIVED_FORK_COVERAGE_TRANSFERS.map(({ path }) => path),
    transfers: DERIVED_FORK_COVERAGE_TRANSFERS,
    driftProneGates: policy.driftProneGates,
  });
  assertSiblingChainCustodyTransfers({
    root,
    recordCommit: qualificationCommit,
    transfers: DERIVED_FORK_SIBLING_CUSTODY_TRANSFERS,
    driftProneGates: policy.driftProneGates,
  });
  return coverageTransfers;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function substituteSinglePinnedDigest(bytes, before, after, label) {
  if (!isSha256(before, true) || !isSha256(after, true)) {
    fail(`${label} digest is invalid`);
  }
  const text = bytes.toString('utf8');
  const occurrences = text.split(before).length - 1;
  if (occurrences !== 1) {
    fail(`${label} expected one qualification-C digest, found ${occurrences}`);
  }
  return Buffer.from(text.replace(before, after));
}

// @ref LLP 0162#source-owned-publication-carrier-amendment--2026-08-04
// Publishing the local agent-safe manifest refreshes signed Triage evidence,
// which is itself an input to the already-published local-store carrier. The
// source-owned anchor and carrier remain a cycle exclusion only for the exact
// mechanical digest substitution rooted in qualification C; Rust and its
// conformance logic remain byte-identical implementation inputs.
export function expectedLocalStorePublicationTransform(root, qualificationCommit) {
  const carrierAtQualification = committedBytes(
    root,
    qualificationCommit,
    LOCAL_STORE_PUBLICATION_TRANSFORM.carrier,
  );
  parseCanonicalPublicationJson(carrierAtQualification, 'qualification-C local-store carrier');

  // After canonical validation, the transitive transform treats the frozen
  // carrier and anchor as opaque signed bytes and permits only an exact,
  // single-occurrence substitution of each receipted digest.
  let expectedCarrier = carrierAtQualification;
  for (const receipt of LOCAL_STORE_PUBLICATION_TRANSFORM.receipts) {
    const receiptAtQualification = committedBytes(root, qualificationCommit, receipt.path);
    parseCanonicalPublicationJson(
      receiptAtQualification,
      `qualification-C local-store receipt ${receipt.path}`,
    );
    const recorded = sha256(receiptAtQualification);
    const publishedReceipt = readFileSync(join(root, receipt.path));
    parseCanonicalPublicationJson(publishedReceipt, `published local-store receipt ${receipt.path}`);
    const published = sha256(publishedReceipt);
    expectedCarrier = substituteSinglePinnedDigest(
      expectedCarrier,
      recorded,
      published,
      `${LOCAL_STORE_PUBLICATION_TRANSFORM.carrier}:${receipt.path}`,
    );
  }

  const carrierDigestAtQualification = sha256(carrierAtQualification);
  const expectedCarrierDigest = sha256(expectedCarrier);
  const anchorAtQualification = committedBytes(
    root,
    qualificationCommit,
    LOCAL_STORE_PUBLICATION_TRANSFORM.anchor,
  );
  parseCanonicalPublicationJson(anchorAtQualification, 'qualification-C local-store anchor');
  const expectedAnchor = substituteSinglePinnedDigest(
    anchorAtQualification,
    carrierDigestAtQualification,
    expectedCarrierDigest,
    LOCAL_STORE_PUBLICATION_TRANSFORM.anchor,
  );
  return new Map([
    [LOCAL_STORE_PUBLICATION_TRANSFORM.carrier, expectedCarrier],
    [LOCAL_STORE_PUBLICATION_TRANSFORM.anchor, expectedAnchor],
  ]);
}

export function validateLocalStorePublicationTransform(root, qualificationCommit) {
  for (const [path, expected] of expectedLocalStorePublicationTransform(
    root,
    qualificationCommit,
  )) {
    const actual = readFileSync(join(root, path));
    if (!actual.equals(expected)) {
      fail(`${path} drifted beyond the qualification-C local-store digest transform`);
    }
  }
}

function isSha256(value, nonzero = false) {
  return /^sha256:[0-9a-f]{64}$/u.test(value ?? '')
    && (!nonzero || value !== `sha256:${'0'.repeat(64)}`);
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value ?? {}).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} keys drifted: ${actual.join(',')}`);
  }
}

function missingFacts() {
  const missingFork = () => ({
    egress: 'Missing', promotion: 'Missing', base: 'Missing', isolation: 'Missing',
  });
  return {
    envelope: {
      ordinaryMutation: { hostPlan: 'Missing', ibexBuffered: 'Missing' },
      hostChildMutation: { hostPlan: 'Missing', ibexBuffered: 'Missing' },
      migration: 'Missing', durableBackgroundWork: 'Missing', push: 'Missing', auth: 'Missing',
    },
    explanation: { scopedFacts: [] },
    forks: { inApp: missingFork(), derivedDeployment: missingFork() },
    diff: { data: 'Missing', effects: 'Missing' },
    history: 'Missing',
    proof: 'Missing',
    replay: { handlers: 'Missing', actions: 'Missing' },
    schemaEvolution: 'Missing',
    resourceBounds: 'Missing',
    aggregate: { core: 'Missing', history: 'Missing' },
  };
}

function ownerFact(profile) {
  return {
    scope: {
      logicalLane: 'ordinaryMutation',
      adapter: 'hostPlan',
      access: 'publicCurrentPolicy',
      profile,
    },
    class: { detail: 'BoundedFacts', retention: 'PolicyBounded' },
  };
}

export function exactCandidate(id) {
  const facts = missingFacts();
  if (id === 'agent_safe_storage_v1') {
    facts.envelope.ordinaryMutation = { hostPlan: 'Covered', ibexBuffered: 'Covered' };
    facts.envelope.hostChildMutation = { hostPlan: 'Covered', ibexBuffered: 'Covered' };
    facts.explanation.scopedFacts = [
      ownerFact('generatedOwnedCrudOwnerCreateV1'),
      ownerFact('generatedOwnedCrudOwnerUpdateV1'),
    ];
    return facts;
  }
  if (id === 'agent_safe_derived_deployment_fork_v1') {
    facts.forks.derivedDeployment = {
      egress: 'denyAll',
      promotion: 'notPromotable',
      base: 'currentHead',
      isolation: 'hostMediated',
    };
    return facts;
  }
  fail(`unknown candidate id ${id}`);
}

function updateTreeDigest(hash, { mode, type, path, bytes }) {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(mode);
  hash.update(Buffer.from([0]));
  hash.update(type);
  hash.update(Buffer.from([0]));
  hash.update(path);
  hash.update(Buffer.from([0]));
  hash.update(length);
  hash.update(bytes);
}

function parseTreeEntries(bytes, label) {
  return bytes.toString('utf8').split('\0').filter(Boolean).map((record) => {
    const separator = record.indexOf('\t');
    const match = /^([0-9]{6}) (blob|commit) ([0-9a-f]{40,64})$/u.exec(
      record.slice(0, separator),
    );
    if (separator < 0 || match === null) fail(`${label} emitted an invalid Git tree entry`);
    return {
      mode: match[1],
      type: match[2],
      oid: match[3],
      path: record.slice(separator + 1),
    };
  });
}

function committedTreeEntryBytes(root, entry) {
  if (entry.type === 'blob') {
    return execFileSync('git', ['cat-file', 'blob', entry.oid], {
      cwd: root,
      maxBuffer: 32 * 1024 * 1024,
    });
  }
  if (entry.type === 'commit' && entry.mode === '160000') return Buffer.from(entry.oid);
  fail(`implementation tree entry ${entry.path} has unsupported ${entry.mode} ${entry.type}`);
}

function assertScopePathsExist(entries, scope, label) {
  if (scope === undefined) return;
  for (const path of scope.files) {
    if (!entries.some((entry) => entry.path === path)) {
      fail(`${label} does not contain scoped file ${path}`);
    }
  }
  for (const rootPath of scope.roots) {
    if (!entries.some((entry) => entry.path.startsWith(`${rootPath}/`))) {
      fail(`${label} does not contain scoped root ${rootPath}`);
    }
  }
}

function implementationEntriesAt(root, commit, scope = undefined) {
  if (scope !== undefined) {
    validateImplementationScope(scope);
    const entries = parseTreeEntries(execFileSync('git', [
      'ls-tree', '-r', '-z', commit, '--', ...implementationScopePaths(scope),
    ], { cwd: root }), `implementation tree at ${commit}`)
      .filter(({ path }) => !PUBLICATION_CYCLE_ALLOWLIST.has(path))
      .sort((left, right) => codePointOrder(left.path, right.path));
    assertScopePathsExist(entries, scope, `implementation tree at ${commit}`);
    if (entries.length === 0) fail(`implementation tree at ${commit} is empty`);
    return entries;
  }
  const entries = parseTreeEntries(execFileSync('git', [
    'ls-tree', '-r', '-z', commit, '--', ...IMPLEMENTATION_ROOTS,
  ], { cwd: root }), `implementation tree at ${commit}`)
    .filter(({ path }) => !PUBLICATION_CYCLE_ALLOWLIST.has(path));
  const ibexEntries = parseTreeEntries(execFileSync('git', [
    'ls-tree', '-z', commit, '--', 'vendor/ibex',
  ], { cwd: root }), `vendor/ibex tree at ${commit}`);
  if (ibexEntries.length !== 1
      || ibexEntries[0].path !== 'vendor/ibex'
      || ibexEntries[0].mode !== '160000'
      || ibexEntries[0].type !== 'commit') {
    fail(`implementation tree at ${commit} does not contain vendor/ibex as a gitlink`);
  }
  return [...entries, ibexEntries[0]].sort((left, right) => (
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  ));
}

function implementationDigestVersionForScope(scope) {
  return scope === undefined
    ? IMPLEMENTATION_DIGEST_VERSION
    : SCOPED_IMPLEMENTATION_DIGEST_VERSION;
}

function beginImplementationDigest(scope) {
  const hash = createHash('sha256');
  hash.update(`${implementationDigestVersionForScope(scope)}\n`);
  if (scope !== undefined) hash.update(`scope:${JSON.stringify(scope)}\n`);
  return hash;
}

export function implementationDigestAt(root, commit, scope = undefined) {
  const entries = implementationEntriesAt(root, commit, scope);
  if (entries.length === 0) fail(`implementation tree at ${commit} is empty`);
  const hash = beginImplementationDigest(scope);
  for (const entry of entries) {
    updateTreeDigest(hash, { ...entry, bytes: committedTreeEntryBytes(root, entry) });
  }
  return `sha256:${hash.digest('hex')}`;
}

function assertImplementationDigestVersion(version, label, scope = undefined) {
  const expected = implementationDigestVersionForScope(scope);
  if (version !== expected) {
    const presented = version ?? 'missing';
    const legacy = presented === LEGACY_IMPLEMENTATION_DIGEST_VERSION ? 'v1-era' : 'unsupported';
    fail(`${label} presents ${legacy} implementation digest version ${presented}; `
      + `re-qualification with ${expected} is required`);
  }
}

// @ref LLP 0162#source-owned-publication-carrier-amendment--2026-08-04
// Qualification custody covers the implementation digest's exact leaf scope,
// not unrelated repository history that happens to land between C and P. The
// receipt must name the committed implementation at C as well as the tree at P.
export function assertQualifiedImplementationDigestAtPublication(root, {
  capabilityId,
  qualificationCommit,
  publicationCommit,
  expectedDigest,
  expectedDigestVersion,
  implementationScope = undefined,
  publicationImplementationScope = implementationScope,
  allowRequalificationDue = false,
  publicationCycleEvolutionPaths = [],
}) {
  assertImplementationDigestVersion(expectedDigestVersion, capabilityId, implementationScope);
  const qualificationDigest = implementationDigestAt(
    root,
    qualificationCommit,
    implementationScope,
  );
  // @ref LLP 0276#phases — C's digest remains bound to C's exact scope bytes,
  // while P and the checked-out tree use the canonical scope for their path
  // epoch. A crate relocation is still a scoped change and therefore remains
  // explicitly requalification-due; it cannot make a deleted historical path
  // impossible to inspect at P.
  const publicationDigest = implementationDigestAt(
    root,
    publicationCommit,
    publicationImplementationScope,
  );
  const snapshot = evaluateClaimSnapshot(root, {
    qualificationCommit,
    publicationCommit,
    scope: implementationScope,
    allowRequalificationDue,
    publicationCycleEvolutionPaths,
  });
  const publicationEvolutionIsDue = publicationDigest !== expectedDigest
    && snapshot.requalificationDue !== undefined;
  if (qualificationDigest !== expectedDigest
      || (publicationDigest !== expectedDigest && !publicationEvolutionIsDue)) {
    const changedPaths = snapshot.scopedChanges.length > 0
      ? snapshot.scopedChanges.map(({ status, path }) => `${status}:${path}`).join(',')
      : 'none detected between C and P (receipt or digest scope is inconsistent)';
    fail([
      `${capabilityId} qualified implementation digest mismatch`,
      `scoped surface changed without requalification: ${changedPaths}`,
      `in-scope paths drifted: ${changedPaths}`,
      `receipt ${expectedDigest}`,
      `qualification C ${qualificationDigest}`,
      `publication P ${publicationDigest}`,
    ].join('; '));
  }
  return publicationDigest;
}

function checkedOutImplementationGitlink(root) {
  const expected = git(root, ['rev-parse', 'HEAD:vendor/ibex']);
  const actual = git(root, ['-C', 'vendor/ibex', 'rev-parse', 'HEAD']);
  const rootStatus = git(root, [
    'status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none',
  ]);
  const ibexStatus = git(root, [
    '-C', 'vendor/ibex', 'status', '--porcelain', '--untracked-files=all',
  ]);
  if (actual !== expected || rootStatus !== '' || ibexStatus !== '') {
    fail('publication worktree or checked-out vendor/ibex is dirty/mismatched');
  }
  return actual;
}

export function implementationDigestWorkingTree(root, scope = undefined) {
  if (scope !== undefined) validateImplementationScope(scope);
  const checkedOutIbex = checkedOutImplementationGitlink(root);
  const entries = execFileSync('git', [
    'ls-files', '--stage', '-z', '--', ...implementationScopePaths(scope),
  ], { cwd: root }).toString('utf8').split('\0').filter(Boolean).map((record) => {
    const separator = record.indexOf('\t');
    const match = /^([0-9]{6}) ([0-9a-f]{40,64}) 0$/u.exec(record.slice(0, separator));
    if (separator < 0 || match === null) fail('implementation index emitted an invalid entry');
    const mode = match[1];
    return {
      mode,
      type: mode === '160000' ? 'commit' : 'blob',
      oid: match[2],
      path: record.slice(separator + 1),
    };
  }).filter(({ path }) => path !== 'vendor/ibex' && !PUBLICATION_CYCLE_ALLOWLIST.has(path));
  if (implementationScopeCoversPath(scope, 'vendor/ibex')) {
    entries.push({
      mode: '160000',
      type: 'commit',
      oid: checkedOutIbex,
      path: 'vendor/ibex',
    });
  }
  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  assertScopePathsExist(entries, scope, 'implementation working tree');
  const hash = beginImplementationDigest(scope);
  for (const entry of entries) {
    updateTreeDigest(hash, { ...entry, bytes: committedTreeEntryBytes(root, entry) });
  }
  return `sha256:${hash.digest('hex')}`;
}

function evidenceLocatorsFor(record) {
  if (record.id === 'agent_safe_storage_v1') return STORAGE_EVIDENCE;
  if (record.id === 'agent_safe_derived_deployment_fork_v1') {
    return DERIVED_FORK_HISTORICAL_EVIDENCE;
  }
  fail(`unknown publication record ${record.id}`);
}

function validIsoDate(date) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(date ?? '')) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
}

function derivedForkDatedLocatorDate(kind, path) {
  const pattern = DERIVED_FORK_DATED_LOCATOR_PATTERNS[kind];
  const date = pattern?.exec(path ?? '')?.groups?.date;
  return validIsoDate(date) ? date : undefined;
}

function isCurrentDerivedForkDatedEvidencePath(path) {
  return Object.entries(DERIVED_FORK_DATED_LOCATOR_PATTERNS)
    .some(([kind]) => derivedForkDatedLocatorDate(kind, path) !== undefined);
}

function currentDerivedForkLocatorMatches(kind, path, index) {
  if (DERIVED_FORK_DATED_LOCATOR_PATTERNS[kind] !== undefined) {
    return derivedForkDatedLocatorDate(kind, path) !== undefined;
  }
  return path === DERIVED_FORK_HISTORICAL_EVIDENCE[index][1];
}

function validateReceiptShape(root, receipt, record, published) {
  const legacyKeys = [
    'schemaVersion', 'capabilityId', 'qualifiedSourceCommit', 'implementationTreeSha256',
    'candidateFactsSha256', 'qualifiedTargetProfileId', 'negativeTargetProfileIds',
    'negativeBuildDistributions', 'qualifiedComponents', 'evidence',
  ];
  const currentKeys = [...legacyKeys, 'implementationDigestVersion'];
  const scopedKeys = [...currentKeys, 'implementationScope'];
  const derivedScopedKeys = [...scopedKeys, 'selectionPolicySha256'];
  if (receipt.schemaVersion === 'snapback.agent-safe-publication-receipt.v1') {
    exactKeys(receipt, legacyKeys, `${record.id} receipt`);
    if (published) {
      fail(`${record.id} receipt uses the stale v1 implementation digest contract; `
        + `re-qualification with ${SCOPED_IMPLEMENTATION_DIGEST_VERSION} is required`);
    }
  } else if (receipt.schemaVersion === 'snapback.agent-safe-publication-receipt.v2') {
    exactKeys(receipt, currentKeys, `${record.id} receipt`);
    assertImplementationDigestVersion(receipt.implementationDigestVersion, `${record.id} receipt`);
    if (published) {
      fail(`${record.id} receipt uses the ambient v2 implementation digest contract; `
        + `re-qualification with ${SCOPED_IMPLEMENTATION_DIGEST_VERSION} is required`);
    }
  } else if (receipt.schemaVersion === 'snapback.agent-safe-publication-receipt.v3') {
    exactKeys(
      receipt,
      record.id === 'agent_safe_derived_deployment_fork_v1'
        ? derivedScopedKeys
        : scopedKeys,
      `${record.id} receipt`,
    );
    validateImplementationScope(receipt.implementationScope, `${record.id} receipt scope`);
    if (record.id === 'agent_safe_derived_deployment_fork_v1'
        && !canonicallyEqual(
          receipt.implementationScope,
          derivedForkImplementationScopeAt(root, receipt.qualifiedSourceCommit),
        )) {
      fail(`${record.id} receipt scope does not equal the canonical derived-fork scope`);
    }
    if (record.id === 'agent_safe_derived_deployment_fork_v1'
        && !isSha256(receipt.selectionPolicySha256, true)) {
      fail(`${record.id} receipt selection policy digest is invalid`);
    }
    assertImplementationDigestVersion(
      receipt.implementationDigestVersion,
      `${record.id} receipt`,
      receipt.implementationScope,
    );
  } else {
    fail(`${record.id} receipt schema is stale or unsupported`);
  }
  if (receipt.capabilityId !== record.id
      || receipt.qualifiedTargetProfileId !== 'local-dev-sqlite-ibex'
      || JSON.stringify(receipt.negativeTargetProfileIds)
        !== JSON.stringify(['cloudflare-do-sqlite-v8', 'remote-service-sqlite-ibex'])
      || JSON.stringify(receipt.negativeBuildDistributions) !== JSON.stringify(['public-package'])) {
    fail(`${record.id} receipt target/distribution facts drifted`);
  }
  const evidenceLocators = evidenceLocatorsFor(record);
  if (!Array.isArray(receipt.evidence) || receipt.evidence.length !== evidenceLocators.length) {
    fail(`${record.id} evidence count drifted`);
  }
  receipt.evidence.forEach((binding, index) => {
    exactKeys(binding, ['kind', 'path', 'sha256'], `${record.id} evidence ${index}`);
    const [kind, path] = evidenceLocators[index];
    const currentDerivedLocator = record.id === 'agent_safe_derived_deployment_fork_v1'
      && receipt.schemaVersion === 'snapback.agent-safe-publication-receipt.v3';
    const locatorMatches = currentDerivedLocator
      ? currentDerivedForkLocatorMatches(kind, binding.path, index)
      : binding.path === path;
    if (binding.kind !== kind || !locatorMatches || !isSha256(binding.sha256, published)) {
      fail(`${record.id} evidence ${index} drifted`);
    }
  });
}

function implementationScopeForReceipt(receipt) {
  return receipt.schemaVersion === 'snapback.agent-safe-publication-receipt.v3'
    ? receipt.implementationScope
    : undefined;
}

function requireEvidence(condition, message) {
  if (!condition) fail(`published evidence: ${message}`);
}

function validateCurrentDerivedForkEvidenceDates(root, receipt, commit) {
  const commitDate = git(root, ['show', '-s', '--format=%cs', commit]);
  requireEvidence(validIsoDate(commitDate), 'qualification C commit date is invalid');
  for (const kind of Object.keys(DERIVED_FORK_DATED_LOCATOR_PATTERNS)) {
    const binding = receipt.evidence.find((candidate) => candidate.kind === kind);
    const locatorDate = derivedForkDatedLocatorDate(kind, binding?.path);
    requireEvidence(locatorDate !== undefined,
      `${kind} does not use its required dated append-only locator`);
    requireEvidence(locatorDate >= commitDate,
      `${kind} locator date ${locatorDate} predates qualification C commit date ${commitDate}`);
    requireEvidence(git(root, ['ls-tree', '--name-only', commit, '--', binding.path]) === '',
      `${kind} locator already existed at qualification C; dated evidence is append-only`);
  }
}

// @ref LLP 0162#source-owned-publication-carrier-amendment--2026-08-04
// Invariant: no publication-chain JSON is ever read non-canonically. This is one closed
// parser boundary for anchors, carriers, receipts, acceptances, evidence,
// benches, and verdict histories; callers may not fall back to bare JSON.parse.
function parseCanonicalPublicationJson(bytes, label) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes;
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
  if (text !== `${JSON.stringify(value, null, 2)}\n`) {
    fail(`${label} is not canonical JSON`);
  }
  return value;
}

function readCanonicalPublicationJson(root, path, label) {
  return parseCanonicalPublicationJson(readFileSync(join(root, path), 'utf8'), label);
}

function closeNumber(left, right) {
  return Number.isFinite(left) && Number.isFinite(right)
    && Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
}

function requireClose(left, right, label) {
  requireEvidence(closeNumber(left, right), `${label} disagrees with retained raw observations`);
}

function requireCloseArray(actual, expected, label) {
  requireEvidence(Array.isArray(actual) && actual.length === expected.length,
    `${label} population drifted`);
  actual.forEach((value, index) => requireClose(value, expected[index], `${label}[${index}]`));
}

function upperMedian(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function bootstrapMedianInterval(values) {
  let state = 0x7e57016220260804n;
  const mask = (1n << 64n) - 1n;
  const estimates = [];
  for (let sampleIndex = 0; sampleIndex < 20_000; sampleIndex += 1) {
    const sample = [];
    for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
      state = (state * 6364136223846793005n + 1442695040888963407n) & mask;
      sample.push(values[Number(state % BigInt(values.length))]);
    }
    estimates.push(upperMedian(sample));
  }
  estimates.sort((left, right) => left - right);
  return [estimates[1_000], estimates[19_000]];
}

const PAIRED_METRICS = [
  ['currentPointReadP50Us', 'current_point_read_p50_us', 'higherIsWorse', 'twoSidedEquivalence', 5, 'latency'],
  ['currentPointReadP95Us', 'current_point_read_p95_us', 'higherIsWorse', 'twoSidedEquivalence', 5, 'latency'],
  ['currentRangeReadP50Us', 'current_range_read_p50_us', 'higherIsWorse', 'twoSidedEquivalence', 5, 'latency'],
  ['currentRangeReadP95Us', 'current_range_read_p95_us', 'higherIsWorse', 'twoSidedEquivalence', 5, 'latency'],
  ['currentQueryPlanReadP50Us', 'current_query_plan_read_p50_us', 'higherIsWorse', 'twoSidedEquivalence', 5, 'latency'],
  ['currentQueryPlanReadP95Us', 'current_query_plan_read_p95_us', 'higherIsWorse', 'twoSidedEquivalence', 5, 'latency'],
  ['singleWriterMutationsPerSec', 'single_writer_mutations_per_sec', 'lowerIsWorse', 'oneSidedRegression', 15, 'throughput'],
  ['singleWriterMutationP50Us', 'single_writer_mutation_p50_us', 'higherIsWorse', 'oneSidedRegression', 15, 'latency'],
  ['singleWriterMutationP95Us', 'single_writer_mutation_p95_us', 'higherIsWorse', 'oneSidedRegression', 15, 'latency'],
];

const BYTE_METRICS = [
  ['allocatedWriteBytesPerChangedRow', 'allocated_write_bytes_per_changed_row'],
  ['allocatedWriteBytesPerOperation', 'allocated_write_bytes_per_operation'],
  ['retainedBytesPerChangedRow', 'retained_bytes_per_changed_row'],
  ['retainedBytesPerOperation', 'retained_bytes_per_operation'],
];

const PAIRED_PROTOCOL = Object.freeze({
  warmupsPerExecutable: 1,
  recordedPairs: 11,
  rawSubpairsPerRecordedPair: 3,
  pairOrder: 'even zero-based outer pairs AB/BA/AB; odd zero-based outer pairs BA/AB/BA',
  estimator: 'compute each raw subpair regression, take the median of three within each of 11 outer pairs, then take the median of the 11 outer values',
  confidenceInterval: 'deterministic bootstrap 90% interval over 11 outer median-of-three regressions; interval must lie wholly inside the registered bound',
  bootstrapSamples: 20_000,
  bootstrapSeed: 'snapback-agent-safe-active-paired-v2/2026-08-04',
  quiescenceRule: 'direct release binary refuses unless no cargo or rustc process exists',
  baselineWorkerProtocol: 'external digest-bound wrapper and lockfile path-linked to the exact pre-profile tree; original baseline product posture remains exactly three instrumentation paths',
  candidateWorkerProtocol: 'same release executable: --active-covered-worker records active-covered read/write metrics; a fresh --active-covered-idle-worker first runs the dormant comparator workload, then holds the armed storage connection and server-issued range across the five-second idle observation',
});

function expectedSubpairOrders(pairIndex) {
  return pairIndex % 2 === 0
    ? ['baselineThenCandidate', 'candidateThenBaseline', 'baselineThenCandidate']
    : ['candidateThenBaseline', 'baselineThenCandidate', 'candidateThenBaseline'];
}

function validatePairedRawPopulation(value) {
  requireEvidence(Array.isArray(value.rawPairs) && value.rawPairs.length === 11,
    'paired raw observation population drifted');
  value.rawPairs.forEach((pair, pairIndex) => {
    const orders = expectedSubpairOrders(pairIndex);
    const orderSequence = pairIndex % 2 === 0 ? 'AB/BA/AB' : 'BA/AB/BA';
    requireEvidence(pair.pair === pairIndex + 1 && pair.orderSequence === orderSequence,
      `paired raw observation ${pairIndex + 1} order drifted`);
    requireEvidence(Array.isArray(pair.rawSubpairs) && pair.rawSubpairs.length === 3,
      `paired raw observation ${pairIndex + 1} subpair population drifted`);
    pair.rawSubpairs.forEach((subpair, subpairIndex) => {
      requireEvidence(subpair.subpair === subpairIndex + 1
        && subpair.order === orders[subpairIndex],
      `paired raw observation ${pairIndex + 1} subpair ${subpairIndex + 1} order drifted`);
      requireEvidence(
        subpair.baselineWorkerProtocol === 'agentSafeDormantBaselineWorkerV1'
          && subpair.candidateActiveCoveredWorkerProtocol
            === 'agentSafeActiveCoveredWorkerV3',
        `paired raw observation ${pairIndex + 1} subpair ${subpairIndex + 1} worker protocol drifted`,
      );
    });
  });
}

function validatePairedComparisons(value) {
  validatePairedRawPopulation(value);
  requireEvidence(Array.isArray(value.comparisons)
    && value.comparisons.length === PAIRED_METRICS.length,
  'paired comparison vocabulary drifted');
  PAIRED_METRICS.forEach(([
    metric, rawMetric, direction, boundKind, boundPercent, mode,
  ], index) => {
    const comparison = value.comparisons[index];
    requireEvidence(comparison.metric === metric
      && comparison.direction === direction
      && comparison.boundKind === boundKind
      && comparison.boundPercent === boundPercent,
    `paired comparison ${metric} identity/bound drifted`);
    const regressions = value.rawPairs.map((pair) => {
      const subpairRegressions = pair.rawSubpairs.map((subpair) => {
        const baseline = subpair.baseline?.[rawMetric];
        const candidate = subpair.candidateActiveCovered?.[rawMetric];
        requireEvidence(Number.isFinite(baseline) && baseline > 0
          && Number.isFinite(candidate) && candidate > 0,
        `paired raw metric ${metric} is invalid`);
        return mode === 'throughput'
          ? 100 * (1 - candidate / baseline)
          : 100 * (candidate / baseline - 1);
      });
      return upperMedian(subpairRegressions);
    });
    const [lower, upper] = bootstrapMedianInterval(regressions);
    const passed = boundKind === 'twoSidedEquivalence'
      ? lower >= -boundPercent && upper <= boundPercent
      : upper <= boundPercent;
    requireCloseArray(comparison.pairedRegressionsPercent, regressions,
      `${metric} paired regressions`);
    requireClose(comparison.pairedMedianRegressionPercent, upperMedian(regressions),
      `${metric} paired median`);
    requireClose(comparison.bootstrap90PercentLower, lower, `${metric} bootstrap lower`);
    requireClose(comparison.bootstrap90PercentUpper, upper, `${metric} bootstrap upper`);
    requireEvidence(comparison.passed === passed && passed,
      `${metric} registered threshold failed`);
  });

  requireEvidence(Array.isArray(value.byteComparisons)
    && value.byteComparisons.length === BYTE_METRICS.length,
  'paired byte observation vocabulary drifted');
  BYTE_METRICS.forEach(([metric, rawMetric], index) => {
    const comparison = value.byteComparisons[index];
    const baseline = value.rawPairs.map((pair) => upperMedian(
      pair.rawSubpairs.map((subpair) => subpair.baseline?.[rawMetric]),
    ));
    const candidate = value.rawPairs.map((pair) => upperMedian(
      pair.rawSubpairs.map((subpair) => subpair.candidateActiveCovered?.[rawMetric]),
    ));
    const rawBaseline = value.rawPairs.flatMap((pair) => (
      pair.rawSubpairs.map((subpair) => subpair.baseline?.[rawMetric])
    ));
    const rawCandidate = value.rawPairs.flatMap((pair) => (
      pair.rawSubpairs.map((subpair) => subpair.candidateActiveCovered?.[rawMetric])
    ));
    requireEvidence(comparison.metric === metric
      && comparison.thresholdStatus
        === 'observed; LLP 0162 registers the metric but no numeric byte bound'
      && rawBaseline.every((number) => Number.isSafeInteger(number) && number >= 0)
      && rawCandidate.every((number) => Number.isSafeInteger(number) && number >= 0),
    `${metric} byte observation identity/value drifted`);
    requireEvidence(JSON.stringify(comparison.baselineValues) === JSON.stringify(baseline)
      && JSON.stringify(comparison.candidateActiveCoveredValues) === JSON.stringify(candidate),
    `${metric} byte observations disagree with raw pairs`);
    requireEvidence(comparison.baselineMedian === upperMedian(baseline)
      && comparison.candidateActiveCoveredMedian === upperMedian(candidate),
    `${metric} byte median drifted`);
    const change = baseline.map((base, pairIndex) => (base > 0
      ? 100 * (candidate[pairIndex] / base - 1)
      : null));
    requireEvidence(Array.isArray(comparison.pairedChangePercent)
      && comparison.pairedChangePercent.length === change.length,
    `${metric} paired change population drifted`);
    comparison.pairedChangePercent.forEach((actual, pairIndex) => {
      if (change[pairIndex] === null) {
        requireEvidence(actual === null, `${metric} zero-baseline change must be null`);
      } else {
        requireClose(actual, change[pairIndex], `${metric} paired change ${pairIndex}`);
      }
    });
  });
}

function validatePairedIdle(value) {
  const baselineCpu = [];
  const candidateCpu = [];
  const baselineRss = [];
  const candidateRss = [];
  const outputBlocks = [];
  const databaseDeltas = [];
  const rssRegressions = [];
  for (const pair of value.rawPairs) {
    const pairBaselineRss = [];
    const pairCandidateRss = [];
    const pairRssRegressions = [];
    for (const subpair of pair.rawSubpairs) {
      const baseline = subpair.baselineIdle;
      const candidate = subpair.candidateActiveCoveredIdle;
      requireEvidence(baseline?.durationMs === 5_000 && candidate?.durationMs === 5_000,
        'paired idle duration drifted');
      for (const [label, observation] of [['baseline', baseline], ['candidate', candidate]]) {
        const counters = [
          observation.cpuUserUs,
          observation.cpuSystemUs,
          observation.outputBlockOperations,
          observation.databaseFamilyBytesBefore,
          observation.databaseFamilyBytesAfter,
        ];
        requireEvidence(counters.every((number) => Number.isSafeInteger(number) && number >= 0)
          && Number.isSafeInteger(observation.cpuUserUs + observation.cpuSystemUs)
          && Number.isSafeInteger(
            observation.databaseFamilyBytesAfter - observation.databaseFamilyBytesBefore,
          ),
        `paired ${label} idle counters are invalid`);
        requireEvidence(Number.isFinite(observation.residentKbBefore)
          && observation.residentKbBefore > 0
          && Number.isFinite(observation.residentKbAfter)
          && observation.residentKbAfter > 0,
        `paired ${label} idle RSS observations are invalid`);
      }
      baselineCpu.push(baseline.cpuUserUs + baseline.cpuSystemUs);
      candidateCpu.push(candidate.cpuUserUs + candidate.cpuSystemUs);
      pairBaselineRss.push(baseline.residentKbBefore);
      pairCandidateRss.push(candidate.residentKbBefore);
      pairRssRegressions.push(100 * (candidate.residentKbBefore / baseline.residentKbBefore - 1));
      outputBlocks.push(candidate.outputBlockOperations);
      databaseDeltas.push(candidate.databaseFamilyBytesAfter - candidate.databaseFamilyBytesBefore);
    }
    baselineRss.push(upperMedian(pairBaselineRss));
    candidateRss.push(upperMedian(pairCandidateRss));
    rssRegressions.push(upperMedian(pairRssRegressions));
  }
  const [rssLower, rssUpper] = bootstrapMedianInterval(rssRegressions);
  const cpuMax = Math.max(...candidateCpu);
  const cpuPassed = cpuMax <= 5_000;
  const rssPassed = rssLower >= -5 && rssUpper <= 5;
  const outputZero = outputBlocks.every((number) => number === 0);
  const databaseZero = databaseDeltas.every((number) => number === 0);
  const diskPassed = outputZero && databaseZero;
  const idle = value.idleGates;
  requireEvidence(idle?.durationMs === 5_000 && idle.cpuResolutionUs === 5_000
    && idle.rssEquivalenceBoundPercent === 5,
  'paired idle gate contract drifted');
  requireEvidence(JSON.stringify(idle.baselineCombinedCpuUs) === JSON.stringify(baselineCpu)
    && JSON.stringify(idle.candidateCombinedCpuUs) === JSON.stringify(candidateCpu)
    && JSON.stringify(idle.candidateOutputBlockOperations) === JSON.stringify(outputBlocks)
    && JSON.stringify(idle.candidateDatabaseFamilyByteDeltas) === JSON.stringify(databaseDeltas),
  'paired idle summaries disagree with raw observations');
  requireCloseArray(idle.baselineRssBeforeKb, baselineRss, 'baseline idle RSS');
  requireCloseArray(idle.candidateRssBeforeKb, candidateRss, 'candidate idle RSS');
  requireCloseArray(idle.pairedRssRegressionsPercent, rssRegressions, 'paired idle RSS regressions');
  requireClose(idle.baselineRssMedianKb, upperMedian(baselineRss), 'baseline RSS median');
  requireClose(idle.candidateRssMedianKb, upperMedian(candidateRss), 'candidate RSS median');
  requireClose(idle.pairedRssMedianRegressionPercent, upperMedian(rssRegressions),
    'paired RSS median regression');
  requireClose(idle.bootstrap90PercentLower, rssLower, 'paired RSS bootstrap lower');
  requireClose(idle.bootstrap90PercentUpper, rssUpper, 'paired RSS bootstrap upper');
  requireEvidence(idle.candidateCpuMaxObservedUs === cpuMax
    && idle.cpuPassed === cpuPassed
    && idle.rssPassed === rssPassed
    && idle.everyCandidateOutputBlockCountZero === outputZero
    && idle.everyCandidateDatabaseFamilyDeltaZero === databaseZero
    && idle.diskPassed === diskPassed
    && idle.passed === (cpuPassed && rssPassed && diskPassed)
    && idle.passed === true,
  'paired idle gate failed or summary drifted');
}

export function validatePairedPerformanceArtifact(value, commit) {
  requireEvidence(value.schemaVersion === 'snapback.agent-safe-active-paired.v3', 'paired schema drifted');
  requireEvidence(value.artifactName === 'agent-safe-active-covered-paired-2026-08-04', 'paired artifact identity drifted');
  requireEvidence(value.date === '2026-08-04', 'paired date drifted');
  requireEvidence(value.candidate?.sourceRevision === commit, 'paired candidate is not exact C');
  requireEvidence(value.candidate?.sourceTreeClean === true, 'paired candidate was dirty');
  requireEvidence(isSha256(value.candidate?.executableSha256, true),
    'paired candidate executable digest is missing');
  requireEvidence(value.candidate?.buildProfile === 'release', 'paired candidate was not release');
  requireEvidence(
    value.candidate?.activeProfile
      === 'serverIssuedClientRange+ordinaryMutationCoverageV1+productionEnvelopeChokePoint',
    'paired candidate did not exercise the active covered carrier',
  );
  requireEvidence(value.baseline?.artifactName === 'agent-safe-step0-pre-profile-2026-08-03'
    && value.baseline?.artifactSchemaVersion === 'snapback.agent-safe-step0-baseline.v1'
    && value.baseline?.artifactSha256
      === 'sha256:d28d8514f48db3f8a0e4d0c33a1381f12e4ad13eaf6a69187aef9b7fe822ab91'
    && value.baseline?.sourceRevision === '2ab36e28c74c450213b65f17ef81c0d6652ba33a'
    && value.baseline?.buildProvenanceSha256
      === 'sha256:84e288661c3edf5dfaec3690f2fe00335d251d046ac187439ffae37fe9c65991'
    && value.baseline?.sourceRootCargoLockSha256
      === 'sha256:496569d9a3cb87609b6e79974f69126dbaccba53eb71d093f5dcf090fe1a36b1'
    && value.baseline?.externalWorkerCargoLockSha256
      === 'sha256:05bd0af1ed649011354f091e2cd371f38aaf5c229437c6a98b4807c7d0eead3d'
    && value.baseline?.executableSha256
      === 'sha256:b78089dadd8b4966b20eb847d576ed9cd59dbaa96143c81a2c4a8b0a684c0bb8',
  'paired baseline identity/provenance drifted');
  requireEvidence(value.hardwareClass?.os === '26.5.2'
    && value.hardwareClass?.architecture === 'aarch64'
    && value.hardwareClass?.model === 'Mac17,3'
    && value.hardwareClass?.cpu === 'Apple M5'
    && value.hardwareClass?.logicalCpus === 10
    && value.hardwareClass?.memoryBytes === 34_359_738_368,
  'paired hardware class drifted');
  requireEvidence(value.toolchain?.rustc === 'rustc 1.97.0 (2d8144b78 2026-07-07)'
    && value.toolchain?.cargo === 'cargo 1.97.0 (c980f4866 2026-06-30)',
  'paired toolchain drifted');
  requireEvidence(Object.entries(PAIRED_PROTOCOL)
    .every(([key, expected]) => value.protocol?.[key] === expected),
  'paired protocol identity drifted');
  validatePairedComparisons(value);
  validatePairedIdle(value);
  requireEvidence(value.measuredComparativeThresholdsPassed === true
    && value.comparisons.every(({ passed }) => passed === true)
    && value.idleGates.passed === true,
  'paired aggregate threshold failed');
  requireEvidence(value.fullRow13ProtocolQualified === false,
    'paired artifact must defer full row 13 to composed evidence');
}

function validatePairedPerformance(root, commit) {
  const path = STORAGE_EVIDENCE[1][1];
  validatePairedPerformanceArtifact(
    readCanonicalPublicationJson(root, path, 'paired performance'),
    commit,
  );
}

function statistics(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const median = upperMedian(sorted);
  return {
    median,
    mad: upperMedian(sorted.map((value) => Math.abs(value - median))),
    min: sorted[0],
    max: sorted.at(-1),
  };
}

function nearestRank(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(quantile * sorted.length);
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))];
}

export function validateAbsolutePerformanceArtifact(value, commit) {
  requireEvidence(value.schemaVersion === 'snapback.fork-promotion-performance.v3', 'absolute schema drifted');
  requireEvidence(value.artifactName === 'agent-safe-fork-promotion-absolute-2026-08-04', 'absolute artifact identity drifted');
  requireEvidence(value.date === '2026-08-04', 'absolute date drifted');
  requireEvidence(value.sourceRevision === commit && value.sourceTreeClean === true,
    'absolute candidate is not exact clean C');
  requireEvidence(
    value.baselineArtifact?.sha256
      === 'sha256:d28d8514f48db3f8a0e4d0c33a1381f12e4ad13eaf6a69187aef9b7fe822ab91',
    'absolute baseline digest drifted',
  );
  requireEvidence(value.hardwareClass?.model === 'Mac17,3'
    && value.hardwareClass?.cpu === 'Apple M5'
    && value.hardwareClass?.logicalCpus === 10
    && value.hardwareClass?.memoryBytes === 34_359_738_368,
  'absolute hardware class drifted');
  requireEvidence(value.fixture?.logicalRows === 512
    && value.fixture?.wholeRunWarmups === 1
    && value.fixture?.perMetricWarmups === 4
    && value.fixture?.recordedRuns === 11
    && value.fixture?.contentionSamples === 128
    && value.fixture?.contentionWorkers === 8,
  'absolute fixture/protocol population drifted');
  requireEvidence(Array.isArray(value.rawRuns) && value.rawRuns.length === 11,
    'absolute raw-run population drifted');
  for (const [summaryName, rawName] of [
    ['forkCreation', 'forkCreationUs'],
    ['exactDiff', 'exactDiffUs'],
    ['promotion', 'promotionUs'],
    ['ttlReap', 'ttlReapUs'],
  ]) {
    const raw = value.rawRuns.map((run) => run[rawName]);
    requireEvidence(raw.every((number) => Number.isFinite(number) && number >= 0),
      `absolute ${summaryName} raw observations are invalid`);
    const computed = statistics(raw);
    for (const key of ['median', 'mad', 'min', 'max']) {
      requireClose(value.summaryUs?.[summaryName]?.[key], computed[key],
        `absolute ${summaryName} ${key}`);
    }
  }
  requireEvidence(value.absoluteBounds?.forkCreationMedianUs === 1_000
    && value.absoluteBounds?.exactDiffMedianUs === 2_500
    && value.absoluteBounds?.promotionMedianUs === 7_500
    && value.absoluteBounds?.ttlReapMedianUs === 250
    && value.absoluteBounds?.ordinaryWriterContentionP99Us === 1_250_000,
  'absolute author-ratified bounds drifted');
  const samples = value.contention?.rawRequestToCommitUs;
  requireEvidence(value.contention?.metric === 'ordinaryWriterReservationRequestToCommitP99Us'
    && value.contention?.reservationIntervalMs === 1_000
    && value.contention?.maximumPromotionCommitDurationMs === 500
    && Array.isArray(samples) && samples.length === 128
    && samples.every((number) => Number.isFinite(number) && number >= 0)
    && value.contention.initialDeferredWorkerCount === 8
    && value.contention.deferredSampleCount > 0,
  'active-carrier contention contract/population drifted');
  for (const [key, quantile] of [['p50Us', 0.5], ['p95Us', 0.95], ['p99Us', 0.99]]) {
    requireClose(value.contention[key], nearestRank(samples, quantile), `contention ${key}`);
  }
  requireClose(value.contention.maxUs, Math.max(...samples), 'contention max');
  const boundsPassed = value.summaryUs.forkCreation.median <= 1_000
    && value.summaryUs.exactDiff.median <= 2_500
    && value.summaryUs.promotion.median <= 7_500
    && value.summaryUs.ttlReap.median <= 250
    && value.contention.p99Us <= 1_250_000;
  requireEvidence(value.absoluteBoundsPassed === boundsPassed && boundsPassed,
    'absolute operation/contention bound failed or summary drifted');
  requireEvidence(value.promotionEgressScope
    === 'DenyAll/no-effects only; CaptureOnly intent publication and settlement are not measured',
  'absolute artifact widened its egress scope');
}

function validateAbsolutePerformance(root, commit) {
  const path = STORAGE_EVIDENCE[2][1];
  const value = readCanonicalPublicationJson(root, path, 'absolute performance');
  validateAbsolutePerformanceArtifact(value, commit);
}

function validateAcceptanceCorpus(root, commit, implementationTree) {
  const path = STORAGE_EVIDENCE[0][1];
  const value = readCanonicalPublicationJson(root, path, 'acceptance corpus');
  requireEvidence(value.schemaVersion === 'snapback.agent-safe-storage-acceptance-corpus.v1',
    'acceptance corpus schema drifted');
  requireEvidence(value.date === '2026-08-04'
    && value.qualifiedSourceCommit === commit
    && value.implementationTreeSha256 === implementationTree
    && value.qualifiedTargetProfileId === 'local-dev-sqlite-ibex',
  'acceptance corpus source/target identity drifted');
  requireEvidence(JSON.stringify(value.qualifiedComponents) === JSON.stringify(STORAGE_COMPONENTS),
    'acceptance corpus component scope drifted');
  requireEvidence(Array.isArray(value.acceptanceRows)
    && JSON.stringify(value.acceptanceRows.map(({ row }) => row)) === JSON.stringify([1, 2, 3, 4, 13, 14])
    && value.acceptanceRows.every(({ status }) => status === 'PASS'),
  'acceptance rows 1-4, 13, and 14 did not all pass');
  requireEvidence(value.correctness?.ownCorrectness === 'PASS'
    && value.correctness?.applicableCrashReopen === 'PASS'
    && value.correctness?.routePolicy === 'PASS'
    && value.correctness?.referenceIntegrity === 'PASS'
    && value.correctness?.guide === 'PASS',
  'acceptance own-correctness gates did not all pass');
  requireEvidence(value.performance?.pairedThresholdsPassed === true
    && value.performance?.absoluteBoundsPassed === true
    && value.performance?.activeContentionP99Passed === true
    && value.performance?.composedRow13Passed === true,
  'acceptance performance composition failed');
  for (const key of [
    'aggregates', 'specializedWriters', 'migrationEnvelope', 'inAppFork',
    'derivedDeploymentFork', 'effectSettlement', 'nonLocalTargets', 'publicPackage',
  ]) {
    requireEvidence(value.scope?.[key] === 'Missing', `${key} was not explicitly Missing`);
  }
  requireEvidence(value.overallStatus === 'PASS', 'acceptance corpus overall status is not PASS');
}

function markdownField(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const matches = [...text.matchAll(new RegExp(
    `^\\*\\*${escaped}:\\*\\*\\s+(.+)$`,
    'gmu',
  ))];
  if (matches.length !== 1) return undefined;
  return matches[0][1].replaceAll('`', '').trim();
}

export function validateReview(root, path, family, commit, implementationTree) {
  const text = readFileSync(join(root, path), 'utf8');
  requireEvidence(markdownField(text, 'Reviewer family') === family,
    `${family} review family drifted`);
  requireEvidence(markdownField(text, 'Verdict') === 'READY', `${family} review is not READY`);
  requireEvidence(markdownField(text, 'Reviewed commit') === commit,
    `${family} review did not inspect exact C`);
  requireEvidence(markdownField(text, 'Implementation tree SHA-256') === implementationTree,
    `${family} review implementation digest drifted`);
  requireEvidence(markdownField(text, 'Qualified capability') === 'agent_safe_storage_v1',
    `${family} review qualified the wrong capability`);
  requireEvidence(markdownField(text, 'Qualified components') === STORAGE_COMPONENTS.join(', '),
    `${family} review component scope drifted`);
  requireEvidence(markdownField(text, 'Derived capability') === 'WITHHELD (Missing)',
    `${family} review widened the derived capability`);
  requireEvidence(markdownField(text, 'Broader capability facts') === 'Missing',
    `${family} review widened broader facts`);
  requireEvidence(markdownField(text, 'Reviewed LLPs') === '0158, 0163, 0164, 0165',
    `${family} review did not cover every status transition`);
  requireEvidence(markdownField(text, 'Status recommendation') === 'Accepted',
    `${family} review did not recommend Accepted status`);
  requireEvidence(
    markdownField(text, 'LLP 0158 OQ9 disposition')
      === 'READY (in-document amendment pattern sufficient)',
    `${family} review did not adjudicate LLP 0158 OQ9`,
  );
}

function validateAuthorAcceptance(root, receipt, commit, implementationTree) {
  const path = STORAGE_EVIDENCE[5][1];
  const value = readCanonicalPublicationJson(root, path, 'author acceptance');
  requireEvidence(value.schemaVersion === 'snapback.agent-safe-storage-author-acceptance.v2'
    && value.date === '2026-08-04'
    && value.author === 'Charlie Cheever'
    && value.accepted === true
    && value.authorizationSource === 'explicit-user-instruction-2026-08-04'
    && value.implementationDigestVersion === receipt.implementationDigestVersion,
  'named-author acceptance identity or decision drifted');
  requireEvidence(value.qualifiedSourceCommit === commit
    && value.implementationTreeSha256 === implementationTree
    && value.implementationTreeSha256 === receipt.implementationTreeSha256
    && value.qualifiedCapability === 'agent_safe_storage_v1'
    && JSON.stringify(value.qualifiedComponents) === JSON.stringify(STORAGE_COMPONENTS),
  'author acceptance source or component scope drifted');
  requireEvidence(JSON.stringify(value.acceptedLlps) === JSON.stringify(['0158', '0163', '0164', '0165']),
    'author acceptance LLP scope drifted');
  requireEvidence(value.derivedCapabilityState === 'Missing'
    && value.broaderCapabilityFactsState === 'Missing',
  'author acceptance widened withheld facts');
  const reviewDigests = value.reviewSha256 ?? {};
  requireEvidence(reviewDigests.fable === sha256(readFileSync(join(root, STORAGE_EVIDENCE[3][1])))
    && reviewDigests.codex === sha256(readFileSync(join(root, STORAGE_EVIDENCE[4][1]))),
  'author acceptance did not bind both review bytes');
  const evidenceDigests = value.evidenceSha256 ?? {};
  requireEvidence(evidenceDigests.acceptanceCorpus === sha256(readFileSync(join(root, STORAGE_EVIDENCE[0][1])))
    && evidenceDigests.pairedPerformance === sha256(readFileSync(join(root, STORAGE_EVIDENCE[1][1])))
    && evidenceDigests.absolutePerformance === sha256(readFileSync(join(root, STORAGE_EVIDENCE[2][1]))),
  'author acceptance did not bind the corpus and both performance records');
}

const DERIVED_FORK_BENCH_SCOPE =
  'LLP 0162 row 13, narrow operating.instance-forks claim (author-scoped 2026-08-05)';
const DERIVED_FORK_BENCH_NOTES = [
  'create latency includes server boot, ready handshake, and manifest load — the full product surface',
  'diff spans are 10k journal rows, an order of magnitude under the 100k diff-work bound',
];
const DERIVED_FORK_RATIFIED_BOUNDS = {
  ratifiedBy: 'LLP 0162 author (Charlie), 2026-08-06',
  createColdSmallParentMs: 2_000,
  createColdLargeParent32MiBMs: 3_000,
  createLiveParentMs: 2_000,
  dropMs: 1_000,
  attributedDiff10kRowsMs: 500,
  netDiff10kRowsMs: 750,
  reapSweepMs: 1_000,
  concurrentCreate3WallMs: '<= 3x the sequential create bound',
};
const DERIVED_FORK_STAT_MEASUREMENTS = [
  ['createColdSmallParent', 5, 'createColdSmallParentMs'],
  ['createColdLargeParent32MiB', 3, 'createColdLargeParent32MiBMs'],
  ['createLiveParent', 3, 'createLiveParentMs'],
  ['dropSmall', 5, 'dropMs'],
  ['dropLarge', 3, 'dropMs'],
  ['dropLive', 3, 'dropMs'],
  ['attributedDiff10kRows', 3, 'attributedDiff10kRowsMs'],
  ['netDiff10kRows', 3, 'netDiff10kRowsMs'],
];

function validateDerivedForkRatifiedBounds(value, label) {
  exactKeys(value, Object.keys(DERIVED_FORK_RATIFIED_BOUNDS), `${label} ratifiedBounds`);
  requireEvidence(Object.entries(DERIVED_FORK_RATIFIED_BOUNDS)
    .every(([key, expected]) => value[key] === expected),
  `${label} author-ratified bounds drifted`);
}

export function validateDerivedForkLifecycleBenchArtifact(value, commit, os, arch) {
  const label = `${os}-${arch} fork lifecycle bench`;
  exactKeys(value, [
    'schemaVersion', 'scope', 'environment', 'measurements', 'ratifiedBounds', 'notes',
  ], label);
  requireEvidence(value.schemaVersion === 'snapback.fork-lifecycle-bench.v1'
    && value.scope === DERIVED_FORK_BENCH_SCOPE,
  `${label} identity drifted`);
  exactKeys(value.environment, ['os', 'arch', 'cpus', 'profile', 'commit'], `${label} environment`);
  requireEvidence(value.environment.os === os
    && value.environment.arch === arch
    && Number.isInteger(value.environment.cpus)
    && value.environment.cpus > 0
    && value.environment.profile === 'release'
    && value.environment.commit === commit,
  `${label} environment/qualified commit drifted`);
  validateDerivedForkRatifiedBounds(value.ratifiedBounds, label);
  requireEvidence(JSON.stringify(value.notes) === JSON.stringify(DERIVED_FORK_BENCH_NOTES),
    `${label} notes drifted`);
  exactKeys(value.measurements, [
    ...DERIVED_FORK_STAT_MEASUREMENTS.map(([name]) => name),
    'reapThreeExpiredForks', 'concurrentCreate3WallMs', 'sequentialCreateMedianMs',
  ], `${label} measurements`);
  for (const [name, samples, bound] of DERIVED_FORK_STAT_MEASUREMENTS) {
    const measurement = value.measurements[name];
    exactKeys(measurement, ['samples', 'minMs', 'medianMs', 'maxMs'], `${label} ${name}`);
    requireEvidence(measurement.samples === samples
      && [measurement.minMs, measurement.medianMs, measurement.maxMs]
        .every((number) => Number.isFinite(number) && number >= 0)
      && measurement.minMs <= measurement.medianMs
      && measurement.medianMs <= measurement.maxMs
      && measurement.medianMs <= DERIVED_FORK_RATIFIED_BOUNDS[bound],
    `${label} ${name} median/statistics exceeded or drifted from ratified bounds`);
  }
  const reap = value.measurements.reapThreeExpiredForks;
  exactKeys(reap, ['samples', 'medianMs'], `${label} reapThreeExpiredForks`);
  requireEvidence(reap.samples === 1
    && Number.isFinite(reap.medianMs)
    && reap.medianMs >= 0
    && reap.medianMs <= DERIVED_FORK_RATIFIED_BOUNDS.reapSweepMs,
  `${label} reap median exceeded or drifted from ratified bounds`);
  const concurrent = value.measurements.concurrentCreate3WallMs;
  const sequential = value.measurements.sequentialCreateMedianMs;
  requireEvidence(Number.isFinite(concurrent)
    && concurrent >= 0
    && Number.isFinite(sequential)
    && sequential >= 0
    && sequential === value.measurements.createColdSmallParent.medianMs
    && concurrent <= 3 * DERIVED_FORK_RATIFIED_BOUNDS.createColdSmallParentMs,
  `${label} concurrent-create bound failed`);
}

function validateDerivedForkBoundsRatification(root, commit, receipt) {
  const value = readCanonicalPublicationJson(
    root,
    receipt.evidence[2].path,
    'fork bounds ratification',
  );
  const ratificationCommit = value.environment?.commit;
  requireEvidence(/^[0-9a-f]{40}$/u.test(ratificationCommit ?? ''),
    'fork bounds ratification commit is invalid');
  validateDerivedForkLifecycleBenchArtifact(value, ratificationCommit, 'macos', 'aarch64');
  try {
    git(root, ['merge-base', '--is-ancestor', ratificationCommit, commit]);
  } catch {
    fail('published evidence: fork bounds ratification is not an ancestor of qualification C');
  }
}

// @ref LLP 0162#source-owned-publication-carrier-amendment--2026-08-04 — review authority is a closed,
// digest-bound JSON history. The adjacent Markdown remains required evidence,
// but no heading, table, quotation, or verdict-shaped prose is authoritative.
function legacyReviewEntryCode(entry) {
  if (entry.verdict?.kind === 'forkSpecConformance') {
    return ['llp0163', 'llp0164', 'llp0165']
      .map((key) => entry.verdict[key]?.slice(0, 1))
      .join('');
  }
  if (entry.verdict?.kind === 'derivedForkPublication') {
    return entry.verdict.status?.slice(0, 1);
  }
  return undefined;
}

function isKnownLegacyReviewEntry(verdictPath, entry) {
  const expectedCodes = LEGACY_REVIEW_VERDICT_CODES.get(verdictPath);
  const index = entry.round - 1;
  return entry.proseHistoryBinding === undefined
    && expectedCodes !== undefined
    && entry.reviewedCommit === LEGACY_REVIEW_COMMITS[index]
    && legacyReviewEntryCode(entry) === expectedCodes[index];
}

export function validateDerivedForkReview(root, {
  reviewIndex,
  verdictIndex,
  expectedKind,
  qualificationCommit,
  receipt,
}) {
  const reviewPath = receipt.evidence[reviewIndex].path;
  const verdictPath = receipt.evidence[verdictIndex].path;
  requireEvidence(
    expectedKind === 'forkSpecConformance'
      || expectedKind === 'derivedForkPublication',
    `${verdictPath} expected verdict kind is unrecognized`,
  );
  let reviewBytes;
  try {
    reviewBytes = readFileSync(join(root, reviewPath));
  } catch {
    fail(`published evidence: missing or unreadable review ${reviewPath}`);
  }
  const value = readCanonicalPublicationJson(root, verdictPath, `${reviewPath} verdict contract`);
  exactKeys(value, ['schemaVersion', 'verdicts'], `${verdictPath} contract`);
  requireEvidence(value.schemaVersion === REVIEW_HISTORY_SCHEMA_VERSION
    && Array.isArray(value.verdicts)
    && value.verdicts.length > 0,
  `${verdictPath} contract identity or verdict population drifted; a complete v2 history is required`);

  const currentReviewSha256 = sha256(reviewBytes);
  let previousCommit;
  let previousEntrySha256 = null;
  let declaredFamily;
  let previousFrozenByteLength = 0;
  for (const [index, entry] of value.verdicts.entries()) {
    const legacyCurrentArtifact = isKnownLegacyReviewEntry(verdictPath, entry);
    const entryKeys = [
      'reviewArtifact', 'reviewArtifactSha256', 'family', 'round', 'reviewedCommit',
      'previousEntrySha256', 'verdict',
    ];
    if (!legacyCurrentArtifact) entryKeys.push(
      'proseHistoryBinding',
      'reviewArtifactByteLengthAtRound',
      'reviewArtifactSha256AtRound',
    );
    exactKeys(entry, entryKeys, `${verdictPath} round ${index + 1}`);
    requireEvidence(entry.reviewArtifact === reviewPath
      && entry.reviewArtifactSha256 === currentReviewSha256,
    `${verdictPath} round ${index + 1} does not bind its exact prose artifact`);
    requireEvidence(Number.isSafeInteger(entry.round)
      && entry.round === index + 1,
    `${verdictPath} rounds are missing, duplicated, or non-monotonic`);
    if (!legacyCurrentArtifact) {
      requireEvidence(entry.proseHistoryBinding === 'frozen-per-round',
        `${verdictPath} round ${index + 1} must use frozen-per-round prose history binding`);
      requireEvidence(Number.isSafeInteger(entry.reviewArtifactByteLengthAtRound)
        && entry.reviewArtifactByteLengthAtRound > previousFrozenByteLength
        && entry.reviewArtifactByteLengthAtRound <= reviewBytes.length,
      `${verdictPath} round ${index + 1} frozen prose byte length is invalid or non-monotonic`);
      const frozenBytes = reviewBytes.subarray(0, entry.reviewArtifactByteLengthAtRound);
      requireEvidence(entry.reviewArtifactSha256AtRound === sha256(frozenBytes),
        `${verdictPath} round ${index + 1} frozen prose history digest no longer matches`);
      previousFrozenByteLength = entry.reviewArtifactByteLengthAtRound;
    }
    requireEvidence(entry.family === 'codex' || entry.family === 'fable',
      `${verdictPath} round ${index + 1} reviewer family is unrecognized`);
    declaredFamily ??= entry.family;
    requireEvidence(entry.family === declaredFamily,
      `${verdictPath} reviewer family changed between rounds`);
    requireEvidence(entry.previousEntrySha256 === previousEntrySha256,
      `${verdictPath} round ${entry.round} predecessor digest broke; history was truncated, restarted, or replaced`);
    requireEvidence(/^[0-9a-f]{40}$/u.test(entry.reviewedCommit ?? ''),
      `${verdictPath} round ${entry.round} reviewed commit is invalid`);
    if (index === value.verdicts.length - 1) {
      requireEvidence(entry.reviewedCommit === qualificationCommit,
        `${verdictPath} authoritative verdict does not name qualification C`);
    }
    if (previousCommit !== undefined) {
      try {
        git(root, ['merge-base', '--is-ancestor', previousCommit, entry.reviewedCommit]);
      } catch {
        fail(`published evidence: ${verdictPath} reviewed commits are inconsistent`);
      }
    }
    previousCommit = entry.reviewedCommit;

    if (expectedKind === 'forkSpecConformance') {
      exactKeys(entry.verdict, [
        'kind', 'llp0163', 'llp0164', 'llp0165',
      ], `${verdictPath} round ${entry.round} verdict`);
      requireEvidence(entry.verdict.kind === expectedKind
        && ['READY', 'NOT_READY'].includes(entry.verdict.llp0163)
        && ['READY', 'NOT_READY'].includes(entry.verdict.llp0164)
        && ['READY', 'NOT_READY'].includes(entry.verdict.llp0165),
      `${verdictPath} round ${entry.round} spec verdict is invalid`);
    } else {
      exactKeys(entry.verdict, ['kind', 'status'], `${verdictPath} round ${entry.round} verdict`);
      requireEvidence(entry.verdict.kind === 'derivedForkPublication'
        && ['READY', 'NOT_READY'].includes(entry.verdict.status),
      `${verdictPath} round ${entry.round} publication verdict is invalid`);
    }
    previousEntrySha256 = sha256(Buffer.from(`${JSON.stringify(entry, null, 2)}\n`));
  }

  const authoritative = value.verdicts.at(-1);
  if (authoritative.proseHistoryBinding === 'frozen-per-round') {
    requireEvidence(authoritative.reviewArtifactByteLengthAtRound === reviewBytes.length,
      `${verdictPath} authoritative frozen prose binding does not cover the complete artifact`);
  }
  const ready = expectedKind === 'forkSpecConformance'
    ? ['llp0163', 'llp0164', 'llp0165'].every((key) => (
      authoritative.verdict[key] === 'READY'
    ))
    : authoritative.verdict.status === 'READY';
  return {
    family: authoritative.family,
    headEntrySha256: previousEntrySha256,
    historyKind: receipt.evidence[verdictIndex].kind,
    ready,
    round: authoritative.round,
    roundCount: value.verdicts.length,
    reviewPath,
    verdictPath,
  };
}

function validateDerivedForkAssetEvidence(root, receipt) {
  const path = receipt.evidence[3].path;
  const text = readFileSync(join(root, path), 'utf8');
  requireEvidence(text.startsWith('# LLP 0044 `asset-lifecycle-v1` acceptance evidence (local target)\n')
    && text.includes('<!-- @ref LLP 0044#acceptance'),
  'asset lifecycle evidence identity drifted');
}

function validateDerivedForkAuthorAcceptance(
  root,
  receipt,
  commit,
  implementationTree,
  reviewHistories,
) {
  const path = receipt.evidence.at(-1).path;
  const acceptanceDate = derivedForkDatedLocatorDate('authorAcceptance', path);
  const value = readCanonicalPublicationJson(root, path, 'derived-fork author acceptance');
  exactKeys(value, [
    'schemaVersion', 'capabilityId', 'accepted', 'authorLine', 'qualifiedSourceCommit',
    'implementationDigestVersion', 'implementationTreeSha256', 'candidateFactsSha256',
    'implementationScope', 'selectionPolicySha256', 'residualV2DepartingClass',
    'qualifiedComponents', 'evidenceSha256', 'reviewHistoryHeads',
  ], 'derived-fork author acceptance');
  requireEvidence(value.schemaVersion === 'snapback.derived-fork-author-acceptance.v3'
    && value.capabilityId === 'agent_safe_derived_deployment_fork_v1'
    && value.accepted === true
    && value.authorLine === `Charlie Cheever — accepted ${acceptanceDate}`
    && value.qualifiedSourceCommit === commit
    && value.implementationDigestVersion === receipt.implementationDigestVersion
    && value.implementationTreeSha256 === implementationTree
    && value.implementationTreeSha256 === receipt.implementationTreeSha256
    && value.candidateFactsSha256 === receipt.candidateFactsSha256
    && canonicallyEqual(value.implementationScope, receipt.implementationScope)
    && canonicallyEqual(value.implementationScope, derivedForkImplementationScopeAt(root, commit))
    && value.selectionPolicySha256 === receipt.selectionPolicySha256
    && canonicallyEqual(
      value.residualV2DepartingClass,
      DERIVED_FORK_RESIDUAL_V2_DEPARTING_CLASS,
    )
    && JSON.stringify(value.qualifiedComponents) === JSON.stringify(DERIVED_COMPONENTS),
  'derived-fork named-author/source/component acceptance drifted');
  const nonselfBindings = receipt.evidence.slice(0, -1);
  exactKeys(value.evidenceSha256, nonselfBindings.map(({ kind }) => kind),
    'derived-fork author evidence digests');
  requireEvidence(nonselfBindings.every(({ kind, sha256: digest }) => (
    value.evidenceSha256[kind] === digest
  )), 'derived-fork author acceptance did not bind the exact non-self receipt digest set');
  const expectedHistoryKinds = reviewHistories.map(({ historyKind }) => historyKind);
  exactKeys(value.reviewHistoryHeads, expectedHistoryKinds,
    'derived-fork author-accepted review histories');
  for (const review of reviewHistories) {
    const acceptedHead = value.reviewHistoryHeads[review.historyKind];
    exactKeys(acceptedHead, ['roundCount', 'headEntrySha256'],
      `derived-fork accepted ${review.historyKind} history head`);
    requireEvidence(acceptedHead.roundCount === review.roundCount
      && acceptedHead.headEntrySha256 === review.headEntrySha256,
    `${review.historyKind} history does not match the named-author accepted complete history`);
  }
}

export function validatePublishedDerivedForkEvidenceSemantics(root, record, commit, receipt) {
  requireEvidence(record.id === 'agent_safe_derived_deployment_fork_v1'
    && /^[0-9a-f]{40}$/u.test(commit),
  'derived-fork capability or qualification commit is invalid');
  requireEvidence(JSON.stringify(record.components) === JSON.stringify(DERIVED_COMPONENTS)
    && JSON.stringify(receipt.qualifiedComponents) === JSON.stringify(DERIVED_COMPONENTS),
  'derived-fork qualified component scope drifted');
  const publication = git(root, ['rev-parse', 'HEAD']);
  try {
    git(root, ['merge-base', '--is-ancestor', commit, publication]);
  } catch {
    fail('published evidence: derived-fork qualification commit is not an ancestor of publication HEAD');
  }
  validateCurrentDerivedForkEvidenceDates(root, receipt, commit);
  validateDerivedForkBoundsRatification(root, commit, receipt);
  const macos = readCanonicalPublicationJson(
    root,
    receipt.evidence[0].path,
    'macOS fork lifecycle bench',
  );
  const linux = readCanonicalPublicationJson(
    root,
    receipt.evidence[1].path,
    'Linux fork lifecycle bench',
  );
  validateDerivedForkLifecycleBenchArtifact(macos, commit, 'macos', 'aarch64');
  validateDerivedForkLifecycleBenchArtifact(linux, commit, 'linux', 'x86_64');
  requireEvidence(new Set([
    `${macos.environment.os}/${macos.environment.arch}`,
    `${linux.environment.os}/${linux.environment.arch}`,
  ]).size === 2, 'both distinct release platforms were not present');
  validateDerivedForkAssetEvidence(root, receipt);
  const specCodex = validateDerivedForkReview(root, {
    reviewIndex: 4,
    verdictIndex: 5,
    expectedKind: 'forkSpecConformance',
    qualificationCommit: commit,
    receipt,
  });
  const specFable = validateDerivedForkReview(root, {
    reviewIndex: 6,
    verdictIndex: 7,
    expectedKind: 'forkSpecConformance',
    qualificationCommit: commit,
    receipt,
  });
  const implementationCodex = validateDerivedForkReview(root, {
    reviewIndex: 8,
    verdictIndex: 9,
    expectedKind: 'derivedForkPublication',
    qualificationCommit: commit,
    receipt,
  });
  const implementationFable = validateDerivedForkReview(root, {
    reviewIndex: 10,
    verdictIndex: 11,
    expectedKind: 'derivedForkPublication',
    qualificationCommit: commit,
    receipt,
  });
  requireEvidence(new Set([specCodex.family, specFable.family]).size === 2
    && new Set([implementationCodex.family, implementationFable.family]).size === 2,
  'derived-fork review pairs did not preserve two distinct model families');
  requireEvidence(specCodex.family === 'codex'
    && specFable.family === 'fable'
    && implementationCodex.family === 'codex'
    && implementationFable.family === 'fable'
    && specCodex.family === implementationCodex.family
    && specFable.family === implementationFable.family,
  'derived-fork verdict family did not match its fixed review artifact');
  for (const review of [specCodex, specFable, implementationCodex, implementationFable]) {
    requireEvidence(review.ready, `${review.verdictPath} authoritative verdict is not READY`);
  }
  const implementationTree = implementationDigestAt(
    root,
    commit,
    implementationScopeForReceipt(receipt),
  );
  validateDerivedForkAuthorAcceptance(root, receipt, commit, implementationTree, [
    specCodex,
    specFable,
    implementationCodex,
    implementationFable,
  ]);
}

export function validatePublishedEvidenceSemantics(root, record, commit, receipt = undefined) {
  const boundReceipt = receipt ?? readCanonicalPublicationJson(
    root,
    record.receipt,
    `${record.id} receipt`,
  );
  if (record.id === 'agent_safe_derived_deployment_fork_v1') {
    validatePublishedDerivedForkEvidenceSemantics(root, record, commit, boundReceipt);
    return;
  }
  if (record.id !== 'agent_safe_storage_v1') {
    fail(`${record.id} has no publication evidence contract`);
  }
  const implementationTree = implementationDigestAt(root, commit);
  validatePairedPerformance(root, commit);
  validateAbsolutePerformance(root, commit);
  validateAcceptanceCorpus(root, commit, implementationTree);
  validateReview(root, STORAGE_EVIDENCE[3][1], 'Fable', commit, implementationTree);
  validateReview(root, STORAGE_EVIDENCE[4][1], 'Codex', commit, implementationTree);
  validateAuthorAcceptance(root, boundReceipt, commit, implementationTree);
}

export function validatePublicationRecord(root, record) {
  const anchorBytes = readFileSync(join(root, record.anchor));
  const carrierBytes = readFileSync(join(root, record.carrier));
  const receiptBytes = readFileSync(join(root, record.receipt));
  const anchor = parseCanonicalPublicationJson(anchorBytes, `${record.id} anchor`);
  const carrier = parseCanonicalPublicationJson(carrierBytes, `${record.id} carrier`);
  const receipt = parseCanonicalPublicationJson(receiptBytes, `${record.id} receipt`);
  exactKeys(anchor, ['schemaVersion', 'capabilityId', 'state', 'carrierSha256'], `${record.id} anchor`);
  if (anchor.schemaVersion !== 'snapback.local-capability-publication-anchor.v1'
      || anchor.capabilityId !== record.id
      || !['withheld', 'published'].includes(anchor.state)) {
    fail(`${record.id} anchor identity/state drifted`);
  }
  const published = anchor.state === 'published';
  validateReceiptShape(root, receipt, record, published);
  if (!published) {
    if (anchor.carrierSha256 !== null) fail(`${record.id} withheld anchor carries authority`);
    return { id: record.id, state: 'withheld' };
  }
  exactKeys(carrier, [
    'schemaVersion', 'capabilityId', 'targetProfileId', 'maturity', 'qualifiedSourceCommit',
    'implementationDigestVersion', 'implementationTreeSha256', 'candidateFactsSha256',
    'qualificationReceiptSha256', 'buildProvenanceRequirement', 'candidateFacts',
  ], `${record.id} carrier`);
  if (!isSha256(anchor.carrierSha256, true) || anchor.carrierSha256 !== sha256(carrierBytes)) {
    fail(`${record.id} anchor/carrier digest mismatch`);
  }
  const candidateFacts = exactCandidate(record.id);
  const candidateFactsSha256 = sha256(Buffer.from(JSON.stringify(candidateFacts)));
  const implementationScope = implementationScopeForReceipt(receipt);
  if (carrier.schemaVersion !== 'snapback.local-agent-safe-publication.v2'
      || carrier.capabilityId !== record.id
      || carrier.targetProfileId !== 'local-dev-sqlite-ibex'
      || carrier.maturity !== 'experimental'
      || carrier.buildProvenanceRequirement !== 'known-clean-contributor-source'
      || carrier.qualificationReceiptSha256 !== sha256(receiptBytes)
      || JSON.stringify(carrier.candidateFacts) !== JSON.stringify(candidateFacts)
      || carrier.candidateFactsSha256 !== candidateFactsSha256
      || receipt.candidateFactsSha256 !== candidateFactsSha256
      || receipt.implementationDigestVersion !== carrier.implementationDigestVersion
      || receipt.implementationTreeSha256 !== carrier.implementationTreeSha256
      || receipt.qualifiedSourceCommit !== carrier.qualifiedSourceCommit
      || JSON.stringify(receipt.qualifiedComponents) !== JSON.stringify(record.components)) {
    fail(`${record.id} exact carrier/candidate/receipt binding failed`);
  }
  if (!/^[0-9a-f]{40}$/u.test(carrier.qualifiedSourceCommit)
      || !isSha256(carrier.implementationTreeSha256, true)) {
    fail(`${record.id} source/tree identity is invalid`);
  }
  if (record.id === 'agent_safe_derived_deployment_fork_v1') {
    validateDerivedForkCoverageTransfers(
      root,
      carrier.qualifiedSourceCommit,
      receipt.selectionPolicySha256,
    );
  }
  for (const binding of receipt.evidence) {
    const path = join(root, binding.path);
    if (!existsSync(path) || sha256(readFileSync(path)) !== binding.sha256) {
      fail(`${record.id} evidence bytes drifted at ${binding.path}`);
    }
  }
  const publication = git(root, ['rev-parse', 'HEAD']);
  try {
    git(root, ['merge-base', '--is-ancestor', carrier.qualifiedSourceCommit, publication]);
  } catch {
    fail(`${record.id} qualification commit is not an ancestor of publication HEAD`);
  }
  const publicationImplementationScope = record.id === 'agent_safe_derived_deployment_fork_v1'
    ? derivedForkImplementationScopeAt(root, publication)
    : implementationScope;
  const implementationDigest = assertQualifiedImplementationDigestAtPublication(root, {
    capabilityId: record.id,
    qualificationCommit: carrier.qualifiedSourceCommit,
    publicationCommit: publication,
    expectedDigest: receipt.implementationTreeSha256,
    expectedDigestVersion: receipt.implementationDigestVersion,
    implementationScope,
    publicationImplementationScope,
    allowRequalificationDue: record.id === 'agent_safe_derived_deployment_fork_v1',
    publicationCycleEvolutionPaths: record.id === 'agent_safe_derived_deployment_fork_v1'
      ? DERIVED_FORK_SIBLING_CHAIN_PATHS
      : [],
  });
  const snapshot = evaluateClaimSnapshot(root, {
    qualificationCommit: carrier.qualifiedSourceCommit,
    publicationCommit: publication,
    scope: implementationScope,
    allowRequalificationDue: record.id === 'agent_safe_derived_deployment_fork_v1',
    publicationCycleEvolutionPaths: record.id === 'agent_safe_derived_deployment_fork_v1'
      ? DERIVED_FORK_SIBLING_CHAIN_PATHS
      : [],
  });
  validatePublishedEvidenceSemantics(root, record, carrier.qualifiedSourceCommit, receipt);
  return {
    id: record.id,
    state: 'published',
    commit: carrier.qualifiedSourceCommit,
    implementationDigest,
    implementationDigestVersion: receipt.implementationDigestVersion,
    implementationScope: publicationImplementationScope,
    snapshot,
    ...(snapshot.requalificationDue === undefined
      ? {}
      : { requalificationDue: snapshot.requalificationDue }),
  };
}

function canonicalShape(value) {
  if (Array.isArray(value)) return value.map(canonicalShape);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'description')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, member]) => [key, canonicalShape(member)]));
}

function agentSafeSchemaDefinitions(root) {
  let authoritative;
  for (const path of AGENT_SAFE_SCHEMA_PATHS) {
    const schema = JSON.parse(readFileSync(join(root, path), 'utf8'));
    const definitions = Object.fromEntries(Object.entries(schema.$defs ?? {})
      .filter(([name]) => name.startsWith('AgentSafe'))
      .map(([name, definition]) => [name, canonicalShape(definition)])
      .sort(([left], [right]) => left.localeCompare(right)));
    if (authoritative === undefined) {
      authoritative = definitions;
    } else if (JSON.stringify(definitions) !== JSON.stringify(authoritative)) {
      fail(`AgentSafe committed schema definitions drifted across ${AGENT_SAFE_SCHEMA_PATHS.join(', ')}`);
    }
  }
  return authoritative;
}

function schemaDeclarationType(property, name) {
  if (typeof property.$ref === 'string') return property.$ref.split('/').at(-1);
  if (property.type === 'array' && typeof property.items?.$ref === 'string') {
    return `readonly ${property.items.$ref.split('/').at(-1)}[]`;
  }
  fail(`AgentSafe committed schema member ${name} uses an unsupported declaration shape`);
}

// @ref LLP 0037#decision-ratified-2026-07-02 — Rust is authoritative, the
// four committed schemas are its toolchain-free projection, and this gate
// prevents the hand-authored package declaration from becoming a third shape.
export function validateAgentSafeCodegenDeclarations(root) {
  const declarationPath = 'packages/snapback-codegen/index.d.mts';
  const declaration = readFileSync(join(root, declarationPath), 'utf8');
  const aliasMatches = [...declaration.matchAll(
    /export type (AgentSafe[A-Za-z0-9]+) =([\s\S]*?);/gu,
  )];
  const interfaceMatches = [...declaration.matchAll(
    /export interface (AgentSafe[A-Za-z0-9]+) \{\n([\s\S]*?)\n\}/gu,
  )];
  const aliases = new Map(aliasMatches.map((match) => [match[1], match[2]]));
  const interfaces = new Map(interfaceMatches.map((match) => [match[1], match[2]]));
  if (aliases.size !== aliasMatches.length || interfaces.size !== interfaceMatches.length) {
    fail(`${declarationPath} contains duplicate AgentSafe definitions`);
  }
  const definitions = agentSafeSchemaDefinitions(root);
  const declaredNames = [...aliases.keys(), ...interfaces.keys()].sort();
  const schemaNames = Object.keys(definitions).sort();
  if (JSON.stringify(declaredNames) !== JSON.stringify(schemaNames)) {
    fail(`${declarationPath} AgentSafe definition inventory drifted from committed schemas`);
  }

  for (const [name, definition] of Object.entries(definitions)) {
    if (Array.isArray(definition.enum)) {
      const body = aliases.get(name);
      if (body === undefined) fail(`${declarationPath} ${name} must be an enum alias`);
      const values = [...body.matchAll(/'([^']+)'/gu)].map((match) => match[1]);
      const residue = body.replace(/'[^']+'/gu, '').replace(/[|\s]/gu, '');
      if (residue !== '' || JSON.stringify(values) !== JSON.stringify(definition.enum)) {
        fail(`${declarationPath} ${name} enum drifted from committed schemas`);
      }
      continue;
    }

    const body = interfaces.get(name);
    if (body === undefined) fail(`${declarationPath} ${name} must be an object interface`);
    const propertyPattern = /^[ \t]*readonly[ \t]+([A-Za-z][A-Za-z0-9]*):[ \t]*([^;]+);[ \t]*$/gmu;
    const properties = new Map([...body.matchAll(propertyPattern)]
      .map((match) => [match[1], match[2].replace(/\s+/gu, ' ').trim()]));
    if (body.replace(propertyPattern, '').trim() !== '') {
      fail(`${declarationPath} ${name} has an unsupported declaration member`);
    }
    const expectedProperties = Object.fromEntries(Object.entries(definition.properties ?? {})
      .map(([propertyName, property]) => [
        propertyName,
        schemaDeclarationType(property, `${name}.${propertyName}`),
      ]));
    if (definition.additionalProperties !== false
        || JSON.stringify([...(definition.required ?? [])].sort())
          !== JSON.stringify(Object.keys(expectedProperties).sort())
        || JSON.stringify(Object.fromEntries([...properties].sort()))
          !== JSON.stringify(Object.fromEntries(Object.entries(expectedProperties).sort()))) {
      fail(`${declarationPath} ${name} object shape drifted from committed schemas`);
    }
  }
  return { definitions: schemaNames.length, schemas: AGENT_SAFE_SCHEMA_PATHS.length };
}

export function runChecker(root) {
  validateAgentSafeCodegenDeclarations(root);
  const results = RECORDS.map((record) => validatePublicationRecord(root, record));
  for (const result of results.filter(({ state }) => state === 'published')) {
    validatePublishedResultCustody(root, result);
    const workingTreeDigest = implementationDigestWorkingTree(root, result.implementationScope);
    if (result.implementationDigest !== workingTreeDigest) {
      fail(`${result.id} publication HEAD and clean working-tree implementation digests differ; `
        + `expected ${result.implementationDigest}; actual ${workingTreeDigest}`);
    }
  }
  return results;
}

// @ref LLP 0189#decision — D-4's coverage-moves-never-vanishes rule transfers
// sibling-chain integrity away from the derived-fork C: local-store-publication
// and local-store-carrier-receipt own the persistent-store chain, while
// relation-activity-publication and sequence-allocation-publication own their
// carriers. The storage claim retains its own exact C-bound transform here;
// fork-chain anchor/carrier/receipt/evidence bindings remain in
// validatePublicationRecord and are not relaxed by this transfer.
export function validatePublishedResultCustody(root, result) {
  if (result.id === 'agent_safe_storage_v1') {
    validateLocalStorePublicationTransform(root, result.commit);
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg >= 0
    ? resolve(process.argv[rootArg + 1])
    : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (process.argv.includes('--codegen-declarations-only')) {
    const result = validateAgentSafeCodegenDeclarations(root);
    process.stdout.write(`agent-safe-codegen-declarations:ok (${result.definitions} definitions, ${result.schemas} schemas)\n`);
  } else {
    const results = runChecker(root);
    process.stdout.write(`${results.map(({ id, state }) => `${id}:${state}`).join('\n')}\n`);
    for (const result of results.filter(({ requalificationDue }) => (
      requalificationDue !== undefined
    ))) {
      const paths = result.requalificationDue.scopedChanges
        .map(({ status, path }) => `${status}:${path}`)
        .join(',');
      process.stderr.write(`WARNING ${result.id}:PUBLISHED_REQUALIFICATION_DUE; `
        + `since=${result.requalificationDue.since}; scopedChanges=${paths}\n`);
    }
    for (const result of results.filter(({ snapshot }) => (
      snapshot?.outOfScopeChanges.length > 0
    ))) {
      const paths = result.snapshot.outOfScopeChanges
        .map(({ status, path }) => `${status}:${path}`)
        .join(',');
      process.stderr.write(`${result.id}:claim-stands; out-of-scope drift noted: ${paths}\n`);
    }
  }
}
