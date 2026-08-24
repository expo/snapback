# Design: the stream-attempt refactor that must land before any stream fence

Status: Open — R1 and R2 landed; R3 needs its recorded API amendment; R4 ruling resolved
Created: 2026-08-22
Related: issues/20260821-stream-attempt-fence-blocked-on-flush-api.md,
issues/20260821-residual-caller-terminal-write-exposure.md, LLP 0058, LLP 0076, LLP 0204

## Shape

One **ordered, process-local transition journal per attempt**. Each entry carries immutable
provenance, exact owner, revision, delta and materialized snapshot. Flushes accept typed receipts
from that journal and **never scan "all dirty rows"**.

Chosen over three independent queues (which lose cross-provenance ordering on the same row) and
over a single mutable provenance field (which would relabel an earlier unflushed transition when a
later one overwrites it). The current registry has exactly that lossy shape: one mutable record
plus one dirty token set.

Provenance is carried in the type system, not by convention: `PendingAttemptWrite<P>` with private
fields, **no retagging conversion**, and three flush entry points that each accept only their
marker type. The tag originates at the transition, never at flush time, derived centrally from
`PreparedAuthority` — which is the right boundary because it already holds source, mode, resolved
authority and publication carriers.

**Terminal cause is never consulted.** Cause and `settled_by` are already orthogonal, so `complete`
cannot imply caller or host provenance. That is the precise defect the current code has.

## Staged migration — R1/R2 landed; R3/R4 remain

| Stage | Change | Boundary invariant |
|---|---|---|
| R1 | Split authored/provider/automatic terminal APIs; add opaque provenance origins and the shared runner gate identity. Legacy persistence stays. | Every transition classified at origin; automatic/provider terminalization no longer enters the authored method. No fence exists. |
| R2 | Put the batch upsert inside one `IMMEDIATE` transaction; add the one-shot `before_commit` seam. | A legacy mixed batch is still semantically mixed, but all-or-nothing rather than partially durable. |
| **R3 — atomic** | Replace the dirty set with the ordered delta journal; convert call sites to typed receipts; add selective caller/mode/host flushes; delete `dirty_snapshots` and every untyped adapter. | No transaction can contain different provenance, owners or runner gates. Host drains cannot select caller/mode rows. |
| **R4 — atomic** | Wire caller/mode final cuts to runner gates; make watchdog/worker-death terminalization an owned durable host transaction; reorder transcripts after terminal commit. | Abandonment and caller commit have one linearization order; a successful watchdog timeout has a durable winner; recovery never consults caller/mode authority. |

**No stage may add a stream authority fence. The first fence may land only after R4.**

No durable schema migration is needed — provenance, owner, revisions and pending deltas are all
process-local; the durable attempt JSON is unchanged.

## Behaviour that must NOT change

Cursor premark stays durable before HTTP. Terminal cause, effect-certainty folding, runner
generation and first-durable-terminal-winner stay unchanged. Host transport outcomes, counters,
close, recovery and transcript repair remain possible **after caller/session retirement** — this
is the property whose violation would strand streams forever. Genuine crashes without a committed
watchdog terminal still reconcile conservatively to `failed`. A transcript never becomes durable
before its terminal attempt.

## Intentional corrections

Automatic/provider settlement records `settled_by: Terminalizer`, not `Authored`. Mixed-batch
failure becomes all-or-nothing. A failed required caller flush is aborted rather than left
available for an unrelated trusted flush. **A completed watchdog timeout survives database reopen
as `timed_out`** instead of being reconciled to `failed`.

## AUTHOR RULING — RESOLVED 2026-08-22

The author selected a bounded terminal transaction: handler execution remains
time-bounded, while the response waits for durable terminal settlement;
permanent storage failure returns a storage failure and retains an owned
retry. See `issues/20260822-author-rulings-fence-program.md`.

**Watchdog durability versus the never-wait-for-Local rule.** The watchdog today explicitly
refuses to wait for `LocalSnapback` (`crates/snapback-server/src/server.rs:2999`), because a wedged
owner could otherwise defeat the timeout. But a crash-safe `timed_out` linearization using the
existing database owner requires acquiring Local before the runner gate.

- *Recommended:* handler execution stays time-bounded, but the response waits for the bounded
  terminal transaction; permanent storage failure returns a storage failure and keeps an owned
  retry pending.
- *Alternative:* preserve the no-Local-wait rule with a separate host settlement connection/lane.
  Materially larger, and must address reset/schema/SQLite-writer ordering.
- *Rejected:* return timeout before durability and retry in the background — does not give the
  immediate-reopen guarantee.

Secondary, non-blocking: anonymous connection authority can be classified
`CallerAuthorized(ConnectionBound)`, but the eventual fence still needs the connection-grant
ruling from the stream ticket. It does not block R1–R4 because no fence is added.

## Riskiest step

R4. It is safe only with the Local/watchdog ruling settled, one ordered journal that can discard
provisional caller state, a single atomic terminal batch, the runner gate held through registry
acknowledgement, and an immediate fresh-database reopen test. Most important invariant: **every
recovery and terminal host API must be structurally incapable of accepting a caller reservation or
mode guard.**

## Provenance

Read-only codex design against `81b6a6160`. Full design with per-stage tests and file:line
citations appended below.

---

The refactor should use one ordered, process-local transition journal per attempt. Each journal entry carries immutable provenance, exact owner, revision, delta, and materialized snapshot. Flushes accept typed receipts from that journal; they never scan “all dirty rows.”

This is preferable to three independent queues: separate queues would lose cross-provenance ordering on the same row, while a single mutable provenance field could relabel an earlier unflushed transition when a later transition overwrites it. The current registry has exactly that lossy shape: one mutable record plus one dirty token set. [stream_attempt.rs:78](crates/snapback-sync/src/stream_attempt.rs:78) [stream_attempt.rs:131](crates/snapback-sync/src/stream_attempt.rs:131)

## 1. Provenance carrier

Proposed core types:

```rust
struct PendingAttemptWrite<P> {
    key: PendingWriteKey,       // namespace, attempt token, revision
    owner: StreamWriteOwner,    // exact invocation/request authority owner
    commit_gate: Arc<InvocationCommitGate>,
    _provenance: PhantomData<P>,
}

enum PendingAttemptWriteAny {
    CallerAuthorized(PendingAttemptWrite<CallerAuthorized>),
    ModeOnly(PendingAttemptWrite<ModeOnly>),
    HostSettlement(PendingAttemptWrite<HostSettlement>),
}

struct PendingAttemptDelta {
    revision: u64,
    batch_id: StreamWriteBatchId,
    owner: StreamWriteOwner,
    provenance: StreamAttemptProvenance,
    delta: StreamAttemptDelta,
    snapshot_after: PersistedStreamAttempt,
    state: Queued | InFlight(StreamFlushId),
}
```

`PendingAttemptWrite<P>` has private fields and no retagging conversion. The three flush entry points accept only their corresponding marker type. The internal erased enum exists solely inside the registry.

The tag originates at the transition, never at flush time:

- Fresh start, takeover, cursor premark, authored settle, and direct cancellation take an opaque caller/mode origin derived centrally from `PreparedAuthority`.
- Counters, transport observations, close, terminal adoption, provider/automatic settlement, watchdog, worker death, and recovery enter separate host methods.
- Terminal cause is not consulted. Cause and `settled_by` are already orthogonal fields, so `complete` cannot imply caller or host provenance. [stream_attempt.rs:23](crates/snapback-types/src/stream_attempt.rs:23) [stream_attempt.rs:67](crates/snapback-types/src/stream_attempt.rs:67)

`PreparedAuthority` is the correct closed constructor boundary because it already contains source, mode, resolved authority, and publication carriers, and exposes the relevant read-only classifications. [invocation.rs:1183](crates/snapback-sync/src/auth/invocation.rs:1183) [invocation.rs:1336](crates/snapback-sync/src/auth/invocation.rs:1336)

The registry APIs should be split along these lines:

```rust
stage_start_caller(...)
stage_start_mode(...)
stage_cursor_premark_caller(...)
stage_cursor_premark_mode(...)
stage_authored_terminal_caller(...)
stage_authored_terminal_mode(...)
stage_initiator_cancel_caller(...)
stage_initiator_cancel_mode(...)

record_transport_outcome_host(...)
record_cursor_close_host(...)
record_progress_commit_host(...)
record_emit_counters_host(...)
adopt_terminal_host(...)
settle_provider_outcome_host(...)
terminalize_invocation_host(...)
```

The JS runtime trait’s `settle_stream_attempt` remains authored-only. The worker completion path must call the host terminalizer directly. Today both converge on `DetachedActionHost::settle_stream_attempt`, which calls the registry’s authored `settle`; that constructor hard-codes `settled_by: Authored`. [server.rs:2442](crates/snapback-server/src/server.rs:2442) [stream_attempt.rs:879](crates/snapback-sync/src/stream_attempt.rs:879) [stream_attempt.rs:903](crates/snapback-sync/src/stream_attempt.rs:903) The automatic worker call is at [server.rs:2932](crates/snapback-server/src/server.rs:2932), while the authored JS entry is at [host_glue.rs:4243](crates/snapback-engine/src/runtime/host_glue.rs:4243).

A start operation may return a branch-dependent typed write:

```rust
enum StartWrite<P> {
    NoWrite,                    // current live runner, nothing changed
    NewEffect(PendingAttemptWrite<P>),
    TerminalAdoption(PendingAttemptWrite<HostSettlement>),
}
```

That matches the existing branch where a persisted terminal row produces no lease, whereas a live-row takeover advances the generation. [stream_attempt.rs:327](crates/snapback-sync/src/stream_attempt.rs:327) [stream_attempt.rs:369](crates/snapback-sync/src/stream_attempt.rs:369) [stream_attempt.rs:428](crates/snapback-sync/src/stream_attempt.rs:428)

Provenance must remain process-local. It should not be added to `record_json`: after restart, recovery owns every surviving nonterminal durable row and must not rediscover a retired caller tag and attempt to fence against it. Startup already reads durable rows and terminalizes nonterminal ones without caller authority. [engine.rs:25281](crates/snapback-engine/src/local/engine.rs:25281) [stream_attempt.rs:149](crates/snapback-types/src/stream_attempt.rs:149)

## 2. Selective flush and ordering

Replace `dirty_snapshots(namespace)` with two kinds of selection:

```rust
registry.prepare_exact_flush(&PendingAttemptBatch<P>)
registry.prepare_host_flush(namespace, optional_runner)
```

An exact batch is keyed by:

```text
provenance + exact owner + commit-gate identity + operation batch id
```

Provenance alone is insufficient: two session callers in the same namespace cannot authorize each other’s writes even though both are `CallerAuthorized`.

Selection rules:

1. For each attempt, only a contiguous pending prefix may become durable.
2. A typed flush may consume only entries matching its provenance and exact owner.
3. Consecutive matching deltas for one attempt may be collapsed to the last `snapshot_after`.
4. A revision selected by another in-flight flush is unavailable.
5. Commit acknowledges exact revisions, not current snapshot equality.
6. Rollback clears the in-flight mark and leaves host entries pending; required caller/mode failures abort their own uncommitted deltas and rebase the working record.

The delta is required in addition to `snapshot_after`. Without it, abandonment could not remove an uncommitted authored terminal while retaining an earlier host-observed counter or transport outcome: later whole-row snapshots already contain the discarded caller fields.

Rows of other provenance are not picked up “by whichever flush runs next”:

- Different attempts: they remain queued and do not delay an eligible batch.
- Same attempt: they preserve revision order. A later class waits until the predecessor commits or aborts.
- Caller/mode required writes own and complete their exact flush before returning success.
- Host writes are retried by the host settlement pump or startup recovery.
- Once abandonment wins, its host proof may discard/rebase uncommitted caller/mode entries, so host terminalization never waits for a retired session.

Current `clear_flushed` protects concurrent updates only by comparing an entire current snapshot. [stream_attempt.rs:489](crates/snapback-sync/src/stream_attempt.rs:489) [stream_attempt.rs:500](crates/snapback-sync/src/stream_attempt.rs:500) Replace that with `commit_flush(flush_id, committed_revisions)` and `rollback_flush(flush_id)`.

Ordering guarantees are therefore:

- Per attempt: total revision order and durable-prefix order.
- Per flush: all selected rows become visible atomically.
- Across unrelated attempts or separate flushes: no new global order.
- Terminal settlement: first durable terminal winner, not merely first provisional registry mutation.
- Recovery: direct host settlement, independent of all process-local queues and authority state.

The write-ahead premark ordering must remain exact: its caller/mode flush completes before outbound bytes. That is the current contract at [server.rs:1736](crates/snapback-server/src/server.rs:1736) through [server.rs:1753](crates/snapback-server/src/server.rs:1753).

## 3. Containing transaction and commit cut

`upsert_stream_attempts` currently executes one autocommit per row. [settlement.rs:11](crates/snapback-kernel/src/storage/settlement.rs:11) The replacement should follow the repository’s existing guarded-transaction pattern:

```rust
fn upsert_stream_attempt_batch_guarded<G>(
    &mut self,
    rows: &[StreamAttemptRow],
    before_commit: impl FnOnce() -> SnapbackResult<G>,
) -> SnapbackResult<()>
{
    let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;

    for row in rows {
        tx.execute(UPSERT_STREAM_ATTEMPT, row.params())?;
    }

    let _commit_guard = before_commit()?;
    tx.commit()?;
    Ok(())
}
```

The same pattern already stages all fallible work, acquires one final guard, and holds it through `COMMIT`. [asset_attempts.rs:234](crates/snapback-kernel/src/storage/asset_attempts.rs:234) [asset_attempts.rs:250](crates/snapback-kernel/src/storage/asset_attempts.rs:250)

Required ordering for caller/mode batches:

```text
materialize typed batch
→ acquire LocalSnapback
→ acquire the batch’s InvocationCommitGate and recheck live state
→ open/stage one SQLite transaction
→ invoke before_commit exactly once
→ COMMIT
→ drop the admission guard
→ acknowledge exact registry revisions while InvocationCommitGate remains held
→ release InvocationCommitGate and LocalSnapback
```

Holding the action gate through registry acknowledgement is important: abandonment must see either a committed-and-acknowledged predecessor or an abortable provisional delta, never an ambiguous committed candidate.

The future authority fence can plug into `before_commit`, but this refactor must pass `|| Ok(())` until step 4. This is only a seam, not a fence design.

Non-reentrancy is strict. `AdmissionEffectGuard` contains a `MutexGuard<AdmissionState>`. [admission.rs:150](crates/snapback-auth/src/auth/admission.rs:150) [admission.rs:1002](crates/snapback-auth/src/auth/admission.rs:1002) Both ordinary validation and effect-guard acquisition lock that same mutex. [admission.rs:938](crates/snapback-auth/src/auth/admission.rs:938) [admission.rs:947](crates/snapback-auth/src/auth/admission.rs:947) Therefore, after `before_commit` returns an admission guard, the storage method may do only `tx.commit()`. It must not call:

- `validate_admission`;
- `mode_effect_guard` or `commit_guard` again;
- a registry transition that might inspect authority;
- after-Local work.

Registry acknowledgement occurs after that admission guard has dropped, though still under the independent invocation commit gate.

Transcripts are not part of this transaction. The terminal attempt commits first; transcript settlement follows as host work. Current Ask and cancellation code performs these as sequential storage calls. [server.rs:25165](crates/snapback-server/src/server.rs:25165) [server.rs:28139](crates/snapback-server/src/server.rs:28139) Platform ownership is explicit in LLP 0204. [LLP 0204:718](llp/0204-app-external-surfaces.rfc.md:718) [LLP 0204:738](llp/0204-app-external-surfaces.rfc.md:738)

## 4. Durable abandonment

Use the existing attempt terminal as the durable marker; do not add a separate abandonment table.

For every nonterminal attempt held by the abandoned runner, the watchdog transaction writes:

```text
terminal.cause = timed_out
terminal.settled_by = terminalizer
terminal.effect_may_have_executed = current cursor fold
settled_at_ms = watchdog settlement time
all cursors open = false
```

Those fields already exist in `PersistedStreamAttempt` and `StreamAttemptTerminal`. [stream_attempt.rs:74](crates/snapback-types/src/stream_attempt.rs:74) [stream_attempt.rs:109](crates/snapback-types/src/stream_attempt.rs:109)

**INFERRED:** no new durable row is required for the stream subsystem. A committed terminal is enough because startup leaves terminal rows unchanged and only converts nonterminal rows to `failed`. Confirm this with the required immediate-reopen watchdog test. [stream_attempt.rs:158](crates/snapback-types/src/stream_attempt.rs:158)

Move the existing gate into a shared runner-owned object:

```rust
struct InvocationCommitGate {
    state: Mutex<InvocationCommitState>,
    abandoned: Arc<AtomicBool>,
}

enum InvocationCommitState {
    Live,
    Abandoning,
    Abandoned,
}
```

`StreamRunnerIdentity` and each runner holder retain the same `Arc`. Today the runner stores only abandonment/finished flags, while the gate is a separate `DetachedActionHost` field. [stream_attempt.rs:226](crates/snapback-sync/src/stream_attempt.rs:226) [server.rs:757](crates/snapback-server/src/server.rs:757) The detached launcher already creates them together, so unifying their identity is local. [server.rs:2748](crates/snapback-server/src/server.rs:2748)

Every caller/mode receipt carries the exact runner gate. Direct cancellation obtains the target attempt’s runner gate from the registry. Thus no optional “maybe guarded” path exists.

Watchdog protocol:

1. Acquire `LocalSnapback` without holding `InvocationCommitGate`.
2. Acquire the runner gate and transition `Live → Abandoning`.
3. Under the registry mutex, invalidate all uncommitted caller/mode deltas that conflict with abandonment and prepare one `HostSettlement` batch for every nonterminal attempt held by that runner.
4. Write the complete host batch in one SQLite transaction, with no caller reservation and no mode/admission guard.
5. Commit and acknowledge the exact host revisions.
6. Set the process-live abandoned flag and state `Abandoned`.
7. Release the runner gate and `LocalSnapback`.
8. Cancel the room reservation only after leaving Local and process locks.
9. Insert/repair transcripts as later host settlement.

The room cancellation must be after Local because the locking spec forbids room/process locks inside the managed Local scope. [LLP 0059:747](llp/0059-session-projection-and-client-barrier.spec.md:747) [LLP 0059:768](llp/0059-session-projection-and-client-barrier.spec.md:768)

Race resolution:

| Winner | Result |
|---|---|
| Caller owns Local + runner gate first | Its transaction commits and registry acknowledgement completes before abandonment. Watchdog then terminalizes only what remains nonterminal. |
| Watchdog owns Local + runner gate first | Provisional caller/mode deltas are invalidated; the host `timed_out` batch commits; the caller later receives `SNAPBACK_ACTION_TIMEOUT`. |
| Caller merely reserved future authority | Reservation alone does not win. If it has not reached the runner gate, abandonment wins and the reservation is dropped unused. |
| Caller owns runner gate but the later final guard refuses | SQLite rolls back, the caller delta aborts, then watchdog may terminalize without that refused guard. |
| Attempt already has a durable terminal | Abandonment does not overwrite it; first durable terminal remains authoritative. |

The current final gate helper already rechecks abandonment after acquiring the gate and returns the timeout error. [server.rs:1252](crates/snapback-server/src/server.rs:1252) The current registry CAS also preserves the first terminal winner. [stream_attempt.rs:879](crates/snapback-sync/src/stream_attempt.rs:879) [stream_attempt.rs:924](crates/snapback-sync/src/stream_attempt.rs:924)

Host terminalization receives an opaque `AbandonmentProof`, `WorkerDeathProof`, `AutomaticCompletionProof`, or `RecoveryProof`. None contains `PreparedAuthority`; host persistence accepts no caller/mode carrier. This is the type-level guarantee that a retired session cannot strand recovery.

## 5. Migration plan

The work can land in stages, but two individual stages have atomic cutovers.

| Stage | Change | Boundary invariant |
|---|---|---|
| R1 | Split authored/provider/automatic terminal APIs; add opaque provenance origins and the shared runner gate identity. Keep legacy persistence temporarily. | Every transition is classified at origin; automatic/provider terminalization no longer enters the authored method. No fence exists. |
| R2 | Put the existing batch upsert inside one `IMMEDIATE` transaction and add the one-shot `before_commit` seam. | A legacy mixed batch is still semantically mixed, but it is all-or-nothing rather than partially durable. |
| R3 — atomic | Replace the dirty set with the ordered delta journal; convert every call site to exact typed receipts; add selective caller/mode/host flushes; delete `dirty_snapshots` and every untyped adapter. | No transaction can contain different provenance, owners, or runner gates. Host drains cannot select caller/mode rows. |
| R4 — atomic | Wire caller/mode final cuts to runner gates; make watchdog/worker-death terminalization an owned durable host transaction; reorder transcripts after terminal commit. | Abandonment and caller commit have one linearization order; successful watchdog timeout has a durable winner; recovery never consults caller/mode authority. |

No stage may add a stream authority fence. The first stream fence may land only after R4.

There is no durable schema migration: provenance, owner, revisions, and pending deltas are process-local; the durable attempt JSON remains unchanged. The table already stores one opaque record per unique token/client key. [storage.rs:6469](crates/snapback-kernel/src/storage.rs:6469)

Behavior that must not change:

- Cursor premark remains durable before HTTP.
- Terminal cause, effect-certainty folding, runner generation, and first durable terminal winner remain unchanged.
- Host transport outcomes, counters, close, recovery, and transcript repair remain possible after caller/session retirement.
- Genuine process crashes without a committed watchdog terminal still reconcile conservatively to `failed`.
- Existing successful caller operations still return only after their required attempt state is durable.
- A transcript never becomes durable before its terminal attempt.

Intentional corrections:

- Automatic/provider settlement records `settled_by: Terminalizer`, not `Authored`.
- Mixed-batch failure becomes all-or-nothing.
- A failed required caller flush is aborted, not left available for an unrelated trusted flush.
- A completed watchdog timeout survives database reopen as `timed_out`.

## Tests required at each stage

R1:

- Compile-fail tests proving caller, mode, and host receipts cannot be passed to another flush lane.
- Same terminal cause through JS and automatic completion produces different provenance and `settled_by`.
- Exact table-driven assertion of the ticket’s classified entry points.
- Terminal adoption returns a host receipt; fresh/takeover returns caller or mode.

R2:

- Inject failure on row 2 with a temporary SQLite trigger; assert row 1 did not commit.
- Assert `before_commit` runs exactly once per batch and is held through `COMMIT`.
- Assert callback failure rolls back every row.

R3:

- Two unrelated caller rows in one namespace: flushing A leaves B untouched.
- Caller row plus host row dirty simultaneously: neither typed flush can persist the other.
- Same attempt with caller revision N and host revision N+1: host cannot skip N.
- Abort N and verify host N+1 is rebased without caller fields.
- Concurrent update during an in-flight flush remains queued after exact acknowledgement.
- Host flush after retired session/mode succeeds without admission validation.
- Repository-wide compile check proves no `dirty_snapshots` or raw `upsert_stream_attempts` caller remains. **INFERRED:** the current typed kernel/wrapper inventory appears closed; deletion plus `rg`/compile confirms it. [settlement.rs:686](crates/snapback-kernel/src/storage/settlement.rs:686) [engine.rs:7200](crates/snapback-engine/src/local/engine.rs:7200)

R4:

- Barrier: caller owns gate first; caller row commits, then watchdog terminal commits.
- Barrier: watchdog owns gate first; caller transaction rolls back and observes timeout.
- Authored `complete` versus watchdog `timed_out`, proving the durable-cut winner rather than provisional call order.
- Cancellation versus automatic completion, preserving the winner verbatim.
- Multiple attempts for one runner terminalize atomically.
- Worker death durably writes `failed` without waiting for worker return.
- Retire session and mode before a host terminal flush; terminal still commits.
- Hold Local before watchdog to prove there is no `gate → Local` AB/BA path.
- Admission no-self-deadlock test: after the final guard is returned, only `tx.commit()` runs.
- File-backed test: wait for watchdog response, drop all shared state, reopen the database in a fresh `LocalSnapback`, and assert `timed_out`/`Terminalizer`. The current watchdog test reuses the same shared process state instead. [server/tests.rs:27611](crates/snapback-server/src/server/tests.rs:27611) [server/tests.rs:27672](crates/snapback-server/src/server/tests.rs:27672)

## Author rulings and remaining design input

1. **Watchdog durability versus never waiting for Local.** The current watchdog explicitly refuses to wait for `LocalSnapback`, because a wedged owner could defeat the timeout. [server.rs:2999](crates/snapback-server/src/server.rs:2999) A crash-safe `timed_out` linearization using the existing database owner requires acquiring Local before the runner gate.

   Options:

   - Recommended: handler execution remains time-bounded, but the response waits for the bounded terminal transaction; permanent storage failure returns a storage failure and keeps an owned retry pending.
   - Preserve the no-Local-wait rule by designing a separate host settlement connection/lane. This is materially larger and must address reset/schema/SQLite-writer ordering.
   - Return timeout before durability and retry in the background. This does not satisfy the requested immediate-reopen guarantee.

   **Resolved 2026-08-22:** the author selected the recommended bounded
   terminal transaction. R4 is no longer author-blocked.

2. **Anonymous connection authority.** The carrier can classify anonymous starts as `CallerAuthorized(ConnectionBound)`, but the later fence still needs the ticket’s ruling about retaining the exact connection grant through commit. This does not block R1–R4 because no fence is added here.

The riskiest step is R4. It becomes safe only with the Local/watcher ruling, one ordered journal that can discard provisional caller state, a single atomic terminal batch, the runner gate held through registry acknowledgement, and the immediate fresh-database reopen test. Most importantly, every recovery/terminal host API must remain structurally incapable of accepting a caller reservation or mode guard.

Analysis was read-only against `81b6a6160d005d05f7ae2497720a55aa23435dfd`; no files were modified.
