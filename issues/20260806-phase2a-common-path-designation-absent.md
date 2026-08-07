# Phase 2a browser-IR gate: designated common-path mutation set is not frozen

**Status:** Open
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
