# Snapback 4: generated arrays of nullable objects or rows lose union parentheses

**Status:** Open
**Date:** 2026-09-22
**Scope:** Snapback 4 TypeScript emission
**Source:** [Clique calibration 16](../benchmarks/runs/2026-09-22-snapback4-clique-astra-0.2.32/README.md), published `snapback4@0.2.32`

The cold Astra builder reported at epoch `1790107578` that an M8 trending
query's generated nullable-object array was rendered as `object | null[]`.
It worked around the declaration by using a required point lookup. Its
original correction and generated-API evidence remain in the cal16 packet's
`lanes/astra-snapback4/run-log.md` and `logs/astra-snapback4.ndjson` on M5.
Independent grading was still pending when this ticket was opened; this is
the builder's observed report plus the source inspection below.

The completed builder also retained an isolated
[Quarry reproduction](../benchmarks/runs/2026-09-22-snapback4-clique-astra-0.2.32/astra/type-repro/schema.q)
and its actual [generated API](../benchmarks/runs/2026-09-22-snapback4-clique-astra-0.2.32/astra/type-repro/api.ts).
The [check output](../benchmarks/runs/2026-09-22-snapback4-clique-astra-0.2.32/astra/evidence/type-repro-check.log)
and [offending declaration](../benchmarks/runs/2026-09-22-snapback4-clique-astra-0.2.32/astra/evidence/type-repro-generated.txt)
come from the exact published pin. Its declaration is
`nullableArray: Query<Record<string, never>, { id: string; label: string; pending?: boolean } | null[]>;`.

[`ty_ts` and `wrap`](../snapback4/crates/snapback4-lang/src/emit.rs) provide a
matching explanation. `Optional` appends ` | null`; `List` and `Collection`
append `[]` after passing the element text through `wrap`. That helper excludes
all strings beginning with `{` or `Rows[` from union wrapping. Those prefixes
do not establish that a later union is nested inside the object or row.

Concrete emission cases to cover:

| Element type | Current composition | Required array meaning |
| --- | --- | --- |
| Optional row | `Rows["posts"] | null[]` | `(Rows["posts"] | null)[]` |
| Optional object | `{ id: string } | null[]` | `({ id: string } | null)[]` |
| Object with a nullable field | `{ id: string | null }[]` | Preserve the existing array-of-objects meaning. |

The first two current compositions describe a union of one object/row and an
array of nulls, rather than an array whose elements may be null. This can make
valid application array handling fail TypeScript checking. It does not by
itself establish a runtime query or authority defect.

`emit.rs` is byte-for-byte unchanged between the program's starting commit
`339ea0759177d6e82a224cbd76ccef2ce024062f` and qualified package source
`c482a089d0cb26929066545742c97ac8c21a2db2`; this is not attributed to the
LLP 3000.011 implementation. No duplicate open ticket was found in the
repository search.

Fix element precedence from the typed structure, or use an unambiguous array
form. Add focused emission coverage for nullable rows, nullable objects,
enum/union elements, nested arrays, and the object-field control above, then
typecheck a small generated consumer that indexes and iterates the nullable
array. Keep the original published cal16 app, package pin and score intact;
qualify a later package separately. No product code is changed by this ticket.
