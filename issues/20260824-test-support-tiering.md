# Test-support bypass surface tiering

**Status:** Read-only analysis  
**Date:** 2026-08-24  
**Input:** `issues/20260824-test-support-bypass-surface-inventory.md`  
**Governing:** LLP 0285, LLP 0291, LLP 0303  
**Analyzed checkout:** `e6565f5d97ef3fb3582ec60105a989404d8500f3`

## 1. Method and limitations

I treated the inventory’s 172 class-C rows as the authoritative item set. The inventory audited `2d534c67db0896e2efad7855713122a73c2cb438`; the relevant five crate trees have no source diff between that commit and the analyzed checkout, so the declaration locations below remain current.

For each item I:

1. Searched the workspace’s 935 Rust files for its exact associated-function, method-call, free-function, type-construction, re-export, or externally significant field-access form.
2. Excluded declarations and unrelated same-name fields or methods.
3. Resolved duplicate `LocalDatabase`/`ServingDatabase` method names by inspecting receiver construction and wrapper bodies.
4. Inspected `#[cfg(test)]` ancestry and test modules rather than inferring test use from filenames or names such as `for_test`.
5. Followed wrapper chains when a lower-level item was invoked by a feature-gated wrapper whose ultimate consumer was another crate’s test.
6. Searched the guide, examples, Cargo manifests, and relevant LLP material for documented embedder use. I found none for any class-C item. LLP 0285 explicitly directs that every privileged `test-support` seam be demoted and that cross-crate residue move to production ceremonies, typed probes, or `snapback-harness`.

The project’s `llp-orient` skill could not run because `vendor/llp` is uninitialized in this checkout. I read LLP 0303 and the directly relevant LLP 0285/0291 sections manually.

Call-site notation: `path:{10,20}` means the two checked locations `path:10` and `path:20`.

Replacement codes used in the table:

- **P** — drive the production ceremony instead.
- **H** — use a non-shipping harness, offline fixture builder, controlled transport/backend, or bounded typed probe.
- **O** — move the low-level assertion into the defining crate’s unit tests.

What this may have missed:

- Calls generated only by macro expansion or `include!`.
- Conditional source not present in this checkout.
- Consumers in external repositories. Their mere ability to call an item is not evidence of a legitimate external need.
- Reflection-like references in generated bindings. None of these APIs is registered as a documented external binding.
- For T4, absence is necessarily a source-tree conclusion. Per the task’s requested discipline, every such confidence is reported as `T4-UNCERTAIN`, even where the lexical scan was exhaustive.

For public-field rows, the call-site column reports accesses that depend on the field being public. Internal reads that remain valid after restoring private visibility are not counted as external consumers.

## 2. Counts

| Defining crate | T1 | T2 | T3 | T4 | Total |
|---|---:|---:|---:|---:|---:|
| `snapback-auth` | 0 | 14 | 0 | 0 | 14 |
| `snapback-engine` | 0 | 29 | 0 | 1 | 30 |
| `snapback-kernel` | 9 | 98 | 0 | 14 | 121 |
| `snapback-services` | 0 | 2 | 0 | 0 | 2 |
| `snapback-sync` | 0 | 5 | 0 | 0 | 5 |
| **TOTAL** | **9** | **148** | **0** | **15** | **172** |

The total is exactly 172; no balancing adjustment was made.

## 3. Per-item tiering

### `snapback-auth` — 14 items

| # | Item | Declaration | Tier | Call sites found and purpose | Replacement | Confidence |
|---:|---|---|---|---|---|---|
| 001 | `AdmissionLease::unmanaged` | `crates/snapback-auth/src/auth/admission.rs:873` | T2 | `snapback-sync` authority tests/helper: `crates/snapback-sync/src/auth/invocation.rs:{2704,4491}`. `snapback-engine` host-glue unit fixtures: `crates/snapback-engine/src/runtime/host_glue.rs:{1638,7372,7464,8147,8327,8769,10283,10311,10787,11436,11460,12272}`. | P/O: use controller-owned admission; keep primitive tests in `snapback-auth`. | High |
| 002 | `ProviderRevocationPlan::for_test` | `crates/snapback-auth/src/auth/provider.rs:593` | T2 | `snapback-sync` coordinator revocation test: `crates/snapback-sync/src/auth/coordinator.rs:2314`. | P: obtain the plan through provider revocation/logout planning. | High |
| 003 | `ProviderTokenRotationPlan::for_test` | `crates/snapback-auth/src/auth/provider.rs:678` | T2 | `snapback-sync` rotation/finalization tests: `crates/snapback-sync/src/auth/coordinator.rs:{2638,2786,2833,2844,2913,2941,2987,3044}`. | P: plan refresh/rotation through the provider. | High |
| 004 | `PasswordChangePreparation.revocations` | `crates/snapback-auth/src/auth/provider.rs:766` | T2 | `snapback-server` password-change race test inspects the public field: `crates/snapback-server/src/auth/provider_tests.rs:2921`. | P: create the race through real sign-in/password-change ceremonies and assert durable effects. | High |
| 005 | `ProviderFamilyAlarmPlan.actionable` | `crates/snapback-auth/src/auth/provider.rs:949` | T2 | `snapback-server` family-alarm tests: `crates/snapback-server/src/auth/provider_tests.rs:{2090,2120,2172}`. | P: assert the public plan outcome or durable revocation, not a mutable field. | High |
| 006 | `ProviderSessionIssuanceCommitPlan.projected` | `crates/snapback-auth/src/auth/provider.rs:1032` | T2 | `snapback-server` issuance collision test: `crates/snapback-server/src/auth/provider_tests.rs:2198`. | P: assert the issued response and durable projection. | High |
| 007 | `ProviderSessionIssuancePlan::for_test` | `crates/snapback-auth/src/auth/provider.rs:1222` | T2 | `snapback-sync` coordinator issuance test: `crates/snapback-sync/src/auth/coordinator.rs:2695`. | P: use signup/sign-in/guest issuance planning. | High |
| 008 | `AuthProvider.keyring` | `crates/snapback-auth/src/auth/provider.rs:1475` | T2 | `snapback-server` key-rotation test: `crates/snapback-server/src/auth/provider_tests.rs:997`. | P/H: run keyring maintenance or prepare a harness-owned keyring before provider construction. | High |
| 009 | `AuthProvider.random` | `crates/snapback-auth/src/auth/provider.rs:1480` | T2 | `snapback-server` key/session/guest fixtures: `crates/snapback-server/src/auth/provider_tests.rs:{998,3418,3609,3730}`. | P/H: use real ceremonies; deterministic entropy belongs in a non-shipping fixture owner. | High |
| 010 | `AuthProvider.password_security` | `crates/snapback-auth/src/auth/provider.rs:1502` | T2 | `snapback-server` lock-window and KDF-cap tests: `crates/snapback-server/src/auth/provider_tests.rs:{3109,3214}`. | P/H: configure the profile through admitted configuration or expose read-only harness facts. | High |
| 011 | `AddressAdmission::mint_session` | `crates/snapback-auth/src/auth/provider.rs:4758` | T2 | `snapback-server` provider tests: `crates/snapback-server/src/auth/provider_tests.rs:{872,1231,1908}`. | P: use the bound plan/commit/finalize issuance ceremony. | High |
| 012 | `ServiceAuthorityPublication::synthetic_for_test` | `crates/snapback-auth/src/auth/service_fence.rs:277` | T2 | `snapback-server` service-authority test: `crates/snapback-server/src/server/tests.rs:32058`. | P: validate a real service token and retain its publication. | High |
| 013 | `ServiceAuthorityFenceRegistry::synthetic_publication_for_test` | `crates/snapback-auth/src/auth/service_fence.rs:794` | T2 | `snapback-server` service tests: `crates/snapback-server/src/server/tests.rs:{30304,30532,31560,41547}`; `snapback-sync` stream-attempt test: `crates/snapback-sync/src/stream_attempt.rs:1667`; `snapback-engine` service test: `crates/snapback-engine/src/local/tests/engine.rs:26550`. | P/H: exercise registry validation with a real grant/token; use a controlled clock in the harness. | High |
| 014 | `ServiceAuthorityFenceRegistry::commit_terminal_for_test` | `crates/snapback-auth/src/auth/service_fence.rs:1141` | T2 | `snapback-server` terminal tests: `crates/snapback-server/src/server/tests.rs:{30392,30599,31585}`; `snapback-engine` terminal test: `crates/snapback-engine/src/local/tests/engine.rs:26608`. | P: acquire and commit a real terminal plan. | High |

### `snapback-engine` — 30 items

| # | Item | Declaration | Tier | Call sites found and purpose | Replacement | Confidence |
|---:|---|---|---|---|---|---|
| 015 | `admit_loopback_provider_for_test` | `crates/snapback-engine/src/ask.rs:43` | T2 | `snapback-server` loopback-provider policy test: `crates/snapback-server/src/server/tests.rs:4184`. | H: controlled loopback server/process; keep production URL policy intact. | High |
| 016 | `with_loopback_provider_for_test` | `crates/snapback-engine/src/ask.rs:55` | T2 | `snapback-server` loopback-provider policy test: `crates/snapback-server/src/server/tests.rs:4185`. | H: controlled loopback server/process. | High |
| 017 | `test_support` module edge | `crates/snapback-engine/src/lib.rs:91` | T2 | `snapback` integration tests: `crates/snapback/tests/instance_fork_security_v1.rs:{191,290}`, `crates/snapback/tests/graph_corpus_v1.rs:29`. `snapback-server` tests and adapter: `crates/snapback-server/src/server/tests.rs:{125,129,2234,2248,2755,2909,3259,3358,8531,8546,8865,9373,9388,13619,13774,13926,22952,22967,33814,33829,36985,37036,37063,37074,37088,37121,37651,37696,37787}`, `crates/snapback-server/src/remainder_adapter.rs:{54,63,71,78,90,108,120}`. | P/H/O: retain only A/B observation allowlists; move C children to ceremonies, harness scenarios, or owning tests. | High |
| 018 | `EphemeralApi::overflow_outbox_for_test` | `crates/snapback-engine/src/local/engine.rs:3095` | T2 | `snapback-server` realtime overflow tests: `crates/snapback-server/src/server/tests.rs:{22717,22756,22795,22833,22837,22886,23064,23136}`. | H: controlled slow transport/backpressure scenario. | High |
| 019 | `EphemeralApi::enqueue_ephemeral_for_test` | `crates/snapback-engine/src/local/engine.rs:3105` | T2 | `snapback-server` ephemeral coalescing test: `crates/snapback-server/src/server/tests.rs:{23440,23444}`. | H: controlled transport or harness-owned backend. | High |
| 020 | `ResolvedServiceAuthority::synthetic_for_test` | `crates/snapback-engine/src/local/engine.rs:3421` | T2 | `snapback-server` service-route test: `crates/snapback-server/src/server/tests.rs:32061`. | P: resolve through a real service grant/publication. | High |
| 021 | `LocalSnapback::make_sender_proof_replay_unavailable_for_test` | `crates/snapback-engine/src/local/engine.rs:5122` | T2 | `snapback-server` fail-closed sender-proof tests: `crates/snapback-server/src/server/tests.rs:{14221,14544,14805}`. | H: offline database/fault scenario. | High |
| 022 | `LocalSnapback::make_authentication_throttle_unavailable_for_test` | `crates/snapback-engine/src/local/engine.rs:5130` | T2 | `snapback-server` throttle-unavailable test: `crates/snapback-server/src/server/tests.rs:13111`. | H: controlled storage failure. | High |
| 023 | `LocalSnapback::service_authority_terminal_plan_for_test` | `crates/snapback-engine/src/local/engine.rs:6067` | T2 | `snapback-server` terminal-plan test: `crates/snapback-server/src/server/tests.rs:8277`. | P: acquire the terminal plan from the real service registry. | High |
| 024 | `LocalSnapback::persist_stream_attempts_for_test` | `crates/snapback-engine/src/local/engine.rs:7896` | T2 | `snapback-server` stream-attempt recovery test: `crates/snapback-server/src/server/tests.rs:31187`. | P/H: produce attempts through real streaming; use an offline fixture for impossible crash states. | High |
| 025 | `LocalSnapback::synchronize_auth_mode_admission` | `crates/snapback-engine/src/local/engine.rs:8577` | T2 | Cross-crate use in `snapback-server`: `crates/snapback-server/src/server/tests.rs:{2358,3769}`. Engine-owned helper/tests: `crates/snapback-engine/src/host_ops.rs:2628`, `crates/snapback-engine/src/local/engine.rs:12003`, `crates/snapback-engine/src/local/auth_room_kick_acceptance.rs:{147,1548}`, `crates/snapback-engine/src/local/admission_fence_tests.rs:{64,305,415,623}`, `crates/snapback-engine/src/local/tests/engine.rs:{1130,2373,2855,8289,16162,26369}`. | P: activation/ensure-app must derive and publish the settled state. | High |
| 026 | `LocalSnapback::declare_graph_query_v1_capability` | `crates/snapback-engine/src/local/engine.rs:11899` | T2 | `snapback` graph corpus: `crates/snapback/tests/graph_corpus_v1.rs:{1058,1267}`; engine unit tests: `crates/snapback-engine/src/local/tests/engine.rs:{1042,1090}`. | P: declare through the loaded manifest/capability registry. | High |
| 027 | `LocalSnapback::install_graph_serving_authority_context_for_test` | `crates/snapback-engine/src/local/engine.rs:11905` | T2 | `snapback` graph corpus: `crates/snapback/tests/graph_corpus_v1.rs:{1075,1294}`. | P: use the production resolver/service-authority ceremony. | High |
| 028 | `LocalSnapback::install_forged_function_for_test` | `crates/snapback-engine/src/local/engine.rs:12337` | T2 | `snapback` graph rejection test: `crates/snapback/tests/graph_corpus_v1.rs:2459`; engine unit test: `crates/snapback-engine/src/local/tests/engine.rs:888`. | H/O: submit a malformed production manifest when possible; otherwise keep the direct forge in engine unit tests. | High |
| 029 | `LocalSnapback::stage_cron_action_invocation` | `crates/snapback-engine/src/local/engine.rs:23605` | T2 | `snapback-server` cron/action tests: `crates/snapback-server/src/server/tests.rs:{3276,3379,27996,28904,29297,30183,31415,31501,31728}`. | P: schedule and claim through the production cron/action ceremony. | High |
| 030 | `LocalSnapback::publish_owner_visibility_exit_for_test` | `crates/snapback-engine/src/local/engine.rs:30144` | T4 | No call site found. The declaration is already `#[cfg(test)]`; its lower-level call is inside its own unused body. | Delete it and then remove the now-unused lower wrapper chain if nothing else needs it. | T4-UNCERTAIN |
| 031 | `live_invalidation_admission` | `crates/snapback-engine/src/test_support.rs:41` | T2 | `snapback-server` live invalidation tests: `crates/snapback-server/src/server/tests.rs:{2248,8546,9388,22967,33829}`. | P: open a live connection and retain the admission derived by the transport. | High |
| 032 | `auth_database_mut` | `crates/snapback-engine/src/test_support.rs:53` | T2 | `snapback` fork security: `crates/snapback/tests/instance_fork_security_v1.rs:290`; `snapback-server` test adapter: `crates/snapback-server/src/remainder_adapter.rs:{54,78,90,108,120}`. | P/H: production ceremonies for live state; offline harness ownership for physical fixtures. Never expose a raw live database. | High |
| 033 | `erase_protected_record` | `crates/snapback-engine/src/test_support.rs:57` | T2 | `snapback-server` test adapter: `crates/snapback-server/src/remainder_adapter.rs:63`. | P: call the admitted protected-erasure command. | High |
| 034 | `activate_agent_safe_operation_coverage` | `crates/snapback-engine/src/test_support.rs:64` | T2 | `snapback-server` test adapter: `crates/snapback-server/src/remainder_adapter.rs:71`. | P: invoke admitted operation-coverage activation. | High |
| 035 | `asset_host_op` | `crates/snapback-engine/src/test_support.rs:78` | T2 | `snapback-server` asset acceptance: `crates/snapback-server/src/server/tests.rs:{13619,13774,13926,37036,37063}`. | P: use the public asset transport/host operation with real authority. | High |
| 036 | `asset_set_attempt_expiry` | `crates/snapback-engine/src/test_support.rs:94` | T2 | `snapback-server` asset-expiry test: `crates/snapback-server/src/server/tests.rs:36985`. | H: controlled clock/offline fixture. | High |
| 037 | `asset_move_finalize_witness` | `crates/snapback-engine/src/test_support.rs:116` | T2 | `snapback-server` asset finalize-recovery tests: `crates/snapback-server/src/server/tests.rs:{37651,37696,37787}`. | H: crash-cut/offline fixture. | High |
| 038 | `prepare_subscribe_live_for_transport` | `crates/snapback-engine/src/test_support.rs:123` | T2 | `snapback-server` transport tests: `crates/snapback-server/src/server/tests.rs:{9373,33814}`. | P: drive the actual transport preparation path. | High |
| 039 | `subscribe_live_prepared_with_invalidation` | `crates/snapback-engine/src/test_support.rs:136` | T2 | `snapback-server` live tests: `crates/snapback-server/src/server/tests.rs:{8531,22952}`. | P: prepare authority and invalidation through the same live connection owner. | High |
| 040 | `subscribe_live_host_plan_with_invalidation` | `crates/snapback-engine/src/test_support.rs:149` | T2 | `snapback-server` live test: `crates/snapback-server/src/server/tests.rs:2234`; engine helper unit test: `crates/snapback-engine/src/test_support.rs:241`. | P: use the production host-plan live subscription. | High |
| 041 | `configure_graph_corpus_scheduler` | `crates/snapback-engine/src/test_support.rs:161` | T2 | `snapback` graph corpus: `crates/snapback/tests/graph_corpus_v1.rs:1083`. | P/H: configure through manifest deployment; harness orchestrates the corpus. | High |
| 042 | `subscribe_graph_corpus_case` | `crates/snapback-engine/src/test_support.rs:171` | T2 | `snapback` graph corpus: `crates/snapback/tests/graph_corpus_v1.rs:1100`. | P: use the ordinary live subscribe interface. | High |
| 043 | `invoke_graph_corpus_mutation` | `crates/snapback-engine/src/test_support.rs:183` | T2 | `snapback` graph corpus: `crates/snapback/tests/graph_corpus_v1.rs:1145`. | P: use the ordinary mutation interface. | High |
| 044 | `signed_asset_fixture` | `crates/snapback-engine/src/test_support.rs:262` | T2 | `snapback-server` signed-asset fixture: `crates/snapback-server/src/server/tests.rs:129`. | P/H: upload/sign through the asset ceremony; harness may supply deterministic bytes. | High |

### `snapback-kernel` — 121 items

| # | Item | Declaration | Tier | Call sites found and purpose | Replacement | Confidence |
|---:|---|---|---|---|---|---|
| 045 | `EffectSettlementAuthorityV1` | `crates/snapback-kernel/src/fork_promotion.rs:3115` | T4 | No construction or consumer call found. Only unused private-function type references remain at `crates/snapback-kernel/src/fork_promotion.rs:{3305,3324}`. | Delete the dead settlement helper block together. | T4-UNCERTAIN |
| 046 | `EffectSettlementOutcomeV1` | `crates/snapback-kernel/src/fork_promotion.rs:3127` | T4 | No construction or `finish_promoted_effect_settlement` call found. Non-call references: `crates/snapback-kernel/src/fork_promotion.rs:{3134,3387,3425}`. | Delete the dead settlement helper block together. | T4-UNCERTAIN |
| 047 | `schema_transition::publish_schema_transition_for_test` re-export | `crates/snapback-kernel/src/storage.rs:142` | T2 | Re-exported path is used by engine schema-transition tests: `crates/snapback-engine/src/local/tests/engine.rs:{14673,14734,14900,15083,16059,16107}`. | P/H: drive deployment/restart or use a crash-cut harness. | High |
| 048 | `ServingDatabase::make_sender_proof_replay_unavailable_for_test` | `crates/snapback-kernel/src/storage.rs:1962` | T2 | Engine wrapper: `crates/snapback-engine/src/local/engine.rs:5123`, consumed by server tests listed for item 021. | H: controlled protected-storage failure. | High |
| 049 | `ServingDatabase::make_authentication_throttle_unavailable_for_test` | `crates/snapback-kernel/src/storage.rs:1971` | T2 | Engine wrapper: `crates/snapback-engine/src/local/engine.rs:5131`, consumed by server item 022. | H: controlled storage failure. | High |
| 050 | `LocalDatabase::apply_owner_visibility_post_image_for_test` | `crates/snapback-kernel/src/storage.rs:4297` | T2 | Serving wrapper: `crates/snapback-kernel/src/storage.rs:23761`; engine test-only caller of that wrapper: `crates/snapback-engine/src/local/engine.rs:30195`. | P/O: perform a real authorized mutation, or keep matcher-level mutation inside kernel tests. | Medium; indirect wrapper chain |
| 051 | `LocalDatabase::install_operation_coverage_for_test` | `crates/snapback-kernel/src/storage.rs:4364` | T2 | Kernel unit tests: `crates/snapback-kernel/src/storage/tests.rs:{8795,9017,9102,9569,9812,10024,10509,10527,10541,10567,10692}`; Serving wrapper: `crates/snapback-kernel/src/storage.rs:23773`; server raw-database test: `crates/snapback-server/src/server/tests.rs:29287`. | P: admitted operation-coverage activation; O for writer-authorizer internals. | High |
| 052 | `LocalDatabase::remove_active_operation_coverage_manifest_for_test` | `crates/snapback-kernel/src/storage.rs:4416` | T2 | Serving wrapper: `crates/snapback-kernel/src/storage.rs:23777`; engine corruption test through that wrapper: `crates/snapback-engine/src/local/admission_fence_tests.rs:1038`. | H: offline corruption fixture. | High |
| 053 | `LocalDatabase::inject_vector_release_drift_for_test` | `crates/snapback-kernel/src/storage.rs:4705` | T2 | Serving wrapper: `crates/snapback-kernel/src/storage.rs:23806`; engine drift test: `crates/snapback-engine/src/local/tests/engine.rs:37854`. | H: offline drift fixture. | High |
| 054 | `ServingDatabase::apply_owner_visibility_post_image_for_test` | `crates/snapback-kernel/src/storage.rs:23754` | T2 | Engine’s currently unused `#[cfg(test)]` shim calls it: `crates/snapback-engine/src/local/engine.rs:30195`. | O/delete chain; no public harness primitive is needed. | Medium; caller itself is currently unused |
| 055 | `ServingDatabase::install_operation_coverage_for_test` | `crates/snapback-kernel/src/storage.rs:23768` | T4 | No call resolved to the Serving method. Same-name calls resolve to `LocalDatabase`. | Delete it. | T4-UNCERTAIN |
| 056 | `ServingDatabase::remove_active_operation_coverage_manifest_for_test` | `crates/snapback-kernel/src/storage.rs:23776` | T2 | Engine admission-fence test: `crates/snapback-engine/src/local/admission_fence_tests.rs:1038`. | H: offline corruption fixture. | High |
| 057 | `ServingDatabase::inject_vector_release_drift_for_test` | `crates/snapback-kernel/src/storage.rs:23801` | T2 | Engine vector drift test: `crates/snapback-engine/src/local/tests/engine.rs:37854`. | H: offline drift fixture. | High |
| 058 | `AssetAttemptsKernel::test_revoke_intent_generation` | `crates/snapback-kernel/src/storage/asset_attempts.rs:2504` | T2 | Engine asset-generation test: `crates/snapback-engine/src/local/tests/engine.rs:10503`. | H/O: bounded offline fixture or kernel unit test. | High |
| 059 | `AssetReadsKernel::set_attempt_expiry` | `crates/snapback-kernel/src/storage/asset_reads.rs:2042` | T2 | Engine wrapper/test calls: `crates/snapback-engine/src/local/engine.rs:13056`, `crates/snapback-engine/src/local/tests/engine.rs:{6536,6805}`. | H: controlled clock/expiry fixture. | High |
| 060 | `AssetReadsKernel::enqueue_work_with_params` | `crates/snapback-kernel/src/storage/asset_reads.rs:2091` | T2 | Engine asset-worker test: `crates/snapback-engine/src/local/tests/engine.rs:8223`. | H/O: named worker-state fixture. | High |
| 061 | `AssetReadsKernel::enqueue_work` | `crates/snapback-kernel/src/storage/asset_reads.rs:2105` | T2 | Engine asset-worker test: `crates/snapback-engine/src/local/tests/engine.rs:9726`. | P/H: enqueue through an asset request or harness scenario. | High |
| 062 | `AssetReadsKernel::mark_work_claimed` | `crates/snapback-kernel/src/storage/asset_reads.rs:2121` | T2 | Engine worker recovery test: `crates/snapback-engine/src/local/tests/engine.rs:9782`. | H/O: worker crash-state fixture. | High |
| 063 | `AssetReadsKernel::age_work_deadline` | `crates/snapback-kernel/src/storage/asset_reads.rs:2125` | T2 | Engine deadline test: `crates/snapback-engine/src/local/tests/engine.rs:9885`. | H: controlled clock/offline fixture. | High |
| 064 | `AssetReadsKernel::transition_deleted` | `crates/snapback-kernel/src/storage/asset_reads.rs:2130` | T2 | Engine asset deletion tests: `crates/snapback-engine/src/local/tests/engine.rs:{8439,12516}`. | P: delete through the asset ceremony. | High |
| 065 | `AssetReadsKernel::seed_condemned_identity` | `crates/snapback-kernel/src/storage/asset_reads.rs:2191` | T2 | Engine GC test: `crates/snapback-engine/src/local/tests/engine.rs:11117`. | H/O: offline GC fixture. | High |
| 066 | `AssetReadsKernel::plant_missing_row_witness` | `crates/snapback-kernel/src/storage/asset_reads.rs:2202` | T2 | Engine wrapper and test: `crates/snapback-engine/src/local/engine.rs:13077`, `crates/snapback-engine/src/local/tests/engine.rs:11180`. | H: crash/corruption fixture. | High |
| 067 | `AssetReadsKernel::insert_phantom` | `crates/snapback-kernel/src/storage/asset_reads.rs:2211` | T2 | Engine recovery test: `crates/snapback-engine/src/local/tests/engine.rs:11197`. | H: offline corruption fixture. | High |
| 068 | `AssetReadsKernel::insert_items_phantom` | `crates/snapback-kernel/src/storage/asset_reads.rs:2215` | T2 | Engine test wrapper: `crates/snapback-engine/src/local/engine.rs:13086`. | H/O: offline fixture or engine-owned test setup. | High |
| 069 | `AssetReadsKernel::delete_intent_artifacts` | `crates/snapback-kernel/src/storage/asset_reads.rs:2226` | T2 | Engine recovery test: `crates/snapback-engine/src/local/tests/engine.rs:11299`. | H: crash/corruption fixture. | High |
| 070 | `AssetReadsKernel::simulate_legacy_carrier` | `crates/snapback-kernel/src/storage/asset_reads.rs:2234` | T2 | Engine legacy-recovery test: `crates/snapback-engine/src/local/tests/engine.rs:11547`. | H: frozen/offline legacy fixture. | High |
| 071 | `AssetReadsKernel::insert_rendition` | `crates/snapback-kernel/src/storage/asset_reads.rs:2276` | T2 | Engine rendition race test: `crates/snapback-engine/src/local/tests/engine.rs:13513`. | P/H: produce a rendition through the asset pipeline or named harness state. | High |
| 072 | `AssetReadsKernel::switch_variant_pointer_now` | `crates/snapback-kernel/src/storage/asset_reads.rs:2283` | T2 | Engine rendition race test: `crates/snapback-engine/src/local/tests/engine.rs:13549`. | P/H: publish through the pipeline or harness-owned race scenario. | High |
| 073 | `LocalDatabase::insert_password_attempt_for_test` | `crates/snapback-kernel/src/storage/auth.rs:1587` | T2 | Kernel test and Serving wrapper: `crates/snapback-kernel/src/storage/auth.rs:{4279,5131}`; server tests: `crates/snapback-server/src/server/tests.rs:20061`, `crates/snapback-server/src/auth/backup_confined_tests.rs:92`; auth backup test: `crates/snapback-auth/src/auth/backup.rs:2035`. | P/H: repeated failed authentication or offline backup fixture. | High |
| 074 | `LocalDatabase::insert_large_backup_fixture_for_test` | `crates/snapback-kernel/src/storage/auth.rs:1622` | T2 | Serving wrapper: `crates/snapback-kernel/src/storage/auth.rs:5142`; server backup test: `crates/snapback-server/src/auth/backup_confined_tests.rs:94`. | H: offline backup corpus generator. | High |
| 075 | `install_frozen_v1_catalog_fixture` | `crates/snapback-kernel/src/storage/auth.rs:2628` | T2 | Kernel tests/wrapper: `crates/snapback-kernel/src/storage/auth.rs:{2655,3872,4428}`, `crates/snapback-kernel/src/storage/auth_mode.rs:3520`; server provider test: `crates/snapback-server/src/auth/provider_tests.rs:683`; auth backup test: `crates/snapback-auth/src/auth/backup.rs:1957`. | H: frozen database fixture owned by `snapback-harness`. | High |
| 076 | `ServingDatabase::install_frozen_v1_catalog_fixture` | `crates/snapback-kernel/src/storage/auth.rs:2654` | T4 | No caller found; its body calls item 075, but nothing calls this Serving wrapper. | Delete it. | T4-UNCERTAIN |
| 077 | `install_frozen_v2_catalog_fixture` | `crates/snapback-kernel/src/storage/auth.rs:2662` | T1 | Sole call is a kernel unit test: `crates/snapback-kernel/src/storage/auth.rs:3925`. | Mechanical `#[cfg(test)]`. | High |
| 078 | `install_frozen_v3_catalog_fixture` | `crates/snapback-kernel/src/storage/auth.rs:2690` | T2 | Kernel unit test: `crates/snapback-kernel/src/storage/auth.rs:3994`; auth backup test: `crates/snapback-auth/src/auth/backup.rs:1994`. | H: frozen database fixture. | High |
| 079 | `ServingDatabase::insert_password_attempt_for_test` | `crates/snapback-kernel/src/storage/auth.rs:5124` | T4 | No call resolved to this Serving method; all external same-name receivers are `LocalDatabase`. | Delete it. | T4-UNCERTAIN |
| 080 | `ServingDatabase::insert_large_backup_fixture_for_test` | `crates/snapback-kernel/src/storage/auth.rs:5141` | T4 | No caller found; server backup uses `LocalDatabase`. | Delete it. | T4-UNCERTAIN |
| 081 | `LocalDatabase::insert_logical_email_identity_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:3021` | T2 | `snapback-cli` auth test: `crates/snapback-cli/src/cli/tests.rs:2451`. | P/H: create the identity through auth provisioning or an offline CLI fixture. | High |
| 082 | `AuthCatalogKernel::insert_verification_code_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5183` | T2 | Server backup test: `crates/snapback-server/src/auth/backup_confined_tests.rs:47`; auth lifecycle/backup tests: `crates/snapback-auth/src/auth/lifecycle.rs:441`, `crates/snapback-auth/src/auth/backup.rs:1913`. | P/H: request a code through the mailbox ceremony; deterministic backup state may be offline. | High |
| 083 | `AuthCatalogKernel::set_verification_key_id_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5208` | T2 | Auth backup tests: `crates/snapback-auth/src/auth/backup.rs:{2901,2932}`. | H: offline backup mutation. | High |
| 084 | `AuthCatalogKernel::insert_restore_fixture_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5215` | T2 | Auth lifecycle restore test: `crates/snapback-auth/src/auth/lifecycle.rs:610`. | H: offline restore fixture. | High |
| 085 | `AuthCatalogKernel::insert_expired_challenges_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5251` | T2 | Server auth runtime test: `crates/snapback-server/src/auth/runtime.rs:758`. | P/H: issue challenges under a controlled clock. | High |
| 086 | `AuthCatalogKernel::insert_email_session_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5258` | T2 | Engine authorization tests/helpers: `crates/snapback-engine/src/local/authorization_acceptance.rs:445`, `crates/snapback-engine/src/local/engine.rs:11973`, `crates/snapback-engine/src/local/auth_room_kick_acceptance.rs:171`, `crates/snapback-engine/src/local/tests/engine.rs:{29024,31791}`; server auth runtime tests: `crates/snapback-server/src/auth/runtime.rs:{951,1322,1610}`. | P: sign up/sign in or mint through the bound issuance ceremony. | High |
| 087 | `AuthCatalogKernel::insert_email_session_and_push_token_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5286` | T2 | Server auth/push runtime test: `crates/snapback-server/src/auth/runtime.rs:1424`. | P: issue a session, then register a push token. | High |
| 088 | `AuthCatalogKernel::insert_restore_cli_fixture_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5305` | T2 | CLI restore test: `crates/snapback-cli/src/cli/tests.rs:2588`. | H: offline restore fixture. | High |
| 089 | `AuthCatalogKernel::delete_terminal_cause_witness_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5406` | T2 | Server provider recovery test: `crates/snapback-server/src/auth/provider_tests.rs:2006`. | H/O: crash/corruption fixture. | High |
| 090 | `AuthCatalogKernel::insert_session_tombstone_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5420` | T2 | Server provider tests: `crates/snapback-server/src/auth/provider_tests.rs:{2197,2223}`. | P: revoke/logout through the provider. | High |
| 091 | `AuthCatalogKernel::insert_human_user_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5459` | T2 | Server tests: `crates/snapback-server/src/server/tests.rs:{7576,21542}`; engine authorization tests: `crates/snapback-engine/src/local/tests/engine.rs:{16187,29503,29989,29993,29997}`, `crates/snapback-engine/src/local/admission_fence_tests.rs:302`. | P: create users through identity provisioning. | High |
| 092 | `AuthCatalogKernel::insert_email_identity_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5465` | T4 | No call site found. | Delete it. | T4-UNCERTAIN |
| 093 | `AuthCatalogKernel::insert_activation_live_grant_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5483` | T2 | Engine activation test: `crates/snapback-engine/src/local/tests/engine.rs:16204`. | P: create and activate the grant through the management ceremony. | High |
| 094 | `AuthCatalogKernel::tombstone_scope_basis_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5489` | T2 | Engine scope invalidation tests: `crates/snapback-engine/src/local/tests/engine.rs:{16319,16375}`. | P/H: revoke the basis through management; use offline corruption only for impossible states. | High |
| 095 | `AuthCatalogKernel::tombstone_allowed_query_scope_basis_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5500` | T2 | Server scope test: `crates/snapback-server/src/server/tests.rs:16779`. | P: revoke the grant/scope basis. | High |
| 096 | `AuthCatalogKernel::install_service_replay_authority_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5506` | T2 | Engine service-replay test: `crates/snapback-engine/src/local/tests/engine.rs:28545`. | P: provision a real service grant and token. | High |
| 097 | `AuthCatalogKernel::insert_finite_authority_grant_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5516` | T2 | Server test: `crates/snapback-server/src/server/tests.rs:7592`; engine grant-order tests: `crates/snapback-engine/src/local/tests/engine.rs:{30016,30020,30029}`. | P: management grant ceremony with controlled expiry. | High |
| 098 | `AuthCatalogKernel::set_grant_expiry_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5532` | T2 | Server expiry test: `crates/snapback-server/src/server/tests.rs:7655`. | P/H: grant update with controlled clock. | High |
| 099 | `AuthCatalogKernel::insert_sender_replay_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5551` | T2 | Server sender-replay test: `crates/snapback-server/src/server/tests.rs:14777`. | P: execute the same sender-bound request twice. | High |
| 100 | `AuthCatalogKernel::advance_sender_replay_epoch_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5561` | T2 | Server replay-epoch test: `crates/snapback-server/src/server/tests.rs:15155`. | P/H: real epoch rotation/restart under harness control. | High |
| 101 | `AuthCatalogKernel::insert_query_carrier_prerequisites_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5566` | T2 | Server query-carrier test: `crates/snapback-server/src/server/tests.rs:16442`. | P: provision user, credential, and grant through production ceremonies. | High |
| 102 | `AuthCatalogKernel::insert_query_carrier_grant_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5575` | T2 | Server query-carrier test: `crates/snapback-server/src/server/tests.rs:16459`. | P: management grant ceremony. | High |
| 103 | `AuthCatalogKernel::insert_live_carrier_prerequisites_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5581` | T2 | Server live-carrier test: `crates/snapback-server/src/server/tests.rs:16961`. | P: provision identity/session through auth. | High |
| 104 | `AuthCatalogKernel::insert_live_carrier_grant_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5590` | T2 | Server live-carrier test: `crates/snapback-server/src/server/tests.rs:16978`. | P: management grant ceremony. | High |
| 105 | `AuthCatalogKernel::set_agent_credential_rotated_at_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5596` | T2 | Server route/credential tests: `crates/snapback-server/src/server/tests.rs:{17048,21857}`. | P/H: rotate the credential through management under a controlled clock. | High |
| 106 | `AuthCatalogKernel::insert_agent_token_route_fixtures_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5630` | T2 | Server agent-route test: `crates/snapback-server/src/server/tests.rs:21559`. | P: provision the agent, grant, and token. | High |
| 107 | `AuthCatalogKernel::insert_bulk_route_grants_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5639` | T2 | Server bulk-route test: `crates/snapback-server/src/server/tests.rs:21925`. | P: management grant API, possibly looped by the harness. | High |
| 108 | `AuthCatalogKernel::insert_step_up_scope_bases_for_test` | `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5649` | T2 | Server step-up test: `crates/snapback-server/src/server/tests.rs:22046`. | P: provision scopes and exercise step-up through production auth. | High |
| 109 | `LocalDatabase::identity_password_register` | `crates/snapback-kernel/src/storage/auth_identity.rs:3026` | T2 | Kernel helper/tests: `crates/snapback-kernel/src/storage/auth_logical_transfer.rs:810`, `crates/snapback-kernel/src/storage/auth_identity.rs:{4019,4241,4342,4397,4476,4486,4612,4646,4778}`, `crates/snapback-kernel/src/storage/auth.rs:4005`; auth backup test: `crates/snapback-auth/src/auth/backup.rs:2838`; server backup test: `crates/snapback-server/src/auth/backup_confined_tests.rs:80`. | P: password registration/signup ceremony; H for frozen backup creation. | High |
| 110 | `LocalDatabase::install_imported_password_hash_for_test` | `crates/snapback-kernel/src/storage/auth_identity.rs:3340` | T2 | Serving wrapper: `crates/snapback-kernel/src/storage/auth_identity.rs:4790`; server password-upgrade tests: `crates/snapback-server/src/auth/provider_tests.rs:{3255,3332,3368}`. | P/H: supported credential import/migration or offline legacy fixture. | High |
| 111 | `LocalDatabase::disable_identity_for_test` | `crates/snapback-kernel/src/storage/auth_identity.rs:3411` | T2 | Server disabled-identity test: `crates/snapback-server/src/server/tests.rs:18844`. | P: administrative identity-disable ceremony. | High |
| 112 | `LocalDatabase::insert_other_identity_session_for_test` | `crates/snapback-kernel/src/storage/auth_identity.rs:3434` | T2 | Serving wrapper: `crates/snapback-kernel/src/storage/auth_identity.rs:4801`; server provider test: `crates/snapback-server/src/auth/provider_tests.rs:3414`. | P: create the second identity/session through auth. | High |
| 113 | `LocalDatabase::insert_typed_guest_session_for_test` | `crates/snapback-kernel/src/storage/auth_identity.rs:3482` | T2 | Serving wrapper: `crates/snapback-kernel/src/storage/auth_identity.rs:4811`; server guest test: `crates/snapback-server/src/auth/provider_tests.rs:3609`. | P: guest-session creation ceremony. | High |
| 114 | `ServingDatabase::identity_password_register` | `crates/snapback-kernel/src/storage/auth_identity.rs:4768` | T4 | No call resolved to this Serving method; all callers use `LocalDatabase`. | Delete it. | T4-UNCERTAIN |
| 115 | `ServingDatabase::install_imported_password_hash_for_test` | `crates/snapback-kernel/src/storage/auth_identity.rs:4783` | T4 | No call resolved to this Serving method. | Delete it. | T4-UNCERTAIN |
| 116 | `ServingDatabase::insert_other_identity_session_for_test` | `crates/snapback-kernel/src/storage/auth_identity.rs:4793` | T4 | No call resolved to this Serving method. | Delete it. | T4-UNCERTAIN |
| 117 | `ServingDatabase::insert_typed_guest_session_for_test` | `crates/snapback-kernel/src/storage/auth_identity.rs:4804` | T4 | No call resolved to this Serving method. | Delete it. | T4-UNCERTAIN |
| 118 | `LocalDatabase::seed_invalidation_retry_episodes_for_test` | `crates/snapback-kernel/src/storage/auth_invalidation.rs:749` | T2 | Kernel unit tests: `crates/snapback-kernel/src/storage/auth_invalidation.rs:{1379,1459,1529,1604,1675}`; Serving wrapper: `crates/snapback-kernel/src/storage/auth_invalidation.rs:1797`, ultimately used by item 119. | H/O: controlled retry/failure sequence or kernel-owned fixture. | High |
| 119 | `ServingDatabase::seed_invalidation_retry_episodes_for_test` | `crates/snapback-kernel/src/storage/auth_invalidation.rs:1791` | T2 | Engine invalidation recovery test: `crates/snapback-engine/src/local/tests/engine.rs:32164`. | H: controlled retry/failure scenario. | High |
| 120 | `LocalDatabase::stage_auth_mode` | `crates/snapback-kernel/src/storage/auth_mode.rs:493` | T2 | Kernel tests/wrapper: `crates/snapback-kernel/src/storage/authorized_lease.rs:449`, `crates/snapback-kernel/src/storage/auth_mode.rs:{2479,2499,2587,2645,2662,3061,3116,3270,3523,3553,3692,3782}`; engine tests/helpers: `crates/snapback-engine/src/local/auth_room_kick_acceptance.rs:{138,1527}`, `crates/snapback-engine/src/local/tests/engine.rs:31780`, `crates/snapback-engine/src/local/admission_fence_tests.rs:291`, `crates/snapback-engine/src/host_ops.rs:2619`; server test: `crates/snapback-server/src/server/tests.rs:2350`. | P: deploy/ensure-app activation ceremony. | High |
| 121 | `LocalDatabase::stage_auth_mode_classified` | `crates/snapback-kernel/src/storage/auth_mode.rs:528` | T1 | Kernel unit tests only: `crates/snapback-kernel/src/storage/auth_mode.rs:{2680,2708}`. | Mechanical `#[cfg(test)]`. | High |
| 122 | `LocalDatabase::consume_sessions_auth_mode` | `crates/snapback-kernel/src/storage/auth_mode.rs:841` | T2 | Kernel tests/wrapper: `crates/snapback-kernel/src/storage/authorized_lease.rs:450`, `crates/snapback-kernel/src/storage/auth_mode.rs:{3065,3083,3118,3272,3525,3789}`; engine tests/helpers: `crates/snapback-engine/src/local/auth_room_kick_acceptance.rs:{142,1543}`, `crates/snapback-engine/src/local/tests/engine.rs:31782`, `crates/snapback-engine/src/local/admission_fence_tests.rs:295`, `crates/snapback-engine/src/host_ops.rs:2625`; server tests: `crates/snapback-server/src/server/tests.rs:{2355,3766}`. | P: activation consumes readiness and publishes the settled mode. | High |
| 123 | `LocalDatabase::consume_dev_downgrade` | `crates/snapback-kernel/src/storage/auth_mode.rs:976` | T1 | Kernel unit tests only: `crates/snapback-kernel/src/storage/auth_mode.rs:{3372,3556}`. | Mechanical `#[cfg(test)]`. | High |
| 124 | `LocalDatabase::apply_same_mode_schema` | `crates/snapback-kernel/src/storage/auth_mode.rs:1103` | T1 | Kernel unit tests only: `crates/snapback-kernel/src/storage/auth_mode.rs:{3135,3622}`. | Mechanical `#[cfg(test)]`. | High |
| 125 | `LocalDatabase::apply_same_mode_deployment` | `crates/snapback-kernel/src/storage/auth_mode.rs:1115` | T1 | Kernel test/helper chain only: `crates/snapback-kernel/src/storage/auth_mode.rs:{1108,2510,2598}`, `crates/snapback-kernel/src/storage/authorized_lease.rs:713`. | Mechanical gate conversion together with its same-crate helper callers. | High |
| 126 | `LocalDatabase::apply_same_mode_network_deployment` | `crates/snapback-kernel/src/storage/auth_mode.rs:1300` | T1 | Kernel unit tests only: `crates/snapback-kernel/src/storage/auth_mode.rs:{2730,2753,2776,2799,2827,2836,2887,2923}`. | Mechanical `#[cfg(test)]`. | High |
| 127 | `LocalDatabase::apply_same_mode_network_deployment_classified` | `crates/snapback-kernel/src/storage/auth_mode.rs:1319` | T1 | Kernel helper/unit tests only: `crates/snapback-kernel/src/storage/auth_mode.rs:{1307,2520,2608,2980,3003,3016,3039}`. | Mechanical gate conversion with its same-crate helper caller. | High |
| 128 | `ServingDatabase::stage_auth_mode` | `crates/snapback-kernel/src/storage/auth_mode.rs:3775` | T4 | No call resolved to this Serving method; cross-crate tests use `LocalSnapback::auth_database_mut()` and therefore `LocalDatabase`. | Delete it. | T4-UNCERTAIN |
| 129 | `ServingDatabase::consume_sessions_auth_mode` | `crates/snapback-kernel/src/storage/auth_mode.rs:3785` | T4 | No call resolved to this Serving method. | Delete it. | T4-UNCERTAIN |
| 130 | `install_auth_collision_fixtures_for_test` | `crates/snapback-kernel/src/storage/auth_rescue.rs:1073` | T2 | Server recovery/runtime tests: `crates/snapback-server/src/server/tests.rs:24522`, `crates/snapback-server/src/auth/recovery.rs:{586,945,1103,1127}`, `crates/snapback-server/src/auth/runtime.rs:891`. | H: offline collision corpus. | High |
| 131 | `LocalDatabase::install_graph_corpus_streams_for_test` | `crates/snapback-kernel/src/storage/auth_stream.rs:27` | T2 | Engine graph-corpus setup: `crates/snapback-engine/src/local/engine.rs:11985`. | P: activation should install the authorization/data streams. | High |
| 132 | `CheckpointsKernel::create_named_checkpoint_at_cut_for_test` | `crates/snapback-kernel/src/storage/checkpoints.rs:157` | T1 | Kernel checkpoint unit tests only: `crates/snapback-kernel/src/proof_checkpoint.rs:{5129,5268,5368,5418,5498,5561,5621}`. | Mechanical `#[cfg(test)]`. | High |
| 133 | `MembershipReadsKernel::insert_channel_member` | `crates/snapback-kernel/src/storage/membership_reads.rs:220` | T2 | Engine membership test: `crates/snapback-engine/src/local/tests/engine.rs:9331`. | P: perform an authorized membership mutation. | High |
| 134 | `MembershipReadsKernel::delete_channel_member_seat_a2` | `crates/snapback-kernel/src/storage/membership_reads.rs:231` | T2 | Engine membership test: `crates/snapback-engine/src/local/tests/engine.rs:9417`. | P: perform an authorized membership deletion. | High |
| 135 | `LocalDatabase::install_migration_fence_for_test` | `crates/snapback-kernel/src/storage/migration_executor.rs:5388` | T2 | Serving wrapper: `crates/snapback-kernel/src/storage/migration_executor.rs:8745`; engine reopen test through that wrapper: `crates/snapback-engine/src/local/tests/engine.rs:37388`. | H: migration crash-cut fixture. | High |
| 136 | `ServingDatabase::install_migration_fence_for_test` | `crates/snapback-kernel/src/storage/migration_executor.rs:8744` | T2 | Engine migration reopen test: `crates/snapback-engine/src/local/tests/engine.rs:37388`. | H: migration crash-cut fixture. | High |
| 137 | `LocalDatabase::activate_push_registry_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:22` | T2 | Kernel wrappers/tests: `crates/snapback-kernel/src/storage/push_registry.rs:{1069,1552}`, `crates/snapback-kernel/src/storage/auth.rs:4105`; `snapback` fork test: `crates/snapback/tests/instance_fork_security_v1.rs:293`; server direct callers: `crates/snapback-server/src/server/tests.rs:{20433,29005,29103,36205}`, `crates/snapback-server/src/auth/runtime.rs:1403`. | P: activate through deployed push manifest. | High |
| 138 | `PushRegistryKernel::activate_push_registry_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1065` | T2 | Engine push tests: `crates/snapback-engine/src/push/authority_tests.rs:{265,357}`; services push tests: `crates/snapback-services/src/push.rs:{309,509,526,536,561,591,749}`. | P: deploy a push declaration. | High |
| 139 | `PushRegistryKernel::install_immediate_sender_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1280` | T2 | Server immediate-push tests: `crates/snapback-server/src/server/tests.rs:{29151,36252}`. | P: provision session, membership, schema, and sender through normal ceremonies. | High |
| 140 | `PushRegistryKernel::insert_session_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1301` | T2 | Engine admission tests: `crates/snapback-engine/src/local/admission_fence_tests.rs:{636,1658}`; services push test: `crates/snapback-services/src/push.rs:348`. | P: authenticate a real session. | High |
| 141 | `PushRegistryKernel::seed_ledger_projection_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1319` | T2 | Engine push-authority test: `crates/snapback-engine/src/push/authority_tests.rs:277`. | P/H: send through push production APIs; use an offline fixture for impossible ledger states. | High |
| 142 | `PushRegistryKernel::seed_acceptance_audience_and_tokens_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1338` | T2 | Engine push acceptance: `crates/snapback-engine/src/push/authority_tests.rs:366`. | P: provision membership and push registrations. | High |
| 143 | `PushRegistryKernel::seed_drop_audience_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1361` | T2 | Engine drop-audience test: `crates/snapback-engine/src/push/authority_tests.rs:557`. | P: change membership/audience through production mutation. | High |
| 144 | `PushRegistryKernel::tamper_ledger_index_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1387` | T2 | Services schema-integrity test: `crates/snapback-services/src/push.rs:544`. | H: offline physical corruption fixture. | High |
| 145 | `PushRegistryKernel::seed_mixed_batch_aggregate_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1392` | T2 | Services push recovery test: `crates/snapback-services/src/push.rs:571`. | P/H: controlled provider outcomes or offline recovery state. | High |
| 146 | `PushRegistryKernel::seed_reserved_recovery_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1414` | T2 | Services push recovery test: `crates/snapback-services/src/push.rs:600`. | H: crash-cut/provider harness. | High |
| 147 | `PushRegistryKernel::rotate_token_and_recover_reserved_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1433` | T2 | Services push recovery test: `crates/snapback-services/src/push.rs:626`. | P/H: rotate through registration, then run controlled recovery. | High |
| 148 | `PushRegistryKernel::assert_transmitting_recovery_ambiguous_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1442` | T2 | Services push recovery test: `crates/snapback-services/src/push.rs:650`. | H: controlled ambiguous provider outcome. | High |
| 149 | `PushRegistryKernel::seed_retired_recovery_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1451` | T2 | Services push retirement test: `crates/snapback-services/src/push.rs:663`. | H: crash-cut/provider fixture. | High |
| 150 | `PushRegistryKernel::settle_mixed_retired_recovery_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1476` | T2 | Services push retirement test: `crates/snapback-services/src/push.rs:683`. | P/H: controlled provider settlement. | High |
| 151 | `PushRegistryKernel::create_lookalike_registry_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1485` | T2 | Services schema-integrity test: `crates/snapback-services/src/push.rs:699`. | H: offline physical fixture. | High |
| 152 | `PushRegistryKernel::activate_manifest_with_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1493` | T2 | Services manifest test: `crates/snapback-services/src/push.rs:704`. | P: activate a real deployment manifest. | High |
| 153 | `PushRegistryKernel::tamper_registry_index_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1500` | T2 | Services schema-integrity test: `crates/snapback-services/src/push.rs:715`. | H: offline physical corruption. | High |
| 154 | `PushRegistryKernel::tamper_lifecycle_trigger_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1504` | T2 | Services schema-integrity test: `crates/snapback-services/src/push.rs:729`. | H: offline physical corruption. | High |
| 155 | `PushRegistryKernel::provider_retirement_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1508` | T2 | Services provider-retirement test: `crates/snapback-services/src/push.rs:753`. | P: production provider/token retirement. | High |
| 156 | `PushRegistryKernel::logout_session_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1519` | T2 | Services logout test: `crates/snapback-services/src/push.rs:910`. | P: production logout. | High |
| 157 | `PushRegistryKernel::durable_revoke_session_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1523` | T2 | Services revocation test: `crates/snapback-services/src/push.rs:945`. | P: production session revocation. | High |
| 158 | `PushRegistryKernel::assert_idle_retention_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1537` | T2 | Services retention test: `crates/snapback-services/src/push.rs:1031`. | P/H: declared retention plus controlled clock. | High |
| 159 | `ServingDatabase::activate_push_registry_for_test` | `crates/snapback-kernel/src/storage/push_registry.rs:1548` | T4 | No call resolved to this Serving method; external callers use `LocalDatabase` or `PushRegistryKernel`. | Delete it. | T4-UNCERTAIN |
| 160 | `publish_schema_transition_for_test` | `crates/snapback-kernel/src/storage/schema_transition.rs:250` | T2 | Engine schema-transition tests: `crates/snapback-engine/src/local/tests/engine.rs:{14673,14734,14900,15083,16059,16107}`. | P/H: deployment/restart ceremony or crash-cut harness. | High |
| 161 | `SettlementKernel::upsert_stream_attempts_for_test` | `crates/snapback-kernel/src/storage/settlement.rs:916` | T2 | Engine wrapper: `crates/snapback-engine/src/local/engine.rs:7902`, consumed by server item 024. | P/H: real stream attempts or offline crash fixture. | High |
| 162 | `LocalDatabase::activate_stream_transcript_manifest` | `crates/snapback-kernel/src/storage/stream_transcripts.rs:171` | T1 | Kernel unit tests only: `crates/snapback-kernel/src/storage/stream_transcripts.rs:{349,353,404,412}`. | Mechanical `#[cfg(test)]`. | High |
| 163 | `LocalDatabase::install_real_storage_version_for_test` | `crates/snapback-kernel/src/storage/versions.rs:20` | T2 | Engine host-op test fixture: `crates/snapback-engine/src/host_ops.rs:2509`. | H: offline versioned-database fixture. | High |
| 164 | `LocalDatabase::install_zero_storage_version_for_test` | `crates/snapback-kernel/src/storage/versions.rs:34` | T2 | Engine corrupt-version test: `crates/snapback-engine/src/local/tests/engine.rs:33335`. | H: offline corrupt-version fixture. | High |
| 165 | `LocalDatabase::seed_renewable_watch_for_management_test` | `crates/snapback-kernel/src/storage/watches.rs:1021` | T2 | Server watch-management test: `crates/snapback-server/src/server/tests.rs:40615`. | P: create and renew a watch through management APIs. | High |

### `snapback-services` — 2 items

| # | Item | Declaration | Tier | Call sites found and purpose | Replacement | Confidence |
|---:|---|---|---|---|---|---|
| 166 | `AssetWidthPrepareTicketV1::replace_store_for_test` | `crates/snapback-services/src/assets.rs:831` | T2 | Engine width race/fault tests: `crates/snapback-engine/src/local/tests/engine.rs:{12889,13009,13107,13277}`. | H: non-shipping controlled `AssetStore` implementation, or re-home the lowest-level race tests. | High; receiver types inspected |
| 167 | `FinalizePrepareTicketV1::replace_store_for_test` | `crates/snapback-services/src/assets.rs:1399` | T2 | Engine finalize race tests: `crates/snapback-engine/src/local/tests/engine.rs:{5717,5718,10634,10635}`. | H: non-shipping controlled `AssetStore` implementation. | High; receiver types inspected |

### `snapback-sync` — 5 items

| # | Item | Declaration | Tier | Call sites found and purpose | Replacement | Confidence |
|---:|---|---|---|---|---|---|
| 168 | `AuthCoordinator::new` | `crates/snapback-sync/src/auth/coordinator.rs:573` | T2 | Server coordinator/runtime tests: `crates/snapback-server/src/server/tests.rs:18994`, `crates/snapback-server/src/auth/provider_tests.rs:{486,3481,3619}`, `crates/snapback-server/src/auth/runtime.rs:{1226,1348,1455,1501}`; sync unit fixture: `crates/snapback-sync/src/auth/coordinator.rs:2303`. | P: server startup/rebuild should create and bind the coordinator from its owned database. | High |
| 169 | `InvocationGate::prepare_authority` | `crates/snapback-sync/src/auth/invocation.rs:2689` | T2 | Server test: `crates/snapback-server/src/server/tests.rs:24159`. Sync tests/helpers: `crates/snapback-sync/src/stream_attempt.rs:{1514,1624}`, `crates/snapback-sync/src/ephemeral.rs:8810`, `crates/snapback-sync/src/auth/invocation.rs:{3395,3473,3549,3605,3773,3815,3856,3912,3967,4105,4187,4232,4242,4411,4449,4478,4499,4606}`, `crates/snapback-sync/src/auth/coordinator.rs:3438`. Engine tests/helpers: `crates/snapback-engine/src/push/authority_tests.rs:{222,245}`, `crates/snapback-engine/src/local/authorization_acceptance.rs:548`, `crates/snapback-engine/src/local/engine.rs:{12057,20747}`, `crates/snapback-engine/src/local/auth_room_kick_acceptance.rs:2205`, `crates/snapback-engine/src/local/tests/engine.rs:{2020,2315,2390,2866,9506,25687,28508,28579,29363,29382,29409,29431,30424,31808}`, `crates/snapback-engine/src/runtime/host_glue.rs:9006`. | P/O: enter through managed admission and real resolution; keep raw-authority negative tests in `snapback-sync`. | High |
| 170 | `InvocationGate::prepare_dev_input` | `crates/snapback-sync/src/auth/invocation.rs:2879` | T2 | Engine tests/helpers: `crates/snapback-engine/src/local/tests/engine.rs:{14840,23088,26638,26719,27402,27461,27563,28070,32595,33339}`, `crates/snapback-engine/src/test_support.rs:360`, `crates/snapback-engine/src/runtime/host_glue.rs:{9047,9090,9115}`. | P/O: send a development-mode request through the real gate; retain raw parsing tests in sync. | High |
| 171 | `LocalEphemeralBackend::overflow_outbox_for_test` | `crates/snapback-sync/src/ephemeral.rs:6334` | T2 | Sync unit tests: `crates/snapback-sync/src/ephemeral.rs:{13533,13571,13609,13629,13637}`; engine wrapper: `crates/snapback-engine/src/local/engine.rs:3101`, consumed by server item 018. | H/O: slow-transport harness for integration; queue internals in sync unit tests. | High |
| 172 | `LocalEphemeralBackend::enqueue_ephemeral_for_test` | `crates/snapback-sync/src/ephemeral.rs:6360` | T2 | Engine wrapper: `crates/snapback-engine/src/local/engine.rs:3112`, consumed by server item 019. | H/O: controlled transport/backend or sync unit test. | High |

## 4. Headline answer

Plainly:

- **9 of 172** close with a mechanical `#[cfg(test)]` conversion and no cross-crate coverage loss.
- **148 of 172** need a cross-crate coverage or harness decision.
- **0 of 172** have an established genuine external/embedder need requiring LLP 0303 API design.
- **15 of 172** have no live caller and are deletion candidates, reported as T4-UNCERTAIN as requested.

Therefore this is **not a 172-item derive-or-seal design program**. It is principally a build-boundary and test-architecture program:

- 9 owning-crate test helpers can be demoted directly.
- 15 dead items can be deleted.
- The remaining 148 exist for workspace tests, not embedders. They should be removed from shipping library surfaces while preserving their tests through production ceremonies, a non-shipping harness, or relocation into the defining crate.

The absence of T3 is intentional, not conservative padding. No guide, example, manifest, production caller, or LLP requirement establishes an external need for any class-C item. Treating one as T3 merely because a dependent *can* call it would repeat the failure this tiering was meant to prevent.

## 5. Can one shared non-shipping harness serve the T2 set?

**One shared harness can be the common orchestration boundary, but it should not become one shared privileged Rust API.**

The existing unpublished `snapback-harness` crate is the natural owner. It already has ordinary dev-dependencies and a direct `rusqlite` dev-dependency without enabling `test-support`. It can cover most T2 needs through four scenario families:

1. **Production ceremonies**

   - Auth mode activation and restart.
   - Email/password/guest signup, sign-in, refresh, logout, revocation, password change, credential rotation.
   - Agent/service grant and token provisioning.
   - Query, mutation, live subscription, invalidation, cron, asset, push, stream, membership, watch, checkpoint, and migration operations.

2. **Offline database fixtures**

   - Frozen catalog versions.
   - Backup/restore and collision corpora.
   - Missing rows, tombstones, malformed indices/triggers, version markers, migration fences, vector drift, and crash-cut evidence.
   - These should be created before the production owner opens the database, using the harness’s non-shipping direct database dependency.

3. **Controlled external components**

   - Loopback providers.
   - Slow or blocked transports.
   - Scripted asset stores.
   - Push providers returning success, rejection, timeout, or ambiguity.
   - Controlled clocks and deterministic entropy owned by the harness process, not mutable fields on live library owners.

4. **Read-only typed probes**

   - Durable row projections.
   - Operation-coverage facts.
   - Retry/attempt state.
   - Asset, push, and stream observations.
   - Probes must expose bounded observations, not raw handles or caller-authored authority.

Some low-level tests should move inward instead of crossing the harness boundary: queue mutation, store replacement, exact transaction cut points, and kernel physical-schema tampering are often clearer as defining-crate unit tests under `#[cfg(test)]`. The shared harness can still invoke those crate test targets as part of one suite; it does not need to make their internals callable by dependencies.

The harness must specifically **not** expose:

- `&mut LocalDatabase` or `ServingDatabase`;
- arbitrary `PreparedAuthority`, projection, admission, grant, or session constructors;
- raw commit/finalization attempts;
- caller-selected service publications or terminal plans;
- generic “insert row,” “replace backend,” or “set trusted state” operations against a live production owner.

So the coherent closure is one architectural policy—shipping crates expose no class-C test privilege—implemented by a mixture of mechanical demotion, dead-code deletion, production ceremony migration, and one non-shipping orchestration harness.
---

## Reconciliation with the pre-registered estimate

`issues/20260824-test-support-bypass-surface-inventory.md` carries an addendum written by the
supervising session **before** this analysis was read, deliberately, so the two would not anchor.
The populations differ — that addendum counted all 232 `pub fn *_for_test` symbols, this counts the
172 class-C items — so the figures are not directly comparable. The shapes are.

| Question | Pre-registered estimate | This analysis |
|---|---|---|
| Closes with a mechanical `cfg(test)` change | ~16 | **9** |
| Cross-crate test use | 126 | **148** |
| Genuine external/embedder API | **≤79 (stated as an upper bound, not a count)** | **0** |

The two agree on the conclusion that matters: **the mechanical fix is small and the dominant tier is
cross-crate test use.** Both therefore point away from an item-by-item sweep and toward a test
architecture change.

The estimate's `≤79` was explicitly an upper bound, because a file-level classifier cannot separate a
reference inside an inline `#[cfg(test)] mod tests` from a production call in the same file. This
line-level analysis resolves that bound to zero. Where the two disagree, this document is the more
accurate one, as the addendum itself said it should be treated.

That zero is the load-bearing result. It converts the problem from "172 public APIs need LLP 0303
derive-or-seal design" into "172 items exist for workspace tests and should not be on a shipping
library surface at all" — a build-boundary problem with an existing owner in the unpublished
`snapback-harness` crate.
