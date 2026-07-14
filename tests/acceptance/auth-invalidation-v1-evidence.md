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
| Matcher/full-requery convergence | Both focused tests compare every delivered client row set with an independently executed full Ibex query after each shape transition and after every one of the 24 seeded randomized operations. The randomized receipt records 24 all-query convergence rounds and 72 individual fresh-query comparisons. DK-3 add/update/remove equivalence remains pinned by `live_delta_v0::deltas_applied_clientside_converge_with_a_fresh_query`; point-read and missing-row fallback remain in `local_v0`. |
| Lost response/ACK and disposition escalation | The randomized corpus parses each destructive drain before discarding it, explicitly reprojects the level-triggered obligation, and exact-ACKs only delivered resolutions. It also races an outstanding quarantine with a host-branded denial and derives the delivered terminal `delete` disposition from the replacement obligation. `local::tests::auth_scoped_removal_is_atomic_obligation_and_exact_ack`, `overflow_root_waits_for_every_auth_scoped_child`, and `only_host_branded_permission_denial_issues_terminal_delete` retain the narrower protocol proofs. |
| Ordinary restart | The randomized corpus reopens its file-backed database, observes that the durable authorization incarnation is preserved, installs a different issuer, subscribes with a caller-supplied query instance distinct from the pre-restart fixtures, and verifies that the returned initial snapshot converges with a fresh full query. It does not claim to introspect the durable query-instance allocator. Durable issuer/retry details remain pinned by `storage::auth_invalidation::tests::boot_sequence_is_consumed_before_restart_and_names_current_incarnation` and `retry_attempt_and_deadline_survive_restart_and_counter_repair`. |
| Membership-churn blast radius | [`auth-invalidation-v1-receipt.json`](./auth-invalidation-v1-receipt.json) is compared value-for-value with runtime measurements from three real `gameMembers` events and three unrelated auth-scoped queries. One scheduled loss round discards three connection drains containing six invalidation frames and three snapshots; recovery generates three replacement snapshots. Membership churn therefore generates 12 snapshots, delivers 9, and discards 3. Six randomized loss rounds discard 12 response drains and 12 snapshots; randomized writes therefore generate 60 snapshots, deliver 48, and discard 12. The receipt also derives ACK, disposition, epoch, convergence, and restart assertions from live state. |
| Client-store quarantine and queue behavior | The receipt labels these as `independentFixtureAssertions`, not Rust-harness measurements. `packages/snapback-contract/authorized-retained-store.test.mjs` independently asserts that an authorized read returns `null` during quarantine while the physical row `[{ card: 'ace-updated' }]` remains stored. `packages/snapback-contract/client-store-queue-authorization.test.mjs` independently asserts that the queue remains suspended after one of two roots resolves and that both pending IDs remain after both roots resolve. |
| Protected-query admission | `protected_query_profile_v1::{protected_hostplan_walk_is_recursive_and_typed, protected_ibex_uses_a_fresh_module_graph_every_time, protected_runtime_gate_catches_dynamic_clock_and_id_aliases}` and `retainability_profile_v1` own the closed-profile and retainability matrix. |
| Ephemeral room kick | `local::auth_room_kick_acceptance` composes the durable membership commit with room dependency tickets, generation fences, sink refusal, fresh authorization, lost response, and process-loss recovery. Lower-level exact barrier schedules remain in `ephemeral::tests`. |
| Lease/offline expiry | The AuthorizedLease exact-binding, head-race, rollback, and restart evidence remains in `auth::lease::tests`, `storage::authorized_lease::tests`, and the item-8 client-store acceptance. This focused online corpus does not duplicate the signed-lease implementation. |

## Receipt interpretation

`runtimeMeasurements` contains values read from the Rust harness execution.
Generated traffic includes the initially drained production frames plus frames
returned by an explicit level-triggered reprojection. Delivered traffic is the
subset processed by the harness and eligible for ACK; discarded traffic is
parsed and counted before the fault schedule drops it. Reprojected traffic is a
subset of generated traffic. Membership invalidations include hint-only frames,
so its invalidation-frame count is intentionally larger than its snapshot-frame
count.

`maxExplicitReprojectionCallsPerQuerySettlement = 1` counts the direct
projection call executed after a scheduled loss. It is neither a wall-clock
recovery measurement nor a bound on client-visible hidden time. Likewise, the
per-query settlement maxima are counts of frames generated and delivered by
this deterministic schedule, not a general latency claim.

The production obligation sample derives its composite witness, scope kind,
revision, and disposition from a delivered server frame. Its
`normalizedFieldSources` map identifies each source path, while
`identifierNormalizations` records the two nondeterministic witness identifiers
replaced with stable placeholders. The numeric witness values and other sample
values are copied unchanged. The
`enumerated-permission-write` and `matcher-full-requery` labels are explicitly
`harnessExpectedAssertions`; the production frame does not report either
classification path. Their bases are the measured authorization-epoch deltas
and fresh-full-query convergence checks.

## Deliberate coverage boundaries

This Rust harness does not measure client-visible timing, durable byte counts,
or tombstone writes. It also does not turn assertions from the two independent
JavaScript fixtures into composed runtime measurements. Those limits are
machine-readable in `coverageBoundaries`.

The randomized focused corpus covers row writes, permission-backed membership
events, cross-authority writers, destructive response loss, exact ACK,
restart/fresh snapshot, and monotone disposition escalation. Deployment
activation, lease expiry/clock rollback, queue overflow, multi-tab durable
store CAS, million-key retirement, and every room pause point are mapped to
their specialized exact tests above rather than weakly re-created here. No
claim is made that finite randomized observations prove arbitrary application
authorization declarations true; that remains the RFC's stated oracle limit.
