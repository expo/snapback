# LLP 0044 `asset-lifecycle-v1` acceptance evidence (local target)

<!-- @ref LLP 0044#acceptance — the traceability meta-requirement this map satisfies -->

This map records executable evidence for the Accepted LLP 0044 acceptance
rows reachable from the `asset-lifecycle-v1` composite on the canonical
local target (filesystem store, TUS lane, `private-strict` delivery). It
does not amend the RFC. Every row is **covered** (named tests), **deferred**
(named successor with a tracking artifact), or a **nonclaim** (the manifest
reports the capability Missing). Rust tests live in `src/local.rs`
(`local::tests::*`) unless another path is named; the suite runs with
`SNAPBACK_ASSET_RUNNER_DISABLED=1` semantics — deterministic drives via
`asset_runner_tick`/`asset_gc_sweep`/`asset_publication_maintain`, never the
background loop.

## Intents and admission

| Acceptance row | Evidence |
|---|---|
| Generated reference cannot be widened; stale reference refuses before staging | `packages/snapback-codegen/asset-upload-authoring.test.mjs` (declaration fixes the policy; refusals are generation-time) plus `asset_attempt_refusals_are_structured` (`SNAPBACK_ASSET_INTENT_STALE` before any reservation) and `manifest` validation `asset_upload_intent_manifest_*` (4 tests). |
| Location policy mandatory; strip requires the finalization fact; retain admits | `asset-upload-authoring.test.mjs`: `SNAPBACK_ASSET_INTENT_LOCATION_POLICY_REQUIRED` (omission refuses), strip **admits on local** since the image-pipeline flip (the local manifest advertises `asset_image_finalization_v1`) and **refuses on the remote profile** which withholds the fact; video strip refuses everywhere; retain admits. Defense in depth at the finalizer for a fact-less target: `asset_finalize_strip_policy_defense_rejects_the_asset` (override-pinned disabled posture). |

## Client task and SDKs

| Acceptance row | Evidence |
|---|---|
| Stable asset reference, local preview, pause/resume/cancel/retry, id across successor | **Covered (headless task)** — `packages/snapback-client/assets.test.mjs`: closed-snapshot transitions, optimistic preview surviving to ready, pause/resume, retry preserving the asset id across the successor attempt. Server half covered: `asset_retry_supersedes_and_lineage_gates_access` (same asset id across the authorized successor), `asset_attempt_lifecycle_creates_transfers_resumes_and_cancels`. |
| Authority change blanks task/preview; late stale work generation-fenced | **Partially covered** — persisted facts partition by authority identity (`assets.test.mjs`); the provider-replacement blanking UI leg rides the React projection (L1-14 remainder). Server generation fencing covered: superseded-attempt refusal in `asset_retry_supersedes_and_lineage_gates_access`; runner fence in `asset_runner_generation_fence_cancels_stale_work_at_claim`. |
| SDK conformance vectors | **Deferred** (L1-14 remainder): the real-server JS vectors. The headless task's scripted-route suite (`assets.test.mjs`) covers the client half — per-PATCH sha256 checksums, whole-upload digest, deferred-length refusal — pending the live-target run. SDK staging is LLP 0064's. |

## Transfer

| Acceptance row | Evidence |
|---|---|
| TUS resume after restart; cancellation/expiry/GC structured | `asset_transfer_resumes_across_restart_on_disk`, `asset_attempt_lifecycle_creates_transfers_resumes_and_cancels`, `asset_expired_attempt_refuses_and_receipts`, `asset_gc_reclaims_expired_attempts_pending_assets_orphans_and_tombstones`. |
| Successor supersedes; racing writers converge; late completion fenced | `asset_retry_supersedes_and_lineage_gates_access` (structural single-current partial unique index from `assets::tests`). |
| Deferred length refused; grades honest; checksummed corruption detected at transfer | `asset_attempt_refusals_are_structured` (`SNAPBACK_ASSET_DEFERRED_LENGTH_UNSUPPORTED`), `asset_checksums_gate_chunks_and_grade_basis_demotes_without_them`, `asset_finalize_grades_honestly_and_verifies_declared_digests` (weaker grade never reported as stronger). |
| Persisted client task state carries no bearer material | **Covered** — `assets.test.mjs` pins the exact closed member set and greps the serialized fact for bearer/staging/signing material. The server-side analogue is covered: operator inspection carries no staging keys/admissions (`asset_host_ops_round_trip_put_inspect_list_retry_delete`). |

## Staging, finalization, and publication

| Acceptance row | Evidence |
|---|---|
| Staging unreachable; finalization verifies, detects, digests, publishes idempotently | Structural: no registered route serves staging (`tests/route_policy_v1.rs` registry parity) and store keys refuse path shapes (`assets::tests`). Behavior: `asset_finalize_publishes_end_to_end_and_is_idempotent`, `asset_finalize_refuses_incomplete_transfers_and_detects_types_from_bytes`. |
| GPS strip on ready blobs | **Covered** (image pipeline): `asset_finalize_strip_publishes_canonical_without_gps` — a GPS-EXIF JPEG publishes with the canonical blob provably APP1-free on the delivered bytes, orientation applied, captured-at retained; `asset_finalize_strip_vs_retain_blobs_differ_and_strip_dedups` (retain keeps location under explicit policy evidence; strip-vs-retain never alias in blob identity). |
| Required renditions gate ready | **Covered** with real variants: `asset_variants_required_gate_ready_and_optionals_ride_the_runner` (required produced inside the publication transaction, atomically with `ready`; optionals enqueue transactionally and ride the runner); quota isolation in `asset_variant_quota_refusals_are_structured_and_never_gate_the_primary`. |
| Fault injection at the named crash cuts; uniqueness loser converges; dedup-vs-GC race safe; retirement frees headroom | `asset_finalize_crash_cuts_recover_via_publication_records`, `asset_finalize_condemned_race_republishes_under_a_fresh_key`, `asset_finalize_dedups_within_the_app_and_charges_quota_twice`, `asset_publication_records_retire_after_the_retention_window`. Mid-migration cut: **deferred** — v1 has one store parameter; store migration lands with the second store (see Runner and cleanup). |
| Deletion cascade exact; crash-mid-cascade recovers | `asset_delete_cascade_is_exact_on_shared_and_unshared_blobs` (shared and unshared blobs, primary counted exactly once, exact refcount/quota), `asset_delete_refuses_foreign_callers_references_and_recovers_from_crash`. |

## Dedup and quota

| Acceptance row | Evidence |
|---|---|
| Identical bytes: two assets, one blob, quota twice | `asset_finalize_dedups_within_the_app_and_charges_quota_twice`. Cross-app invisibility is structural in v1: blob identity and every query are app-scoped by the `(app, algo, digest, policy)` key and the single-app instance model. |
| Reservations cannot overrun; releases fenced; settlement exact | `asset_attempt_refusals_are_structured` (bounds), `asset_expired_attempt_refuses_and_receipts` + `asset_gc_*` (release after store fencing), `asset_delete_cascade_*` (tombstone-commit release). |
| Ceilings on durable record classes; minimum accounting unit | `asset_per_principal_ceiling_refuses_structured`; the enforced-limit vector is asserted against the manifest in `tests/capability_v0.rs`. |

## References and attachment

| Acceptance row | Evidence |
|---|---|
| Attach commits row+edge atomically; disagreement/wrong-owner/stale fail closed | `asset_handler_raw_write_refuses_and_attach_admission_commits_edge`, `asset_attach_wrong_intent_wrong_owner_and_deleted_asset_fail_closed`. |
| `SNAPBACK_ASSET_REF_UNVERIFIED` on every write path; host-plan both shapes; import refuses | `asset_handler_raw_write_refuses_...`, `asset_host_plan_and_seed_derive_admission_from_the_restriction` (restricted pass, wrong-owner/wrong-intent fail closed, unrestricted refuse; seed both shapes). Logical import has no code path while export/import is Missing — the refusal is structural, recorded as the intended consequence in LLP 0044 §Typed references. |
| Edges follow patch/clear/row-delete; delete refuses while referenced | `asset_edges_follow_patch_clear_and_row_delete_in_the_same_changeset`, `asset_delete_refuses_foreign_callers_references_and_recovers_from_crash`. Reference-GC warning listing: **nonclaim** — opt-in reference GC is the later `asset_reference_gc_v1`; the via-references deployment warning half is covered in `asset-upload-authoring.test.mjs`. |

## Read authorization and delivery

| Acceptance row | Evidence |
|---|---|
| owner-only denies; via-references grants/revokes with edges; live blanking | `asset_read_authorization_decides_only_through_sharing_declarations`, `asset_read_decision_pins_the_empty_edge_range_so_first_attachment_moves_it`. Live-subscription blanking: **covered** — `asset_record_live_projection_publishes_wakes_and_blanks_with_no_polling` (edge removal blanks the live view; deletion blanks the owner). |
| Sharing declarations only; mixed table cannot bypass | `asset_read_authorization_decides_only_through_sharing_declarations` (the mixed-table stand-in confers nothing). |
| Revocation triggers refuse; ordinary redeploy finalizes frozen | Partial: the revoked-generation refusal exists (`SNAPBACK_ASSET_INTENT_REVOKED`) and hash-moved-witness-unmoved publishes frozen (`asset_finalize_witness_rechecks_benign_churn_publishes_denial_refuses`); the operator/deploy revocation surfaces and frozen-code retention are open follow-ups (`issues/20260731-0044-frozen-generation-artifact-retention.md`). |
| Complete witness: revocation, phantom insertion, deleted row, empty query; benign churn publishes | `asset_finalize_witness_rechecks_benign_churn_publishes_denial_refuses` with the `asset_plant_missing_row_witness`/`asset_insert_phantom` fixtures. |
| Signed issuance authorized; bearer until TTL; tampered/expired refuse | **Covered (W2b)** — `asset_signed_url_issues_and_serves_as_a_bearer_until_ttl`: per-request-authorized issuance (foreign caller refused), the token serves with no authority at all (the bearer semantics), TTL clamp and unsignable `best` refuse, tampered token is one 403 class, expired is 401-shaped. |
| Rotation invalidates outstanding URLs; generation move invalidates; delete masks | **Covered (W2b)** — `asset_signed_url_rotation_and_generation_moves_invalidate`: `asset.rotateSigningKey` retires every key (receipted, no key ids), a stale-generation signature refuses, deletion masks the alias. |
| Public-immutable: immutable headers, rendition ETag, never an existence oracle, delete stops canonical access | **Covered (W2b)** — `asset_public_lane_serves_immutable_and_masks_everything_else`: `public, max-age=31536000, immutable`, `"r-…"` ETags, strict/pending/deleted assets all mask as unknown on the public lane. |
| Profile admission is manifest-keyed | **Covered (W2b)** — codegen refuses an undeclared profile against a declared facts block (`asset-upload-authoring.test.mjs`), and attempt creation re-checks via `asset_delivery_profile_declared` (defense in depth; unit-pinned in the public-lane test). Targets with no assets block keep the runtime-refusal posture. |
| Strict delivery: per-request auth, no-store, alias identity, disposition, trusted facts | `asset_delivery_serves_full_and_range_windows_with_strict_facts`, `asset_delivery_forces_attachment_for_unrecognized_bytes_and_gates_readiness`, `asset_delete_cascade_is_exact_on_shared_and_unshared_blobs` (B stays deliverable after A's deletion under a shared blob). |
| Range requests | `asset_delivery_serves_full_and_range_windows_with_strict_facts` (200/206/416/suffix; content-agnostic, so the video claim is the same range machinery). |

## Liveness and processing

| Acceptance row | Evidence |
|---|---|
| Availability/renditions update live with no polling | **Covered** — the reserved `_snapback.assetRecord` projection: `asset_record_live_projection_publishes_wakes_and_blanks_with_no_polling` (publish delivers ready with no polling; the first attachment wakes a blank subscriber through the pinned empty-range capture) and `asset_record_live_projection_refuses_bad_input_and_unrelated_commit_stays_quiet` (fingerprint dedup; no delivery on unrelated commits). Sessions-mode: **covered** as of W2e — see §Completion program (W2e) below. Progress-cannot-settle is covered: only finalization settles quota or readiness (`asset_finalize_*`; TUS patches change no durable availability). |
| Image processing / hostile corpus | **Covered** — see §Image pipeline below (`asset_image_pipeline_v1` is claimed on local). |
| Only closed transitions occur | The closed guards refuse unlisted transitions at the persistence layer (`assets::tests` transition tables) and every lifecycle test drives only legal paths; refusal cases in `asset_attempt_refusals_are_structured` and `asset_host_ops_refuse_bad_input_and_ride_the_envelope`. |

## Runner and cleanup

| Acceptance row | Evidence |
|---|---|
| No-subscriber completion; per-item receipts; lease reclaim; retry ceiling; transactional enqueue; generation-fence cancel | `asset_runner_completes_enqueued_work_with_no_live_subscriber`, `asset_runner_reclaims_an_expired_lease_as_a_receipted_transition`, `asset_runner_retry_ceiling_produces_a_durable_exhausted_failure`, `asset_runner_generation_fence_cancels_stale_work_at_claim`, `asset_runner_deadline_and_unknown_kind_exhaust_without_retry_burn`. Lifecycle callbacks: **covered** as of W2c — see §Completion program below. LLP 0070 runner generation: **deferred by design** — 0070 is Draft; the amendment it anticipates gates the second generation. |
| GC classes each receipt and obey windows; cancel-and-discard | `asset_gc_reclaims_expired_attempts_pending_assets_orphans_and_tombstones`, `asset_attempt_lifecycle_creates_transfers_resumes_and_cancels` (discard path). |
| Store migration | **Deferred** — one store parameter exists in v1; migration machinery (records, fenced switch) lands with the second store and must add the mid-migration crash cut then. |

## Tooling and manifest

| Acceptance row | Evidence |
|---|---|
| CLI/inspection uploads, inspects, retries, explains — no byte samples/staging keys/bearer URLs | `asset_host_ops_round_trip_put_inspect_list_retry_delete`, `asset_host_ops_refuse_bad_input_and_ride_the_envelope`; `snapback assets` subcommands ride the same operations over `post_host_op`. |
| Manifest distinguishes composites, store parameter, profiles, grades, ceilings; nonclaims Missing | `tests/capability_v0.rs` (committed manifests: local claims `asset_lifecycle_v1`, `asset_image_finalization_v1`, and `asset_image_pipeline_v1` with `local-fs`, `private-strict`, and the Enforced image ceilings block; served/workerd/Cloudflare withhold all three; the `missing` nonclaims list is present, never omitted). |

## Image pipeline (`asset-image-pipeline-v1`, local target)

| Acceptance row | Evidence |
|---|---|
| Hostile inputs refuse structurally within declared ceilings | `assets_image::tests` corpus — dimension lie (refused pre-allocation from self-parsed headers), truncated file, metadata bomb, decompression-ratio bomb, zero step budget, output ceiling — each a structured `SNAPBACK_ASSET_IMAGE_*` refusal; hostile bytes at finalization reject the asset deterministically (`asset_finalize_strip_hostile_and_unsupported_reject_the_asset`). |
| Typed media facts: dimensions, placeholder, dominant color | `asset_finalize_strip_publishes_canonical_without_gps` + retain-path facts tests; ThumbHash determinism + cross-decoder fidelity: `assets_image::tests` pinned vector and `packages/snapback-codegen/asset-thumbhash-vector.test.mjs` (vendored reference decoder renders our value). |
| Renditions immutable; pointer switch generation-checked; stale run never replaces newer | `asset_variant_stale_recipe_run_cannot_replace_newer` (runner short-circuit AND the pointer layer's `StaleLoses`). |
| Declarative variant selection | `asset_variants_required_gate_ready_and_optionals_ride_the_runner` (by-key delivery and `best?maxWidth=N` selection). |
| Per-rendition quota settlement; optional failure isolated | `asset_variant_quota_refusals_are_structured_and_never_gate_the_primary` (optional exceed = structured rendition failure, primary stays Ready; required exceed = whole-publication abort, asset stays Pending). Optional-failure durability is receipts-based (`RenditionFailed` receipt, no Failed row) — the honest disposition; a Failed rendition row would need a placeholder blob reference. |
| Deletion retires variant renditions exactly | `asset_delete_cascade_is_exact_on_shared_and_unshared_blobs` extended by the P-04 variant-retirement assertions. |

## Completion program (W2c: reference GC and lifecycle callbacks)

| Acceptance row | Evidence |
|---|---|
| Reference GC reclaims only unreferenced ready assets past the app-declared grace; receipts name policy and grace window | `asset_reference_gc_reclaims_only_unreferenced_ready_past_grace` — never-attached clock starts at publication, referenced sibling survives, detach starts the clock, re-attach clears it (a racing attachment always wins), reclamation receipt carries `policy: reference-gc` + `graceMs`. |
| Opt-in means opt-in | `asset_reference_gc_disabled_schema_never_reclaims` — no schema declaration, nothing reclaims at any horizon. |
| Enabling warns about unprotected fields; grace bounds Enforced | `asset-upload-authoring.test.mjs` W2c cases — the `SNAPBACK_ASSET_REFERENCE_GC_UNPROTECTED_FIELDS` warning lists json fields (and the no-typed-fields case), out-of-bounds grace refuses (`GRACE_INVALID`), a target without the facts refuses (`UNSUPPORTED`); `asset_reference_gc_v1` + grace bounds in the committed local manifest (`tests/capability_v0.rs`), withheld elsewhere. |
| Declared callbacks invoked idempotently under retry; failure never touches the asset | `asset_lifecycle_callback_invokes_idempotently_and_isolates_failure` — ready enqueues transactionally with the transition, the runner invokes the declared mutation with typed facts under the owner's authority, a re-driven duplicate never doubles the observable effect (client-mutation-ledger idempotency key `asset-cb:{asset}:{event}:{generation}`), a throwing callback retries toward its ceiling while the asset stays Ready. |
| Callback references contract-pinned; sessions refuses at generation | `asset-upload-authoring.test.mjs` W2c cases — unknown/non-mutation refuses (`CALLBACK_INVALID`), wrong args contract refuses (`CALLBACK_CONTRACT_INVALID` — the closed `{ event, assetId, facts }` shape), sessions-mode schema refuses (`CALLBACK_SESSIONS_UNSUPPORTED`); server-side manifest validation mirrors the mutation check (`SNAPBACK_ASSET_CALLBACK_INVALID` in `asset_upload_intent_manifest_tests`). |

## Completion program (W2d: video finalization)

| Acceptance row | Evidence |
|---|---|
| A GPS-tagged video under strip publishes with no location metadata in the deliverable canonical blob | `asset_finalize_strip_video_publishes_canonical_without_location` — the QuickTime `©xyz` atom is blanked in place in the delivered object (type freed, payload zeroed, layout identical), blob policy `strip-video.v1`, duration/dimensions facts extracted. |
| Strip and retain video can never alias; retain is honest | `asset_finalize_video_retain_keeps_bytes_and_still_extracts_facts` — retain publishes the received bytes (policy `none`, GPS present as declared) yet still derives duration facts; the distinct canonicalization policies participate in blob identity. |
| Hostile or unclassifiable containers refuse structurally; unknown metadata is never passed through | `assets_video::tests` corpus — size lie, truncated header, nested size-0, unsupported brand, unknown `uuid` (fail closed), depth/count/metadata/parse-byte bombs each a structured `SNAPBACK_ASSET_VIDEO_*` refusal; at finalization the asset rejects deterministically (`asset_finalize_strip_video_refuses_without_capability_or_classification`). |
| Location carriers beyond `©xyz` are covered | `assets_video::tests::strips_loci_and_mdta_location_keys_but_keeps_other_metadata` (`loci`, `meta` `keys`/`ilst` location keys blanked, non-location metadata retained) and `blanks_xmp_uuid_and_refuses_unknown_uuid`. |
| Capability admission is manifest-keyed on every side | `asset-upload-authoring.test.mjs` W2d cases — video strip admits on the local manifest, refuses on remote (`LOCATION_STRIP_UNSUPPORTED`); the runtime defense on a fact-less target rejects (`asset_finalize_strip_video_refuses_without_capability_or_classification`); `asset_video_finalization_v1` + the `assets.video` Enforced ceilings in the committed local manifest (`tests/capability_v0.rs`), withheld elsewhere. |

## Completion program (W2e: sessions-mode live projection)

| Commitment | Evidence |
| --- | --- |
| Sessions-mode establishment of the reserved projection under the sealed session identity; blank for a foreign session; refuses without the negotiated invalidation protocol | `asset_record_live_projection_sessions_mode_rides_the_witnessed_lane` on a settled sessions instance (`settled_sessions_activation_snapback`): owner establishes with the pending row, foreign session establishes blank, protocol-less establishment refuses `SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED`. |
| Auth-scoped reserved subscriptions never receive a plain unwitnessed replace; publish and deletion deliver witnessed obligation/snapshot frames | Same test: finalize delivers the `authorization_invalidation` snapshot with the ready row and the suite asserts no `live_replace` frame ever reaches the connection; deletion blanks through the same witnessed lane. The three re-run seams (drain, frame fan-out, resume resnapshot) execute the projection natively — `rerun_asset_record_subscription_witnessed`, the reserved branch in `invoke_authorization_resolution_with_episode`, and the resume branch. |
| No new LLP 0053 classification needed | Recorded in llp/0044 §Status (W2e note): 0053 §Asset read-authorization inputs (2026-07-31) already admits every projection input; the sessions gap was implementation-only. |
