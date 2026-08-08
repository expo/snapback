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

## Resolution — 2026-08-07

**Ruled by the author (Charlie Cheever, 2026-08-07): single-row Delete is
ADMITTED into the M1 local evaluator verb set.** Implemented the same day:

- `packages/snapback-client/ir-evaluator.mjs`: `Delete` joins the M1
  admission verb set; plans with more than one `Delete` step stay refused with
  `SNAPBACK_PLAN_EFFECT_CEILING`, as do `DeleteWhere`/`InsertEach`. Execution
  needed no change — the shipping D5 executor already carried the Rust host's
  exact semantics (`ChangedCount`; soft no-op on a missing row, matching
  `delete_document`'s no-change path in `src/storage.rs`).
- `packages/snapback-client/local-read-admission.mjs`: a `Delete` step's
  target row is now a declared point read (by `Arg` id, exactly like
  `Get`/`Patch`), so the admitted workspace materializes the row being
  deleted and the local prediction sees presence/absence correctly.
- `packages/snapback-client/optimistic-rebase.mjs`:
  `applyPrivateOptimisticLayerV1` folds `delete` writes (remove by `_id`,
  missing row a soft no-op) — previously it threw on any non-insert/patch
  write, so an admitted Delete layer would have crashed the rebase engine.
- Effect-class string kept stable
  (`snapback.browser-ir.insert-get-guard-patch.v1`, widened in place); the D5
  corpus manifest untouched.
- Conformance: client suite green including the 37-case D5 replay; new
  present-row, absent-row, and stays-refused (DeleteWhere / InsertEach /
  two-Delete) tests; private-layer delete-fold test.
- Bundle metrology: explicitly reviewed rollover
  `baseline.single-row-delete-admission.v1.json` (ir-evaluator
  21,295 → 21,407 min / 7,615 → 7,644 gzip / 6,740 → 6,760 brotli;
  optimistic-rebase brotli 12,744 → 12,791).
- Gate rerun against the UNCHANGED frozen designation: semantic 12/13 = 92.3%
  PASS (carried — the audited miss is `applyLiveFeedSnapshot`, not delete);
  exact-D5 37/37 PASS; **common-path 12/12 PASS; whole gate PASS**. Receipt:
  `tests/acceptance/fixtures/browser-lane/browser-ir-coverage.2026-08-07.v3.{json,md}`,
  superseding the v2 11/12 measurement. LLP 0129 Phase 2a carries the dated
  note; the rung-2 sizing write-up carries a dated supersession addendum.

**Named follow-up (not blocking this closure):** codegen
(`packages/snapback-codegen/index.mjs`, `GENERATED_LOCAL_MUTATION_STEPS_V1`)
still classifies delete handlers `SNAPBACK_GENERATED_IR_EFFECT_SERVER_ONLY`,
so real-app generated carriers keep delete server-round-trip until the
emission side is widened with its own artifact rotation. The generated-carrier
seam (`generated-mutation-ir.mjs`) refuses such plans before evaluation, so
the state is coherent.

**Status:** Closed 2026-08-07.
