# snapback2: sort lowering accepts unrelated comparator expressions

**Status:** Closed
**Resolution:** Validated exact opposite comparator parameters and identical fields in lower/expr.ts; added invalid/valid comparator regression.
**Systems:** snapback2, compiler
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/src/lower/expr.ts:498-513. For `rows.sort((a, b) => a.score - a.score)`, JavaScript specifies a no-op comparator, but the compiler recognizes the first subtraction field and emits ascending score order; `a.score - b.rank` is likewise accepted as score ordering. Comparator recognition does not verify that the operands use opposite callback parameters and the same field, so malformed or semantically different callbacks silently become a certified sort. Require exactly `a.field - b.field` or its reversal, with the declared callback parameter identities and identical field, and diagnose every other comparator form.
