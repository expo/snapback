# Q16 (authorized lease signing) is blocked on crate ownership, not on effort

**Status:** Open — needs a design decision
**Impact:** 3
**Urgency:** 2
**Systems:** Auth, Kernel, Engine
**Date:** 2026-08-24
**Related:** LLP 0303, `issues/shelved/20260824-implementation-plans-remaining-p2-rows.md` (Q16, F073),
  `issues/shelved/20260824-test-support-tiering.md`

## Outcome

The lane **stopped without changing anything**, under an explicit stop condition in its brief:
*if the row cannot be closed without introducing a new seal or provenance identity, stop and say
so rather than inventing one.* It reached that conclusion in a single round.

This is recorded as a result, not a failure. Four earlier lanes in this program each invented such
an artifact, and each was blocked by an executable review — costing between two and four rounds
apiece. A correct stop in one round is cheaper than a correct fix in four.

## Why it cannot be done as scoped

The DERIVE boundary Q16 needs spans three crates whose ownership does not line up:

- `crates/snapback-kernel/src/auth/lease.rs:260` exposes the raw signer.
- `crates/snapback-auth/src/auth/provider.rs:3011` exposes the raw provider wrapper.
- `crates/snapback-engine/src/local/engine.rs:4518` owns the private capture fields but accepts an
  **independently supplied** provider — which is the defect.
- `EngineAppStateGraphIdentity` — the repo's accepted provenance shape — is **engine-owned**, so it
  cannot grant crate-private access to the lower auth and kernel crates.

Removing the provider parameter only at `AuthorizedLeaseCapture` would leave the public kernel and
provider bypasses intact, so the row would not actually close. Making those methods private breaks
the cross-crate call chain.

Bridging it needs one of:

1. **A new graph-bound capture/signing artifact** owned below the engine, so kernel and auth can
   both reference it. This is exactly the artifact class that requires the LLP 0303 provenance
   corollary applied in full, and it is a design decision rather than a lane's call.
2. **An ownership relocation** moving the signer or the capture into a crate that can hold the
   binding privately.

Q16's own batching rule requires the complete signer/capture provenance change to land together, so
a partial fix was not available either.

## A correction to the landed plan

The Q16 plan states `from_test_key` is kernel-test-only. It is not: it is enabled by
`feature = "test-support"` at `crates/snapback-kernel/src/auth/lease.rs:252`, which makes it
reachable by any dependent that turns that feature on. That matters because the plan's reasoning
partly rested on it being unreachable.

This is consistent with `issues/shelved/20260824-test-support-tiering.md`, which found 171 of 172 class-C
bypass items reachable from a dependent crate.

## Measurements

- Raw-SQL privilege ratchet before: **105 violations**; after: **105**. Unchanged, correctly, since
  nothing was modified.
- `./ref-check --verbose`: 308 LLP docs, 6,732 refs, 0 errors.
- No tests added, so fail-first evidence is not applicable — stated rather than omitted.
