# snapback2: unknown scan-order strings silently become ascending

**Status:** Open
**Systems:** snapback2, compiler
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/src/lower/expr.ts:530-575, especially snapback2/packages/compiler/src/lower/expr.ts:555-562, with the permissive declaration in snapback2/packages/compiler/lib.d.ts:54. An options object containing `order: "descending"` or a typo type-checks, but lowering treats every string other than exact `"desc"` as ascending, returning the reverse of the likely requested result without a diagnostic. The public options type permits arbitrary record values and the lowerer uses a default branch for unknown authored strings. Accept only absent, `"asc"`, or `"desc"` at compile time, diagnose all other values, and narrow the generated/declaration type accordingly.
