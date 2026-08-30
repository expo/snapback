# snapback2 compiler: three findings from the post-cap delta review (multi-declaration fail-fast, placeholder declarations, namespace inference in api.d.ts)

**Status:** Closed
**Systems:** snapback2, compiler
**Severity:** P2
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-30
**Related:** LLP 1002 §3, `snapback2/packages/compiler/src/{compiler,project}.ts`, `snapback2/packages/snapback2/types/placeholder.d.ts`

Found by the report-only delta review of lane B0 after the lane had used its fix rounds (rules/RULES.md: three rounds, then escalate). The two Decimal-correctness items from the same review were fixed in one extra round (recorded in the landing report); these three remain:

1. `compiler.ts:290` — diagnostics are collected only at statement boundaries, so one refusal inside a multi-declaration (`const a = db.scan(first(), …), b = db.scan(second(), …)`) or an unbraced control statement hides the later refusals. `E_DIAG_TRUNCATED` cannot account for diagnostics never collected. Fix: collect per declaration / per expression site.
2. `types/placeholder.d.ts` — one union declaration is mapped to both `snapback2/react` and `snapback2/test`, and the `snapback2/client` declaration omits `createClient`; `import { createClient } from "snapback2/react"` typechecks but fails at link time. Lane D replaces `client`/`react` with real modules and declarations; lane B2 replaces `test`. Close this item when both have landed and the placeholder file is deleted.
3. `project.ts:545` — `api.d.ts` namespace inference picks the first path segment matching any exported table instead of resolving the namespace binding: with tables `schema` and `todos`, `import * as schema from "./schema"; db.scan(schema.todos.byId, …)` lowers to `todos` but the API type is `Page<SchemaRow>`. Fix: resolve through the same binding table the lowerer uses.

4. (from lane C's round-2 review) The effect-closure scan does not visit parameter default initializers: `run: async (_p, { x = (someOuterName.y = 1) }) => …` passes `E_EFFECT_CLOSURE` checking. The runtime now evaluates effect source at global scope so this cannot reach host state, but the compiler should still refuse it — scan default initializers, destructuring defaults, and computed property names in the closure walk.

## Resolution — 2026-08-30

All four findings are resolved.

1. Variable declarations now recover independently, and unbraced controlled statements capture their own refusal before the enclosing control statement continues. Regression coverage proves that two refused declarations in one `const` and both unbraced `if` branches are reported in the same compile.
2. Lanes D and B2 provide distinct real `snapback2/client`, `snapback2/react`, and `snapback2/test` implementations and declarations. The redundant `types/placeholder.d.ts` and its build copy were deleted. A compile test imports the real surfaces, including `createClient` from `snapback2/client`, and proves that `snapback2/react` does not export `createClient`.
3. Generated API result inference now receives the per-module table binding map used by lowering and resolves a table or table-index path against that map. The exact collision case with exported tables `schema` and `todos` plus `import * as schema` produces `Page<TodosRow>`, not `Page<SchemaRow>`.
4. Effect closure/import walks now include the outer function parameters as well as its body. Refusal tests cover a parameter initializer, a destructuring default, and a computed binding-property name.

Verification from `snapback2/`:

- `./scripts/test.sh` — passed; compiler 44/44, evaluator corpus 76/76.
- `node scripts/measure.mjs --check` — all measured budgets green.
- The compiler suite's S1 comparison passed: all 17 IR bodies and certificate bounds remain unchanged.
