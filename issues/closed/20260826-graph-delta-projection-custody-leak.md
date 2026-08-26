# Graph delta retained-row patches bypass projection custody

- Status: resolved
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
- unchanged copy into the frame: `crates/snapback-engine/src/local/engine.rs:34633-34663`.

The Stage B audit now reproduces this dynamically. It establishes and mutates
all three eligible graph corpus subscriptions, executes their case-shaped E3
or E4 reference forms, and compares the reference `projection_fields` with the
keys actually serialized in each shipped graph operation. The shipped field
set is strictly larger for at least one eligible frame. The frozen disposition
artifact is used only as the closed case inventory; it is not the oracle for
this finding.

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
- `cargo test -p snapback --test delta_semantics_stage_b_audit_v1` flips this
  executed class-(b) reproduction to agreement after the repair.

## Resolution

Resolved 2026-08-26 by the landing named
`fix graph delta projection custody and kill switch`. Implementation commit: `ce9f2f564` (landed on main 2026-08-26).

`retained_row_patch` now receives the emitting node's closed-projection field
set and produces a diff over that set only, retaining projected removal `null`s
without exposing unprojected application or system fields. The frozen graph
corpus moved only in delta frame-byte measurements and their derived totals and
digest.

Regression tests:

- `graph_projection_scoped_delta_omits_unprojected_fields_from_serialized_wire_ops`
- `projection_scoped_retained_row_patch_omits_unprojected_application_and_system_fields_from_wire_op`
- `stage_b_rederivation_audit_is_fully_classified`
