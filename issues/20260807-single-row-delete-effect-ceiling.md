# Single-row delete is designated browser common-path but refused by the effect ceiling

**Status:** Open
**Severity:** P2 (gate-surfaced design question; blocks the Phase 2a
common-path axis at 11/12)
**Systems:** Sync, Client integration, Testing
**Date:** 2026-08-07
**Related:** LLP 0129 (Phase 2a, §Open questions 9), LLP 0051 (D5 corpus),
`tests/acceptance/fixtures/browser-lane/handler-coverage.v1.json`,
`tests/acceptance/fixtures/browser-lane/browser-ir-coverage.2026-08-07.v2.{json,md}`,
`issues/closed/20260807-local-first-author-gate-packet.md` (item 3),
`issues/closed/20260803-p0-0129-phase1-ruling.md`

## What happened

The 2026-08-07 designation freeze (delegated to the orchestrating agent by
the author, packet item 3) names `todo-v2-delete-todo` — the corpus's
single-row delete — as browser common-path: field toggle, patch, and
single-row delete are everyday agent-app operations. The rerun of
`tests/acceptance/browser-ir-coverage-v1.mjs` against the frozen designation
measured the common-path axis at **11/12 FAIL**: `todo-v2-delete-todo` is
refused by the shipped plan-shape admission with
`SNAPBACK_PLAN_EFFECT_CEILING`, because the M1 admission ceiling is exactly
`Insert`/`Get`/`Guard`/`Patch` and `Delete` is not in it.

The case was inspected before freezing: its plan is exactly one `Delete` step
addressing one row by `Arg` id with `ChangedCount` return — a plain
single-row delete, no cascade, no filter. Its D5 replay passes; only local
admission refuses it.

## The question

Should the effect-ceiling classification admit **single-effect deletes**?

- The ceiling's verb set came from measured common paths (Kanban:
  `Insert`/`Get`/`Guard`/`Patch`; the W1 rung-2 spike found Calendar needs
  only `Insert`) — it was never a ruling that delete is not common-path, just
  that no measured exit application needed it.
- A single-row delete by id is effect-bounded in the same sense as `Patch`
  (one row, one table, no fan-out); the deliberate ceilings exist for
  batch/fanout/multi-step power paths (`delete-where-filtered`,
  `insert-each-*`), which stay excluded.
- Against: any widening is Candidate-A substrate work that should follow the
  measured-widening discipline (LLP 0129 item 5's rung-2 pattern: measure,
  present, then widen), not a quiet admission-classifier edit.

This is the gate doing its job — the designation froze what common-path
means, and the measurement surfaced the collision. Resolution belongs to the
Phase 2a disposition lane (standing orchestration lane, presented to the
author by 2026-08-14 per the 2026-08-07 owner/timebox ruling).

## Done when

A dated decision either admits single-effect deletes to the local-admission
ceiling (with the D5/coverage evidence rerun and the receipt superseded) or
records that single-row delete stays server-round-trip for now with the
designation retained as the honest 11/12 measurement; LLP 0129's Phase 2a
section points at the outcome.
