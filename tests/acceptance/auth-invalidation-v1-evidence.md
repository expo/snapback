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
| Membership-churn blast radius | [`auth-invalidation-v1-receipt.json`](./auth-invalidation-v1-receipt.json) remains the Rust server receipt and is compared value-for-value with measurements from three real `gameMembers` events and three unrelated auth-scoped queries. The composed runner consumes that machine-readable receipt, then drives three production Contract retained-query fences and two queued mutations. [`auth-invalidation-v1-composed-receipt.json`](./auth-invalidation-v1-composed-receipt.json) reports 2,075 retained-payload bytes before and during coarse quarantine, zero deleted by quarantine, three durable quarantine-fence writes, and two suspended mutations. |
| Client-store quarantine and queue behavior | `tests/acceptance/auth-invalidation-v1-report.mjs` imports the production `client-store.mjs` and measures the transitions directly. The committed receipt records the hidden boundary at store transition 1 and visibility restoration at transition 4, after snapshot resolution, lease-request reservation, and fresh authorized snapshot commit. It records 658 payload bytes preserved during quarantine; 651 and 652 bytes deleted by lease expiry and clock rollback; two durable delete tombstones; two mutations suspended while any of three roots remains; and two pending mutations converted to redacted discard-only custody and then deleted. These are composed runtime measurements, not copied assertions from another test file. |
| Protected-query admission | `protected_query_profile_v1::{protected_hostplan_walk_is_recursive_and_typed, protected_ibex_uses_a_fresh_module_graph_every_time, protected_runtime_gate_catches_dynamic_clock_and_id_aliases}` and `retainability_profile_v1` own the closed-profile and retainability matrix. |
| Ephemeral room kick | `local::auth_room_kick_acceptance` composes the durable membership commit with room dependency tickets, generation fences, sink refusal, fresh authorization, lost response, and process-loss recovery. Its machine-readable receipt records all five acceptance pause points, affected-room targeting, simultaneous unrelated-room registration/publish/drain, and zero post-kick durable-board/opponent-presence leakage. The composed runner executes and consumes that receipt. |
| Lease/offline expiry | The signed-lease binding and head-race corpus remains in `auth::lease::tests` and `storage::authorized_lease::tests`. The composed runner adds the client half mechanically: equality expiry and backward-clock detection each delete the exact retained payload before returning the diagnostic, advance the durable query generation, and leave a `delete` fence. |

## Receipt interpretation

`runtimeMeasurements` in the server receipt contains values read from the Rust
harness execution.
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

The composed receipt preserves the Rust receipt unchanged as
`productionRustReceipts.server`, including that focused harness's honest
`coverageBoundaries`. It then closes those boundaries in a separate layer:

- hidden-view and recovery values use **committed client-store transitions** as
  their unit. They are deterministic protocol intervals, not wall-clock latency
  or an availability bound;
- the client measurements consume the executed Rust sample's authorization
  epoch and minimum commit-version floor (`8` and `11` in the committed
  deterministic receipt), while substituting only structurally valid local
  values for the Rust receipt's deliberately normalized incarnation/stream
  identifiers;
- retained-byte counts are UTF-8 bytes of the JSON-serialized physical retained
  payload records. Metadata and JavaScript heap overhead are deliberately not
  called retained payload;
- the Rust overflow and protected-room tests emit JSON receipts only after their
  production assertions pass. The runner executes the tests and parses those
  values; it does not infer success from a filename or source string; and
- the 13-row property-oracle matrix is built from observed values for randomized
  writes, deployment identity change, expiry, rollback, overflow, disconnect,
  response loss, ACK loss, restart, stale callbacks, shared-store peer writes,
  disposition escalation, and all room pause points.

`scripts/verify-local-proof` runs the composed report immediately after
`cargo test`, before CI may clean the test profile. The report must compare
deeply equal to the committed receipt. No claim is made that finite randomized
observations prove arbitrary application authorization declarations true; that
remains the RFC's stated oracle limit.
