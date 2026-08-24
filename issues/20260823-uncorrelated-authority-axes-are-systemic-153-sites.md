# The two-axis defect is systemic: one root cause, ~48 real guard sites

> **Corrected 2026-08-24.** The original title and counts said "153 sites". That number
> conflated generic-bound *occurrences* with actual guard acquisitions. See
> "Correction" at the end. The root cause and its consequences are unchanged.

Status: open
Date: 2026-08-23
Systems: snapback-sync, snapback-engine, snapback-kernel
Related: LLP 0283 F-1, LLP 0298,
  issues/20260823-two-landed-fences-do-not-correlate-the-authority-axes.md,
  issues/20260822-claims-versus-enforcement-is-endemic.md

## Summary

A repo-wide sweep (dispatched after the same defect was found in three fences by accident)
enumerated the complete population. This is not three bugs. It is **153 signatures with no
axis-to-axis comparison anywhere**:

- 54 engine-layer signatures taking an independently supplied subject/intent and commit authority
- 99 kernel transaction/forwarding signatures taking an independent `BeforeCommit` closure
  (one `cfg(test)`-only)
- 0 comparisons of the two axes in any of the 153

## Root cause, verified directly

`AuthorizedEffectReservation` retains its own cloned `PreparedAuthority` at mint
(`crates/snapback-sync/src/auth/invocation.rs:2202`, `:2271`) and `commit_guard_classified`
validates **only that retained authority** (`invocation.rs:1663`).

Its complete public surface is `into_error`, five `*_for_test` helpers, `commit_guard`, and
`commit_guard_classified`. **There is no authority accessor and no comparison API.**

I checked the two candidate accessors that appear nearby and they belong to other types:
`matches(&PreparedAuthority) -> bool` at `invocation.rs:2447` is `impl RetainedLiveAuthority`,
and `authority()` at `:2539` is `impl PreparedInvocation`.

Consequence: **a sink holding a reservation cannot ask whether it belongs to the same authority
as the subject it is about to commit.** The comparison is not merely omitted at 153 sites; it is
unexpressible with the current API. Every one of those sites is correct only by caller discipline.

## Resolution of the open question from the prior ticket

The prior ticket flagged that I had verified `bind` discards `prepared` for the ordinary
`Authorized` variant but had not checked for an upstream correlation point. The sweep traced it
end to end: **there is none. Both the ordinary and action variants are live.** The critical
finding covers two paths, not one.

## Scale of exposure

Durable effects reachable with a mismatched pair, per the sweep: capability-link rows,
invitation and pairing secrets and rows, ask-spend reservations, push attempt/claim/transmitting
rows, mutation-settlement acknowledgements, agent credentials and principals, grant
approval/denial/revocation, durable invalidation-retry resolution, asset attempt/receipt rows,
lazy expiry, cancellation, TUS offset acknowledgement, publication plans and staged state, asset
completion/quota/rendition rows, failure and delivery receipts, signed-URL issuance, tombstones,
and host-plan/Ibex mutations with their versions and receipt state.

Shortest composition, generic across the engine sites:
`r_b = authority_b.reserve_authorized_effect(..)?; local_a.operation(&authority_a, intent_a, r_b)`
— no privacy, lifetime, or typestate blocker. For the eight raw-guard sites the body literally
discards the guard (`let _ = effect`) before writing.

Latent rather than live (mismatch suppliable, no durable write at that site): the two width
preflight sites at `engine.rs:15432` and `:15548`, and `upsert_stream_attempts_guarded` whose
only production caller supplies `|| Ok(())`.

## The positive model already in the repo

`RetainedLiveAuthority::matches(&PreparedAuthority)` at `invocation.rs:2447` is exactly the
missing shape. The landed capsule path is also structurally correlated and the sweep confirmed
its defect is not present on main (it exists only on the unlanded branch, now fixed there).

## Recommended direction — this changes the program

**Fence-by-fence cannot close a 153-site class.** Three fences have already each rebuilt the
same mistake, and 150 sites remain untouched. Continuing per-site guarantees more of the same
work and more false PROPERTY claims.

Proposed root fix: make the comparison **mandatory and unskippable at the guard**, by changing

    reservation.commit_guard(effect)
to
    reservation.commit_guard(effect, &subject_authority)

which compares internally against the retained authority and refuses on mismatch. This is one
signature change that closes all 153 sites at once, because every site must then produce its
subject authority to obtain a guard. Sites that cannot produce one are precisely the sites that
were already wrong, so the compiler enumerates the real work instead of a reviewer finding it
three fences at a time.

This needs its own reviewed design before implementation; it touches every guarded write in the
system. It should probably supersede the remaining per-path fence work in LLP 0283 F-1.


## Correction (2026-08-24) — counts, mechanism, and completeness

A follow-up feasibility pass re-derived the population from code. Three of this ticket's
claims were wrong or misleading. I verified each correction directly.

**1. "153 sites" conflates two different things.** The 99 kernel entries are 99
`BeforeCommit: FnOnce() -> SnapbackResult<G>` *generic-bound occurrences* — including three
bodyless trait declarations, their three implementations, a test-only helper, and many layers
forwarding the same closure. They converge on **eight** actual `before_commit()` invocation
points. They are not 99 independent authority seams.

The real reachable population for a guard-signature change is roughly **45 production
`AuthorizedEffectReservation::{commit_guard,commit_guard_classified}` calls in `engine.rs`**
(49 textual occurrences including definitions and match arms), plus the eight raw
`AdmissionEffectGuard` paths, plus the eight kernel cut points.

**2. `let _ = effect` does NOT discard the guard.** This ticket said the eight raw-guard
bodies "literally discard the guard (`let _ = effect`) before writing." That is wrong. The
parameter is a borrowed reference — `effect: &AdmissionEffectGuard<'_>`
(`crates/snapback-engine/src/local/engine.rs:5703`) — so the caller-owned RAII guard remains
alive across the database call. Admission/epoch protection is intact at those sites. What is
discarded is any ability to *inspect or correlate* the guard. The defect is narrower and more
precise than stated: missing correlation, not missing admission.

**3. The population was incomplete.** `server.rs:932` performs
`commit_guard_classified("detached action child mutation commit")` inside
`NestedActionEffectCommitGuard` and sits outside the enumerated engine population. A sweep
that misses a guard call is not a closed enumeration.

**4. This ticket carries no site table**, so its counts were not independently checkable — a
gap I introduced by summarizing rather than recording. Any future claim of a closed population
must land the table with it.

**5. The two commit-capsule calls are already structurally correlated**, because
`CommitCapsuleReservation` stores both the authority and the reservation. They are prior art,
not defect sites.

### Feasibility buckets

Can each site produce a subject authority where it needs the guard?

| Bucket | Count |
|---|---:|
| A. Has one in scope | 40 |
| B. Has one upstream (threadable) | 90 |
| C. Genuinely unscoped at this signature | 23 |
| D. Several ambiguous candidates | 0 |

Bucket C is conservative: a shared generic signature was classified C if *any* legitimate
production use of it is unscoped. Those 23 are why a non-caller mechanism is unavoidable, which
supports — rather than undercuts — the separate closed carriers in
`issues/20260823-mandatory-authority-correlation-design.md`. There is no bucket D, so no site
requires guessing which of several authorities is the subject.

### What does not change

The root cause stands exactly as recorded: `AuthorizedEffectReservation` retains its own cloned
`PreparedAuthority` and exposes no accessor and no comparison API, so the correlation is
unexpressible rather than merely omitted. The three confirmed live defects stand. The direction
stands. Only the headline number, the raw-guard mechanism, and the completeness claim were wrong.
