# Snapback 4: Stream polling executes individual SQLite queries for every held group

Status: Open
Priority: P2
Observed: 2026-09-13
Review finding: P01
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [partition.rs](../snapback4/crates/snapback4-core/src/partition.rs), [store.rs](../snapback4/crates/snapback4-core/src/store.rs)

## Problem and reproduction

In `snapback4-core/src/partition.rs`, `stream()` delivers events across all partitions accessible to a principal.

Lines 499–504:
```rust
for ((table, group), spans) in &held {
    let group_values: Vec<Value> = serde_json::from_str(group).expect("canonical");
    let events = tx.read_log(&group_partition(table, &group_values), watermark, limit + 1)?;
    saturated(&events);
    candidates.extend(events.into_iter().filter(|event| spans.iter().any(|span| span.covers(event.seq))));
}
```

And in `has_more()` (lines 590–598):
```rust
for ((table, group), spans) in held {
    if !spans.iter().any(|span| span.to.is_none_or(|to| to > next + 1)) {
        continue;
    }
    let group_values: Vec<Value> = serde_json::from_str(group).expect("canonical");
    if tx.read_log(&group_partition(table, &group_values), next, 1)?.iter().any(|event| spans.iter().any(|span| span.covers(event.seq))) {
        return Ok(true);
    }
}
```

Every single client poll to `/changes` or `/sync`:
1. Queries the viewer's `own` partition.
2. Queries the `public` partition.
3. Loops over every group currently or recently held by the viewer, issuing a separate `SELECT` query against SQLite via `tx.read_log()`.
4. Repeats the loop in `has_more()`.

For a user who belongs to 300 chat channels, document folders, or project boards, a single poll executes over 600 individual SQL queries.

With 20 active clients connected via long-polling or regular sync, the server executes tens of thousands of individual queries every few seconds, starving the single-threaded/lock-bound SQLite connection pool, generating excessive syscall and context switch overhead, and causing high latency for concurrent writes.

## Acceptance

- Stream queries must batch group partition reads instead of executing $N$ queries per group.
- Use an `IN (...)` or temporary table join over partition keys, or query the partition log with `seq > watermark` indexed by `(seq, partition)` where partition matches the set of held keys.
- Benchmark stream polling with 500 held groups to confirm it executes in $O(1)$ SQL queries rather than $O(N)$.

## Implementation locations

- [crates/snapback4-core/src/partition.rs](file:///Users/ccheever/projects/snapback/snapback4/crates/snapback4-core/src/partition.rs#L481-L541) (`stream`)
- [crates/snapback4-core/src/partition.rs](file:///Users/ccheever/projects/snapback/snapback4/crates/snapback4-core/src/partition.rs#L586-L600) (`has_more`)
- [crates/snapback4-core/src/store.rs](file:///Users/ccheever/projects/snapback/snapback4/crates/snapback4-core/src/store.rs) (`read_log`)
