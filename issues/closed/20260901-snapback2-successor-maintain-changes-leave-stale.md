# snapback2: successor maintain changes leave stale or overwritten aggregates

**Status:** Closed
**Resolution:** Rebuilt surviving affected maintain targets from the complete successor maintain set in successor.rs, with removed-maintain, shared-target, and destructive target-removal regression coverage.
**Systems:** snapback2, core engine, successors, maintained aggregates
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2-core/src/successor.rs:275-301

Failure scenario: generation A maintains cards into counts and counts[g]=1; an additive successor removes that maintain. Admission succeeds and counts[g] remains 1 forever. Separately, if a successor adds a comments maintain contributing 3 to the same target/group where cards already contribute 2, backfill overwrites the row with 3 instead of combining to 5.

Why it happens: successor planning/application at lines 445-471 considers only maintains newly added relative to current. Removed definitions trigger no cleanup. Each new maintain projects independently into a target-id map/write, so overlapping sources replace rather than accumulate. LLP 1001 permits maintains to change freely.

Suggested fix: transactionally rebuild every target affected by the symmetric maintain delta from the complete successor maintain set, combining contributions by target/id, or explicitly refuse unsupported removal/shared-target changes. Add both scenarios.

Follow-up regression: the first rebuild implementation also selected a target that the same destructive successor removed. `apply_migration` deletes that table and removes it from the reduced predecessor schema before additive admission/application, so rebuilding the old target tried to resolve the now-absent table and returned `E_SCHEMA`. Affected targets are now intersected with the successor's tables: retained targets are rebuilt from all successor maintains, while dropped targets need no rebuild because their migration drop already removed their rows and index entries.
