# social-messenger grader harness

**Provenance:** LLP 0201 P1 deliverables (D2 quantitative instrument,
D3 independent quality gate, D4 rubric applicability), scaffolded per
`benchmarks/tools/social-messenger/CONTRACT.md`. Authority chain:
`benchmarks/briefs/social-messenger.md` (the frozen app spec and
checklists) governed by
`llp/0201-social-messenger-canonical-benchmark.plan.md`. **Version:**
see `VERSION` (`0.1.0-p1` — DRAFT; the P3 freeze bumps to `1.0.0` and
pins hashes in the brief).

Two directories form one instrument:

## A — Scoring manifests and record schema (`benchmarks/schema/social-messenger/`)

- `assertions.json` — the assertion-ID manifest: all 51 numbered
  checklist items of M1–M8 split into 116 atomic assertions with stable
  IDs (`m1-a01` …), each with exactly one executor class
  (`suite-required` / `choreo` / `grader`) per the brief's Executors
  paragraph, and run-scope conditionality where the brief marks it.
  M6 and M8 simulator assertions carry `greenRequired:false` and are scored from the
  separately recorded native artifact rather than the web authoring-green
  receipt.
  Lanes' coverage manifests map every suite-required assertion to a
  test; the grader report keys per-assertion results by these IDs.
- `applicability.json` — the 16-dimension applicability manifest:
  weights (45 grader / 55 builder), scorer, observing milestones,
  per-dimension applicability predicates, the complete-lane
  enumeration, and the usable-grading-record gate.
- `run-record-extension.schema.json` — extends
  `benchmarks/schema/run-record.schema.json` with per-milestone
  phases and statuses, the separate clocks, charging, compaction
  events, replay/probe results with the O5 band inputs, and grading
  pointers.

## B — Grader machinery (this directory)

- `grader-prompt.md` — the frozen grader prompt: fresh-session
  other-family agent, inputs/exclusions, execution order,
  grader-abort protocol, output contract.
- `grader-report.schema.json` — the machine record a grading session
  produces (LLP 0197 rules 4 and 12): per-assertion results keyed by
  assertion ID, severity-bucketed defects, probe results, anchored
  O-dimension scores, coverage spot-verification, best-of-3 timing.
- `calibration.md` + `planted-defects.template.json` — the
  calibration gate (three planted-defect artifacts built from the P2
  pilot artifact, D3.4's recall+precision pass/fail rule, duplicate
  blind grading, the grader-noise trigger).
- `probes/` — the published probe-category registry (`categories.md`),
  custody tooling (`commit-probes.mjs`, `rotation-log.md`), and the
  no-probe-set-in-repo rule (`probes/README.md`). Wave probe sets are
  authored at wave time, hash-committed before the wave's first lane,
  and published after the wave.

## How the pieces connect at run time

1. The builder's lane runs under the brief; the harness validates the
   lane's coverage manifest against `assertions.json` and stamps
   per-milestone green receipts (suite + choreography) into a record
   conforming to the run-record extension.
2. The grader (per `grader-prompt.md`) grades the artifact, runs the
   wave's committed probe set, and emits a `grader-report.schema.json`
   record plus a sanitized evidence trace.
3. The harness scores O5 from the replay's recorded band inputs and
   assembles per-dimension scores under `applicability.json`; nulls
   block the weighted total, and claims flow only through LLP 0197 /
   0189 gating.

Not in P1 (deliberately): budget-cap numbers, absolute performance
ceilings, the O5 decision-table instantiation, wave probe sets, and
the calibration artifacts themselves — all P2/P3 products, per
LLP 0201 D7.
