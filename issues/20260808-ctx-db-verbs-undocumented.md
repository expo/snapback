# guide-gap: the JS-handler ctx.db verb set is undocumented

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Guide, Mutations, JS handlers
**Date:** 2026-08-08
**Related:** Diary 0069 (run 5, 0.1.15)

The run-5 native lane needed the JS mutation `ctx.db` query verbs and
found them only by extracting strings from the runtime binary —
`query(table).withIndex().eq().collect()/take()`, `delete` — because
guide/backend/mutations.md shows only insert/patch in JS handlers.
Document the complete verb set with a CI-verified snippet, and add
retrieval aliases (ctx.db, query builder, withIndex). Binary-string
excavation is the most expensive possible discovery path.
