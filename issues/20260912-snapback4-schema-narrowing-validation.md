# Snapback 4: Validate stored rows before accepting schema narrowing

Status: Open
Priority: P1
Observed: 2026-09-12
Review finding: R01
Evidence: Reproduced with the core engine
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.000](../llp/3000.000-atomic-schema-and-release-activation.research.md), [comprehensive review](../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

`Engine::adopt` accepts a schema that existing rows violate. The successor
classifier labels changes but `Store::install` does not perform the required
stored-data admission checks. Its index rebuild does not enforce newly added
uniqueness against existing tuples.

Reproduction: seed `items.body` under `text <=100` with `"too long"`, then
adopt `text <=1`. Adoption returns `Ok(2)`. Separately seed two rows with
`code: "same"` under a non-unique `byCode`, then make `byCode` unique.
That adoption also returns `Ok(2)`.

Validate the affected existing data before publishing the successor. Cover
required columns, scalar/enum/text bounds, new unique tuples and declared caps;
a schema-only classification is not the check itself. On failure, preserve the
old schema, rows, indexes, maintains and generation. Acceptance examples must
include both failing cases above and a genuinely valid narrowing. Do not
silently discard invalid rows to make the migration fit.

## Implementation locations

- [crates/snapback4-core/src/store.rs](../snapback4/crates/snapback4-core/src/store.rs)
- [crates/snapback4-core/src/engine/mod.rs](../snapback4/crates/snapback4-core/src/engine/mod.rs)
- [crates/snapback4-core/src/successor.rs](../snapback4/crates/snapback4-core/src/successor.rs)
