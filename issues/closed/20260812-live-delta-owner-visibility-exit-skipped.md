# Live delta leaves transferred-away rows on the client

**Opened:** 2026-08-12 · **Severity:** P1 (authorization leak / permanent stale live data) · **Area:** live queries / matcher

## What

Membership *exit* on the incremental live-delta lane is detected in only two ways:

1. A `CapturedReadKind::Row` hit on `(table, id)` (`src/live_matcher.rs:300-311`).
2. `update_may_have_changed_query_membership`, which inspects **`plan.filters` only**, not `table_visibility` owner fields (`src/live_matcher.rs:563-577`).

`row_matches_query_filters` *does* apply `TableVisibilityV1::Owner` (`src/live_matcher.rs:438-442`). After an ownership transfer the new image returns `Some(false)`. Then:

```367:384:src/live_matcher.rs
        Some(true) => { /* Match or limited-window check */ }
        Some(false) if update_may_have_changed_query_membership(plan, change) => {
            LiveMatchOutcome::ConservativeFallback
        }
        Some(false) => LiveMatchOutcome::Skip,
```

`Query.rows` is **not** consulted on that miss. The incremental lane then applies Add/Remove only to the Query dependency and never adds a Row dep for `Add` (`src/local.rs:24980-25015`).

Owner-only visibility is *not* `contains_membership` (`src/manifest.rs:1299-1302` matches only `Membership` / `AnyOf` membership arms), so these queries stay on the delta lane (`src/local.rs:24324-24332`).

## Reproduction (code-level)

1. Handwritten `defineLiveQuery` on an owner-visible table **without** an `ownerId` filter (codegen injects `tableVisibility` only).
2. Unordered, below the effective cap, `Documents` contract → delta lane.
3. Insert a row for the subscriber → `live_delta` Add; `Query.rows` gains the id; **no Row dep**.
4. Transfer `ownerId` to someone else → matcher **Skip**.
5. Client keeps the row they no longer own.

`compute_live_delta` would `Remove` if it ran (`src/live_matcher.rs:898-907`); Skip prevents that. Standard-pattern CRUD is safe: it adds `eq(ownerField, authUserId())` *and* sets `standardPattern`, which forces replace.

## Why it matters

Authorization leak / permanent stale live data after a transfer. Not a missed wakeup on an unrelated table — the subscriber keeps a row the SQL visibility predicate would now hide.

## Fix

In `query_plan_change_outcome`, if `dependency.rows` contains `change.id`, treat a filter/visibility miss as Match (or ConservativeFallback). Also treat `table_visibility` owner fields like filters in `update_may_have_changed_query_membership`. After applying delta Add/Remove, add/drop matching Row deps (and bump their versions on Update).

## Confidence

High on the matcher/delta mechanics. Standard-pattern generated CRUD does not hit this; handwritten owner-visible live queries do.

ENG-23420 fixed “Row deps were ignored entirely”; this is the remaining Query.rows / visibility-exit hole.

## Resolution (2026-08-12)

Fixed the shared matcher so a changed id already present in a captured
`Query.rows` set cannot be skipped when its new image misses the query, and so
owner-visibility fields participate in update membership detection alongside
ordinary filters. The incremental lane now keeps matching `Row` dependencies
in sync with delta Add/Remove operations and advances them on Update.

Regression coverage reproduces the empty subscribe → matching insert → delta
Add → ownership transfer → delta Remove sequence with a handwritten
owner-visible live query that has no redundant owner filter.

Evidence: `cargo test --lib live_matcher` (21 passed); `cargo test --test
live_delta_v0` (10 passed); `cargo test --lib` (2,635 passed, 0 failed, 2
ignored).
