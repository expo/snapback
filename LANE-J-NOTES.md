# Lane J notes — mutation-wire artifact identity

Date: 2026-08-10

## Outcome

Implemented the ticket as one coherent, uncommitted protocol slice and moved
it to `issues/closed/20260726-0093-mutation-wire-artifact-identity.md` with a
resolution record.

- The finite Rust `MutationRequest` now accepts an optional exact
  `wireVersion` offer. `snapback.v1` is known, an unknown present token refuses
  `SNAPBACK_WIRE_VERSION_UNSUPPORTED`, and absence preserves the legacy
  offerless envelope.
- Fresh read-set-free writes crossing the latest successor-only migration
  floor now prove the active schema through the existing build-time
  `expectedGeneration`. `schema-resync` admits the successor hash;
  `rollback-resync` admits the predecessor hash. A v1 request with missing or
  non-active identity refuses `SNAPBACK_MIGRATION_UPGRADE_REQUIRED` before
  function selection, ACK consumption, or handler effects.
- Exact-settlement recovery remains before the new artifact floor. Requests
  with read baselines remain on the existing row-aware floor. An offerless
  legacy request with no identity remains compatible, while a present stale
  identity is actionable evidence and refuses.
- The JavaScript client offers `snapback.v1` for every direct and outbox-replay
  mutation and uses the `expectedGeneration` already emitted into generated
  function references. The codegen regression now pins that identity's
  `schemaHash` to the generated schema manifest. The nearby mutation-IR test
  fixture also declares the refusals required by the current declaration
  validator.
- The Swift client offers `snapback.v1` and accepts a complete build-time
  `ArtifactGeneration` through configuration. It rejects incomplete configured
  identities before sending.
- Regenerated the committed mutation input schema only. Schemagen also exposed
  unrelated pre-existing committed-schema drift; those unrelated generated
  changes were not retained.
- Added the required dated amendments to LLP 0081 and LLP 0093. LLP 0094's
  exact-token compatibility rule is reused as the finite-carrier vehicle; its
  connection lineage was not widened.

No new proof gate or test file was introduced, so
`scripts/local-proof-selection-policy.v1.json` did not require a new
classification. This was not a demo change, so no demo diary was required.

## Client package byte accounting

Exact tracked-byte measurements for `packages/snapback-client`:

| Artifact | HEAD | Lane J | Delta |
| --- | ---: | ---: | ---: |
| `index.mjs` | 568,970 | 569,297 | +327 |
| `index.d.mts` | 64,353 | 64,353 | 0 |
| `package.test.mjs` | 35,005 | 35,285 | +280 |
| Three-artifact subtotal | 668,328 | 668,935 | +607 |
| Entire tracked package | 2,911,346 | 2,911,953 | +607 |

## Verification

Passed:

- Todo and RBAC codegen preflight with
  `volta run --node 24.18.0 node packages/snapback-codegen/index.mjs ...`.
- `scripts/bootstrap-ibex-runtime` (build, launch, handler-VM qualification,
  and readiness receipt).
- `cargo run --locked --bin snapback-schemagen`.
- `volta run --node 24.18.0 node packages/snapback-client/package.test.mjs`.
- `volta run --node 24.18.0 node packages/snapback-codegen/generated-mutation-ir.test.mjs`.
- Swift: `env CLANG_MODULE_CACHE_PATH=/private/tmp/lane-j-swift-cache SWIFTPM_MODULECACHE_OVERRIDE=/private/tmp/lane-j-swift-cache swift test --disable-sandbox`
  (58 tests, 0 failures). The outer managed environment prevents SwiftPM's
  nested sandbox, hence the explicit local `--disable-sandbox`.
- `cargo test --locked --lib successor_only_publication_gates_blind_mutation_artifact_generation -- --nocapture`.
- `cargo test --locked --test offline_replay_v0 finite_mutation_wire_version_offer_is_must_understand -- --nocapture`.
- `cargo test --locked --test artifact_schemas_v0 mutation_replay_bounds_match_the_public_data_tier_profile -- --nocapture`.
- `./ref-check --verbose` (228 LLP documents, 4,873 references in 9,672
  files; 0 errors and 0 unchecked).
- `git diff --check`.

Full-suite/baseline observations:

- `cargo test --locked --lib` completed with 2,472 passed, 50 failed, 2
  ignored. The lane's new migration-floor regression passed. The remaining red
  set is dominated by the filed rehearsal fork-custody family
  (`SNAPBACK_FORK_CUSTODY_UNCLASSIFIED` around
  `_snapback_job_rehearsal_provenance_v1`). The six non-family failures were:
  `admin::tests::debug_perturbation_target_authority_is_local_non_production_only`,
  `admin::tests::network_profile_authority_captures_boot_validated_derived_identity`,
  `manifest::membership_manifest_grammar_tests::capability_maturity_promotions_hold_and_admission_stays_fail_closed`,
  `server::tests::s5_d10_all_emitted_diagnostics_have_reviewed_http_status`,
  `server::tests::s5_d10_production_diagnostic_inventory_cannot_drift`, and
  `server::tests::served_http_refusals_project_typed_candidates_and_argument_contracts`.
  Their diagnostics concern existing capability/diagnostic inventory and
  served-fixture hash drift, not the mutation identity path changed here.
- The broad `dk7_committed_schemas_match_rust_types` check remains red on
  unrelated capability-manifest drift already emitted by schemagen. The
  mutation-specific committed-schema check above passes.

## Worktree state

No commit was created. `LANE-PROMPT.md` remains the user's untracked input.
