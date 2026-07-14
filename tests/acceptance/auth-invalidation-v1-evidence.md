# LLP 0053 implementation acceptance evidence

This map records executable implementation evidence for the accepted
authorization-invalidation contract. It does not amend or reinterpret the
frozen RFC. The focused corpus added here composes production `LocalSnapback`,
Ibex query capture, the matcher, session-mode invalidation projections, and
exact acknowledgements; it is not a standalone authorization model.

| LLP 0053 acceptance surface | Executable evidence |
|---|---|
| Mine-OR-public, including `public → private` without an epoch | `local::authorization_acceptance::named_shapes_and_matcher_deliveries_converge_with_full_requery` proves the ordinary docs commit leaves the authorization epoch unchanged, delivers an obligation-backed replacement, removes the row, and matches a fresh full query. |
| Roster table as both ACL and result | The same test makes `gameMembers` both a returned roster and `permissionBacking`; a kick advances one epoch, removes the kicked member from the survivor's roster, and leaves the kicked member's roster empty. |
| Hierarchy reparent in both directions | The same test joins `docs`, `folders`, and `orgMembers`, then proves visible→hidden and hidden→visible delivery for opposite org subscribers against fresh queries. |
| Mixed `permissionFields` | `local::authorization_acceptance::permission_fields_churn_and_randomized_oracle_emit_the_committed_receipt` drives production HostPlan writes and proves avatar-disjoint update = no event while role, insert, and delete each advance the epoch. Unknown/empty/reconstructed update metadata is already pinned at the classification boundary by `storage::authorization::tests::permission_fields_suppress_only_known_nonempty_disjoint_updates` and `storage::authorization::tests::absent_and_empty_changed_field_metadata_are_unknown`. |
| Matcher/full-requery convergence | Both focused tests compare every delivered client row set with an independently executed full Ibex query after each shape transition and after every randomized operation. DK-3 add/update/remove equivalence remains pinned by `live_delta_v0::deltas_applied_clientside_converge_with_a_fresh_query`; point-read and missing-row fallback remain in `local_v0`. |
| Lost response/ACK and disposition escalation | The randomized corpus discards destructive drain responses on a fixed schedule, reprojects the level-triggered obligation, and exact-ACKs it. It also races an outstanding quarantine with a host-branded denial and observes the current `delete` projection. `local::tests::auth_scoped_removal_is_atomic_obligation_and_exact_ack`, `overflow_root_waits_for_every_auth_scoped_child`, and `only_host_branded_permission_denial_issues_terminal_delete` retain the narrower protocol proofs. |
| Ordinary restart | The randomized corpus reopens its file-backed database, verifies the durable authorization incarnation is preserved, installs a new issuer, allocates a new query instance, and accepts only the new full snapshot. Durable issuer/retry details remain pinned by `storage::auth_invalidation::tests::boot_sequence_is_consumed_before_restart_and_names_current_incarnation` and `retry_attempt_and_deadline_survive_restart_and_counter_repair`. |
| Membership-churn blast radius | [`auth-invalidation-v1-receipt.json`](./auth-invalidation-v1-receipt.json) is compared value-for-value with a receipt built from three real `gameMembers` events (two joins and a kick), three unrelated auth-scoped queries, one lost membership response, six randomized loss episodes, and 24 seeded randomized row operations. The retained-payload and two-pending-mutation measurements compose the exact production-store fixtures in `authorized-retained-store.test.mjs` and `client-store-queue-authorization.test.mjs`. The receipt records hidden-view/recovery delivery turns, resnapshot/ACK traffic, deletion/tombstone/pending-mutation outcomes, proof path, composite witness, scope/revision, disposition, and selection reason. |
| Protected-query admission | `protected_query_profile_v1::{protected_hostplan_walk_is_recursive_and_typed, protected_ibex_uses_a_fresh_module_graph_every_time, protected_runtime_gate_catches_dynamic_clock_and_id_aliases}` and `retainability_profile_v1` own the closed-profile and retainability matrix. |
| Ephemeral room kick | `local::auth_room_kick_acceptance` composes the durable membership commit with room dependency tickets, generation fences, sink refusal, fresh authorization, lost response, and process-loss recovery. Lower-level exact barrier schedules remain in `ephemeral::tests`. |
| Lease/offline expiry | The AuthorizedLease exact-binding, head-race, rollback, and restart evidence remains in `auth::lease::tests`, `storage::authorized_lease::tests`, and the item-8 client-store acceptance. This focused online corpus does not duplicate the signed-lease implementation. |

## Receipt interpretation

The receipt uses deterministic protocol intervals instead of pretending that
an in-process harness measured network milliseconds. `maxHiddenViewTime = 1`
records the real client-visible interval from the synchronous quarantine
boundary to the replacement snapshot boundary; it deliberately does not turn
that interval into an invented wall-clock duration. `maxRecoveryTime = 1`
means a destructively lost response recovers on the next level-triggered
projection turn. The zero deletion metrics are scoped to unrelated
**quarantine** events: the observed disposition never instructs a delete,
pending work is suspended, and the terminal-denial case is reported separately
as `delete`.

## Deliberate coverage boundaries

The randomized focused corpus covers row writes, permission-backed membership
events, cross-authority writers, destructive response loss, exact ACK,
restart/fresh snapshot, and monotone disposition escalation. Deployment
activation, lease expiry/clock rollback, queue overflow, multi-tab durable
store CAS, million-key retirement, and every room pause point are mapped to
their specialized exact tests above rather than weakly re-created here. No
claim is made that finite randomized observations prove arbitrary application
authorization declarations true; that remains the RFC's stated oracle limit.
