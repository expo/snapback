# Design decision: fence watch creation by restricting the anchor, not by witnessing state

Status: Open — decided; blocked on four prerequisites. Main stays mode-only until they exist
Created: 2026-08-22
Related: issues/20260822-watch-creation-fence-needs-a-design.md,
issues/20260822-bounded-commit-capsule-spec.md,
issues/20260822-watch-preflight-dns-holds-the-managed-writer.md, LLP 0058

## The decision

A conservative hybrid of "re-run the query in the commit turn" and "restrict the anchor":

- Admit **only** a new, mechanically derived `ClosedAppQueryV1` watch-anchor profile.
- Run its initial query **exactly once, inside the final held Local writer turn**, immediately
  before the watch transaction.
- Reject every other anchor **before evaluation**: Ibex/JavaScript, cursor-bearing HostPlans, job
  status, unbounded plans, and any plan with mutable non-database inputs.
- **No storage-head or coarse witness, and no retry on witness movement.**
- **Keep `origin/main` on its current mode-only, single-turn implementation** until the
  prerequisites below exist.

## Why not the alternatives

- **Unrestricted re-run-in-commit-turn is not ready.** Ibex query execution calls the no-deadline
  helper, so putting it under a caller reservation recreates the unbounded logout pin this whole
  effort started from.
- **Restriction alone** still leaves preflight/commit conflicts and starvation.
- **Bounding the window** knowingly permits the invented-edge interleaving. Watch evaluation turns
  a persisted `false → true` into a firing edge; narrowing the clock interval does not make that
  webhook sound.

The hybrid removes both causes rather than narrowing them: the admitted query has no mutable
non-database input, and **no initial result crosses a split**, because there is no split.

The discriminator is derived by Rust manifest validation, **never authored as a trusted boolean** —
which matters, because a boolean is exactly what let the earlier convergence bug sit one function
down in the asset lane.

## The cost, measured rather than asserted

These currently-creatable classes stop working:

- every exposed Ibex `LiveQuery`, including DB-only handlers that evaluate fine today;
- search, relational, bounded-children and snapshot-batch anchors;
- plain HostPlan anchors without a finite limit, or with a standard-pattern cursor;
- `JobStatusQuery`;
- **existing stored watches in those classes — explicitly suspended during rollout, not
  grandfathered.**

That is broader than rejecting known clock calls, and deliberately so: eligibility must be
decidable *before* evaluation.

**Prerequisite: a read-only census before any rollout**, joining exposed `LiveQuery` definitions
and their derived profile against existing watch rows and active watches, reporting exact function
names, active-watch counts, and refusal reasons. Nobody should choose this without knowing how many
live watches it suspends.

## Residuals, stated explicitly

No semantic staleness race remains for `ClosedAppQueryV1`, subject to a managed-writer-only table
condition. Three residuals remain, and one is not solved here:

1. **COMMIT uncertainty** — query finishes, deadline check passes, COMMIT begins, acknowledgement
   lost. The server must not return a timeout; it reconciles by stable intended watch ID and exact
   row contents.
2. **Response loss without client idempotency** — the watch commits, the 201 is lost, the caller
   repeats, and a **second watch is created with duplicate future reactions**. The request body
   carries no operation identity. *This design does not claim to solve that*; a required
   idempotency key is the later remedy.
3. **DNS changes after creation** — a host may resolve publicly at creation and privately later.
   Delivery already re-resolves and validates immediately before use, so it refuses safely rather
   than trusting the creation-time answer.

Also: provisional webhook-secret staging can orphan if the process dies before the watch row
commits. The secret name derives from the unique watch ID and is unreachable without a watch row,
but it must be collected on startup reconciliation.

## Four prerequisites before this can land

1. The `ClosedAppQueryV1` classifier (manifest-derived).
2. Bounded HostPlan execution.
3. The bounded commit capsule (`issues/20260822-bounded-commit-capsule-spec.md`).
4. Off-writer DNS resolution
   (`issues/20260822-watch-preflight-dns-holds-the-managed-writer.md`).

Until all four exist, watch creation stays mode-only. That is the recommendation, not a
placeholder.

## Provenance

Read-only codex design against `c9a563e0d`. Full design with discriminator rules, lock analysis,
starvation argument, implementation sequence and regression set appended.

---

## Decision

Choose a conservative hybrid of 1 and 2:

- Admit only a new, mechanically derived `ClosedAppQueryV1` watch-anchor profile.
- Run its initial query exactly once, inside the final held Local writer turn, immediately before the watch transaction.
- Reject every other anchor before evaluation: Ibex/JavaScript, cursor-bearing HostPlans, job status, unbounded plans, and plans with mutable non-database inputs.
- Do not use a storage-head/coarse witness and do not retry on witness movement.
- Keep `origin/main` on its current mode-only, single-turn implementation until the classifier, bounded HostPlan execution, commit capsule, and off-writer DNS exist.

Current main is indeed single-turn: the route calls `with_snapback`, the engine runs the initial query, then takes the mode-only effect guard before storage ([server.rs:26266](crates/snapback-server/src/server.rs:26266), [engine.rs:23364](crates/snapback-engine/src/local/engine.rs:23364), [engine.rs:23381](crates/snapback-engine/src/local/engine.rs:23381)).

This hybrid is preferable because:

- Unrestricted option 1 is not ready: Ibex query execution currently calls the no-deadline helper ([host_glue.rs:924](crates/snapback-engine/src/runtime/host_glue.rs:924), [host_glue.rs:956](crates/snapback-engine/src/runtime/host_glue.rs:956), [host_glue.rs:5615](crates/snapback-engine/src/runtime/host_glue.rs:5615)). Putting that under a caller reservation recreates the unbounded logout pin.
- Option 2 alone still leaves preflight/commit conflicts and starvation.
- Option 3 knowingly permits the invented-edge interleaving. Watch evaluation turns persisted `false → true` into a firing edge ([watches.rs:735](crates/snapback-kernel/src/storage/watches.rs:735), [watches.rs:788](crates/snapback-kernel/src/storage/watches.rs:788)); narrowing the clock interval does not make that webhook sound.
- The hybrid removes both causes: the admitted query has no mutable non-database input, and no initial result crosses a split.

## Anchor discriminator

`ClosedAppQueryV1` is derived by Rust manifest validation, never authored as a trusted boolean. A function is eligible only if all are true:

1. It is an exposed `LiveQuery`, preserving the existing exposure and kind checks ([engine.rs:23248](crates/snapback-engine/src/local/engine.rs:23248)).
2. Its runtime is exactly `HostPlan(Query)`, from the closed runtime/plan enums ([types.rs:9250](crates/snapback-types/src/manifest/types.rs:9250), [types.rs:9724](crates/snapback-types/src/manifest/types.rs:9724)).
3. Every expression is free of `RuntimeNow`, `RuntimeId`, and `ClientMutationDigest`. The existing protected-expression walker already identifies those inputs and can be reused ([types.rs:5420](crates/snapback-types/src/manifest/types.rs:5420), [types.rs:5440](crates/snapback-types/src/manifest/types.rs:5440)).
4. It has a declared result ceiling: `plan.limit` is present and at most a fixed `WATCH_ANCHOR_MAX_ROWS`—recommend 1,024.
5. It has no keyset/continuation profile. Even plain `HostPlan(Query)` may consult the clock and keyring when a standard-pattern cursor is enabled ([engine.rs:35943](crates/snapback-engine/src/local/engine.rs:35943), [engine.rs:36042](crates/snapback-engine/src/local/engine.rs:36042)).
6. Every read table is an application table whose writer topology is managed-Local-only.

INFERRED: condition 6 makes the held Local writer a complete database cut. The writer gate describes itself as the single serving-path writer and keeps execution under the owned mutex ([writer_gate.rs:65](crates/snapback-server/src/server/writer_gate.rs:65)). Confirm it against the registered-system-writer inventory; any table writable outside this gate must be rejected or gain its own in-transaction witness.

Everything else receives a stable creation-time diagnostic such as `SNAPBACK_WATCH_ANCHOR_PROFILE_UNSUPPORTED`. No rejected handler is run to discover its eligibility.

### Why `authorityIndependent + non-retainable` is not usable

`authorityIndependent` describes authority dependence, not watch-input closure. Its current validator admits public plain/search HostPlans and explicitly rejects other HostPlans and Ibex ([types.rs:4848](crates/snapback-types/src/manifest/types.rs:4848)). Search still consults `now_millis()` and cursor keys during execution ([engine.rs:36173](crates/snapback-engine/src/local/engine.rs:36173)).

`retainable` is a separately authored retention capability, defaulting false ([types.rs:8673](crates/snapback-types/src/manifest/types.rs:8673), [types.rs:8834](crates/snapback-types/src/manifest/types.rs:8834)). Its validator admits particular plain/relational HostPlans and refuses opaque JavaScript, but relational output may still contain a clock-stamped cursor ([types.rs:5971](crates/snapback-types/src/manifest/types.rs:5971), [engine.rs:36357](crates/snapback-engine/src/local/engine.rs:36357)). It therefore produces both false positives and false negatives for this purpose.

### Measured behavior cost

The following currently-creatable classes stop working:

- Every exposed Ibex `LiveQuery`, including DB-only handlers that would evaluate successfully today.
- Search, relational, bounded-children, and snapshot-batch anchors.
- Plain HostPlan anchors without a finite limit or with a standard-pattern cursor.
- `JobStatusQuery`.
- Any existing stored watch in those classes; it must be explicitly suspended during rollout, not grandfathered.

That is broader than merely rejecting known clock calls. It is deliberate because eligibility must be known before evaluation.

Before rollout, add a read-only census that joins:

- exposed `LiveQuery` function definitions and their derived profile;
- existing watch rows’ `query_function_id/name`, which are already stored in the catalog ([watches.rs:240](crates/snapback-kernel/src/storage/watches.rs:240));
- active watches, available from the storage inventory ([watches.rs:328](crates/snapback-kernel/src/storage/watches.rs:328)).

The rollout report must list exact function names, existing active-watch counts, and refusal reasons.

## Query placement, locks, and logout

| Phase | Locks/permits | Logout exposure |
|---|---|---|
| Parse, validate URL, resolve DNS | No managed writer, no authority reservation, no `AdmissionState` guard | None directly |
| Prepare provisional webhook-secret entry | No caller reservation and no managed writer; use a separate config-store staging actor | A failed request may leave an orphan secret, but cannot create or fire a watch |
| Reserve authorized effect | Brief admission validation, then lock-free session/service permits | A terminal premark that already won refuses the reservation |
| Await final writer | Reservation held; no writer or `AdmissionState` guard yet | Premarked logout may wait for the permit, but the same absolute five-second capsule deadline bounds this phase |
| Final query | Managed Local writer plus reservation; no `commit_guard` | Logout either waits for Local planning or for the reservation. No caller JS runs |
| Final cut and COMMIT | Writer, reservation, SQLite transaction, and `commit_guard`/`AdmissionState` mutex | Logout waits until commit settles and owners drop |
| Response | No writer, reservation, or admission guard | None |

The admitted initial query is a HostPlan. Caller-supplied JS therefore runs for exactly zero time under either the writer or the caller reservation.

The HostPlan executor must receive the capsule’s absolute deadline and install a SQLite progress handler, checking both wall time and work steps. The repository already has this exact cancellation mechanism for typed telemetry queries ([telemetry_query.rs:610](crates/snapback-services/src/telemetry_query.rs:610), [telemetry_query.rs:633](crates/snapback-services/src/telemetry_query.rs:633)). Predicate evaluation and result serialization must also check the same deadline.

After the query:

1. Build the intended watch transaction.
2. Check the same absolute deadline.
3. Call `reservation.commit_guard`.
4. Call COMMIT directly.
5. Drop the guard and reservation before after-Local work.

The query’s own result-publication guard currently occurs at the query-return boundary ([engine.rs:37039](crates/snapback-engine/src/local/engine.rs:37039)); it must be dropped before acquiring the management `commit_guard`.

Nothing under `commit_guard` may invoke query preparation, validation, or any admission API. `commit_guard` acquires the mode guard last ([invocation.rs:1246](crates/snapback-sync/src/auth/invocation.rs:1246)); validation and effect guarding both acquire the same admission-state mutex ([admission.rs:938](crates/snapback-auth/src/auth/admission.rs:938), [admission.rs:950](crates/snapback-auth/src/auth/admission.rs:950)).

The five-second deadline is an admission deadline, not a hard COMMIT timeout. Once COMMIT starts, timeout must not produce `effectCommitted:false`. SQLite currently has a five-second busy timeout ([storage.rs:7081](crates/snapback-kernel/src/storage.rs:7081)), but device or process failure means no finite hard upper bound can honestly be claimed for COMMIT itself.

## Starvation

There is no stale retry.

The request obtains one FIFO position for the final Local turn, evaluates the query there, and commits there. Tokio’s pinned mutex implementation distributes `lock_owned` in request order; new mutations arriving after the watch waiter queue behind it ([tokio mutex.rs:598](/Users/ccheever/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tokio-1.53.1/src/sync/mutex.rs:598)). Thus continuous new writes cannot repeatedly invalidate or overtake the watch.

Termination is:

- Success after the finite turns already ahead of it complete; or
- A typed pre-COMMIT writer/final-cut timeout when the absolute deadline expires.

There is no server-side preflight/query replay and no 409 loop. A wedged writer cannot simultaneously provide guaranteed success and bounded logout; it receives the typed timeout. A busy but progressing writer succeeds because later arrivals do not move a witness or steal its queue position.

## What remains uncovered

No semantic staleness race remains for `ClosedAppQueryV1`, subject to the managed-writer-only table condition.

Three residuals remain explicit:

1. **COMMIT uncertainty:** query finishes, the final deadline check passes, COMMIT begins, then its acknowledgement is lost. The server must not return a timeout. It reconciles by the stable intended watch ID and exact row contents; exact intended row means success, absence/partial state means uncertain or rolled back.
2. **Response loss without client idempotency:** the watch commits, the 201 response is lost, and the caller repeats the request. The present request body carries no operation identity ([server.rs:26143](crates/snapback-server/src/server.rs:26143)); a manual repeat can create a second watch and duplicate future reactions. This design does not claim to solve that. Adding a required idempotency key is the later remedy.
3. **DNS changes after creation:** a host may resolve publicly at creation and privately later. Delivery must continue resolving and validating immediately before use; the current delivery preparation already does so ([engine.rs:24181](crates/snapback-engine/src/local/engine.rs:24181)). Consequence: delivery refuses safely, rather than using the creation-time answer.

Provisional webhook-secret staging can leave an orphan if the process dies before the watch row commits. The secret name is derived from the unique watch ID, is not reachable without a watch row, and must be collected on startup/reconciliation. Current creation writes the config file before creating the watch row and compensates with `unset` only on an ordinary returned error ([engine.rs:23395](crates/snapback-engine/src/local/engine.rs:23395), [engine.rs:23465](crates/snapback-engine/src/local/engine.rs:23465)); the new staging protocol must cover crash, not just returned failure.

## Job lifecycle trap

`JobStatusQuery` is explicitly ineligible in v1. Refusal is based on its runtime variant, not on `schema_table("_snapback_jobs")`.

If it is later admitted, it needs a separate `JobStateAnchorV1` profile with:

- Row dependencies validated against the exact job `state_version`.
- Missing-row dependencies rechecking exact absence.
- A jobs high-water if any admitted query is broader than one job.
- Job transitions proven to share the final Local cut or included in the same transaction/witness.

The executor already returns Row/MissingRow with `state_version` for this reserved projection ([engine.rs:36083](crates/snapback-engine/src/local/engine.rs:36083)). Claims and finishes increment state and emit `ChangedRow`s ([jobs.rs:1275](crates/snapback-kernel/src/storage/jobs.rs:1275), [jobs.rs:1309](crates/snapback-kernel/src/storage/jobs.rs:1309)), and the matcher has an explicit job-status arm ([live_matcher.rs:321](crates/snapback-kernel/src/live_matcher.rs:321)). Those facts make explicit support possible; none permits treating the application-schema lookup accident as a witness.

## DNS fold-in

Move `prepare_target` entirely before any managed writer or authority reservation. It currently performs blocking `ToSocketAddrs` directly ([webhooks.rs:74](crates/snapback-services/src/webhooks.rs:74)), and current creation calls it while already inside `with_snapback` ([engine.rs:23318](crates/snapback-engine/src/local/engine.rs:23318)). Logout itself needs Local before it can premark ([server.rs:17302](crates/snapback-server/src/server.rs:17302)).

Specify a bounded resolver service with:

- A five-second DNS deadline.
- A dedicated concurrency limit, separate from the Local blocking pool.
- Pure target-policy validation over the returned address set.
- No authority permit or managed writer ownership.
- The existing per-delivery resolution/revalidation retained.

## Implementation sequence

1. Land and failure-injection-test the generic bounded commit capsule.
2. Add the derived `WatchAnchorProfileV1` classifier, inspection census, refusal diagnostic, and existing-watch suspension migration.
3. Add deadline/work-budget support to HostPlan query execution.
4. Extract DNS and provisional config-secret staging from Local and from the authority-held interval.
5. Add a watch storage seam that stages one transaction, checks the deadline, acquires `commit_guard`, commits, and supports exact reconciliation.
6. Explicitly reject `JobStatusQuery`; do not modify reserved-table captured-read validation yet.
7. Switch `POST /watches` from the current mode-only call to the new reservation path only after all prior steps and tests pass.
8. Do not land the coarse establishment witness or its stale-retry diagnostic.

## Regression proof set

- Eligibility matrix covering every `HandlerPlan` variant, Ibex, mutable expressions, cursor profiles, missing/oversized limits, registered-writer tables, and one accepted closed HostPlan.
- Rejected Ibex test proving its handler is never invoked.
- Clock/cursor/job tests proving no watch row, secret response, evaluation job, firing, or webhook is produced.
- Final-turn barrier: commit a relevant mutation before the watch obtains Local; assert the initial predicate observes that mutation and persists once.
- FIFO load test: queue finite mutations, then watch creation, then continuously enqueue later mutations; assert the watch commits before later arrivals with one query invocation and no stale response.
- Writer and managed-handoff timeout tests proving the reservation drops and logout’s drain completes.
- HostPlan work-budget expiry proving SQLite interruption occurs before `commit_guard` and before any watch row.
- Admission test proving no validation/effect API is called while `commit_guard` is held.
- Pre-COMMIT, during-COMMIT, lost-ack, and post-COMMIT/response-loss fault injection with exact reconciliation.
- DNS stall test proving logout can acquire Local and premark while resolution remains blocked.
- Provisional-secret crash tests before staging, after staging, before watch COMMIT, and after COMMIT; only the last produces an active watch, and orphan cleanup is deterministic.
- Explicit `JobStatusQuery` refusal test that remains unchanged even if `_snapback_jobs` is specially admitted elsewhere.
- Existing safe HostPlan watch lifecycle regressions: create, initial state, relevant rerun, genuine `false → true` edge, budget enforcement, function reaction, and webhook reaction.

No files were modified.