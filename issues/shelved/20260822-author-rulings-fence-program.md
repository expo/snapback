# Author rulings: the five open questions in the authorized-effect fence program

Status: Ruled 2026-08-22 by the author. Implementable.
Created: 2026-08-22
Related: issues/shelved/20260822-authorized-effect-program-status.md,
issues/shelved/20260822-critical-direct-route-fence-design.md,
issues/shelved/20260822-stream-attempt-refactor-design.md,
issues/shelved/20260822-bounded-commit-capsule-spec.md,
issues/closed/20260821-terminal-accounting-settlement-ruling.md

Five questions had accumulated that engineering could not settle. All five are now ruled. Each
records the ruling, the reasoning, and what it unblocks, so lanes and later sessions act on the
decision rather than rediscovering the question.

## 1. Detached-action ownership — CALLER-BOUND

> Once accepted, is a detached action the caller's effect or the system's?

**Ruled: caller-bound.**

Logout prevents later nested durable effects. The first terminal-authority refusal latches a
cause-aware terminal state on the action. JavaScript may catch the immediate error and perform pure
computation, but subsequent authority-bearing host calls refuse and the action cannot report
success. Logout need not synchronously kill the evaluator; the existing watchdog remains the hard
bound for uncooperative computation.

Implementation notes carried from the design:

- Reserve **once per nested mutation**, never once per detached action. An action-scoped permit
  would block logout for the action's entire lifetime, and logout's drain has no deadline.
- **Do not overload the existing `abandoned: AtomicBool`.** It means watchdog timeout; conflating
  it with authority termination loses the cause. Use a typed terminal-cause latch.
- Abandonment cannot substitute for per-mutation reservations, because logout does not currently
  linearize through the action's `commit_gate`.

The system-owned alternative was rejected as currently specified, not in principle: it would
require an explicit durable acceptance/handoff record and credential-free reconstructed authority
as jobs and watches use. **Continuing to use the retained caller `PreparedAuthority` is not a valid
version of that option** — it is the defect, not an implementation of the alternative.

**Unblocks:** Critical 1, the highest-consequence remaining exposure.

## 2. OAuth consent atomicity — ONE ATOMIC RESULT

> May a grant survive code-issuance failure?

**Ruled: the grant and the authorization code are one atomic approval result.**

The alternative — a grant that deliberately outlives code-issuance failure — would require an
explicit durable `approved-awaiting-code` state with retry, resume, expiry and reconciliation
rules. Today's partial state is accidental rather than designed, so it is not an implementation of
that alternative either.

**Unblocks:** Critical 2's storage refactor.

## 3. Watchdog versus the never-wait-for-Local rule — BOUNDED TERMINAL TRANSACTION

> Crash-safe `timed_out` linearization needs Local before the runner gate, but the watchdog
> currently refuses to wait for `LocalSnapback` so a wedged owner cannot defeat the timeout.

**Ruled: handler execution stays time-bounded, and the response waits for the bounded terminal
transaction.** Permanent storage failure returns a storage failure and keeps an owned retry
pending.

The separate host settlement connection/lane was rejected as materially larger and requiring
reset/schema/SQLite-writer ordering work. Returning the timeout before durability was rejected
because it does not provide the immediate-reopen guarantee.

**Unblocks:** stream refactor R4. R1 has landed; R2 and R3 never needed this.

## 4. Capsule rollout — COMMON DEFAULT, NARROW RETRY

> A common deadline budget or per-operation budgets? Automatic retry for every call or only
> idempotency-bearing paths?

**Ruled: a common five-second default with explicit per-site overrides**, framed as a final-cut
admission budget rather than a claim about COMMIT duration.

**Ruled: automatic retry only for exact, unchanged, idempotency-bearing operations.** Approvals and
management routes surface the typed timeout unless they first gain a durable retry identity.

Note for adopters: adoption is wire-compatible and additive but **not behaviourally invisible** — a
request that previously waited indefinitely can now return a typed 503, and older clients will
surface the new diagnostic rather than retrying automatically.

**Unblocks:** capsule adoption across routes, and retrofitting the landed fences that currently pin
logout on an unbounded Local wait.

## 5. Terminal accounting — RETIREMENT BLOCKS NEW HANDOFFS ONLY

> When a live caller authorizes a durable handoff and then logs out or is revoked, does retirement
> block only new handoffs, or retroactively veto settlement?

**Ruled: retirement blocks new handoffs. The durable predecessor owns completion and settlement.**

This question largely dissolved under analysis: push settlement and capability-use settlement are
already correct — push has a real structural handoff (`claimed → transmitting` commits before the
first provider byte), and capability use consumes its authority atomically at consumption, before
the function runs. Only Ask is affected, and there fencing the accounting write would be actively
harmful: provider turns can already continue after logout, so fencing the final write would not
stop them — it would hide their outcome and strand up to a full per-request maximum for as long as
a month.

The Ask fix is the durable run/turn structure the authority-to-effect handoff design already calls
for, not a session fence.

**Unblocks:** nothing was waiting, but it closes the INFERRED status that made three settlement
classifications provisional.

## What remains genuinely open

Nothing in this packet remains an author blocker. The two repository-context
questions listed here originally were resolved later on 2026-08-22: the stale
`api.d.mts` reviewed row was removed, and `check-inventories` gained its CI
workflow. Their records are in
`issues/closed/20260822-agent-safe-publication-leaf-set-red-on-main.md` and
`issues/closed/20260821-check-inventories-has-no-mechanical-enforcement.md`.
