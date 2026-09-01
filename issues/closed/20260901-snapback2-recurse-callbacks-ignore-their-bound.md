# snapback2: recurse callbacks ignore their bound row expression

**Status:** Closed
**Resolution:** Restricted recurse callbacks to one bound-row db.get form in lower/expr.ts; added adversarial and canonical regressions.
**Systems:** snapback2, compiler
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/src/lower/expr.ts:230-260. A callback such as `row => db.get(items, anchor.parent)` is accepted as recursion over `parent`, but runtime follows the current row field rather than the captured `anchor.parent`; the recognizer also stops at the first return-shaped node without proving the callback has the required form. Recurse lowering extracts only a field name from the callback body and discards the object expression and database identity, so semantically different JavaScript is certified as the canonical traversal. Require exactly one supported callback of the form `row => db.get(theSameTable, row.field)` with the actual parameter binding and no alternate returns, or diagnose it.
