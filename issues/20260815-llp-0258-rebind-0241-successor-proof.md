# LLP 0258 rebind lacks an LLP 0241 successor proof

**Status:** Open
**Date:** 2026-08-15
**Systems:** Application auth bootstrap, generated application identity, supervised development
**Related:** LLP 0258 D2; LLP 0241 D2/D4/D5

## Problem

`SnapbackAppBindingV1` currently carries the generated schema, functions, and
descriptor identities plus an opaque `supervisorGeneration`, `issuedAt`, and
`expiresAt`. It does not carry LLP 0241's authenticated activation candidate,
expected predecessor generation, activation nonce, or served-generation
readiness receipt. The app-client owner therefore cannot prove that a
cross-generation binding is the committed successor of its exact live
generation.

The 2026-08-15 fix-forward makes the subset that can be proved sound: expired
supervised bindings are refused, `issuedAt` is a non-rewinding live-owner
watermark, cross-generation admission requires a strictly later issue time,
retired generated identities cannot retake the owner, and every binding is
checked against the generated app identities and stable app/origin/routing
target. These checks reject stale arrivals but are not an LLP 0241 successor
proof.

## Required closure

- Extend the generated application/binding handoff with an authenticated LLP
  0241 successor fact naming the exact predecessor and candidate generation.
- Bind that fact to the served-generation/readiness receipt and the admitted
  app/origin/routing target.
- Make app-client rebind compare the fact to the owner's exact live generation;
  timestamps may remain freshness bounds but must not be succession authority.
- Add forged, replayed, wrong-predecessor, aborted-candidate, and post-commit
  stale-arrival fixtures.

Until those facts ship, do not claim that app-client cross-generation rebinds
implement the full LLP 0241 successor-proof requirement.
