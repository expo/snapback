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
const REACT_IMPLEMENTATION_MODULE = 'packages/snapback-react/implementation.mjs';
const REACT_FULL_CAPABILITIES_MODULE = 'packages/snapback-react/full-capabilities.mjs';
const COMMANDS_MODULE = 'packages/snapback-client/commands.mjs';
const ASSETS_MODULE = 'packages/snapback-client/assets.mjs';
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
  // This framework-adapter seam owns prepared-binding admission and its
  // development-only generation handoff; it is narrow relative to the client
  // root's optional command/assets exports, not to local-sync admission.
  './react-binding',
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
const ORDINARY_CLIENT_NORMALIZATION_LOCAL_SYNC_ABSENCE_PROFILE_IDS = Object.freeze([
  'public-subpath-argument-normalization',
  'public-subpath-diagnostic-error',
  'resolved-public-subpath-argument-normalization',
  'resolved-public-subpath-diagnostic-error',
]);
const ORDINARY_CLIENT_NORMALIZATION_LOCAL_SYNC_ABSENCE_PROFILES = Object.freeze(
  RESOLVED_NARROW_SUBPATH_PROFILES.filter(
    (profile) => (
      ORDINARY_CLIENT_NORMALIZATION_LOCAL_SYNC_ABSENCE_PROFILE_IDS.includes(profile.id)
    ),
  ),
);
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
  Object.freeze({
    filename: 'baseline.remediation.v1.json',
    profileFilename: 'remediation-profiles.v1.json',
    profileIds: Object.freeze([
      'public-subpath-remediation',
      'resolved-public-subpath-remediation',
    ]),
    authorities: Object.freeze([
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0146#oq6-author-ruling--2026-08-10',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/remediation.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.react-core-composition.v1.json',
    profileFilename: 'react-core-composition-profiles.v1.json',
    profileIds: Object.freeze([
      'react-core-application',
      'react-core-capabilities-negative',
      'react-core-query',
      'react-full-capabilities-positive',
      'public-subpath-react-binding',
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0114#prepared-binding-and-provider-ownership',
      'LLP 0145#option-2--static-capability-modules-around-a-shared-kernel',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0179#no-second-owner',
      'LLP 0180#react-and-surface-projections',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-react/package.test.mjs']],
      ['node', ['packages/snapback-react/optimistic-create.test.mjs']],
      ['node', ['packages/snapback-react/surface.test.mjs']],
      ['node', ['packages/snapback-react/commands.test.mjs']],
      ['node', ['packages/snapback-react/assets.test.mjs']],
      ['node', ['scripts/check-package-export-types.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.client-diagnostics.v1.json',
    profileFilename: 'client-diagnostics-profiles.v1.json',
    profileIds: Object.freeze([
      'public-subpath-client-diagnostics',
      'resolved-public-subpath-client-diagnostics',
    ]),
    authorities: Object.freeze([
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0219#channel-semantics',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/client-diagnostics.test.mjs']],
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
const CLIENT_BUNDLE_G3_E2_DISPOSITION_ROLLOVER_PROFILE_IDS = Object.freeze([
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
  Object.freeze({
    filename: 'baseline.client-bundle-disposition.v2.json',
    profileFilename: 'client-bundle-disposition-profiles.v1.json',
    workloadVersion: 'client-bundle-ratchet-disposition.2026-08-06.v2',
    profileIds: CLIENT_BUNDLE_G3_E2_DISPOSITION_ROLLOVER_PROFILE_IDS,
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
      'LLP 0180#input-and-platform-adapters',
      'LLP 0180#authority-and-replacement',
      'LLP 0180#react-and-surface-projections',
      'LLP 0181#e2--online-asset-command',
      'LLP 0059#cross-context-ownership',
    ]),
    rationale: Object.freeze({
      date: '2026-08-06',
      classification: 'reviewed G3/E2 capability and command-lifecycle growth; no assets-subpath import leak found',
      reviewNote: 'The post-E2 module-attribution review found that both assets-only profiles still contain exactly assets.mjs plus their fixture. CommandAssetSource and the Expo picker types are declaration-only; neither commands.mjs nor @expo/snapback-expo crosses the assets export boundary. The 588 minified bytes are the asset owner\'s host-fetch seam and public-immutable delivery URL, both exercised by the landed E2/G3 behavior, so removing them would change that behavior rather than repair an import leak.',
      landedFeatures: Object.freeze({
        g3: '17e7ca8ca feat(client,react,codegen,runtime): image-send command core + S2 commands admission',
        e2: '47b4a59ac feat(expo,fixture): E2 picker adapter + G3 platform receipts',
        commandLifecycle: '02bf40745 fix(client,react): fence command tasks on disposal and stop reporting false ambiguity',
        authCompressionDrift: 'f782431bd fix(auth): custody lock must not span the transition participant barrier',
      }),
      perProfileDisposition: Object.freeze([
        Object.freeze({
          profiles: Object.freeze(['public-subpath-assets', 'resolved-public-subpath-assets']),
          decision: 'ratify',
          justification: '47b4a59ac added the generic host-fetch seam used by Expo binary TUS transport and public-immutable rendition URL construction; attribution proves no command or Expo adapter module is present in either assets-only closure.',
        }),
        Object.freeze({
          profiles: Object.freeze(['public-subpath-commands', 'resolved-public-subpath-commands']),
          decision: 'ratify',
          justification: '47b4a59ac added platform-source normalization to the 17e7ca8ca command engine, and 02bf40745 added the required disposal/authority fence and truthful settlement handling.',
        }),
        Object.freeze({
          profiles: Object.freeze(['external-react-application', 'react-external']),
          decision: 'ratify',
          justification: 'The React closure composes LLP 0179 useSurface/useSnapbackCommand, the 47b4a59ac asset-source and public-delivery projections, and the 02bf40745 provider-disposal fence.',
        }),
        Object.freeze({
          profiles: Object.freeze(['public-subpath-ir-evaluator']),
          decision: 'ratify compressed-output-only drift',
          justification: 'f782431bd changed reachable auth-coordinator correctness code; minified and gzip bytes remain identical while Brotli increases by one byte. No evaluator capability or closure module was added.',
        }),
      ]),
      summary: 'Advance exactly the seven profiles changed by the landed G3/E2 and command-lifecycle work, plus the one-byte reachable-auth compression residue; every predecessor and all unaffected ceilings remain immutable.',
    }),
    beforeAfterProfileIds: CLIENT_BUNDLE_G3_E2_DISPOSITION_ROLLOVER_PROFILE_IDS,
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
      ['node', ['packages/snapback-client/browser-closure.test.mjs']],
      ['node', ['packages/snapback-client/assets.test.mjs']],
      ['node', ['packages/snapback-client/commands.test.mjs']],
      ['node', ['packages/snapback-client/ir-evaluator.test.mjs']],
      ['node', ['packages/snapback-react/package.test.mjs']],
      ['node', ['packages/snapback-react/assets.test.mjs']],
      ['node', ['packages/snapback-react/commands.test.mjs']],
      ['node', ['packages/snapback-react/surface.test.mjs']],
      ['node', ['packages/snapback-expo/package.test.mjs']],
      ['node', ['packages/snapback-expo/asset-source.test.mjs']],
      ['node', ['packages/snapback-expo/provider.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.asset-delivery-selection.v1.json',
    profileFilename: 'client-bundle-disposition-profiles.v1.json',
    workloadVersion: 'asset-delivery-selection.2026-08-07.v1',
    profileIds: Object.freeze(['react-external']),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.client-bundle-disposition.v2.json',
        profileIds: Object.freeze(['react-external']),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0044#delivery-profiles',
      'LLP 0180#react-and-surface-projections',
    ]),
    rationale: Object.freeze({
      date: '2026-08-07',
      fix: 'Charlie-directed strict-URL asset-delivery fix in packages/snapback-react: useSnapbackAssetImage now selects the most-permissive granted URL, holds the rendition-publication race as pending, and diagnoses sessions-mode strict delivery.',
      ticket: 'issues/20260806-asset-image-src-strict-url-sessions.md',
      byteDeltas: 'react-external gzip 28,739 -> 28,751 bytes (+12); Brotli 25,028 -> 25,034 bytes (+6).',
      summary: 'Advance only react-external for the intentional URL-selection and diagnostic strings added by the strict-URL asset-delivery correction; every other active ceiling and the v2 predecessor remain immutable.',
    }),
    beforeAfterProfileIds: Object.freeze(['react-external']),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-react/package.test.mjs']],
      ['node', ['packages/snapback-react/assets.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.dispatch-degrade-and-omission.v1.json',
    profileFilename: 'client-bundle-disposition-profiles.v1.json',
    workloadVersion: 'dispatch-degrade-and-omission.2026-08-07.v1',
    profileIds: Object.freeze(['react-external', 'external-react-application']),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.asset-delivery-selection.v1.json',
        profileIds: Object.freeze(['react-external']),
      }),
      Object.freeze({
        filename: 'baseline.client-bundle-disposition.v2.json',
        profileIds: Object.freeze(['external-react-application']),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0155#local-read-admission',
      'LLP 0179#surfaces',
    ]),
    rationale: Object.freeze({
      date: '2026-08-07',
      fix: 'Three Charlie-directed diary-0066 defect fixes in the client/react packages: declarative mutations degrade to server-delegated dispatch without a durable outbox (25e9674b0), one bounded retry on typed-retryable anonymous stream-reset refusals (37af8f9aa), and omitted optional surface inputs dropped from composed payloads (16a0e140c).',
      ticket: 'issues/20260807-main-red-client-bundle-ratchet-react-external.md',
      byteDeltas: 'react-external min 92,541 -> 92,673 (+132), gzip 28,751 -> 28,802 (+51), brotli 25,034 -> 25,099 (+65); external-react-application min 92,764 -> 92,848 (+84), gzip 28,792 -> 28,850 (+58), brotli 25,118 -> 25,143 (+25).',
      summary: 'Advance the two react profiles for the dispatch-degrade, bounded-retry, and omission-semantics corrections landed 2026-08-07; every other active ceiling and both predecessors remain immutable.',
    }),
    beforeAfterProfileIds: Object.freeze(['react-external', 'external-react-application']),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-react/package.test.mjs']],
      ['node', ['--test', 'packages/snapback-client/generated-mutation-ir.test.mjs']],
      ['node', ['--test', 'packages/snapback-client/connection-open-stream-reset-retry.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.browser-witness-store-fixes.v1.json',
    profileFilename: 'browser-witness-store-fixes-profiles.v1.json',
    workloadVersion: 'browser-carrier-witness-store-fixes.2026-08-07.v1',
    profileIds: Object.freeze([
      'public-subpath-rqs-store',
      'public-subpath-rqs-store-default',
      'public-subpath-rqs-store-file',
    ]),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.client-bundle-disposition.v1.json',
        profileIds: Object.freeze([
          'public-subpath-rqs-store',
          'public-subpath-rqs-store-default',
          'public-subpath-rqs-store-file',
        ]),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0166#d9--carriers-storage-profiles-arms-and-the-bundle',
    ]),
    rationale: Object.freeze({
      date: '2026-08-07',
      fix: 'Browser-carrier public witness defect fix (diary 0067): the IndexedDB '
        + 'store whenLockSettled() resolved only at Web Locks release, wedging '
        + 'every browser outbox drain forever; the fix separates writer/reader '
        + 'adjudication (grant callback or an ordered ifAvailable probe) from '
        + 'the release promise.',
      ticket: 'issues/closed/20260801-guide-gap-js-arm-browser-indexeddb-proof.md',
      byteDeltas: 'public-subpath-rqs-store min 37,597 -> 37,808 (+211), gzip '
        + '13,123 -> 13,199 (+76), brotli 11,580 -> 11,654 (+74); '
        + 'public-subpath-rqs-store-default min 57,291 -> 57,487 (+196), gzip '
        + '17,435 -> 17,456 (+21); public-subpath-rqs-store-file brotli '
        + '11,368 -> 11,416 (+48).',
      summary: 'Advance the three rqs-store closures for the lock-adjudication '
        + 'correctness bytes landed with the 2026-08-07 browser public witness; '
        + 'every other active ceiling and the predecessor remain immutable.',
    }),
    beforeAfterProfileIds: Object.freeze([
      'public-subpath-rqs-store',
      'public-subpath-rqs-store-default',
      'public-subpath-rqs-store-file',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
      ['node', ['packages/snapback-client/browser-closure.test.mjs']],
      ['node', ['packages/snapback-client/outbox-store.test.mjs']],
      ['node', ['packages/snapback-client/rqs-store-file.test.mjs']],
      ['node', ['packages/snapback-client/rqs-resume.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.sessions-custody-offline-queue.v1.json',
    profileFilename: 'sessions-custody-offline-queue-profiles.v1.json',
    workloadVersion: 'js-arm-sessions-custody-offline-queue.2026-08-07.v1',
    profileIds: Object.freeze([
      'external-react-application',
      'public-subpath-outbox-shared',
      'public-subpath-rqs-preload',
      'public-subpath-rqs-registered',
      'public-subpath-rqs-store',
      'public-subpath-rqs-store-default',
      'public-subpath-rqs-store-expo',
      'public-subpath-rqs-store-file',
      'react-external',
    ]),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.dispatch-degrade-and-omission.v1.json',
        profileIds: Object.freeze([
          'external-react-application',
          'react-external',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.client-bundle-disposition.v1.json',
        profileIds: Object.freeze([
          'public-subpath-outbox-shared',
          'public-subpath-rqs-registered',
          'public-subpath-rqs-store-expo',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.local-persistent-store-review-fixes.v1.json',
        profileIds: Object.freeze(['public-subpath-rqs-preload']),
      }),
      Object.freeze({
        filename: 'baseline.browser-witness-store-fixes.v1.json',
        profileIds: Object.freeze([
          'public-subpath-rqs-store',
          'public-subpath-rqs-store-default',
          'public-subpath-rqs-store-file',
        ]),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0043#design',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0166#d9--carriers-storage-profiles-arms-and-the-bundle',
    ]),
    rationale: Object.freeze({
      date: '2026-08-07',
      fix: 'Reconcile the ticketed main drift: landing 55564b1018eb1 '
        + '(feat(client): implement LLP 0043 JS-arm sessions-custody offline '
        + 'queue) grew the shared outbox and every persistent-store arm '
        + 'without advancing the ratchet record. The bytes are the landed '
        + 'sessions-custody offline-queue feature, not an accident; this '
        + 'rollover advances the nine regressed closures to the measured '
        + 'post-landing sizes.',
      ticket: 'issues/closed/20260807-main-drift-client-bundle-metrology-offline-queue.md',
      byteDeltas: 'public-subpath-outbox-shared min 18,377 -> 21,340 (+2,963), '
        + 'gzip 6,494 -> 7,320 (+826), brotli 5,811 -> 6,573 (+762); '
        + 'public-subpath-rqs-store min 37,808 -> 41,447 (+3,639), gzip '
        + '13,199 -> 14,119 (+920), brotli 11,654 -> 12,499 (+845); '
        + 'public-subpath-rqs-store-default min 57,487 -> 62,514 (+5,027); '
        + 'public-subpath-rqs-store-expo min 38,946 -> 42,560 (+3,614); '
        + 'public-subpath-rqs-store-file min 37,481 -> 41,094 (+3,613); '
        + 'react-external min 92,673 -> 93,496 (+823); '
        + 'external-react-application min 92,848 -> 93,671 (+823); '
        + 'public-subpath-rqs-preload brotli 2,177 -> 2,178 (+1); '
        + 'public-subpath-rqs-registered gzip 10,650 -> 10,651 (+1).',
      summary: 'Advance the nine closures regressed by the landed LLP 0043 '
        + 'sessions-custody offline queue to their measured post-landing '
        + 'bytes, per the drift ticket’s first-parent record-epoch '
        + 'attribution. Every predecessor receipt remains immutable and no '
        + 'other active ceiling moves.',
    }),
    beforeAfterProfileIds: Object.freeze([
      'external-react-application',
      'public-subpath-outbox-shared',
      'public-subpath-rqs-preload',
      'public-subpath-rqs-registered',
      'public-subpath-rqs-store',
      'public-subpath-rqs-store-default',
      'public-subpath-rqs-store-expo',
      'public-subpath-rqs-store-file',
      'react-external',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
      ['node', ['packages/snapback-client/browser-closure.test.mjs']],
      ['node', ['packages/snapback-client/outbox-store.test.mjs']],
      ['node', ['packages/snapback-client/outbox-custody.test.mjs']],
      ['node', ['packages/snapback-client/rqs-store.test.mjs']],
      ['node', ['packages/snapback-client/rqs-store-file.test.mjs']],
      ['node', ['packages/snapback-client/rqs-store-expo.test.mjs']],
      ['node', ['packages/snapback-client/rqs-resume.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.single-row-delete-admission.v1.json',
    profileFilename: 'single-row-delete-admission-profiles.v1.json',
    workloadVersion: 'single-row-delete-admission.2026-08-07.v1',
    profileIds: Object.freeze([
      'public-subpath-ir-evaluator',
      'public-subpath-optimistic-rebase',
    ]),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.client-bundle-disposition.v2.json',
        profileIds: Object.freeze(['public-subpath-ir-evaluator']),
      }),
      Object.freeze({
        filename: 'baseline.move3-single-table-lifecycle.v1.json',
        profileIds: Object.freeze(['public-subpath-optimistic-rebase']),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0129#phases',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0166#d9--carriers-storage-profiles-arms-and-the-bundle',
    ]),
    rationale: Object.freeze({
      date: '2026-08-07',
      fix: 'Single-row Delete admitted into the M1 local evaluator verb set '
        + 'by author ruling 2026-08-07 (LLP 0129 Phase 2a): at most one '
        + 'Delete step per plan, one row by id, ChangedCount semantics. The '
        + 'bytes are the classifier admission (ir-evaluator), the Delete '
        + 'point-read coverage (local-read-admission, absorbed within its '
        + 'ceiling), and the private-layer delete fold (optimistic-rebase).',
      ticket: 'issues/closed/20260807-single-row-delete-effect-ceiling.md',
      byteDeltas: 'public-subpath-ir-evaluator min 21,295 -> 21,407 (+112), '
        + 'gzip 7,615 -> 7,644 (+29), brotli 6,740 -> 6,760 (+20); '
        + 'public-subpath-optimistic-rebase brotli 12,744 -> 12,791 (+47).',
      summary: 'Advance the two closures grown by the 2026-08-07 single-row '
        + 'Delete admission (browser-IR coverage gate: common-path 11/12 -> '
        + '12/12, receipt browser-ir-coverage.2026-08-07.v3). Every other '
        + 'active ceiling and both predecessors remain immutable.',
    }),
    beforeAfterProfileIds: Object.freeze([
      'public-subpath-ir-evaluator',
      'public-subpath-optimistic-rebase',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
      ['node', ['packages/snapback-client/browser-closure.test.mjs']],
      ['node', ['packages/snapback-client/ir-evaluator.test.mjs']],
      ['node', ['packages/snapback-client/local-read-admission.test.mjs']],
      ['node', ['packages/snapback-client/optimistic-rebase.test.mjs']],
      ['node', ['packages/snapback-client/optimistic-rebase-acceptance.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.llp-0200-settlement-isolation.v1.json',
    profileFilename: 'client-bundle-disposition-profiles.v1.json',
    workloadVersion: 'llp-0200-phase1.2026-08-09.v1',
    profileIds: Object.freeze([
      'external-react-application',
      'public-subpath-external-store',
      'public-subpath-optimistic-rebase',
      'public-subpath-rqs-registered',
      'react-external',
      'resolved-public-subpath-external-store',
    ]),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.sessions-custody-offline-queue.v1.json',
        profileIds: Object.freeze([
          'external-react-application',
          'public-subpath-rqs-registered',
          'react-external',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.v1.json',
        profileIds: Object.freeze(['public-subpath-external-store']),
      }),
      Object.freeze({
        filename: 'baseline.single-row-delete-admission.v1.json',
        profileIds: Object.freeze(['public-subpath-optimistic-rebase']),
      }),
      Object.freeze({
        filename: 'baseline.local-sync-absence.v1.json',
        profileIds: Object.freeze(['resolved-public-subpath-external-store']),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0200#21-settlement-is-decoupled-from-subscriber-work',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0166#d9--carriers-storage-profiles-arms-and-the-bundle',
    ]),
    rationale: Object.freeze({
      date: '2026-08-09',
      fix: 'LLP 0200 Phase 1 adds watermark-gated optimistic-overlay release '
        + 'and version-regression guards to packages/snapback-contract/index.mjs, '
        + 'the ordering audit\'s top-risk fix for settlement isolation\'s '
        + 'causal-version handoff.',
      ticket: 'issues/closed/20260808-oq4-coalescing-measurement-spike.md',
      byteDeltas: 'external-react-application min 93671->94180, gzip '
        + '29049->29204, brotli 25347->25517; public-subpath-external-store '
        + 'min 9767->10114, gzip 3539->3642, brotli 3189->3277; '
        + 'public-subpath-optimistic-rebase min 45395->45602, gzip '
        + '14291->14397, brotli 12791->12818; public-subpath-rqs-registered '
        + 'min 32045->32144, gzip 10651->10686, brotli 9371->9389; '
        + 'react-external min 93496->94005, gzip 29002->29151, brotli '
        + '25296->25426; resolved-public-subpath-external-store min '
        + '9776->10123, gzip 3544->3647, brotli 3196->3280.',
      summary: 'Advance exactly the six closures grown by LLP 0200 Phase 1\'s '
        + 'watermark-gated overlay release and version-regression guards; '
        + 'every other active ceiling and all four predecessors remain immutable.',
    }),
    beforeAfterProfileIds: Object.freeze([
      'external-react-application',
      'public-subpath-external-store',
      'public-subpath-optimistic-rebase',
      'public-subpath-rqs-registered',
      'react-external',
      'resolved-public-subpath-external-store',
    ]),
    behaviorCommands: Object.freeze([
      ['bun', ['run', '--cwd', 'packages/snapback-contract', 'test']],
      ['node', ['packages/snapback-client/package.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.queued-settlement-truthfulness.v1.json',
    profileFilename: 'client-bundle-disposition-profiles.v1.json',
    workloadVersion: 'queued-settlement-truthfulness.2026-08-09.v1',
    profileIds: Object.freeze([
      'external-react-application',
      'react-external',
    ]),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.llp-0200-settlement-isolation.v1.json',
        profileIds: Object.freeze([
          'external-react-application',
          'react-external',
        ]),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0043#raw-settlement-facts-and-projection-ownership-2026-07-20-llp-0063-step-1',
      'LLP 0114#exact-identity-bytes-and-limits',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
    ]),
    rationale: Object.freeze({
      date: '2026-08-09',
      fix: 'Queued-mutation settlement truthfulness adds the distinct '
        + 'SnapbackQueuedMutationError rejection class with dev queue/wedge '
        + 'warnings, and the content-keyed useSnapbackQuery/useSnapbackPresence '
        + 'dependency fix, to packages/snapback-react/index.mjs — the two P2 '
        + 'client-contract defects from the LLP 0201 Clique pilot.',
      ticket: 'issues/closed/20260809-queued-mutation-settlement-truthfulness.md',
      byteDeltas: 'external-react-application min 94180->95915, gzip '
        + '29204->29868, brotli 25517->26041; react-external min '
        + '94005->95740, gzip 29151->29812, brotli 25426->26044.',
      summary: 'Advance exactly the two React-closure ceilings grown by the '
        + 'queued-settlement rejection class and canonical content-keyed hook '
        + 'dependencies; every other active ceiling and the LLP 0200 '
        + 'settlement-isolation predecessor remain immutable.',
    }),
    beforeAfterProfileIds: Object.freeze([
      'external-react-application',
      'react-external',
    ]),
    behaviorCommands: Object.freeze([
      ['bun', ['run', '--cwd', 'packages/snapback-react', 'test']],
      ['node', ['packages/snapback-client/package.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.asset-upload-dx.v1.json',
    profileFilename: 'client-bundle-disposition-profiles.v1.json',
    workloadVersion: 'asset-upload-dx.2026-08-09.v1',
    profileIds: Object.freeze([
      'external-react-application',
      'public-subpath-assets',
      'public-subpath-commands',
      'react-external',
      'resolved-public-subpath-assets',
      'resolved-public-subpath-commands',
    ]),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.queued-settlement-truthfulness.v1.json',
        profileIds: Object.freeze([
          'external-react-application',
          'react-external',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.client-bundle-disposition.v2.json',
        profileIds: Object.freeze([
          'public-subpath-assets',
          'public-subpath-commands',
          'resolved-public-subpath-assets',
          'resolved-public-subpath-commands',
        ]),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0210#d1--client-arm-signed-issuance-and-ttl-refresh-projection',
      'LLP 0210#d3--assetsupload-and-the-taskdone-contract',
    ]),
    rationale: Object.freeze({
      date: '2026-08-09',
      fix: 'LLP 0210 D1/D3 client asset surface: assets.signedUrl() '
        + 'issuance under custody headers, the framework-neutral issued-URL '
        + 'controller (keyed refresh loop, five-state algebra, authority '
        + 'fencing, linger eviction), the one-call assets.upload() '
        + 'convenience over the frozen terminal table, and the typed '
        + 'SNAPBACK_ASSET_RETRY_INELIGIBLE eligibility refusal — all in '
        + 'packages/snapback-client/assets.mjs, which the assets, commands, '
        + 'and React closures include.',
      ticket: 'issues/20260809-asset-upload-dx-papercuts-g11.md',
      byteDeltas: 'external-react-application min 95915->104131, gzip '
        + '29868->32163, brotli 26041->28073; public-subpath-assets min '
        + '15817->23860, gzip 6022->8467, brotli 5208->7429; '
        + 'public-subpath-commands min 27795->35860, gzip 9392->11683, '
        + 'brotli 8203->10265; react-external min 95740->103956, gzip '
        + '29812->32107, brotli 26044->27991; resolved-public-subpath-assets '
        + 'min 15826->23869, gzip 6027->8472, brotli 5216->7421; '
        + 'resolved-public-subpath-commands min 27804->35869, gzip '
        + '9398->11690, brotli 8202->10265.',
      summary: 'Advance exactly the six closures that include assets.mjs '
        + 'for the reviewed LLP 0210 D1/D3 delivery surface (Review, '
        + 'dual-family loop converged at r3); every other active ceiling '
        + 'and both predecessors remain immutable.',
    }),
    beforeAfterProfileIds: Object.freeze([
      'external-react-application',
      'public-subpath-assets',
      'public-subpath-commands',
      'react-external',
      'resolved-public-subpath-assets',
      'resolved-public-subpath-commands',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['--test', 'packages/snapback-client/assets.test.mjs']],
      ['node', ['--test', 'packages/snapback-client/commands.test.mjs']],
      ['node', ['packages/snapback-client/package.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.asset-url-hook.v1.json',
    profileFilename: 'client-bundle-disposition-profiles.v1.json',
    workloadVersion: 'asset-url-hook.2026-08-09.v1',
    profileIds: Object.freeze([
      'external-react-application',
      'react-external',
    ]),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.asset-upload-dx.v1.json',
        profileIds: Object.freeze([
          'external-react-application',
          'react-external',
        ]),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0210#d1--client-arm-signed-issuance-and-ttl-refresh-projection',
      'LLP 0114#named-projections-from-accepted-rfcs',
    ]),
    rationale: Object.freeze({
      date: '2026-08-09',
      fix: 'useSnapbackAssetUrl (LLP 0210 D1 React projection): a '
        + 'content-keyed useSyncExternalStore projection over the '
        + 'framework-neutral issued-URL store, with the stable refresh() '
        + 'denied-exit affordance, in packages/snapback-react/index.mjs.',
      ticket: 'issues/20260809-asset-upload-dx-papercuts-g11.md',
      byteDeltas: 'external-react-application min 104131->104633, gzip '
        + '32163->32305, brotli 28073->28170; react-external min '
        + '103956->104458, gzip 32107->32252, brotli 27991->28086.',
      summary: 'Advance exactly the two React closures for the thin '
        + 'issued-URL hook projection; every other active ceiling and the '
        + 'asset-upload-dx predecessor remain immutable.',
    }),
    beforeAfterProfileIds: Object.freeze([
      'external-react-application',
      'react-external',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['--test', 'packages/snapback-react/assets.test.mjs']],
      ['node', ['packages/snapback-react/package.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.search-prewitness-refusal.v1.json',
    profileFilename: 'client-bundle-disposition-profiles.v1.json',
    workloadVersion: 'search-prewitness-refusal.2026-08-10.v1',
    profileIds: Object.freeze([
      'external-react-application',
      'react-external',
    ]),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.asset-url-hook.v1.json',
        profileIds: Object.freeze([
          'external-react-application',
          'react-external',
        ]),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0131#amendment-2026-08-09-typed-search-selector-witness-for-resource-scoped-references',
    ]),
    rationale: Object.freeze({
      date: '2026-08-10',
      landing: '9da5f79e1defaa234d97ae213ecd7c204819fb33',
      fix: 'The landed clique-review fix-forward explicitly refuses generated '
        + 'search references that predate searchRequestContractHash before I/O '
        + 'with a regeneration hint, and rewords the React durable-queue wedge '
        + 'warning so bounded diagnostic history does not falsely identify a '
        + 'specific blocking mutation. Both changes are regression-tested.',
      ticket: 'issues/20260809-clique-defect-fixes-review-minors.md',
      standingPolicy: 'LLP 0145 Phase A, 2026-08-10 author ruling: attributed '
        + 'growth from a landed, receipted fix takes an automatic blessed rollover.',
      byteDeltas: 'external-react-application min 104633->104691 (+58), gzip '
        + '32305->32328 (+23), brotli 28170->28200 (+30); react-external min '
        + '104458->104516 (+58), gzip 32252->32275 (+23), brotli '
        + '28086->28138 (+52).',
      summary: 'Advance exactly the two React closures for the landed search '
        + 'pre-witness refusal and truthful queue-wedge diagnostic; every other '
        + 'active ceiling and the asset-url-hook predecessor remain immutable.',
    }),
    beforeAfterProfileIds: Object.freeze([
      'external-react-application',
      'react-external',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
      ['node', ['packages/snapback-react/package.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.rqs-store-competing-writer.v1.json',
    profileFilename: 'sessions-custody-offline-queue-profiles.v1.json',
    workloadVersion: 'rqs-store-competing-writer.2026-08-10.v1',
    profileIds: Object.freeze([
      'public-subpath-rqs-store-default',
      'public-subpath-rqs-store-expo',
      'public-subpath-rqs-store-file',
    ]),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.sessions-custody-offline-queue.v1.json',
        profileIds: Object.freeze([
          'public-subpath-rqs-store-default',
          'public-subpath-rqs-store-expo',
          'public-subpath-rqs-store-file',
        ]),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0090#d3-channel-b--persisted-device-snapshot',
    ]),
    rationale: Object.freeze({
      date: '2026-08-10',
      landing: '4a19761fed343c5aa1659b13af05385221817047',
      fix: 'The landed supervisor RQS custody fix makes the file store name '
        + 'its competing writer: SNAPBACK_REACT_BINDING_RECEIPT_NOT_PERSISTED '
        + 'now carries the competing PID (when known), instance id, lock '
        + 'path, and store path, so a stolen single-writer lock is '
        + 'diagnosable at the refusal instead of by filesystem archaeology. '
        + 'Regression-tested (rqs-store-file suite, same-process and live '
        + 'foreign-writer cases).',
      ticket: 'issues/closed/20260808-rqs-dir-env-leak-supervisor-child.md',
      standingPolicy: 'LLP 0145 Phase A, 2026-08-10 author ruling: attributed '
        + 'growth from a landed, receipted fix takes an automatic blessed rollover.',
      byteDeltas: 'public-subpath-rqs-store-default min 62514->63119 (+605), '
        + 'gzip 18512->18720 (+208), brotli 16319->16461 (+142); '
        + 'public-subpath-rqs-store-expo min 42560->43152 (+592), gzip '
        + '14080->14275 (+195), brotli 12451->12656 (+205); '
        + 'public-subpath-rqs-store-file min 41094->41690 (+596), gzip '
        + '13779->13971 (+192), brotli 12227->12401 (+174).',
      summary: 'Advance exactly the three RQS store closures for the landed '
        + 'competing-writer refusal diagnostics; every other active ceiling '
        + 'and the sessions-custody predecessor remain immutable.',
    }),
    beforeAfterProfileIds: Object.freeze([
      'public-subpath-rqs-store-default',
      'public-subpath-rqs-store-expo',
      'public-subpath-rqs-store-file',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/rqs-store-file.test.mjs']],
      ['node', ['packages/snapback-client/rqs-store.test.mjs']],
      ['node', ['packages/snapback-client/package.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.lease-custody-and-remediation.v1.json',
    profileFilename: 'sessions-custody-offline-queue-profiles.v1.json',
    workloadVersion: 'lease-custody-and-remediation.2026-08-10.v1',
    profileIds: Object.freeze([
      'external-react-application',
      'public-subpath-rqs-preload',
      'public-subpath-rqs-registered',
      'public-subpath-rqs-store',
      'public-subpath-rqs-store-default',
      'public-subpath-rqs-store-expo',
      'public-subpath-rqs-store-file',
      'react-external',
    ]),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.search-prewitness-refusal.v1.json',
        profileIds: Object.freeze([
          'external-react-application',
          'react-external',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.sessions-custody-offline-queue.v1.json',
        profileIds: Object.freeze([
          'public-subpath-rqs-preload',
          'public-subpath-rqs-store',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.llp-0200-settlement-isolation.v1.json',
        profileIds: Object.freeze(['public-subpath-rqs-registered']),
      }),
      Object.freeze({
        filename: 'baseline.rqs-store-competing-writer.v1.json',
        profileIds: Object.freeze([
          'public-subpath-rqs-store-default',
          'public-subpath-rqs-store-expo',
          'public-subpath-rqs-store-file',
        ]),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0043#m1--custody',
      'LLP 0146#oq6-author-ruling--2026-08-10',
    ]),
    rationale: Object.freeze({
      date: '2026-08-10',
      landing: '313c3ed508ce6f43a47b549462a2fa095819afc5',
      fix: 'Two landed, receipted features compose here. (1) JS-arm '
        + 'lease-bounded protected retention (LLP 0043 M1 custody): '
        + 'protected-custody metadata slot, additive v3 store migration, '
        + 'lease validation with equality expiry and delete-before-render, '
        + 'plus the dev-only live-hook args-churn warning seam on the React '
        + 'entries. (2) The LLP 0146 option-B remediation carrier landed on '
        + 'main without advancing the React ceilings; its decoder import is '
        + 'part of the React closure growth ratified here.',
      ticket: 'issues/20260731-js-arm-lease-custody-and-sessions-outbox.md',
      standingPolicy: 'LLP 0145 Phase A, 2026-08-10 author ruling: attributed '
        + 'growth from a landed, receipted fix takes an automatic blessed rollover.',
      byteDeltas: 'external-react-application min 104691->106237 (+1546), '
        + 'gzip 32328->32708 (+380), brotli 28200->28545 (+345); '
        + 'react-external min 104516->106062 (+1546), gzip 32275->32653 '
        + '(+378), brotli 28138->28483 (+345); rqs-preload min 5549->5624 '
        + '(+75); rqs-registered min 32144->32218 (+74); rqs-store min '
        + '41447->41599 (+152); rqs-store-default min 63119->63271 (+152); '
        + 'rqs-store-expo min 43152->43304 (+152); rqs-store-file min '
        + '41690->41842 (+152); gzip/brotli deltas proportional per the '
        + 'frozen receipt.',
      summary: 'Advance the two React closures (lease custody seam, '
        + 'args-churn dev guard, and the previously unratified remediation '
        + 'decoder import) and the six RQS closures for the protected-'
        + 'custody metadata slot; all other active ceilings and the four '
        + 'predecessors remain immutable.',
    }),
    beforeAfterProfileIds: Object.freeze([
      'external-react-application',
      'public-subpath-rqs-preload',
      'public-subpath-rqs-registered',
      'public-subpath-rqs-store',
      'public-subpath-rqs-store-default',
      'public-subpath-rqs-store-expo',
      'public-subpath-rqs-store-file',
      'react-external',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
      ['node', ['packages/snapback-client/rqs-store.test.mjs']],
      ['node', ['packages/snapback-client/rqs-store-file.test.mjs']],
      ['node', ['packages/snapback-react/package.test.mjs']],
      ['node', ['packages/snapback-client/remediation.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.live-wire-replay-seam.v1.json',
    profileFilename: 'sessions-custody-offline-queue-profiles.v1.json',
    workloadVersion: 'live-wire-replay-seam.2026-08-10.v1',
    profileIds: Object.freeze(['react-external']),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.lease-custody-and-remediation.v1.json',
        profileIds: Object.freeze(['react-external']),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
    ]),
    rationale: Object.freeze({
      date: '2026-08-10',
      landing: '3c0bec2d3e2dd24fe1f103bf5e67a049398260b1',
      classification: 'ratify compressed-output-only drift',
      fix: 'The live-wire fixture replay lane extracted a shared '
        + 'live-wire-core seam from the client entry; minified and gzip '
        + 'bytes are unchanged on react-external while Brotli shifts by '
        + 'five bytes from content reordering. No new module enters the '
        + 'React closure (the replay module is test-only).',
      ticket: 'issues/20260808-integration-coverage-gaps.md',
      standingPolicy: 'LLP 0145 Phase A, 2026-08-10 author ruling: attributed '
        + 'growth from a landed, receipted fix takes an automatic blessed rollover.',
      byteDeltas: 'react-external brotli 28483 -> 28488 (+5); minified and '
        + 'gzip unchanged.',
      summary: 'Advance only react-external Brotli for the landed replay-seam '
        + 'content shift; every other ceiling and the predecessor remain immutable.',
    }),
    beforeAfterProfileIds: Object.freeze(['react-external']),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
      ['node', ['packages/snapback-react/package.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.react-optimistic-create.v1.json',
    profileFilename: 'sessions-custody-offline-queue-profiles.v1.json',
    workloadVersion: 'react-optimistic-create.2026-08-10.v1',
    profileIds: Object.freeze([
      'external-react-application',
      'react-external',
    ]),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.lease-custody-and-remediation.v1.json',
        profileIds: Object.freeze(['external-react-application']),
      }),
      Object.freeze({
        filename: 'baseline.live-wire-replay-seam.v1.json',
        profileIds: Object.freeze(['react-external']),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
    ]),
    rationale: Object.freeze({
      date: '2026-08-10',
      landing: '26fb0b9484e1c0a782dc1c2a62e4c179decdc05f',
      fix: 'Provider-owned useSnapbackOptimisticCreate: distinct provisional '
        + 'identity type, canonical-query projection, settlement/replay '
        + 'handling, and authority fencing — closes the clients.optimistic-'
        + 'create GAP row (promoted to local/shipped) with package tests and '
        + 'served acceptance coverage.',
      ticket: 'issues/closed/20260808-first-class-react-optimistic-create.md',
      standingPolicy: 'LLP 0145 Phase A, 2026-08-10 author ruling: attributed '
        + 'growth from a landed, receipted fix takes an automatic blessed rollover.',
      byteDeltas: 'external-react-application min 106237->115001 (+8764), '
        + 'gzip 32708->34883 (+2175), brotli 28545->30483 (+1938); '
        + 'react-external min 106062->114826 (+8764), gzip 32652->34830 '
        + '(+2178), brotli 28488->30450 (+1962).',
      summary: 'Advance exactly the two React closures for the landed '
        + 'optimistic-create surface; every other active ceiling and both '
        + 'predecessors remain immutable.',
    }),
    beforeAfterProfileIds: Object.freeze([
      'external-react-application',
      'react-external',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-react/package.test.mjs']],
      ['node', ['packages/snapback-client/package.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.outbox-drain-controller.v1.json',
    profileFilename: 'client-bundle-disposition-profiles.v1.json',
    workloadVersion: 'llp-0218-outbox-drain-controller.2026-08-10.v1',
    profileIds: Object.freeze([
      'external-react-application',
      'public-subpath-rqs-registered',
      'public-subpath-rqs-store',
      'public-subpath-rqs-store-default',
      'public-subpath-rqs-store-file',
      'react-external',
    ]),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.react-optimistic-create.v1.json',
        profileIds: Object.freeze([
          'external-react-application',
          'react-external',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.lease-custody-and-remediation.v1.json',
        profileIds: Object.freeze([
          'public-subpath-rqs-registered',
          'public-subpath-rqs-store',
          'public-subpath-rqs-store-default',
          'public-subpath-rqs-store-file',
        ]),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0218#43-the-platform-owned-drain',
    ]),
    rationale: Object.freeze({
      date: '2026-08-10',
      summary: 'Advance exactly the six closures grown by LLP 0218 P2\'s '
        + 'platform-owned startOutboxDrain controller, including barrier '
        + 'establishment and capped backoff, plus the writer-lock notification '
        + 'seams in rqs-store.mjs and rqs-store-memory.mjs; LLP 0218 §4.3 is '
        + 'the accepted authority for these intentional correctness and feature bytes.',
    }),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/outbox-drain.test.mjs']],
      ['node', ['packages/snapback-client/outbox-store.test.mjs']],
      ['node', ['packages/snapback-client/browser-closure.test.mjs']],
      ['node', ['packages/snapback-react/offline.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.react-composition-merge-residue.v1.json',
    profileFilename: 'sessions-custody-offline-queue-profiles.v1.json',
    workloadVersion: 'react-composition-merge-residue.2026-08-10.v1',
    profileIds: Object.freeze([
      'public-subpath-react-binding',
      'react-external',
      'react-full-capabilities-positive',
    ]),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.react-core-composition.v1.json',
        profileIds: Object.freeze([
          'public-subpath-react-binding',
          'react-full-capabilities-positive',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.outbox-drain-controller.v1.json',
        profileIds: Object.freeze(['react-external']),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
    ]),
    rationale: Object.freeze({
      date: '2026-08-10',
      landing: '0fbdc5ff0688d1a9134eb1893bbd0448cb1bfb07',
      classification: 'merge-composition residue across same-day landed features',
      fix: 'The react-core composition receipt was minted pre-rebase; the '
        + 'final merged tree composes it with the same-day optimistic-create '
        + 'and outbox drain-controller landings, growing react-binding '
        + '(+339 min), full-capabilities-positive (+189 min), and '
        + 'react-external Brotli (+35). All three landings are receipted '
        + 'features with their own rollovers; this entry ratifies only their '
        + 'composition on the merged tree.',
      ticket: 'issues/closed/20260806-react-optional-capability-composition.md',
      standingPolicy: 'LLP 0145 Phase A, 2026-08-10 author ruling: attributed '
        + 'growth from a landed, receipted fix takes an automatic blessed rollover.',
      byteDeltas: 'public-subpath-react-binding min 65065->65404 (+339), gzip '
        + '19570->19689 (+119), brotli 17322->17408 (+86); react-external '
        + 'brotli 30484->30519 (+35), min/gzip unchanged; '
        + 'react-full-capabilities-positive min 68023->68212 (+189), gzip '
        + '22333->22409 (+76), brotli 19461->19530 (+69).',
      summary: 'Ratify the merged-tree composition of the three same-day '
        + 'receipted React landings; all other ceilings and both '
        + 'predecessors remain immutable.',
    }),
    beforeAfterProfileIds: Object.freeze([
      'public-subpath-react-binding',
      'react-external',
      'react-full-capabilities-positive',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-react/package.test.mjs']],
      ['node', ['packages/snapback-client/package.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.outbox-settlement-react-contract.v1.json',
    profileFilename: 'client-bundle-disposition-profiles.v1.json',
    workloadVersion: 'llp-0218-react-contract.2026-08-10.v1',
    profileIds: Object.freeze([
      'external-react-application',
      'public-subpath-react-binding',
      'react-core-application',
      'react-core-capabilities-negative',
      'react-core-query',
      'react-external',
      'react-full-capabilities-positive',
    ]),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.outbox-drain-controller.v1.json',
        profileIds: Object.freeze(['external-react-application']),
      }),
      Object.freeze({
        filename: 'baseline.react-core-composition.v1.json',
        profileIds: Object.freeze([
          'react-core-application',
          'react-core-capabilities-negative',
          'react-core-query',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.react-composition-merge-residue.v1.json',
        profileIds: Object.freeze([
          'public-subpath-react-binding',
          'react-external',
          'react-full-capabilities-positive',
        ]),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0218#42-the-optimistic-contract-exact',
    ]),
    rationale: Object.freeze({
      date: '2026-08-10',
      summary: 'Advance exactly the two React closures grown by LLP 0218 '
        + 'P3: the queued/settled dispatch union with provider-stamped '
        + 'presentation, the subscribeMutation-driven total disposition map '
        + 'that lets installed layers survive enqueue (the M7 fix), the '
        + 'provider-owned drain lifecycle, and the extended outbox '
        + 'projection with custody affordances; LLP 0218 §4.1-4.3 is the '
        + 'accepted authority for these feature bytes.',
    }),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-react/offline.test.mjs']],
      ['node', ['packages/snapback-react/optimistic.test.mjs']],
      ['node', ['packages/snapback-react/package.test.mjs']],
      ['node', ['packages/snapback-client/outbox-drain.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.outbox-dev-diagnostic-propagation.v1.json',
    profileFilename: 'client-bundle-disposition-profiles.v1.json',
    workloadVersion: 'llp-0218-p4-propagation.2026-08-10.v1',
    profileIds: Object.freeze([
      'external-react-application',
      'public-subpath-ir-evaluator',
      'public-subpath-optimistic-rebase',
      'react-core-application',
      'react-core-capabilities-negative',
      'react-core-query',
      'react-external',
      'react-full-capabilities-positive',
    ]),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.outbox-settlement-react-contract.v1.json',
        profileIds: Object.freeze([
          'external-react-application',
          'react-core-application',
          'react-core-capabilities-negative',
          'react-core-query',
          'react-external',
          'react-full-capabilities-positive',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.single-row-delete-admission.v1.json',
        profileIds: Object.freeze(['public-subpath-ir-evaluator']),
      }),
      Object.freeze({
        filename: 'baseline.llp-0200-settlement-isolation.v1.json',
        profileIds: Object.freeze(['public-subpath-optimistic-rebase']),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0218#44-dev-diagnostic',
    ]),
    rationale: Object.freeze({
      date: '2026-08-10',
      summary: 'Advance the eight closures grown by LLP 0218 P4: the client '
        + 'relinquishment diagnostic emission point (the LLP 0219 attachment '
        + 'seam) with reason-class/drain-mode facts, the React first-in-'
        + 'session loud promotion, and the Expo drain-prop pass-through; '
        + 'LLP 0218 SS4.4 is the accepted authority for these bytes.',
    }),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/outbox-store.test.mjs']],
      ['node', ['packages/snapback-react/offline.test.mjs']],
      ['node', ['packages/snapback-contract/online-surface.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.client-dev-diagnostics.v1.json',
    profileFilename: 'sessions-custody-offline-queue-profiles.v1.json',
    workloadVersion: 'client-dev-diagnostics.2026-08-10.v1',
    profileIds: Object.freeze([
      'external-react-application',
      'public-subpath-react-binding',
      'public-subpath-rqs-registered',
      'react-core-application',
      'react-core-capabilities-negative',
      'react-core-query',
      'react-external',
      'react-full-capabilities-positive',
    ]),
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.outbox-dev-diagnostic-propagation.v1.json',
        profileIds: Object.freeze([
          'external-react-application',
          'react-core-application',
          'react-core-capabilities-negative',
          'react-core-query',
          'react-external',
          'react-full-capabilities-positive',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.outbox-settlement-react-contract.v1.json',
        profileIds: Object.freeze(['public-subpath-react-binding']),
      }),
      Object.freeze({
        filename: 'baseline.outbox-drain-controller.v1.json',
        profileIds: Object.freeze(['public-subpath-rqs-registered']),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0219#channel-semantics',
      'LLP 0219#producers-pilot-scoped-detectors',
      'LLP 0219#consumers-and-compatibility',
    ]),
    rationale: Object.freeze({
      date: '2026-08-10',
      landing: 'a0df98620ecf45f9a8d9f5af539cef214ba37793',
      fix: 'LLP 0219 adds a bounded per-client dev diagnostics channel: '
        + 'the new @expo/snapback-client/client-diagnostics public subpath, '
        + 'default dev console reporter and channel-owned queue-wedge condition '
        + 'wired into the client index, React subscription and presence churn '
        + 'detectors, useSnapbackDiagnostics()/observeSnapbackDiagnostics(), '
        + 'and existing React warning reroutes through the channel. The re-land '
        + 'attaches queued delivery to LLP 0218 P3\'s resolved dispatch union '
        + 'and provider-owned drain without restoring pre-P3 semantics.',
      ticket: 'issues/closed/20260809-outbox-silent-queue-dx.md',
      standingPolicy: 'LLP 0145 Phase A, 2026-08-10 author ruling: attributed '
        + 'growth from a landed, receipted fix takes an automatic blessed rollover.',
      byteDeltas: 'external-react-application min 120201->124379 (+4178), '
        + 'gzip 36362->37615 (+1253), brotli 31731->32778 (+1047); '
        + 'react-core-application min 65413->69599 (+4186), gzip '
        + '20329->21593 (+1264), brotli 17804->18917 (+1113); '
        + 'react-core-capabilities-negative min 75300->80570 (+5270), gzip '
        + '23232->24751 (+1519), brotli 20231->21630 (+1399); '
        + 'react-core-query min 64466->68650 (+4184), gzip 20072->21315 '
        + '(+1243), brotli 17601->18660 (+1059); '
        + 'react-external min 120003->124181 (+4178), gzip 36288->37552 '
        + '(+1264), brotli 31659->32740 (+1081); '
        + 'react-full-capabilities-positive min 68366->68516 (+150), gzip '
        + '22499->22577 (+78), brotli 19585->19659 (+74).',
      summary: 'Advance the two legacy React application closures plus the '
        + 'four core/full composition closures introduced by main\'s React '
        + 'restructure and grown by LLP 0219\'s channel producers, observers, '
        + 'hook, and warning reroutes; every other active ceiling and the P3 '
        + 'predecessor remain immutable.',
    }),
    beforeAfterProfileIds: Object.freeze([
      'external-react-application',
      'public-subpath-react-binding',
      'public-subpath-rqs-registered',
      'react-core-application',
      'react-core-capabilities-negative',
      'react-core-query',
      'react-external',
      'react-full-capabilities-positive',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/package.test.mjs']],
      ['node', ['packages/snapback-client/client-diagnostics.test.mjs']],
      ['node', ['packages/snapback-react/package.test.mjs']],
      ['node', ['packages/snapback-react/dev-diagnostics.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.ordinary-client-normalization.v1.json',
    profileFilename: 'client-bundle-disposition-profiles.v1.json',
    workloadVersion: 'ordinary-client-normalization.2026-08-12.v1',
    worktreeCarrierPolicy: 'same-head',
    profileIds: Object.freeze([
      'external-react-application',
      ...ORDINARY_CLIENT_NORMALIZATION_LOCAL_SYNC_ABSENCE_PROFILE_IDS,
      'public-subpath-canonical-client-value',
      'public-subpath-outbox-shared',
      'public-subpath-react-binding',
      'public-subpath-result-transform',
      'public-subpath-rqs-preload',
      'public-subpath-rqs-registered',
      'public-subpath-rqs-store',
      'public-subpath-rqs-store-default',
      'public-subpath-rqs-store-expo',
      'public-subpath-rqs-store-file',
      'react-core-application',
      'react-core-capabilities-negative',
      'react-core-query',
      'react-external',
      'react-full-capabilities-positive',
      'resolved-public-subpath-agent-authority',
      'resolved-public-subpath-canonical-client-value',
    ]),
    derivedProfiles: ORDINARY_CLIENT_NORMALIZATION_LOCAL_SYNC_ABSENCE_PROFILES,
    predecessors: Object.freeze([
      Object.freeze({
        filename: 'baseline.client-dev-diagnostics.v1.json',
        profileIds: Object.freeze([
          'external-react-application',
          'public-subpath-react-binding',
          'public-subpath-rqs-registered',
          'react-core-application',
          'react-core-capabilities-negative',
          'react-core-query',
          'react-external',
          'react-full-capabilities-positive',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.v1.json',
        profileIds: Object.freeze(['public-subpath-canonical-client-value']),
      }),
      Object.freeze({
        filename: 'baseline.sessions-custody-offline-queue.v1.json',
        profileIds: Object.freeze(['public-subpath-outbox-shared']),
      }),
      Object.freeze({
        filename: 'baseline.result-transform.v1.json',
        profileIds: Object.freeze(['public-subpath-result-transform']),
      }),
      Object.freeze({
        filename: 'baseline.lease-custody-and-remediation.v1.json',
        profileIds: Object.freeze([
          'public-subpath-rqs-preload',
          'public-subpath-rqs-store-expo',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.outbox-drain-controller.v1.json',
        profileIds: Object.freeze([
          'public-subpath-rqs-store',
          'public-subpath-rqs-store-default',
          'public-subpath-rqs-store-file',
        ]),
      }),
      Object.freeze({
        filename: 'baseline.local-sync-absence.v1.json',
        profileIds: Object.freeze([
          'resolved-public-subpath-agent-authority',
          'resolved-public-subpath-canonical-client-value',
        ]),
      }),
    ]),
    authorities: Object.freeze([
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0247#d1-contract-directed-optional-omission',
      'LLP 0247#d4-one-public-typed-refusal-exception',
    ]),
    rationale: Object.freeze({
      date: '2026-08-12',
      fix: 'LLP 0247 D1/D4 adds the public argument-normalization surface '
        + 'and the common SnapbackDiagnosticError refusal carrier used by '
        + 'the ordinary client read/dispatch/run surface.',
      ticket: 'issues/20260812-0247-0248-measurement-reruns.md',
      byteDeltas: 'public-subpath-argument-normalization first run min 7648, '
        + 'gzip 2853, brotli 2526; resolved-public-subpath-argument-normalization '
        + 'first run min 7657, gzip 2860, brotli 2531; '
        + 'public-subpath-diagnostic-error first run min 2935, gzip 1130, '
        + 'brotli 992; resolved-public-subpath-diagnostic-error first run min '
        + '2944, gzip 1136, brotli 997; external-react-application min '
        + '124408->133855 (+9447), gzip 37626->40092 (+2466), brotli '
        + '32803->34940 (+2137); public-subpath-canonical-client-value min '
        + '4651->10755 (+6104), gzip 2030->3891 (+1861), brotli 1820->3432 '
        + '(+1612); public-subpath-outbox-shared min 21340->21813 (+473), '
        + 'gzip 7320->7455 (+135), brotli 6573->6681 (+108); '
        + 'public-subpath-react-binding min 65483->66813 (+1330), gzip '
        + '19712->20020 (+308), brotli 17456->17724 (+268); '
        + 'public-subpath-result-transform min 14803->14803 (+0), gzip '
        + '5243->5244 (+1), brotli 4674->4662 (-12); '
        + 'public-subpath-rqs-preload min 5624->5625 (+1), gzip 2606->2606 '
        + '(+0), brotli 2183->2189 (+6); public-subpath-rqs-registered min '
        + '32312->32439 (+127), gzip 10708->10741 (+33), brotli 9420->9460 '
        + '(+40); public-subpath-rqs-store min 41833->42129 (+296), gzip '
        + '14237->14327 (+90), brotli 12606->12695 (+89); '
        + 'public-subpath-rqs-store-default min 63764->64061 (+297), gzip '
        + '18841->18929 (+88), brotli 16584->16713 (+129); '
        + 'public-subpath-rqs-store-expo min 43304->43600 (+296), gzip '
        + '14301->14384 (+83), brotli 12671->12768 (+97); '
        + 'public-subpath-rqs-store-file min 41842->42138 (+296), gzip '
        + '14004->14088 (+84), brotli 12430->12513 (+83); '
        + 'react-core-application min 69599->79083 (+9484), gzip '
        + '21593->24210 (+2617), brotli 18917->21157 (+2240); '
        + 'react-core-capabilities-negative min 80570->90184 (+9614), gzip '
        + '24751->27327 (+2576), brotli 21630->23748 (+2118); '
        + 'react-core-query min 68650->78129 (+9479), gzip 21315->23944 '
        + '(+2629), brotli 18660->20884 (+2224); react-external min '
        + '124210->133657 (+9447), gzip 37563->40035 (+2472), brotli '
        + '32731->34874 (+2143); react-full-capabilities-positive min '
        + '68516->68632 (+116), gzip 22577->22606 (+29), brotli '
        + '19596->19641 (+45); resolved-public-subpath-agent-authority min '
        + '73297->73297 (+0), gzip 18777->18777 (+0), brotli 16287->16317 '
        + '(+30); resolved-public-subpath-canonical-client-value min '
        + '4026->10764 (+6738), gzip 1945->3898 (+1953), brotli '
        + '1739->3439 (+1700).',
      summary: 'Enroll the four new public and resolved narrow-subpath '
        + 'profiles and advance exactly the 18 existing closures grown by '
        + 'LLP 0247 D1/D4; every other active ceiling and all seven '
        + 'predecessor receipts remain immutable.',
    }),
    beforeAfterProfileIds: Object.freeze([
      'external-react-application',
      'public-subpath-canonical-client-value',
      'public-subpath-outbox-shared',
      'public-subpath-react-binding',
      'public-subpath-result-transform',
      'public-subpath-rqs-preload',
      'public-subpath-rqs-registered',
      'public-subpath-rqs-store',
      'public-subpath-rqs-store-default',
      'public-subpath-rqs-store-expo',
      'public-subpath-rqs-store-file',
      'react-core-application',
      'react-core-capabilities-negative',
      'react-core-query',
      'react-external',
      'react-full-capabilities-positive',
      'resolved-public-subpath-agent-authority',
      'resolved-public-subpath-canonical-client-value',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/argument-normalization.test.mjs']],
      ['node', ['packages/snapback-client/diagnostic-error.test.mjs']],
      ['node', ['packages/snapback-client/package.test.mjs']],
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
  if (profile.fixture === 'react-core-capabilities-negative') {
    return [
      "import * as core from '@expo/snapback-react/core';",
      'export function __snapbackMetrologyBehavior() {',
      "  for (const name of ['useSurface', 'useSnapbackCommand', 'invokeSnapbackCommand', 'useSnapbackAssetUrl', 'useSnapbackAssetUpload', 'useSnapbackAssetImage', 'SnapbackAssetImage']) {",
      "    if (name in core) throw new Error(`optional React capability ${name} leaked into ./core`);",
      '  }',
      "  if (typeof core.createSnapbackReactProvider !== 'function' || typeof core.useSnapbackQuery !== 'function' || typeof core.useSnapbackOptimisticCreate !== 'function') throw new Error('React core composition is incomplete');",
      '  return Object.keys(core).length;',
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
    for (const profile of spec.derivedProfiles ?? []) {
      assert.ok(
        spec.profileIds.includes(profile.id),
        `${spec.filename}: derived rollover profile ${profile.id} is declared`,
      );
    }
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

function assertReactCoreComposition(profiles) {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const coreProfiles = [
    'react-core-application',
    'react-core-capabilities-negative',
    'react-core-query',
  ].map((id) => byId.get(id));
  const full = byId.get('react-full-capabilities-positive');
  assert.ok(coreProfiles.every(Boolean) && full, 'React core composition profiles are present');
  for (const profile of coreProfiles) {
    assert.ok(
      Object.hasOwn(profile.metafile.inputs, REACT_IMPLEMENTATION_MODULE),
      `${profile.id}: retains the shared provider implementation`,
    );
    for (const forbidden of [
      REACT_FULL_CAPABILITIES_MODULE,
      COMMANDS_MODULE,
      ASSETS_MODULE,
    ]) {
      assert.equal(
        Object.hasOwn(profile.metafile.inputs, forbidden),
        false,
        `${profile.id}: excludes ${forbidden}`,
      );
    }
  }
  for (const required of [
    REACT_FULL_CAPABILITIES_MODULE,
    COMMANDS_MODULE,
    ASSETS_MODULE,
  ]) {
    assert.ok(
      Object.hasOwn(full.metafile.inputs, required),
      `react-full-capabilities-positive: includes ${required}`,
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
    ...rolloverConfigs.flatMap((entry) => entry.spec.derivedProfiles ?? []),
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
  assertReactCoreComposition(measured);
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
compareToBaselines(report, baseline, supplementals, rollovers, {
  // This exact-source exception supports no-commit metrology handoffs. A
  // committed receipt still resolves through its one reachable introduction;
  // an uncommitted one must name the exact current HEAD as its source.
  uncommittedCarrierRevisions: new Map(
    rollovers
      .filter(({ spec }) => spec.worktreeCarrierPolicy === 'same-head')
      .map(({ spec, baseline: rollover }) => [spec.filename, rollover.source.revision]),
  ),
});
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
