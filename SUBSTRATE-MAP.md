# Substrate map — LLP 0239 D2 (`assetCollection`) + D3 (`defineMediaCommand`)

(Prepared by the orchestrator's survey agent, 2026-08-15, at origin/main a93a11235.
Line numbers are approximate anchors, not exact contracts — re-verify locally.)

## 0. Governing documents (read first)

- `issues/20260815-finish-media-happy-path.md` — the open rollout ticket for exactly D2/D3/D5-collection + guide Paths 2 & 4. Scope A/B/C, required evidence, non-goals. **No new LLP needed**; deviations require amending LLP 0239.
- `llp/0239-asset-collections-and-media-field.rfc.md` (Accepted) — D1..D7, Rollout steps 1–6 (steps 1–2 done, 3–4 are this work).
- `llp/0244-media-ref-projection.spec.md` — the shipped `v.media()`/MediaRef contract every collection item must inherit.
- Predecessor ticket: `issues/20260812-media-ref-snapshot-projection.md`.

## 1. `v.media()` / MediaRef (LLP 0244) — shipped

**Commits:** `5190b7cce` (implementation), `c6a8be969` (merge), `06de2de8c` (acceptance), `6e52240c1` (regen).

**Codegen (authoring → descriptor):**
- `packages/snapback-codegen/define.mjs:424` — `v.media(options)`; validates `intent/policy/kinds/delivery/variants`, emits `{ AssetRef: { upload, media: {...classificationProfile:'detected-content-type.v1', retentionClass:'media-reference.v1', targetCapability:'assets.media-ref-projection.v1'} } }`. Physical column stays the opaque asset id string.
- `packages/snapback-codegen/define.d.ts:33-104` — `v.media` type surface (`MediaFieldDescriptor` shape).
- `packages/snapback-codegen/result-contracts.mjs:335-361` (+ call sites `:442`, `:467`) — lowers the field to the `mediaRef.v1` result contract with `sourceTable/sourceField/sourceFieldGeneration` (`snapback:media-source-field-generation:v1` digest). Guards: `v.media()` is top-level-stored-only, never an arg or anonymous result validator.
- `packages/snapback-codegen/index.mjs:1184 resultContractContainsMedia`, `:2409-2412` (schema pushes `assets.media-ref-projection.v1` into `schemaRequiredCapabilities`), `:5671` (Actions may not return mediaRef), `:9392`, `:10439`, `:13698`.

**Rust descriptor/contract:**
- `src/contract_types.rs:1155` `FieldType::AssetRef { upload, media }`; `:1164 MediaKindV1`; `:1175 MediaFieldDescriptorV1`; `:1244 ResultValueContract::MediaRefV1 {...}`.
- `src/manifest.rs:3132 media_result_contract()`, `:3249 media_source_field_generation()`, `:3217` field→contract dispatch, `:3600/:3626` validation, `:3854` media-bearing functions require concrete `implementationHash`, `:3966`.
- `src/manifest.rs:10886 / :10990` — `TargetCapabilityId::MediaRefProjectionV1` = `assets.media-ref-projection.v1` (experimental).

**Runtime projection (same-snapshot cut + unforgeable provenance):**
- `src/runtime.rs:502-780` — `StagedMediaProjectionProofV1`, `MediaProjectionPlanV1`, `media_projection_proof_binding()`, `expected_media_projection_proof_binding()`, `media_projection_plan()`, `normalize_media_contract_value()`, domain `snapback:media-proof-principal:v1`.
- `src/runtime.rs:2155 deproject_media_document()`, `:2176 tag_media_document()`, `:2288 normalize_media_result()`, `:2163-2260` (projection over `FieldType::AssetRef { media: Some(_) }`, token `snapback:media-provenance-token:v1`), `:3143/:3181` host-op `media.handoff`.
- `src/runtime.rs:1902` invocation state: `media_entries`, `media_handoff`, `next_media_entry`, `pinned_snapshot`.
- `ExecutedIbexMutation` (`src/runtime.rs:~1898`) carries `media_projection_proof` + `media_projection_scope` beside `asset_admissions`/`asset_grant_ops`.
- `src/storage/settlement.rs:~593` — `SettlementProjectionSealV1` verification before recovery publication.
- Attachment enforcement: `src/storage.rs:13027 enforce_asset_reference_changes()` — the finalized-only media branch at `:13165-13205` (`SNAPBACK_MEDIA_ASSET_NOT_FINALIZED`, `SNAPBACK_MEDIA_KIND_NOT_ADMITTED`, kind-vs-detected-content-type integrity), then `assets::insert_reference_edge` + `AssetReceiptEventV1::AttachmentCommitted`.

**Client types / neutral store:**
- `packages/snapback-client/assets.d.mts:101-136` — `MediaKind`, `MediaRef<K>`, `MediaState<K>`, `MediaStore<K>`; `:225 mediaStore()` on `SnapbackAssetClient`.
- `packages/snapback-client/assets.mjs:578 assertMediaRef`, `:600 mediaIssuanceOptions`, `:621 class MediaStore` (pure projection over `AssetIssuedUrlStore`), `:690 EMPTY_MEDIA_STORE`, `:1104 mediaStore()`.
- Exported via the `@expo/snapback-client/assets` subpath (`packages/snapback-client/package.json:258`).

**Plug-in note:** a collection item is exactly this `mediaRef.v1` value plus item metadata — reuse `media_result_contract()` and `MediaStore` rather than minting a second media value shape.

## 2. LLP 0180 `defineCommand`

**Authoring:** `packages/snapback-codegen/define.mjs:2529 defineCommand(spec)` — closed data `{ mutation, assets: { [input]: { intent, mutationArg, optional } } }`, marker `COMMAND`, `__kind: 'AssetBearingCommand'`. Invalid cardinality is preserved as data so the validation lane emits a stable refusal. Type: `define.d.ts:922-924 AssetBearingCommandSpec`.

**Codegen admission:** `packages/snapback-codegen/index.mjs:12823 buildGeneratedCommands({commandDefs, functionsModule, generatedReferences, err})` → emits `{ kind: 'asset-bearing-command.v1', mutation, asset, passthroughArgs }`. Diagnostic codes: `SNAPBACK_COMMAND_INVALID_IDENTIFIER`, `_MUTATION_CARDINALITY_INVALID`, `_MUTATION_UNKNOWN`, `_MAPPING_AMBIGUOUS`, `_MULTI_ASSET_UNSUPPORTED` (v1 ≤1 asset — D3 lifts this), `_ASSET_INTENT_UNKNOWN`, `_ASSET_INTENT_ARGS_UNSUPPORTED`, `_ASSET_MAPPING_INCOMPATIBLE`, `_INPUT_COLLISION`, `_AUTHORITY_INPUT_REFUSED`.
- Reference kind emission: `index.mjs:13771/13781` (`__snapbackReferenceKind: 'Command'`).
- Builder allowlist: `index.mjs:15940` (`'defineCommand'` in the admitted top-level builders set) — add `defineMediaCommand` here.
- Source attribution for command errors: `index.mjs:16098 inferredDefinitionEvaluationPath()` (regex over `defineCommand() asset X.Y`).
- Surfaces: `index.mjs:13023 commandDefinitions` inside `buildGeneratedSurfaces`; `packages/snapback-codegen/app-descriptor.mjs:516`.

**Client CommandTask:** `packages/snapback-client/commands.mjs` — `class CommandTaskImpl` (`:135`), `startCommandTask` (`:539`), `class SnapbackCommandClient` (`:545`, `.start()`, `adaptAssetSource()`, `isAuthorityCurrent()`, `dispose()`), `createCommandClient` (`:648`). Helpers: `assertCommandDescriptor` (`:58`), `commandCall` (`:97`), `authoritativeUnattachedFact` (`:128`), `retryRemediation` (`:42`), residue via `#residue()`. Statuses: `preparing → transferring → …` terminal `succeeded|failed|cancelled|ambiguous`.
- React: `packages/snapback-react/index.d.mts:697 useSnapbackCommand`, `invokeSnapbackCommand`; `packages/snapback-react/full-capabilities.mjs:5`.
- Expo source normalization: `packages/snapback-expo/asset-source.mjs`.

**Rust side / server-side invocation:** there is **no** command route. A command is a client composition; the server sees only the ordinary mutation. The only Rust `@ref LLP 0180` is `src/manifest.rs:3637` (a command's mapped mutation argument admits the opaque `AssetRef` contract). This is precisely the seam D3 changes: `MediaCommandBindingV1` must be installed on `FunctionDefinition` (`src/manifest.rs:7854`) inside `FunctionManifest` (`:2018`), and validated/staged by the mutation host.

**Mutation host (where atomic staging belongs):**
- `src/storage/mutation_writes.rs` — `MutationWritesKernel` (`:499`) with `execute_mutation*`, `execute_mutation_guarded<G, Check, BeforeCommit>` (`:19`), `execute_host_mutation_guarded*`, `commit_buffered_writes*`, `apply_buffered_writes` (`:460`). The `BeforeCommit` hook is the natural insertion point for collection-row + attachment + grant staging.
- `src/storage.rs:924 / :969` — buffered `asset_admissions`; `:13027 enforce_asset_reference_changes` runs under the final write lock.

## 3. LLP 0110 bounded-children machinery

**Spec:** `llp/0110-bounded-children-and-activity-patterns.spec.md` §1 (bounded parent/child query profile: closed plan, exact index + work bound, existence secrecy, cursor/deletion, live+retained classification), §2 (write-plus-activity), §1002 "Protected relation incarnation and stamping".

**Authoring:** `packages/snapback-codegen/define.mjs:2901 defineBoundedChildrenQuery(spec)` — requires `children.foreignKey` = required `Id<parent>`, `children.parentIncarnation` = matching `relationIncarnationOf` field, exact `children.index` = `[fk, incarnation, ...order]`, `take` 0..1024, `parentDeletion: 'hide-orphans.v1'`, projections must be LLP 0110 portable scalars (`boundedProjectionValidator`, `:2892`) and include `_id`. Also `define.mjs:380` (`v.relationIncarnationOf`), `:3921 defineWriteWithActivity`, `:4205`.

**Manifest/plan (Rust):** `src/manifest.rs:8305 BoundedChildrenQueryPlan`, `:8359 SnapshotBatchNodeV2::BoundedChildren`, `:8983 HandlerPlan::BoundedChildrenQuery`, validation `:6161 validate_bounded_children_plan_shape`, capability wiring `:2448-2482`, `:6511`.
**Execution:** `src/local.rs:21020`, `:21171` (cursor decode), `:28025 validate_bounded_children_schema_plan`, `:28151 validate_bounded_children_node_schema_references`, `:29279`, `:32746` (plan execution + cursor mint), `:30437-30453` cursor refusals.
**Cursor:** `src/bounded_children_cursor.rs` (`sbbc1` AEAD cursor; `decode`, restart precedence at `:254`).
**Incarnation/stamping (storage):** `src/storage.rs:3314`, `:4663`, `:13896`, `:13996`.
**Tests:** `src/local/tests.rs:16557`, `:16640`; `src/storage/tests.rs:3987`, `:4200`.

**Plug-in note:** `assetCollection` compiles to a framework-owned child table + its `relationIncarnationOf` pairing + a `BoundedChildrenQueryPlan`-shaped read. The child projection must be extended to admit the `mediaRef.v1` node (today `boundedProjectionValidator` refuses non-portable leaves) — that is the one deliberate contract widening D2 needs.

## 4. Asset attachment lifecycle (Rust)

| Concern | Location |
|---|---|
| Attach admission types | `src/assets.rs:2106 AssetAttachmentAdmission`, `:2113 AssetWritePath{Handler,HostPlan,Seed}`, `:2122 AssetCommitAuthority` |
| Commit-boundary check | `src/assets.rs:2347 verify_attachment()`; refusals via `:2329 attach_refusal` |
| Reverse edges (GC roots) | `_snapback_asset_reference_edges_v1` (`src/assets.rs:1592`), `:2206 insert_reference_edge`, `:2250 delete_reference_edge`, `:2130-2200 load_edge_for_field / load_edges_for_row` |
| Enforcement driver | `src/storage.rs:13027 enforce_asset_reference_changes()` (detach receipt → attach verify → media finalized-only → insert edge → `AttachmentCommitted` receipt) |
| Grants (0210/0220) | `src/storage/asset_grants.rs` — `apply_to_snapshot` (`:79`), `preview` (`:217`), `apply_in_tx` (`:250`); buffered ops `crate::assets::BufferedAssetGrantOp` staged on the invocation (`src/runtime.rs:~1905`, `:3800`); `src/assets.rs:883` |
| Reference GC / maintenance | `src/storage/asset_maintenance.rs` — `gc_reclaimable_reference_assets`/`gc_reclaim_reference_asset` (`:818/:825`), `gc_reclaimable_pending_assets`, `gc_purgeable_tombstones`, `gc_condemnable_blobs`, `gc_reclaim_intent_artifacts`, runner claim/settle |
| Attempts / finalization | `src/storage/asset_attempts.rs` — `attempt_create`, `attempt_finalize_commit_plan/_staged/_completion`, `stage_prepared_variant_*`, quota guard at `:77-108` |
| Quota accounting | `src/assets.rs:2647-2700 AssetAccounting` + `asset_accounting()`, `open_attempts_for_principal()`; ceilings `ASSET_APP_LOGICAL_QUOTA_BYTES` (`:4025/:4104`), `ASSET_MIN_ACCOUNTING_UNIT_BYTES` |
| Authorization invalidation | `src/storage/auth_invalidation.rs` — `data_version_stream`, `activate_ordinary_mutation_coverage_for_evidence`, `activate_local_target_operation_coverage`, `rotate_data_version_stream_in`, retry-episode registry |
| Consistent-cut export/import | `src/assets_cut.rs` — `ASSET_CUT_FORMAT_VERSION = "snapback.asset-cut.v1"`, `AssetCutManifestV1`, `AssetCutAssetV1`, `AssetCutTombstoneV1`, `AssetCutBlobV1`, `AssetCutQuotaV1`, `capture_cut()` (`:161`), `validate_export_dir()` (`:302`), `apply_cut()` (`:482`), `cut_manifest_digest()` |
| Reads / signed issuance | `src/storage/asset_reads.rs` (`:675` issuance defaults), `src/server/asset_routes.rs:463` |
| Image/video/S3/store backends | `src/assets_image.rs`, `src/assets_video.rs`, `src/assets_s3.rs`, `src/assets_store.rs` |
| Table-level sharing declaration | codegen `define.mjs:1573 assetSharing(spec)` (`public-read` / `owner` / `membership`); manifest `src/manifest.rs:1267-1282 asset_sharing: Option<AssetSharingManifest>` |

**Plug-in note:** collection rows must (a) create reference edges through `insert_reference_edge` so `gc_reclaimable_reference_assets` sees them, (b) be added to `capture_cut`/`apply_cut` as part of the asset component, and (c) participate in `auth_invalidation`'s data-version stream.

## 5. Issued-URL controller / `useSnapbackMedia` (0210 D1, 0239 D5)

- **Neutral controller:** `packages/snapback-client/assets.mjs:1058 issuedUrlStore(assetId, options)` (keyed entry map `#issuedUrlEntries`, refcounted release) → `AssetIssuedUrlStore` (`assets.d.mts:94`).
- **Media projection:** `assets.mjs:621 class MediaStore` — *pure view*, owns no transport/timer/authority; `EMPTY_MEDIA_STORE` (`:690`) is an inert frozen singleton for `null`/`undefined`; `''` throws a contract error.
- **React:** `packages/snapback-react/implementation.mjs:5288 useSnapbackAssetUrl`, `:5321 useSnapbackMedia` (⚠️ this file is flagged binary by `grep` — use `grep -a`). Re-exported through `packages/snapback-react/full-capabilities.mjs:27` → `index.mjs:16`. Types at `packages/snapback-react/index.d.mts:910-916` (`MediaHookState`, `useSnapbackMedia`). Registry keying: `assetRegistryFor(provider)` + `canonicalHookInputKey` + `subscribeIssuedUrlGeneration` (authority-generation blanking).
- **Expo:** `packages/snapback-expo/index.mjs` re-exports the React surface; `asset-source.mjs` normalizes picker-shaped sources.

**`useSnapbackMediaCollection` does not exist anywhere.** It is net-new: add a neutral `mediaCollectionStore(items, options)` in `assets.mjs` that composes one `issuedUrlStore` entry per `(assetId, authority, rendition options)` and a React projection beside `useSnapbackMedia` at `implementation.mjs:5321`; export via `full-capabilities.mjs` → `index.mjs` → `index.d.mts`, and add the name to `packages/snapback-react/package.test.mjs:1783`'s export inventory.

## 6. Codegen architecture

- **Entry:** `packages/snapback-codegen/index.mjs` (17,485 lines) — `generate(backendRoot)`. Definition bundles are built and evaluated in an isolated VM (`buildDefinitionBundle`, `index.mjs:~2185`); authoring API is `packages/snapback-codegen/define.mjs` (4,823 lines) + `define.d.ts`.
- **Schema field kinds:** validated in the table loop at `index.mjs:~2340-2415` (`SCHEMA_ID_TARGET_UNKNOWN`, `SNAPBACK_RELATION_SCHEMA_INVALID`, media capability push at `:2409`). Manifest assembly at `index.mjs:6331 schemaManifest` / `:6383 functionManifest`, with `schemaRequiredCapabilities` and `acknowledgedExperimentalCapabilities`.
- **Result contracts:** `packages/snapback-codegen/result-contracts.mjs` (`validatorResultValue`, `scalar`, table field lowering at `:442/:467`).
- **Command descriptors:** `index.mjs:12823 buildGeneratedCommands`, surfaces `:13006 buildGeneratedSurfaces`.
- **Capability tables:** `index.mjs:1090-1130` — the closed capability id set and `EXPERIMENTAL_TARGET_CAPABILITY_IDS` (must mirror `src/manifest.rs TargetCapabilityId::maturity` byte-for-byte). New ids `assets.media-collection.v1` / `assets.media-command.v1` go in **both**, plus `schemas/capability.manifest.schema.json`, `schemas/inspect*.schema.json`, `tests/acceptance/capability-registry.ids.json`.
- **Source-attributed diagnostics (D6):**
  - `index.mjs:16024 definitionAttributionFromSource()` → `{ definitions, propertySpans }` (acorn parse, dotted property-path → span map).
  - `index.mjs:16070 definitionEvaluationPath()` — longest-prefix span match → `{ definitionPath, details.definitionPath, line, column, sourceSpan }`.
  - `index.mjs:16098 inferredDefinitionEvaluationPath()` — message→path inference; **extend this regex for `defineMediaCommand()`** (`sendMessage.media.optional`, `sendMessage.attach.collection`).
  - `index.mjs:2151-2181` — `SNAPBACK_CODEGEN_DEFINITION_NOT_EXPORTED` emission with binding + remediation.
  - `functionDefinitionAttribution` threaded at `:2028/:2121/:2139/:2219` and into isolated evaluation at `:16786/:16858`.
  - Registry: `guide/reference/diagnostics-registry.json` (6,420 codes) + `guide/reference/diagnostics.md`.
- **Generated ops / table mutations:** `packages/snapback-codegen/standard-patterns.mjs` — `defineOwnedCrud` (`:206`), `lowerDataResourceV1` (`:377`), `defineOwnedUniqueLookup` (`:525`), `defineOwnedKeysetPages` (`:569`), `defineMembershipKeysetPages` (`:663`). These are the model for the generated `append/replace/remove/reorder` collection ops (note `SNAPBACK_STANDARD_PATTERN_TABLE_INELIGIBLE`: generated CRUD refuses authority-bearing tables — the collection table needs its own eligibility rule).
- Generated mutation IR: `index.mjs:8511 generatedMutationIrV1`, call site `:13502`; client mirror `packages/snapback-client/generated-mutation-ir.mjs`.

## 7. Guide Paths 2 & 4 + snippet CI

- `guide/backend/media-happy-paths.md` — Path 1 (shipped, transcluded), **Path 2 GAP** (lines 80–86), Path 3 (shipped), **Path 4 GAP** (lines 121–127). Anti-patterns at 129–139 include "Do not treat `assetCollection` or the media command as shipped." Frontmatter `capabilities:`, `authorities:`, `examples:`, and `reviewed-authorities-digest: sha256:…` — the digest must be recomputed when authorities change.
- `guide/capabilities.md:64` (`assets.media-field.v1`, shipped), `:65` (`assets.media-collection.v1`, design-only GAP, owner LLP 0239 R3), `:66` (`assets.media-command.v1`, design-only GAP, owner R4). Both GAP rows currently point at the old issue file and should be repointed at `issues/20260815-finish-media-happy-path.md`.
- **Snippet classes** (`guide/conventions.md` §"Code snippets", enforced by `scripts/guide-lib.mjs:474-502` via `scripts/check-guide.mjs`):
  1. **transcluded-verified** (default) — ` ```js source=<repo-path> `; body must be a byte-exact contiguous substring of a CI-exercised file;
  2. **fragment** — ` ```js fragment reason="…" `, unverified but tracked;
  3. **standalone-runnable** — reserved; the checker rejects it.
  Manifest: `scripts/generate-guide-manifest.mjs` → `guide/guide-manifest.generated.json`; flat pages `guide/guide-flat*.generated.md` are regenerated artifacts.
- Path 2/4 replacements need real CI-exercised source files to transclude from — natural homes are `tests/acceptance/fixtures/media-profile/snapback/{schema,functions}.mjs` (extend) or a new fixture, plus a `.fixture.ts` in `packages/snapback-react/` for the hook snippet.

## 8. Existing partial work

**None.** `assetCollection`, `defineMediaCommand`, `MediaCommandBinding`, `mediaCommand`, `media-collection`, `useSnapbackMediaCollection` appear only in prose (LLPs, tickets, guide GAP text). Zero hits in `src/`, `packages/` (non-node_modules), or `tests/`. Both features are greenfield on top of shipped substrate.

## 9. Test locations & organization

**Rust (in-crate `#[cfg(test)] mod tests`, run by `cargo test`):**
- `src/storage/tests.rs` (17,942 ln) — storage/commit-boundary/settlement; media rows appear as `media_projection_proof: None, expected_media_projection_binding: None` in ~8 request fixtures — **any new field on that request struct must be added here**.
- `src/local/tests.rs` (31,735 ln) — end-to-end local target: asset lifecycle (`asset_record_view_exposes_renditions_and_media_facts` `:7815`), attachment admissions (`AssetAttachmentAdmission` at `:3821`–`:9298`), bounded children (`:16557`, `:16640`), media handoff (`:26662`).
- `src/server/tests.rs` (31,276 ln), `src/cli/tests.rs`; per-module tests inside `src/storage/asset_grants.rs` (`:428` GC/edges, `:503` quota boundary, `:619` activation/revoke race).
- Integration targets: `tests/*.rs` (one file per capability, `*_v0.rs`/`*_v1.rs` naming). No asset/media integration target exists yet.

**JS packages (plain `node <file>.test.mjs`, chained in each `package.json` `"test"` script):**
- `packages/snapback-codegen/media-field-authoring.test.mjs` — the model for a new `media-collection-authoring.test.mjs` / `media-command-authoring.test.mjs` (copies `tests/acceptance/fixtures/media-profile` to a tmpdir, runs `generate()`, asserts manifest shape + `requiredCapabilities`).
- `packages/snapback-codegen/asset-upload-authoring.test.mjs`, `relation-activity-authoring.test.mjs`, `snapshot-batch-v2-authoring.test.mjs`, `standard-patterns.test.mjs`, `operation-schemas.test.mjs`.
- `packages/snapback-client/assets.test.mjs`, `commands.test.mjs`, `assets-watch-authorization.test.mjs`, `authorization-invalidation.test.mjs`.
- `packages/snapback-react/assets.test.mjs` (fake asset client with `mediaStore`/`mediaStoreFor` at `:229-297`; `useSnapbackMedia` cases at `:511-566`), `commands.test.mjs`, `package.test.mjs` (export inventory, `:1783`).
- Type fixtures compiled by `tsc --noEmit --strict`: `packages/snapback-react/asset-upload-types.fixture.ts`, `packages/snapback-client/exact-reference-types.fixture.ts`.

**Acceptance fixtures & suites:**
- `tests/acceptance/fixtures/media-profile/snapback/{schema.mjs,functions.mjs,generated/}` — the LLP 0244 fixture; extend or add a sibling `media-collection` fixture.
- `tests/acceptance/fixtures/familiar-video-asset/`, `tests/acceptance/familiar-video-asset-v1.mjs`, `tests/acceptance/asset-conformance-v1.mjs`, `tests/acceptance/asset-lifecycle-v1-evidence.md`.
- Capability registry parity: `tests/acceptance/capability-registry.ids.json`, `capability-maturity.experimental.json` (checked by `scripts/check-capability-maturity.mjs`).

**Gates before landing (orchestrator runs these):** `node scripts/check-guide.mjs`, `node scripts/check-inventories.mjs`, `./ref-check --verbose`, `node scripts/check-capability-maturity.mjs`, `node scripts/check-generated-types`, plus `cargo test` and the per-package `npm test` chains.
