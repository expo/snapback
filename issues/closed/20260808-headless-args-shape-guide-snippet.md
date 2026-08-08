# guide-gap: headless client query/liveQuery args nesting reads ambiguously

**Status:** Closed
**Impact:** 2
**Urgency:** 2
**Ease:** 5
**Confidence:** 4
**Systems:** Guide, Headless client
**Date:** 2026-08-08
**Related:** Diary 0069 (run 5, 0.1.15)

`client.query(ref, { args: {...} })` requires nested args; the guide's
todo snippet reads as flat (`db.query(api.listTodos, { userId: ADA })`),
producing SNAPBACK_ARGUMENT_VALIDATION_FAILED and a source-reading detour
(run-5 skill lane; the m4 lanes hit the same). Fix the snippet(s) to the
nested form and state the rule in one line.

## Resolution

Fixed 2026-08-08. `guide/clients/headless.md` now states the nesting rule and
transcludes the CI-compiled query, mutation, and live-query calls from
`packages/snapback-client/exact-reference-types.fixture.ts`, all using
`{ args: { ... } }`. The mutations page's adjacent acceptance excerpt no
longer includes a no-argument query whose outer `userId` option looked like a
flat function argument. Retrieval-eval case 23 preserves the repeated miss.

Verified with:

- `node packages/snapback-client/argument-validation.test.mjs`
- `./node_modules/.bin/tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler packages/snapback-client/exact-reference-types.fixture.ts`
- `node scripts/generate-guide-manifest.mjs`
- `node scripts/check-guide.mjs` (`64 pages`, `242 snippets`, `122 routes + 43 host-ops`; pass with 62 existing freshness warnings)
