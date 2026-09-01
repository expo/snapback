# snapback2: Cap constraints ignore updates into a full group

**Status:** Closed
**Resolution:** Updated snapback2-core engine cap checks to enforce destination-prefix changes on updates, with full, multi-column, and same-prefix regression coverage.
**Systems:** snapback2, core engine, constraints
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2-core/src/engine/runner_ops.rs:262-340

Failure scenario: a Cap max 2 is grouped by boardId. Board A has one row and board B has two. Updating the A row to boardId B commits, leaving three rows in B.

Why it happens: replace calls check_constraints with Effect::Update at line 73, but the Cap branch at line 295 runs only for Effect::Insert. Neither index maintenance nor SQLite has an equivalent cap constraint, so the destination prefix is never counted.

Suggested fix: for updates and existing-row upserts, compare old/new cap prefixes and check destination capacity whenever the prefix changes, excluding the current row when appropriate. Add full-destination, same-prefix, and multi-column-group tests.
