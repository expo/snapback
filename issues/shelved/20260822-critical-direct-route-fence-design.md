# Design: fencing the three Critical direct-route exposures

Status: Open — author rulings resolved 2026-08-22; Critical 1 landed, Criticals 2–3 remain
Created: 2026-08-22
Related: issues/shelved/20260821-residual-caller-terminal-write-exposure.md, LLP 0058,
issues/shelved/20260821-durable-authority-to-effect-handoff-design.md

## Shape

- **Critical 1** (detached actions' nested `ctx.runMutation`): reserve **once per nested
  mutation**, never once per action.
- **Critical 2** (grant / OAuth consent approval): one logical approval reservation, and make
  OAuth grant creation and code issuance **one SQLite transaction**.
- **Critical 3** (pending-effect approval): same primitive as Critical 2, but a separate approval
  state machine and storage integration — related, not identical.

Every permit begins only after handler, network and step-up work is complete, and ends immediately
after the final SQLite commit or rollback.

## The bounded commit capsule

1. Do handler execution, protected-room waiting, provider calls and step-up **without** a permit.
2. Reserve the authorized effect outside `LocalSnapback`.
3. Reacquire `LocalSnapback` **with a finite deadline**.
4. Do only bounded synchronous validation and SQLite work.
5. At the final cut, acquire other local gates first and `commit_guard()` last.
6. Drop guard and reservation immediately after commit/rollback — before fanout, response
   delivery, recursive execution or reconciliation reads.

**A liveness constraint that shapes the work:** `lock_managed_snapback()` loops without a deadline
(`crates/snapback-server/src/server/writer_gate.rs:85`). A permit must never be held across it, so
Criticals 2 and 3 need a deadline-aware variant. Logout's drain has no deadline either, so any
permit held across an unbounded wait converts this fix into a hang.

**Deadlock invariant:** both `validate()` and `effect_guard()` lock the same non-reentrant
`AdmissionState` mutex. So existing mode-only guards must be **replaced, not wrapped**, and nothing
after `commit_guard()` may re-enter admission validation.

## Critical 1 — the interesting one

Per-nested-mutation reservation, not per-action: a single action-scoped permit would block logout
for the action's entire lifetime.

If logout premarks first, that mutation's reservation refuses with the existing typed error and
**no app row, version, journal, job, membership or asset mutation commits**. If the mutation
reserved first, it commits before logout, and a later terminal latch must not abort it.

Recommended caller-bound semantics: the first terminal-authority refusal latches a cause-aware
terminal state; JS may catch the error and do pure computation, but subsequent authority-bearing
host calls refuse and the action cannot report success. Notably: **do not overload the existing
`abandoned: AtomicBool`** — it means watchdog timeout, and conflating the two loses the cause.
Logout need not synchronously kill the evaluator; the watchdog remains the hard bound.

Abandonment cannot replace per-mutation reservations, because **logout does not currently linearize
through the action's `commit_gate`**.

## AUTHOR RULINGS — RESOLVED 2026-08-22

The author selected caller-bound detached actions and one atomic OAuth consent
result in `issues/shelved/20260822-author-rulings-fence-program.md`. Those choices
unblocked all three Critical routes. Critical 1 subsequently landed; the
grant/OAuth and pending-effect approval implementations remain open.

### 1. Detached action ownership — resolved; formerly blocked Critical 1

Once a detached action has been accepted, is it the **caller's** effect or the **system's**?

- *Recommended — caller-bound:* logout prevents later nested durable effects; terminal refusal
  latches action failure; the evaluator may continue pure computation until a cooperative boundary
  or the watchdog.
- *Alternative — system-owned:* requires an explicit durable acceptance/handoff record and
  credential-free reconstructed authority, as jobs and watches do. Continuing to use the retained
  caller `PreparedAuthority` is **not** a valid version of this option.
- Sub-question: does "stop" mean fail at the next authority-bearing boundary, or proactively cancel
  the evaluator? The latter needs new coordinator-to-action cancellation wiring.

### 2. OAuth consent atomicity — resolved; formerly blocked the storage refactor

- *Recommended:* grant and authorization code are one atomic approval result.
- *Alternative:* the grant deliberately survives code-issuance failure — which then requires an
  explicit durable `approved-awaiting-code` state with retry, expiry and reconciliation rules. The
  current partial state is accidental, not a design, and is not an acceptable implementation of
  this option.

Critical 3 needs no ruling of its own; LLP 0058's effect-first/terminal-first ordering determines
its result.

## Ordered implementation sequence

1. Deadline-aware Local reacquisition helper and guarded auth-transaction commit seam; prove
   nothing under its `commit_guard()` re-enters admission validation.
2. Transaction-scoped clock/grant/OAuth helpers; atomic OAuth approval plus combined
   commit-uncertainty reconciliation.
3. Migrate grant and OAuth routes; remove their earlier mode guards; both-ordering and rollback
   tests.
4. Migrate pending-effect decision; separate reservation refusal from durable terminalization.
5. Per-nested-mutation reservations on managed HostPlan, detached HostPlan and detached Ibex;
   reverse the final guard order to watchdog first, mode last.
6. Implement the chosen detached-action terminal semantics and the full race matrix.
7. Audit every new guarded closure for admission re-entry, awaits, callbacks, network work and
   unbounded Local waits.

Note the scope boundary: this fences durable SQLite mutation effects only. Irreversible outbound
effects remain governed by the durable-handoff design.

## Provenance

Read-only codex design against `9eeaee876`. Full design with file:line citations appended below.

---

The implementable shape is:

- Critical 1: reserve once per nested mutation, never once per detached action.
- Critical 2: one logical approval reservation; make OAuth grant creation and code issuance one SQLite transaction.
- Critical 3: use the same reservation primitive as Critical 2, but it is a separate approval state machine and storage integration.

All permits begin only after handler/network/step-up work is complete, and end immediately after the final SQLite commit or rollback.

## Shared commit contract

LLP 0058 already defines the required order: reserve session/service authority outside `LocalSnapback`, carry the lock-free permits inward, and call `commit_guard()` at the deepest cut so mode is acquired last ([LLP 0058:1333](llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1333)). The implementation matches that contract: reservations are lock-free ([invocation.rs:1225](crates/snapback-sync/src/auth/invocation.rs:1225)), reservation refusal produces typed terminal diagnostics ([invocation.rs:1664](crates/snapback-sync/src/auth/invocation.rs:1664)), and `commit_guard()` installs the service witness before acquiring mode last ([invocation.rs:1246](crates/snapback-sync/src/auth/invocation.rs:1246)).

Every implementation below needs a “bounded commit capsule”:

1. Perform handler execution, protected-room waiting, provider calls, step-up, and other potentially unbounded work without an authorized-effect permit.
2. Reserve the authorized effect outside `LocalSnapback`.
3. Reacquire `LocalSnapback` with a finite deadline.
4. Perform only bounded synchronous validation and SQLite work.
5. At the final cut, acquire other local gates first and `commit_guard()` last.
6. Drop the commit guard and reservation immediately after commit/rollback, before fanout, response delivery, recursive execution, or reconciliation reads.

The ordinary `lock_managed_snapback()` loops without a deadline ([writer_gate.rs:85](crates/snapback-server/src/server/writer_gate.rs:85)), so Criticals 2 and 3 require a deadline-aware variant. A permit must never be held across that existing unbounded loop.

### Deadlock invariant

`AdmissionEffectGuard` retains a non-reentrant `MutexGuard<AdmissionState>` ([admission.rs:150](crates/snapback-auth/src/auth/admission.rs:150), [admission.rs:1002](crates/snapback-auth/src/auth/admission.rs:1002)). Both `validate()` and `effect_guard()` lock the same mutex ([admission.rs:938](crates/snapback-auth/src/auth/admission.rs:938), [admission.rs:947](crates/snapback-auth/src/auth/admission.rs:947)).

Therefore:

- Existing mode-only guards must be replaced, not wrapped.
- Nothing after `commit_guard()` may call `validate_admission`, `effect_guard`, `mode_effect_guard`, `reserve_authorized_effect`, or any helper that can reach them.
- Only transaction-final bookkeeping and `tx.commit()` belong under the guard.
- No callback, await, network operation, handler evaluation, or recursive `LocalSnapback` entry may occur under it.

## Critical 1 — detached actions’ nested mutations

### Current semantic fact

The detached Ibex host stores `invocation.authority().clone()` ([server.rs:2800](crates/snapback-server/src/server.rs:2800)), and `runMutation` derives the nested invocation with `inherit_for(NestedMutation)` ([server.rs:1403](crates/snapback-server/src/server.rs:1403)). That confirms the audit classification is still correct: detached actions retain caller-backed authority. They do not reconstruct credential-free job/watch authority.

`validate_live()` still checks only abandonment, generation, and deadline ([server.rs:1189](crates/snapback-server/src/server.rs:1189)).

### Reservation lifetime

Reserve once per nested mutation.

For the HostPlan path:

- Stage the mutation under Local.
- Release Local.
- Acquire the existing protected-room reservation at [server.rs:1414](crates/snapback-server/src/server.rs:1414).
- Then call `reserve_authorized_effect()` on the staged nested `PreparedAuthority`.
- Reacquire Local through the existing action-deadline-aware `lock_live()` at [server.rs:1416](crates/snapback-server/src/server.rs:1416).
- Drop the authorized reservation immediately after the SQLite commit, before after-local work or the next action step.

For detached Ibex, use the same sequence after the protected-room reservation at [server.rs:1518](crates/snapback-server/src/server.rs:1518) and before the bounded Local reacquisition at [server.rs:1525](crates/snapback-server/src/server.rs:1525).

Managed HostPlan action steps need a specialized forced-split writer helper. The existing generic helper can commit during its first Local turn when no protected-room reservation is required ([writer_gate.rs:493](crates/snapback-server/src/server/writer_gate.rs:493)); that leaves no outside-Local seam for the caller reservation. The specialized helper must always stage, release Local, reserve caller authority, and then reenter with the action deadline.

No action-wide reservation is acceptable: an action can run indefinitely and issue arbitrarily many mutations, so it would make logout’s deadline-free drain indefinite.

### Final guard order

The current engine closures acquire mode first and the action watchdog gate second ([engine.rs:17096](crates/snapback-engine/src/local/engine.rs:17096), [engine.rs:17399](crates/snapback-engine/src/local/engine.rs:17399)). Replace them with:

1. `lock_commit_live()` — action watchdog/abandonment gate.
2. `authorized_effect.commit_guard()` — mode last.
3. Existing action-only `check_live()`.
4. SQLite commit at [storage.rs:5489](crates/snapback-kernel/src/storage.rs:5489) or [storage.rs:6414](crates/snapback-kernel/src/storage.rs:6414).

The kernel invokes `check_live()` after constructing the commit guard ([storage.rs:5466](crates/snapback-kernel/src/storage.rs:5466), [storage.rs:6391](crates/snapback-kernel/src/storage.rs:6391)). Consequently, `validate_live()` must remain admission-mutex-free. The natural change “add `authority.validate_admission()` to `validate_live()`” would deadlock under the new commit guard.

### Refusal and action continuation

If logout/service retirement premarks first, that mutation’s reservation refuses with the existing typed session/service error. No mutation handler is rerun and no app row, version, journal, job, membership, or asset mutation commits.

INFERRED: the normal `action.runMutation` host-error path will surface this as a catchable JS error; the host bridge propagates `host.run_mutation(...)` failure directly ([host_glue.rs:4138](crates/snapback-engine/src/runtime/host_glue.rs:4138)). Confirm with an integration action that catches the error and attempts a second mutation.

Recommended caller-bound semantics:

- The first terminal-authority refusal latches a cause-aware terminal state on the action.
- JavaScript may catch the immediate error and perform pure computation, but subsequent authority-bearing host calls refuse and final action completion cannot report success.
- Do not overload the current `abandoned: AtomicBool`, because it maps to watchdog timeout semantics. Replace or supplement it with a typed terminal-cause latch.
- Logout need not synchronously kill the evaluator. The existing watchdog remains the hard bound for uncooperative computation.
- Abandonment remains necessary for timeout/generation teardown, but it cannot replace per-mutation reservations: logout does not currently linearize through the action’s `commit_gate`.

If the mutation reserved first, it commits before logout. A later terminal latch must not abort that already-reserved commit.

This design fences only durable SQLite mutation effects. It does not attempt to fence irreversible outbound effects; those remain governed by the separate durable-handoff design.

### Regression proof

Run the matrix across HostPlan and Ibex, and across session logout and finite-service retirement:

- Terminal wins: pause immediately before `reserve_authorized_effect`, commit logout/retirement, release the action, assert typed refusal and unchanged durable witnesses.
- Reservation wins: pause after reservation but before the commit guard, start logout/retirement, assert terminal completion is blocked, release the mutation, assert mutation commits first and terminal state second.
- Catch test: Ibex catches the first refusal, attempts another mutation, and returns normally; assert the second mutation also refuses and the action cannot publish successful completion under caller-bound semantics.
- Watchdog race: pause around action-gate acquisition while firing timeout and logout; assert bounded completion, no deadlock, and exactly one legal ordering.

Riskiest part: the interaction among protected-room reservation, action watchdog gate, and the admission guard. The guard order must change without introducing admission validation through the post-guard `check_live()` callback.

## Critical 2 — grant and OAuth approval

### Transaction design

Current grant approval first commits an authorization-clock observation ([auth_grants.rs:427](crates/snapback-kernel/src/storage/auth_grants.rs:427)), then runs the grant transaction beginning at [auth_grants.rs:438](crates/snapback-kernel/src/storage/auth_grants.rs:438). OAuth subsequently performs a second route-level Local operation ([oauth.rs:562](crates/snapback-server/src/server/oauth.rs:562), [oauth.rs:581](crates/snapback-server/src/server/oauth.rs:581)); code issuance itself has another clock transaction ([auth_integrations.rs:924](crates/snapback-kernel/src/storage/auth_integrations.rs:924)) before writing the code hash.

The final design should eliminate those sibling commits:

- Extract a transaction-scoped grant-approval helper.
- Call `advance_agent_clock_on(tx, now_ms)` inside that same transaction rather than `observe_agent_authorization_clock()` ([auth_agent_credentials.rs:1443](crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1443), [auth_agent_credentials.rs:1602](crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1602)).
- For ordinary grant approval, commit clock advance, proof consumption, grant insert, and request transition atomically.
- For OAuth, generate the raw code and hash before reserving authority, then commit clock advance, proof consumption, grant creation/request transition, and exact OAuth code-hash update in one auth transaction.
- Extend the auth transaction helper with a deepest `before_commit` callback. Invoke `reservation.commit_guard()` there, immediately before the existing commit seam in [auth.rs:1694](crates/snapback-kernel/src/storage/auth.rs:1694) or its commit-uncertain variant at [auth.rs:1718](crates/snapback-kernel/src/storage/auth.rs:1718).

INFERRED: these updates can be atomic because grant and OAuth records are written through the same auth database/transaction infrastructure. Confirm with a prototype transaction test that updates both tables and rolls back at an injected pre-commit failure.

### Reservation lifetime and multi-transaction rule

Complete provider admission and step-up verification first. Then reserve the approver’s `PreparedAuthority` outside Local, enter Local through a finite-deadline helper, perform the transaction, and drop the reservation immediately after commit/rollback. Do not retain it during response or redirect construction.

The general multi-transaction rule is:

- One logical authorized effect gets one `AuthorizedEffectReservation`.
- If sibling transactions are unavoidable, that reservation spans all of them synchronously, while each transaction obtains and releases a fresh `commit_guard()`.
- Never take a new reservation per sibling transaction: logout could win in the gap.
- Never hold one `AuthorizedEffectCommitGuard` across two transactions.

This is already demonstrated by asset cancellation using one reservation and separate commit guards at [engine.rs:12898](crates/snapback-engine/src/local/engine.rs:12898) and [engine.rs:12905](crates/snapback-engine/src/local/engine.rs:12905).

For the final OAuth design, however, there should be only one transaction and one guard.

### Half-completed OAuth approval

Recommendation: a grant must not survive without its corresponding OAuth authorization code. Consent through the OAuth facade is one ceremony, so grant creation and code-hash publication should be atomic.

Commit uncertainty reconciliation must verify the complete tuple: request approved, exact grant identity/content, OAuth request bound to that grant, and exact generated code hash. Only then may it return the in-memory raw code. Any injected failure before commit leaves the request pending, proof unconsumed, no grant, no code hash, and no clock advance.

A committed but undelivered code because the connection disappears is not a half transaction; it is an ordinary lost response. The short-lived code expires and the client repeats authorization.

### Existing guards to remove

Do not wrap these with the new guard:

- Grant route mode guard at [server.rs:15030](crates/snapback-server/src/server.rs:15030).
- OAuth approval guard at [engine.rs:4913](crates/snapback-engine/src/local/engine.rs:4913).
- OAuth code-issuance guard at [engine.rs:4932](crates/snapback-engine/src/local/engine.rs:4932).

They must disappear when the deepest commit callback is installed; retaining any of them creates non-reentrant admission locking.

### Regression proof

- Logout wins: pause before reservation, commit logout, then assert typed refusal, request still pending, proof unconsumed, no grant/code hash, and unchanged authorization clock.
- Reservation wins: pause after reservation, start logout, prove logout is blocked, commit the atomic approval, drop the permit, and prove logout commits afterward.
- Inject failure after the grant insert but before OAuth-row update; assert rollback leaves neither grant nor code.
- Inject commit uncertainty and verify reconciliation accepts only an exact complete pair.
- Run the ordinary-grant variants separately, including retry of an already-approved request.
- Bound every race test so reentrant admission locking fails as a timeout rather than hanging the suite.

Riskiest part: preserving existing idempotency and commit-uncertainty semantics while merging OAuth’s grant and code state machines.

## Critical 3 — pending-effect approval

This uses the same primitive as Critical 2, but it is not the same implementation. Grant/OAuth needs transaction consolidation; pending-effect approval already has one atomic decision transaction ([pending_effects.rs:624](crates/snapback-kernel/src/storage/pending_effects.rs:624)).

### Reservation lifetime

- Perform inbox lookup, frozen-original-authority preparation, and async step-up without a permit.
- Reserve the management/approver `PreparedAuthority` outside Local.
- Reenter Local through the finite-deadline helper.
- Re-run cheap generation/function/policy validation because state may have changed during step-up.
- Execute proof consumption, `pending → approved`, and journal append in the existing single transaction.
- Acquire `commit_guard()` only at its final commit.
- Drop the approver reservation before dispatching the original mutation/action at [effects.rs:326](crates/snapback-server/src/server/effects.rs:326).

The original execution is a new logical effect under the frozen original authority. It must take its own reservation through the normal mutation/action path. The approver’s permit must never cover that recursive invocation.

Likewise, settlement gets no approver permit. INFERRED: it is terminal accounting for an outcome already caused, consistent with LLP 0058’s accounting rule ([LLP 0058:1391](llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1391)); confirm that classification separately if pending-effect settlement has not been expressly added to the ruling.

The lookup phase can independently commit lazy expiry, as the audit notes at [the issue:243](issues/shelved/20260821-residual-caller-terminal-write-exposure.md:243). That is not covered by the approval permit: it must either become read-only or receive its own short reservation in the separate lazy-write closure. Do not span lookup, step-up, and approval with one permit.

### Refusal behavior

If approver logout wins, reservation refuses before the decision transaction:

- The pending effect remains pending unless independently expired.
- Step-up proof remains unconsumed.
- No decision or journal entry is written.
- Original execution is not dispatched.

The current error handler terminalizes almost every approval error by calling `refuse_after_revalidation()` ([effects.rs:211](crates/snapback-server/src/server/effects.rs:211), [effects.rs:223](crates/snapback-server/src/server/effects.rs:223)). An authority-terminal reservation refusal must bypass that path; otherwise a logged-out approver’s failed approval becomes a durable refusal.

Prefer a structural result such as `ApprovalPreconditionFailure` versus `DecisionAttempted`, rather than adding more diagnostic strings to `decision_error_terminalizes`.

If the approval reservation wins, the approved transition commits before logout. The approval survives; execution then succeeds or refuses according to the independently revalidated original authority.

### Existing guard to remove

Replace the mode-only guard at [engine.rs:5114](crates/snapback-engine/src/local/engine.rs:5114). Do not surround the whole handler with `commit_guard()`: lookup and original service revalidation already take their own guards at [engine.rs:4986](crates/snapback-engine/src/local/engine.rs:4986) and [engine.rs:5005](crates/snapback-engine/src/local/engine.rs:5005), and the handler performs async step-up.

### Regression proof

- Logout wins before approval reservation: effect remains pending, proof unconsumed, no journal transition, no original execution.
- Reservation wins: logout blocks until `approved` and its journal entry commit, then completes.
- Repeat reservation-wins with independently live/anonymous original authority: original execution occurs only under its own fence.
- Repeat with the original authority already terminal: approval remains committed, but original execution refuses.
- Force the reservation failure through the current error branch and assert that `refuse_after_revalidation()` is not called.
- Add a bounded deadlock regression proving the approver permit is dropped before recursive mutation/action invocation.

Riskiest part: correctly separating pre-decision failure, durable refusal, committed approval, recursive original execution, and settlement without carrying the wrong authority across phases.

## Ordered implementation sequence

1. Obtain the two semantic rulings below and record them in the governing LLPs.
2. Add a deadline-aware Local reacquisition helper and guarded auth-transaction commit seam. Prove that nothing under its `commit_guard()` re-enters admission validation.
3. Extract transaction-scoped clock/grant/OAuth helpers and implement atomic OAuth approval plus combined commit-uncertainty reconciliation.
4. Migrate ordinary grant and OAuth routes; remove their earlier mode guards; add both-ordering and rollback tests.
5. Migrate pending-effect decision; structurally separate reservation refusal from durable terminalization; add both-ordering and recursive-execution tests.
6. Add per-nested-mutation reservations to managed HostPlan, detached HostPlan, and detached Ibex paths; reverse the final guard order to watchdog first, mode last.
7. Implement the selected detached-action terminal semantics and the HostPlan/Ibex/session/service/watchdog race matrix.
8. Audit every new guarded closure for admission re-entry, awaits, callbacks, network work, and unbounded Local waits.

## Author rulings — resolved 2026-08-22

The authoritative rulings are recorded in
`issues/shelved/20260822-author-rulings-fence-program.md`; the alternatives below are
retained as the design record, not as current blockers.

1. **Detached action ownership — required before Critical 1 semantics are implemented.**

   - Recommended: caller-bound. Logout prevents later nested durable effects; terminal refusal latches action failure, though the evaluator may continue pure computation until a cooperative boundary/watchdog.
   - Alternative: system-owned once accepted. This requires an explicit durable acceptance/handoff record and credential-free reconstructed authority, analogous to jobs/watches. Merely continuing to use the retained caller `PreparedAuthority` is not valid.
   - Sub-question: whether “stop” means fail at the next authority-bearing boundary, or requires proactive session/service cancellation of the evaluator. The latter needs new coordinator-to-action cancellation wiring.

2. **OAuth consent atomicity — required before the OAuth storage refactor.**

   - Recommended: grant and authorization code are one atomic approval result.
   - Alternative: the grant intentionally survives code-issuance failure. That requires an explicit durable `approved-awaiting-code` state, retry/resume rules, expiry, and reconciliation; the current accidental partial state is not an acceptable implementation.

No additional ruling is required for the pending-effect approval fence itself: LLP 0058’s effect-first/terminal-first ordering determines the result. The settlement classification should be expressly confirmed, but it does not block fixing the Critical approval transition.

No files were modified.
