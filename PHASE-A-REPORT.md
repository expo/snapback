# Phase A implementation report — `assetCollection`

**Branch:** `media-happy-path`  
**Charter:** `CODEX-PHASE-A.md`  
**Base observed:** `a93a11235f94ac40077c8f8f3c6d420f40a9bde7`  
**Date:** 2026-08-15

## Progress

- [x] Read the Scope A ticket, LLP 0239 D2/D4/D6/Acceptance, LLP 0244,
  LLP 0110 §1/§1002, `SUBSTRATE-MAP.md`, and the project root LLP.
- [x] Stage 1 — codegen authoring surface and source-attributed diagnostics.
- [x] Stage 2 — closed Rust manifest, validation parity, generated-plan
  pairing, and raw-write fencing.
- [x] Stage 3 — atomic append/replace/remove/reorder and the complete ruled D4
  sharing grammar in the ordinary mutation host.
- [x] Stage 4 — authorization invalidation, grant revocation, attachment/GC
  edges, quota snapshot, parent teardown, and consistent-cut custody.
- [x] Stage 5 — bounded ordered exact `mediaRef.v1` reads with stable item
  metadata.
- [x] Stage 6 — Scope A authoring, runtime, refusal, lifecycle, capability,
  and runtime-readiness evidence.

## As-built surface and semantics

- `assetCollection({ ownerTable, intent, maxItems, order, kinds, grants })`
  accepts `maxItems` 1–32, `manual` or immutable `created` order, a nonempty
  compatible media-kind subset, and a closed sharing policy.
- `grants` is the shorthand `"none"`, `"owner-only"`, or
  `"inherit-command"`, or `{ ceiling, default }`. The named ceiling contains
  at most eight exact plans from: `none`, `owner-only`, bounded active/pending
  `recipients`, bounded active/pending `derived`, and `inherit-command`.
  A direct-recipient plan cannot be the input-free default.
- Direct recipient lists are declared as bounded generated arguments and pass
  through the existing LLP 0210/0220 owner-authorized grant state machine at
  final commit. Derived plans name a generated owner-authorized query over an
  ordinary table with a required parent id and principal field; the host reads
  one over the bound and refuses over-fanout. `inherit-command` is declarable
  but refuses direct invocation until Phase B installs the exact binding.
- `append`, `replace`, and `remove` accept one optional exact `sharing`
  selection. `none` preserves retained collection-managed grants while every
  detached item is revoked; `owner-only` clears collection-managed recipient
  grants; recipient/derived replacement is exact. Reorder never mutates grant
  authority.
- Generated storage is one protected child table with parent id/incarnation,
  asset id, stable `_id`, kind, policy generation, and ordinal. Append and
  replace allocate opaque ids from the collection generation, mutation-attempt
  digest, and input ordinal. Reorder preserves ids, remove retires them, and
  content equality cannot revive one.
- `created` collections omit the generated reorder operation. Retained items
  keep creation order during replace and new items follow in replacement-input
  order. A forged/stale created-order reorder plan refuses at runtime.
- Reads lower to LLP 0110 bounded children and reuse the exact LLP 0244
  `mediaRef.v1` value; no second media shape was introduced.
- Collection rows participate in ordinary change/version identity,
  authorization invalidation, finalized attachment verification, reference
  GC, parent deletion, asset-change invalidation, quota counts, and asset-cut
  export/import. Collection-managed grant records travel in the same cut and
  are restored with stable lineage.

## Input deviations and judgment calls

- The charter-required issue file was initially absent, then appeared as an
  untracked worktree file and was read before implementation. A sandboxed
  `git fetch origin main` could not update the linked-worktree `FETCH_HEAD`; it
  did not move the branch.
- `PHASE-A-BLOCKERS.md` originally recorded the unspecified sharing grammar.
  The relayed 2026-08-15 author rulings resolved it and delegated the exact
  as-built spelling. The blocker file now records the resolution; no semantic
  blocker remains.
- The ceiling is bounded to eight named plans, plan names use a portable
  1–64-character grammar, and recipient fanout is 1–32. These are closed
  descriptor bounds chosen while deriving the ruled concrete grammar.
- The relayed ruling says append/replace/remove take sharing selections, while
  the LLP amendment says “each generated collection operation.” Reorder is
  authority-neutral and carries no sharing argument. The affected-scope LLP
  audit proposes reconciling that wording to the relayed ruling before
  landing; code and the author ruling do not otherwise drift.
- Serde flattening accepted unknown fields on the sharing-plan wrapper. It was
  replaced with an explicit fail-closed decoder, with tests for both the valid
  generated spelling and unknown-field refusal.
- No guide page, guide capability row, generated guide artifact, publication
  carrier, demo diary, commit, or push was produced, per charter scope.

## Worktree ownership preserved

The following were already user/orchestrator-owned and were not reverted or
claimed as Phase A implementation edits: `bun.lock`; generated
competitive-checkpoint/RBAC/Todo demo artifacts; the same-day LLP 0239 author
amendment; and the untracked charter, substrate map, and Scope A issue file.
No demo was built or substantially changed by this implementation, so no diary
update applies.

## Files touched by Phase A

- `PHASE-A-REPORT.md` and `PHASE-A-BLOCKERS.md` — live evidence and resolved
  semantic question.
- `packages/snapback-codegen/define.mjs` and `define.d.ts` — declaration and
  typed closed sharing grammar; bounded projection admits the media leaf.
- `packages/snapback-codegen/index.mjs` — validation, digest-bound descriptor,
  protected table, bounded read, four mutation lowerings, derivation query,
  exact selection contracts, capability admission, and attributed refusals.
- `packages/snapback-codegen/result-contracts.mjs` and `effect-ceiling.mjs` —
  exact child contracts and collection/grant/read host effects.
- `packages/snapback-codegen/media-collection-authoring.test.mjs`,
  `packages/snapback-codegen/package.json`, and
  `scripts/check-package-test-inventory.mjs` — authoring/refusal evidence and
  test inventory wiring.
- `src/contract_types.rs`, `src/manifest.rs`, and `src/value_expr.rs` — closed
  descriptor/plan carriers, fail-closed decode and schema validation, effect
  accounting, and generated-step-only plan admission.
- `src/local.rs` — schema/function cross-pairing, raw-write refusal, derived
  query validation, bounded MediaRef admission, and read/write summaries.
- `src/storage.rs` — atomic collection operations, stable allocation,
  finalized intent/kind admission, OCC/authority checks, grant reconciliation,
  parent teardown, and raw-write fencing.
- `src/storage/asset_grants.rs`, `src/storage/authorization.rs`,
  `src/storage/asset_reads.rs`, and `src/assets_cut.rs` — collection-owned grant
  lineage/revocation, invalidation, cut plumbing, quota, import validation, and
  rebuilt reference edges.
- `src/storage/tests.rs` — nine focused acceptance tests spanning happy paths,
  identity, retry, OCC, sharing, refusals, GC, teardown, quota, and cut.
- `schemas/capability.manifest.local-dev-sqlite-ibex.json` and its
  outbound-actions sibling — exact local support facts for MediaRef plus the
  new collection capability.
- `schemas/capability.manifest.schema.json`, `schemas/inspect.schema.json`,
  `schemas/inspect.admin.schema.json`, `schemas/inspect.public.schema.json`,
  `tests/acceptance/capability-registry.ids.json`,
  `tests/acceptance/capability-maturity.experimental.json`, and
  `tests/auth_artifacts_v1.rs` — closed capability mirrors and exact registry
  evidence.

## New diagnostics

- `SNAPBACK_MEDIA_COLLECTION_DECLARATION_INVALID`
- `SNAPBACK_MEDIA_COLLECTION_INVALID_IDENTIFIER`
- `SNAPBACK_MEDIA_COLLECTION_OWNER_TABLE_UNKNOWN`
- `SNAPBACK_MEDIA_COLLECTION_OWNER_TABLE_INELIGIBLE`
- `SNAPBACK_MEDIA_COLLECTION_INTENT_UNKNOWN`
- `SNAPBACK_MEDIA_COLLECTION_MAX_ITEMS_INVALID`
- `SNAPBACK_MEDIA_COLLECTION_ORDER_INVALID`
- `SNAPBACK_MEDIA_COLLECTION_KINDS_INVALID`
- `SNAPBACK_MEDIA_COLLECTION_DUPLICATE_POLICY_INVALID`
- `SNAPBACK_MEDIA_COLLECTION_INTENT_KIND_INCOMPATIBLE`
- `SNAPBACK_MEDIA_COLLECTION_SHARING_PLAN_INVALID`
- `SNAPBACK_MEDIA_COLLECTION_SHARING_DEFAULT_INVALID`
- `SNAPBACK_MEDIA_COLLECTION_SHARING_GRANTS_UNDECLARED`
- `SNAPBACK_MEDIA_COLLECTION_SHARING_DERIVATION_INVALID`
- `SNAPBACK_MEDIA_COLLECTION_SHARING_SELECTION_INVALID`
- `SNAPBACK_MEDIA_COLLECTION_SHARING_OUTSIDE_CEILING`
- `SNAPBACK_MEDIA_COLLECTION_COMMAND_BINDING_REQUIRED`
- `SNAPBACK_MEDIA_COLLECTION_RAW_WRITE_COLLISION`
- `SNAPBACK_MEDIA_COLLECTION_RAW_WRITE_REFUSED`
- `SNAPBACK_MEDIA_COLLECTION_MANIFEST_INVALID`
- `SNAPBACK_MEDIA_COLLECTION_ARGUMENT_INVALID`
- `SNAPBACK_MEDIA_COLLECTION_MUTATION_ATTEMPT_REQUIRED`
- `SNAPBACK_MEDIA_COLLECTION_PARENT_FORBIDDEN`
- `SNAPBACK_MEDIA_COLLECTION_PARENT_UNAVAILABLE`
- `SNAPBACK_MEDIA_COLLECTION_LIMIT_EXCEEDED`
- `SNAPBACK_MEDIA_COLLECTION_DUPLICATE_ASSET`
- `SNAPBACK_MEDIA_COLLECTION_DUPLICATE_ITEM`
- `SNAPBACK_MEDIA_COLLECTION_ITEM_UNKNOWN`
- `SNAPBACK_MEDIA_COLLECTION_REORDER_INVALID`
- `SNAPBACK_MEDIA_COLLECTION_CREATED_ORDER_REORDER_REFUSED`
- `SNAPBACK_MEDIA_COLLECTION_STORAGE_INVALID`
- `SNAPBACK_ASSET_EXPORT_COLLECTION_INVALID`
- `SNAPBACK_ASSET_IMPORT_COLLECTION_SCHEMA_MISMATCH`
- `SNAPBACK_ASSET_IMPORT_COLLECTION_PARENT_MISSING`

Existing closed asset diagnostics are deliberately reused for finalized/kind,
grant admission, cut-manifest integrity, and empty-target checks. The new codes
above are intentionally not written into `guide/`; the orchestrator owns the
diagnostics-registry regeneration required by the charter.

## Capability-registry touchpoints

- Codegen closed capability set and experimental set:
  `assets.media-collection.v1`.
- Rust `TargetCapabilityId`, experimental maturity, target support facts, and
  exact registry-cardinality evidence.
- Local and outbound-enabled local capability manifests.
- Capability-manifest JSON Schema and base/admin/public inspect JSON Schemas.
- Acceptance capability-id and experimental-maturity projections.
- The exact auth-artifact registry test.

## Verification log

- `node --check packages/snapback-codegen/index.mjs && node --check packages/snapback-codegen/define.mjs && node --check packages/snapback-codegen/effect-ceiling.mjs && node packages/snapback-codegen/media-collection-authoring.test.mjs && node packages/snapback-codegen/media-field-authoring.test.mjs`
  — `media collection lowering 1, generated operations 5, refusal attribution 16: ok`; `media field validation 4, lowering 1, contract/hash/RQS 5, action refusal 1: ok`.
- `cargo check --locked --lib`
  — `Finished dev profile`; only inherited vendored/dead-code warnings.
- `cargo test --locked --lib media_collection_acceptance_tests -- --nocapture`
  — `9 passed; 0 failed`; covers manual/created order, stable/non-reused ids,
  retry, OCC, raw-write refusal, finalized/kind/bound checks, authorization
  replacement, direct/derived/default sharing, revocation, admission-frozen
  grants, parent teardown, GC, quota, cut round-trip, closed manifest decode,
  and the new runtime/cut refusal codes.
- `cargo test --locked --lib framework_owned_collection_rows_are_authorization_events -- --nocapture`
  — `1 passed; 0 failed`.
- `cargo test --locked --test capability_v0 capability_maturity_registry_matches_codegen_canonical_emission -- --nocapture`
  — `1 passed; 0 failed`; Rust and codegen experimental registries matched.
- `cargo test --locked --test auth_artifacts_v1 target_capability_registry_is_exact_and_fail_closed -- --nocapture`
  — `1 passed; 0 failed`.
- `node scripts/check-capability-maturity.mjs`
  — `[capability-maturity] PASS: 11 records; 0 transition(s) in HEAD^..HEAD`.
- `node scripts/check-package-test-inventory.mjs`
  — `[package-test-inventory] PASS: 285 declared test files`; codegen count 69.
- `./ref-check --verbose`
  — `ref-check: ok — 257 LLP docs, 5484 refs in 10443 files, 0 errors, 0 unchecked`.
- `rustfmt --edition 2024 --config skip_children=true --check src/manifest.rs src/storage/tests.rs src/storage.rs src/local.rs src/assets_cut.rs src/contract_types.rs src/value_expr.rs src/storage/asset_grants.rs src/storage/asset_reads.rs src/storage/authorization.rs`
  — exit 0. Repository-wide `cargo fmt --check` has unrelated toolchain-format
  drift, so Phase A files were formatted and checked directly without child
  module collateral.
- `git diff --check` — exit 0.
- `scripts/bootstrap-ibex-runtime`
  — `SNAPBACK_IBEX_RUNTIME_LINK_OK`; exact link, launch, and restricted
  no-eval handler-VM qualification passed with dynamic-loader overrides
  scrubbed.

## LLP maintenance audit

The affected-scope `llp-maintain` pre-PR audit found no broken/tombstoned refs,
stale glosses, provenance errors, or code contradiction in LLP 0239 D2/D4,
LLP 0244, or LLP 0110. One missing D4 link was added to commit-time grant
reconciliation. Proposed orchestrator reconciliation: make LLP 0239’s “each
generated collection operation” wording match the relayed append/replace/remove
selection ruling and fold the exact as-built grammar into its example. Per the
skill, no LLP edit or status change was applied.

## Known non-Phase-A reds and orchestrator follow-ups

- `npm test --prefix packages/snapback-codegen` stops in the unchanged
  `generated-mutation-ir.test.mjs:97`: expected `server-only`, actual
  `local-executable`. The test file is untouched and this is in the
  orchestrator-captured pre-existing red set; the Phase A pretest entries pass
  when run directly.
- `node scripts/check-inventories.mjs` fails its guide-manifest subcheck because
  the new diagnostics registry is intentionally stale and because two
  pre-existing Todo-v2 Contract snippet sources are absent. Package inventory
  itself passes.
- `node scripts/check-guide.mjs` reports the expected diagnostics-registry
  staleness, broad pre-existing generated symbol-registry staleness, and the
  same two absent Todo-v2 snippet sources. The charter expressly reserves
  guide/generated-registry refresh for the orchestrator and forbids Phase A
  from touching those artifacts.
- The orchestrator should regenerate the diagnostics/symbol registries,
  reconcile the small LLP wording note above, and account for the
  user/orchestrator-owned dirty and untracked files when assembling the landing
  patch.
- No sandbox-suspect failure occurred. No commit or push was attempted.

## DONE

All six charter stages are implemented. The full author-ruled sharing grammar,
stable collection semantics, lifecycle/cut integration, exact MediaRef reads,
closed capability mirrors, and affected evidence are complete; no Phase A
semantic or implementation blocker remains.
