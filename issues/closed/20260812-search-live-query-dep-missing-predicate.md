# Search live Query deps have `predicate: None`, so every commit wakes every search subscriber

**Opened:** 2026-08-12 · **Severity:** P2 (performance; multiplies live fan-out) · **Area:** live search / matcher

## What

Search captures a Query dependency with **no** serializable plan (`src/local.rs:30409-30414`):

```30409:30414:src/local.rs
            let mut read_dependencies = vec![CapturedReadDependency {
                kind: CapturedReadKind::Query,
                table: Some(plan.table.clone()),
                ...
                predicate: None,
```

The dependency gate then fails closed *before* table filtering (`src/live_matcher.rs:328-336`): missing predicate → `ConservativeFallback`. Any non-empty `changes` — including a disjoint table — becomes a full re-search for **every** live search subscription.

The HostPlan `SearchQuery` arm is table-granular (`src/live_matcher.rs:247-249`) but is never reached once a Query dep exists.

## Why it matters

This is not “search is expensive.” It is a matcher vocabulary hole that multiplies the already-ticketed zb5-hot fan-out (`issues/20260808-live-query-reevaluation-cost-at-scale.md`): one `users` write re-runs every `issues` live search. Correct, but structurally O(subscribers × commits) with no skip.

## Fix

Either omit the Query dep and let the SearchQuery table-granular arm run, or store a real `SearchQueryPlan` (or `{table}` predicate) so missing-plan does not fire until that table is touched.

## Confidence

High on the matcher path. Amplifies the existing live-query cost ticket; not called out there as a matcher defect.

## Resolution (2026-08-12)

Fixed search query capture by omitting the predicate-less `Query` dependency.
Search has no serializable `QueryPlan` predicate in the shared dependency
vocabulary, so the table-granular `HostPlan::SearchQuery` matcher now remains
reachable: disjoint-table commits skip, while commits on the indexed table
conservatively re-run the search. The execution arm also accepts the declared
`LiveQuery` search carrier.

Regression coverage establishes a live search, proves an `audit` table commit
increments the matcher skip without producing output, then proves an `events`
table commit re-runs search and emits one replacement containing the match.

Evidence: `cargo test --lib
live_search_skips_disjoint_table_commits_and_reruns_searched_table_commits` (1
passed); `cargo test --lib` (2,635 passed, 0 failed, 2 ignored).
