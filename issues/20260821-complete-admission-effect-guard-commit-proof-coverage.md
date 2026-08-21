# Admission-effect-guard commit-proof coverage

Status: Open
Date: 2026-08-21
Revised: 2026-08-21
Systems: snapback-auth, snapback-engine, snapback-kernel, snapback-server
Related: LLP 0058#gate-algorithm, lane/fenceproof

## What this document does and does not establish

This is no longer derived from existing `effect_guard` calls. The population
starts at SQLite commit sinks in `crates/snapback-kernel/src`, then traces each
durable operation outward to its engine/server caller and asks whether a
managed `AdmissionEffectGuard` is live at that commit.

The first 2026-08-21 source census reported:

- 144 production explicit commit-primitive occurrences (`Transaction::commit`
  or an explicit SQL `COMMIT`) in 115 enclosing functions;
- 62 production SQL-write expressions whose receiver looked like a bare
  `Connection` rather than a syntactic `Transaction`; that expression count
  was a candidate list, not a closure result, and its first call-edge review
  missed the admitted vector-query settlement described below; and
- 181 production call sites into the shared commit helpers
  (`with_auth_transaction`, its attempt variants, the authorization/mode commit
  helpers, and the asset/read transaction helpers).

The `vector::acceptance` module and `#[cfg(test)]` / `test-support` bodies are
excluded. `fork_promotion_bench` remains in the census because it is compiled
production code, but its temporary benchmark database is classified as not an
admission-scoped store. Read-only transactions that call `commit()` are kept in
the primitive census and explicitly rejected from the durable-write population
after their bodies are reviewed.

The reproducible first-pass searches are:

```sh
rg -n --glob '*.rs' '\.commit\(\)|execute_batch\("COMMIT"' crates/snapback-kernel/src
rg -n --glob '*.rs' 'with_auth_transaction|attempt_auth_transaction|commit_with_.*interlock|commit_mode_transaction' crates/snapback-kernel/src
rg -n --glob '*.rs' '\.(execute|execute_batch)\(' crates/snapback-kernel/src
```

Those searches are a source census, not a formal call-graph proof. Macro-
generated or dynamically assembled SQL would require a compiler-level effect
inventory. The earlier revision nevertheless called its result
“sink-complete.” That was false: it sampled the bare-connection candidates by
operator family and mistook `vector::sqlite::quarantine_generation_on` for the
vector-rebuild lane, without following its separate admitted query-settlement
caller. This revision makes no completeness claim. It records the systematic
receiver-and-caller pass performed at this commit and treats every numeric
census as a lower bound unless a compiler-enforced effect inventory replaces
it.

## Set 1 — live guard, proven by the focused harness

The commit observer runs at the eight enumerated kernel call sites immediately
before their `Transaction::commit` calls, not after a successful engine/server
call. It is not installed in the ordinary-mutation commit helpers and this
document does not describe it as observing every kernel commit primitive. The
observer compares the exact controller identity and admission epoch expected
by the operation with thread-local guard-lifetime bookkeeping. It never
acquires, `try_lock`s, or re-enters the non-reentrant admission mutex.

| Operation | Commit shape proved |
| --- | --- |
| OAuth dynamic registration | `with_auth_transaction`; one commit attempt |
| Capability-link mint | `with_auth_transaction`; success and durable-commit-then-post-read-error |
| Capability-link use consumption | `with_auth_transaction`; one commit attempt |
| Capability-link use settlement | `with_auth_transaction`; one commit attempt |
| Capability-link revocation | `with_auth_transaction`; one commit attempt |
| Client-mutation acknowledgement | two independent settlement transactions; both commit attempts observed under one guard |
| Push durable reservation | `with_auth_transaction`; one commit attempt |
| Push batch claim | `with_auth_transaction`; one commit attempt |
| Push transmitting marker | `with_auth_transaction`; one commit attempt |
| Push batch settlement | `with_auth_transaction`; one commit attempt |
| Watch creation | direct watch transaction; observation precedes commit, before the fallible post-commit row read |
| Agent-invitation mint | `attempt_auth_transaction`; one server-path commit attempt |

The five removal/binding mutations (`V`, `E`, `_`, deletion, and late drop)
still apply to every site. The error-after-commit regression injects an error
immediately after SQLite commits and before `row_for_id_on`; the row read is
not reached. The call returns `TEST_CAPABILITY_LINK_POST_COMMIT_READ_FAILURE`,
the durable row count advances, and the commit observer has already proved the
guard live. Because the observer runs before the commit call, a lost/ambiguous
commit acknowledgement cannot bypass the observation either.

The proof identity is the exact `AdmissionController` allocation plus the
admission epoch captured for the target operation. A guard from another
controller on the same thread therefore records a mismatch rather than
satisfying the proof. Commit observation is passive—commit sites run no caller
callback—and its returned RAII scope removes a partially consumed observer.
The two-commit acknowledgement regression commits its first transaction,
returns before the second commit primitive, drops the scope, and proves a
later acknowledgement on the reused thread receives a fresh observer.

The observer definition and all eight call sites are gated with
`cfg(any(test, feature = "test-support"))`; default builds therefore contain
neither calls nor an empty observer function. `snapback-services/remainder-tests`
does still forward `snapback-kernel/test-support`: its service remainder seam
calls the kernel's snapshot-pinned test hook, and removing the edge makes that
declared feature fail to compile. This is an explicit, non-default test
composition path. Directly enabling it or the kernel feature cannot restore the
old risk: the commit site only compares an opaque expected identity and
increments passive counters, so an observer caller cannot supply code to run or
panic immediately before `COMMIT`.

## Set 2 — live guard, not yet removal-mutation proven

Each row names the specific missing proof work. These are not covered merely
because they share a lower-level helper with Set 1: a removal mutation could
still drop the operation's outer guard before it reaches that helper.

| Operation | Specific reason it is not yet proved |
| --- | --- |
| OAuth consent request | Needs a pending-consent fixture and a durable request-row assertion. |
| OAuth consent denial | Needs a seeded request and denial-state assertion. |
| OAuth consent approval | Needs grant/session/step-up fixtures and an approval-row assertion. |
| OAuth authorization-code issuance | Needs deterministic random material and a persisted code assertion. |
| Pending-effect inbox expiry/pruning | Needs an expired inbox fixture and exact pruned-row assertion. |
| Pending-effect lookup expiry/pruning | Needs an expired single-effect fixture and exact pruned-row assertion. |
| Pending-effect service-authority revalidation | Needs an expiring scoped-token fixture and the retained-authority expiry write asserted. |
| Pending-effect refusal | Needs a pending effect and refused terminal-state assertion. |
| Pending-effect approval | Needs function-generation, approver, link-origin, and optional step-up fixtures. |
| Pending-effect settlement | Needs an approved effect and executed/outcome persistence assertion. |
| Pending-effect denial | Needs a pending effect and denying-principal assertion. |
| Pending-effect creation | Needs the approval-required mutation fixture and pending intent row assertion. |
| Grant-request inbox expiry/pruning | Needs expired grant requests and an exact post-prune inbox assertion. |
| Grant listing expiry/pruning | Needs expired grants and an exact post-prune listing assertion. |
| Integration-principal retirement | Needs credential/grant/token lineage plus terminal-row assertions. |
| Integration suspension | Needs an active integration and suspension-state assertion. |
| Password-lockout clearing | Needs locked password identity state and cleared-attempt assertions. |
| Declared-client status change | Needs a declared client and exact status assertion. |
| Declared-client deletion | Needs a declared client and absence/tombstone assertion. |
| Push-token registration | Needs a live session/installation fixture and token-ledger assertion. |
| Push-token unregistration | Needs a registered token and terminal/absence assertion. |
| Protected-record erasure | Needs protected row/history/checkpoint fixtures and complete erasure assertions. |
| Operation-coverage activation | Needs an uncovered lane fixture and durable coverage receipt assertion. |
| Operation-identity range issuance | Needs exact envelope/range recovery assertions at the issuance commit. |
| Authorized-lease reservation | Needs a qualifying query witness and durable lease-row assertion. |
| Watch state transition | Needs pause/resume/cancel cases and both transition and optional enqueue commits counted. |
| Watch-anchor renewal | Needs a user-owned watch and exact renewed deadline assertion. |
| Authorization manual-retry reservation | Needs a connection obligation and reserved retry-row assertion. |
| Authorization retry initial reservation | Needs the shared retry helper's initial-reservation branch. |
| Authorization retry automatic reservation | Needs its automatic retry branch and episode counter assertion. |
| Authorization retry failure record | Needs its failed-attempt branch and durable diagnostic assertion. |
| Media-command mutation | Needs the media host-command fixture and mutation/asset commit assertion. |
| Host-child mutation | Needs a nested host-child plan and child settlement assertion. |
| Idempotent mutation | Needs a client-mutation identity and replay-ledger assertion. |
| Ordinary mutation | Needs a minimal app table and changed-row/version assertion. |
| Media-command Ibex transaction | Needs the Ibex media host-command fixture and commit assertion. |
| Host-child Ibex mutation | Needs an Ibex host-child fixture and child settlement assertion. |
| Ordinary Ibex mutation | Needs a minimal Ibex mutation and changed-row/version assertion. |
| Branch mutation | Needs a managed branch, branch authority, and branch-local commit assertion. |
| Branch Ibex mutation | Needs the equivalent managed-branch Ibex fixture. |
| Nested host-plan transaction | Needs an outer action and nested mutation with one exact durable child assertion. |
| Detached nested mutation | Needs detached-action staging and the nested settlement assertion. |
| Branch idempotent mutation | Needs a branch client identity and exact replay-ledger assertion. |
| Branch ordinary mutation | Needs the non-idempotent branch path and branch-head assertion. |
| Vector-query failure quarantine | The pooled read and live write-lane settlement callers now acquire the query invocation's exact effect guard before opening the registered vector writer. Needs a deterministic corrupt-generation fixture, durable quarantine assertion, and removal mutation. |
| Empty cron-scheduler-state persistence | Needs an empty schedule and exact persisted scheduler-state assertion. |
| Cron claim persistence | Needs a due cron slot and claim/lease assertion. |
| Manual cron claim persistence | Needs the forced-run path and manual-claim assertion. |
| Job-result commit | Needs an admitted claimed job and terminal CAS/attempt assertion. |
| Cron-result-ledger persistence | Needs a completed claim and exact run-ledger assertion. |
| Authenticated finite-session use | Needs a finite authenticated request whose session deadline write is asserted. |
| Authenticated connection use | Needs a connection grant and exact durable use-extension assertion. |
| Step-up challenge creation | Needs a session/binding fixture and challenge-row assertion. |
| Pairing-code mint | Needs agent policy and exact code-row assertion. |
| Pairing-code presentation | Needs a live code and durable presented-state assertion. |
| Agent registration | Needs invitation/pairing registration variants and principal/credential assertions. |
| Grant approval | Needs pending consent, exact scopes, and created grant/token assertions. |
| Grant denial | Needs a pending request and denied-state assertion. |
| Grant revocation | Needs live service authority and grant/token terminal assertions. |
| Bulk grant revocation | Needs multiple actor grants and exact affected-set assertions. |
| Email-code session mint | Needs verification challenge/provider fixtures and session credential assertions. |
| Password signup | Needs password policy/identifier fixtures and new identity/session assertions. |
| Password signin | Needs an existing password identity and attempt/session assertions. |
| Password reset | Needs recovery proof and rotated credential/session assertions. |
| Password change | Needs current credential plus step-up and generation-rotation assertions. |
| Password set | Needs a passwordless identity and new credential assertion. |
| Recovery-code consumption | Needs a live recovery set and one-code terminal assertion. |
| Recovery-code rotation | Needs authenticated step-up and replacement-set assertion. |
| Auth-exchange rejection | Needs a planned exchange and durable rejection assertion. |
| Auth-exchange issuance | Needs a valid exchange and session/scoped-token assertion. |
| Unknown auth-exchange handling | Needs an unknown code and durable abuse/attempt assertion. |
| Auth request-code persistence | Needs provider mailbox coordination and challenge-row assertion. |
| Refresh rotation | Needs a live refresh family and successor generation assertion. |
| Refresh-reuse handling | Needs a superseded credential and family terminalization assertion. |
| Logout | Needs a live session and revoked-session assertion. |
| Family alarm | Needs a detected family compromise and alarm-row assertion. |
| Family-alarm revocation | Needs affected session/service lineage and terminal assertions. |
| App reset | Needs the reset authorization fixture and complete reset-state assertion. |

That is 78 guarded durable operations without focused removal-mutation proof.

## Set 3 — durable commits with no live admission guard

This set is non-empty. The old guard-first method could not discover it. The
attempt-5 receiver-and-caller pass established that the earlier 18 was a floor:
it found a nineteenth admitted operation, vector-query failure quarantine. That
operation is now fenced at both engine settlement callers and has moved to Set
2; the 18 rows below remain unfixed.

### Fence required

These commits are downstream of a live admitted authority or admission lease,
but no `AdmissionEffectGuard` is live at their durable cut. They need product
fixes and focused mutation tests before this ticket can close.

| Unguarded durable operation | Assessment |
| --- | --- |
| Ask spend reservation | Fence required: the API request has `PreparedAuthority`, but the server drops it from the storage call before the budget reservation commits. |
| Ask spend settlement | Fence required: it finalizes the same admitted API effect after provider work without reacquiring the request's admission fence. |
| Asset upload-attempt creation | Fence required: `asset_attempt_create` accepts `PreparedAuthority` but commits the attempt after authorization with no effect guard. |
| Asset upload-attempt cancellation | Fence required when invoked by the owner request; the durable terminal transition is an admitted effect. |
| Asset TUS patch/ingest state | Fence required for owner-driven patch commits; a retired epoch must not accept late durable upload progress. |
| Asset explicit delete | Fence required: `asset_delete_inner` accepts `PreparedAuthority`, then the asset transaction commits without guarding that authority. |
| Asset signed-URL issuance/strict delivery receipts | Fence required where the read helper writes a delivery/issuance receipt for an admitted caller. Pure read-only helper commits do not enter this row. |
| Initial one-off job claim | Fence required: `claim_due_jobs` obtains `first_admission` before the durable claim, but never turns it into an effect guard around `jobs::claim_due_jobs`. |
| Watch evaluation begin | Fence required: `prepare_watch_job` owns the claimed job's admission lease, but `begin_watch_evaluation` is an implicit-autocommit write before any guard. |
| Watch dead-state transition during evaluation | Fence required: it is a terminal durable result of the admitted watch job. |
| Watch evaluation decision/enqueue | Fence required: predicate state, firing ordinal, and child job enqueue commit as the admitted evaluation's result. |
| Watch evaluation retry/failure record | Fence required: retry and terminal failure rows are durable results of the admitted job. |
| Watch firing settlement/retry | Fence required: function/action/webhook outcomes commit after authority revalidation but outside an effect guard. |
| Watch webhook reservation | Fence required: `reserve_webhook_delivery` is a direct implicit-autocommit write produced by the admitted watch reaction. |
| Watch webhook attempt settlement | Fence required: provider outcome and watch firing settlement are admitted job effects and currently perform separate unguarded commits. |
| Invalidation-driven watch scheduling | Fence required: post-mutation fanout can durably enqueue a watch job after the originating mutation guard has dropped. |
| Stream-attempt upsert | Fence required when called for an admitted action/stream attempt; `settlement::upsert_stream_attempts` is direct implicit autocommit. |
| Stream-transcript settlement | Fence required when it publishes an admitted action's durable transcript; the direct connection write has no admission guard. |

### Fence not required for this protocol

These paths have no live guard, but they do not consume an admitted app
authority whose epoch can retire. Their own mode-transition, operator,
recovery, migration, service-terminal, or pre-auth interlocks remain required;
this assessment does not weaken those checks.

| Unguarded durable family | Assessment |
| --- | --- |
| Auth-mode stage/consume/downgrade/quarantine/unstage and schema activation | No admission effect guard: these paths own the mode transition and close/drain admission instead. |
| Authorization-interlock commits and projection rebuild | No admission effect guard when run by activation/recovery; the authorization reservation/ticket is the governing interlock. Guarded mutation callers remain in Sets 1–2. |
| Pre-auth sender replay, nonce, throttle, hosted-edge admission, challenge cleanup, and auth GC | No admission effect guard: they execute before a `PreparedAuthority` exists and are security-control state, not effects of an admitted app epoch. |
| Auth rescue, logical import, restore, rehearsal, backup, and stream-incarnation bootstrap | No admission effect guard: operator/startup/recovery authority governs them while app admission is absent or closed. |
| Schema/infra creation, retention backfill, sequence installation, and change-journal pruning | No admission effect guard: startup/maintenance writer authority governs these internal cuts. |
| Migration apply/release/rollback/cancel/backfill/copy/validation/cleanup | No admission effect guard: migration admission/fence and host-operation identity govern the closed migration lane. |
| Instance-fork scrub/mint, managed-branch create/drop/reap/custody repair, and derived-fork egress-denial receipt | No admission effect guard: these are operator or registered-system lanes, not app invocation authority. Branch mutation commits themselves remain guarded in Set 2. |
| Promotion tickets, reservations, reexecution, foreclosure, captured-effect bookkeeping, and expiry reaping | No admission effect guard for operator/system promotion machinery; authenticated branch app commits remain guarded in Set 2. |
| Checkpoint publication/cancellation/pruning and history maintenance | No admission effect guard for scheduled/operator checkpoint machinery. Protected-record erasure invoked from admitted authority remains guarded in Set 2. |
| Push receipt polling, expired-batch recovery, maintenance claims, idle retirement, and manifest activation | No admission effect guard: these are system/activation continuations. Request token registration, send reservation, and batch action commits remain in Sets 1–2. |
| Asset finalizer/publication/GC/condemnation/reclamation worker state | No admission effect guard after durable handoff: bounded worker/attempt ownership is the authority. User-request asset cuts are separately listed as fence-required above. |
| Cron scheduler internal maintenance outside an admitted claim | No admission effect guard is required. The three admitted scheduler/claim commits and result ledger are in Set 2. |
| Vector rebuild begin/quarantine/resume/activate/rollback | No admission effect guard: operator rebuild generation authority governs these maintenance commits. This exemption does **not** include admitted vector-query failure settlement, which reaches the separate implicit-autocommit sink in `vector/sqlite.rs` and is now guarded in Set 2. |
| Temporary benchmark/reference/backup-output database writes | No admission effect guard: they do not mutate the served canonical store. |
| Read-only pinned, membership, asset-read, and connection transactions | Their `commit()` calls close read transactions and are not durable-write operations. |

## Source-sink appendix

This appendix is the explicit-primitive side of the audit. Repeated commits in
one function are intentionally shown once; the census count above is by source
occurrence. Shared/mixed sinks are resolved by caller in Sets 1–3.

| Kernel source | Enclosing explicit commit functions |
| --- | --- |
| `auth/hosted_edge.rs` | `install_hosted_admission_commit` |
| `auth/throttle.rs` | `charge_shared_authentication_attempt_idempotent` |
| `branches.rs` | `record_overlay_write`, `capture_effect`, `promote` |
| `fork_promotion.rs` | `create_in_app_branch`, `execute_branch_operation`, `capture_effect_intent`, `finalize_captured_effect_operation`, `foreclose_branch_operation_admission`, `deny_egress_attempt`, `issue_promotion_ticket_with_prepared_infra`, `promote_by_reexecution`, `request_head_reservation_with_prepared_infra`, `reap_expired_in_app_branches` |
| `fork_promotion_bench.rs` | `source`, `prepare_promotion_contention_reservation_in` |
| `instance_fork.rs` | `scrub_and_mint_staged_database`, `scrub_copied_authority_for_in_app_branch` |
| `proof_checkpoint.rs` | `ensure_checkpoint_erasure_infra`, `prune_record_history`, `acknowledge_cancelled_checkpoint_producer`, `admit_checkpoint_intent`, `finalize_checkpoint_publication`, `publish_receipt_only_checkpoint`, `create_named_checkpoint_inner`, `erase_protected_record_with`, `erase_protected_record_checkpoint_copies_with` |
| `storage.rs` | `commit_with_prepared_authorization_interlock`, `commit_authorization_transaction`, `install_sequence_declarations`, `create_infra`, `ensure_client_mutation_retention_counters`, `with_pinned_read_snapshot`, `record_membership_transition` |
| `storage/api_envelope_state.rs` | `record_api_envelope` |
| `storage/asset_attempts.rs` | `asset_attempts_transaction` |
| `storage/asset_maintenance.rs` | `asset_maintenance_transaction` |
| `storage/asset_reads.rs` | `asset_reads_transaction` |
| `storage/auth.rs` | `with_auth_transaction`, `attempt_auth_transaction`, `attempt_auth_transaction_with_service_terminal`, `apply_auth_restore_declaration` |
| `storage/auth_identity.rs` | `execute_verified_provisioning` |
| `storage/auth_invalidation.rs` | `data_version_stream`, `activate_ordinary_mutation_coverage_for_evidence`, `activate_local_target_operation_coverage`, `activate_derived_fork_app_row_journal_coverage`, `reserve_invalidation_boot_issuer`, `with_invalidation_retry_episode` |
| `storage/auth_mode.rs` | `commit_mode_sqlite_transaction`, `inspect_mode_durable_state`, `quarantine_auth_mode`, `unstage_auth_mode`, `apply_same_mode_deployment_inner`, `apply_schema_mode_aware`, `adopt_after_infra` |
| `storage/auth_rescue.rs` | `commit_rescue_transaction` |
| `storage/auth_sender.rs` | `apply_sender_replay_epoch_floor_on`, `issue_sender_nonce_on`, `consume_sender_proof_and_rotate_nonce_on`, `consume_sender_proof_id_on` |
| `storage/auth_stream.rs` | `ensure_authorization_stream_incarnation`, `session_projection_source_inner` |
| `storage/authorized_lease.rs` | `reserve_authorized_lease`, `authorize_revalidation_free_lease` |
| `storage/connections.rs` | `renew_derived_fork_lineage_v1`, `with_pinned_read` |
| `storage/generation_commit.rs` | `commit_function_generation` |
| `storage/jobs.rs` | `claim_due_jobs`, `finish_job` |
| `storage/membership_reads.rs` | `membership_reads_transaction` |
| `storage/migration_executor.rs` | `ensure_migration_host_authority`, `migrate_apply`, `execute_admitted`, `migrate_release_inner`, `abort_to_cancelled`, `migrate_rollback`, `execute_step`, `run_cleanup_tail`, `cleanup_sweep`, `run_backfill_batches`, `run_staged_copy_batches`, `run_cross_table_copy_batches`, `run_validation_scan_indexed` |
| `storage/projection_rebuild.rs` | `rebuild_projection`, `clear_projection_plan_digests` |
| `storage/schema_seed.rs` | `attempt_reset_and_seed_with_authorization_stream`, `attempt_versioned_seed_reset_with_authorization_stream` |
| `storage/settlement.rs` | `issue_client_operation_identity_range`, `host_operation_issuance`, `acknowledge_client_mutations_inner`, `purge_client_mutation_settlements` |
| `storage/versions.rs` | `prune_change_journal` |
| `storage/watches.rs` | `create_watch`, `revalidate_watch_anchor`, `renew_watch_anchor_for_user`, `schedule_watch_evaluation`, `decide_watch_evaluation`, `finish_watch_evaluation_failure`, `record_watch_firing_retry`, `settle_watch_firing`, `mark_watch_dead` |
| `storage/webhooks.rs` | `settle_webhook_attempt` |
| `vector/rebuild.rs` | `begin_rebuild`, `quarantine_and_commit`, `resume_rebuild`, `activate_rebuild`, `rollback_generation` |

The six previously listed `operation_ledger.rs` functions are not explicit
commit functions. `create_infra`, `record_operation_in`,
`record_pending_operation_in`, `prune_compact_envelope_in`,
`expire_envelope_detail_in`, and `compact_envelope_receipt_in` accept a
surrounding `Transaction` and do not commit it. They therefore belong to the
transaction-helper classification below, not the explicit-primitive appendix.

## Bare-connection caller resolution

The attempt-5 pass enumerated every production `.execute` / `.execute_batch`
receiver that was not syntactically `tx` or `transaction`, including
continuation-line receivers such as `self.conn`, `writer.conn`, `canonical`,
and `reference`. It then followed callers of every function that accepts a
`Connection`, because Rust deref coercion means the same helper can receive a
`Transaction` and must not automatically be called an autocommit cut. Test and
acceptance modules were classified separately rather than allowed to hide a
production receiver with the same spelling.

The admitted-context resolutions are:

| Admitted caller family | Bare-connection or implicit-autocommit sink | Resolution |
| --- | --- | --- |
| Vector query failure settlement, pooled-read and live write-lane paths | Opening the registered vector writer can call `operation_ledger::break_operation_coverage_continuity`; successful opening reaches `vector::sqlite::quarantine_generation_for_schema_on` → `quarantine_generation_on` | Missing from the earlier census. Both engine callers now hold the prepared query invocation's exact guard across writer opening and quarantine. Set 2. |
| Cron scheduler publication, claim publication, and result publication | `jobs::save_cron_state` | The corresponding admission lease's guard is live. Set 2. |
| Owner-requested watch transition | `watches::transition_watch`; activation can then enter the explicit `schedule_watch_evaluation` transaction | The request authority's guard spans both cuts. Set 2. |
| Admitted watch evaluation and reaction jobs | `watches::begin_watch_evaluation`, `watches::record_watch_evaluation_retry`, and `webhooks::reserve_webhook_delivery`; the other watch decisions, firing updates, and webhook settlement use explicit transactions | No exact job guard spans these result cuts. Set 3. |
| Admitted action/stream publication | `settlement::upsert_stream_attempts` and `stream_transcripts::settle_stream_transcript` | No exact invocation guard spans these cuts. Set 3. |
| Post-mutation watch fanout | explicit `watches::schedule_watch_evaluation`, whose `enqueue_on`, `finish_without_fire_on`, `insert_firing`, and `trim_firings` helpers accept `&Connection` but receive `&Transaction` | The originating mutation guard has already dropped. Set 3. The helpers do not create extra autocommit cuts. |
| Protected-record erasure and ordinary/client mutation retention | proof-checkpoint save helpers plus `save_retention_floor_on`, `save_client_mutation_auth_retention_counters`, and `save_meta_u64` | Each bare-typed helper receives the already-open transaction; its one outer commit is classified in Set 2. |

All remaining production non-transaction receiver candidates resolve to one of
these non-admitted families: schema/infra and connection setup; auth-mode,
pre-auth, migration, recovery, checkpoint, or retention maintenance;
registered derived-fork lifecycle/egress and operator promotion; search/vector
rebuild maintenance; or reference, copied, backup-output, and benchmark
databases. The direct implicit-autocommit members include
`auth_invalidation::persist_derived_fork_app_row_coverage_receipt`,
`migration_executor::migrate_request_cancel`, managed-branch custody
transitions, and `connections::record_derived_fork_egress_attempt_v1`; their
non-admission interlocks are recorded in Set 3's exemption table. Infra
builders, expected-shape probes, PRAGMAs, and test-only writers do not add an
admitted durable operation.

## Exit condition

Close this ticket only when every Set 2 row has a focused removal-mutation
proof (or a compiler-enforced shared guard carrier), every fence-required Set 3
row has first been fixed and then proved, and the sink-first census has been
rerun against the then-current kernel sources.
