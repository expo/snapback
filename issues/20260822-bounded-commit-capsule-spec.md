# Spec: the bounded commit capsule

Status: Open — implementable; two rollout rulings needed before adoption (not before prototyping)
Created: 2026-08-22
Related: issues/20260822-permits-pin-logout-on-unbounded-local-wait.md,
issues/20260822-critical-direct-route-fence-design.md,
issues/20260822-residual-findings-4-9-disposition.md,
issues/20260822-watch-preflight-dns-holds-the-managed-writer.md, LLP 0058

## Why this is the pivotal primitive

A design review named this the single highest-risk decision in the fence program. It is the shared
dependency for the three Critical direct-route fences, residual findings 4–6, retrofitting every
already-landed fence, and bounding the watch preflight path. A mistake converts logout into an
unbounded wait, or converts a post-commit timeout into a retried double effect.

## The shape

One absolute `tokio::time::Instant`, created immediately before authority reservation:

```
prework without permit
→ absolute deadline
→ enter capsule with prepared caller authority
→ capsule reserves caller authority
→ timeout_at(deadline, lock_managed_snapback(...))
→ synchronous staging
→ check the same deadline
→ commit_guard()
→ COMMIT
→ drop commit guard and reservation
→ exact reconciliation if COMMIT was uncertain
→ after-Local work / response
```

The **whole** queued future goes inside one `timeout_at`. `lock_owned` is FIFO and cancellation
loses only that waiter's queue position, so queue ordering and fairness are preserved. Polling
`try_lock_owned` — as the detached-action path does at `crates/snapback-server/src/server.rs:1207`
— is **forbidden**: it bypasses queued ordering.

## The existing watch helper: right kernel, wrong contract

The lane implementation in `writer_gate.rs` is the correct acquisition technique — it wraps the
queued future, one timer covers both mutex queueing and `wait_until_open`, and timeout drops the
captured work and therefore its reservation, with a test proving logout's drain completes.

It must **not** be generalized unchanged. Seven deficits:

- takes a relative `Duration`, not one absolute deadline;
- does not pass the deadline into the blocking closure;
- has no final-cut check;
- `SNAPBACK_WRITER_ACQUIRE_TIMEOUT` carries `retryable: true` but omits `effectCommitted: false`;
- the code is absent from the HTTP status registry and client diagnostic union, so it maps to
  **HTTP 500 rather than a typed 503** (the same defect as `SNAPBACK_WATCH_PREFLIGHT_STALE`);
- no commit-uncertainty or reconciliation carrier;
- its test covers only mutex queueing — not handoff wait, pre-guard expiry, commit ambiguity, or
  response loss.

It also bounds only watch creation's **second** acquisition; DNS and initial JS remain in the
first preflight turn. The capsule does not itself repair that.

## Result taxonomy, deadline points, reconciliation

Specified in full in the appended design, including: `Committed{value, reconciled}`, `Refused`,
`TimedOut{phase: WriterAcquire | FinalCut}`, `RolledBack`, `Uncertain`. The governing rules are
that a timeout is only reportable **before COMMIT begins**, and that reconciliation is per-site
against an intended-row predicate carried by the caller.

## Retrofit — incremental, but not invisible

Adoption is route-by-route; no program-wide cutover. For each landed fence, replace the
caller-side reservation plus post-reservation acquisition with one capsule call, and thread the
final-cut token to its deepest transaction seam. Success behaviour and queue ordering are
unchanged.

But observable behaviour **does** change, and this should not be described as a silent
improvement: a request that previously waited indefinitely can now return a typed 503; logout can
finish once that request drops its permit; older clients surface the new diagnostic rather than
retrying automatically.

**Multi-transaction effects are not mechanically retrofittable.** Either consolidate into one
transaction (recommended for OAuth, watch resume, clocks, denials, revocations), or treat the first
COMMIT as `CommitStarted`, permit no timeout thereafter, and reconcile the whole tuple. **A timeout
after one sibling has committed may never claim `effectCommitted: false`.**

## AUTHOR RULINGS — needed before adoption, not before prototyping

1. **Deadline budget:** one common default, or per-operation declared budgets? Recommended: a
   common five-second default with explicit per-site overrides — and framed as a final-cut
   admission budget, not a claim about COMMIT duration.
2. **First-party automatic retry:** enable the new timeout codes for every call, or only for
   idempotency-bearing paths? Recommended: only exact, unchanged, idempotency-bearing operations.
   Approvals and management routes should surface the typed timeout unless they first gain a
   durable retry identity.

## Provenance

Read-only codex spec against `2b1675b39`, with the watch helper read at `43b166d02`. Full spec with
API shape, taxonomy, per-path permit proof, failure-injection suite and prototype scope appended.

---

The primitive should be a generic, single-deadline commit capsule with site-specific reconciliation. The watch helper’s acquisition technique is reusable; its API and outcome contract are not sufficient to generalize.

No files were modified. Source citations below refer to current HEAD `2b1675b39` unless prefixed with `43b166d02:`.

## Decision

Use one absolute `tokio::time::Instant`, created immediately before authority reservation:

```text
prework without permit
→ calculate absolute deadline
→ enter capsule with prepared caller authority
→ capsule reserves caller authority
→ timeout_at(deadline, lock_managed_snapback(...))
→ synchronous staging
→ check same deadline
→ commit_guard()
→ COMMIT
→ drop commit guard and caller reservation
→ exact reconciliation if COMMIT was uncertain
→ after-Local work / response
```

The whole existing queued future must be inside one `timeout_at`. `lock_managed_snapback()` already preserves the queued mutex and handoff loop at [writer_gate.rs](crates/snapback-server/src/server/writer_gate.rs:85). Tokio 1.53.1 confirms `lock_owned` is FIFO and cancellation loses only that waiter’s queue position (`tokio-1.53.1/src/sync/mutex.rs:596-600`). Polling `try_lock_owned`, as the detached-action path does at [server.rs](crates/snapback-server/src/server.rs:1207), is forbidden.

## API shape

Precisely enough to prototype:

```rust
pub(crate) struct CommitCapsuleSpec {
    pub operation: &'static str,
    pub deadline: tokio::time::Instant,
    pub uncertain_diagnostic: &'static str,
}

pub(crate) enum CommitAttempt<T> {
    Committed(T),
    RolledBack(SnapbackError),
    CommitUncertain {
        cause: SnapbackError,
    },
}

pub(crate) struct CommitUncertainRetention<U> {
    retained: Arc<Mutex<Vec<U>>>,
}

pub(crate) enum ExactReconciliation<T> {
    IntendedRows(T),
    Uncertain {
        cause: SnapbackError,
    },
}

pub(crate) enum CommitCapsuleOutcome<T> {
    Committed {
        value: T,
        reconciled: bool,
    },
    Refused(SnapbackError),
    TimedOut {
        phase: CommitTimeoutPhase,
    },
    RolledBack(SnapbackError),
    Uncertain(SnapbackError),
}

pub(crate) enum CommitTimeoutPhase {
    WriterAcquire,
    FinalCut,
}

pub(crate) async fn with_bounded_commit_capsule<T, Intent, Gate, Uncertain>(
    state: &SharedSnapback,
    spec: CommitCapsuleSpec,
    authority: PreparedAuthority,
    terminal_gate: Gate, // `()` when none
    intent: Intent,
    transact: impl FnOnce(
        &mut LocalSnapback,
        &Intent,
        Gate,
        &AuthorizedEffectReservation,
        &mut FinalCommitCut<Uncertain>,
    ) -> CommitAttempt<T> + Send + 'static,
    reconcile: impl FnOnce(
        &mut LocalSnapback,
        &Intent,
        &Uncertain,
    ) -> ExactReconciliation<T> + Send + 'static,
    uncertain_retention: CommitUncertainRetention<Uncertain>,
) -> CommitCapsuleOutcome<T>;
```

The capsule acquires the reservation from `PreparedAuthority` before queuing for Local. A capsule
future that has not been polled owns no permit, and the API cannot accept an already-held
reservation. A reservation refusal returns its existing typed authority error before the capsule
opens a transaction.

Before COMMIT, the capsule takes ownership of the uncertainty carrier and keeps it continuously
through the return from caller-controlled transaction code and through `reconcile`, which only
borrows it. Uncertain and panic paths insert the carrier directly into shared capsule retention
storage before any retain-step hook may run. A retain-step unwind therefore cannot drop the sole
carrier; only a normal exact result may discard it.

`Gate` must be an opaque, non-cloneable rollback-on-drop carrier. Revocation passes `ServiceAuthorityTerminalGate`; ordinary writes pass `()`.

`FinalCommitCut` exposes only the final operation:

```rust
impl<U> FinalCommitCut<U> {
    fn commit<T>(
        &mut self,
        reservation: &AuthorizedEffectReservation,
        pending: impl PendingCommit<Output = T, Uncertain = U>,
    ) -> CommitAttempt<T>;
}
```

`PendingCommit` supplies `rollback(self)` and `commit(self)`. The implementation:

1. Checks the absolute deadline.
2. If expired, explicitly rolls back without calling `commit_guard`.
3. Calls `reservation.commit_guard`.
4. If refused, explicitly rolls back.
5. Marks `CommitStarted`.
6. Calls `pending.commit()` with no further deadline check.
7. Converts every commit error into `CommitUncertain`.

All SQL staging and transaction-final bookkeeping must precede this method. That structurally leaves only the deadline check, `commit_guard`, and `tx.commit()` at the final cut.

`commit_guard` already installs retained service authority and then acquires mode last at [invocation.rs](crates/snapback-sync/src/auth/invocation.rs:1246). Its mode guard holds the non-reentrant `AdmissionState` mutex at [admission.rs](crates/snapback-auth/src/auth/admission.rs:1002); both validation and guard acquisition use that mutex at [admission.rs](crates/snapback-auth/src/auth/admission.rs:938). Nothing below `FinalCommitCut::commit` may call admission validation, `effect_guard`, `mode_effect_guard`, `commit_guard`, or any recursive Local entry.

## The watch helper

The lane implementation at `43b166d02:crates/snapback-server/src/server/writer_gate.rs:106-126` is the right acquisition kernel:

- It wraps the existing queued `lock_managed_snapback` future.
- The one timer covers both mutex queueing and `wait_until_open`.
- Timeout drops the captured work and therefore its reservation.
- Its test proves a held writer times out and logout’s drain completes at `43b166d02:crates/snapback-server/src/server/tests.rs:31970-32084`.

It should not be generalized unchanged:

- It accepts a relative `Duration`, not the one absolute deadline.
- It does not pass the deadline into the blocking closure.
- It has no final-cut check.
- `SNAPBACK_WRITER_ACQUIRE_TIMEOUT` contains only `retryable: true`; it omits `effectCommitted: false`.
- The code is absent from the HTTP status registry and client diagnostic union, so the server’s default mapping makes it HTTP 500, not a typed 503; unknown codes fall through at [api_error.rs](crates/snapback-server/src/server/api_error.rs:1753).
- It has no commit-uncertainty or reconciliation carrier.
- Its test covers only mutex queueing, not handoff wait, pre-guard expiry, commit ambiguity, or response loss.

Also, it bounds only watch creation’s second writer acquisition. DNS and initial JS remain in the first `with_snapback` preflight; blocking DNS is at [webhooks.rs](crates/snapback-services/src/webhooks.rs:74). The capsule does not itself repair that first-phase writer hold.

## Total result taxonomy

| Internal outcome | Caller-visible result | Retry rule | Safe next action | Server must not |
|---|---|---|---|---|
| Session reservation refusal | Existing `SNAPBACK_AUTH_SESSION_EXPIRED`, HTTP 401; add `capsuleOutcome: "authorityRefused"`, `effectCommitted: false`, `effectMayHaveCommitted: false`, `retryable: false` | No same-authority retry | Reauthenticate; only then begin a new logical operation | Convert it to timeout or persist any transaction effect |
| Service reservation refusal | Existing `SNAPBACK_AUTH_SCOPED_TOKEN_INVALID`, HTTP 401, with the same effect facts | No same-token retry | Obtain fresh delegated authority | Degrade to mode-only |
| Stream/projection refusal | Existing `SNAPBACK_AUTH_STREAM_RESET` or `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE` | Only according to the existing typed authority recovery protocol | Refresh authority/projection first | Hide it behind a writer timeout |
| Writer acquisition timeout | `SNAPBACK_WRITER_ACQUIRE_TIMEOUT`, HTTP 503 | Retryable only as the unchanged logical operation under the same pinned authority and idempotency identity | Short jitter, bounded attempts | Start a transaction; report uncertainty; disturb other queued waiters |
| Final-cut deadline expiry | `SNAPBACK_COMMIT_DEADLINE_EXCEEDED`, HTTP 503 | Same rule as writer timeout | Short jitter, bounded attempts | Call `commit_guard` or COMMIT |
| Validation/body/final-guard failure with proven rollback | Preserve the site’s typed diagnostic; add `effectCommitted: false` when not already present | Site-specific; the capsule itself does not retry | Follow that diagnostic | Replace it with a timeout |
| COMMIT succeeds | Ordinary route success | No retry | Accept result | Apply a later timeout |
| COMMIT errors, exact reconciliation proves all intended rows | Ordinary route success; internal observation `SNAPBACK_COMMIT_RECONCILED_COMMITTED` | No retry | Accept reconstructed result | Return the original commit error |
| COMMIT errors, intended rows not exactly proved | Site-specific uncertainty diagnostic, normally existing `SNAPBACK_AUTH_GRANT_COMMIT_UNCERTAIN` or `SNAPBACK_AUTH_REVOCATION_UNCERTAIN`; generic fallback `SNAPBACK_COMMIT_OUTCOME_UNCERTAIN` | `retryable: false` | Inspect/reconcile by operation identity; require human or explicit recovery if unresolved | Automatically retry or claim rollback |
| Commit succeeded but response was lost | Transport failure, never a capsule timeout | No automatic retry without a durable idempotency identity | Query status or resubmit the same idempotency identity | Attach `effectCommitted: false` |

Both timeout diagnostics have exactly:

```json
{
  "capsuleOutcome": "timedOut",
  "phase": "writerAcquire | finalCut",
  "retryable": true,
  "retryStrategy": "short-jitter",
  "effectCommitted": false,
  "effectMayHaveCommitted": false
}
```

An unresolved uncertainty has:

```json
{
  "capsuleOutcome": "commitUncertain",
  "phase": "reconciliation",
  "retryable": false,
  "effectCommitted": null,
  "effectMayHaveCommitted": true,
  "causeCode": "..."
}
```

That makes “refused” versus “timed out” unambiguous by both diagnostic code and `capsuleOutcome`. Existing authority errors map to 401 at [api_error.rs](crates/snapback-server/src/server/api_error.rs:713); the two new timeout codes must map to 503.

The current client automatically retries only the exact `SNAPBACK_AUTH_RESERVATION_STALE`/409 shape, including its exact detail-key set, at [index.mjs](packages/snapback-client/index.mjs:5679). It will not accidentally retry these new diagnostics.

## Deadline semantics

The deadline is created before the capsule is constructed, and the capsule itself acquires the
reservation, so it bounds the complete permit-held interval. Delaying or abandoning an unpolled
capsule future cannot pin logout because no reservation exists yet.

The same deadline wraps the entire queued writer future:

```rust
let guard =
    tokio::time::timeout_at(spec.deadline, lock_managed_snapback(state)).await?;
```

That preserves the loop at [writer_gate.rs](crates/snapback-server/src/server/writer_gate.rs:88), including a closed-handoff wait at line 97. The capsule must never reopen a handoff it does not own; `ManagedLocalHandoff` reopening belongs to its owner at [exec_guard.rs](crates/snapback-types/src/exec_guard.rs:342).

Immediately before `commit_guard`:

- If `Instant::now() >= deadline`, explicitly rollback, return `SNAPBACK_COMMIT_DEADLINE_EXCEEDED`, and set `effectCommitted: false`.
- There is no second deadline check after `commit_guard`.
- There is no async timeout wrapped around the blocking phase.

Once COMMIT begins, elapsed time no longer controls the result. It can return only committed, known rollback where the storage protocol genuinely proves one, or commit-uncertain followed by reconciliation. SQLite may itself wait up to five seconds at [storage.rs](crates/snapback-kernel/src/storage.rs:6448), so this is an admission deadline, not a hard synchronous-completion bound.

Checking after COMMIT starts is forbidden because SQLite may commit after the check. Returning an effect-free timeout in that interval would authorize a retry of an already-committed operation.

## Reconciliation contract

The mechanism is generic; the predicate is per-site.

An idempotency key alone is insufficient. Every site supplies an immutable `Intent` containing:

- The stable logical-operation identity.
- Every expected inserted, updated, and deleted row identity.
- Exact successor field values, not just row presence.
- The consumed proof identity and expected consumed state, where applicable.
- Any authorization-clock value included in the transaction.
- Any journal/result/queue row that makes the operation complete.
- Enough immutable material to reconstruct the response.

Examples:

- OAuth approval: approved request, exact grant row/content, OAuth request bound to that grant, exact code hash, step-up proof consumption, and clock. Only that complete tuple permits returning the in-memory raw code. This is already required by the Critical design at [critical design](issues/20260822-critical-direct-route-fence-design.md:239).
- Watch resume: exact status transition and exact evaluation enqueue.
- Renewal: old grant revoked, replacement grant exact, watch bound to the replacement.
- Denial: exact decision, journal, proof state, and clock.
- Revocation: exact planned grant/token/watch set and terminal disposition.
- Pending-intent creation: exact retained intent identity and canonical contents.
- Ordinary mutation: exact operation envelope/result row plus its committed mutation identity.

Only `IntendedRows` becomes committed. Absence, a predecessor, partial successor, a different valid successor, or a reconciliation read error remains uncertain under this capsule—no automatic retry.

If a site cannot state and implement that exact predicate, it cannot adopt the capsule. It first needs a durable operation identity, transaction consolidation, or the separate durable-handoff protocol.

Existing auth storage demonstrates the right model: COMMIT errors are represented as `AuthTransactionAttempt::CommitUncertain` at [auth.rs](crates/snapback-kernel/src/storage/auth.rs:386), and grant reconciliation compares request state, exact grant, and proof consumption at [auth_grants.rs](crates/snapback-kernel/src/storage/auth_grants.rs:1517).

## Permit and terminal-gate proof

| Exit path | Caller reservation | Target terminal gate | Logout |
|---|---|---|---|
| Reservation refuses | Never constructed, or partially acquired publication is immediately dropped | If already acquired for revocation, dropping it exact-rolls back its premark | No caller permit exists; drain proceeds |
| Writer timeout | Owned by the capsule future and dropped with it | Dropped before installation; rollback-on-drop releases its ticket | Permit counters reach zero and notify the drain |
| Final-cut timeout | Dropped after explicit transaction rollback | Exact rollback/release before returning | Drain proceeds |
| `commit_guard` refusal | Dropped after explicit rollback | Exact rollback/release | Drain proceeds |
| Known transaction rollback | Dropped immediately after rollback | Exact rollback/release | Drain proceeds |
| Commit success | Dropped immediately after COMMIT | Committed terminal disposition finalizes through the existing after-Local owner | Initiating logout proceeds after the caller permit drops |
| Commit uncertainty | Always dropped before reconciliation | Intentionally stays closed in the uncertainty carrier until exact reconciliation | Initiating logout proceeds; target authority remains fail-closed |
| Pre-COMMIT panic | Catch unwind around staging, explicitly rollback, then drop both owners | Rollback-on-drop | Drain proceeds |
| Panic/error after COMMIT starts | Caller permit drops | Marked ambiguous before invoking COMMIT; never reopened by unwind | Logout proceeds; operation stays uncertain until reconciliation |

The concrete RAII evidence is:

- Session/stream permits decrement and notify at [session_projection.rs](crates/snapback-sync/src/auth/session_projection.rs:522).
- Service permits settle on `Drop` at [service_fence.rs](crates/snapback-auth/src/auth/service_fence.rs:203).
- An unused service terminal gate drops its prepared carrier at [service_fence.rs](crates/snapback-auth/src/auth/service_fence.rs:999), whose rollback-on-drop releases the ticket at line 1040.
- Current blocking ownership already catches unwind, releases Local, runs after-Local work, then resumes the panic at [server.rs](crates/snapback-server/src/server.rs:455).

One hardening is required before prototype success: the existing service-terminal transaction marks its carrier ambiguous only after `tx.commit()` returns `Err` at [auth.rs](crates/snapback-kernel/src/storage/auth.rs:1795). **INFERRED:** a panic inside the commit call could therefore unwind before `mark_ambiguous`. Confirm with the during-COMMIT panic injector. The capsule seam must mark the carrier ambiguous before invoking COMMIT, retain it outside the caught closure, and then settle it according to success/reconciliation.

## Retrofit

Adoption can be route-by-route; no simultaneous program-wide cutover is required.

For each landed split-phase fence, replace the caller-side reservation plus post-reservation
`lock_managed_snapback` acquisition with one capsule call, pass its `PreparedAuthority`, and thread
the final-cut token to the deepest transaction seam. Success behavior and queue ordering remain
unchanged.

Observable behavior does change:

- A request that previously waited indefinitely can now return a typed 503.
- Logout can finish once that timed-out request drops its permit.
- Older clients will safely surface the new diagnostic instead of automatically retrying it.
- Adding bounded automatic retry is compatible only for operations with a stable idempotency identity and a pinned unchanged authority. It must not be enabled blanket-wide.

This is wire-compatible and additive, but it is not behaviorally invisible.

Multi-transaction logical effects are not mechanically retrofittable. Either:

1. Consolidate them into one transaction—recommended for OAuth, watch resume, clocks, denials and revocations; or
2. Treat the first COMMIT as `CommitStarted`, permit no timeout thereafter, and reconcile the complete multi-transaction tuple.

A timeout after one sibling commit may never claim `effectCommitted: false`.

## Failure-injection suite

| Barrier | Simulation | Required assertion | Must not produce |
|---|---|---|---|
| Queue wait | Hold writer; enqueue ordinary waiter A, capsule B, ordinary waiter C; expire B | B gets writer timeout/effect false; A then C acquire in order; permit/gate drop; logout drains | `try_lock_owned`, reordered A/C, transaction start |
| Handoff wait | Close exact managed handoff; let capsule acquire/drop writer and enter `wait_until_open`; expire deadline | Timeout/effect false; no Local owner; permit/gate release; actual handoff owner can later reopen | Capsule reopening the handoff or leaving a stale waiter |
| Post-staging | Pause after all SQL writes are staged but before final-cut entry | Rows remain invisible; logout waits only while the bounded reservation is live; release before deadline commits once | Response/fanout, visible partial state, admission re-entry |
| Pre-guard | Pause immediately before the paired deadline-check/`commit_guard`; let deadline expire | Explicit rollback, final-cut timeout/effect false, commit observer count zero, logout drains | `commit_guard`, COMMIT, uncertainty |
| During COMMIT | Pause after `CommitStarted`; let deadline expire; inject success-with-lost-ack and real commit error variants | Never return timeout; exact successor becomes committed, otherwise uncertainty; caller permit drops | Effect-free retry diagnostic |
| Reconciliation | Return an ambiguous COMMIT, pause inside exact reconciliation, then panic | Caller permit is already released; the capsule retains the carrier and the terminal domain stays fail-closed | Rollback-on-drop reopening the terminal domain |
| Retention | Return unresolved reconciliation; pause after shared retention storage owns the carrier; panic inside the retain step | The stored carrier survives unwind and the terminal domain stays fail-closed; caller permit is already released | Sole carrier ownership in the panicking frame or terminal reopen |
| Post-commit/pre-response | Pause after COMMIT and resource release but before response; start logout and then drop response | Logout completes; one durable effect; no automatic retry on transport loss; replay of the same idempotency identity returns existing result | A second grant/watch/job/mutation or `effectCommitted: false` |

Every barrier also runs a panic/unwind variant. Before COMMIT, reopening and permit release are required. After `CommitStarted`, the target gate must stay ambiguous/fail-closed and the result must never become retryable.

The production-route duplication proof has two halves:

1. The only diagnostics admitted to effect-free retry are emitted before COMMIT was invoked.
2. If the response is lost after COMMIT, the client receives no such diagnostic; where explicit retry is supported, the same durable operation identity resolves the prior result and the test asserts exactly one effect row.

The prototype executably demonstrates those mechanics only for its own route-free storage path:
`stage()` returns `Existing` for a test-only `operation_id`, and the response-loss test observes one
toy effect row after replay. That is not a client-resendable, principal-scoped identity and does
not prove that every future fence can retry without duplicating effects.

## Smallest prototype

Before migrating any route, build a test-only, route-free prototype consisting of:

1. The absolute-deadline writer wrapper.
2. `FinalCommitCut` over one file-backed SQLite transaction.
3. A test-only operation ledger row keyed by an immutable operation ID, with an exact expected payload and a consumed-proof row.
4. Real `AuthorizedEffectReservation` and `ServiceAuthorityTerminalGate` fixtures.
5. The eight barriers above.
6. A commit adapter that can inject:
   - rollback before COMMIT;
   - commit success;
   - success with lost acknowledgement;
   - commit error with intended rows present;
   - commit error with intended rows absent/partial;
   - panic before and during COMMIT.

The prototype is complete only if it demonstrates:

- FIFO queue preservation and cancellation of only the expired waiter.
- Both mutex and handoff waits obey the same absolute deadline.
- Final-cut expiry invokes no COMMIT and survives a fresh-database reopen with no intended rows.
- No admission call occurs while `commit_guard` is held.
- Every effect-free exit releases both permit families and allows bounded logout completion.
- Deadline expiry during COMMIT never becomes timeout.
- Exact reconciliation returns committed only for the complete intended tuple.
- An unresolved result remains non-retryable and keeps the target terminal domain fail-closed.
- For the prototype's test-only `operation_id`, response loss plus replay through its `Existing`
  path produces exactly one durable operation.

This prototype does **not** establish route-wide retry safety. A real adopting route must still
supply all of the following:

- a client-resendable operation identity scoped to the principal, not a test-only token;
- reconciliation of the exact intended rows and values for that route;
- `FinalCommitCut` as the route's only COMMIT;
- for revocation, `with_service_authority_terminal_gate` installed in the kernel transaction,
  rather than the prototype's RAII `take()`-and-drop adapter.

The prototype also does not emit `SNAPBACK_COMMIT_RECONCILED_COMMITTED`; its in-process
`reconciled: bool` is the deliberately sufficient substitute at this stage. In particular, a
reconciled success in the prototype does not by itself demonstrate settlement of a terminal gate
as a committed ending.

## Author rulings

The primitive mechanics need no ruling. Two rollout policies do:

1. **Deadline budget:** one common default, or per-operation declared budgets. Recommendation: a common five-second default with explicit per-site overrides; it is a final-cut admission budget, not a COMMIT-duration claim.
2. **First-party automatic retry:** enable new timeout codes for every call, or only idempotency-bearing mutation paths. Recommendation: only exact, unchanged, idempotency-bearing operations; approvals and management routes surface the typed timeout unless they first gain a durable retry identity.
