# snapback2: optional chaining dereferences absent rows

**Status:** Open
**Systems:** snapback2, compiler
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/src/compiler.ts:709-727 (lowered by snapback2/packages/compiler/src/lower/expr.ts:376-391). Given `db.get(items, args.id)?.parent` when the row does not exist, generated TypeScript promises `null`/undefined-style optional access, but compilation emits an unconditional `Field(Get(...), "parent")` and runtime returns an E_TYPE error instead. The member-expression lowering recognizes ordinary fields and a special coalesce path but does not represent the optional-chain guard, and no later evaluator layer knows the access was optional. Bind the base once and lower optional access to an explicit null branch that returns null without evaluating the field, or reject optional chaining until that control flow is implemented.
