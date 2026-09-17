# Snapback 4: Valid Quarry names collide in generated Rust bindings

Status: Closed
Priority: P2
Observed: 2026-09-16
Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15` (0.2.26)
Review: complete code review requested by Charlie Cheever; lead validation with independent Grok, Muse and Sol reviews.

## Evidence

Code traced. The Quarry catalog distinguishes `fooBar` and `foo_bar`, but the Rust emitter maps both to field/module `foo_bar`, constant FOO_BAR and struct FooBar. A table named `self` emits prohibited struct Self; `_` can produce an empty type name. Native builds fail for an otherwise accepted schema.

## Implementation locations

Paths are relative to `snapback4/`: `crates/snapback4-lang/src/emit/rust.rs:snake`, pascal, field_name; catalog only rejects exact duplicate names.

## Acceptance

Generate deterministic valid unique names in each Rust namespace while keeping ordinary existing names stable and preserving serde column names. Compile generated bindings for colliding/keyword names in regression coverage; do not ban otherwise valid Quarry names globally.

## Resolution — 2026-09-16

Implemented in `f6b514c35` as part of the complete project review.

The emitter allocates unique deterministic identifiers per Rust namespace and reserves the synthetic id field. It handles keywords, Self, standard type shadows, underscore-only and numeric-leading normalized names while retaining exact serde field names. The regression invokes rustc on emitted identifiers and namespaces.

Integrated qualification and independent repair review are recorded in
[the review index](../../llp/reviews/3000-complete-code-review-20260916.md).
