# snapback-sync test target compile-red: room-reauthorization helpers (inherited)

**Status:** Open
**Opened:** 2026-08-26
**Systems:** Sync, Auth

## Problem

`cargo test -p snapback-sync` no longer compiles on current main: 15
missing room-reauthorization helpers plus 5 stale pending-effect calls in
sync test code. The target was green on 2026-08-25 (258+1+6 pass during
the live-cutoff landing), so this regressed with the overnight auth-route
landings (F182/F094/C009 series). Same class as the engine seam-helper
debt just repaired (`issues/closed/20260825-engine-lib-test-target-red-
seam-helpers.md`): a security/auth wave narrowed or moved helpers without
migrating every test caller.

## Impact

snapback-sync tests (including the coalescer fence unit added by the
live-cutoff work) cannot run until migrated.

## Wanted

Migrate the sync test callers to the current room-reauthorization and
pending-effect APIs, preserving the wave's bindings — same discipline as
the engine migration (no broad helper reintroduction). Then re-run the
full sync suite and record the result.

## Related

The engine lib suite also retains 22 reproducible inherited failures (unmasked
when compilation was restored — see the closed engine seam ticket's
resolution): auth/admission-room failures, pending-effect/postcommit failures,
and one `/dev/fd` fixture failure. Classify and burn those with the same effort.

The actual reproducible `... FAILED` lines are:

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

**Flakiness note (2026-08-26):** two consecutive original full engine
lib-suite runs gave 584/23 then 585/22, but only the aggregate line from the
23-failure run was retained. An original-tree replay and repeated amended-tree
replays all reproduced the 22 names above, so the intermittent twenty-third
name is unknown and is not fabricated here. The migrated asset/lease paths,
the epoch-gate delivery test, and the new cross-engine refusal test are green.
