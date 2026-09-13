# Every landed split-phase fence holds its permit across an unbounded Local wait

Status: Open — program-level property of the split-phase pattern, not a single lane's defect
Created: 2026-08-22
Related: issues/shelved/20260822-critical-direct-route-fence-design.md (names the deadline-aware capsule
as the highest-risk item), LLP 0058

## The property

The split-phase pattern reserves caller authority OUTSIDE `LocalSnapback`, then acquires Local.
Between those two steps the permit is held, and the writer gate has two unbounded waits —
`lock_owned().await` and `wait_until_open().await`
(`crates/snapback-server/src/server/writer_gate.rs:85`).

Logout's premark then waits on the reservation drain
(`crates/snapback-sync/src/auth/coordinator.rs:688`), which also has no deadline. So:

1. A request reserves caller authority successfully.
2. It blocks waiting for the global writer, or for a closed managed-local handoff to reopen.
3. Logout premarks and waits on the drain.
4. If that writer/handoff wait never completes, the permit never drops and **logout never
   completes**.

This is not the non-reentrant `AdmissionState` self-deadlock. It is an indefinite drain dependency.

## Scope: this is the pattern, not a regression

It applies to every fence landed under this pattern — the primitive at the ordinary mutation seam,
the six asset sites, the nine migrated sites, and the asset follow-ups (all four finalize permits
and all three width permits). It is inherent to "reserve outside Local, then acquire Local".

The two reviewers disagreed on severity, which is worth recording: one treats holding the permit
across the Local wait as the split-phase rule working as intended; the other treats it as a
violation of the stated "no unbounded lock wait" property. Both descriptions are accurate. The
resolution is that the property as stated in commit messages is stronger than what the code
delivers.

## Why it has not bitten

The waits complete under normal operation. The exposure is to a wedged writer or a
managed-local handoff that never reopens — the same conditions that would already be degrading the
instance. No test exercises it, which is why it went unnoticed across several landings.

## The fix already has a design

`issues/shelved/20260822-critical-direct-route-fence-design.md` names the deadline-aware Local capsule as
the single highest-risk decision, and the design review specified it:

- wrap the existing queued `lock_managed_snapback` future in ONE absolute deadline; do not poll
  `try_lock_owned` (that would bypass queued writer ordering);
- pass the same deadline into the synchronous closure and check it immediately before
  `commit_guard`;
- return a typed pre-commit timeout with `effectCommitted = false`;
- once `COMMIT` starts, return only committed, proven rollback, or commit-uncertain — never
  timeout;
- prove every timeout and refusal drops reservations and terminal gates, that logout drains, and
  that no retry can duplicate a committed operation.

That capsule should be built and failure-injection tested ONCE, then adopted by the landed fences,
rather than reinvented per site.

## Correction to make

Commit messages for the landed fences state "no permit is held across an unbounded lock wait".
That is not accurate — none is held across a PUT, filesystem sync, fanout, or JS execution, which
is the property actually verified. The wording should be narrowed when the capsule lands.
