# snapback2: Quarry leaves deleted generated modules callable

**Status:** Closed
**Resolution:** Quarry now journals the exact generated basename set in snapback/.quarry-generated.json and removes only prior headered outputs absent from the next successful build in packages/quarry/src/compiler.ts; the rename regression is in packages/quarry/src/test.ts.
**Systems:** snapback2, quarry
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/quarry/src/compiler.ts:12-17 and snapback2/packages/quarry/src/compiler.ts:39-56. Compile `todos.q`, then rename it to `items.q` and compile again: generated `snapback/todos.ts` and `todos.q.ts` remain, so package compilation and the API can continue serving operations that no longer exist in source. The compiler overwrites current outputs but has no ownership manifest or stale-output sweep, and downstream discovery consumes all remaining generated modules. Record the exact generated-file set per successful build and atomically remove only previously owned files absent from the new set before publishing the output.
