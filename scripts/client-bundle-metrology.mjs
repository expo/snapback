#!/usr/bin/env node

import assert from 'node:assert/strict';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

import { build, version as esbuildVersion } from 'esbuild';

// @ref LLP 0145#phase-a--establish-a-size-ratchet — freeze reproducible
// public-profile closures and module/package attribution before optimization.
// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — the
// committed baseline is CI-diffable, absolute at first run, and never loosened.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = join(ROOT, 'tests', 'fixtures', 'client-bundle-metrology');
const PROFILE_PATH = join(FIXTURE_DIR, 'profiles.v1.json');
const BASELINE_PATH = join(FIXTURE_DIR, 'baseline.v1.json');
const CURRENT_PATH = join(FIXTURE_DIR, 'current.v1.json');
const PACKAGE_DIR = join(ROOT, 'packages');
const CLIENT_PACKAGE_MANIFEST = JSON.parse(readFileSync(
  join(PACKAGE_DIR, 'snapback-client', 'package.json'),
  'utf8',
));
const METRICS = ['minifiedBytes', 'gzipBytes', 'brotliBytes'];
const PUSH_REGISTRY_MODULE = 'packages/snapback-client/push-registry.mjs';
const PUSH_INSTALLATION_EXPO_MODULE = 'packages/snapback-client/push-installation-expo.mjs';
const MICRO_CORE_MODULE = 'packages/snapback-client/micro-core.mjs';
const MICRO_LIVE_MODULE = 'packages/snapback-client/micro-live.mjs';
const STORE_RUNTIME_MODULE = 'packages/snapback-client/store-runtime.mjs';
const REACT_RUNTIME_MODULE = 'packages/snapback-react/react-runtime.mjs';
const REACT_BINDING_HMR_MODULE = 'packages/snapback-client/react-binding-hmr.mjs';
const FINITE_CARRIER_MODULE = 'packages/snapback-client/finite-completeness-carrier.mjs';
const MATERIALIZATION_RUNTIME_MODULE =
  'packages/snapback-client/materialization-store-runtime.mjs';
const LOCAL_SYNC_CLOSURE_MODULES = Object.freeze([
  'packages/snapback-client/materialization-store.mjs',
  'packages/snapback-client/local-read-admission.mjs',
  'packages/snapback-client/ir-evaluator.mjs',
  'packages/snapback-client/materialization-bridge.mjs',
  'packages/snapback-client/optimistic-rebase.mjs',
]);

// Resolved-closure absence applies to every exported module by default. These
// are the only sync-owned exceptions:
//
// - the Full client and compatibility façades below deliberately construct or
//   attach to that Full client, whose optional store chunk is instead guarded
//   by the existing static-entry assertions; and
// - the remaining entries directly expose local-sync storage, evaluation,
//   admission, rebase, resume, retention, or settlement machinery.
//
// Keep this allowlist about ownership, never about which profiles happen to be
// measured today. A future export is resolved and checked automatically unless
// it is deliberately classified here as sync-owned.
const SYNC_OWNED_CLIENT_SUBPATHS = new Set(Object.freeze([
  '.',
  './app-data',
  './hosted-browser',
  './online',
  './vector-search',
  './push-registry',
  './ir-evaluator',
  './evaluation-floor',
  './result-transform',
  './materialization-store',
  './lease-convergence',
  './local-read-admission',
  './optimistic-rebase',
  './rqs',
  './rqs-preload',
  './rqs-registered',
  './rqs-store',
  './rqs-store-file',
  './rqs-store-expo',
  './rqs-store-default',
  './outbox-shared',
]));

const RESOLVED_NARROW_SUBPATH_EXPORTS = Object.freeze(
  Object.keys(CLIENT_PACKAGE_MANIFEST.exports)
    // package.json is exported metadata, not an executable client entry.
    .filter((key) => key !== './package.json')
    .filter((key) => !SYNC_OWNED_CLIENT_SUBPATHS.has(key))
    .sort(),
);
const RESOLVED_NARROW_SUBPATH_PROFILES = Object.freeze(
  RESOLVED_NARROW_SUBPATH_EXPORTS.map((key) => Object.freeze({
    id: `resolved-public-subpath-${key.slice(2).replaceAll('/', '-')}`,
    package: `${CLIENT_PACKAGE_MANIFEST.name}/${key.slice(2)}`,
    namespace: true,
    resolveOptionalRuntimes: true,
  })),
);
// This immutable receipt predates the commands export. Keep its exact nine
// profiles stable; each later export receives its own prospective additive
// receipt instead of mutating historical first-run evidence.
const LOCAL_SYNC_ABSENCE_V1_PROFILE_IDS = Object.freeze([
  'resolved-public-subpath-agent-authority',
  'resolved-public-subpath-assets',
  'resolved-public-subpath-canonical-client-value',
  'resolved-public-subpath-external-store',
  'resolved-public-subpath-micro',
  'resolved-public-subpath-micro-core',
  'resolved-public-subpath-micro-live',
  'resolved-public-subpath-push-installation-expo',
  'resolved-public-subpath-search',
]);
const LOCAL_SYNC_ABSENCE_V1_PROFILES = Object.freeze(
  RESOLVED_NARROW_SUBPATH_PROFILES.filter(
    (profile) => LOCAL_SYNC_ABSENCE_V1_PROFILE_IDS.includes(profile.id),
  ),
);
const COMMANDS_LOCAL_SYNC_ABSENCE_PROFILE_IDS = Object.freeze([
  'public-subpath-commands',
  'resolved-public-subpath-commands',
]);
const BEHAVIOR_COMMANDS = Object.freeze([
  ['node', ['packages/snapback-client/package.test.mjs']],
  ['node', ['packages/snapback-client/browser-closure.test.mjs']],
  ['node', ['packages/snapback-react/package.test.mjs']],
]);
// Additive workloads append immutable ledgers; no future workload mutates an
// earlier workload's first-run receipt.
const SUPPLEMENTAL_LEDGER_SPECS = Object.freeze([
  Object.freeze({
    filename: 'baseline.push-registry.v1.json',
    profileFilename: 'push-registry-profiles.v1.json',
    profileIds: Object.freeze([
      'public-subpath-push-registry',
      'push-registry-attach',
      'push-registry-root-negative',
    ]),
    authorities: Object.freeze([
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0143#d6-activation-migration-and-the-no-op-posture',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/push-registry.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.push-installation-expo.v1.json',
    profileFilename: 'push-installation-expo-profiles.v1.json',
    profileIds: Object.freeze([
      'public-subpath-push-installation-expo',
    ]),
    authorities: Object.freeze([
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0143#d1-device-token-custody',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/push-registry.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.vector-search.v1.json',
    profileFilename: 'vector-search-profiles.v1.json',
    profileIds: Object.freeze([
      'public-subpath-vector-search',
    ]),
    authorities: Object.freeze([
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0132#query-surface',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.result-transform.v1.json',
    profileFilename: 'result-transform-profiles.v1.json',
    profileIds: Object.freeze([
      'public-subpath-ir-evaluator',
      'public-subpath-local-read-admission',
      'public-subpath-optimistic-rebase',
      'public-subpath-result-transform',
      'public-subpath-rqs-registered',
    ]),
    authorities: Object.freeze([
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0166#d7--transform-plan-v1-pure-deterministic-no-ambient-state',
      'LLP 0166#d9--carriers-storage-profiles-arms-and-the-bundle',
    ]),
    amendments: Object.freeze([
      Object.freeze({
        date: '2026-08-04',
        profileId: 'public-subpath-rqs-registered',
        reviewFindings: Object.freeze([3]),
        predecessor: Object.freeze({
          minifiedBytes: 31_913,
          gzipBytes: 10_621,
          brotliBytes: 9_341,
        }),
        rationale: 'Integrated-review finding 3 added context-bound pending-outcome replay across writer handoff after this supplemental ledger was first frozen in the same uncommitted finish-out diff; refresh this one profile in place before the ledger lands.',
      }),
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/ir-evaluator.test.mjs']],
      ['node', ['packages/snapback-client/local-read-admission.test.mjs']],
      ['node', ['packages/snapback-client/optimistic-rebase.test.mjs']],
      ['node', ['packages/snapback-client/result-transform.test.mjs']],
      ['node', ['packages/snapback-client/mixed-route-v2.test.mjs']],
    ]),
    // Main's later rollover ledgers own the active ceilings for these three
    // shared profiles. The immutable finish-out receipt remains the owner of
    // result-transform and rqs-registered.
    shadowedByRollover: Object.freeze({
      filename: 'baseline.local-read-admission.v1.json',
      profileIds: Object.freeze([
        'public-subpath-ir-evaluator',
        'public-subpath-local-read-admission',
        'public-subpath-optimistic-rebase',
      ]),
      byteIdenticalProfileIds: Object.freeze(['public-subpath-ir-evaluator']),
    }),
  }),
  Object.freeze({
    filename: 'baseline.micro-phase-b.v1.json',
    profileFilename: 'micro-phase-b-profiles.v1.json',
    profileIds: Object.freeze([
      'micro-core-runtime',
      'micro-core-generated-entry',
      'micro-live-runtime',
      'micro-live-generated-entry',
      'micro-root-negative',
      'public-subpath-micro',
      'public-subpath-micro-core',
      'public-subpath-micro-live',
    ]),
    authorities: Object.freeze([
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0147#implementation-sequence',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/micro.test.mjs']],
      ['node', ['packages/snapback-codegen/micro-profile.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.ir-evaluator.v1.json',
    profileFilename: 'ir-evaluator-profiles.v1.json',
    profileIds: Object.freeze([
      'public-subpath-ir-evaluator',
    ]),
    authorities: Object.freeze([
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0051#d2-promote-the-mutation-ir-extend-it-to-the-common-mutation',
      'LLP 0051#d5-conformance-the-corpus-becomes-the-data-tier-contract',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/ir-evaluator.test.mjs']],
    ]),
    // Main independently froze this byte-identical profile in the later
    // local-read-admission rollover. Retain the supplemental receipt while
    // making that landed successor the one active ceiling.
    shadowedByRollover: Object.freeze({
      filename: 'baseline.local-read-admission.v1.json',
      profileIds: Object.freeze(['public-subpath-ir-evaluator']),
    }),
  }),
  Object.freeze({
    filename: 'baseline.local-sync-absence.v1.json',
    profileFilename: 'local-sync-absence-profiles.v1.json',
    profileIds: LOCAL_SYNC_ABSENCE_V1_PROFILE_IDS,
    derivedProfiles: LOCAL_SYNC_ABSENCE_V1_PROFILES,
    authorities: Object.freeze([
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0166#d9--carriers-storage-profiles-arms-and-the-bundle',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
      ['node', ['packages/snapback-client/browser-closure.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.s2-commands.v1.json',
    profileFilename: 's2-commands-profiles.v1.json',
    profileIds: COMMANDS_LOCAL_SYNC_ABSENCE_PROFILE_IDS,
    authorities: Object.freeze([
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0179#s2--command-member-and-wider-consumers',
      'LLP 0180#acceptance',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/commands.test.mjs']],
      ['node', ['packages/snapback-client/browser-closure.test.mjs']],
    ]),
  }),
]);

// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — a real
// workload-version change gets a declared prospective rollover; its historical
// receipt stays immutable and unaffected profiles keep their prior ceilings.
// @ref LLP 0166#d1--one-store-domain — store format v3 and registration-backed
// reads intentionally evolve the existing Full/RQS workload in place.
const LOCAL_STORE_ROLLOVER_PROFILE_IDS = Object.freeze([
  'app-data-operation-live',
  'external-react-application',
  'full-operation-call',
  'full-operation-live',
  'full-public-surface',
  'full-sessions',
  'micro-root-negative',
  'online-operation-live',
  'public-subpath-app-data',
  'public-subpath-evaluation-floor',
  'public-subpath-hosted-browser',
  'public-subpath-lease-convergence',
  'public-subpath-materialization-store',
  'public-subpath-online',
  'public-subpath-push-registry',
  'public-subpath-root',
  'public-subpath-rqs-preload',
  'public-subpath-rqs-store',
  'public-subpath-rqs-store-default',
  'public-subpath-rqs-store-expo',
  'public-subpath-rqs-store-file',
  'public-subpath-vector-search',
  'push-registry-attach',
  'push-registry-root-negative',
  'react-external',
]);
const LOCAL_STORE_NEW_PROFILE_IDS = Object.freeze([
  'public-subpath-evaluation-floor',
  'public-subpath-lease-convergence',
  'public-subpath-materialization-store',
]);
const LOCAL_STORE_SUPPLEMENTAL_PREDECESSOR_PROFILE_IDS = Object.freeze([
  'micro-root-negative',
  'public-subpath-push-registry',
  'public-subpath-vector-search',
  'push-registry-attach',
  'push-registry-root-negative',
]);
const LOCAL_STORE_PRIMARY_PREDECESSOR_PROFILE_IDS = Object.freeze(
  LOCAL_STORE_ROLLOVER_PROFILE_IDS.filter((id) => ![
    ...LOCAL_STORE_NEW_PROFILE_IDS,
    ...LOCAL_STORE_SUPPLEMENTAL_PREDECESSOR_PROFILE_IDS,
  ].includes(id)),
);
const LOCAL_READ_ADMISSION_ROLLOVER_PROFILE_IDS = Object.freeze([
  ...LOCAL_STORE_ROLLOVER_PROFILE_IDS,
  'public-subpath-ir-evaluator',
  'public-subpath-local-read-admission',
  'public-subpath-optimistic-rebase',
  'public-subpath-outbox-shared',
]);
const GENERATED_MUTATION_IR_ROLLOVER_PROFILE_IDS = Object.freeze([
  'app-data-operation-live',
  'external-react-application',
  'full-operation-call',
  'full-operation-live',
  'full-public-surface',
  'full-sessions',
  'micro-root-negative',
  'online-operation-live',
  'public-subpath-app-data',
  'public-subpath-hosted-browser',
  'public-subpath-local-read-admission',
  'public-subpath-online',
  'public-subpath-optimistic-rebase',
  'public-subpath-push-registry',
  'public-subpath-root',
  'public-subpath-vector-search',
  'push-registry-attach',
  'push-registry-root-negative',
  'react-external',
]);
const OFFLINE_UNAVAILABLE_ROLLOVER_PROFILE_IDS = Object.freeze([
  'app-data-operation-live',
  'full-operation-call',
  'full-operation-live',
  'full-public-surface',
  'full-sessions',
  'micro-root-negative',
  'online-operation-live',
  'public-subpath-app-data',
  'public-subpath-hosted-browser',
  'public-subpath-online',
  'public-subpath-push-registry',
  'public-subpath-root',
  'public-subpath-vector-search',
  'push-registry-attach',
  'push-registry-root-negative',
]);
const FINITE_CARRIER_COMPLETENESS_ROLLOVER_PROFILE_IDS = Object.freeze([
  ...OFFLINE_UNAVAILABLE_ROLLOVER_PROFILE_IDS,
  'public-subpath-materialization-store',
]);
const ROWLESS_RQS_RESUME_ROLLOVER_PROFILE_IDS = Object.freeze([
  ...OFFLINE_UNAVAILABLE_ROLLOVER_PROFILE_IDS,
]);
// @ref LLP 0155#move-3--shared-mutation-ir-for-local-prediction-and-server-authority
// — the completed evaluator/admission/rebase/generated-mutation workload,
// together with the single-table and client-lifecycle landings it consumes,
// deliberately advances the latest landed ceiling for every affected closure.
const POST_FFEE_GENERATED_PREDECESSOR_PROFILE_IDS = Object.freeze([
  'external-react-application',
  'public-subpath-local-read-admission',
  'public-subpath-optimistic-rebase',
  'react-external',
]);
const POST_FFEE_LOCAL_READ_PREDECESSOR_PROFILE_IDS = Object.freeze([
  'public-subpath-outbox-shared',
  'public-subpath-rqs-preload',
  'public-subpath-rqs-store',
  'public-subpath-rqs-store-default',
  'public-subpath-rqs-store-expo',
  'public-subpath-rqs-store-file',
]);
const POST_FFEE_FINITE_PREDECESSOR_PROFILE_IDS = Object.freeze([
  'public-subpath-materialization-store',
]);
const POST_FFEE_PRIMARY_PREDECESSOR_PROFILE_IDS = Object.freeze([
  'public-subpath-agent-authority',
]);
const POST_FFEE_ROLLOVER_PROFILE_IDS = Object.freeze([
  ...ROWLESS_RQS_RESUME_ROLLOVER_PROFILE_IDS,
  ...POST_FFEE_GENERATED_PREDECESSOR_PROFILE_IDS,
  ...POST_FFEE_LOCAL_READ_PREDECESSOR_PROFILE_IDS,
  ...POST_FFEE_FINITE_PREDECESSOR_PROFILE_IDS,
  ...POST_FFEE_PRIMARY_PREDECESSOR_PROFILE_IDS,
].toSorted());
const OPERATION_IDENTITY_CARRIER_ROLLOVER_PROFILE_IDS = Object.freeze([
  'public-subpath-outbox-shared',
  'public-subpath-rqs-registered',
  'public-subpath-rqs-store',
  'public-subpath-rqs-store-default',
  'public-subpath-rqs-store-expo',
  'public-subpath-rqs-store-file',
]);
const CLIENT_BUNDLE_DISPOSITION_ROLLOVER_PROFILE_IDS = Object.freeze([
  'external-react-application',
  'public-subpath-assets',
  'public-subpath-outbox-shared',
  'public-subpath-rqs-registered',
  'public-subpath-rqs-store',
  'public-subpath-rqs-store-default',
  'public-subpath-rqs-store-expo',
  'public-subpath-rqs-store-file',
  'react-external',
  'resolved-public-subpath-assets',
]);
const E2_COMMAND_CORRECTNESS_ROLLOVER_PROFILE_IDS = Object.freeze([
  'external-react-application',
  'public-subpath-assets',
  'public-subpath-commands',
  'public-subpath-ir-evaluator',
  'react-external',
  'resolved-public-subpath-assets',
  'resolved-public-subpath-commands',
]);
const ROLLOVER_LEDGER_SPECS = Object.freeze([
  Object.freeze({
    filename: 'baseline.local-persistent-store.v1.json',
    profileFilename: 'local-persistent-store-profiles.v1.json',
    workloadVersion: 'llp-0166-local-persistent-store.v1',
    profileIds: LOCAL_STORE_ROLLOVER_PROFILE_IDS,
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.v1.json',
        profileIds: LOCAL_STORE_PRIMARY_PREDECESSOR_PROFILE_IDS,
      }),
      Object.freeze({
        filename: 'baseline.micro-phase-b.v1.json',
        profileIds: Object.freeze(['micro-root-negative']),
      }),
      Object.freeze({
        filename: 'baseline.push-registry.v1.json',
        profileIds: Object.freeze([
          'public-subpath-push-registry',
          'push-registry-attach',
          'push-registry-root-negative',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.vector-search.v1.json',
        profileIds: Object.freeze(['public-subpath-vector-search']),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0166#d9--carriers-storage-profiles-arms-and-the-bundle',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
      ['node', ['packages/snapback-client/browser-closure.test.mjs']],
      ['node', ['packages/snapback-react/package.test.mjs']],
      ['node', ['packages/snapback-client/rqs-store-v3.test.mjs']],
      ['node', ['packages/snapback-client/materialization-store.test.mjs']],
      ['node', ['packages/snapback-client/registration-ledger.test.mjs']],
      ['node', ['packages/snapback-client/answer-classes.test.mjs']],
      ['node', ['packages/snapback-client/evaluation-floor.test.mjs']],
      ['node', ['packages/snapback-client/lease-convergence.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.local-persistent-store-review-fixes.v1.json',
    profileFilename: 'local-persistent-store-review-fixes-profiles.v1.json',
    workloadVersion: 'llp-0166-integrated-review-fixes.2026-08-04.v1',
    profileIds: Object.freeze(['public-subpath-rqs-preload']),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.local-persistent-store.v1.json',
        profileIds: Object.freeze(['public-subpath-rqs-preload']),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0166#d9--carriers-storage-profiles-arms-and-the-bundle',
    ]),
    rationale: Object.freeze({
      date: '2026-08-04',
      reviewFindings: Object.freeze([6, 9]),
      summary: 'Integrated-review findings 6 and 9 add the legacy preload no-op guard and typed optional-runtime load failure to rqs-preload-core.mjs. These are correctness bytes in the existing public-subpath-rqs-preload workload, so its 5,505-byte predecessor remains immutable and this exact one-profile rollover owns the successor ceiling.',
    }),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/store-runtime-wiring.test.mjs']],
      ['node', ['packages/snapback-client/materialization-bridge.test.mjs']],
      ['node', ['packages/snapback-client/browser-closure.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.local-read-admission.v1.json',
    profileFilename: 'local-read-admission-profiles.v1.json',
    workloadVersion: 'llp-0155-move3-phase1.v1',
    profileIds: LOCAL_READ_ADMISSION_ROLLOVER_PROFILE_IDS,
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.local-persistent-store.v1.json',
        profileIds: LOCAL_STORE_ROLLOVER_PROFILE_IDS,
      }),
      Object.freeze({
        filename: 'baseline.v1.json',
        profileIds: Object.freeze(['public-subpath-outbox-shared']),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0155#execution-contract',
    ]),
    parallelMethodFallbacks: Object.freeze([
      Object.freeze({
        filename: 'baseline.local-persistent-store-review-fixes.v1.json',
        profileIds: Object.freeze(['public-subpath-rqs-preload']),
        rationale: 'Lane E measures the optional store runtime outside the static entry closure. Keep the review-fixes ledger\'s strict 5,549-byte rqs-preload ceiling active instead of main\'s independently frozen pre-Lane-E 32,561-byte closure.',
      }),
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
      ['node', ['packages/snapback-client/browser-closure.test.mjs']],
      ['node', ['packages/snapback-react/package.test.mjs']],
      ['node', ['packages/snapback-client/ir-evaluator.test.mjs']],
      ['node', ['packages/snapback-client/optimistic-rebase.test.mjs']],
      ['node', ['packages/snapback-client/optimistic-rebase-acceptance.test.mjs']],
      ['node', ['packages/snapback-client/rqs-store-v3.test.mjs']],
      ['node', ['packages/snapback-client/materialization-store.test.mjs']],
      ['node', ['packages/snapback-client/registration-ledger.test.mjs']],
      ['node', ['packages/snapback-client/answer-classes.test.mjs']],
      ['node', ['packages/snapback-client/evaluation-floor.test.mjs']],
      ['node', ['packages/snapback-client/lease-convergence.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.generated-mutation-ir.v1.json',
    profileFilename: 'generated-mutation-ir-profiles.v1.json',
    workloadVersion: 'llp-0155-generated-mutation-ir.v1',
    profileIds: GENERATED_MUTATION_IR_ROLLOVER_PROFILE_IDS,
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.local-read-admission.v1.json',
        profileIds: GENERATED_MUTATION_IR_ROLLOVER_PROFILE_IDS,
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0155#execution-contract',
      'LLP 0155#acceptance-gate',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
      ['node', ['packages/snapback-client/browser-closure.test.mjs']],
      ['node', ['packages/snapback-react/package.test.mjs']],
      ['node', ['packages/snapback-client/generated-mutation-ir.test.mjs']],
      ['node', ['packages/snapback-client/local-read-admission.test.mjs']],
      ['node', ['packages/snapback-client/optimistic-rebase.test.mjs']],
      ['node', ['packages/snapback-client/optimistic-rebase-acceptance.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.offline-unavailable.v1.json',
    profileFilename: 'offline-unavailable-profiles.v1.json',
    workloadVersion: 'llp-0166-offline-unavailable.v1',
    profileIds: OFFLINE_UNAVAILABLE_ROLLOVER_PROFILE_IDS,
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.generated-mutation-ir.v1.json',
        profileIds: OFFLINE_UNAVAILABLE_ROLLOVER_PROFILE_IDS,
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0166#d4--completeness-honest-local-answers',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
      ['node', ['packages/snapback-client/browser-closure.test.mjs']],
      ['node', ['packages/snapback-react/package.test.mjs']],
      ['node', ['packages/snapback-client/argument-validation.test.mjs']],
      ['node', ['packages/snapback-client/materialization-bridge.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.finite-carrier-completeness.v1.json',
    profileFilename: 'finite-carrier-completeness-profiles.v1.json',
    workloadVersion: 'llp-0093-0094-finite-carrier-completeness.v1',
    profileIds: FINITE_CARRIER_COMPLETENESS_ROLLOVER_PROFILE_IDS,
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.offline-unavailable.v1.json',
        profileIds: OFFLINE_UNAVAILABLE_ROLLOVER_PROFILE_IDS,
      }),
      Object.freeze({
        filename: 'baseline.local-read-admission.v1.json',
        profileIds: Object.freeze(['public-subpath-materialization-store']),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0093#finite-carrier-completeness-amendment--2026-08-04',
      'LLP 0094#llp-0157-finite-carrier-completeness-amendment--2026-08-04',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
      ['node', ['packages/snapback-client/browser-closure.test.mjs']],
      ['node', ['packages/snapback-react/package.test.mjs']],
      ['node', ['packages/snapback-client/materialization-store.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.rowless-rqs-resume.v1.json',
    profileFilename: 'rowless-rqs-resume-profiles.v1.json',
    workloadVersion: 'llp-0091-rowless-rqs-resume-ordering.v1',
    profileIds: ROWLESS_RQS_RESUME_ROLLOVER_PROFILE_IDS,
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.finite-carrier-completeness.v1.json',
        profileIds: ROWLESS_RQS_RESUME_ROLLOVER_PROFILE_IDS,
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0091#0b2-currentasof-envelope',
      'LLP 0091#0b3-client-transition-table',
      'LLP 0091#0b4-token-resume-wire-naming-and-dispatch-against-the-reattach-route',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
      ['node', ['packages/snapback-client/browser-closure.test.mjs']],
      ['node', ['packages/snapback-react/package.test.mjs']],
      ['node', ['packages/snapback-client/rqs-resume.test.mjs']],
      ['node', ['packages/snapback-client/rqs-resume-memory.test.mjs']],
      ['node', ['packages/snapback-client/rqs-resume-expo.test.mjs']],
      ['node', ['packages/snapback-client/rqs-resume-native.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.move3-single-table-lifecycle.v1.json',
    profileFilename: 'move3-single-table-lifecycle-profiles.v1.json',
    workloadVersion: 'move3-single-table-lifecycle.v1',
    profileIds: POST_FFEE_ROLLOVER_PROFILE_IDS,
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.rowless-rqs-resume.v1.json',
        profileIds: ROWLESS_RQS_RESUME_ROLLOVER_PROFILE_IDS,
      }),
      Object.freeze({
        filename: 'baseline.generated-mutation-ir.v1.json',
        profileIds: POST_FFEE_GENERATED_PREDECESSOR_PROFILE_IDS,
      }),
      Object.freeze({
        filename: 'baseline.local-read-admission.v1.json',
        profileIds: POST_FFEE_LOCAL_READ_PREDECESSOR_PROFILE_IDS,
      }),
      Object.freeze({
        filename: 'baseline.finite-carrier-completeness.v1.json',
        profileIds: POST_FFEE_FINITE_PREDECESSOR_PROFILE_IDS,
      }),
      Object.freeze({
        filename: 'baseline.v1.json',
        profileIds: POST_FFEE_PRIMARY_PREDECESSOR_PROFILE_IDS,
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0155#move-3--shared-mutation-ir-for-local-prediction-and-server-authority',
      'LLP 0157#single_table_v1-activation-and-local-publication--2026-08-04',
      'LLP 0166#d9--carriers-storage-profiles-arms-and-the-bundle',
    ]),
    beforeAfterProfileIds: POST_FFEE_ROLLOVER_PROFILE_IDS,
    parallelMethodFallbacks: Object.freeze([
      Object.freeze({
        filename: 'baseline.v1.json',
        profileIds: Object.freeze(['public-subpath-agent-authority']),
        rationale: 'Lane E externalizes the optional store runtime while measuring static entry closure. That required method boundary makes main\'s independently frozen pre-Lane-E agent-authority output non-comparable by 5 minified / 8 gzip bytes; retain the unchanged primary ceiling for this unaffected subpath rather than rewriting either immutable receipt.',
      }),
      Object.freeze({
        filename: 'baseline.local-persistent-store-review-fixes.v1.json',
        profileIds: Object.freeze(['public-subpath-rqs-preload']),
        rationale: 'The Lane E review-fixes receipt remains the comparable static-closure owner for rqs-preload; main\'s later Move-3 row used the pre-boundary full closure and must not loosen the active 5,549-byte ceiling.',
      }),
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/ir-evaluator.test.mjs']],
      ['node', ['packages/snapback-client/local-read-admission.test.mjs']],
      ['node', ['packages/snapback-client/optimistic-rebase.test.mjs']],
      ['node', ['packages/snapback-client/optimistic-rebase-acceptance.test.mjs']],
      ['node', ['packages/snapback-client/generated-mutation-ir.test.mjs']],
      ['node', ['packages/snapback-client/materialization-bridge.test.mjs']],
      ['node', ['packages/snapback-client/mixed-route-v2.test.mjs']],
      ['node', ['packages/snapback-client/logout-v3-bridge.test.mjs']],
      ['node', ['packages/snapback-client/demand-broker.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.operation-identity-carrier.v1.json',
    profileFilename: 'operation-identity-carrier-profiles.v1.json',
    workloadVersion: 'llp-0163-operation-identity-carrier.v1',
    profileIds: OPERATION_IDENTITY_CARRIER_ROLLOVER_PROFILE_IDS,
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.move3-single-table-lifecycle.v1.json',
        profileIds: Object.freeze([
          'public-subpath-outbox-shared',
          'public-subpath-rqs-store',
          'public-subpath-rqs-store-default',
          'public-subpath-rqs-store-expo',
          'public-subpath-rqs-store-file',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.result-transform.v1.json',
        profileIds: Object.freeze(['public-subpath-rqs-registered']),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0163#implementation-record--2026-08-04-lifecycle-and-atomic-envelope-tail',
    ]),
    rationale: Object.freeze({
      date: '2026-08-05',
      summary: 'LLP 0163 deliberately adds authenticated finite-range custody and durable result-gone settlement to the shared outbox and all persistent-store arms. The rollover advances only the six measured closures whose valid ceilings the combined implementation exceeds; every predecessor receipt remains immutable.',
    }),
    beforeAfterProfileIds: OPERATION_IDENTITY_CARRIER_ROLLOVER_PROFILE_IDS,
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
      ['node', ['packages/snapback-client/browser-closure.test.mjs']],
      ['node', ['packages/snapback-client/outbox-store.test.mjs']],
      ['node', ['packages/snapback-client/rqs-store-file.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.client-bundle-disposition.v1.json',
    profileFilename: 'client-bundle-disposition-profiles.v1.json',
    workloadVersion: 'client-bundle-ratchet-disposition.2026-08-06.v1',
    profileIds: CLIENT_BUNDLE_DISPOSITION_ROLLOVER_PROFILE_IDS,
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.v1.json',
        profileIds: Object.freeze(['public-subpath-assets']),
      }),
      Object.freeze({
        filename: 'baseline.local-sync-absence.v1.json',
        profileIds: Object.freeze(['resolved-public-subpath-assets']),
      }),
      Object.freeze({
        filename: 'baseline.move3-single-table-lifecycle.v1.json',
        profileIds: Object.freeze([
          'external-react-application',
          'react-external',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.operation-identity-carrier.v1.json',
        profileIds: OPERATION_IDENTITY_CARRIER_ROLLOVER_PROFILE_IDS,
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0081#4-execution-journaling-and-crash-recovery',
      'LLP 0114#mounted-provider-hmr-generation-handoff-dated-amendment-2026-08-05',
      'LLP 0163#implementation-record--2026-08-06-c33-dual-ready-landing-chain',
      'LLP 0179#react-projection',
      'LLP 0180#react-and-surface-projections',
    ]),
    rationale: Object.freeze({
      date: '2026-08-06',
      classification: 'mixed: accidental HMR closure fixed; later accepted capability growth rolled prospectively',
      accidentalClosureFix: 'The 8ce5ca33e HMR handoff statically pulled the result-contract compiler, RQS hashing, and complete re-admission loop into every React entry. react-binding-hmr.mjs now remains behind a literal development-only dynamic import, so none of those bytes are included in this successor ceiling.',
      legitimateGrowth: 'The remaining React mass is the accepted LLP 0179 provider.surface/useSurface composition and LLP 0180 synchronous CommandTask projection, including its asset client. Moving that implementation behind an asynchronous boundary would change provider.surface(...) and start(...) returning a ready binding/task synchronously; a narrow compatibility-preserving React entry requires a separate composition design and is tracked in issues/20260806-react-optional-capability-composition.md.',
      smallDriftDisposition: 'The operation-lifecycle, tombstone/re-entry, assets, and retained-store correctness changes are the measured small-drift cluster. They are real shipped client behavior, so exactly their affected profiles advance while all unrelated ceilings and historical receipts remain immutable.',
      summary: 'This disposition removes the accidental 35% HMR closure step, then records only the remaining accepted August client capability and correctness mass across the ten profiles that still exceed their active ceilings.',
    }),
    beforeAfterProfileIds: CLIENT_BUNDLE_DISPOSITION_ROLLOVER_PROFILE_IDS,
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
      ['node', ['packages/snapback-client/browser-closure.test.mjs']],
      ['node', ['packages/snapback-client/assets.test.mjs']],
      ['node', ['packages/snapback-client/commands.test.mjs']],
      ['node', ['packages/snapback-client/outbox-store.test.mjs']],
      ['node', ['packages/snapback-client/rqs-store.test.mjs']],
      ['node', ['packages/snapback-client/rqs-store-file.test.mjs']],
      ['node', ['packages/snapback-react/package.test.mjs']],
      ['node', ['packages/snapback-react/commands.test.mjs']],
      ['node', ['packages/snapback-react/hmr-generation-handoff.test.mjs']],
      ['node', ['packages/snapback-react/surface.test.mjs']],
    ]),
  }),
  // @ref LLP 0181#e2--online-asset-command — the picker/content-URI adapter
  // is shipped client capability mass, not an unmeasured Expo-only wrapper.
  // @ref LLP 0180#command-task — provider disposal and authority ambiguity
  // fencing are correctness obligations of the synchronous command task.
  Object.freeze({
    filename: 'baseline.e2-command-correctness.v1.json',
    profileFilename: 'e2-command-correctness-profiles.v1.json',
    workloadVersion: 'expo-e2-command-correctness.2026-08-06.v1',
    profileIds: E2_COMMAND_CORRECTNESS_ROLLOVER_PROFILE_IDS,
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.client-bundle-disposition.v1.json',
        profileIds: Object.freeze([
          'external-react-application',
          'public-subpath-assets',
          'react-external',
          'resolved-public-subpath-assets',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.s2-commands.v1.json',
        profileIds: Object.freeze([
          'public-subpath-commands',
          'resolved-public-subpath-commands',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.local-read-admission.v1.json',
        profileIds: Object.freeze(['public-subpath-ir-evaluator']),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0176#g3--one-online-image-send-command',
      'LLP 0180#command-task',
      'LLP 0181#e2--online-asset-command',
    ]),
    rationale: Object.freeze({
      date: '2026-08-06',
      classification: 'accepted Expo E2 capability and command/auth correctness mass',
      expoE2: '47b4a59ac adds the structural picker/content-URI adapter and the native platform source path. The shipped assets, commands, and React closures retain those bytes because the online command accepts the platform source synchronously.',
      commandCorrectness: '02bf40745 fences command tasks when their provider is disposed and stops reporting false mutation ambiguity. Those checks belong to the existing synchronous CommandTask contract and cannot move behind an asynchronous import without changing it.',
      authCompressionResidue: 'f782431bd repairs auth-custody lock ordering. Tree shaking leaves the ir-evaluator profile at the same minified and gzip sizes and with the same per-module byte attribution, but the changed auth-coordinator source rotates the output and adds one Brotli byte; the exact compressed artifact is therefore recorded rather than waived.',
      summary: 'Advance exactly the seven closures exceeded by the E2 picker adapter, command-task disposal correction, and auth lock-ordering output rotation. Every predecessor receipt and every unrelated ceiling remains immutable.',
    }),
    beforeAfterProfileIds: E2_COMMAND_CORRECTNESS_ROLLOVER_PROFILE_IDS,
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
      ['node', ['packages/snapback-client/browser-closure.test.mjs']],
      ['node', ['packages/snapback-client/assets.test.mjs']],
      ['node', ['packages/snapback-client/commands.test.mjs']],
      ['node', ['packages/snapback-client/ir-evaluator.test.mjs']],
      ['node', ['packages/snapback-react/package.test.mjs']],
      ['node', ['packages/snapback-react/commands.test.mjs']],
      ['node', ['packages/snapback-react/surface.test.mjs']],
    ]),
  }),
]);

function fail(message) {
  throw new Error(`SNAPBACK_CLIENT_BUNDLE_RATCHET_FAILED: ${message}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitText(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function gitBytes(args) {
  return execFileSync('git', args, { cwd: ROOT });
}

function baselineSourceProvenance() {
  const revision = gitText(['rev-parse', 'HEAD']);
  return {
    revision,
    packageTrees: Object.fromEntries(
      ['snapback-client', 'snapback-contract', 'snapback-react'].map((name) => [
        `packages/${name}`,
        gitText(['rev-parse', `${revision}:packages/${name}`]),
      ]),
    ),
  };
}

function validateBaselineSource(source) {
  assert.match(source?.revision ?? '', /^[0-9a-f]{40}$/u, 'baseline source revision');
  for (const [path, expected] of Object.entries(source?.packageTrees ?? {})) {
    assert.equal(
      gitText(['rev-parse', `${source.revision}:${path}`]),
      expected,
      `baseline package tree provenance for ${path}`,
    );
  }
}

function ledgerCarrierRevision(ledgerFilename, uncommittedCarrierRevision = null) {
  const revisions = gitText([
    'log',
    '--diff-filter=A',
    '--format=%H',
    '--',
    `tests/fixtures/client-bundle-metrology/${ledgerFilename}`,
  ]).split('\n').filter(Boolean);
  if (revisions.length === 0 && uncommittedCarrierRevision !== null) {
    assert.equal(
      uncommittedCarrierRevision,
      gitText(['rev-parse', 'HEAD']),
      `${ledgerFilename}: uncommitted write carrier is the exact committed source head`,
    );
    return uncommittedCarrierRevision;
  }
  assert.equal(revisions.length, 1, `${ledgerFilename}: one reachable carrier introduction`);
  return revisions[0];
}

function validateFrozenInputs(
  inputs,
  profileFilename,
  ledgerFilename,
  label,
  uncommittedCarrierRevision = null,
) {
  const carrierRevision = ledgerCarrierRevision(ledgerFilename, uncommittedCarrierRevision);
  assert.deepEqual(
    inputs,
    {
      profilesSha256: sha256(gitBytes([
        'show',
        `${carrierRevision}:tests/fixtures/client-bundle-metrology/${profileFilename}`,
      ])),
      lockfileSha256: sha256(gitBytes(['show', `${carrierRevision}:bun.lock`])),
    },
    `${label} frozen input digests`,
  );
}

function normalizePath(path) {
  const absolute = resolve(path);
  const rootPrefix = `${ROOT}${sep}`;
  if (absolute === ROOT) return '.';
  if (absolute.startsWith(rootPrefix)) return relative(ROOT, absolute).split(sep).join('/');
  return absolute.split(sep).join('/');
}

function packageForModule(path) {
  const normalized = normalizePath(path);
  const workspace = normalized.match(/^packages\/([^/]+)\//u);
  if (workspace) return `@expo/${workspace[1]}`;
  const dependency = normalized.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/u);
  if (dependency) return dependency[1];
  if (normalized.startsWith('tests/fixtures/client-bundle-metrology/')) return '<fixture>';
  return '<repository>';
}

function exportedTarget(manifest, exportKey) {
  const target = manifest.exports?.[exportKey];
  if (typeof target === 'string') return target;
  if (!target || typeof target !== 'object') fail(`${manifest.name} does not export ${exportKey}`);
  return target.browser ?? target.import ?? target.default ?? fail(
    `${manifest.name} export ${exportKey} has no browser/import/default target`,
  );
}

const packageManifests = new Map();
for (const directory of ['snapback-client', 'snapback-contract', 'snapback-react']) {
  const manifestPath = join(PACKAGE_DIR, directory, 'package.json');
  const manifest = readJson(manifestPath);
  packageManifests.set(manifest.name, { directory: dirname(manifestPath), manifest });
}

function resolveWorkspaceSpecifier(specifier) {
  const match = specifier.match(/^(@expo\/[^/]+)(\/.*)?$/u);
  if (!match) return null;
  const record = packageManifests.get(match[1]);
  if (!record) return null;
  const exportKey = match[2] ? `.${match[2]}` : '.';
  const target = exportedTarget(record.manifest, exportKey);
  return resolve(record.directory, target);
}

const workspaceExports = {
  name: 'snapback-client-metrology-workspace-exports',
  setup(buildContext) {
    buildContext.onResolve({ filter: /^@expo\/(?:snapback-client|snapback-contract|snapback-react)(?:\/.*)?$/ }, (args) => {
      const path = resolveWorkspaceSpecifier(args.path);
      return path ? { path } : null;
    });
  },
};

// @ref LLP 0166#d9--carriers-storage-profiles-arms-and-the-bundle — the
// ratchet measures the initial static entry closure. A literal dynamic import
// remains bundler-visible for product code splitting, while this boundary
// keeps its optional chunk out of the single-output historical byte method.
// The ordinary browser-closure proof still bundles the module itself.
const optionalRuntimeBoundaries = {
  name: 'snapback-client-metrology-optional-runtime-boundaries',
  setup(buildContext) {
    buildContext.onResolve({
      filter: /^\.\/(?:store-runtime|react-runtime|react-binding-hmr|finite-completeness-carrier|materialization-store-runtime)\.mjs$/,
    }, (args) => (
      args.kind === 'dynamic-import' ? { path: args.path, external: true } : null
    ));
  },
};

function profileSource(profile) {
  if (profile.fixture === 'micro-core-runtime') {
    return [
      "import { createMicroCoreRuntime } from '@expo/snapback-client/micro/core';",
      'export { createMicroCoreRuntime };',
      'export function __snapbackMetrologyBehavior() {',
      "  return typeof createMicroCoreRuntime === 'function' ? 1 : 0;",
      '}',
    ].join('\n');
  }
  if (profile.fixture === 'micro-live-runtime') {
    return [
      "import { createMicroCoreRuntime } from '@expo/snapback-client/micro/core';",
      "import { withMicroLive } from '@expo/snapback-client/micro/live';",
      'export { createMicroCoreRuntime, withMicroLive };',
      'export function __snapbackMetrologyBehavior() {',
      "  return typeof createMicroCoreRuntime === 'function' && typeof withMicroLive === 'function' ? 1 : 0;",
      '}',
    ].join('\n');
  }
  if (profile.fixture === 'micro-core-generated-entry') {
    return [
      "import { createMicroCoreRuntime } from '@expo/snapback-client/micro/core';",
      "const generation = Object.freeze({ schemaVersion: 'snapback.v0', appId: 'metrology', schemaHash: 'sha256:schema', bundleHash: 'sha256:bundle', inputsHash: 'sha256:inputs' });",
      "const list = Object.freeze({ name: 'listTodos', kind: 'Query' });",
      "const create = Object.freeze({ name: 'createTodo', kind: 'Mutation' });",
      "const echoRef = Object.freeze({ name: 'echo', kind: 'Action' });",
      'export function createClient(options) { return createMicroCoreRuntime({ ...options, expectedGeneration: generation }); }',
      'export function listTodos(client, args) { return client.invoke(list, args); }',
      'export function createTodo(client, args) { return client.invoke(create, args); }',
      'export function echo(client, args) { return client.invoke(echoRef, args); }',
      'export function __snapbackMetrologyBehavior() {',
      "  const client = createClient({ endpoint: 'http://127.0.0.1:9' });",
      "  if (typeof client.invoke !== 'function' || 'subscribe' in client) throw new Error('core selection drifted');",
      '  return 1;',
      '}',
    ].join('\n');
  }
  if (profile.fixture === 'micro-live-generated-entry') {
    return [
      "import { createMicroCoreRuntime } from '@expo/snapback-client/micro/core';",
      "import { withMicroLive } from '@expo/snapback-client/micro/live';",
      "const generation = Object.freeze({ schemaVersion: 'snapback.v0', appId: 'metrology', schemaHash: 'sha256:schema', bundleHash: 'sha256:bundle', inputsHash: 'sha256:inputs' });",
      "const watch = Object.freeze({ name: 'watchTodos', kind: 'LiveQuery' });",
      'export function createClient(options) { return withMicroLive(createMicroCoreRuntime({ ...options, expectedGeneration: generation })); }',
      'export function watchTodos(client, args, options) { return client.subscribe(watch, args, options); }',
      'export function __snapbackMetrologyBehavior() {',
      "  const client = createClient({ endpoint: 'http://127.0.0.1:9' });",
      "  if (typeof client.invoke !== 'function' || typeof client.subscribe !== 'function') throw new Error('live selection drifted');",
      '  return 1;',
      '}',
    ].join('\n');
  }
  if (profile.fixture === 'micro-root-negative') {
    return [
      "import * as root from '@expo/snapback-client';",
      "import * as online from '@expo/snapback-client/online';",
      'export function __snapbackMetrologyBehavior() {',
      "  for (const surface of [root, online]) if ('createMicroRuntime' in surface || 'createMicroCoreRuntime' in surface || 'withMicroLive' in surface) throw new Error('Micro leaked into a compatibility surface');",
      '  return 1;',
      '}',
    ].join('\n');
  }
  if (profile.fixture === 'push-registry-attach') {
    return [
      "import { SnapbackClient } from '@expo/snapback-client';",
      "import { attachPushRegistry, newPushInstallationId } from '@expo/snapback-client/push-registry';",
      'export function __snapbackMetrologyBehavior() {',
      "  const storage = { read: () => null, write: () => {}, clear: () => {} };",
      "  const client = attachPushRegistry(new SnapbackClient('http://127.0.0.1:9'), { pushInstallationStorage: storage });",
      "  if (typeof client.push?.registerToken !== 'function') throw new Error('push registry did not attach');",
      "  if (!/^inst_[0-7][0-9a-hjkmnp-tv-z]{25}$/u.test(newPushInstallationId())) throw new Error('push installation id is invalid');",
      '  return 1;',
      '}',
    ].join('\n');
  }
  if (profile.fixture === 'push-registry-root-negative') {
    return [
      "import * as root from '@expo/snapback-client';",
      'export function __snapbackMetrologyBehavior() {',
      "  if ('attachPushRegistry' in root || 'newPushInstallationId' in root) throw new Error('push leaked into the root export');",
      "  const client = new root.SnapbackClient('http://127.0.0.1:9');",
      "  if ('push' in client) throw new Error('push leaked into the root client');",
      "  if (root.SnapbackClient.prototype.health.length !== 0) throw new Error('root health signature changed');",
      "  if (root.SnapbackClient.auth.length !== 1) throw new Error('root auth signature changed');",
      "  if (root.SnapbackClient.roomPermission.length !== 2) throw new Error('root roomPermission signature changed');",
      "  const auth = root.SnapbackClient.auth('fixture', { permissions: ['read'] });",
      "  if (auth.principal !== 'fixture' || auth.permissions[0] !== 'read') throw new Error('root auth behavior changed');",
      "  if (root.SnapbackClient.roomPermission('room', { id: 1 }) !== 'room:2:id=1:1') throw new Error('root roomPermission behavior changed');",
      '  return Object.keys(root).length;',
      '}',
    ].join('\n');
  }
  if (profile.namespace === true) {
    return [
      `import * as measured from ${JSON.stringify(profile.package)};`,
      'export function __snapbackMetrologyBehavior() {',
      '  const keys = Object.keys(measured);',
      `  if (keys.length === 0) throw new Error(${JSON.stringify(`${profile.id}: empty public surface`)});`,
      '  return keys.length;',
      '}',
    ].join('\n');
  }
  const imports = profile.imports ?? [];
  const uses = profile.uses ?? [];
  return [
    `import { ${imports.join(', ')} } from ${JSON.stringify(profile.package)};`,
    'export function __snapbackMetrologyBehavior() {',
    `  const selected = [${uses.map((use) => `typeof ${use}`).join(', ')}];`,
    `  if (selected.some((value) => value !== 'function')) throw new Error(${JSON.stringify(`${profile.id}: selected surface is not callable`)});`,
    '  return selected.length;',
    '}',
  ].join('\n');
}

function publicSubpathProfiles(config) {
  const record = packageManifests.get(config.publicSubpaths.package);
  const excluded = new Set(config.publicSubpaths.exclude ?? []);
  return Object.keys(record.manifest.exports)
    .filter((key) => !excluded.has(key))
    .sort()
    .map((key) => ({
      id: `public-subpath-${key === '.' ? 'root' : key.slice(2).replaceAll('/', '-')}`,
      package: key === '.' ? record.manifest.name : `${record.manifest.name}/${key.slice(2)}`,
      namespace: true,
    }));
}

function normalizedMetafile(metafile, outputBytes) {
  const inputs = Object.fromEntries(
    Object.entries(metafile.inputs)
      .map(([path, input]) => [normalizePath(path), {
        bytes: input.bytes,
        imports: input.imports
          .map((entry) => ({
            path: entry.external ? entry.path : normalizePath(entry.path),
            kind: entry.kind,
            external: entry.external === true,
          }))
          .sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind)),
      }])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const output = Object.values(metafile.outputs)[0];
  const entryPoint = output.entryPoint ? normalizePath(output.entryPoint) : '<stdin>';
  return {
    inputs,
    output: {
      bytes: outputBytes,
      entryPoint,
      imports: output.imports
        .map((entry) => ({ path: entry.path, kind: entry.kind, external: entry.external === true }))
        .sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind)),
      inputs: Object.fromEntries(
        Object.entries(output.inputs)
          .map(([path, value]) => [normalizePath(path), { bytesInOutput: value.bytesInOutput }])
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    },
  };
}

function attributionFor(metafile) {
  const modules = Object.entries(metafile.output.inputs)
    .map(([path, value]) => ({
      module: path,
      package: packageForModule(path),
      bytes: value.bytesInOutput,
    }))
    .sort((left, right) => right.bytes - left.bytes || left.module.localeCompare(right.module));
  const packages = new Map();
  for (const module of modules) packages.set(module.package, (packages.get(module.package) ?? 0) + module.bytes);
  return {
    packages: [...packages]
      .map(([name, bytes]) => ({ name, bytes }))
      .sort((left, right) => right.bytes - left.bytes || left.name.localeCompare(right.name)),
    modules,
  };
}

async function executeBundle(profile, contents) {
  // Keep the transient module below the workspace node_modules directory so
  // intentionally external peer dependencies (React) resolve exactly as they
  // do for the package tests. The directory is removed in the same turn.
  const directory = mkdtempSync(join(ROOT, 'node_modules', '.snapback-client-metrology-'));
  const path = join(directory, `${profile.id}.mjs`);
  try {
    writeFileSync(path, contents);
    const module = await import(`${pathToFileURL(path).href}?sha256=${sha256(contents)}`);
    assert.equal(typeof module.__snapbackMetrologyBehavior, 'function', `${profile.id}: behavior export`);
    assert.ok(await module.__snapbackMetrologyBehavior(), `${profile.id}: behavior assertion`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function measureProfile(profile) {
  const source = profileSource(profile);
  const result = await build({
    stdin: {
      contents: source,
      resolveDir: FIXTURE_DIR,
      sourcefile: `tests/fixtures/client-bundle-metrology/${profile.id}.fixture.mjs`,
      loader: 'js',
    },
    absWorkingDir: ROOT,
    bundle: true,
    conditions: ['browser', 'import', 'default'],
    define: { 'process.env.NODE_ENV': '"production"' },
    external: profile.external ?? [],
    format: 'esm',
    legalComments: 'none',
    logLevel: 'silent',
    metafile: true,
    minify: true,
    platform: 'browser',
    plugins: profile.resolveOptionalRuntimes === true
      ? [workspaceExports]
      : [workspaceExports, optionalRuntimeBoundaries],
    target: 'es2022',
    treeShaking: true,
    write: false,
  });
  assert.equal(result.outputFiles.length, 1, `${profile.id}: exactly one output`);
  const bytes = result.outputFiles[0].contents;
  await executeBundle(profile, bytes);
  const metafile = normalizedMetafile(result.metafile, bytes.byteLength);
  return {
    id: profile.id,
    package: profile.package,
    fixtureSha256: sha256(source),
    externals: [...(profile.external ?? [])].sort(),
    ...(profile.resolveOptionalRuntimes === true
      ? { resolveOptionalRuntimes: true }
      : {}),
    minifiedBytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(bytes, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
    outputSha256: sha256(bytes),
    attribution: attributionFor(metafile),
    metafile,
  };
}

function commandStrings(commands) {
  return commands.map(([command, args]) => [command, ...args].join(' '));
}

function runBehaviorCommands(commands) {
  for (const [command, args] of commands) {
    execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  }
}

function additiveProfileIds() {
  return SUPPLEMENTAL_LEDGER_SPECS.flatMap((spec) => spec.profileIds);
}

function rolloverProfileIds() {
  return ROLLOVER_LEDGER_SPECS.flatMap((spec) => spec.profileIds);
}

function prospectiveProfileIds(baseline) {
  const historical = new Set(baseline.profiles.map((profile) => profile.id));
  return [...new Set([
    ...additiveProfileIds(),
    ...rolloverProfileIds().filter((id) => !historical.has(id)),
  ])];
}

function assertDeclaredAdditiveProfiles(additiveConfigs, profiles) {
  const measured = new Set(profiles.map((profile) => profile.id));
  for (const { spec, config } of additiveConfigs) {
    const declared = spec.derivedProfiles === undefined
      ? [
        ...config.profiles.map((profile) => profile.id),
        ...spec.profileIds.filter((id) => id.startsWith('public-subpath-')),
      ].sort()
      : [
        ...config.profiles.map((profile) => profile.id),
        ...spec.derivedProfiles.map((profile) => profile.id),
      ].sort();
    assert.deepEqual(declared, spec.profileIds.toSorted(), `${spec.filename}: declared ids`);
    for (const id of declared) assert.ok(measured.has(id), `${id}: additive profile exists`);
  }
}

function assertDeclaredRolloverProfiles(rolloverConfigs, profiles) {
  const measured = new Set(profiles.map((profile) => profile.id));
  for (const { spec, config } of rolloverConfigs) {
    assert.equal(
      config.schemaVersion,
      'snapback.client-bundle-metrology-rollover-profiles.v1',
    );
    assert.deepEqual(config.profiles, [], `${spec.filename}: rollover profile config is declarative only`);
    for (const id of spec.profileIds) assert.ok(measured.has(id), `${id}: rollover profile exists`);
    const predecessorIds = spec.predecessors.flatMap((entry) => entry.profileIds);
    assert.equal(
      new Set(predecessorIds).size,
      predecessorIds.length,
      `${spec.filename}: predecessor ids are unique`,
    );
    if (spec.beforeAfterProfileIds !== undefined) {
      assert.deepEqual(
        predecessorIds.toSorted(),
        spec.beforeAfterProfileIds.toSorted(),
        `${spec.filename}: every superseded profile records before/after metrics`,
      );
    }
  }
}

function assertPushRegistryClosure(profiles) {
  const positive = new Set(['public-subpath-push-registry', 'push-registry-attach']);
  const negative = new Set(['push-registry-root-negative']);
  const additive = new Set(additiveProfileIds());
  for (const profile of profiles) {
    const includesPushRegistry = Object.hasOwn(
      profile.metafile.inputs,
      PUSH_REGISTRY_MODULE,
    );
    if (positive.has(profile.id)) {
      assert.equal(includesPushRegistry, true, `${profile.id}: positive push closure`);
    } else if (negative.has(profile.id) || !additive.has(profile.id)) {
      assert.equal(includesPushRegistry, false, `${profile.id}: negative push closure`);
    }
  }
}

function assertExpoPushInstallationClosure(profiles) {
  const profile = profiles.find(
    (candidate) => candidate.id === 'public-subpath-push-installation-expo',
  );
  assert.ok(profile, 'Expo push installation storage profile is present');
  assert.equal(
    Object.hasOwn(profile.metafile.inputs, PUSH_INSTALLATION_EXPO_MODULE),
    true,
    'Expo push installation subpath includes its storage adapter',
  );
  assert.equal(
    Object.hasOwn(profile.metafile.inputs, PUSH_REGISTRY_MODULE),
    false,
    'Expo push installation subpath keeps the push registry runtime type-only',
  );
}

function assertMicroClosure(profiles) {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const core = byId.get('micro-core-generated-entry');
  const live = byId.get('micro-live-generated-entry');
  const coreRuntime = byId.get('micro-core-runtime');
  const liveRuntime = byId.get('micro-live-runtime');
  const negative = byId.get('micro-root-negative');
  assert.ok(core && live && coreRuntime && liveRuntime && negative, 'Micro supplemental profiles are present');
  assert.ok(Object.hasOwn(core.metafile.inputs, MICRO_CORE_MODULE), 'Micro core includes its core module');
  assert.equal(Object.hasOwn(core.metafile.inputs, MICRO_LIVE_MODULE), false, 'Micro core excludes live');
  assert.ok(Object.hasOwn(live.metafile.inputs, MICRO_CORE_MODULE), 'Micro live includes core');
  assert.ok(Object.hasOwn(live.metafile.inputs, MICRO_LIVE_MODULE), 'Micro live includes live');
  for (const profile of [core, live]) {
    for (const forbidden of [
      'packages/snapback-client/index.mjs',
      'packages/snapback-client/rqs.mjs',
      'packages/snapback-client/outbox-shared.mjs',
      'packages/snapback-client/rqs-store-file.mjs',
    ]) {
      assert.equal(Object.hasOwn(profile.metafile.inputs, forbidden), false, `${profile.id}: excludes ${forbidden}`);
    }
  }
  assert.ok(coreRuntime.gzipBytes <= 20_000, `Micro core runtime ${coreRuntime.gzipBytes} <= 20 kB gzip`);
  assert.ok(liveRuntime.gzipBytes <= 20_000, `Micro live runtime ${liveRuntime.gzipBytes} <= 20 kB gzip`);
  assert.ok(core.gzipBytes <= 25_000, `Micro core generated entry ${core.gzipBytes} <= 25 kB gzip`);
  assert.ok(live.gzipBytes <= 25_000, `Micro live generated entry ${live.gzipBytes} <= 25 kB gzip`);
  assert.equal(Object.hasOwn(negative.metafile.inputs, MICRO_CORE_MODULE), false, 'root/online exclude Micro core');
  assert.equal(Object.hasOwn(negative.metafile.inputs, MICRO_LIVE_MODULE), false, 'root/online exclude Micro live');
}

function assertStoreRuntimeClosure(profiles) {
  for (const profile of profiles) {
    assert.equal(
      Object.hasOwn(profile.metafile.inputs, STORE_RUNTIME_MODULE),
      false,
      `${profile.id}: optional store runtime stays outside the static entry closure`,
    );
    assert.equal(
      Object.hasOwn(profile.metafile.inputs, REACT_RUNTIME_MODULE),
      false,
      `${profile.id}: optional React failure/development runtime stays outside the static entry closure`,
    );
    assert.equal(
      Object.hasOwn(profile.metafile.inputs, REACT_BINDING_HMR_MODULE),
      false,
      `${profile.id}: optional React binding HMR runtime stays outside the static entry closure`,
    );
    assert.equal(
      Object.hasOwn(profile.metafile.inputs, FINITE_CARRIER_MODULE),
      false,
      `${profile.id}: optional finite carrier verifier stays outside the static entry closure`,
    );
    assert.equal(
      Object.hasOwn(profile.metafile.inputs, MATERIALIZATION_RUNTIME_MODULE),
      false,
      `${profile.id}: materialization commit runtime stays outside the static entry closure`,
    );
  }
  const root = profiles.find((profile) => profile.id === 'public-subpath-root');
  assert.ok(root, 'root profile is present');
  assert.ok(
    root.metafile.output.imports.some((entry) => (
      entry.kind === 'dynamic-import'
      && entry.external === true
      && entry.path === './store-runtime.mjs'
    )),
    'root retains one external dynamic store-runtime boundary',
  );
  for (const id of ['external-react-application', 'react-external']) {
    const react = profiles.find((profile) => profile.id === id);
    assert.ok(react, `${id}: React profile is present`);
    assert.ok(
      react.metafile.output.imports.some((entry) => (
        entry.kind === 'dynamic-import'
        && entry.external === true
        && entry.path === './react-binding-hmr.mjs'
      )),
      `${id}: retains one external dynamic React binding HMR boundary`,
    );
  }
}

function assertResolvedNarrowSubpathAbsence(profiles) {
  const executableExports = Object.keys(CLIENT_PACKAGE_MANIFEST.exports)
    .filter((key) => key !== './package.json')
    .sort();
  for (const key of SYNC_OWNED_CLIENT_SUBPATHS) {
    assert.ok(
      executableExports.includes(key),
      `sync-owned client subpath ${key} is still exported`,
    );
  }
  assert.deepEqual(
    RESOLVED_NARROW_SUBPATH_EXPORTS,
    executableExports.filter((key) => !SYNC_OWNED_CLIENT_SUBPATHS.has(key)),
    'resolved narrow subpaths are derived from the client exports map minus the sync-owned allowlist',
  );

  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  for (const expected of RESOLVED_NARROW_SUBPATH_PROFILES) {
    const profile = byId.get(expected.id);
    assert.ok(profile, `${expected.id}: derived resolved narrow profile is present`);
    assert.equal(
      profile.resolveOptionalRuntimes,
      true,
      `${expected.id}: optional runtimes are resolved for the absence proof`,
    );
    for (const module of LOCAL_SYNC_CLOSURE_MODULES) {
      assert.equal(
        Object.hasOwn(profile.metafile.inputs, module),
        false,
        `${expected.id}: resolved narrow closure excludes ${module}`,
      );
    }
    assert.equal(
      Object.hasOwn(profile.metafile.inputs, STORE_RUNTIME_MODULE),
      false,
      `${expected.id}: resolved narrow closure excludes ${STORE_RUNTIME_MODULE}`,
    );
  }
}

function runBehaviorTrain() {
  runBehaviorCommands(BEHAVIOR_COMMANDS);
  for (const spec of SUPPLEMENTAL_LEDGER_SPECS) runBehaviorCommands(spec.behaviorCommands);
  for (const spec of ROLLOVER_LEDGER_SPECS) runBehaviorCommands(spec.behaviorCommands);
}

async function measure() {
  const configBytes = readFileSync(PROFILE_PATH);
  const config = JSON.parse(configBytes);
  assert.equal(config.schemaVersion, 'snapback.client-bundle-metrology-profiles.v1');
  const additiveConfigs = SUPPLEMENTAL_LEDGER_SPECS.map((spec) => {
    const bytes = readFileSync(join(FIXTURE_DIR, spec.profileFilename));
    const config = JSON.parse(bytes);
    assert.equal(
      config.schemaVersion,
      'snapback.client-bundle-metrology-additive-profiles.v1',
    );
    return { spec, bytes, config };
  });
  const rolloverConfigs = ROLLOVER_LEDGER_SPECS.map((spec) => {
    const bytes = readFileSync(join(FIXTURE_DIR, spec.profileFilename));
    const config = JSON.parse(bytes);
    return { spec, bytes, config };
  });
  const profiles = [
    ...config.profiles,
    ...additiveConfigs.flatMap((entry) => entry.config.profiles),
    ...additiveConfigs.flatMap((entry) => entry.spec.derivedProfiles ?? []),
    ...rolloverConfigs.flatMap((entry) => entry.config.profiles),
    ...publicSubpathProfiles(config),
  ];
  const ids = profiles.map((profile) => profile.id);
  assert.equal(new Set(ids).size, ids.length, 'profile ids must be unique');
  assertDeclaredAdditiveProfiles(additiveConfigs, profiles);
  assertDeclaredRolloverProfiles(rolloverConfigs, profiles);
  const measured = [];
  for (const profile of profiles) measured.push(await measureProfile(profile));
  measured.sort((left, right) => left.id.localeCompare(right.id));
  assertPushRegistryClosure(measured);
  assertExpoPushInstallationClosure(measured);
  assertMicroClosure(measured);
  assertResolvedNarrowSubpathAbsence(measured);
  assertStoreRuntimeClosure(measured);
  return {
    schemaVersion: 'snapback.client-bundle-metrology.v1',
    authorities: [
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
    ],
    method: {
      runtime: {
        node: process.version,
        zlib: process.versions.zlib,
        brotli: process.versions.brotli,
      },
      bundler: `esbuild@${esbuildVersion}`,
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      minify: true,
      treeShaking: true,
      legalComments: 'none',
      conditions: ['browser', 'import', 'default'],
      gzipLevel: 9,
      brotliQuality: 11,
      reactExternal: true,
      attribution: 'esbuild module-own bytesInOutput grouped by stable package boundary',
    },
    inputs: {
      profilesSha256: sha256(configBytes),
      lockfileSha256: sha256(readFileSync(join(ROOT, 'bun.lock'))),
    },
    behaviorCommands: commandStrings(BEHAVIOR_COMMANDS),
    additiveLedgers: additiveConfigs.map(({ spec, bytes }) => ({
      filename: spec.filename,
      inputs: {
        profilesSha256: sha256(bytes),
        lockfileSha256: sha256(readFileSync(join(ROOT, 'bun.lock'))),
      },
      behaviorCommands: commandStrings(spec.behaviorCommands),
    })),
    rolloverLedgers: rolloverConfigs.map(({ spec, bytes }) => ({
      filename: spec.filename,
      workloadVersion: spec.workloadVersion,
      inputs: {
        profilesSha256: sha256(bytes),
        lockfileSha256: sha256(readFileSync(join(ROOT, 'bun.lock'))),
      },
      behaviorCommands: commandStrings(spec.behaviorCommands),
    })),
    profiles: measured,
  };
}

function compactSupplementalBaseline(report, spec, profiles) {
  const evidence = report.additiveLedgers.find((entry) => entry.filename === spec.filename);
  assert.ok(evidence, `${spec.filename}: additive evidence`);
  return {
    schemaVersion: 'snapback.client-bundle-metrology-supplemental-baseline.v1',
    source: baselineSourceProvenance(),
    authorities: spec.authorities,
    frozenRule: 'prospective additive profile first run; valid ceilings never loosen',
    method: report.method,
    inputs: evidence.inputs,
    behaviorCommands: evidence.behaviorCommands,
    ...(spec.amendments === undefined ? {} : { amendments: spec.amendments }),
    profiles: profiles.map(compactProfile),
  };
}

function compactProfile(profile) {
  return {
    id: profile.id,
    package: profile.package,
    fixtureSha256: profile.fixtureSha256,
    externals: profile.externals,
    ...(profile.resolveOptionalRuntimes === true
      ? { resolveOptionalRuntimes: true }
      : {}),
    minifiedBytes: profile.minifiedBytes,
    gzipBytes: profile.gzipBytes,
    brotliBytes: profile.brotliBytes,
    outputSha256: profile.outputSha256,
    attribution: profile.attribution,
    metafile: profile.metafile,
  };
}

function rolloverPredecessorReceipts(spec) {
  return spec.predecessors.map((predecessor) => {
    const path = join(FIXTURE_DIR, predecessor.filename);
    if (!existsSync(path)) fail(`${spec.filename}: predecessor ${predecessor.filename} is missing`);
    const bytes = readFileSync(path);
    const baseline = JSON.parse(bytes);
    const baselineIds = new Set(baseline.profiles.map((profile) => profile.id));
    for (const id of predecessor.profileIds) {
      assert.ok(baselineIds.has(id), `${spec.filename}: predecessor ${predecessor.filename} owns ${id}`);
    }
    return {
      filename: predecessor.filename,
      sha256: sha256(bytes),
      profileIds: predecessor.profileIds,
    };
  });
}

function profileMetricSnapshot(profile) {
  return {
    minifiedBytes: profile.minifiedBytes,
    gzipBytes: profile.gzipBytes,
    brotliBytes: profile.brotliBytes,
    outputSha256: profile.outputSha256,
  };
}

function rolloverBeforeAfter(spec, profiles) {
  const predecessorById = new Map();
  for (const predecessor of spec.predecessors) {
    const baseline = readJson(join(FIXTURE_DIR, predecessor.filename));
    const profilesById = new Map(baseline.profiles.map((profile) => [profile.id, profile]));
    for (const id of predecessor.profileIds) {
      assert.equal(predecessorById.has(id), false, `${spec.filename}: ${id} has one predecessor`);
      const profile = profilesById.get(id);
      assert.ok(profile, `${spec.filename}: predecessor metric for ${id}`);
      predecessorById.set(id, { filename: predecessor.filename, profile });
    }
  }
  const successorById = new Map(profiles.map((profile) => [profile.id, profile]));
  return spec.beforeAfterProfileIds.toSorted().map((id) => {
    const predecessor = predecessorById.get(id);
    const successor = successorById.get(id);
    assert.ok(predecessor, `${spec.filename}: before profile ${id}`);
    assert.ok(successor, `${spec.filename}: after profile ${id}`);
    return {
      id,
      predecessor: {
        filename: predecessor.filename,
        ...profileMetricSnapshot(predecessor.profile),
      },
      successor: profileMetricSnapshot(successor),
      delta: Object.fromEntries(
        METRICS.map((metric) => [metric, successor[metric] - predecessor.profile[metric]]),
      ),
    };
  });
}

function compactRolloverBaseline(report, spec, profiles) {
  const evidence = report.rolloverLedgers.find((entry) => entry.filename === spec.filename);
  assert.ok(evidence, `${spec.filename}: rollover evidence`);
  return {
    schemaVersion: 'snapback.client-bundle-metrology-rollover-baseline.v1',
    source: baselineSourceProvenance(),
    authorities: spec.authorities,
    frozenRule: 'declared prospective workload-version rollover; predecessor receipts remain immutable; valid ceilings never loosen',
    workloadVersion: spec.workloadVersion,
    predecessors: rolloverPredecessorReceipts(spec),
    method: report.method,
    inputs: evidence.inputs,
    behaviorCommands: evidence.behaviorCommands,
    ...(spec.rationale === undefined ? {} : { rationale: spec.rationale }),
    ...(spec.beforeAfterProfileIds !== undefined
      ? { beforeAfter: rolloverBeforeAfter(spec, profiles) }
      : {}),
    profiles: profiles.map(compactProfile),
  };
}

function compactBaseline(report, profiles) {
  return {
    schemaVersion: 'snapback.client-bundle-metrology-baseline.v1',
    source: baselineSourceProvenance(),
    authorities: report.authorities,
    frozenRule: 'first attributed run before optimization; valid ceilings never loosen',
    method: report.method,
    inputs: report.inputs,
    behaviorCommands: report.behaviorCommands,
    profiles: profiles.map(compactProfile),
  };
}

function validateMainBaseline(report, baseline) {
  assert.equal(baseline.schemaVersion, 'snapback.client-bundle-metrology-baseline.v1');
  validateBaselineSource(baseline.source);
  validateFrozenInputs(
    baseline.inputs,
    'profiles.v1.json',
    'baseline.v1.json',
    'primary baseline',
  );
  assert.deepEqual(report.authorities, baseline.authorities, 'baseline authorities');
  assert.deepEqual(report.method, baseline.method, 'baseline measurement method');
  assert.deepEqual(report.behaviorCommands, baseline.behaviorCommands, 'baseline behavior commands');
}

function validateSupplementalBaseline(report, spec, supplemental) {
  assert.equal(
    supplemental.schemaVersion,
    'snapback.client-bundle-metrology-supplemental-baseline.v1',
  );
  validateBaselineSource(supplemental.source);
  validateFrozenInputs(
    supplemental.inputs,
    spec.profileFilename,
    spec.filename,
    spec.filename,
  );
  const evidence = report.additiveLedgers.find((entry) => entry.filename === spec.filename);
  assert.ok(evidence, `${spec.filename}: additive evidence`);
  assert.deepEqual(spec.authorities, supplemental.authorities, 'supplemental authorities');
  assert.deepEqual(report.method, supplemental.method, 'supplemental measurement method');
  assert.deepEqual(
    evidence.behaviorCommands,
    supplemental.behaviorCommands,
    'supplemental behavior commands',
  );
  if (spec.amendments !== undefined) {
    assert.deepEqual(
      spec.amendments,
      supplemental.amendments,
      `${spec.filename}: declared same-diff amendments`,
    );
  }
  assert.deepEqual(
    supplemental.profiles.map((profile) => profile.id).toSorted(),
    spec.profileIds.toSorted(),
    `${spec.filename}: exact additive profile ids`,
  );
  if (spec.shadowedByRollover !== undefined) {
    const successor = readJson(join(FIXTURE_DIR, spec.shadowedByRollover.filename));
    const supplementalById = new Map(
      supplemental.profiles.map((profile) => [profile.id, profile]),
    );
    const successorById = new Map(
      successor.profiles.map((profile) => [profile.id, profile]),
    );
    for (const id of spec.shadowedByRollover.byteIdenticalProfileIds
      ?? spec.shadowedByRollover.profileIds) {
      assert.deepEqual(
        supplementalById.get(id),
        successorById.get(id),
        `${spec.filename}: ${id} is byte-identical in the independently landed rollover`,
      );
    }
  }
}

function validateRolloverBaseline(report, spec, rollover, uncommittedCarrierRevision = null) {
  assert.equal(
    rollover.schemaVersion,
    'snapback.client-bundle-metrology-rollover-baseline.v1',
  );
  validateBaselineSource(rollover.source);
  validateFrozenInputs(
    rollover.inputs,
    spec.profileFilename,
    spec.filename,
    spec.filename,
    uncommittedCarrierRevision,
  );
  const evidence = report.rolloverLedgers.find((entry) => entry.filename === spec.filename);
  assert.ok(evidence, `${spec.filename}: rollover evidence`);
  assert.deepEqual(spec.authorities, rollover.authorities, `${spec.filename}: authorities`);
  assert.equal(
    rollover.frozenRule,
    'declared prospective workload-version rollover; predecessor receipts remain immutable; valid ceilings never loosen',
    `${spec.filename}: frozen rule`,
  );
  assert.equal(spec.workloadVersion, rollover.workloadVersion, `${spec.filename}: workload version`);
  assert.deepEqual(
    spec.rationale ?? null,
    rollover.rationale ?? null,
    `${spec.filename}: dated rollover rationale`,
  );
  assert.deepEqual(
    rolloverPredecessorReceipts(spec),
    rollover.predecessors,
    `${spec.filename}: immutable predecessor receipts`,
  );
  assert.deepEqual(report.method, rollover.method, `${spec.filename}: measurement method`);
  assert.deepEqual(
    evidence.behaviorCommands,
    rollover.behaviorCommands,
    `${spec.filename}: behavior commands`,
  );
  assert.deepEqual(
    rollover.profiles.map((profile) => profile.id).toSorted(),
    spec.profileIds.toSorted(),
    `${spec.filename}: exact rollover profile ids`,
  );
  for (const fallbackSpec of spec.parallelMethodFallbacks ?? []) {
    const fallback = readJson(join(FIXTURE_DIR, fallbackSpec.filename));
    const fallbackIds = new Set(fallback.profiles.map((profile) => profile.id));
    assert.ok(fallbackSpec.rationale.length > 0, `${spec.filename}: fallback rationale`);
    for (const id of fallbackSpec.profileIds) {
      assert.ok(
        fallbackIds.has(id),
        `${spec.filename}: method fallback ${fallbackSpec.filename} owns ${id}`,
      );
    }
  }
  if (spec.beforeAfterProfileIds !== undefined) {
    assert.deepEqual(
      rolloverBeforeAfter(spec, rollover.profiles),
      rollover.beforeAfter,
      `${spec.filename}: immutable before/after profile metrics`,
    );
  }
}

function compareProfiles(report, baselines, { requireComplete = true } = {}) {
  const currentById = new Map(report.profiles.map((profile) => [profile.id, profile]));
  const baselineById = new Map();
  for (const baseline of baselines) {
    for (const profile of baseline.profiles) {
      if (baselineById.has(profile.id)) fail(`profile ${profile.id} has overlapping baselines`);
      baselineById.set(profile.id, profile);
    }
  }
  const regressions = [];
  for (const [id, profile] of currentById) {
    const frozen = baselineById.get(id);
    if (!frozen) {
      if (requireComplete) {
        fail(`profile ${id} has no frozen baseline; add it prospectively before changing its closure`);
      }
      continue;
    }
    for (const metric of METRICS) {
      if (profile[metric] > frozen[metric]) {
        regressions.push(`${id} ${metric} regressed from ${frozen[metric]} to ${profile[metric]} bytes`);
      }
    }
  }
  for (const id of baselineById.keys()) {
    if (!currentById.has(id)) fail(`frozen profile ${id} disappeared`);
  }
  if (regressions.length > 0) fail(regressions.join('; '));
}

function historicalBaselineEntries(baseline, supplementals) {
  return [
    { filename: 'baseline.v1.json', baseline },
    ...supplementals.map(({ spec, baseline: supplemental }) => ({
      filename: spec.filename,
      baseline: {
        ...supplemental,
        profiles: supplemental.profiles.filter(
          (profile) => !spec.shadowedByRollover?.profileIds.includes(profile.id),
        ),
      },
    })),
  ];
}

function parallelMethodFallbackProfileIds(spec) {
  return (spec.parallelMethodFallbacks ?? []).flatMap((fallback) => fallback.profileIds);
}

function activeBaselineEntries(
  baseline,
  supplementals,
  rollovers,
  { retireSpecs = rollovers.map(({ spec }) => spec) } = {},
) {
  const historical = historicalBaselineEntries(baseline, supplementals);
  const rolloverEntries = rollovers.map(({ spec, baseline: rollover }) => ({
    filename: spec.filename,
    baseline: {
      ...rollover,
      profiles: rollover.profiles.filter(
        (profile) => !parallelMethodFallbackProfileIds(spec).includes(profile.id),
      ),
    },
  }));
  const allEntries = [...historical, ...rolloverEntries];
  const entriesByFilename = new Map(allEntries.map((entry) => [entry.filename, entry]));
  assert.equal(entriesByFilename.size, allEntries.length, 'baseline filenames are unique');
  const supersededByFilename = new Map();
  for (const spec of retireSpecs) {
    const parallelSuperseded = new Set(parallelMethodFallbackProfileIds(spec));
    for (const predecessor of spec.predecessors) {
      const entry = entriesByFilename.get(predecessor.filename);
      assert.ok(entry, `${spec.filename}: declared predecessor ${predecessor.filename} exists`);
      const owned = new Set(entry.baseline.profiles.map((profile) => profile.id));
      let superseded = supersededByFilename.get(predecessor.filename);
      if (!superseded) {
        superseded = new Set();
        supersededByFilename.set(predecessor.filename, superseded);
      }
      for (const id of predecessor.profileIds) {
        if (parallelSuperseded.has(id)) continue;
        assert.ok(owned.has(id), `${spec.filename}: ${predecessor.filename} owns ${id}`);
        assert.equal(superseded.has(id), false, `${id}: superseded by only one rollover`);
        superseded.add(id);
      }
    }
  }
  return allEntries.map((entry) => ({
    filename: entry.filename,
    baseline: {
      ...entry.baseline,
      profiles: entry.baseline.profiles.filter(
        (profile) => !supersededByFilename.get(entry.filename)?.has(profile.id),
      ),
    },
  }));
}

function compareToBaselines(
  report,
  baseline,
  supplementals,
  rollovers,
  { uncommittedCarrierRevisions = new Map() } = {},
) {
  for (const { spec, baseline: supplemental } of supplementals) {
    validateSupplementalBaseline(report, spec, supplemental);
  }
  for (const { spec, baseline: rollover } of rollovers) {
    validateRolloverBaseline(
      report,
      spec,
      rollover,
      uncommittedCarrierRevisions.get(spec.filename) ?? null,
    );
  }
  compareProfiles(
    report,
    activeBaselineEntries(baseline, supplementals, rollovers).map((entry) => entry.baseline),
  );
}

function withSavings(report, baseline, supplementals, rollovers) {
  const active = activeBaselineEntries(baseline, supplementals, rollovers);
  const baselineById = new Map(
    active
      .map((entry) => entry.baseline)
      .flatMap((entry) => entry.profiles)
      .map((profile) => [profile.id, profile]),
  );
  return {
    ...report,
    comparedTo: active.map((entry) => entry.filename),
    profiles: report.profiles.map((profile) => {
      const frozen = baselineById.get(profile.id);
      assert.ok(frozen, `${profile.id}: active frozen baseline`);
      return {
        ...profile,
        savings: Object.fromEntries(METRICS.map((metric) => [metric, frozen[metric] - profile[metric]])),
      };
    }),
  };
}

function readSupplementalBaselines({ allowMissing = false } = {}) {
  const entries = [];
  for (const spec of SUPPLEMENTAL_LEDGER_SPECS) {
    const path = join(FIXTURE_DIR, spec.filename);
    if (!existsSync(path)) {
      if (allowMissing) continue;
      fail(`${spec.filename} is missing`);
    }
    entries.push({ spec, baseline: readJson(path) });
  }
  return entries;
}

function readRolloverBaselines({ allowMissing = false } = {}) {
  const entries = [];
  for (const spec of ROLLOVER_LEDGER_SPECS) {
    const path = join(FIXTURE_DIR, spec.filename);
    if (!existsSync(path)) {
      if (allowMissing) continue;
      fail(`${spec.filename} is missing`);
    }
    entries.push({ spec, baseline: readJson(path) });
  }
  return entries;
}

function assertExactProspectiveAdditions(report, baseline) {
  const covered = new Set(baseline.profiles.map((profile) => profile.id));
  const additions = report.profiles.filter((profile) => !covered.has(profile.id));
  assert.deepEqual(
    additions.map((profile) => profile.id).toSorted(),
    prospectiveProfileIds(baseline).toSorted(),
    'profiles outside the historical primary receipt exactly match declared prospective ledgers',
  );
  return additions;
}

function uncoveredProfiles(report, activeEntries) {
  const covered = new Set(
    activeEntries.flatMap((entry) => entry.baseline.profiles.map((profile) => profile.id)),
  );
  return report.profiles.filter((profile) => !covered.has(profile.id));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const mode = process.argv[2] ?? '--check';
if (![
  '--report',
  '--check',
  '--check-primary',
  '--write-baseline',
  '--write-current',
  '--write-supplemental-baseline',
  '--write-rollover-baseline',
].includes(mode)) {
  console.error('usage: node scripts/client-bundle-metrology.mjs [--report|--check|--check-primary|--write-baseline|--write-current|--write-supplemental-baseline|--write-rollover-baseline]');
  process.exit(2);
}

const report = await measure();
if (mode === '--report') {
  await new Promise((resolve, reject) => {
    process.stdout.write(stableJson(report), (error) => (
      error ? reject(error) : resolve()
    ));
  });
  process.exit(0);
}
if (mode === '--write-baseline') {
  if (existsSync(BASELINE_PATH)) fail('baseline.v1.json already exists; the first-run baseline is immutable');
  const additiveIds = new Set(additiveProfileIds());
  const primaryProfiles = report.profiles.filter((profile) => !additiveIds.has(profile.id));
  const baseline = compactBaseline(report, primaryProfiles);
  runBehaviorTrain();
  writeFileSync(BASELINE_PATH, stableJson(baseline));
  const primaryReport = { ...report, profiles: primaryProfiles };
  writeFileSync(CURRENT_PATH, stableJson(withSavings(primaryReport, baseline, [], [])));
  console.log(`client bundle baseline frozen: ${primaryProfiles.length} primary profiles`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) fail('baseline.v1.json is missing');
const baseline = readJson(BASELINE_PATH);
validateMainBaseline(report, baseline);
if (mode === '--check-primary') {
  const supplementals = readSupplementalBaselines({ allowMissing: true });
  for (const { spec, baseline: supplemental } of supplementals) {
    validateSupplementalBaseline(report, spec, supplemental);
  }
  const rollovers = readRolloverBaselines({ allowMissing: true });
  for (const { spec, baseline: rollover } of rollovers) {
    validateRolloverBaseline(report, spec, rollover);
  }
  compareProfiles(
    report,
    activeBaselineEntries(baseline, supplementals, rollovers, {
      retireSpecs: ROLLOVER_LEDGER_SPECS,
    }).map((entry) => entry.baseline),
    { requireComplete: false },
  );
  const additions = assertExactProspectiveAdditions(report, baseline);
  runBehaviorTrain();
  console.log(`client bundle primary baseline passed; ${additions.length} profiles live outside the historical primary receipt`);
  process.exit(0);
}
if (mode === '--write-supplemental-baseline') {
  const supplementals = readSupplementalBaselines({ allowMissing: true });
  for (const { spec, baseline: supplemental } of supplementals) {
    validateSupplementalBaseline(report, spec, supplemental);
  }
  const rollovers = readRolloverBaselines({ allowMissing: true });
  for (const { spec, baseline: rollover } of rollovers) {
    validateRolloverBaseline(report, spec, rollover);
  }
  compareProfiles(
    report,
    activeBaselineEntries(baseline, supplementals, rollovers, {
      retireSpecs: ROLLOVER_LEDGER_SPECS,
    }).map((entry) => entry.baseline),
    { requireComplete: false },
  );
  const additions = assertExactProspectiveAdditions(report, baseline);
  const missing = SUPPLEMENTAL_LEDGER_SPECS.filter(
    (spec) => !existsSync(join(FIXTURE_DIR, spec.filename)),
  );
  if (missing.length !== 1) {
    fail(`expected exactly one unfrozen supplemental ledger, found ${missing.length}`);
  }
  const spec = missing[0];
  const selected = additions.filter((profile) => spec.profileIds.includes(profile.id));
  const supplemental = compactSupplementalBaseline(report, spec, selected);
  runBehaviorTrain();
  writeFileSync(join(FIXTURE_DIR, spec.filename), stableJson(supplemental));
  const frozenSupplementals = readSupplementalBaselines();
  const pendingRollovers = ROLLOVER_LEDGER_SPECS.filter(
    (candidate) => !existsSync(join(FIXTURE_DIR, candidate.filename)),
  );
  if (pendingRollovers.length === 0) {
    writeFileSync(CURRENT_PATH, stableJson(withSavings(report, baseline, frozenSupplementals, rollovers)));
  }
  console.log(`client bundle additive baseline frozen in ${spec.filename}: ${selected.length} profiles`);
  if (pendingRollovers.length > 0) {
    console.log(`current report deferred until ${pendingRollovers.map((entry) => entry.filename).join(', ')} is frozen`);
  }
  process.exit(0);
}
if (mode === '--write-rollover-baseline') {
  const supplementals = readSupplementalBaselines();
  for (const { spec, baseline: supplemental } of supplementals) {
    validateSupplementalBaseline(report, spec, supplemental);
  }
  const rollovers = readRolloverBaselines({ allowMissing: true });
  for (const { spec, baseline: rollover } of rollovers) {
    validateRolloverBaseline(report, spec, rollover);
  }
  const missing = ROLLOVER_LEDGER_SPECS.filter(
    (spec) => !existsSync(join(FIXTURE_DIR, spec.filename)),
  );
  if (missing.length !== 1) {
    fail(`expected exactly one unfrozen rollover ledger, found ${missing.length}`);
  }
  const activeBeforeFreeze = activeBaselineEntries(baseline, supplementals, rollovers, {
    retireSpecs: ROLLOVER_LEDGER_SPECS,
  });
  compareProfiles(
    report,
    activeBeforeFreeze.map((entry) => entry.baseline),
    { requireComplete: false },
  );
  const spec = missing[0];
  const uncovered = uncoveredProfiles(report, activeBeforeFreeze);
  assert.deepEqual(
    uncovered.map((profile) => profile.id).toSorted(),
    spec.profileIds.toSorted(),
    `${spec.filename}: exact uncovered rollover profile ids`,
  );
  const rollover = compactRolloverBaseline(report, spec, uncovered);
  runBehaviorTrain();
  writeFileSync(join(FIXTURE_DIR, spec.filename), stableJson(rollover));
  const frozenRollovers = readRolloverBaselines();
  compareToBaselines(report, baseline, supplementals, frozenRollovers, {
    // The documented write protocol commits implementation, declaration,
    // inventory, and authorities before minting the immutable receipt. During
    // this final self-check the new receipt cannot yet have a Git carrier, so
    // bind it to that exact committed source head. Ordinary --check calls pass
    // no override and still require one reachable carrier introduction.
    uncommittedCarrierRevisions: new Map([[spec.filename, rollover.source.revision]]),
  });
  writeFileSync(
    CURRENT_PATH,
    stableJson(withSavings(report, baseline, supplementals, frozenRollovers)),
  );
  console.log(`client bundle workload rollover frozen in ${spec.filename}: ${uncovered.length} profiles`);
  process.exit(0);
}
const supplementals = readSupplementalBaselines();
const rollovers = readRolloverBaselines();
compareToBaselines(report, baseline, supplementals, rollovers);
const current = withSavings(report, baseline, supplementals, rollovers);
if (mode === '--write-current') {
  runBehaviorTrain();
  writeFileSync(CURRENT_PATH, stableJson(current));
  console.log(`client bundle current report updated: ${report.profiles.length} profiles`);
  process.exit(0);
}

if (!existsSync(CURRENT_PATH)) fail('current.v1.json is missing');
const committed = readFileSync(CURRENT_PATH, 'utf8');
const generated = stableJson(current);
if (committed !== generated) {
  fail('current.v1.json is stale; run node scripts/client-bundle-metrology.mjs --write-current');
}
console.log(`client bundle metrology comparison passed: ${report.profiles.length} profiles, no frozen ceiling regressions; running behavior train`);
runBehaviorTrain();
console.log(`client bundle metrology passed: ${report.profiles.length} profiles, no frozen ceiling regressions`);
