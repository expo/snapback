# Phase 2a browser-IR gate: designated common-path mutation set is not frozen

**Status:** Closed (resolved 2026-08-07; see Resolution)
**Severity:** P2 (blocks a gate verdict, not any build)
**Systems:** LLP 0129 Phase 2a, Browser IR lane, Acceptance testing
**Date:** 2026-08-06
**Related:** LLP 0129 §Open questions 9,
`tests/acceptance/fixtures/browser-lane/wasm-assessment.2026-08-05.v1.md` §5
Option B,
`tests/acceptance/fixtures/browser-lane/browser-ir-coverage.2026-08-06.v1.{json,md}`

## Problem

The OQ9-designated Phase 2a exit gate requires "100% execution coverage for
the **designated** browser common-path mutations, proven by generated
artifacts." That component is unfalsifiable today because no frozen
designation of the common-path mutation set exists anywhere in the
repository:

- The assessment's Option B locates the designation act in
  `tests/acceptance/fixtures/browser-lane/handler-coverage.v1.json` — never
  created.
- The dated rulings that speak of common paths designate **verb sets**
  (Phase 1: Kanban's common path is exactly `Insert`/`Get`/`Guard`/`Patch`;
  rung 2: Calendar's is one `Insert`) or **exit applications**, not a
  mutation subset of the frozen LLP 0051 13-mutation corpus that the gate's
  semantic denominator uses.

Candidate readings encountered (listed for the author, not chosen): a subset
of the frozen 13-mutation corpus; latency-kanban's six writes plus
contention-calendar `reserve` (the two dated common-path exit applications);
or the M1-shaped 5/13 subset of the frozen corpus. These give materially
different denominators.

The first gate run (2026-08-06, receipt
`browser-ir-coverage.2026-08-06.v1.json`) therefore recorded the axis
**INDETERMINATE** rather than inventing a metric: the other two components
stand at 12/13 = 92.3% semantic (PASS ≥90%) and 37/37 exact D5 in real Chrome
(PASS), and the whole gate is NOT-DECLARABLE until the designation exists.

## Done when

- The author (designation is author-owned) freezes the designated browser
  common-path mutation set as a versioned artifact —
  `tests/acceptance/fixtures/browser-lane/handler-coverage.v1.json` per
  Option B, or a dated LLP 0129 ruling naming the set.
- The coverage runner (or its successor) measures 100%-execution coverage
  against exactly that frozen set, including the "generated local artifact"
  requirement, and the receipt's `commonPathExecution` axis becomes a real
  percentage.
- LLP 0129 §Phases (Phase 2a) records the resulting gate verdict from a rerun.

## Resolution (2026-08-07)

All three done-when conditions are met:

- The author **delegated the designation to the orchestrating agent** at the
  2026-08-07 gate sitting
  (`issues/closed/20260807-local-first-author-gate-packet.md` item 3;
  delegation recorded verbatim in the artifact's provenance). The frozen
  artifact is
  `tests/acceptance/fixtures/browser-lane/handler-coverage.v1.json`: 12
  designated common-path cases over the pinned D5 corpus, every remaining
  case excluded with a recorded reason (total partition, validated by the
  runner). None of the three candidate readings above was adopted verbatim;
  the designation is operation-anchored (toggle/patch/delete/guarded
  read/expression semantics/validation refusals — everyday agent-app
  operations).
- `tests/acceptance/browser-ir-coverage-v1.mjs` now loads the frozen
  designation (drift-refusing) and measures the axis: **11/12 FAIL**, single
  named gap `todo-v2-delete-todo` (plain single-row delete, refused
  `SNAPBACK_PLAN_EFFECT_CEILING`). Receipt:
  `browser-ir-coverage.2026-08-07.v2.{json,md}`. The gap is ticketed at
  `issues/20260807-single-row-delete-effect-ceiling.md` — the gate is now
  measurable and doing its job.
- LLP 0129 Phase 2a carries the dated designation + rerun note; the phase
  disposition is owned by the standing orchestration lane, presented to the
  author by 2026-08-14.
