# Centralize served capability-manifest composition

**Status:** Open  
**Area:** Local target, capability admission and inspection  
**Found by:** LLP 0102 Research Room remediation  
**Date:** 2026-07-29  
**Governing:** LLP 0058, LLP 0076

## Problem

The local runtime constructs its served capability manifest separately for
ordinary function admission, sessions complete-pair preflight, inspection, and
RQS generation. The Research Room arm demonstrated the failure mode: one seam
used the conservative committed declaration instead of exact process-live
facts, so a stream-capable sessions artifact was refused even when that process
enabled outbound actions.

The immediate defect is repaired by commit `894ddaf99`, but duplicated
composition remains drift-prone.

## Desired outcome

- One internal constructor samples the exact process-live target facts.
- Every local admission and reporting consumer uses that constructor.
- Tests prove identical capability support across sessions preflight, ordinary
  function loading, inspect, and generation identity.
- Disabled outbound actions remain fail-closed.
- Candidate artifacts cannot contribute or elevate target authority.

Preserve LLP 0058's complete-pair/auth invariants and LLP 0076's conjunctive
registered-implementation plus process-live egress predicate.

## Evidence

- `demos/backend-bakeoff/arms/research-room/snapback/receipts/sessions-stream-admission-defect.v1.json`
- `src/local.rs`
- `src/manifest.rs`

## Triage freshness note (2026-08-01 sweep) — scope narrowed

Largely landed since filing: one constructor
(CapabilityManifest::local_v0_instance, src/manifest.rs) is now called
by all four serving sites (src/local.rs:3497, 3689, 5183, 11562), so the
Problem statement overstates the current tree. Remaining residuals only:
(1) the post-construction vm_lifecycle warm-VM override is duplicated
verbatim at src/local.rs:5191 and :11567; (2) no cross-seam capability
parity test exists. Close if those two are judged out of scope.

## Resolution (2026-08-03)

The constructor centralization had already landed
(`CapabilityManifest::local_v0_instance` at all four serving sites); this
close lands the two narrowed residuals:

1. **Override dedup** — the post-construction warm-VM `vm_lifecycle`
   override, previously duplicated verbatim in `inspect_core` and
   `rqs_generation_digest`, is extracted into one helper
   (`LocalSnapback::served_capability_manifest`, `src/local.rs`). Both
   reporting seams now compose the served manifest through that single
   helper (instance constructor + warm-VM lifecycle override), carrying
   the LLP 0076 instance-live and LLP 0009 lifecycle-honesty `@ref`s.
   The admission seams (preflight, ordinary function loading) still
   compose the bare constructor from the same live facts; they never
   consumed `vm_lifecycle`.
2. **Cross-seam parity test** —
   `local::tests::capability_manifest_is_identical_across_inspect_and_generation_seams`
   asserts, for one instance state: the inspect-served manifest equals
   the helper composition; the admission-seam constructor supports the
   identical capability set; and the RQS generation digest recomposed
   from the inspect-served manifest (plus the seam's other identity
   components) equals `rqs_generation_digest()` — so a manifest
   divergence between the inspect and generation seams breaks the digest
   equality.

Fail-closed outbound behavior and candidate-artifact non-elevation are
untouched (composition sites only moved, not changed). Evidence: the new
parity test passes; adjacent `rqs_generation`/`inspect`/manifest lib
tests 12/12 green.
