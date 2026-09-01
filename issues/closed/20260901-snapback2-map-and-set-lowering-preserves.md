# snapback2: Map and Set lowering preserves duplicate entries

**Status:** Closed
**Resolution:** Added uniqueness-preserving Map/Set construction and mutation lowering in lower/collections.ts; regression covers duplicates and replacement order.
**Systems:** snapback2, compiler
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/src/compiler.ts:461-477 and snapback2/packages/compiler/src/compiler.ts:892-921. Given `const m = new Map(); m.set("x", 1); m.set("x", 2)` and `new Set(["x", "x"])`, the lowered array-backed collections report sizes 2 and 2 and may return the stale map value, instead of JavaScript sizes 1 and 1 with value 2. Construction and mutation append entries without replacement or deduplication, and the runtime treats the resulting arrays exactly as emitted. Implement bounded key equality plus replacement/deduplication for Map.set, Set construction/add, and related operations, or reject these APIs rather than presenting incompatible JavaScript semantics.
