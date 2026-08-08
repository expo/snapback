# guide-gap: the JS-handler ctx.db verb set is undocumented

**Status:** Closed
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

## Resolution

Fixed 2026-08-08. `guide/backend/mutations.md` now documents the indexed
`ctx.db` builder (`query`, `withIndex`, repeated `eq`, bounded `take`, and
terminal `collect`) plus atomic `delete(table, id)`. Both examples are literal
fragments from `demos/messaging-snapback/snapback/functions.mjs`; that demo's
headless acceptance covers `startDirectMessage` and `toggleReaction`. The page
now routes `ctx.db`/query-builder vocabulary, and retrieval-eval case 22
preserves the replicated miss.

Verified with:

- `./scripts/check-generated-artifacts`
- `node scripts/generate-guide-manifest.mjs`
- `node scripts/check-guide.mjs` (`64 pages`, `241 snippets`, `122 routes + 43 host-ops`; pass with 62 existing freshness warnings)
