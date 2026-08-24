# The two-axis defect is systemic: 153 sites, one root cause

Status: open
Date: 2026-08-23
Systems: snapback-sync, snapback-engine, snapback-kernel
Related: LLP 0283 F-1, LLP 0297,
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
