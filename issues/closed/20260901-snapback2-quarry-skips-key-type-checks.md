# snapback2: Quarry skips key type checks for named indexes

**Status:** Closed
**Resolution:** packages/quarry/src/catalog.ts now validates every known key component against the selected index column for inferred, named, and explicit point/range selection; compound point/range regressions are in packages/quarry/src/test.ts.
**Systems:** snapback2, quarry
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/quarry/src/catalog.ts:137-173, especially snapback2/packages/quarry/src/catalog.ts:148-161. With a Boolean unique index `byDone`, the query `todos[done = "yes"] by byDone` compiles and certifies, then looks up a string key and returns no row instead of reporting the source type error. Catalog validation checks key compatibility only on one inference path and skips explicit/named-index modes; compiler IR leaves the key effectively unknown, so certification does not catch it. Validate every equality/range component against the selected index column type regardless of how the index was chosen, including compound keys and bounds.
