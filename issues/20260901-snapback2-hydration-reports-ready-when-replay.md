# snapback2: hydration reports ready when replay coverage is partial

**Status:** Open
**Systems:** snapback2, evaluator, hydration
**Severity:** P3
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/evaluator/src/evaluator.ts:982-999

Failure scenario: clone the named-thread case and remove its authoritative range proof while retaining the held rows. evaluateCase correctly returns localState partial with programs.thread.0 in partialSites, but hydrateCase returns planState "ready" and no diagnostic because the row result and digest still match.

Why it happens: hydrateCase defines replay mismatch only as canonicalResult/digest inequality. It ignores localState, partialSites, rangeStops, and errorCode even though compareExpected immediately below treats those fields as contract data. LLP 1002 forbids collapsing partially-held coverage into ready/complete.

Suggested fix: make hydration readiness require the full expected receipt-backed state tuple, not just result bytes, and produce a replay/coverage diagnostic for any mismatch. Add the missing-range case as a regression.
