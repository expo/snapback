# LLP 0285 step 2 — authority/binding semantic census

Baseline: `7f4f2de6d98b2394c1659218cd2eeb2d2298fef1`
Scope: every lowercase `kernel_commit_authority` identifier outside
`crates/snapback-kernel`, plus the seven type sites named by LLP 0285 §6 step 2.

This is structural checkpoint evidence only. It does not claim that F-1 is
closed; caller-selected facts remain until LLP 0285 steps 5–6.

Post-review correction: `DatabaseBinding` is identity-only, but the accurate
claim is narrower than "can only be cloned, compared, debugged, referenced,
and carried." Five public `LocalDatabase` methods accept a binding: the three
promotion-contention setup methods, `enable_authorization_commit_interlock`,
and `install_service_authority_commit_interlock`. Every one requires
`&mut LocalDatabase` and verifies that the binding names that exact database
before writing, returning a reservation/policy, enabling an interlock, or
installing behavior. The binding therefore confers no unverified fact assertion
and no shared-borrow database commit/push authority; LLP 0285 §1 condition (ii)
holds for this narrow reason.

## Shared-borrow `LocalDatabase` accessor audit

This is the complete accessor family present at this step, plus the direct
shared-borrow writers called out by review and the additional shutdown/vector
writers found while walking the same inherent-method surface.

| Accessor / direct method | Mutates through `&self`? | Disposition |
| --- | --- | --- |
| `api_envelope_read` | No | Left public. `ApiEnvelopeReadKernel` exposes only the two canonical envelope SELECTs. |
| `auth_catalog_read` | No | Left public. It constructs the read variant; its write path requires a mutable database variant and cannot mutate from this carrier. |
| `branch_ops_read` | Yes, indirectly | `LocalDatabase` accessor is `pub(crate)`; `ServingDatabase::branch_ops_read` is the explicit owner surface. The only shared mutations behind returned boot-derived runtimes are bounded derived-fork denial markers or in-app-branch denial/capture records, never arbitrary SQL or a caller-asserted serving fact. |
| `membership_plans_read` | No durable write, but it can plan caller-selected privileged membership facts | `LocalDatabase` accessor remains `pub(crate)` and `ServingDatabase::membership_plans_read` is explicit. A shared borrow can plan but cannot reach the mutable commit boundary. Defect 4 remains open pending writer derivation; this row does not claim otherwise. |
| `jobs_read` | No | Left public. The carrier exposes cron/job status and count SELECTs only. |
| `versions_read` | Yes before this round | `LocalDatabase` accessor is `pub(crate)`. `VersionsReadKernel`'s prune/configure methods are also `pub(crate)`, so explicit `ServingDatabase::versions_read` is genuinely read-only; periodic journal pruning is the separately named serving-owner operation. |
| `checkpoints_read` | Yes before this round; it erased/recovered checkpoints and protected-record copies | `LocalDatabase` accessor is `pub(crate)`. Every destructive/recovery method on `CheckpointsReadKernel` is also `pub(crate)`; explicit `ServingDatabase::checkpoints_read` exposes inspection only, while product erasure still takes the admitted request through `checkpoints(&mut self)`. |
| `settlement_read` | No | Left public. It exposes retained settlement/explanation SELECTs only. |
| `query_reads_read` | No | Left public. It exposes schema-bound reads and pinned `DbRead`, not a connection or write primitive. |
| `reader_pool` | Yes before this round; the clone could close the pool or open a registered vector writer | `LocalDatabase` accessor is `pub(crate)`. `ReaderPool::close_for_shutdown` and `quarantine_vector_generation` are now `pub(crate)`, so the explicit serving-owner pool clone has a typed-read-only public surface; exact quarantine is separately routed through `ServingDatabase`. A cloned `ReadLane` now fails closed on a quarantine target instead of opening the second writer. |
| `persist_derived_fork_app_row_coverage_receipt` | Yes | Demoted to `pub(crate)` on `LocalDatabase`; the exact serving-owner method performs the retained pre-bind receipt write. |
| `initialize_sender_proof_after_hosted_preflight` | Yes, DDL | Demoted to `pub(crate)` on `LocalDatabase`; the explicit serving-owner hosted-preflight method owns the DDL. |
| `initialize_authentication_throttle_after_hosted_preflight` | Yes, DDL | Demoted to `pub(crate)` on `LocalDatabase`; the explicit serving-owner hosted-preflight method owns the DDL. |
| `prepare_replication_shutdown` | Yes, closes pooled readers | Demoted to `pub(crate)` on `LocalDatabase`; retained as an explicit serving-owner shutdown operation. |
| `shutdown_checkpoint` | Yes, closes readers and changes WAL/journal state | Demoted to `pub(crate)` on `LocalDatabase`; retained as an explicit serving-owner shutdown operation. |
| `quarantine_vector_generation` | Yes | Demoted to `pub(crate)` on `LocalDatabase`; retained as the exact explicit serving-owner vector quarantine operation. |

## Baseline-count correction

The pinned baseline contains **31**, not 33, lowercase identifier sites outside
the kernel: 30 in `local/engine.rs`, zero in the separately owned
`push/authority_tests.rs`, and one in `auth_room_kick_acceptance.rs`. The two
test sites asserted by LLP 0285 are calls through local variables named
`kernel`, not identifiers named `kernel_commit_authority`. This census records
the actual pinned tree rather than manufacturing the stated count.

Recheck:

```sh
git grep -n -w kernel_commit_authority 7f4f2de6d -- \
  crates ':!crates/snapback-kernel'
```

## Seven named type sites

Line numbers are the baseline coordinates named by the spec; current line
numbers can move as this lane edits the files.

| Baseline site | Step-2 disposition |
| --- | --- |
| `snapback-auth/src/auth/service_fence.rs:1118` | The factory path now requires `&ServingDatabase`; its kernel-private authority constructs the terminal/interlock carriers. No binding method constructs behavior. |
| `snapback-engine/src/push.rs:33` | The adapter now requires `&ServingDatabase`; the kernel-private authority, not the binding, asserts the push fact. |
| `snapback-engine/src/push.rs:49` | The ledger wrapper likewise requires the serving owner. The cloned read lane has no binding or push authority and cannot execute this plan. |
| `snapback-engine/src/local/engine.rs:3195` | Replaced by `ServingDatabase`; the kernel-private fact-assertion root is no longer a field in the engine crate. |
| `snapback-engine/src/local/engine.rs:24221` (pinned baseline `:24234`) | Replaced by `ServingDatabase::adopt`; no fact-assertion root crosses the kernel boundary. |
| `snapback-engine/src/local/engine.rs:29838` (pinned baseline `:29851`) | Removed. `ReadLane` retains an `AdmissionController` and can prepare limited non-durable dev authority, but carries no database commit/push authority; push-ledger queries route through the serving owner. |
| `snapback-engine/src/local/engine.rs:34676` (pinned baseline `:34689`) | Query execution receives `Option<&ServingDatabase>`; only owner-lane calls supply it, and push-ledger evaluation fails closed when it is absent. |

The two former fact-root sites were not binding consumers. They disappeared in
the `ServingDatabase` step rather than being mislabeled as non-privileged. At
the end of steps 2–4, no outside-kernel
`KernelCommitAuthority` type site remains.

## Lowercase identifier census (31 actual baseline sites)

| # | Baseline site | Disposition |
| ---: | --- | --- |
| 1 | `local/auth_room_kick_acceptance.rs:1693` | Replaced by `snapback.db.authorization_commit_carriers()`; the serving owner reaches the kernel-private factory. |
| 2 | `local/engine.rs:3195` | Fact-assertion root retained only until step 3; identity split into `DatabaseBinding`. |
| 3 | `local/engine.rs:4846` | Pending-effect refusal fact assertion; moves behind `ServingDatabase` in step 3/4. |
| 4 | `local/engine.rs:4920` | Pending-effect decision fact assertion; moves behind `ServingDatabase`. |
| 5 | `local/engine.rs:4941` | Pending-effect settlement fact assertion; moves behind `ServingDatabase`. |
| 6 | `local/engine.rs:4954` | Pending-effect denial fact assertion; moves behind `ServingDatabase`. |
| 7 | `local/engine.rs:5745` | Pending-effect creation fact assertion; moves behind `ServingDatabase`. |
| 8 | `local/engine.rs:6139` | Test-only exact commit-graph join; moves to the kernel-owned serving wrapper. |
| 9 | `local/engine.rs:6144` | Test-only root clone; deleted when the root becomes non-`Clone`. |
| 10 | `local/engine.rs:6504` | Protected-erasure fact assertion; moves behind `ServingDatabase`. |
| 11 | `local/engine.rs:6685` | Replaced by `&self.db`; only the serving owner can bridge the still-caller-selected push fact. |
| 12 | `local/engine.rs:7792` | Replaced by `self.db.binding()` for authorization-interlock identity checking. |
| 13 | `local/engine.rs:10930` | Replaced by `Some(&self.db)` for owner-lane query execution. |
| 14 | `local/engine.rs:14446` | Replaced by `self.db.binding()` for benchmark reservation identity checking. |
| 15 | `local/engine.rs:14456` | Replaced by `self.db.binding()` for benchmark infrastructure identity checking. |
| 16 | `local/engine.rs:14466` | Replaced by `self.db.binding()` for benchmark activation identity checking. |
| 17 | `local/engine.rs:17805` | Replaced by `Some(&self.db)` for child query execution. |
| 18 | `local/engine.rs:18652` | Replaced by `Some(&self.db)` for live query execution. |
| 19 | `local/engine.rs:24215` | Sole production claim; replaced by `ServingDatabase::adopt` in step 3. |
| 20 | `local/engine.rs:24226` | Root constructor handoff; removed with serving adoption. |
| 21 | `local/engine.rs:24234` | Root constructor parameter retained only until step 3; identity consumers use its split binding. |
| 22 | `local/engine.rs:24239` | Replaced by `&ServingDatabase` for service-fence construction. |
| 23 | `local/engine.rs:24241` | The resulting interlock is installed through `ServingDatabase`; the binding cannot construct or install it. |
| 24 | `local/engine.rs:24369` | Authorization-commit carriers are now constructed from the serving owner's kernel-private root. |
| 25 | `local/engine.rs:24373` | Fact root stored only until step 3, then owned inside `ServingDatabase`. |
| 26 | `local/engine.rs:25568` | Removed; `ReadLane` no longer receives a database binding. |
| 27 | `local/engine.rs:29851` | Removed with the `ReadLane` binding field. |
| 28 | `local/engine.rs:30231` | Read-lane query execution passes no serving owner. |
| 29 | `local/engine.rs:34689` | Parameter renamed and retyped to `Option<&ServingDatabase>`. |
| 30 | `local/engine.rs:34706` | Recursive query calls preserve the optional serving owner. |
| 31 | `local/engine.rs:34936` | Push-ledger projection requires the serving owner or fails closed. |
| — | `push/authority_tests.rs` | No matching baseline identifier exists; the tests now adopt an isolated serving owner rather than treating a binding as a fact issuer. |

The last row records the spec-asserted test location explicitly even though the
identifier census is empty there. The count remains **31** for the pinned tree;
the spec's stated 33 included two calls whose local variable was named `kernel`,
not `kernel_commit_authority`.

## Prior-claim correction

The `c963a5bcb` message over-credited its change by saying pending-effect
commands and the promotion reservation lost `Clone` / `Default` /
`Deserialize`. Those types already lacked the named derives at the pinned base;
this round makes no removal claim for them.

That message also said the reachability half was closed after containing only
`membership_plans_read`. That was premature: LLP 0285 §8 risk 6 says
"starting with," not "limited to," and the table above found live destructive
routes through versions, checkpoints, and the reader pool. This round records
and contains the complete current shared-borrow accessor family. It does **not**
claim F-1 or defects 1–4 closed: `ServingDatabase::admit_system_push` and the
other caller-fact owner methods remain public operational surfaces until LLP
0285 §5.1 step 6 makes those facts kernel-derived.

## Behavior and schema invariants

- No SQL text or statement ordering changed.
- No canonical read shape or JOIN changed.
- `cargo check --all-targets --workspace` finished successfully at this step.
- `git diff --stat 7f4f2de6d..HEAD -- schemas/` is empty.
