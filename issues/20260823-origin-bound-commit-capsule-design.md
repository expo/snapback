# Design: origin-bound authorized commit capsule

Status: Proposed — design complete, implementation not dispatched
Created: 2026-08-23
Related: llp/0298-durable-effect-scope.decision.md,
issues/20260823-remeasurement-under-llp-0297.md (the nine-item closure set),
issues/20260822-capsule-structural-residuals.md (why the previous attempt failed),
issues/20260823-detached-action-nested-mutation-fence-design.md

## Why this was commissioned

The caller-authority fence pattern has been hand-implemented **five times**, each taking 3–6 review
rounds, with the **same six mistakes recurring**: guard wrapped rather than replaced, permit
retained past commit, terminal cause reconstructed from diagnostic strings, a blanket
`From<SnapbackError>` silently downgrading terminal causes, a deadline that stops applying after a
handoff, and tests passing for the wrong reason.

The measurement under LLP 0298 then established that **nine in-scope items remain**. Five of them
are routes that could reuse one lifecycle. That is the amortisation case.

## The decision

**Build it — by replacing the capsule's open callback surface, not by building alongside it.**

Internals use typestate (`Bound → Reserved → WorkerOwned → Guarded → Finished`), each transition
consuming the prior. But those states are **private**. Route code sees one consuming operation:

```rust
bound_origin.execute::<GrantApproval>(request_data).await
```

It does **not** receive the reservation, the Local guard, the deadline, the final guard, the commit
authority, the reconciliation witness, or a commit callback.

That last sentence is the whole design. The bounded commit capsule already tried to be this
primitive and failed precisely because it *handed those things out*: `state` and `authority` as
independent arguments, an open `PendingCommit` trait, freely constructible `IntendedRows`, and a
structural test that paired database B with authority A and passed.

## What it makes impossible versus merely detectable

Five of the six recurring mistakes become **impossible at the adopter boundary**: guard wrapping
(the migrated sink has only a sealed final-cut entry), permit retention (no returned type owns it),
string-derived causes, the blanket downgrade (classified calls become internal), and deadline loss
after handoff (the executor owns the whole acquisition).

**The sixth is not preventable.** Types cannot prove a fixture is non-empty, that a callback ran, or
that a probe observes the selected method — which is exactly how false proofs got past review
repeatedly tonight. That one stays detectable only, via required counters, durable witnesses, and
watched fail-first mutations.

The design is equally direct about seven other things it cannot make impossible, including a
regression *inside* the primitive, a new route bypassing it entirely, and post-construction
`AppState` referent replacement. Worth reading section 6 before trusting the primitive further than
it claims.

## Cost, honestly

Roughly **600–900 production lines** for the primitive (much of it replacing existing capsule code)
plus **1,000–1,600 test lines**, then **1,500–2,500 production lines** across the remaining routes
with **1,800–3,000 further test lines**. Delivered as five reviewable landings.

**It does not migrate the five landed fences.** They work, and churning them is structural-
prerequisite risk with zero property movement.

## 1. Decision and shape

Build the primitive. Five remaining routes can reuse its lifecycle, four without a new authority posture. The repeated 3–6-round failures are sufficient evidence that the lifecycle should no longer be assembled at route call sites.

The supported shape is:

```text
Bound
  -> Reserved
  -> WorkerOwned
  -> Guarded
  -> Finished
```

Each transition consumes the prior state, but these states are private implementation details. Route code sees one consuming operation:

```rust
bound_origin
    .execute::<GrantApproval>(request_data)
    .await
```

It does not receive the reservation, Local guard, deadline, final guard, commit authority, reconciliation witness, or a commit callback.

The complete internal flow is:

```text
one bound origin
-> derive operation identity, deadline policy and typed terminal latch
-> reserve exact caller authority outside Local
-> bounded FIFO Local acquisition, including blocking-worker handoff
-> derive staging authority from that same reservation
-> kernel stages one sealed pending operation
-> acquire any operation interlock
-> acquire authorized-effect/mode guard LAST
-> COMMIT
-> drop commit guard and reservation
-> construct permit-free Finished outcome
-> reconcile / after-Local / response work
```

### Correction to the proposed terminal `Drop`

`Committed` must not retain the permit and release it in `Drop`.

That would let response code hold `Committed`, move it into after-Local work, or deliberately `mem::forget` it. The exact defect—logout pinned after commit—would remain expressible.

Instead:

- RAII `Drop` releases permits on timeout, error, cancellation, rollback, or unwind.
- On success or commit uncertainty, the internal `Guarded -> Finished` transition explicitly drops the commit guard and reservation immediately after `COMMIT` returns.
- `Finished<T>` owns no authority resource. It may safely survive response construction indefinitely.

`Finished`, rather than `Committed`, is also the correct terminal name because the total outcome includes refusal, timeout, rollback, uncertainty, and reconciled success.

### Why the public surface is closure-scoped

An exposed typestate is weaker than it first appears:

- `AuthorizedEffectCommitGuard` borrows its reservation, making a consuming `Guarded` state awkward or self-referential.
- An exposed `Reserved` or `Committed` owner can retain or forget the permit.
- Exposed staging or commit callbacks can capture another authority or call another commit path.
- Typestate orders method calls but does not prove that correlated runtime values share an origin.

The executor therefore uses typestate internally for implementation exhaustiveness while keeping the authority-bearing states inaccessible to adopters.

### Alternative ranking

“Impossible” means an ordinary adopter cannot express the defect through the supported API without changing the primitive or reopening a legacy sink.

| Shape | Guard wrap | Permit past commit | String cause | Blanket `From` downgrade | Deadline lost at handoff | False-green test |
|---|---|---|---|---|---|---|
| Exposed `Reserved -> Queued -> Guarded -> Committed` | Discouraged unless the sink is also sealed | **Possible** with permit-owning `Committed` | Discouraged | Discouraged | Discouraged | Discouraged |
| Sealed builder accepting callbacks | Discouraged | Discouraged | Discouraged | Discouraged | Discouraged | Discouraged |
| Closure helper with open staging/commit callbacks | Discouraged through callback capture | Impossible if no permit escapes | Discouraged | Discouraged | Impossible at call site | Discouraged |
| Macro expanding the ceremony | Discouraged | Discouraged | Discouraged | Discouraged | Discouraged | Discouraged |
| **Origin-bound executor, private typestate, sealed kernel operation** | **Impossible at call site** | **Impossible at call site** | **Impossible at call site** | **Impossible at call site** | **Impossible at call site** | Detectable only |

A macro is last: it standardizes spelling, not ownership, privacy, or durable semantics. A conventional builder is useful for optional configuration, but this protocol should have neither optional posture nor independently configurable parts.

## 2. One bound origin

The executor must begin with `CommitCapsuleDestination` or its replacement, never with separate `state`, `authority`, deadline, gate, intent, and callbacks.

Conceptually:

```rust
struct BoundCommitOrigin<O> {
    destination: CommitCapsuleDestination,
    operation: O::BoundRequest,
    terminal: TypedTerminalLatch,
}
```

The actual fields remain private.

`CommitCapsuleDestination::bind` remains the sole origin-binding boundary. After it succeeds, every later component is derived from the destination:

- managed Local graph;
- admission controller and graph identity;
- exact prepared caller authority;
- database commit authority;
- operation metadata and budget;
- staging authority view;
- pending transaction;
- ambiguity carrier;
- reconciliation fingerprint.

No transition accepts another `AppState`, `PreparedAuthority`, admission lease, commit authority, or terminal gate.

### Avoiding the capsule’s exact failure

The first capsule failed because correlation was a caller obligation:

```text
state B + authority A + open PendingCommit + constructible IntendedRows
```

A positive A/A test said nothing about B/A substitution.

The replacement closes each of those seams:

1. **Destination:** every transition consumes one already-bound destination. State and authority are never resupplied.
2. **Authority view:** staging derives it from the destination’s reservation. Sinks have no second `PreparedAuthority` parameter.
3. **Pending commit:** replace the server-owned open `PendingCommit` trait with a kernel-owned sealed operation trait or closed operation enum. Only kernel-minted pending types can reach the final cut.
4. **Intent:** request data is constructible, but proof-bearing intent is not. Kernel staging mints an opaque semantic seal containing the database binding and canonical intended-row fingerprint.
5. **Reconciliation:** the uncertainty carrier and reconciliation witness retain that same seal. There is no public `IntendedRows(T)` constructor and no acceptance based only on a caller-chosen operation ID.
6. **Operation interlocks:** an operation’s pending type owns or derives its exact terminal/interlock carrier. The executor no longer accepts an independent generic `Gate`.

The primitive must consume the sealed authority/publication binding proposed in `issues/20260822-authority-publication-binding-design.md`. Building it directly on today’s independently optional `PreparedAuthority` carrier fields would preserve the most important mismatch one layer below the new API.

### Route-bound construction

Authenticated middleware should produce a single `PreparedRouteContext` containing:

- a non-authoritative view used for permit-free prework; and
- one consuming `BoundCallerCommitOrigin`.

Both projections come from the same sealed route authority. A route may inspect the view during lookup or step-up, but the eventual sink derives authoritative user/session/service facts from the reservation, not from copied strings.

Pairing presentation receives a different closed origin type, described below. There is no `Option<AuthorizedEffectReservation>` and no fallback from caller-bound to mode-only.

## 3. Extend the capsule; do not build alongside it

This should be a replacement generation of the bounded commit capsule, not a second general primitive.

Keep these parts:

- total outcome taxonomy;
- one absolute final-cut admission deadline;
- FIFO managed-writer acquisition;
- commit-uncertainty retention registry;
- release of caller permits before reconciliation;
- exact distinction between pre-COMMIT timeout and post-COMMIT uncertainty.

Change these parts:

1. Replace the generic free function with a consuming method on a bound destination.
2. Remove caller-supplied `operation`, deadline, uncertainty diagnostic, terminal gate, transaction closure, and reconciliation closure. The sealed operation type supplies them.
3. Remove the open server `PendingCommit` trait. Kernel-owned sealed pending types perform the actual transaction.
4. Replace caller-constructible intent/reconciliation evidence with a kernel-minted semantic seal and fingerprint.
5. Derive staging authority only from the reservation.
6. Use the existing bounded handoff machinery behind `with_snapback_until`, not the capsule’s current `lock_managed_snapback_until` followed by an independently unbounded `spawn_blocking` queue.
7. Latch classified terminal causes inside the executor before any error flattening.
8. Ensure the returned outcome contains no reservation or guard.

The existing watch adopter becomes a sealed `WatchManagement` operation over this same core. A temporary module-private compatibility wrapper is acceptable only if it delegates immediately and exposes none of the old callbacks or traits. It is not a second implementation.

The five successfully landed hand-written fences remain unchanged. Retrofitting them would add structural-prerequisite risk without moving LLP 0298’s property.

## 4. Terminal errors and deadline ownership

### Typed terminal latch

The executor owns:

```rust
enum CommitTerminalCause {
    Caller(CallerAuthorityTerminalCause),
}

struct CommitTerminalLatch(Arc<OnceLock<CommitTerminalCause>>);
```

Both classified terminal sites write through it:

- `reserve_authorized_effect_classified`;
- `commit_guard_classified`.

Operational errors, writer timeout, stale rows, policy rejection, rollback, and commit uncertainty never enter this latch.

The route-facing outcome remains a closed enum:

```rust
enum BoundCommitOutcome<T> {
    Committed(T),
    CallerTerminal(CallerAuthorityTerminalCause),
    TimedOut(CommitTimeoutPhase),
    Rejected(SnapbackError),
    RolledBack(SnapbackError),
    Uncertain(SnapbackError),
}
```

There is no `From<SnapbackError>` for this type. Classified authority results never pass through `?` at an adopter call site. The executor matches them explicitly and latches terminal causes before returning.

### Deadline

The sealed operation supplies the common five-second budget or a reviewed finite override. The executor computes one absolute instant before reservation and stores it privately.

That same instant controls:

- reservation admission;
- FIFO mutex queueing;
- closed managed-handoff wait;
- blocking-worker claim;
- final pre-guard deadline check.

Once the blocking worker claims the turn, synchronous staging may finish after the deadline, but the final cut must then roll back before acquiring the mode guard. Once COMMIT begins, the deadline no longer changes the result.

This remains a final-cut admission deadline, not a bound on SQLite COMMIT duration.

## 5. Migration of remaining routes

No landed fence is migrated.

| Route | Fit | Required operation shape |
|---|---|---|
| Grant-request inbox | **Fits caller-bound primitive as-is** | Session origin. Move clock advancement, the in-scope pairing/OAuth sweep, and row selection into one guarded transaction. Capture the returned list before COMMIT; release the permit before serialization. |
| Pairing presentation | **Needs one closed mode/credential variant** | The route has no prepared session or scoped-service authority to reserve. Its agent credential is validated inside the same serialized auth transaction, so use `BoundCredentialCeremonyOrigin`, not a missing caller reservation. Clock advancement, credential-use update, sweep, and pairing transition commit together under mode-last admission. Do not claim caller-authority fencing for this route. |
| OAuth proposal creation | **Fits caller-bound primitive as-is** | Local session origin. Parse bundles and generate the inert hash before reservation; commit clock, pairing parent, capacity decision, and OAuth proposal atomically. Build HTML only after permit release. |
| Pending-effect approval | **Fits as-is; requires a permit-free post-commit continuation** | The approver session is the sole commit origin. Original frozen authority is validation/execution data, never an alternative commit authority. Proof consumption, row decision, and journal append share the guarded transaction. Return a permit-free committed decision, then dispatch the stored invocation under its original authority. |
| Grant approval | **Fits as-is; OAuth approval uses a larger sealed operation** | Ordinary approval atomically commits clock, proof, grant, and request transition. OAuth approval must additionally commit OAuth status, grant ID, exact code hash, and expiry in the same transaction. It must not use two primitive calls. |

### Pairing presentation is deliberately different

Pairing presentation cannot honestly use `AuthorizedEffectReservation`: no session or finite-service publication exists before Local. The credential is looked up and revalidated in the transaction that consumes the pairing secret. SQLite serialization already gives the required credential-before-revocation or revocation-before-credential ordering.

The variant shares deadline, queue, handoff, mode-last commit, uncertainty, and outcome machinery, but its origin type cannot satisfy an operation requiring `CallerBound`. Route code cannot select the weaker posture.

### Pending-effect approval boundary

The approver permit ends at the approval decision commit. It must not cover:

- original mutation/action execution;
- outcome settlement;
- response construction;
- refusal caused by later original-authority failure.

A caller-terminal approval outcome leaves the effect pending. It must never be transformed into a durable refusal based on a diagnostic string.

### Grant/OAuth atomicity

OAuth approval and code issuance are one sealed operation. Two separately correct fence executions would still preserve the grant-only half-state. Raw code is generated before reservation, only its hash is stored, and the raw code is returned only after the complete successor tuple is committed or exactly reconciled.

## 6. What the primitive cannot make impossible

The supported API prevents most adopter-level mistakes, but it cannot make the following impossible:

- **A regression inside the primitive itself.** Its implementation can still reorder a guard, flatten an error, or drop a deadline. Mutation-sensitive runtime tests detect these.
- **A new route bypassing the primitive.** Existing `with_snapback` and legacy autocommit methods remain powerful. Migrated operation sinks must lose their production-reachable unguarded entry points, and the route/commit census must detect new ones.
- **False-green tests.** Types cannot prove that a fixture is non-empty, a callback ran, or a probe observes the selected method. Required counters, durable witnesses, and fail-first mutations detect this.
- **Post-construction `AppState` referent replacement.** While safe Rust can replace the `LocalSnapback` behind the public shared mutex, the primitive can recheck graph identity after worker acquisition and the kernel can reject mismatched commit authority. Making the mismatch literally unconstructible requires separately encapsulating or stabilizing the shared Local slot.
- **Correctness of an operation-specific reconciliation predicate.** The kernel can bind a fingerprint structurally, but tests must prove that the fingerprint includes every semantically relevant field.
- **Unbounded COMMIT duration after the cut.** Timeout cannot safely reinterpret a transaction once COMMIT begins.
- **Irreversible external effects.** They require durable authority handoff before the physical effect, not this SQLite commit fence.
- **A deliberately multi-transaction product state.** Such a state needs its own explicit durable state machine and reconciliation owner. OAuth currently has no such design and must be consolidated.

### The six recurring mistakes, precisely

| Mistake | Adopter status | Remaining enforcement |
|---|---|---|
| Guard wrapped rather than replaced | Impossible when migrated sink has only sealed final-cut entry | Actual pre-COMMIT guard-identity test and bounded deadlock timeout |
| Permit retained past commit | Impossible because no returned type owns it | Blocked post-commit test with exact reservation-liveness observation |
| Terminal cause reconstructed from strings | Impossible at adopter boundary | Cause/disposition matrix and first-wins latch test |
| Blanket `From<SnapbackError>` downgrade | Impossible at adopter boundary because classified calls are internal | AST/security gate plus terminal-versus-operational behavior test |
| Deadline lost after handoff | Impossible at adopter boundary because executor owns the whole acquisition | Saturated blocking-pool and closed-handoff tests |
| Tests pass for the wrong reason | Not preventable | Exact counters, non-empty effects, actual-cut probes, watched mutations |

## 7. Primitive test design after mutation iteration

The table records the shortest mutant that survived an initial, naïve oracle and the strengthening required in the final suite. None of these mutants may survive acceptance.

| Guarantee | Shortest false-green production mutation | Final oracle |
|---|---|---|
| One bound origin | Pair state/database B with authority A while all tests use correlated A/A values; or reuse one operation ID for different intended rows | Actual `{B,A,A}` negative cases using copied durable identity and same-path in-memory graphs; same-ID/different-fingerprint rejection |
| Reservation occurs outside Local | Skip the real operation and return a later auth error | Require the exact production reservation pause once, a non-empty staged effect, and event order showing no Local scope at reservation |
| Exact reservation is the one committed | Acquire a dummy reservation while the sink uses mode-only authority | Record one reservation identity through reserve, final guard, actual storage pre-COMMIT, commit return, and release |
| Guard replaces rather than wraps | Add a decorative route guard while the kernel keeps its old mode guard | Actual storage-cut hook must see exactly one marked authorized guard; a bounded test catches non-reentrant double acquisition |
| Permit ends at COMMIT | Move `drop(reservation)` into after-Local or response work | Pause immediately after COMMIT while response work is blocked; require exact reservation inactive and logout committed before release |
| Typed terminal cause survives | Parse the same public error code into `NonTerminal`, preserving the HTTP error | Exercise admission retirement, stream retirement, session carrier/durable-delete, and scoped-service carrier/durable-delete; assert exact enum/disposition and that nonterminal refusal policy was never entered |
| Deadline covers worker handoff | Bound mutex acquisition, then wait indefinitely in the blocking-pool queue | Saturate the blocking pool; observe exact mutex acquisition and handoff enqueue but no worker claim; deadline must drop Local and the permit and allow logout |
| FIFO cancellation | Replace queued acquisition with repeated `try_lock` | Queue A, expiring B, and C; require A then C, with B alone cancelled |
| COMMIT is real | Implement a fake pending adapter returning `Ok` without writing | Sealed-adapter compile-fail fixture plus actual SQLite pre-COMMIT/return counters and file reopen with exact successor rows |
| Reconciliation is semantic | Accept a witness with the same ID but changed grant scopes, code hash, expiry, proof state, or clock | Tamper each field independently; every variant remains uncertain and retains its carrier |
| Test reaches selected method | Point the probe at a sibling or guard assertions with `if probe_was_installed` | Operation-adapter identity and every probe invocation are exact-count assertions; absence is failure, never test disablement |
| Empty path cannot pass | Use empty scopes/no-op mutation so removing the guard changes nothing | Assert non-empty staged writes and exact durable successor rows before testing ordering |

Every route adopter still owes one watched parent failure. For example, pending-effect approval must be observed committing a non-empty decision and original effect after logout on the unfixed parent before the fixed test can count as evidence.

### Compile-fail enforcement

Add inventoried external attack fixtures proving that callers cannot:

- construct any internal phase;
- extract or retain the reservation or final guard;
- supply a second authority or state;
- implement the sealed pending-operation interface;
- construct a semantic intent/reconciliation witness;
- use a mode/credential origin for a caller-bound operation;
- obtain raw commit authority through the capsule façade.

Rustdoc `compile_fail,E####` blocks may remain as documentation, but they are not evidence because rustdoc ignores the pinned code.

The actual enforcement should be the repository’s existing `scripts/check-security-boundaries.mjs`: it compiles inventoried fixtures with rustc JSON and requires the expected diagnostic code’s primary span to overlap the exact `@attack` expression. Extend its privilege-surface inventory so a renamed constructor, conversion, factory, re-export, or trait implementation is also covered.

## 8. Cost, sequencing, and abandonment criteria

### Rough cost

Primitive and capsule replacement:

- 600–900 production lines, much of it replacing existing generic capsule code;
- 1,000–1,600 runtime and attack-fixture lines;
- one capsule/watch adaptation, without touching the five hand-landed fences.

Remaining routes:

- grant inbox and OAuth proposal: roughly 300–500 production lines together;
- pairing presentation variant: 150–300;
- pending-effect approval: 350–600;
- ordinary plus atomic OAuth grant approval: 700–1,100;
- approximately 1,800–3,000 additional test lines.

A reasonable delivery is five reviewable landings:

1. sealed origin, capsule executor, compile-fail attacks;
2. grant inbox and OAuth proposal;
3. pairing presentation’s credential-ceremony origin;
4. pending-effect approval;
5. ordinary and OAuth grant approval together.

### Risks

The largest risks are not typestate mechanics. They are:

- accidentally preserving the current unsealed `PreparedAuthority` publication pairing;
- adding another open behavior trait while “sealing” `PendingCommit`;
- exposing an alternative raw commit authority;
- under-specifying semantic reconciliation;
- leaving an authorization-clock or OAuth sibling transaction outside the bound operation;
- treating pairing presentation’s lack of a caller permit as an optional caller-bound posture.

### Abandon the approach if

Stop and retain route-specific implementations if any of these becomes necessary:

- the executor must again accept state and authority as correlated arguments after origin binding;
- a production adopter must supply an arbitrary staging, guard, commit, or reconciliation closure;
- sealed kernel pending types cannot be implemented without exposing raw commit authority;
- the authority/publication binding cannot be sealed first;
- permit ownership must cross arbitrary evaluator, response, or external-I/O work;
- more than the two closed origins—caller-bound and pairing credential ceremony—are required for these five routes;
- tests cannot observe the actual worker handoff and actual SQLite cut;
- OAuth grant and code rows cannot be committed in one durable store transaction.

## Conclusion

The primitive is worth building, but not as the proposed exposed typestate and not beside the capsule.

The right design is a replacement capsule: one bound origin, private typestate, closure-scoped ownership, sealed kernel operations, typed terminal latching, one absolute deadline, and a permit-free terminal outcome. Four remaining routes use the caller-bound form directly; pairing presentation uses one explicit credential-ceremony variant. The five working fences remain untouched.