# Nine compiling security-boundary attacks are reachable

**Status:** Open
**Owner:** LLP 0283 F-1 closure lanes
**Date:** 2026-08-26
**Related:** LLP 0284, LLP 0303, `issues/shelved/20260819-security-gates-expected-red-until-f1.md`, `issues/shelved/20260825-security-boundary-gate-was-masked-by-an-infrastructure-error.md`

## Finding

All nine compile-fail attacks exposed after the gate's `c009-*` infrastructure
repair denote live capabilities. None is a stale witness or a boundary that was
deliberately out of scope. This ticket records execution evidence and the
producer/consumer census required by LLP 0303 revisions (n), (o), (q), and (s).
It supplements the older expected-red ticket with runtime evidence; it is not
an allowlist or a duplicate implementation lane.

A standalone dependent Cargo crate outside the workspace called only public
APIs from `snapback-kernel`, plus `snapback-services` for the declared
`remainder-tests` cell. `cargo run` succeeded in all three tested graphs:

- default features: all eight default-cell compositions executed;
- `snapback-services/remainder-tests`: those eight plus raw SQL executed;
- additive control, `snapback-kernel/test-support` and
  `snapback-services/remainder-tests` together: all nine still executed.

Representative observations from the combined run were:

```text
admit-system-push: state=zero-target deduplicated=true
admit-protected-record-erasure: row_present=false delete_version=2 authority=caller-selected-principal
admit-pending-effect-creation: status=Pending
admit-pending-effect-refusal: status=Refused outcome=CALLER_SELECTED_REFUSAL
service-interlock-factory: prepared=1 committed=0 rolled_back=1 operation_error=SNAPBACK_AUTH_AGENT_UNKNOWN
obtain-promotion-contention-reservation: activated interval_ms=1000 max_commit_ms=500
obtain-ask-spend-reservation: reserved_tokens=10 settled_tokens=4 settled_bytes=25
forge-membership-writer-admin: version=1 durable_changes=1
services-rusqlite-reexport: raw_sql_value=yes
```

The service operation intentionally chose an unknown agent so the durable auth
transaction rolled back after terminal preparation. The caller-supplied
rollback callback nevertheless ran, which is the effect under test.

## Per-attack verdict and row mapping

| Attack | Verdict | Row mapping | Executed composition |
| --- | --- | --- | --- |
| `admit-system-push` | **Reachable** | F223 producer joined to the F256 reservation leaf; F255 is the correct production adapter that the public bridge bypasses | Minted system push authority from a `ServingDatabase`, selected an explicit recipient in a send request, reserved a durable intent, then observed deduplication on a second reservation. F223 alone introduces no subject, but the F223 + public reservation composition reaches the recipient-bearing effect. |
| `admit-protected-record-erasure` | **Reachable** | Unmapped owner-bridge row in the LLP 0285 defect-1 / F-1 family | Seeded a row, admitted an erasure request containing caller-selected principal, credential, stream, table, and row, passed it to `CheckpointsKernel::erase_protected_record`, and observed the row absent at durable version 2. |
| `admit-pending-effect-creation` | **Reachable** | Unmapped owner-bridge row in the LLP 0285 defect-1 / F-1 family | Supplied a complete `CreatePendingEffect`, called `ServingDatabase::create_pending_effect_admitted`, and read back a durable `Pending` record. |
| `admit-pending-effect-refusal` | **Reachable** | Unmapped owner-bridge row in the LLP 0285 defect-1 / F-1 family | First created a pending effect, then supplied its id and an arbitrary outcome code to `refuse_pending_effect_admitted`, and read back `Refused` plus that code. Neither the refusal bridge without an existing effect nor creation alone produces this terminal effect. |
| `service-interlock-factory` | **Reachable** | F115 + F226 + F227 (with the crate-visible sibling F117) | Obtained the database factory, built a terminal whose closures updated independent counters, installed its interlock, and drove `deactivate_agent`. Preparation and the caller-supplied rollback callback both executed. |
| `obtain-promotion-contention-reservation` | **Reachable** | Unmapped R-2 return/consume-pair row | Initialized the bench infrastructure, prepared a reservation for a caller-selected stream, consumed it in activation, and received the active contention policy. Preparation or activation alone cannot produce the active policy. |
| `obtain-ask-spend-reservation` | **Reachable** | F257–F260; the engine admission wrapper is F204 and the public subject carrier is C014 | Reserved counters for caller-selected principal/integration keys, then consumed the reservation in settlement and observed the durable counters change from 10 reserved tokens to 4 actual tokens and 25 result bytes. |
| `forge-membership-writer-admin` | **Reachable** | The direct `MembershipWriter::Admin` construction is unmapped; adjacent mapped factories are F232/F233 and the independently supplied writer/plan join is F236 | Constructed `MembershipWriter::Admin`, planned a privileged app-role insert, committed it, and observed a version-1 commit containing the inserted membership row. |
| `services-rusqlite-reexport` | **Reachable** | LLP 0284 I-6 / F-1 raw-SQL family; no F-row id | With `snapback-services/remainder-tests`, imported the re-exported `Connection`, created a table, inserted a row, queried it, and obtained `yes`. |

## Producers, consumers, joins, and checked-in precedents

### Push

- Producers: the public `ServingDatabase::{admit_system_push,
  admit_user_push,admit_other_push}` bridges. The production producer is
  `snapback_engine::push::admitted_push_storage_authority` (F255), which derives
  user identity from `PreparedAuthority`.
- Consumers: `PushRegistryKernel::{reserve_send_admitted_storage,
  reserve_send_admitted_storage_guarded}` and the F256 `reserve_send_in` leaf;
  ledger projection consumes the same authority class for reads.
- Join: declaration/schema + F223 authority + trigger mode + audience request.
  The system fact and the request alone do not write an intent.
- Existing proof consulted first:
  `crates/snapback-engine/src/push/authority_tests.rs` already composes admitted
  push authority with reservation and inspects durable intents.

### Protected-record erasure

- Producer: `ServingDatabase::admit_protected_record_erasure`; its lower
  `KernelCommitAuthority` producer is private. The engine's owner flow at
  `local/engine.rs` is the intended higher-rank producer.
- Consumers: public `CheckpointsKernel::erase_protected_record`; the engine
  wrapper and `snapback_engine::test_support::erase_protected_record` are
  siblings.
- Join: a caller-selected admitted request + the checkpoint consumer. Neither
  admission nor a row/table string alone deletes anything.
- Existing proof consulted first: `crates/snapback-kernel/src/proof_checkpoint.rs`
  tests admit requests, erase rows, and inspect deletion/retry behavior.

### Pending-effect creation and refusal

- Producers: the public serving bridges
  `create_pending_effect_admitted`, `approve_pending_effect_admitted`,
  `deny_pending_effect_admitted`, `settle_pending_effect_admitted`, and
  `refuse_pending_effect_admitted`. Their command producers on
  `KernelCommitAuthority` mint `Create`, `Approve`, `Deny`, `Settle`, and
  `RefusePendingEffectCommand` values; those roots are private but the serving
  bridges collapse production and consumption into public calls.
- Consumers: `LocalDatabase::{create,approve,deny,settle,refuse}_pending_effect`;
  public serving bridges directly invoke them. `pending_effect` is the durable
  observation surface.
- Joins: refusal requires a prior creation plus id/outcome admission; approval
  requires `prepare_pending_effect_approval` plus approval admission;
  settlement requires the execution ticket produced by approval plus a
  settlement command. These pair/sequence effects are not represented by any
  single input value.
- Existing proof consulted first: tests in
  `storage/pending_effects.rs` exercise the command/consumer pairs, and
  `snapback-sync/src/auth/coordinator.rs` contains checked-in public serving
  compositions for creation.

### Service terminal interlock

- Producers: `ServingDatabase::service_authority_terminal_factory` (F226),
  `ServiceAuthorityTerminalFactory::prepared` (F115), and
  `ServingDatabase::service_authority_commit_interlock` (F227). The intended
  sibling is `ServiceAuthorityFenceRegistry::kernel_commit_interlock` (F114).
- Consumers: `install_service_authority_commit_interlock`, followed by every
  auth transaction using the service terminal path, including agent
  deactivation, grant/credential revocation or rotation, scoped-token release,
  and expired-token terminalization.
- Join: factory + arbitrary terminal closures + installed interlock + a later
  auth transaction. No one call alone executes the closure effect.
- Existing proof consulted first: service-fence/storage tests install recording
  interlocks and drive commit/rollback terminal paths; row-attack F115 proves
  only construction, so the dependent execution added the missing observation.

### Promotion contention

- Producers: public prepare methods on `LocalDatabase`, `ServingDatabase`, and
  the engine/bench-support wrappers. They accept a caller-selected canonical
  stream and return `PromotionContentionReservation`.
- Consumers: the corresponding public activation methods consume the
  reservation and write/return `PromotionContentionPolicy`; the public count
  method observes committed contention rows.
- Join: infrastructure initialization + prepare + activation. The opaque
  reservation correctly binds database identity, but its public producer still
  lets the caller choose the stream.
- Existing proof consulted first: `fork_promotion_bench.rs` tests and
  `snapback-engine/src/bench_support.rs` contain the same prepare/activate pair.

### Ask spend

- Producers: `LocalDatabase::{reserve_ask_spend,
  reserve_ask_spend_guarded}` (F257/F258), their `ServingDatabase` siblings
  (F259/F260), and engine wrappers. All accept public `AskSpendSubject` (C014).
- Consumers: `LocalDatabase::settle_ask_spend`, its serving wrapper, and engine
  settlement; reservation/drop behavior also reconciles reserved counters.
- Join: subject + declared budgets + reservation, followed by settlement for
  actual usage. Reservation and settlement are both necessary to demonstrate
  attribution to the caller-selected payer and final counters.
- Existing proof consulted first: `storage/ask_spend.rs` and
  `local/admission_fence_tests.rs` already reserve and settle against durable
  budget rows.

### Membership admin writer

- Producers: direct public variants on `MembershipWriter`, including `Admin`;
  F232/F233 copy caller-supplied `ResolvedMembershipWriter`; F236 joins an
  independently supplied writer and plan.
- Consumers: the public privileged planners on `LocalDatabase`,
  `MembershipPlansKernel`, and `MembershipPlansReadKernel`, followed by public
  `commit_membership_plan`. Other plan/commit families consume the same writer.
- Join: forged writer + privileged planner + commit. Construction alone does
  not create membership; planning alone does not make it durable.
- Existing proof consulted first: `storage/tests.rs` uses
  `MembershipWriter::Admin` with the same privileged-plan/commit sequence and
  inspects creation provenance.

### Raw SQLite re-export

- Producer: `snapback_services::test_support::rusqlite` publicly re-exports the
  crate whenever `remainder-tests` is unified into the graph.
- Consumers: every public `rusqlite` constructor/operation becomes nameable;
  the execution used `Connection::{open_in_memory,execute_batch,query_row}`.
  A filesystem path supplied to `Connection::open` would be the pair needed to
  address an existing database; independent filesystem access remains outside
  LLP 0284, while the re-export itself is expressly in scope under I-6.
- Existing proof consulted first: engine push authority tests already import
  this exact re-export for raw SQL inspection.

## Feature-unification conclusion

Features are additive across the dependency graph. Enabling
`snapback-kernel/test-support` did not close or alter any default-cell route.
Enabling `snapback-services/remainder-tests` added the ninth route and left all
eight default routes live. Enabling both together produced the same nine
effects. No additional tested cell changes any verdict.

## Closure condition

Each implementation lane must close the capability rather than merely the
current spelling, add or repair compile-fail witnesses at the capability's
next honest spelling, identify the denial mode, and confirm that the legitimate
higher-rank route still works. The unmapped effects above need stable row ids
before their closure can be claimed.
