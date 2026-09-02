# snapback2: row fields named length compile as collection length

**Status:** Closed
**Resolution:** Made length lowering type-aware for known rows/objects in compiler.ts and lower/expr.ts; added row-field execution regression.
**Systems:** snapback2, compiler
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/src/compiler.ts:714-726 (via snapback2/packages/compiler/src/lower/expr.ts:376-391). For a legal table row such as `{ id: "one", length: 99, value: "x" }`, an operation returning `row.length` emits the collection `Len` operator and returns the object field count, 3, instead of 99. Member lowering dispatches solely on the property spelling `length` without checking the inferred/schema type of the base, so rows and objects are mistaken for arrays or strings; runtime faithfully executes the wrong IR. Resolve `length` using the base type: emit field access for rows/objects with a declared length field and `Len` only for supported collection/string types.
