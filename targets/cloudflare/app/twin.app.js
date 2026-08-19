// The conformance-twin app bundle for the Cloudflare leg (ENG-23605).
//
// This is NOT a product app: it wraps the LLP 0048 twin corpus
// (tests/conformance/twin-corpus.handlers.js) in the uniform app-bundle
// surface so the Miniflare harness can execute the corpus against the
// deployed target's real invocation path — gateway → coordinator →
// handler Worker → JS host-op table (targets/cloudflare/src/host-ops.js) →
// Durable-Object SQLite. The corpus module registers its handlers on
// `globalThis.__snapbackHandlers`, the same contract the Ibex target and
// the workerd twin execute, so the handler source is byte-identical
// across all three engines; only the host-op implementation under it
// differs, which is exactly the surface the third twin leg gates.
//
// Executed by targets/cloudflare/test/twin-engine.mjs under
// crates/snapback-conformance/src/bin/snapback-conformance-twin.rs; never deployed.

import capabilityManifest from '../generated/capability.manifest.cloudflare-do-sqlite-v8.json';

// The corpus (evaluated for its __snapbackHandlers registration).
import '../../../tests/conformance/twin-corpus.handlers.js';

export const appMeta = {
  name: 'twin',
  objectName: 'conformance-twin',
};

// The twin ground state is empty by contract: the Rust runner constructs a
// fresh LocalSnapback per case, and the Miniflare leg resets to the same
// state (version 0, empty tables) before each case.
export const seed = null;

export const config = [];

export const cron = [];

export { capabilityManifest };

// @ref LLP 0058#capability-maturity — the conformance fixture requires no
// experimental capability, so it acknowledges none.
export const acknowledgedExperimentalCapabilities = [];

// The coordinator consumes one uniform identity contract from every module
// selected through the `snapback-app` alias. Production apps import generated
// deployment identities; this never-deployed, fresh-state conformance fixture
// uses stable synthetic values that match the Rust twin's schema/bundle
// contract. `inputsHash` still has to exist because coordinator metadata is
// deliberately three-part and must not special-case the test app.
export const deploymentIdentity = Object.freeze({
  schemaHash: 'conformance-twin-v0',
  bundleHash: 'conformance-twin-bundle-v1',
  inputsHash: 'conformance-twin-inputs-v1',
});

// Mirrors the schema the twin runner applies on both Rust legs
// (crates/snapback-conformance/src/bin/snapback-conformance-twin.rs `schema()`).
export const schema = {
  schemaHash: deploymentIdentity.schemaHash,
  strictDeclarations: false,
  tables: [
    {
      name: 'items',
      syncable: true,
      fields: [
        { name: 'label', type: 'string', optional: true },
        { name: 'rank', type: 'integer', optional: true },
      ],
      indexes: [],
    },
  ],
};

export const bundleHash = deploymentIdentity.bundleHash;

// Every corpus case handler, kinds matching the Rust runner's corpus().
// `noSuchExport` is deliberately registered with a nonexistent export so the
// export-missing failure fires inside the isolate (the ctx bootstrap's
// SNAPBACK_HANDLER_EXPORT_MISSING), the same path the Rust legs take.
export const functions = [
  { name: 'addItem', kind: 'Mutation', export: 'addItem', tables: ['items'] },
  { name: 'listRanked', kind: 'Query', export: 'listRanked', tables: ['items'] },
  { name: 'queryLimitValidation', kind: 'Query', export: 'queryLimitValidation', tables: ['items'] },
  { name: 'firstItem', kind: 'Query', export: 'firstItem', tables: ['items'] },
  { name: 'readYourWrites', kind: 'Mutation', export: 'readYourWrites', tables: ['items'] },
  { name: 'patchAndDelete', kind: 'Mutation', export: 'patchAndDelete', tables: ['items'] },
  { name: 'nowAndId', kind: 'Mutation', export: 'nowAndId', tables: ['items'] },
  { name: 'logsThings', kind: 'Query', export: 'logsThings' },
  { name: 'allowlistSlice', kind: 'Query', export: 'allowlistSlice' },
  { name: 'writeInQuery', kind: 'Query', export: 'writeInQuery', tables: ['items'] },
  { name: 'noSuchExport', kind: 'Query', export: 'noSuchExport' },
  { name: 'returnsFunction', kind: 'Mutation', export: 'returnsFunction', tables: ['items'] },
  { name: 'hangForever', kind: 'Mutation', export: 'hangForever' },
  { name: 'detachedRejection', kind: 'Mutation', export: 'detachedRejection', tables: ['items'] },
  {
    name: 'detachedHostCallRejection',
    kind: 'Mutation',
    export: 'detachedHostCallRejection',
    tables: ['items'],
  },
  {
    name: 'detachedHostCallSuccess',
    kind: 'Mutation',
    export: 'detachedHostCallSuccess',
    tables: ['items'],
  },
  { name: 'decoderFidelity', kind: 'Query', export: 'decoderFidelity' },
  {
    name: 'encodingBoundaryFidelity',
    kind: 'Query',
    export: 'encodingBoundaryFidelity',
  },
  { name: 'probeDateConstructor', kind: 'Query', export: 'probeDateConstructor' },
  { name: 'queueMicrotaskInterleave', kind: 'Query', export: 'queueMicrotaskInterleave' },
  { name: 'probeFetch', kind: 'Query', export: 'probeFetch' },
  { name: 'busyLoop', kind: 'Mutation', export: 'busyLoop', tables: ['items'] },
  { name: 'probeDateNow', kind: 'Query', export: 'probeDateNow' },
  // The ENG-23582 divergence-class cases: buffered-overlay semantics
  // observable only mid-invocation.
  { name: 'patchMissing', kind: 'Mutation', export: 'patchMissing', tables: ['items'] },
  { name: 'insertThenGet', kind: 'Mutation', export: 'insertThenGet', tables: ['items'] },
  { name: 'patchIntoFilter', kind: 'Mutation', export: 'patchIntoFilter', tables: ['items'] },
  // @ref LLP 0144#the-landed-floor-2026-08-01 — the three refusal-admission
  //   cases run through the deployed Cloudflare serving path with the same
  //   declaration-backed vocabulary as the two local engine legs.
  {
    name: 'declaredAppRefusal',
    kind: 'Mutation',
    export: 'declaredAppRefusal',
    tables: ['items'],
    refusals: ['STALE_MOVE'],
  },
  {
    name: 'undeclaredAppRefusal',
    kind: 'Mutation',
    export: 'undeclaredAppRefusal',
    tables: ['items'],
    refusals: ['STALE_MOVE'],
  },
  {
    name: 'bareAppRefusalClaim',
    kind: 'Mutation',
    export: 'bareAppRefusalClaim',
    tables: ['items'],
    refusals: ['STALE_MOVE'],
  },
  // The storage-dump helper every case run uses after the fact.
  { name: 'dumpItems', kind: 'Query', export: 'dumpItems', tables: ['items'] },
];

// No route→query manifest: the twin corpus exercises the conformance
// protocol, not Channel A (LLP 0090 rollout step 4).
export const routesManifest = null;
