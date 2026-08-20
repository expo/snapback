# LLP 0285 step-1 behavioral evidence freeze

This file freezes the behavior that LLP 0285 §6 steps 2–4 must preserve. It is
evidence for the reachability migration only; it is not evidence that F-1 or
the forgery half of the authorization model is closed.

The baseline is commit `7f4f2de6d98b2394c1659218cd2eeb2d2298fef1` on
`lane/f1-reach`, captured on 2026-08-19. Paths and test names are normative;
line numbers below are navigation aids. SHA-256 values let a later checkpoint
distinguish an intentional relocation from an unnoticed behavioral rewrite.

## Recheck commands

```sh
find schemas -type f -print0 \
  | LC_ALL=C sort -z \
  | xargs -0 shasum -a 256 \
  | shasum -a 256

shasum -a 256 \
  crates/snapback-kernel/src/storage.rs \
  crates/snapback-kernel/src/storage/auth.rs \
  crates/snapback-kernel/src/storage/auth_mode.rs \
  crates/snapback-kernel/src/storage/tests.rs \
  crates/snapback-kernel/src/storage/pending_effects.rs \
  crates/snapback-auth/src/auth/service_fence.rs \
  crates/snapback-engine/src/push/authority_tests.rs \
  crates/snapback-sync/src/ephemeral.rs \
  crates/snapback-engine/src/local/auth_room_kick_acceptance.rs \
  crates/snapback-kernel/src/push.rs \
  crates/snapback-kernel/src/proof_checkpoint.rs \
  crates/snapback-server/src/admin.rs
```

The schema tree contains 295 regular files. Its aggregate digest is:

```text
b628053641293a9a8c2e7863c9d20d62ff2769dccbfffda98459b3a053ac9a83
```

## Authority and fence test inventory

The inventory is intentionally by semantic test name, not by a scalar count.
Renames or moves must retain a one-to-one disposition.

### Kernel authority root and authorization-commit interlock

- `storage::tests::one_live_authority_lease_covers_every_open_of_the_same_file`
- `storage::tests::llp0162_sqlite_writer_authority_denies_bypass_and_projects_effective_gaps`
- `storage::tests::llp0165_registered_second_writer_uses_connection_local_defensive_authority`
- `storage::tests::llp0162_writer_authority_rearms_from_durable_manifest_on_reopen`
- `storage::tests::llp0162_writer_authority_installs_only_at_the_active_coverage_cut`
- `storage::auth::tests::service_rollback_uncertainty_carries_the_exact_planned_terminal`
- `storage::auth::tests::declared_restore_installs_and_settles_authorization_interlock`
- `storage::auth::tests::declared_restore_purges_every_v2_agent_authority_class`
- `storage::auth::tests::destructive_restore_reconciles_lost_ack_and_definite_rollback`
- `storage::auth_mode::tests::repeated_same_mode_permission_seed_uses_auth_marker_to_prove_rollback`

### Service-authority fence state machine

All tests remain owned by `crates/snapback-auth/src/auth/service_fence.rs` in
steps 1–4:

- `rollback_reopens_but_commit_and_ambiguity_never_do`
- `ambiguous_reconciliation_settles_only_its_exact_token_domain`
- `committed_terminal_precedes_a_later_pending_ticket`
- `nested_local_validation_reuses_the_outer_connection_act_witness`
- `clock_rollback_and_expiry_fail_closed`
- `retained_publication_always_samples_its_provider_clock_domain`
- `grant_deadline_is_durable_while_token_deadline_is_carrier`
- `delayed_monotonic_observer_spends_the_original_terminal_close_budget`
- `canonical_route_by_terminal_ending_pause_matrix_fails_closed`
- `terminal_gate_closes_new_effects_then_drains_predecessor_initiation`
- `retained_authority_work_and_terminal_gate_are_mutually_exclusive`
- `direct_terminal_prepare_refuses_an_active_publication_without_waiting_on_its_fence`
- `exact_token_gate_drains_only_its_token_and_leaves_unrelated_work_live`
- `absent_token_registration_joins_the_pending_exact_domain`
- `overlapping_gates_serialize_while_disjoint_gates_proceed`
- `committed_gate_stays_exactly_pending_through_after_local_lifecycle`
- `transaction_must_reproduce_the_gate_exact_token_set`
- `cancelling_terminal_gate_drain_reopens_the_service_domain`
- `retained_service_work_counter_is_bounded_and_releases_on_error_unwind`

### Authorization-room fence and composed kick behavior

The room mechanism remains in `snapback-sync` during steps 1–4. These named
tests pin prepare/bind/settle, exact-ticket, ambiguity, and composed engine
behavior:

- `ephemeral::tests::protected_registration_is_closed_by_the_exact_pending_ticket`
- `ephemeral::tests::authorization_neutral_preflight_never_touches_the_room_registry`
- `ephemeral::tests::authorization_neutral_preview_drift_is_an_exact_retryable_conflict`
- `ephemeral::tests::bound_definite_rollback_is_deferred_but_ambiguous_commit_stays_pending`
- `ephemeral::tests::issuer_projection_precedes_room_settlement_and_advances_the_projected_issuer`
- `ephemeral::tests::projection_panic_drops_settlement_and_keeps_protected_rooms_closed`
- `ephemeral::tests::durable_authorization_ticket_retains_scoped_frames_but_not_independent_traffic`
- `ephemeral::tests::public_unfenced_drain_cannot_extract_authorized_durable_data`
- `ephemeral::tests::committed_authorization_event_drops_old_frames_and_refires_auth_changed`
- `ephemeral::tests::ambiguous_authorization_commit_leaves_every_protected_act_pending`
- `local::auth_room_kick_acceptance::frame_construction_before_first_enqueue_is_commit_ordered`
- `local::auth_room_kick_acceptance::card_game_kick_composes_durable_and_room_authority_boundaries`
- `local::auth_room_kick_acceptance::process_loss_before_room_ack_forces_fresh_membership_authorization`
- `local::auth_room_kick_acceptance::lost_commit_ack_proves_successor_and_finalizes_the_exact_room_ticket`
- `local::auth_room_kick_acceptance::commit_error_with_durable_rollback_removes_only_its_exact_room_ticket`

### Push authority behavior

`crates/snapback-engine/src/push/authority_tests.rs` is separately owned and
must remain byte-identical in this lane:

- `ledger_projection_is_authorized_and_never_releases_payload_or_token_bytes`
- `fake_expo_acceptance_covers_tickets_receipts_dedupe_ambiguity_and_authorization`
- `deferred_grant_binds_request_and_revalidates_producer_membership`
- `explicit_principals_and_membership_authorize_consume_their_declared_argument_union`

### Pending effects

- `storage::pending_effects::tests::disclosed_intent_is_bounded_and_journals_approve_execute`
- `storage::pending_effects::tests::approver_deny_and_lazy_expiry_are_closed_transitions`
- `storage::pending_effects::tests::exact_catalog_rejects_unrecognized_shape`

## Protected-erasure receipt fixtures

The four generated wire/receipt fixtures and their baseline hashes are:

| Fixture | SHA-256 |
|---|---|
| `schemas/checkpoint.protected-record-erasure-receipt-v1.schema.json` | `11446416e0f48871d39412a1b6c3ec95d500497eea246ef71011539aa61fbbee` |
| `schemas/protected-record-erasure.authority-facts-v1.schema.json` | `c8ae54adc1eb1702d4b6fc92cf8ccba38b6b59d90b0d0a8b55aee71020aa7a83` |
| `schemas/protected-record-erasure.receipt-v1.schema.json` | `981bf12a1cd1ce239ae32875a19769a439ee7d06c3e4a55011857a3eb2cedbb5` |
| `schemas/protected-record-erasure.request-v1.schema.json` | `fb723534f46ee1473a9f735c27562f4552ddf0fee139024a18f9eb0b461c3b61` |

The executable receipt fixtures are:

- `proof_checkpoint::tests::protected_record_erasure_enumerates_all_copies_and_closes_obligations`
- `proof_checkpoint::tests::protected_record_erasure_crash_reopens_with_registry_obligation`
- `proof_checkpoint::tests::authenticated_protected_erasure_is_atomic_retry_bound_and_inventory_complete`
- `proof_checkpoint::tests::concurrent_protected_erasure_exact_and_divergent_retries_serialize`
- `proof_checkpoint::tests::protected_erasure_crash_cuts_reopen_to_none_or_resumable_completion`
- `proof_checkpoint::tests::checkpoint_pin_and_publication_cannot_cross_protected_erasure`
- `proof_checkpoint::tests::erasure_after_checkpoint_intent_waits_for_creator_cancellation_ack`
- `proof_checkpoint::tests::crashed_checkpoint_producers_require_recovery_ack_before_erasure_closes`
- `admin::tests::protected_erasure_transport_refuses_unauthorized_and_wire_authority_inputs`

Together they pin: authority/operation retry binding; exactly one payload-free
delete tombstone; complete checkpoint inventory; unreachable-copy obligations;
exact and divergent concurrency; pre-commit rollback; post-commit resumability;
checkpoint publication fencing; forged wire-authority refusal; and a complete
HTTP receipt with an empty canonical result afterward.

## Push SQL trace

This is the ordered `reserve_send_in` trace in
`crates/snapback-kernel/src/push.rs`. The trace describes the existing branches;
it does not authorize adding another read shape.

1. Admission/resolve: optional membership `SELECT EXISTS(...)` for authorize,
   then the existing resolver query. No SQL is issued for an explicit-principal
   resolver.
2. For each resolved principal, read live tokens:

   ```sql
   SELECT id, token_bytes, token_hash FROM _snapback_push_tokens_v1
   WHERE app_scope = ?1 AND principal_id = ?2 AND retired_at_ms IS NULL
   ORDER BY id
   ```

3. Read a dedupe predecessor:

   ```sql
   SELECT id, binding_hash, attempt_count, state
   FROM _snapback_push_intents_v1
   WHERE app_scope = ?1 AND dedupe_key = ?2
   ```

4. New intent: `INSERT` one `_snapback_push_intents_v1` row, then for each
   chunk `INSERT` one `_snapback_push_batches_v1` row and one
   `_snapback_push_messages_v1` row per token.
5. Exact duplicate: run the existing nested count projection. Its existing
   messages-to-batches `JOIN` is part of the frozen shape; steps 1–4 add no
   join and do not change it.
6. Explicit ambiguous redrive: conditional `UPDATE` of the intent, followed by
   the same batch/message insert sequence with `previous_ambiguous = 1`.

The full push source baseline is
`a8c8baa1faab09629ba34e500c154a19dc0a4f9be83d15729430e99388d775f9`.

## Pending-effect SQL trace

The canonical record projection is the 23-column single-table `SELECT` in
`read_record`; it has no join. The ordered transition traces are:

- Create: one `INSERT INTO _snapback_pending_effects(...)`, commit, then the
  canonical `read_record` projection.
- Decide: `lazy_expire` (`SELECT id`, conditional expiry `UPDATE`, journal
  `SELECT` + journal `UPDATE`), canonical `read_record` inside the transaction,
  conditional decision `UPDATE`, journal `SELECT` + journal `UPDATE`, commit,
  then canonical `read_record`.
- Settle: conditional settlement `UPDATE`, journal `SELECT` + journal `UPDATE`,
  commit, then canonical `read_record`.
- Refuse: conditional refusal `UPDATE`; when changed, journal `SELECT` + journal
  `UPDATE`; then commit.
- Approver listing: `lazy_expire`, then one ordered single-table `SELECT id`,
  followed by canonical `read_record` once per id.

No path above contains a join. The full pending-effect source baseline is
`e49a2bdc25907a63d61cf1eb40b712e8285f6d37270ef82f3b6c2f6c93861cb6`.

## Source-file digests

```text
2d7c3f52c28b9a6a0c76641f5494bbeed629fec739c0467149f55318908380bf  crates/snapback-kernel/src/storage.rs
326277b6aa23ea38680115cda16b0faa9a09ecb68b703b9840918f7949efa8d8  crates/snapback-kernel/src/storage/auth.rs
6d896a33fb468da37a891661c5028cc872d3de68a6278471a180ad347477a133  crates/snapback-kernel/src/storage/auth_mode.rs
e68dbfec382669d0725c5e8299968e3c0c3f5ececd17f37ec97252bcbb80136d  crates/snapback-kernel/src/storage/tests.rs
e49a2bdc25907a63d61cf1eb40b712e8285f6d37270ef82f3b6c2f6c93861cb6  crates/snapback-kernel/src/storage/pending_effects.rs
1b27f4114ab1d81103643f18adc7d0979a02fc8732a98fcb95c127cd275ba834  crates/snapback-auth/src/auth/service_fence.rs
5866c608ed6909c257bf69b090c52b5aa7c6b419434947e9ea42bef7f4b93425  crates/snapback-engine/src/push/authority_tests.rs
39871944e5b15e1d9dbd028d6566c78e1281b7515a7c45913c10def103a922b4  crates/snapback-sync/src/ephemeral.rs
88f94fee2e75a514356ee34f89f2a4937d1bb02510268531bf8b13f815c62b19  crates/snapback-engine/src/local/auth_room_kick_acceptance.rs
a8c8baa1faab09629ba34e500c154a19dc0a4f9be83d15729430e99388d775f9  crates/snapback-kernel/src/push.rs
057e087376766e5a58aed00101b2a1cffd77d8bbb7d466db6537a9df1083b9ea  crates/snapback-kernel/src/proof_checkpoint.rs
ec6d2610cfbcbcf7e29876b73ffddff09614e7864bd638d4c71c9f776fae3950  crates/snapback-server/src/admin.rs
```
