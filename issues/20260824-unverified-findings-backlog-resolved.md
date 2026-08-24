# The unverified-findings backlog is now settled: all five CONFIRMED, three with corrections

Status: open
Date: 2026-08-24
Systems: snapback-sync, snapback-auth, snapback-engine
Related: issues/20260822-authorized-effect-program-status.md,
  issues/20260824-sealed-plan-protocol-already-exists-and-is-already-broken.md,
  issues/20260823-mandatory-authority-correlation-design.md

## Why this ticket exists

Five findings had accumulated across several tickets as "reported but unverified, must be checked
before being relied on or dismissed." An unverified finding quietly becomes a believed one, so they
were sent for adjudication with REFUTED and UNRESOLVED explicitly welcomed as answers.

All five came back CONFIRMED — but three carry mechanism corrections that change what the fix has
to do. The corrections are the point of this ticket; a bare "confirmed x5" would have lost them.

## V5 — CONFIRMED (verified independently here). Breaks authority uniqueness, not epoch draining.

`AdmissionLease` is `#[derive(Clone)]` and its own doc comment states that clones share one token
(`crates/snapback-auth/src/auth/admission.rs:816`):

```rust
/// A counted root admission. Its clones share one `LeaseToken`.
#[derive(Clone)]
pub struct AdmissionLease { token: Arc<LeaseToken> }
```

`prepare_admitted_authority` is public and accepts the lease and the resolved authority as
**independent parameters** (`crates/snapback-sync/src/auth/invocation.rs:2714`). So one cloned lease
can prepare two different `PreparedAuthority` values.

**Correction that matters:** this breaks *authority uniqueness*, not epoch draining as originally
framed. Consequence: **any correlation predicate keyed on the admission lease is defeated.** The
design's own candidate table already rated the exact-lease predicate "close, but still too loose"
and cited this function; that judgement is now verified rather than assumed.

## V1 — CONFIRMED, with a mechanism correction

The `prepare_function` claims hold: `bind_elevation_root` mutates the embedded `PreparedAuthority`
(`invocation.rs:2946`, `:1794`), and exact service scope is selected by function ID **and kind**
(`:3029`). The mechanism differs from the original report in how scope selection is keyed, which
matters because a correlation identity must therefore distinguish function *kind* as well as ID.

## V2 — CONFIRMED for substituted session publication

Narrower than the original claim: confirmed for a substituted **session** publication specifically,
not for publication substitution in general. Fixes should not be scoped to the broader framing.

## V3 — CONFIRMED; production-compiled code can reach it

The `ServiceAuthorityFenceRegistry` forgeability chain holds, and the verification adds the part
that was open: production-compiled code can actually reach it, rather than it being only a
test-configuration artifact.

## V4 — CONFIRMED narrowly; it is not wholly unfenced

A durable-write path outside the proposed final cut exists, but it is **not** wholly unfenced as the
adversarial pass implied. Treat it as a gap in the cut's coverage, not an open door.

## Consequence

The backlog of unverified claims is empty as of this ticket. Three of the five were directionally
right but wrong in mechanism — the same pattern that has already changed the fix twice in this
program — which is why they were adjudicated individually instead of being carried forward as a
count.
