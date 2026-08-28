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
| Membership-churn blast radius | [`auth-invalidation-v1-receipt.json`](./auth-invalidation-v1-receipt.json) records every delivered production transition from three real `gameMembers` events across three unrelated auth-scoped queries. Each of the nine records carries the production scope/revision/composite witness, disposition and executed-mutation reason, snapshot commit and row count, exact ACK outcome, proof path, and fresh-full-query/full-authorization result. The Rust harness additionally emits a raw replay bundle for every transition: exact scope and issuer, principal and incarnation, authority instance, the six-field production Contract artifact namespace and activation hash, predecessor snapshot, obligation, replacement snapshot, resolution, and server ACK request/connection/output. The composed runner executes each bundle through its own origin-, principal-, and artifact-scoped production Contract store and normalizes nondeterministic identifiers only after successful replay. [`auth-invalidation-v1-composed-receipt.json`](./auth-invalidation-v1-composed-receipt.json) reports nine complete exact-scope lifecycles, 7,119 retained-payload bytes before and during quarantine, zero bytes deleted, zero delete tombstones, nine quarantine fences, and nine per-principal queue suspension/release cycles. The four-byte reduction in each affected replay is the measured consequence of LLP 0148's canonical prefixed subscription IDs replacing the prior spelling; the quarantine behavior and counts are unchanged. |
| Client-store quarantine and queue behavior | `tests/acceptance/auth-invalidation-v1-report.mjs` imports the production `client-store.mjs` and measures the transitions directly. The standalone visibility fixture records the hidden boundary at store transition 1 and restoration at transition 4, after snapshot resolution, lease-request reservation, and fresh authorized snapshot commit. It records 747 payload bytes preserved during quarantine; 740 and 741 bytes deleted by lease expiry and clock rollback; and two durable delete tombstones. The membership workload separately creates one principal-owned mutation queue for each exact production query scope, preserves two queued mutations through its quarantine, and releases that queue only after the same exact root resolves. It deliberately aggregates nine isolated scope replays rather than placing Alice, Bob, and Carol roots in one cross-principal queue. Its traffic ledger includes the executed server's 12 generated/9 delivered/3 discarded obligation-backed invalidation frames and snapshots, three response-loss reprojections, nine server ACKs, and nine applications of each client query/queue lifecycle phase. These are composed runtime measurements, not copied assertions from another test file. |
| Protected-query admission | `protected_query_profile_v1::{protected_hostplan_walk_is_recursive_and_typed, protected_ibex_uses_a_fresh_module_graph_every_time, protected_runtime_gate_catches_dynamic_clock_and_id_aliases}` and `retainability_profile_v1` own the closed-profile and retainability matrix. |
| Ephemeral room kick | `local::auth_room_kick_acceptance` composes the durable membership commit with room dependency tickets, generation fences, sink refusal, fresh authorization, lost response, and process-loss recovery. The construction→enqueue race has its own one-shot, per-backend pause test and receipt; the existing real enqueue→drain and drain→send schedules emit two more receipts; and the integrated kick receipt owns lookup/mutation, registration/snapshot, affected-room targeting, unrelated-room progress, and post-kick leakage checks. The composed runner executes all four receipts and checks their schedule-specific observations explicitly instead of aliasing one predicate across pause points. |
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

The composed receipt embeds the executed Rust receipt as
`productionRustReceipts.server`, including that focused harness's honest
`coverageBoundaries`. It then closes those boundaries in a separate layer:

- hidden-view and recovery values use **committed client-store transitions** as
  their unit. They are deterministic protocol intervals, not wall-clock latency
  or an availability bound;
- the standalone client measurement consumes the executed Rust sample's
  authorization epoch and minimum commit-version floor (`8` and `11` in the
  committed deterministic receipt). For the membership measurement, Rust emits
  all nine raw per-event bundles at epochs `6`, `7`, and `8`; the runner executes
  the exact principal scope, authority descriptor, all six production Contract
  artifact-scope fields (`appId`, `targetProfileId`, `schemaHash`, `inputsHash`,
  `databaseId`, and `versionStreamId`), activation hash, predecessor snapshot,
  obligation, replacement snapshot, resolution, and ACK through a correctly
  scoped Contract store. Nondeterministic identifiers are normalized only in
  the stable output after exact execution and equality checks;
- retained-byte counts are UTF-8 bytes of the JSON-serialized physical retained
  payload records. Metadata and JavaScript heap overhead are deliberately not
  called retained payload;
- the Rust overflow and protected-room tests emit JSON receipts only after their
  production assertions pass. The runner executes the tests and parses the
  integrated room receipt plus the distinct construction→enqueue,
  enqueue→drain, and drain→send receipts; it does not infer success from a
  filename or source string or reuse one boolean for multiple schedules;
- the shared property corpus records the 36 concrete inputs produced with seed
  `0x53a11ce`: three shuffled passes over the frozen event universe plus clock
  rollback — randomized
  writes, deployment activation, expiry, overflow, disconnect, response loss,
  ACK loss, restart, stale callbacks, shared-store peer writes, and disposition
  escalation. Rust consumes those exact cases, builds fresh production Ibex
  state for all 36 cases, executes 39 production fresh-query comparisons and
  three production mutations, and emits the resulting row IDs. JavaScript
  independently regenerates and checks the schedule, source rows, revisions,
  write kinds, and full-query/full-authorization model. Client protocol
  snapshots receive only the Rust-produced rows, never oracle-produced rows,
  before the 36 visible-row comparisons. Every case emits its proof path,
  normalized composite witness, exact or explicitly non-applicable
  scope/revision source, disposition and reason, expected row IDs, production
  row IDs, and path-specific observations; and
- protected-room pause-point acceptance remains a supplemental production
  receipt, composed from those distinct schedules, rather than being mislabeled
  as a member of the randomized closed event universe.

`scripts/verify-local-proof` runs the composed report immediately after
`cargo test`, before CI may clean the test profile. The report must compare
deeply equal to the committed receipt. No claim is made that finite randomized
observations prove arbitrary application authorization declarations true; that
remains the RFC's stated oracle limit.
