# Stored-field `v.object({...})` silently degrades to untyped Json (no refusal, no diagnostic)

**Status:** Resolved
**Severity:** P2 (schema-fidelity honesty defect; contradicted the guide and the documented closed-map behavior)
**Systems:** Codegen, Schema, Guide, Diagnostics
**Date:** 2026-08-09
**Related:** LLP 0115 (CV-4b), LLP 0211 (typed structured stored values), LLP 0131 (position grammar), guide getting-started page

## Problem

Found during the LLP 0211 adjudication: in
`packages/snapback-codegen/index.mjs`, the stored-field dispatch accepted
`v.object({...})` but emitted only `field_type: Json`. The nested shape was
erased, generated types became `unknown`, and no write-time validation existed.
`v.array(...)` refused while the guide said both forms refused, leaving a silent
schema-fidelity half-state.

## Done when

`v.object` on a stored field either refuses with a named diagnostic or is
admitted as a typed structured value per LLP 0211—never silently degraded—with
a pinned regression test and guide/capability-index truth.

## Resolution

LLP 0211 Phase A replaces the primitive-map fallthrough with a closed
top-level dispatch. Stored `v.object`, `v.array`, and admitted non-enum unions
now emit `FieldType::Structured` carrying the recursive
`StoredStructuredContractV1` descriptor and exact contract hash; `v.json()`
keeps its prior untyped `Json` row. The same dispatch runs the closed interior
leaf gate, so unsupported leaves refuse with named schema diagnostics instead
of degrading.

`packages/snapback-codegen/structured-stored-values.test.mjs` pins the object
and array routing, exact generated types, refused leaves, and observation
gates. The getting-started schema page and capability-index GAP row now
separate typed opaque storage from the still-unbuilt queryable-interior phase.
