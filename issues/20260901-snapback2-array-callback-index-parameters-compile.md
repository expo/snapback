# snapback2: array callback index parameters compile as undefined variables

**Status:** Open
**Systems:** snapback2, compiler
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/subset-lib.d.ts:9-13 and snapback2/packages/compiler/src/lower/expr.ts:666-681. The declared surface accepts `[10, 20].map((value, index) => index)`, but lowering binds only the first callback parameter, so the emitted body references an unknown `index` variable and fails at runtime instead of returning `[0, 1]`. The standard-library declarations advertise the JavaScript index parameter while callback lowering never establishes it, and no subsequent pass supplies that binding. Either bind a deterministic loop counter for the second callback parameter in map/filter lowering or remove it from the declarations and issue a compile-time diagnostic when authored.
