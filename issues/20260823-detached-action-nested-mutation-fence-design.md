# Design: caller-bound fencing for detached-action nested mutations

Status: Proposed — design complete, implementation not dispatched
Created: 2026-08-23
Related: issues/20260822-author-rulings-fence-program.md (the binding ruling),
issues/20260822-residual-exposure-remeasurement.md (the measurement),
issues/20260821-residual-caller-terminal-write-exposure.md,
issues/20260822-capsule-structural-residuals.md

## What this closes

The highest-consequence remaining unguarded write path. A detached action retains the caller's
`PreparedAuthority`, child mutations inherit it, and `validate_live` checks abandonment,
generation and deadline — **not session or service liveness**. So an ordinary session or
scoped-service caller can still get a durable SQLite write committed *after* their own authority
has gone terminal, with arbitrary application mutation effects.

## Verdict

**The ruling is implementable** without changing action ownership or synchronously killing the
evaluator. The design works within every constraint the ruling set: reserve once per nested
mutation rather than per action, a typed terminal-cause latch instead of overloading
`abandoned: AtomicBool`, and the watchdog retained as the hard bound.

## Why the test plan is the important half

This program's recurring failure has not been wrong fixes — it has been **tests that pass for the
wrong reason**. Six were found in the capsule work alone, including a sentinel that never invoked
the closure it claimed to test. So this design specifies, for every one of its ten tests, the
shortest production mutation that would leave a naïve version green, and the strengthening that
closes it.

Two features of that plan are worth keeping whatever else changes:

- **T1 is a mandatory watched failure.** It must be run against the *parent* implementation before
  the fix, where it is expected to fail because the child row commits after terminalization. That
  red result is the evidence; a test nobody has watched fail is not.
- **T8 anticipates recreating a historical false sentinel.** Deleting the provider-settlement
  invocation would let the trusted backstop alone produce the expected terminal — exactly the
  shape of an earlier defect — so it requires counters proving the settlement closure was invoked
  and refused.

Six mutation checks are required before acceptance, each naming which test must fail.

## Scope note

Design only. No implementation dispatched. The bounded commit capsule is *not* relied on as a
structural origin or commit seal — see the residuals ticket for what it does and does not
guarantee.

## 1. Commit protocol and reservation lifetime

For every caller-backed nested mutation:

```text
Local: stage exact child mutation
release Local
wait for protected-room reservation, if any
reserve exact child caller authority
bounded FIFO reacquisition of Local
revalidate generation/reservation snapshot
install room reservation
build SQLite transaction
acquire action commit_gate
acquire authorized-effect commit_guard (mode LAST)
lock-free action liveness recheck
identity/journal writes + SQLite COMMIT
drop mode/action guards
drop caller reservation
release Local
run after-local work
```

The posture must be a closed enum, never `Option<AuthorizedEffectReservation>`:

```rust
enum NestedActionEffect {
    CallerBound(AuthorizedEffectReservation),
    ModeOnlySystem(PreparedAuthority),
}
```

`CallerBound` is selected explicitly when the outer action is staged from session, scoped-service, anonymous-stream, or local-dev authority. `ModeOnlySystem` is allowed only for closed credential-free sources such as cron, durable jobs, and revalidated watch execution. It must not be inferred from a missing publication or from reservation failure. An HTTP action retaining its caller’s authority can never fall back to `ModeOnlySystem`.

### Detached HostPlan child

The existing path inherits and stages the exact child authority under Local at [server.rs:1335](crates/snapback-server/src/server.rs:1335), releases Local at [server.rs:1345](crates/snapback-server/src/server.rs:1345), and obtains the room reservation at [server.rs:1346](crates/snapback-server/src/server.rs:1346).

After the room reservation succeeds and before reacquiring Local at [server.rs:1348](crates/snapback-server/src/server.rs:1348):

1. Extract the child `PreparedAuthority` from `staged.invocation`.
2. Call its classified `reserve_authorized_effect`.
3. On terminal refusal, latch the cause, cancel the room reservation, and return the refusal.
4. Otherwise carry the lock-free reservation into Local.

The installed room scope remains at [server.rs:1354](crates/snapback-server/src/server.rs:1354). Pass the caller reservation into `invoke_host_plan_mutation_guarded` at [server.rs:1356](crates/snapback-server/src/server.rs:1356).

Release the caller reservation immediately after that call returns, before room cleanup and `complete_after_local` at [server.rs:1365](crates/snapback-server/src/server.rs:1365). Panic unwinding must drop it by RAII.

### Detached Ibex child

The handler continues to execute once, off Local. Preview remains under the short Local window at [server.rs:1439](crates/snapback-server/src/server.rs:1439), followed by the room reservation at [server.rs:1450](crates/snapback-server/src/server.rs:1450).

Reserve `binding.invocation.authority()` after the room wait and before Local reacquisition at [server.rs:1457](crates/snapback-server/src/server.rs:1457). Carry it through the commit call at [server.rs:1465](crates/snapback-server/src/server.rs:1465), then drop it before room and after-local processing at [server.rs:1475](crates/snapback-server/src/server.rs:1475).

No handler rerun is permitted after refusal or writer timeout.

### Managed HostPlan action

The generic writer helper is insufficient. Its no-room branch executes the mutation during the first Local turn at [writer_gate.rs:489](crates/snapback-server/src/server/writer_gate.rs:489), specifically [writer_gate.rs:507](crates/snapback-server/src/server/writer_gate.rs:507). That leaves no outside-Local reservation seam.

Replace the use at [server.rs:3162](crates/snapback-server/src/server.rs:3162) with an action-specific forced-split helper:

1. Stage the child and exact preflight using [engine.rs:27905](crates/snapback-engine/src/local/engine.rs:27905). The exact nested authority is derived at [engine.rs:27927](crates/snapback-engine/src/local/engine.rs:27927).
2. Always release Local, including `NoAuthorizationEvent`.
3. Obtain any room reservation.
4. Reserve the child caller authority.
5. Reacquire Local with the bounded FIFO helper.
6. Recheck generation and authorization snapshot, install the room scope, and commit through `commit_staged_recorded_authorization_mutation_with_authorized_effect` at [engine.rs:17302](crates/snapback-engine/src/local/engine.rs:17302).
7. Drop the caller reservation before after-local work.

The existing generic helper remains appropriate for non-action sites.

### Final guard order

Both detached engine closures currently acquire mode before the action gate:

- HostPlan: [engine.rs:18076](crates/snapback-engine/src/local/engine.rs:18076)
- Ibex: [engine.rs:18380](crates/snapback-engine/src/local/engine.rs:18380)

Replace, rather than wrap, those guards:

```rust
let action_guard = lock_commit_live()?;
let effect_guard = nested_effect.commit_guard()?; // service witness, then mode LAST
Ok((effect_guard, action_guard))                  // drop mode before action gate
```

For `CallerBound`, `commit_guard` is [invocation.rs:1293](crates/snapback-sync/src/auth/invocation.rs:1293). It retains the service witness and acquires mode last at [invocation.rs:1315](crates/snapback-sync/src/auth/invocation.rs:1315). For explicit system actions, acquire the action gate first and then `mode_effect_guard`.

The returned guard lives through the actual cuts:

- HostPlan identity recording and COMMIT: [storage.rs:6253](crates/snapback-kernel/src/storage.rs:6253) through [storage.rs:6284](crates/snapback-kernel/src/storage.rs:6284)
- Buffered Ibex identity recording and COMMIT: [storage.rs:7208](crates/snapback-kernel/src/storage.rs:7208) through [storage.rs:7239](crates/snapback-kernel/src/storage.rs:7239)

The post-guard `check_live` must remain lock-free. It may inspect atomics and the terminal `OnceLock`; it must not call admission validation, reservation, or any session/service fence while the non-reentrant mode guard is held.

### Bounded Local acquisition

Factor the capsule’s reservation/FIFO acquisition sequence at [commit_capsule.rs:782](crates/snapback-server/src/server/commit_capsule.rs:782) through [commit_capsule.rs:840](crates/snapback-server/src/server/commit_capsule.rs:840) into a private helper used by both the capsule and actions.

The action deadline is:

```text
min(action execution deadline, reservation start + five-second capsule default)
```

The detached evaluator runs on a native thread at [server.rs:337](crates/snapback-server/src/server.rs:337). Pass it a Tokio runtime handle and a watchdog-only cancellation carrier; the thread may block on the async FIFO acquisition because it is not a Tokio worker. If that is unsafe during runtime shutdown, use an async broker plus oneshot instead.

Cancellation drops the queued mutex future and the caller permit. It must not use repeated `try_lock`, which loses FIFO behavior. The underlying managed queue remains [writer_gate.rs:85](crates/snapback-server/src/server/writer_gate.rs:85).

## 2. Typed terminal-cause latch

### Types and location

Add source-level authority refusal classification beside `AuthorizedEffectReservation` at [invocation.rs:1217](crates/snapback-sync/src/auth/invocation.rs:1217):

```rust
enum CallerAuthorityTerminalCause {
    AdmissionEpochRetired { error: SnapbackError },
    AuthorizationStreamRetired { error: SnapbackError },
    SessionRetired {
        disposition: TerminalAuthorityDisposition,
        error: SnapbackError,
    },
    ScopedServiceRetired {
        disposition: ServiceAuthorityDisposition,
        error: SnapbackError,
    },
}

enum AuthorizedEffectReservationError {
    Terminal(CallerAuthorityTerminalCause),
    NonTerminal(SnapbackError),
}
```

Add the action-specific latch beside `DetachedIbexAction` and `ManagedHostPlanAction` at [engine.rs:1914](crates/snapback-engine/src/local/engine.rs:1914) and [engine.rs:2090](crates/snapback-engine/src/local/engine.rs:2090):

```rust
enum ActionTerminalCause {
    CallerAuthority(CallerAuthorityTerminalCause),
    WatchdogTimeout(SnapbackError),
}

struct ActionTerminalLatch(Arc<OnceLock<ActionTerminalCause>>);
```

`abandoned: AtomicBool` remains at [server.rs:673](crates/snapback-server/src/server.rs:673) and continues to mean only “watchdog abandonment occurred.” The latch does not replace or reinterpret it.

The outer staged action, detached host, worker-completion closure, outer watchdog, and managed HostPlan executor all receive clones of the same latch. First writer wins.

### Cause classification

Do not parse public diagnostic codes or messages.

Add classified reservation APIs while retaining compatibility wrappers that map back to `SnapbackError` for existing callers:

- The stream/session fence must distinguish stream replacement from session refusal under the locks currently used by [session_projection.rs:658](crates/snapback-sync/src/auth/session_projection.rs:658).
- `PreparedAuthority::reserve_authorized_effect` currently collapses refusal at [invocation.rs:1763](crates/snapback-sync/src/auth/invocation.rs:1763) and reconstructs a diagnostic at [invocation.rs:1807](crates/snapback-sync/src/auth/invocation.rs:1807). The classified sibling should preserve the source-level cause.
- Finite-service pending termination is currently indistinguishable from capacity or clock unavailability at [service_fence.rs:533](crates/snapback-auth/src/auth/service_fence.rs:533). Change the internal pending-ticket set at [service_fence.rs:61](crates/snapback-auth/src/auth/service_fence.rs:61) to retain the intended disposition, and return a typed terminal refusal for pending or committed retirement. Poisoning, capacity, and clock problems remain non-terminal.

### Writers and readers

The latch is set by:

- A per-mutation caller reservation returning `Terminal`.
- A final `commit_guard` refusing because the admission epoch retired after reservation.
- Any classified finite-service terminal refusal encountered by the existing external-effect handshake at [server.rs:1270](crates/snapback-server/src/server.rs:1270).
- The watchdog, under `commit_gate`, using `WatchdogTimeout`.

It is read by:

- `DetachedActionHost::validate_live` at [server.rs:1121](crates/snapback-server/src/server.rs:1121).
- The universal action host-call boundary at [host_glue.rs:3408](crates/snapback-engine/src/runtime/host_glue.rs:3408) through `DetachedActionHost::validate_host_call` at [server.rs:1261](crates/snapback-server/src/server.rs:1261).
- Managed step staging and `ManagedHostPlanAction::finish` at [engine.rs:4468](crates/snapback-engine/src/local/engine.rs:4468).
- Detached worker completion before result validation and redaction.
- The outer watchdog and stream-terminal cause selection.

After `CallerAuthority` wins, every subsequent host call refuses with the stored cause. Pure JavaScript without host calls continues. This closed policy is intentionally stricter than trying to classify utility host operations as pure.

Worker completion must check the latch for every result, not only `Ok` or `SNAPBACK_HANDLER_DID_NOT_SETTLE` as it currently does at [server.rs:2941](crates/snapback-server/src/server.rs:2941). A caught refusal followed by `return "success"` is replaced with the stored authority error. The exact stored error then passes through the action’s existing secret redactor.

For streaming actions, the attempt token remains an initiation acknowledgement, not a terminal success, as already documented at [server.rs:28332](crates/snapback-server/src/server.rs:28332). The terminal ring record and attempt state must use the latched authority cause.

## 3. Bounded commit capsule interaction

The action implementation relies on the landed capsule only for:

- Reservation before queued Local acquisition.
- One absolute final-cut admission deadline.
- FIFO managed-writer acquisition.
- Cancellation dropping the queue waiter and caller permits.
- Retaining the reservation through the synchronous commit attempt.
- Acquiring mode last.

It does not rely on the capsule for:

- Common `AppState`/authority/database origin. The current destination check explicitly lacks that seal at [commit_capsule.rs:79](crates/snapback-server/src/server/commit_capsule.rs:79).
- Preventing captured raw authorities or alternate commit paths; the transaction wrapper acknowledges that residual at [commit_capsule.rs:176](crates/snapback-server/src/server/commit_capsule.rs:176).
- Proving that `PendingCommit` represents the intended database or operation. The trait is open and admits fake or redirected success at [commit_capsule.rs:148](crates/snapback-server/src/server/commit_capsule.rs:148).
- A structural COMMIT seal or unique semantic intent. `FinalCommitCut` expressly does not prove those properties at [commit_capsule.rs:572](crates/snapback-server/src/server/commit_capsule.rs:572).
- Same-ID replay safety or non-bypass.

Therefore nested mutations should use the factored bounded reservation/writer-acquisition primitive, but retain their existing kernel commit callbacks as the exact SQLite cut. Do not create an open `PendingCommit` adapter merely to claim full capsule adoption; without a kernel-minted pending mutation type, that would add indirection without a stronger guarantee.

The capsule residuals remain open and are neither solved nor assumed away by this fix.

## 4. Watchdog interaction

The state transition is first-wins:

```text
Live -- caller terminal refusal --> CallerAuthority(cause)
Live -- watchdog under commit_gate --> WatchdogTimeout(error)
Terminal -- any later cause -------> unchanged
```

The watchdog linearizer at [server.rs:2617](crates/snapback-server/src/server.rs:2617) must:

1. Acquire `commit_gate`.
2. Attempt to latch `WatchdogTimeout`.
3. Set `abandoned = true`.
4. Cancel the current room wait and bounded writer acquisition.
5. Release `commit_gate`.

Legal races:

- Terminal premark first: the caller reservation refuses, latches the authority cause, and no transaction starts.
- Caller reservation first: logout/retirement drains that exact permit. The mutation may commit. A later authority latch must not retroactively abort it.
- Watchdog first: the action gate closes before abandonment is published; queued work is cancelled or a later final callback observes `WatchdogTimeout` and rolls back.
- Mutation final gate first: the watchdog waits only for identity recording and SQLite COMMIT, because the gate is acquired at the storage callback, not around handler or Local waiting.

There is no lock cycle:

- Logout owns authority terminal gates and drains lock-free counters.
- The worker queues for Local while holding only owned permits.
- The final transaction acquires action gate, then service witness, then mode.
- The watchdog acquires only the action gate and cancellation state; it never waits for Local.

Trusted stream settlement must remain outside action liveness validation. The provider-settle call may refuse after abandonment, but the unconditional invocation terminalizer at [server.rs:3005](crates/snapback-server/src/server.rs:3005), watchdog terminalizer at [server.rs:3095](crates/snapback-server/src/server.rs:3095), and trusted flush must still run. This preserves terminalization after abandonment.

If caller authority latched before the watchdog, the watchdog still enforces evaluator teardown, but the reported action outcome and stream cause remain the stored authority cause (`Cancelled`), augmented only with operational watchdog facts. If the watchdog latched first, the outcome remains `SNAPBACK_ACTION_TIMEOUT`/`TimedOut`.

The action latch prevents double causal outcomes; the existing stream terminal compare-and-set prevents duplicate durable terminals.

## 5. Migration inventory

| Site | Required change | Nature |
|---|---|---|
| Authority reservation at [invocation.rs:1763](crates/snapback-sync/src/auth/invocation.rs:1763) and commit guard at [invocation.rs:1293](crates/snapback-sync/src/auth/invocation.rs:1293) | Add classified siblings; preserve existing error-returning wrappers | Judgment |
| Session reservation at [session_projection.rs:658](crates/snapback-sync/src/auth/session_projection.rs:658) | Return typed stream/session refusal under the existing locks | Judgment |
| Service reservation at [service_fence.rs:533](crates/snapback-auth/src/auth/service_fence.rs:533) | Distinguish terminal/pending retirement from transient unavailability | Judgment |
| Capsule queue at [commit_capsule.rs:748](crates/snapback-server/src/server/commit_capsule.rs:748) | Factor private bounded reservation/FIFO acquisition primitive; keep capsule behavior unchanged | Judgment |
| `DetachedIbexAction` and `ManagedHostPlanAction` at [engine.rs:1914](crates/snapback-engine/src/local/engine.rs:1914), [engine.rs:2090](crates/snapback-engine/src/local/engine.rs:2090) | Carry explicit ownership posture and shared terminal latch | Mechanical after posture design |
| `DetachedActionHost` at [server.rs:669](crates/snapback-server/src/server.rs:669) and construction around [server.rs:2805](crates/snapback-server/src/server.rs:2805) | Carry latch, watchdog cancellation, runtime acquisition handle, and ownership posture | Judgment |
| Detached HostPlan child at [server.rs:1335](crates/snapback-server/src/server.rs:1335) | Reserve child authority after room wait; bounded reacquire; drop before after-local | Mechanical |
| Detached Ibex child at [server.rs:1439](crates/snapback-server/src/server.rs:1439) | Same, using `binding.invocation.authority()` | Mechanical |
| HostPlan final closure at [engine.rs:18076](crates/snapback-engine/src/local/engine.rs:18076) | Replace mode-first guard with action-first, authorized-effect-last | Mechanical |
| Ibex final closure at [engine.rs:18380](crates/snapback-engine/src/local/engine.rs:18380) | Same | Mechanical |
| Managed executor at [server.rs:3137](crates/snapback-server/src/server.rs:3137) | Replace generic helper with forced-split per-step helper; finish through latch | Judgment |
| Managed action staging at [engine.rs:27905](crates/snapback-engine/src/local/engine.rs:27905) | Expose exact staged child authority to the split executor | Mechanical |
| App route at [server.rs:3238](crates/snapback-server/src/server.rs:3238), cron at [server.rs:3373](crates/snapback-server/src/server.rs:3373), watch at [server.rs:3486](crates/snapback-server/src/server.rs:3486), jobs at [server.rs:3588](crates/snapback-server/src/server.rs:3588), config verification at [server.rs:21083](crates/snapback-server/src/server.rs:21083) | No control-flow change; pass the staged posture/latch through | Mechanical |
| HTTP action staging/result path at [server.rs:28268](crates/snapback-server/src/server.rs:28268) and [server.rs:28393](crates/snapback-server/src/server.rs:28393) | Ensure session/service roots are explicitly caller-bound; terminal ring uses final latched outcome | Judgment |
| Kernel cuts at [storage.rs:6253](crates/snapback-kernel/src/storage.rs:6253) and [storage.rs:7208](crates/snapback-kernel/src/storage.rs:7208) | No transaction restructuring; add proof hooks only | Mechanical |
| Legacy `LocalIbexActionHost` at [engine.rs:4378](crates/snapback-engine/src/local/engine.rs:4378) and in-lock invocation at [engine.rs:27960](crates/snapback-engine/src/local/engine.rs:27960) | Make finite caller authority unrepresentable; it cannot reserve safely while Local is held | Judgment |
| Embedded admin at [engine.rs:22413](crates/snapback-engine/src/local/engine.rs:22413), local dev at [engine.rs:22537](crates/snapback-engine/src/local/engine.rs:22537), embedded config at [engine.rs:23450](crates/snapback-engine/src/local/engine.rs:23450), in-lock cron at [engine.rs:27729](crates/snapback-engine/src/local/engine.rs:27729) | Audit and type-classify as operator/dev/system only; refactor off Local if any session/service authority is found | Judgment |

The existing AST inventory at [server/tests.rs:30548](crates/snapback-server/src/server/tests.rs:30548) remains supplementary evidence only. It cannot prove that the selected executor actually invokes its guarded closure.

## 6. Tests and false-green resistance

| Test and oracle | Shortest violating production mutation that could leave a naïve test green | Required strengthening |
|---|---|---|
| **T1 — terminal wins, real HTTP route.** Matrix: session logout and scoped-service retirement × HostPlan and Ibex child. Pause inside the production reservation primitive after non-empty child staging and before reservation; complete terminal mutation; capture the post-terminal database image; release. Assert exact authority error, failed action outcome, unchanged app row/version/journal/job state and unchanged database image after release. | Skip the nested closure entirely while a result-handoff fence still returns an auth error. Error-only and row-count-only tests would pass. | Assert the exact production pause was reached once, the staged/buffered effect was non-empty, and compare the full post-terminal database image. This test must be run against the parent implementation before the fix. It is expected to fail because the child row/version commits after terminalization. Capture that red result; this is the mandatory watched failure. |
| **T2 — managed HostPlan neutral fast path.** Pause after staging an authorization-neutral insert but before current first-turn commit; let logout premark close reservations; release. Assert no commit and latched refusal. | Change the fixture to touch an authorization room; the generic helper then splits and the neutral exposure disappears. | Assert `NoAuthorizationEvent`, assert Local was released before caller reservation, and use an ordinary app-table insert. |
| **T3 — reservation wins.** Matrix across session/service and HostPlan/Ibex. Pause immediately after the exact child reservation. Start terminalization; prove new reservations refuse and the terminal transaction remains in drain; release; assert child commit precedes terminal completion. | An unrelated leaked permit could block terminalization while an unfenced child commits. | Give test reservations unique test identities; assert the pause belongs to the child’s reservation, no unrelated permits exist, and deleting the child reservation call prevents the pause and fails the test. |
| **T4 — final guard order and retention.** For both storage cuts, record: action gate acquired while no mode guard is held; mode guard acquired while action gate is held; both are held at the actual storage pre-COMMIT hook; retirement remains blocked until COMMIT returns. | Acquire both guards in a test wrapper while production still takes them in the wrong order, or use a sentinel callback that is never invoked. | Put invocation counters in the production action-gate callback, `AuthorizedEffectReservation` pre-guard hook, and actual storage pre-COMMIT hook. Require each exactly once and assert ordering from those counters. Mutants removing either guard or reversing acquisition must fail. |
| **T5 — caught refusal cannot become success.** Ibex catches the first refused mutation, performs pure JS, attempts a second distinct mutation, catches again, and returns `"success"`. Assert both durable sentinels absent, second target staging count zero, both host errors carry the same latched cause, and the outer result is that authority error. | Always fail final action publication while allowing the second nested mutation to run, or use two no-op/aliased targets. | Use distinct non-empty mutations, assert both database witnesses, assert the latch was set once, and assert the second target never staged. Removing the final latch override or the host-call latch check must independently fail. |
| **T6 — authority cause survives watchdog.** After T5’s first refusal, catch it and busy-loop beyond the watchdog. Assert the watchdog linearizer ran, evaluator/worker count returns to baseline within the bound, no write occurs, and the reported outcome remains the stored auth cause rather than `ACTION_TIMEOUT`. | Let the action exit cooperatively before the watchdog. | Use a Hermes loop known to require async interruption, a test-only watchdog-linearizer counter, and the worker counter already used by the action thread. |
| **T7 — watchdog/commit-gate orderings.** Case A: watchdog owns the gate first, so no later COMMIT. Case B: transaction owns action gate and mode guard first, so COMMIT completes before watchdog terminalization. Bound all waits and assert durable/order witnesses. | Serialize before the actual gate or assert only `abandoned`, allowing a commit after the reported timeout. | Pause inside the real storage `before_commit` callback and record COMMIT return before releasing the action gate. Assert no durable change occurs after watchdog publication in Case A. |
| **T8 — terminalization after abandonment.** Extend [server/tests.rs:26827](crates/snapback-server/src/server/tests.rs:26827): provider settlement is attempted after abandonment and refuses; the unconditional trusted terminalizer installs exactly one durable winner and flushes it. Cover watchdog-first and authority-latch-first causes. | Delete the provider-settlement invocation; the trusted backstop alone still produces the expected terminal, recreating the historical false sentinel. | Require counters proving provider settlement closure invoked and refused, trusted fallback invoked, terminal CAS won once, and flush completed. |
| **T9 — bounded queue and permit drain.** Hold Local, queue an action after its exact reservation, expire the five-second/action deadline, and assert writer timeout with `effectCommitted:false`, no row, room cancellation, zero exact authority-work count, logout drain completion, and FIFO order among surviving waiters. | Time out before reservation, so no permit was ever at risk. | Arm the timeout only after the exact after-reservation hook and assert the authority-work count is nonzero before queueing and zero after cancellation. |
| **T10 — legacy path exclusion.** Compile-fail proof that `LocalIbexActionHost` cannot be constructed from Session or ServicePrincipal posture; exhaustive runtime classification proves every served finite action routes through managed/detached execution. | Rename/wrap a call so the current AST name inventory passes while the executor never calls its closure. | Enforce the ownership restriction in the constructor/type system. Keep AST inventory only as a secondary route census; T1–T5 provide semantic proof. |

Required mutation checks before acceptance:

- Remove the per-child reservation: T1/T2 must fail.
- Replace the authorized commit guard with mode-only: T3/T4 must fail.
- Skip final latch override: T5 must fail.
- Skip host-call latch check: T5’s second mutation must commit or stage, failing the test.
- Guard the trusted terminalizer with `validate_live`: T8 must fail.
- Move timeout before reservation: T9 must fail.

### 2026-08-23 final-gate coverage note

The scoped-service regression proves eventual pre-commit terminal latching after retirement, not
which observer latches the cause: the classified persistence check in
`stage_nested_mutation_classified` and the later `reserve_nested_effect` cut can detect the same
terminal state. Deleting the former therefore leaves this regression green. Its operation-coverage
lane returns `Ok(None)`, so it does not execute `covered_host_child_identity_classified`; no oracle
in this regression pins the classified staging observer or its `live_readonly` Carrier branch.
Those observer-specific claims remain supported by typed call-graph inspection. Separate focused
regressions exercise the repeated classified function-policy check and the classified persistence
check reached through managed HostPlan's legacy recorded-mutation staging pipeline.

## 7. Risks and reshape triggers

- If session/service layers cannot return a typed pending-terminal cause without parsing diagnostics, implement that source classification first. Do not latch every `*_UNAVAILABLE` error as terminal.
- If any session or scoped-service caller reaches `LocalIbexActionHost`, this design cannot be applied in place: reserving there would violate split phase because Local is already held. That route must move to the detached/managed executor.
- If blocking a Tokio handle from the native action thread is unsafe during runtime shutdown or on a current-thread runtime, replace it with an async acquisition broker. Do not fall back to unbounded locking or polling `try_lock`.
- If the common five-second writer budget is too short for a demonstrated site, use an explicit finite override bounded by the action deadline. Never hold a caller permit through an unbounded Local wait.
- The budget bounds admission to the final cut, not SQLite COMMIT duration. Once COMMIT starts, timeout cannot reinterpret the outcome.
- This fix does not structurally seal origin or commit, solve same-ID replay, or fence irreversible outbound effects. Any requirement for those properties requires a kernel-minted pending mutation type and the separate capsule-residual/handoff work.
- Rejecting every host call after a caller terminal latch is the closed safe policy. If pure utility host calls must remain available, add a small explicit whitelist; new operations must default to authority-bearing.
- If tests cannot observe the actual production closure and actual storage cut, stop and add those seams before implementation. A passing test without those observations is not evidence for this fence.
