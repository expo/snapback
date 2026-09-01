# snapback2: collection lookups reevaluate authored operands

**Status:** Closed
**Resolution:** Bound lookup operands once before iteration in compiler.ts/lower/collections.ts; regression covers modeled-input consumption.
**Systems:** snapback2, compiler
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/src/compiler.ts:310-312, snapback2/packages/compiler/src/compiler.ts:479-495, and snapback2/packages/compiler/src/compiler.ts:924-960. `set.add(ctx.newId())` can evaluate `ctx.newId()` once while searching and again while appending, `map.get(ctx.newId())` evaluates a different ID for each entry, and `orderedPair(ctx.newId(), ctx.newId())` reevaluates both arguments for its min and max calculations. These operations inline the authored expression at multiple IR use sites instead of first binding its value, so stateful expressions consume extra IDs and return results impossible under JavaScript single-evaluation rules. Lower every receiver/key/value/argument to a temporary exactly once, then build lookup, update, min, and max expressions only from those temporaries.
