# Fork identity primitive census

Status: open
Date: 2026-08-26
Systems: snapback-auth, snapback-engine, snapback-kernel, snapback-server,
  snapback-services, snapback-sync
Related: llp/0303-subject-authority-correlation-policy.decision.md,
  issues/20260826-allocation-identity-fails-open-across-fork.md

## Method and verdict vocabulary

This is a producer-and-consumer census, not a caller census. It starts from every inline
`Arc::ptr_eq` under `crates/`, identifies the allocation producer, and identifies the protected or
bookkeeping effect that consumes the result. The source census includes default production code,
additive `test-support`, and unit-only `cfg(test)` code. The F126 runtime witness separately mounts
both the empty production feature cell and the additive union of auth, engine, kernel, sync, and
types `test-support`.

After the storage-only conversions in this lane,
`rg -n 'Arc::ptr_eq' crates --glob '*.rs' --glob '!**/process_bound_identity.rs'` returns 48
remaining sites. The same command without the exclusion returns 49 because it also counts the
checked primitive's internal pointer comparison:

- **FO-auth**: the comparison guards authorization or exact capability/effect custody and accepts
  an inherited parent allocation in a forked child. It must migrate to the checked primitive.
- **Fork-blind/bookkeeping**: the raw predicate has the same pointer result after fork, but its
  consumer is process-local cleanup or bookkeeping rather than an authorization decision.
- **Test-only**: no product decision; the comparison cleans up a test probe or asserts topology.
- **Intrinsically checked**: the inline pointer comparison is short-circuit dominated by a checked
  `DatabaseBinding`, or is inside the primitive after both operands have been checked against the
  recomputed current-process identity.

The 48 remaining sites are 30 **FO-auth**, four production **fork-blind/bookkeeping**, thirteen
**test-only**, and one **intrinsically checked** storage site. The primitive contributes the 49th
inline occurrence, which is also intrinsically checked. A deeper independent fence may refuse some
child operations, but that does not change the local verdict: the listed raw exact-owner predicate
itself accepts inherited allocations.

## Remaining production authorization and custody sites

| Site | Producer | Consumer/effect | Verdict |
| --- | --- | --- | --- |
| `snapback-auth/src/auth/admission.rs:188` | `AdmissionController::lease_origin` clones its `AdmissionInner` | `AdmissionLeaseOrigin::eq` correlates an origin with its controller graph | **FO-auth** |
| `snapback-auth/src/auth/admission.rs:189` | `lease_origin` mints the subject `Arc<()>` | The same equality correlates the exact resolved subject | **FO-auth** |
| `snapback-auth/src/auth/admission.rs:227` | admission mints `AdmissionLeaseToken.controller` | `AdmissionLeaseOrigin::owns` admits a lease only from the origin controller | **FO-auth** |
| `snapback-auth/src/auth/admission.rs:233` | `lease_origin` mints and the first claim stores `authority` | `owns` accepts subsequent lease clones for the sealed subject | **FO-auth** |
| `snapback-auth/src/auth/admission.rs:307` | `AdmissionController` owns `inner`; admission copies it into the token | `AdmissionController::owns_lease` proves exact controller ownership | **FO-auth** |
| `snapback-auth/src/auth/invalidation.rs:193` | `LiveInvalidationIssuer::new` allocates `InvalidationIssuerState` and reservations retain it | Connection equality includes issuer provenance used by invalidation consumers | **FO-auth** |
| `snapback-auth/src/auth/invalidation.rs:375` | `InstalledInvalidationIssuer` and its reserved connection share issuer state | `InstalledInvalidationIssuer::owns` authorizes the connection as this issuer's | **FO-auth** |
| `snapback-kernel/src/auth/service_fence.rs:200` | a database creates one `ServiceAuthorityFenceRegistry.state` | `is_same_registry` correlates database-owned service-authority registries | **FO-auth** |
| `snapback-kernel/src/auth/service_fence.rs:713` | terminal preparation retains the registry state | `ServiceAuthorityTerminalGate::matches` permits the exact terminal transaction | **FO-auth** |
| `snapback-kernel/src/storage/room_authority.rs:189` | the database creates `RoomAuthorityRegistry`; an issuer projection retains it | `require_projection_identity` admits the projection for authorization commit finalization | **FO-auth** |
| `snapback-kernel/src/storage/room_authority.rs:680` | `begin_protected_room_act` puts its registry into the permit | `validate_admitted_room_act` authorizes a protected room operation | **FO-auth** |
| `snapback-kernel/src/storage/room_authority.rs:1191` | authorization preflight retains the registry in its reservation | transaction `bind` accepts the reservation against the ready registry | **FO-auth** |
| `snapback-kernel/src/storage/room_authority.rs:1470` | an expectation view and issuer projection retain the registry | `AuthorizationIssuerProjection::matches_view` validates projection provenance | **FO-auth** |
| `snapback-kernel/src/storage/room_authority.rs:1472` | the view and projection retain the participant activation | the same provenance predicate validates the exact activation | **FO-auth** |
| `snapback-kernel/src/storage/room_authority.rs:1589` | a committed authorization outcome retains its registry | `project_committed` permits publication into the expectation view | **FO-auth** |
| `snapback-engine/src/local/engine.rs:3909` | `LocalSnapback` allocates the app-state graph; preclaimed bindings retain it | `into_parts_for_app_state` releases commit/admission bindings to the destination graph | **FO-auth** |
| `snapback-engine/src/local/engine.rs:7394` | engine construction mints `operator_authority_identity`; its operator carrier clones it | `validate_operator_authority` permits registered administration | **FO-auth** |
| `snapback-engine/src/local/engine.rs:8170` | the same engine/operator producer | `erase_protected_record_admitted` permits protected-record erasure | **FO-auth** |
| `snapback-engine/src/local/engine.rs:8245` | the same engine/operator producer | `activate_agent_safe_operation_coverage_admitted` permits coverage activation | **FO-auth** |
| `snapback-engine/src/local/engine.rs:9567` | the same engine/operator producer | `prepare_operator_authority` mints administrative prepared authority | **FO-auth** |
| `snapback-engine/src/local/engine.rs:13028` | engine graph preparation seals the graph in `PreparedAuthorityDescriptor` | `require_prepared_authority_descriptor_current` permits authority-backed durable effects | **FO-auth** |
| `snapback-engine/src/local/engine.rs:22844` | live-effect staging allocates `LocalLiveStageControl` and stores a weak registry handle | `claim_local_live_effect` grants finalization custody | **FO-auth** |
| `snapback-engine/src/local/engine.rs:22874` | the same staged control/weak registration pair | `complete_local_live_effect` verifies the registered stage before terminal removal | **FO-auth** |
| `snapback-engine/src/local/engine.rs:22875` | a successful claim retains the staged control | the same completion path verifies claim ownership | **FO-auth** |
| `snapback-engine/src/local/engine.rs:26387` | the engine's operator carrier retains its operator identity | `stage_config_verify` permits an owner-triggered probe and cooldown effect | **FO-auth** |
| `snapback-server/src/auth/runtime.rs:112` | `AuthRuntime::inspect` creates a provider; its construction receipt retains it | receipt `build` installs the auth coordinator for that runtime | **FO-auth** |
| `snapback-server/src/server/writer_gate.rs:427` | coordinated reset closes and retains a `ManagedLocalHandoff` | `CommittedResetHandoff::with_snapback` asserts custody before post-reset Local work | **FO-auth** (custody assertion; deeper database fences are independent) |
| `snapback-services/src/assets.rs:1059` | `AssetFinalizeOwnerBindingV1::new` allocates the Local owner identity; tickets retain clones | `belongs_to_owner`/`into_parts` release split-phase finalize capability | **FO-auth** |
| `snapback-sync/src/stream_attempt.rs:162` | `StreamRunnerHost` mints a runner and holder sharing `InvocationCommitGate` | `RunnerHolder::is_exact_runner` permits runner-bound stream transitions | **FO-auth** |
| `snapback-sync/src/stream_attempt.rs:163` | the same producer shares the runner's `finished` flag | the same transition predicate validates the second exact-runner component | **FO-auth** |

`room_authority.rs` also has two `std::ptr::eq(Arc::as_ptr(...), self)` participant-activation
comparisons (currently near lines 109 and 191). They are outside the requested inline-`Arc::ptr_eq`
count but have the same fork-blind identity property and should migrate with the six room-authority
rows above. The activation path from `storage.rs` is already dominated by the checked database
validation added in this lane; this census does not claim the two raw predicates are intrinsically
fork-safe.

## Remaining production bookkeeping sites

| Site | Producer | Consumer/effect | Authorization? / fork verdict |
| --- | --- | --- | --- |
| `snapback-server/src/server.rs:1657` | detached reservation setup stores the current cancellation signal | `clear_active_reservation` removes only that process-local slot | No authorization decision; fork-blind child-local cleanup |
| `snapback-sync/src/ephemeral.rs:1292` | one outbox drain produces a batch of leases retaining the outbox | `OutboxDrainLease::acknowledge_all` batches acknowledgements only for one outbox | No subject authorization; fork-blind process-local queue custody |
| `snapback-sync/src/ephemeral.rs:2950` | drain selection snapshots a queued message `Arc` before reacquiring it mutably | selection skips a replaced/coalesced message | No authorization; stale-snapshot bookkeeping, not a process identity claim |
| `snapback-sync/src/ephemeral.rs:6271` | bound outbox drain returns leases retaining the mapped outbox | `acknowledge_outbox_handoff_bound` destructively acknowledges only the mapped outbox | The effect fence is the authorization check; pointer guard is fork-blind child-local queue custody |

## Test-support and unit-test sites

| Site | Producer | Consumer/effect | Verdict |
| --- | --- | --- | --- |
| `snapback-kernel/src/storage/auth_grants.rs:371` | additive test-support registers a pairing-code commit probe state | registration `Drop` removes only its probe | **Test-only** cleanup |
| `snapback-kernel/src/storage/auth_grants.rs:414` | additive test-support installs the same state in a thread-local slot | scope `Drop` clears only its probe | **Test-only** cleanup |
| `snapback-server/src/server.rs:3462` | unit test installs a nested commit-order probe | probe `Drop` removes the matching map entry | **Test-only** cleanup |
| `snapback-server/src/server.rs:3622` | unit test installs a nested-latch observation | observation `Drop` removes the matching map entry | **Test-only** cleanup |
| `snapback-server/src/server.rs:3764` | unit test installs a detached nested-mutation pause | pause `Drop` removes the matching map entry | **Test-only** cleanup |
| `snapback-server/src/server.rs:3877` | unit test installs a managed nested-mutation pause | pause `Drop` removes the matching map entry | **Test-only** cleanup |
| `snapback-server/src/server.rs:4012` | unit test installs a nested effect-reservation pause | pause `Drop` removes the matching map entry | **Test-only** cleanup |
| `snapback-server/src/server.rs:4184` | unit test installs a nested after-Local pause | pause `Drop` removes the matching map entry | **Test-only** cleanup |
| `snapback-server/src/server/tests.rs:703` | an `AppState` clone retains `SharedSnapback` | assertion proves the clone kept one graph | **Test-only** topology assertion |
| `snapback-sync/src/ephemeral.rs:11816` | subscriber registration stores the mapped outbox | assertion proves hot fan-out captured that handle | **Test-only** topology assertion |
| `snapback-sync/src/stream_attempt.rs:2109` | `StreamRunnerHost` creates the runner and settlement origin together | assertion checks shared commit gate | **Test-only** topology assertion |
| `snapback-sync/src/stream_attempt.rs:2110` | the same producer | assertion checks shared finished flag | **Test-only** topology assertion |
| `snapback-sync/src/stream_attempt.rs:2111` | the host is built from the test's abandonment flag | assertion checks the flag reached the commit gate | **Test-only** topology assertion |

## Intrinsically checked sites

| Site | Producer | Consumer/effect | Verdict |
| --- | --- | --- | --- |
| `snapback-kernel/src/storage.rs:996` | commit-capsule authority creates a `DatabaseBinding` and paired intent state | `CommitCapsuleIntentInstance::matches` short-circuits through checked producer equality before comparing the paired intent allocation | **Intrinsically checked**; current-process `DatabaseBinding` refusal dominates `Arc::ptr_eq` |
| `snapback-kernel/src/process_bound_identity.rs:109` | `ProcessBoundIdentity::new` stores an allocation and private creator-process identity | its sole `PartialEq` path first compares both creators to a freshly recomputed current-process identity, then checks allocation identity | **Safe primitive**; child refusal dominates `Arc::ptr_eq` |

## Sites resolved in the kernel lane

The lane intentionally migrated kernel `storage.rs`, not the engine/auth/service/sync consumers
above:

| Former site/surface | Producer and consumer | Resolution |
| --- | --- | --- |
| `storage.rs` `DatabaseBinding::matches` (former line 852) | every database creates a binding; `PartialEq` and all equality consumers delegate to `matches` | `DatabaseBinding(ProcessBoundIdentity)` makes current-process checking intrinsic |
| `storage.rs` former `DatabaseBinding::identity` and `KernelCommitAuthority::identity` raw accessors | commit observer/join helpers and fork-promotion benchmark could receive `&Arc<()>` | raw accessors removed; helpers now receive only the checked identity or `DatabaseBinding` |
| `fork_promotion_bench.rs` former line 221 | the benchmark retained and compared a raw database Arc | retains `DatabaseBinding` and uses its checked equality; this change was required to close the raw-accessor bypass |
| `storage.rs` former line 442 | test-support durable-commit observer cleanup | observation state now owns and compares `ProcessBoundIdentity` |
| `storage.rs` former lines 2479 and 2502 | database participant installation consumed registry and activation Arc identity | registry/activation expose checked `is_same_instance`, backed by private `ProcessBoundIdentity` |

The six `push.rs` call sites found by searching `identity()` use
`declaration.app_scope.identity()`: a durable textual push application-scope identifier passed into
SQL. None receives an Arc, allocation address, `DatabaseBinding`, or another comparison-capable
database identity, so they are not a bypass of the removed storage accessors.

## Follow-up boundary

Migrate the 30 remaining FO-auth rows by replacing their raw identity fields with the shared checked
primitive, keeping each subsystem's legitimate same-process clone/reopen/restart behavior. The
room-authority group should include its adjacent `std::ptr::eq` activation check. The four
bookkeeping rows do not currently authorize an external or durable effect, but should be reconsidered
if their process-local state becomes a cross-process claim.
