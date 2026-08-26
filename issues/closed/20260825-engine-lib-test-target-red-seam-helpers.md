# snapback-engine lib-test target red: missing seam test helpers (inherited)

**Status:** Closed
**Opened:** 2026-08-25
**Closed:** 2026-08-26
**Systems:** Engine, Auth, Services

## Problem

`cargo test -p snapback-engine --lib --no-run` fails with 14 errors on
current main: `store_for_test`/`replace_store_for_test` missing on
`snapback_services::assets::AssetWidthPrepareTicketV1` and
`FinalizePrepareTicketV1` (13 sites), and `AdmissionLease::unmanaged`
missing (1 site). These reference test helpers narrowed/removed by the
2026-08-25 security wave (asset finalize-ticket owner binding, registration
lease graph binding, auth/service seam narrowing) without migrating every
engine-side test caller. Verified independent of unrelated worktree changes
(the errors' files are untouched by the verifying branch).

## Impact

The engine lib-test target cannot compile, so any new engine test rides a
red target until this clears — including the removed-member epoch-gate
delivery test added by the live-cutoff work, which compiles clean but
cannot execute.

## Wanted

Migrate the engine test callers to the narrowed seam APIs (or provide the
sanctioned test-support constructors), restoring the lib-test target;
then run the epoch-gate delivery test and record its first real result on
`issues/closed/20260825-familiar-removed-member-live-cutoff-leak.md`.

## Resolution — 2026-08-26

The 13 asset-ticket call sites now arrange their fault scripts before ticket
construction. Each affected test creates a harness-owned
`ControlledAssetStore`, injects it through
`LocalSnapback::memory_with_controlled_asset_store`, and then obtains genuine
owner-bound finalize tickets or engine-produced width tickets whose immutable
store selection was made before the test arms its fault. The tests arm bounded
one-shot copy, PUT, hash, read-substitution, and hash-corruption operations on
that selected store. No ticket store accessor or store replacement seam was
restored. This is not an F272 closure claim: `AssetWidthPrepareTicketV1` still
has no owner identity and retains a public constructor, so LLP 0312's width-plan
origin binding remains explicitly open.

The push system-authority fixture now derives through the target
`LocalSnapback`'s narrow unit-only
`LocalSnapback::prepare_cron_system_authority_for_test` factory and is consumed
by that same target. It accepts no lease, epoch, stream, or subject inputs: the
engine admits a managed lease from its real controller, derives `System`
internally, and installs that engine's authorization-stream binding. The push
reservation sink also rechecks target-engine admission ownership and exact
consuming-database stream ownership; a focused second-engine negative proves
refusal.
`AdmissionLease::unmanaged` was not restored or widened.

`cargo test -p snapback-engine --lib --no-run` now succeeds. After the
cross-engine refusal coverage was added, the full lib suite executes all 608
tests:

```text
test result: FAILED. 586 passed; 22 failed; 0 ignored; 0 measured; 0 filtered out; finished in 25.90s
```

The original first run reported `584 passed; 23 failed`, but its per-test
output was not retained. A second original-tree run reported 22, and an
original-tree replay plus repeated amended-tree replays all reproduced these
same 22 actual `... FAILED` lines; no honest twenty-third name could be
recovered:

```text
test local::engine::tests::engine::aggregate_projection_handoff_is_a_bounded_prefix_and_suffix_stays_pending ... FAILED
test local::engine::tests::engine::auth_requery_error_uses_one_durable_three_attempt_episode ... FAILED
test local::engine::tests::engine::auth_scoped_removal_is_atomic_obligation_and_exact_ack ... FAILED
test local::engine::tests::engine::authorization_expectation_advances_without_live_subscribers ... FAILED
test local::engine::authorization_acceptance::permission_fields_churn_and_randomized_oracle_emit_the_committed_receipt ... FAILED
test local::engine::tests::engine::c009_foreign_reservation_history_is_rejected_by_live_subscribe ... FAILED
test local::engine::tests::engine::f286_victim_connection_is_touched_and_foreign_obligation_is_discharged ... FAILED
test local::engine::tests::engine::grant_approval_derives_exact_user_and_session_from_management_authority ... FAILED
test local::engine::tests::engine::grant_denial_derives_subject_and_preserves_every_other_durable_request ... FAILED
test local::engine::tests::engine::graph_scheduler_case_authority_transition_fences_before_delivery ... FAILED
test local::engine::tests::engine::graph_scheduler_case_mixed_commit_has_one_fenced_delivery ... FAILED
test local::engine::tests::engine::llp0133_sketch_1_lane_q_receipt_and_fanout_privacy ... FAILED
test local::engine::tests::engine::managed_action_staging_preserves_committed_terminal_service_loss ... FAILED
test local::engine::tests::engine::mutation_fanout_resolution_supersession_never_reuses_frame_key ... FAILED
test local::engine::tests::engine::one_projection_over_handoff_limit_fails_closed_and_remains_pending ... FAILED
test local::engine::tests::engine::overflow_root_waits_for_every_auth_scoped_child ... FAILED
test local::engine::tests::engine::permission_backing_event_quarantines_even_a_positive_delta ... FAILED
test local::engine::tests::engine::postcommit_publication_guard_failure_confirms_without_retaining_sensitive_output ... FAILED
test local::engine::tests::engine::postcommit_head_corruption_preserves_confirmed_receipt_and_durable_truth ... FAILED
test local::engine::tests::engine::quarantined_resubscribe_stays_fail_closed_until_accepted_authority_proof ... FAILED
test local::engine::tests::engine::retry_churn_at_the_global_cap_does_not_starve_unrelated_mutations ... FAILED
test local::engine::tests::engine::bulk_grant_revocation_derives_subject_and_preserves_foreign_durable_authority ... FAILED
```

They are inherited auth/admission-room failures, pending-effect/postcommit
failures, and one `/dev/fd` fixture failure outside the migrated asset and push
paths; none of the migrated tests failed. The promised epoch-gate test and the
new cross-engine refusal test executed separately and passed:

```text
test local::engine::tests::engine::engine_authorization_snapshot_path_discards_predecessor_after_installed_fence ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 607 filtered out; finished in 0.10s
```

```text
test push::authority_tests::push_reservation_refuses_authority_from_different_engine ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 607 filtered out; finished in 0.06s
```

Sibling `cargo test -p snapback-sync` remains inherited compile-red on removed
room-reauthorization helpers (15 errors) and pending-effect API migrations (5
errors); this lane did not touch sync. Diagnostics-registry generation passed.
Guide-manifest generation and `check-inventories` remain inherited-red because
three referenced generated demo/Contract files are absent. `./ref-check`
passed with 0 errors.
