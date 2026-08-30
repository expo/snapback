# snapback2 compiler: three findings from the post-cap delta review (multi-declaration fail-fast, placeholder declarations, namespace inference in api.d.ts)

**Status:** Open
**Systems:** snapback2, compiler
**Severity:** P2
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-30
**Related:** LLP 1002 §3, `snapback2/packages/compiler/src/{compiler,project}.ts`, `snapback2/packages/snapback2/types/placeholder.d.ts`

Found by the report-only delta review of lane B0 after the lane had used its fix rounds (rules/RULES.md: three rounds, then escalate). The two Decimal-correctness items from the same review were fixed in one extra round (recorded in the landing report); these three remain:

1. `compiler.ts:290` — diagnostics are collected only at statement boundaries, so one refusal inside a multi-declaration (`const a = db.scan(first(), …), b = db.scan(second(), …)`) or an unbraced control statement hides the later refusals. `E_DIAG_TRUNCATED` cannot account for diagnostics never collected. Fix: collect per declaration / per expression site.
2. `types/placeholder.d.ts` — one union declaration is mapped to both `snapback2/react` and `snapback2/test`, and the `snapback2/client` declaration omits `createClient`; `import { createClient } from "snapback2/react"` typechecks but fails at link time. Lane D replaces `client`/`react` with real modules and declarations; lane B2 replaces `test`. Close this item when both have landed and the placeholder file is deleted.
3. `project.ts:545` — `api.d.ts` namespace inference picks the first path segment matching any exported table instead of resolving the namespace binding: with tables `schema` and `todos`, `import * as schema from "./schema"; db.scan(schema.todos.byId, …)` lowers to `todos` but the API type is `Page<SchemaRow>`. Fix: resolve through the same binding table the lowerer uses.
