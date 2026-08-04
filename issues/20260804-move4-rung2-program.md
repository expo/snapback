# Move-4 write-rung-2 implementation program (LLP 0129 OQ5 ruling, 2026-08-04)

**Status:** Open
**Opened by:** the dated write-rung-2 ruling at LLP 0129 OQ5
(`issues/closed/20260804-0129-write-rung2-ruling.md`)

Commissioned separately from the ruling per 0129's machinery, mirroring
`issues/closed/20260803-move3-phase1-program.md`. Owner: Charlie
(deciding author), executing through the session's codex lane.

## Lanes

- **W1 — widened-ceiling sizing spike (evidence gate half a, due
  2026-08-11).** Measure the browser-evaluator closure delta for
  exactly the verb subset Contention Calendar's common path needs.
  Candidate set from the ruling: `AllocateSequence`, `Delete`, `Let`;
  widen further only with measurement. Deliverable: a dated fixture
  under `tests/acceptance/fixtures/write-lane/` in the Phase-1 spike's
  format (`phase1-sizing-spike.2026-08-03.v1.md` is the template).
- **W2 — D5 corpus extension (evidence gate half b, due 2026-08-11).**
  Extend the LLP 0051 D5 conformance corpus to cover every newly
  exported verb, Rust-vs-JS exact, zero placeholders; dated evidence
  fixture in the `phase1-d5-evidence` format.
- **W3 — evaluator ceiling widening.** Export the measured verb subset
  from `@expo/snapback-client/ir-evaluator`, keeping the refusal path
  for everything past the widened ceiling ("these may be executable in
  a broader IR tier…"), with the codegen effect-class admission updated
  to match.
- **W4 — Contention Calendar on the write lane (exit gate, presented by
  2026-08-18).** The `demos/zero-bakeoff/apps/contention-calendar/`
  snapback arm exercises optimistic create with canonical identity:
  two clients racing one unique slot, exactly-one intent→canonical
  mapping, no forged branded ids, provisional items in the same typed
  ordering/filtering/count lifecycle. Transcribed exit gate with a
  dated served-run fixture, per the Move-3 Kanban exit's shape.

## Standing constraints (from the ruling)

Candidate-A substrate work under rung 1's authority; no Option-C
trigger detection or admission claim (LLP 0130 ER-1). Calendar is used
as a shipping exit application; the decision lab and Field Notebook are
untouched. Advancement is author-presented; a missed timebox returns
to 0129 OQ5 for a fresh dated ruling.
