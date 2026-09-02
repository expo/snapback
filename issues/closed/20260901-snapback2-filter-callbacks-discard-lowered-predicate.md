# snapback2: filter callbacks discard lowered predicate statements

**Status:** Closed
**Resolution:** Kept predicate setup statements inside each filter iteration in lower/expr.ts; added conditional-predicate execution regression.
**Systems:** snapback2, compiler
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/src/lower/expr.ts:682-691. Given `rows.filter(row => args.go ? row.active : false)`, lowering the ternary produces setup statements and a temporary value, but filter retains only the final expression; the emitted predicate then reads an undefined temporary and the operation fails instead of filtering. Map carries callback statements, while the adjacent filter path drops `lowered.statements`, and the evaluator has no way to recreate them. Include predicate setup statements inside each filter callback invocation before evaluating its result, preserving their order and per-element scope.
