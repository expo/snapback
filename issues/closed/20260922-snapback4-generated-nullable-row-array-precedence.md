# Snapback 4: generated arrays of nullable objects or rows lose union parentheses

**Status:** Closed 2026-09-22 — fixed in the Snapback 4 0.3 program, lane `emit-nullable`
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

## Resolution (2026-09-22)

`ty_ts` now takes an array element's precedence from its `Ty`. `Optional` and
multi-variant `Enum` elements are parenthesized; unions inside object or row
braces are not. So optional rows emit `(Rows["posts"] | null)[]`, optional
objects `({ … } | null)[]`, and nested cases are correct at every level.

**Tests.** 28 emission assertions, plus a generated-TypeScript consumer check
that runs the workspace `tsc` on generated `api.ts`, indexing, iterating and
narrowing a nullable array. The mutation proof fails both. The full suite
passed with 0 failures.

**Reviews:**

- Astra xhigh: READY WITH CHANGES.
- Grok 4.7 xhigh: READY.

Both noted one Low, identical point: nested arrays the old heuristic already
parenthesized lose one redundant pair. `((number | null)[])[]` becomes
`(number | null)[][]`, the same TypeScript type. That is accepted:
generated files are never committed, and the nested-row test locks the minimal
form.

**Landed as** `fix(snapback4): parenthesize nullable array elements in generated
types`. It ships with the first 0.3 publication.
