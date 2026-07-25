# 0080: closed relational plan codegen + static validation

**Status:** Open
**Severity:** P2
**Systems:** Codegen, Query planning, Authorization, Diagnostics
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0080 §§1, 3, 7
**Marker:** step5-impl

Normalize and validate `RelationalCoreV1` / `RelationalQueryPlanV1` /
`MaintainedProjectionPlanV1`: closed grammar (exactly one joined table,
argument-free core filters), per-type join comparator with unpaired-surrogate
rejection and reference-domain checks, root access index compatibility proof
(index-served filters, ordering ending in the implicit _id suffix), unique
joined index + reverse index requirements, visibility declarations with
widening proofs, the left-join owner-from-present-source rule, the closed
output-key grammar (root _id or immutable unique tuple), and
sharedFanOutDisclosure. Emit the full §7 artifact set and stable
diagnostics. Depends on the 0007 implicit-suffix ticket. L-sized.
