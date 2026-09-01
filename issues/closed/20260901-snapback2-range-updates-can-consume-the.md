# snapback2: range updates can consume the halo while clients still report Fresh

**Status:** Closed
**Resolution:** Counted retained-range index-key changes against halo coverage in both client twins; added scenario-range-update-halo.
**Systems:** snapback2, client prediction, ranges
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2-core/src/client.rs:46-122

Failure scenario: hydrate a descending three-row c1 page plus one halo while an older fifth c1 row is not retained. Apply two updates moving the newest retained rows to c2. Local reexecution returns only the remaining two retained c1 rows and Fresh, while the authoritative result contains the unseen fifth row as the third item.

Why it happens: both this Rust ClientStore and snapback2/packages/evaluator/src/evaluator.ts:157-175 detect range consumption only by comparing global row IDs before/after. Changing an indexed prefix preserves IDs, so neither increments its range-deletion counter; freshness cannot see rows that left or reordered within the covered window.

Suggested fix: compare pre/post index keys and visibility for every covered range, count rows leaving or crossing its boundary, and return Partial once the retained halo no longer proves the requested page. Add the two-update scenario to the shared corpus.
