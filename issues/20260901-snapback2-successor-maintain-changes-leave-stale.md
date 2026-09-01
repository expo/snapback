# snapback2: successor maintain changes leave stale or overwritten aggregates

**Status:** Open
**Systems:** snapback2, core engine, successors, maintained aggregates
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2-core/src/successor.rs:275-301

Failure scenario: generation A maintains cards into counts and counts[g]=1; an additive successor removes that maintain. Admission succeeds and counts[g] remains 1 forever. Separately, if a successor adds a comments maintain contributing 3 to the same target/group where cards already contribute 2, backfill overwrites the row with 3 instead of combining to 5.

Why it happens: successor planning/application at lines 445-471 considers only maintains newly added relative to current. Removed definitions trigger no cleanup. Each new maintain projects independently into a target-id map/write, so overlapping sources replace rather than accumulate. LLP 1001 permits maintains to change freely.

Suggested fix: transactionally rebuild every target affected by the symmetric maintain delta from the complete successor maintain set, combining contributions by target/id, or explicitly refuse unsupported removal/shared-target changes. Add both scenarios.
