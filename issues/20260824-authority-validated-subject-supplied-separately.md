# The defect class is wider than two authority axes: subject identifiers count too

Status: open
Date: 2026-08-24
Systems: snapback-engine, snapback-kernel
Related: issues/20260823-uncorrelated-authority-axes-are-systemic-153-sites.md,
  issues/20260824-correlation-design-review-synthesis.md,
  issues/20260824-uncorrelated-staging-entry-point-inventory.md

## Live finding, verified: grant revocation planning does not check ownership

`LocalSnapback::plan_grant_revocation_service_terminal`
(`crates/snapback-engine/src/local/engine.rs:5940`) performs exactly one authority check:

```rust
authority.validate_admission("grant revocation planning")?;
self.db.plan_grant_revocation_service_terminal(user_id, grant_id, now_ms)
```

It never verifies that `authority` owns `user_id` or `grant_id`. The kernel planner simply
queries the token set named by the supplied identifiers
(`crates/snapback-kernel/src/storage/auth_grants.rs:1020`), the returned opaque plan exposes
`acquire_gate()` (`engine.rs:3302`), and the write sink accepts that gate separately from the
caller subject and performs the revocation named by its string arguments (`engine.rs:5958`,
`auth_grants.rs:1052`).

The production route is correct only by discipline: it derives the user from the authority via
`require_grant_session(&authority)` (`crates/snapback-server/src/server.rs:17499`) and passes
that. Nothing structural requires it to. The bulk-revocation twin has the same shape
(`engine.rs:5969`).

Reachable from in-crate code only, like every other finding in this program — a structural
guarantee against future incorrect code, not a remotely exploitable hole.

## Why this widens the class

Every previously recorded instance was *authority vs. reservation*: two authority-bearing
values, uncorrelated. This site has **no reservation at all**. The second axis is a pair of
plain identifier strings, and the same disease is present: the authority is validated, the
subject is supplied separately, and the two are never correlated.

So the class is not "two authority axes are uncorrelated". It is:

> **an authority is validated, the subject it acts on is supplied independently, and nothing
> ties them together.**

The earlier guard-call sweep could not have found this: it enumerated
`commit_guard`/`commit_guard_classified` acquisitions, and this is a *planning* function that
takes no reservation. Any claim of a closed population must widen its search predicate
accordingly — the current enumeration is incomplete in kind, not merely in count.

## Consequence for the design

This breaks the remedy's R5 as written. A caller-authorized session A can plan terminal work
for victim B, acquire a genuine installed-registry closed carrier for B through the legitimate
public factory, and commit B's revocation through it. Private fields do not help, because the
sanctioned factory produces the carrier.

Per the adversarial pass: blocking this requires **one product carrier that consumes both the
caller-bound effect and the exact terminal plan, and verifies ownership while constructing
them**. A separate terminal carrier is insufficient. "Closed" must mean closed to the caller
class, not merely privately constructed.

## Limits of the analysis that produced this

The adversarial pass ran before the staging inventory landed and against a commit where the
proposed carrier types do not exist, so it could not enumerate hypothetical constructors
exhaustively and said so. It reports violations in R1, R4 and R5 plus a durable-write path
outside the proposed final cut; only the R5 grant-revocation finding above has been verified
here. The remaining findings are recorded as unverified and must be checked individually before
they are relied on or dismissed.
