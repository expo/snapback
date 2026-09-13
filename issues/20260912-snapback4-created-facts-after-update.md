# Snapback 4: Keep sibling created facts when one inserted row is updated

Status: Open
Priority: P1
Observed: 2026-09-12
Review finding: R26
Evidence: Reproduced through an authored mutation
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

Updating a row inserted earlier in the same mutation clears all `created`
facts for its table. The `retain` predicate asks whether the currently updated
id appears anywhere in `inserted`, independent of the particular fact it is
filtering. It then adds back only the updated row's facts.

Reproduction: `grants` has a unique text `byName`, allows insert/update, and
`t` allows insert when `created grants[.name]`. In one mutation insert grant A
with name `a`, insert grant B with name `b`, update A without changing its name,
then insert `t {name: 'b'}`. The final insert refuses with `E_RULE` even though
B was created and remains present in that mutation.

Track facts by the originating row, or remove/rebuild only facts belonging to
the changed row. Verify sibling facts survive an update and changed index keys
replace the appropriate old facts. Include final-state constraints and deletion
cases according to their existing documented semantics; do not infer a new
meaning of `created` as part of this fix.

## Implementation locations

- [crates/snapback4-core/src/engine/write.rs](../snapback4/crates/snapback4-core/src/engine/write.rs)
