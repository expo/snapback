# Graph delta retained-row patches bypass projection custody

- Status: open
- Created: 2026-08-26
- Area: graph live-query delta delivery
- Found by: LLP 0309 Stage B re-derivation audit
- Related: `llp/0309.001-stage-b-audit.research.md`, LLP 0309.000 §1.5/§8,
  LLP 0209

## Finding

`retained_row_patch` diffs the union of every key in the old and new retained
storage rows, rather than the fields addressed by the closed projection. The
resulting patch is placed directly in `LiveGraphDeltaWireOpV1.row`, copied into
`LiveGraphDeltaWireV1.ops`, and serialized in the `live_delta` frame:

- full-row key union: `crates/snapback-engine/src/graph_evaluator.rs:3588-3620`;
- wire op construction: `crates/snapback-engine/src/graph_evaluator.rs:3849-3867`;
- unchanged copy into the frame: `crates/snapback-engine/src/local/engine.rs:34618-34648`.

The existing evaluator unit test explicitly expects a system-field diff. The
frozen graph corpus does not reveal the defect because its fixture changes only
projected fields and its oracle compares convergence after applying the same
unfiltered operation.

This is LLP 0309 §D4.2 class **(b)**: a shipped defect. The Stage A E3/E4
reference forms emit only `projection_fields`; there is no reference-semantics
error to repair.

## Required repair

Make graph wire patches projection-addressed before publication. Preserve the
full retained row only in evaluator-owned state. Add a regression that changes
an unprojected application field and a system field while a projected field
also changes, then proves neither unprojected field occurs in serialized frame
bytes.

## Acceptance

- Eligible root-scalar and to-one graph deltas serialize only fields admitted
  by their projection address.
- Applying the filtered operation still converges with a fresh result.
- The frozen graph corpus and LLP 0309 Stage A corpus stay green.

