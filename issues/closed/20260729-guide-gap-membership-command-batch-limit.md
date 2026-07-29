# Guide gap: one generated membership write per mutation

**Status:** Resolved  
**Area:** Guide, scoped roles and memberships, mutations  
**Found by:** LLP 0102 Research Room/Snapback remediation rerun  
**Date:** 2026-07-29  
**Governing:** LLP 0056, LLP 0061, LLP 0102

## Problem

After the sessions/streamed-actions admission defect was repaired, the frozen
Research Room app reached its first authenticated mutation. That bootstrap
performed two resource bootstraps and two member inserts in one handler. The
runtime refused it with:

`SNAPBACK_MEMBERSHIP_BATCH_UNSUPPORTED: v1 permits one generated membership write per mutation`

The limit is deliberate and fail-closed, but the scoped-membership and mutation
Guide pages do not put it next to the generated `bootstrap`/`insert` methods.
The earlier pre-bind defect masked this authoring failure during the frozen arm.

## Required outcome

- State the one-command v1 ceiling beside the generated membership methods.
- Explain that ordinary data writes may accompany one membership command, but
  a workflow needing several membership commands must use separately
  authorized mutations and an application-visible setup state.
- Show an idempotent multi-resource/multi-member setup pattern without claiming
  cross-mutation atomicity.
- Keep `SNAPBACK_MEMBERSHIP_BATCH_UNSUPPORTED` exact and fail-closed.
- Track a product-level batch design separately if a future atomic
  multi-membership outcome is worth supporting.

## Evidence

- `demos/backend-bakeoff/arms/research-room/snapback/work/snapback/handlers.mjs`
  (`bootstrapResearchRooms`)
- `src/runtime.rs`
- pending Stage 4 Research Room rerun handoff

## Resolution

Resolved 2026-07-29 in the Stage 4 Guide tranche. The scoped-membership page
now states the exact one-command ceiling, atomic refusal behavior, the fact
that one bootstrap expands to a resource plus initial seat, and an honest
idempotent multi-mutation workflow without claiming cross-call atomicity. The
Guide checker passes.
