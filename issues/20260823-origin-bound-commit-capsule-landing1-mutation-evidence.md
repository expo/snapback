# Origin-bound commit capsule Landing 1 mutation evidence

Status: Evidence — Landing 1, 2026-08-23
Related: `issues/20260823-origin-bound-commit-capsule-design.md`

This is the fail-first ledger required by design section 7. Every mutant was applied to the
production path or its exact production-cut observer, built, run, then removed without
checkout/restore/stash. “Naïve” names the shortest pre-existing oracle that remained green. “Final”
names the strengthened oracle. Output below is quoted verbatim from the attributed test. The
complete command output remains under `/tmp/prim1-mutations/` in the implementation workspace.

## 1. One bound origin

Mutant: bypass the post-acquisition graph-identity comparison. The ordinary correlated operation
remained green:

```text
running 1 test
test server::tests::origin_bound_watch_selected_cut_has_exact_nonempty_guarded_commit_and_permit_free_outcome ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 592 filtered out; finished in 0.19s
```

The actual post-bind `{state B, admission A, origin A}` substitution failed:

```text
thread 'server::tests::origin_bound_watch_rejects_post_bind_local_referent_replacement' (66809689) panicked at crates/snapback-server/src/server/tests.rs:40716:9:
post-bind {state B, admission A, origin A} must be refused
test server::tests::origin_bound_watch_rejects_post_bind_local_referent_replacement ... FAILED

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 592 filtered out; finished in 0.18s
```

## 2. Reservation occurs outside Local

Mutant: enter the managed Local write scope around the classified reservation. A construction-only
oracle remained green:

```text
running 1 test
test server::tests::bounded_commit_capsule_rejects_preclaimed_graph_a_with_shared_snapback_b ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 592 filtered out; finished in 0.14s
```

The selected production reservation failed at the real lock-rank invariant before it could fake a
later auth result:

```text
thread 'tokio-rt-worker' (66842419) panicked at crates/snapback-auth/src/auth/lock_rank.rs:23:9:
auth rank 20 entered while LocalSnapback write scope was active; stage the effect before the bounded auth handoff (LLP 0059)
thread 'server::tests::origin_bound_watch_selected_cut_has_exact_nonempty_guarded_commit_and_permit_free_outcome' (66842416) panicked at crates/snapback-server/src/server/tests.rs:40592:10:
selected capsule finish signal: RecvError(())
test server::tests::origin_bound_watch_selected_cut_has_exact_nonempty_guarded_commit_and_permit_free_outcome ... FAILED

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 592 filtered out; finished in 0.24s
```

## 3. Exact reservation is the one committed

Mutant: record a decorative second reservation identity while committing under the real one. The
ordinary route race remained green:

```text
running 1 test
test server::tests::watch_suspend_reservation_wins_before_logout ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 592 filtered out; finished in 0.21s
```

The storage-cut receipt rejected the mismatched identity:

```text
thread 'server::tests::origin_bound_watch_selected_cut_has_exact_nonempty_guarded_commit_and_permit_free_outcome' (66857228) panicked at crates/snapback-server/src/server/tests.rs:40614:5:
assertion `left == right` failed
  left: 0
 right: 1
test server::tests::origin_bound_watch_selected_cut_has_exact_nonempty_guarded_commit_and_permit_free_outcome ... FAILED

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 592 filtered out; finished in 0.16s
```

## 4. Guard replaces rather than wraps

Mutant: retain an outer admission-effect guard while the sealed cut acquires its own guard. The
construction-only oracle remained green:

```text
running 1 test
test server::tests::bounded_commit_capsule_rejects_preclaimed_graph_a_with_shared_snapback_b ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 592 filtered out; finished in 0.15s
```

The bounded selected-path oracle caught the non-reentrant deadlock (the outer process alarm then
terminated the wedged test process):

```text
running 1 test

thread 'server::tests::origin_bound_watch_selected_cut_has_exact_nonempty_guarded_commit_and_permit_free_outcome' (66898213) panicked at crates/snapback-server/src/server/tests.rs:40591:10:
selected capsule finishes: Elapsed(())
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

## 5. Permit ends at COMMIT

Mutant: `mem::forget` the reservation after COMMIT. The construction-only oracle remained green:

```text
running 1 test
test server::tests::bounded_commit_capsule_rejects_preclaimed_graph_a_with_shared_snapback_b ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 592 filtered out; finished in 0.17s
```

The exact liveness assertion failed before response work could hide the retained permit:

```text
thread 'tokio-rt-worker' (66912720) panicked at crates/snapback-server/src/server/commit_capsule.rs:597:13:
assertion failed: probe.0.scope.is_inactive()
thread 'server::tests::origin_bound_watch_selected_cut_has_exact_nonempty_guarded_commit_and_permit_free_outcome' (66912715) panicked at crates/snapback-server/src/server/tests.rs:40592:10:
selected capsule finish signal: RecvError(())
test server::tests::origin_bound_watch_selected_cut_has_exact_nonempty_guarded_commit_and_permit_free_outcome ... FAILED

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 592 filtered out; finished in 0.19s
```

## 6. Typed terminal cause survives

Mutant: flatten `Terminal(cause)` into the nonterminal/rejected carrier while preserving the public
HTTP error. The route-level HTTP oracle remained green:

```text
running 1 test
test server::tests::watch_suspend_logout_wins_before_reservation ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 592 filtered out; finished in 0.19s
```

The direct typed outcome oracle failed:

```text
thread 'server::tests::origin_bound_watch_returns_the_typed_terminal_cause_without_string_reconstruction' (66926022) panicked at crates/snapback-server/src/server/tests.rs:40675:5:
assertion failed: matches!(outcome,
    super::CommitCapsuleOutcome::CallerTerminal(crate::auth::invocation::CallerAuthorityTerminalCause::SessionRetired
    { disposition: TerminalAuthorityDisposition::DurableDelete, .. }))
test server::tests::origin_bound_watch_returns_the_typed_terminal_cause_without_string_reconstruction ... FAILED

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 592 filtered out; finished in 0.19s
```

This same mutant is the shortest blanket-downgrade mutant: the classified call became a generic
error path. No `From<SnapbackError>` exists on the production capsule outcome.

Landing 1's capsule-specific runtime oracle covers the adopted watch path's session
`DurableDelete` disposition. The terminal carrier remains a typed enum and the existing sync tests
cover the classifier variants, but this ledger does not claim that every section 7 terminal-matrix
cell was exercised through the new capsule.

## 7. Deadline covers blocking-worker handoff

Mutant: bound mutex acquisition and then use an independently unbounded `spawn_blocking`. The
ordinary unsaturated route remained green:

```text
running 1 test
test server::tests::watch_suspend_reservation_wins_before_logout ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 592 filtered out; finished in 0.21s
```

The causal handoff oracle failed because the selected helper never recorded the bounded enqueue:

```text
thread 'server::tests::origin_bound_watch_deadline_covers_mutex_to_blocking_worker_handoff' (66940010) panicked at crates/snapback-server/src/server/tests.rs:40797:10:
capsule acquires mutex and enqueues an unclaimed worker handoff: Elapsed(())
test server::tests::origin_bound_watch_deadline_covers_mutex_to_blocking_worker_handoff ... FAILED

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 592 filtered out; finished in 1.17s
```

## 8. FIFO cancellation — stopped, guarantee not claimed

Mutant: replace the bounded acquisition's queued `lock_owned` future with repeated
`try_lock_owned`. Both the naïve route and the design's stated final oracle passed:

```text
running 1 test
test server::tests::watch_suspend_reservation_wins_before_logout ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 592 filtered out; finished in 0.21s
```

```text
running 1 test
test server::tests::bounded_commit_capsule_queue_timeout_preserves_fifo_and_drains_logout ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 592 filtered out; finished in 1.36s
```

The mutation was restored. The implementation uses queued `lock_owned`, but Landing 1 makes no
mutation-sensitive FIFO guarantee because the prescribed oracle cannot distinguish polling.

## 9. COMMIT is real

Mutant: roll back the kernel pending transaction and return `Ok(value)` after emitting the same
pre-COMMIT observation. The construction-only oracle remained green:

```text
running 1 test
test server::tests::bounded_commit_capsule_rejects_preclaimed_graph_a_with_shared_snapback_b ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 592 filtered out; finished in 0.16s
```

The non-empty durable-successor oracle failed:

```text
thread 'server::tests::origin_bound_watch_selected_cut_has_exact_nonempty_guarded_commit_and_permit_free_outcome' (66973959) panicked at crates/snapback-server/src/server/tests.rs:40291:5:
assertion `left != right` failed: reserved Suspend did not commit
test server::tests::origin_bound_watch_selected_cut_has_exact_nonempty_guarded_commit_and_permit_free_outcome ... FAILED

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 592 filtered out; finished in 0.19s
```

The external `implement-capsule-pending` and `fake-watch-pending` attack fixtures separately prove
that an adopter cannot install that fake adapter.

## 10. Reconciliation is semantic

Mutant: remove the semantic-fingerprint comparison while preserving database and operation-ID
comparison. The prior missing-row oracle remained green:

```text
running 1 test
test storage::watches::tests::resume_reconciliation_rejects_a_missing_evaluation_job ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 838 filtered out; finished in 0.07s
```

The same-ID/different-successor oracle failed:

```text
thread 'storage::watches::tests::reconciliation_witness_rejects_same_id_with_a_different_semantic_successor' (66987132) panicked at crates/snapback-kernel/src/storage/watches.rs:2955:14:
same operation ID cannot substitute another semantic successor: WatchManagementCommit { record: WatchRecord { id: "watch-reconciliation-semantic-seal", owner_kind: Integration, owner_principal_id: "integration-principal", owner_authority_instance_id: "integration-record", authority_mode: CapturedGrant, anchor_grant_id: Some("watch-reconciliation-semantic-seal-anchor"), installation_grant_id: Some("installation-grant"), anchor_expires_at_ms: 31536001000, query_function_id: "query-function", query_function_name: "currentValue", query_basis: 3, query_args: Object {"account": String("a")}, query_args_digest: "query-args-digest", read_dependencies: [], predicate: Object {"op": String("eq"), "path": String("/ready"), "value": Bool(true)}, reaction_kind: Function, reaction_function_id: "reaction-function", reaction_function_name: "notify", reaction_function_kind: Action, reaction_basis: 4, reaction_args: Object {"channel": String("ops")}, reaction_args_digest: "reaction-args-digest", webhook_url: None, webhook_secret_ref: None, status: Suspended, status_reason: Some("owner_suspended"), notification: None, daily_firing_budget: 10, firings_today: 0, debounce_ms: 5000, pending: false, last_predicate_state: false, evaluation_count: 0, coalesced_invalidation_count: 0, firing_count: 0, last_evaluated_at_ms: None, last_fired_at_ms: None, last_firing_outcome: None, last_diagnostic_code: None, created_at_ms: 1000, updated_at_ms: 1020, recent_firings: [], pending_job_id: None, pending_firing_ordinal: None, pending_firing_job_id: None }, evaluation_enqueued: false }
test storage::watches::tests::reconciliation_witness_rejects_same_id_with_a_different_semantic_successor ... FAILED

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 838 filtered out; finished in 0.05s
```

This is the watch adopter's canonical successor and carrier-tamper proof. The later operation
families named in the design have different semantic fields and are intentionally outside Landing
1, so this evidence does not claim independent tamper runs for their grant scopes, code hashes,
expiries, or proof states.

## 11. Test reaches the selected method

Mutant: make the production adapter lookup skip the installed probe. The ordinary route remained
green:

```text
running 1 test
test server::tests::watch_suspend_reservation_wins_before_logout ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 592 filtered out; finished in 0.21s
```

The exact adapter-invocation oracle failed:

```text
thread 'server::tests::origin_bound_watch_selected_cut_has_exact_nonempty_guarded_commit_and_permit_free_outcome' (67011791) panicked at crates/snapback-server/src/server/tests.rs:40594:5:
assertion `left == right` failed: the selected adapter ran exactly once
  left: 0
 right: 1
test server::tests::origin_bound_watch_selected_cut_has_exact_nonempty_guarded_commit_and_permit_free_outcome ... FAILED

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 592 filtered out; finished in 0.17s
```

## 12. Empty path cannot pass

The fake-commit/no-write mutant from guarantee 9 retained the pre-COMMIT counter and returned a
successful value. Its failure at `assert_watch_management_effect` is the non-empty-path oracle; the
verbatim output is quoted under guarantee 9.

## Restored-source confirmation

After removing every mutant, the selected server oracles reported:

```text
running 4 tests
test server::tests::origin_bound_watch_rejects_post_bind_local_referent_replacement ... ok
test server::tests::origin_bound_watch_selected_cut_has_exact_nonempty_guarded_commit_and_permit_free_outcome ... ok
test server::tests::origin_bound_watch_returns_the_typed_terminal_cause_without_string_reconstruction ... ok
test server::tests::origin_bound_watch_deadline_covers_mutex_to_blocking_worker_handoff ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 589 filtered out; finished in 0.49s
```

The restored semantic oracle reported:

```text
running 1 test
test storage::watches::tests::reconciliation_witness_rejects_same_id_with_a_different_semantic_successor ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 838 filtered out; finished in 0.06s
```

The current FIFO behavior remains green, without upgrading the narrowed claim:

```text
running 1 test
test server::tests::bounded_commit_capsule_queue_timeout_preserves_fifo_and_drains_logout ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 592 filtered out; finished in 1.37s
```

## Corrective carrier and recovery audit

The first Landing 1 implementation exposed a four-argument `pub(crate)`
`CommitCapsuleRuntimeBinding::new`. The fail-first reproduction used two complete
`watch_management_race_fixture(Suspend)` graphs. It took shared state, graph identity, and commit
origin from fixture B, admission and prepared authority from fixture A, seeded a B watch owned by
A's principal, then committed through the cross-wired destination. The assertion read database B
and proved its watch was suspended. The exact verdict was:

```text
running 1 test
test server::tests::origin_bound_watch_currently_allows_state_b_graph_b_origin_b_admission_a_authority_a ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 593 filtered out; finished in 0.26s
```

After construction was changed to consume one opaque engine-correlated carrier and the old parts
decomposer was removed, the unchanged reproduction stopped compiling at both deliberate splice
points:

```text
error[E0599]: no method named `destination_parts_for_cross_wire_test` found
error[E0599]: no function or associated item named `new` found for struct `CommitCapsuleRuntimeBinding`
```

The same audit removed the production generic retention handle. Its key and exact removal are now
module-private, while retained watch recovery is owned by private
`WatchManagementRecoveryOwner`; only the prototype tests receive a `cfg(test)` generic facade.

The source audit of the eight Landing 1 attack bins found seven that named the item each claimed to
fence. `supply_capsule_destination_parts.rs` was the exception: it named only
`CommitCapsuleDestination`, so its E0603 was unrelated to runtime construction. The repaired attack
now names `CommitCapsuleRuntimeBinding` and invokes the removed four-part constructor. All eight
post-correction verdicts are quoted below.

## Compile-fail enforcement

These are enforced by `scripts/check-security-boundaries.mjs`, which compiles each inventoried
fixture with rustc JSON and requires the expected diagnostic's primary span to overlap `@attack`.
Rustdoc does not enforce the pinned diagnostic code. The eight Landing 1 attacks reported:

```text
[security-boundary] PASS name-capsule-internal-phase: E0603 at src/bin/name_capsule_internal_phase.rs:3:44 under features []
[security-boundary] PASS supply-capsule-destination-parts: E0603 at src/bin/supply_capsule_destination_parts.rs:3:38 under features []
[security-boundary] PASS implement-capsule-pending: E0405 at src/bin/implement_capsule_pending.rs:4:31 under features []
[security-boundary] PASS fake-watch-pending: E0308 at src/bin/fake_watch_pending.rs:7:44 under features []
[security-boundary] PASS construct-exact-commit-rows: E0451 at src/bin/construct_exact_commit_rows.rs:9:9 under features []
[security-boundary] PASS construct-watch-intended-rows: E0451 at src/bin/construct_watch_intended_rows.rs:6:9 under features []
[security-boundary] PASS extract-capsule-origin-authority: E0616 at src/bin/extract_capsule_origin_authority.rs:5:21 under features []
[security-boundary] PASS name-raw-capsule-authority: E0603 at src/bin/name_raw_capsule_authority.rs:3:45 under features []
```

The complete inventory was also run. All eight Landing 1 entries above passed; the aggregate gate
remains red on twelve pre-existing inventory entries outside this landing's added fixture set. Its
terminal output was:

```text
SNAPBACK_SECURITY_BOUNDARY: 12 fixture or inventory violation(s)
[security-boundary] RED: 38 attack-span rejection(s), 12 failure(s), 50 inventoried attack(s); 558.46s
```
