# snapback2 run-corpus crashes on serverOnly cases

**Status:** Closed
**Priority:** P2
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/packages/.../run-corpus.ts:1-42`, `test.ts:58-64`

## What was reported

`run-corpus.ts:1-42` iterates **all** manifest cases via `hydrateCase`
with no `serverOnly` filter and no try-catch, while `test.ts:58-64`
filters them. A bun probe showed the first `serverOnly` case (index 138,
`deliver-audience-bound-refused`) throws `E_CORPUS`. 27 of 293 cases are
`serverOnly`, so the runner trips over ~9% of the corpus.

## Suggested fix

- Filter `serverOnly` cases out of the run path (matching `test.ts`), or
  add an expect-throw harness for them.
- Add a CI assertion that the runner passes over the full manifest.

## Acceptance

- `run-corpus` passes green over the current manifest with no `E_CORPUS`
  from `serverOnly` cases.

## Resolution (2026-09-12)

The portable runner skips and reports serverOnly certification cases, asserts corpus version, and collects unexpected errors per case rather than aborting at the first failure. Existing test.sh rebuilds and runs its embedded bundle.

Validation: bun src/run-corpus.ts reports266 passed,27 skippedServerOnly,0 failed; full evaluator tests separately verify all27 server-only refusals.
