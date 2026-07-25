# 0080: closed relational plan codegen + static validation

**Status:** Done (2026-07-24) — v1 authoring narrowing recorded below
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

**Progress (2026-07-24):** the Rust half landed ahead of the authoring
surface (slice 2, with the evaluator ticket): HandlerPlan::RelationalQuery
with structural shape admission, activation-time schema binding incl. the
unique-index exact-key cardinality proof, dispatch to the pinned-snapshot
executor, table-granular invalidation with no skip claim, plan-kind-only
public projection, and the reviewed-diagnostic registration. Remaining here:
the JS `defineRelationalQuery` authoring surface (closed validation per
§1 incl. comparator/type rules, visibility profiles + widening proofs,
left-join owner rule, index-served filter proof), serialization into the
manifest, the effect-ceiling walker arm for relational plans, and target
capability gating.

**Resolution (2026-07-24):** `defineRelationalQuery` landed with the full §1
closed-shape validation (distinct sources/aliases, 1..=4 typed equality
pairs with reference-domain checks, unique-index exact-key cardinality
proof, explicit per-source + output visibility with no-widening and the
left-join omissible-owner refusal, owner-leading root index, take bounds,
closed projection), manifest serialization, the relational effect-ceiling
arm, contract row descriptors from the projection, and the
`relational_query_v1` capability (closed registry, experimental maturity,
dedicated fail-closed runtime fact — Cloudflare correctly reports a gap).
Deliberate v1 authoring narrowing: no author root filters beyond
visibility (order = the root index's field sequence); widening that to the
index-served filter subset needs the pushability proof and belongs with
the cursor slice.
