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
