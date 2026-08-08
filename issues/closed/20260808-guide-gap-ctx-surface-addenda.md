# guide-gap: ctx/builder surface beyond the now-documented ctx.db verbs

**Opened:** 2026-08-08 · **Severity:** P3 (documentation)

Follow-on to the closed issues/closed/20260808-ctx-db-verbs-undocumented.md:
commit a0586db5a documented the indexed `ctx.db` builder verbs, but the
2026-08-08 comprehensive docs review found adjacent handler-context surface
still uncovered. Now that the builder is taught, its bounds matter more,
not less:

1. **Builder caps and their refusal codes.** The queries.md "complete
   builder chain" table omits the builder's own bounds: `.in()` bounded to
   500 total operands (`SNAPBACK_QUERY_IN_ITEMS_EXCEEDED`), 500 total
   filter bindings (`SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED`), and
   `.take()` out-of-range (`SNAPBACK_QUERY_LIMIT_INVALID`)
   (packages/snapback-harness/ctx-bootstrap.js:100-102, 582-610, 631-637).
   Also, "in any order after `.withIndex(name)`" implies an ordering
   constraint that does not exist — `withIndex` is a plain setter callable
   anywhere in the chain (ctx-bootstrap.js:593-594).
2. **`ctx.isDirectHuman()`** — the LLP 0055 authority verb
   (`auth.kind === "human" && auth.actor == null`), exported in every
   generated context type since 2026-07-15, appears nowhere in the guide
   (ctx-bootstrap.js:818-820; packages/snapback-codegen/index.mjs:10647).
3. **`ctx.push.audience(name, args)` / `ctx.push.audiences.<name>(args)`**
   — the in-handler audience helpers; expo-push.md shows only the
   schema-side `pushSeam.audiences.*` form (ctx-bootstrap.js:912-935).
4. **`results.records` variants** — queries.md documents neither the
   discriminated union of closed record variants nor the optional
   `{ minItems, maxItems }` row bounds (0 ≤ min ≤ max ≤ 1,024) whose
   constraint names mutations.md's violation diagnostics already surface
   (packages/snapback-codegen/define.mjs:495-527).

Ask: absorb these in the same pages the ctx.db landing touched
(queries.md/mutations.md/expo-push.md), with retrieval aliases for the
refusal codes.

## Resolution

Fixed 2026-08-08 (docs-review execution, 1284ae8a5). All four items:
builder caps with their refusal codes plus the `withIndex`
plain-setter rewording on queries.md; `ctx.isDirectHuman()` beside server
scoping; `ctx.push.audience`/`ctx.push.audiences.<name>` helpers on
expo-push.md; and the `results.records` union variants with the
`{minItems,maxItems}` bounds on queries.md. The
`backend.functions` capability row gained the plan-vocabulary aliases at
integration.
