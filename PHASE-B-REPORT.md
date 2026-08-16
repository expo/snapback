# Phase B implementation report — `defineMediaCommand`

**Branch:** `media-happy-path`  
**Charter:** `CODEX-PHASE-B.md`  
**Base observed:** `26e0ee26c5fe7400ef1d69e77b24b5744aa8af10`  
**Date:** 2026-08-16

## Progress

- [x] Read the Scope B ticket, LLP 0239 D3/D4/D6/Acceptance, LLP 0180,
  LLP 0238 `TaskHandle`, `PHASE-A-REPORT.md`, `SUBSTRATE-MAP.md`, and the
  project root LLP.
- [x] Stage 1 — codegen authoring surface, closed binding, generated command,
  source-attributed diagnostics, capability mirrors, and authoring tests.
- [x] Stage 2 — fail-closed Rust manifest binding and command-only enforcement.
- [x] Stage 3 — ordinary mutation-host validation and atomic collection,
  attachment, and grant staging through the Phase A writer.
- [x] Stage 4 — headless multi-source `CommandTask` specialization, durable
  attempt/plan replay, cancellation/ambiguity/residue behavior, and tests.
- [x] Stage 5 — Rust acceptance tests and affected-scope verification.

## Governing context

- `LLP 0239#d3-one-mediacommand-owns-multi-upload-plus-atomic-commit` owns the
  closed binding, command-only mutation posture, narrow application-transaction
  atomicity, deterministic attempt/item plan, and task phases.
- `LLP 0239#d4-grants-and-authority-are-declarative-at-the-command-edge` owns
  exact ceiling-admitted sharing selection and commit-time reauthorization.
- `LLP 0180#terminal-state-transitions` and `LLP 0180#cancellation` own
  successor-task retry, predecessor settlement/listener isolation, and the
  pre/post-invocation cancellation split.
- `LLP 0238#d3-one-observable-handle-grammar` owns the projected task-handle
  protocol.
- The 2026-08-16 author rulings in `PHASE-B-BLOCKERS.md` and LLP 0239 are
  implemented: `mapping.operation` is required and explicit, and
  `mapping.principals` is the closed host-only direct-recipient input mapping.
  No semantic blocker remains.

## As-built contract

- `defineMediaCommand` accepts only closed data: media bounds/kinds and intent,
  one ordinary authenticated mutation, exact passthrough arguments, one mapped
  asset-array argument, a closed parent-result path, one generated collection,
  required `append | replace`, one exact ceiling-admitted sharing plan, and an
  optional bounded principal mapping only for direct-recipient sharing. Unknown
  fields, callbacks, transforms, branches, and inconsistent mappings refuse at
  generation with source attribution.
- Codegen installs a canonical `MediaCommandBindingV1` in the target mutation,
  includes the binding in semantic/executable identity, exposes only
  `app.commands.<name>`, and removes the target mutation from the generated
  direct mutation surface.
- The media carrier is mutation-specific (`MutationRequest.mediaCommand`), not
  part of shared `HandlerInput`; query, action, live, and host-input envelopes
  therefore do not acquire a media-command field.
- Before handler execution the host resolves the exact installed binding,
  requires the same client mutation/attempt id, validates input-order ordinals,
  asset ids, mapped mutation args, and bounded principals, and binds the full
  carrier into the durable mutation fingerprint. Plain invocation of a bound
  mutation refuses as command-only.
- HostPlan and buffered Ibex mutations still have one ordinary application
  commit owner. After the authored mutation produces an exact result, the host
  resolves the declared parent id and calls the Phase A collection writer in
  that same SQLite transaction. Parent ownership, upload intent/kind/finalized
  status, collection generation/limits, sharing ceiling/derivation, and direct
  principal grants are reauthorized at commit time. Replay uses the same
  attempt-bound deterministic item identities.
- Atomicity is deliberately narrow: asset bytes finalize first; the authored
  application mutation plus collection rows, attachment edges, and grants then
  commit atomically in one application transaction. A refused application
  transaction never claims to roll back or silently delete finalized bytes;
  they remain explicit cleanup-governed residue.
- The headless client accepts a scalar or bounded array of File/Blob/native
  picker-shaped values, preserves input order, uploads with binding-selected
  bounded concurrency (default 3), and publishes per-item and aggregate
  progress. Text-only execution uses the same command with an empty item plan.
  No mutation starts until all supplied assets are finalized.
- Client states are `validating -> uploading -> committing -> committed |
  failed | cancelled | ambiguous`. Media commands use the existing durable
  mutation outbox when available (`queue: "auto"`). Response-loss retry returns
  a successor task with the same mutation id and item plan, reuses finalized
  asset ids, and does not migrate predecessor listeners or `.done`. Cancellation
  before invocation settles cancelled; cancellation/disposal after invocation
  settles ambiguous and never claims rollback. Residue is per asset and carries
  cleanup provenance.

## Files touched by Phase B

- `PHASE-B-REPORT.md`, `PHASE-B-BLOCKERS.md` — implementation record and
  resolved semantic questions. The concurrent author amendment to LLP 0239 was
  preserved and used as the normative operation/principal ruling.
- `packages/snapback-codegen/define.{mjs,d.ts}`, `index.mjs`,
  `app-descriptor.mjs`, `semantic-generation.mjs` — declaration, closed
  admission/binding identity, manifest installation, generated command-only
  surface, descriptor validation, semantic identity, and capability emission.
- `packages/snapback-codegen/media-command-authoring.test.mjs`, codegen package
  test wiring, and `scripts/check-package-test-inventory.mjs` — authoring,
  source-attribution, direct-recipient, and inventory coverage.
- `packages/snapback-client/commands.{mjs,d.mts}`, `index.mjs`, and
  `reference-kinds.mjs` — multi-source task, durable media carrier/outbox replay,
  types, and command reference admission; `commands.test.mjs` contains the
  Stage 4 matrix.
- `src/manifest.rs`, `src/local.rs`, `src/server.rs`, `src/storage.rs`, and
  `src/storage/mutation_writes.rs` — closed manifest/wire types, pre-handler
  binding resolution, mutation ingress, durable identity, and the shared
  HostPlan/buffered atomic staging seam.
- `src/storage/branch_ops.rs` and `src/storage/membership_plans.rs` — explicit
  `None` at existing non-media storage adapters after the private storage seam
  gained its optional resolved carrier.
- `src/server/api_error.rs` and `src/server/tests.rs` — reviewed HTTP mappings
  and family mirrors for every production-reachable Phase B diagnostic.
- `src/local/tests.rs`, `src/storage/tests.rs`, `tests/artifact_schemas_v0.rs`,
  `tests/offline_replay_v0.rs`, and `tests/auth_artifacts_v1.rs` — fail-closed,
  transaction/replay/residue/grant, schema, replay-envelope, and capability
  coverage.
- Rust-generated schemas under `schemas/` — the mutation carrier,
  `MediaCommandBindingV1`, capability/inspect projections, and all transitive
  schema/public-instance leaves refreshed by `snapback-schemagen`.
- `tests/acceptance/capability-registry.ids.json` and
  `capability-maturity.experimental.json` — capability mirrors.

No guide page, guide capability-row flip, maturity introduction record,
program-board entry, React/Expo hook, or publication artifact was created.

## New diagnostics and HTTP classifications

Generation-only diagnostics (no HTTP classification):

- `SNAPBACK_MEDIA_COMMAND_DECLARATION_INVALID`
- `SNAPBACK_MEDIA_COMMAND_INVALID_IDENTIFIER`
- `SNAPBACK_MEDIA_COMMAND_MUTATION_UNKNOWN`
- `SNAPBACK_MEDIA_COMMAND_MUTATION_INCOMPATIBLE`
- `SNAPBACK_MEDIA_COMMAND_MAPPING_AMBIGUOUS`
- `SNAPBACK_MEDIA_COMMAND_MEDIA_INVALID`
- `SNAPBACK_MEDIA_COMMAND_INTENT_UNKNOWN`
- `SNAPBACK_MEDIA_COMMAND_COLLECTION_UNKNOWN`
- `SNAPBACK_MEDIA_COMMAND_COLLECTION_INCOMPATIBLE`
- `SNAPBACK_MEDIA_COMMAND_OPERATION_INVALID`
- `SNAPBACK_MEDIA_COMMAND_MAPPING_INVALID`
- `SNAPBACK_MEDIA_COMMAND_MAPPING_INCOMPATIBLE`
- `SNAPBACK_MEDIA_COMMAND_AUTHORITY_INPUT_REFUSED`
- `SNAPBACK_MEDIA_COMMAND_INPUT_COLLISION`
- `SNAPBACK_MEDIA_COMMAND_PARENT_RESULT_PATH_INVALID`
- `SNAPBACK_MEDIA_COMMAND_SHARING_PLAN_INVALID`
- `SNAPBACK_MEDIA_COMMAND_PRINCIPAL_INPUT_INVALID`

Production-reachable Rust diagnostics:

- `SNAPBACK_MEDIA_COMMAND_BINDING_REQUIRED` — HTTP 400.
- `SNAPBACK_MEDIA_COMMAND_BINDING_INVALID` — HTTP 400.
- `SNAPBACK_MEDIA_COMMAND_MUTATION_ATTEMPT_REQUIRED` — HTTP 400.
- `SNAPBACK_MEDIA_COMMAND_ARGUMENT_INVALID` — HTTP 400.
- `SNAPBACK_MEDIA_COMMAND_MANIFEST_INVALID` — HTTP 500.
- `SNAPBACK_MEDIA_COMMAND_PARENT_RESULT_INVALID` — HTTP 500.

Client-only task diagnostics (no server HTTP classification):

- `SNAPBACK_MEDIA_COMMAND_CANCELLED`
- `SNAPBACK_MEDIA_COMMAND_UPLOAD_FAILED`
- `SNAPBACK_MEDIA_COMMAND_AUTHORITY_REPLACED`
- `SNAPBACK_MEDIA_COMMAND_COMMIT_FAILED`
- `SNAPBACK_MEDIA_COMMAND_COMMIT_AMBIGUOUS`
- `SNAPBACK_MEDIA_COMMAND_CANCELLED_DURING_COMMIT`
- `SNAPBACK_MEDIA_COMMAND_CLIENT_DISPOSED_DURING_COMMIT`
- `SNAPBACK_MEDIA_COMMAND_NOT_RETRYABLE`

Phase A collection diagnostics are reused for authoritative commit-time
refusals (for example parent, intent/kind, sharing, and storage checks); they
are not new Phase B codes.

## Capability-registry touchpoints

- Codegen target-capability and experimental-maturity sets.
- Rust `TargetCapabilityId::MediaCommandV1`, its canonical string mapping, and
  the exact `ALL` registry/cardinality.
- Generated capability-manifest schema plus public/admin/full inspect schema
  projections.
- Both checked-in local target capability manifests.
- `tests/acceptance/capability-registry.ids.json` and
  `capability-maturity.experimental.json`.
- No maturity introduction record, guide row, or program-board edit was made;
  the orchestrator retains the landing-parent-bound LLP 0134 introduction act.

## Verification log

- `node packages/snapback-codegen/media-command-authoring.test.mjs` — PASS:
  `media command authoring tests passed`.
- `node packages/snapback-client/commands.test.mjs` — PASS: scalar/text-only,
  one/N-item success, concurrency/progress, direct principals, upload refusal,
  partial failure, authority replacement, commit refusal, response-loss replay,
  cancellation, predecessor isolation, and residue cases.
- `npx --yes tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 packages/snapback-client/commands.d.mts`
  — PASS, no output.
- `node scripts/check-package-test-inventory.mjs` — PASS: `292 declared test
  files` (codegen 72; client 68).
- `scripts/bootstrap-ibex-runtime` — FAIL during initial setup with the stable
  `SNAPBACK_IBEX_CARGO_BUILD_FAILED` diagnostic after locating prepared Hermes
  artifacts. Subsequent direct compiler/test runs linked and executed, so this
  is retained as environment/bootstrap evidence rather than a product failure.
- `RUST_MIN_STACK=16777216 cargo check --lib` — PASS during Stage 2.
- `cargo check --all-targets` — PASS after the mutation-only carrier refactor;
  only inherited vendored private-interface/dead-code warnings remained.
- `cargo test media_command --lib` — PASS: 4 passed, 0 failed, 2728 filtered;
  binding-required/pre-handler resolution, HostPlan atomic success/replay and
  rollback residue, buffered atomic staging, and direct-recipient grants.
- `cargo run --bin snapback-schemagen` — PASS; authoritative schema and public
  instance leaves regenerated.
- `RUST_MIN_STACK=16777216 cargo test --test artifact_schemas_v0 dk7_committed_`
  — PASS: 4 passed, including Rust-schema and public-instance drift gates.
- `RUST_MIN_STACK=16777216 cargo test --test capability_v0 capability_maturity_registry_matches_codegen_canonical_emission -- --exact`
  — PASS: 1 passed.
- `RUST_MIN_STACK=16777216 cargo test --test auth_artifacts_v1 target_capability_registry_is_exact_and_fail_closed -- --exact`
  — PASS: 1 passed.
- `RUST_MIN_STACK=16777216 cargo test --lib s5_d10_ -- --nocapture` — expected
  inherited baseline: 3 passed; only
  `s5_d10_production_diagnostic_inventory_cannot_drift` failed with exactly the
  chartered 11 unclassified codes and `stale=[]`:
  `SNAPBACK_AUTH_PASSWORD_MINIMUM_LENGTH_INVALID`,
  `SNAPBACK_CLIENT_MUTATION_RESULT_INTEGRITY`,
  `SNAPBACK_DATA_TRANSACTION_BOUND_EXCEEDED`,
  `SNAPBACK_DATA_TRANSACTION_INVALID`,
  `SNAPBACK_MEDIA_ASSET_NOT_FINALIZED`, `SNAPBACK_MEDIA_KIND_NOT_ADMITTED`,
  `SNAPBACK_MEDIA_PROJECTION_INTEGRITY`,
  `SNAPBACK_MEDIA_PROJECTION_SNAPSHOT_UNAVAILABLE`,
  `SNAPBACK_MEDIA_PROJECTION_TOKEN_EXHAUSTED`,
  `SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED`, and
  `SNAPBACK_MEDIA_WRITE_FORGED_KIND`. No Phase B code was unclassified, so
  s5_d10 is not worse than baseline.
- `git diff --check` — PASS.

## Deferred and inherited repository checks

- `./ref-check --verbose` — FAIL only because the worktree already has two LLP
  0261 files: `0261-snapback-init-existing-app-composition.rfc.md` and
  `0261-runtime-performance-championship.spec.md`; 262 documents and 6372 refs
  were scanned, with 1 error and 0 unchecked. Phase B adds no invalid `@ref`.
- `node scripts/check-inventories.mjs` — FAIL because the diagnostics registry
  projections are stale (`guide/reference/diagnostics-registry.json`,
  `guide/reference/diagnostics.md`, and
  `packages/snapback-client/diagnostic-codes.d.mts`). The prescribed generator
  would modify guide/publication projections that this charter explicitly
  forbids Phase B from creating; this is an orchestrator/Phase C landing task.
- `cargo fmt --all -- --check` — FAIL on 2,362 lines of repository-wide
  pre-existing formatting drift across many unrelated files. The new Phase B
  Rust blocks were individually reconciled to rustfmt output; the unrelated
  worktree was not mechanically rewritten. `git diff --check` remains clean.

## Deviations

- The implementation initially explored carrying media state on shared
  `HandlerInput`; it was narrowed before completion to
  `MutationRequest.mediaCommand` plus a private resolved staging carrier. This
  avoids unrelated query/action/live schema and API expansion while preserving
  durable identity and the single commit owner.
- The two original semantic questions were not guessed. Work continued on
  unaffected surfaces until the author supplied rulings; the final code uses
  required `mapping.operation` and bounded host-only `mapping.principals`.
- No distributed-transaction or automatic finalized-byte cleanup claim is
  made. The tests explicitly preserve and report finalized unattached residue
  after an application-transaction refusal.

## DONE

All five Phase B deliverable stages are implemented and their affected proofs
pass. The remaining red checks are the exact inherited/deferred conditions
listed above; no commit or push was performed.
