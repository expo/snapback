# Snapback 4: Join expansion is skipped when a group membership has a later leave

Status: Closed
Priority: P1
Observed: 2026-09-13
Review finding: C02
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [LLP 3000.001](../../llp/3000.001-durable-replica-and-write-lifecycle.research.md), [partition.rs](../../snapback4/crates/snapback4-core/src/partition.rs)

## Problem and reproduction

In `snapback4-core/src/partition.rs`, `expand_joins()` translates `join` log events into initial `put` snapshots of all existing rows in that group for the newly joined viewer.

Line 570 checks whether the join event's interval is still open:

```rust
// partition.rs:570
let open = held.get(&(event.table.clone(), event.id.clone())).is_some_and(|spans| spans.iter().any(|span| span.from == event.seq && span.to.is_none()));
if !open {
    continue;
}
```

The check requires `span.to.is_none()`. If a user joins a group at sequence 10 and leaves at sequence 50, the span for that interval has `from: 10, to: Some(50)`.

Because `span.to` is `Some(50)`, `span.to.is_none()` evaluates to `false`!
Consequently, `open` is `false`, and `expand_joins()` completely skips the join event.

The client that synchronizes history covering sequences 0..50 receives the incremental put events that occurred while the user was a member between 10 and 50, but **never receives the initial rows that existed when joining at sequence 10**.

This breaks the local-first replica contract:
- The user cannot view the channel history that was present when they joined.
- If the user was in the group, read the messages, and later left, a client catching up from watermark 0 ends up with an incomplete, corrupt view of the group's rows during that window, violating `retain delivered-history`.

Additionally, if a user joins, leaves, and joins again, `held.get(...)` contains multiple spans, and matching `span.from == event.seq && span.to.is_none()` will fail on the first join even if the second join is open.

## Acceptance

- When expanding a `join` event at sequence `seq`, the join must be expanded into the group's snapshot rows regardless of whether a leave event occurred later, provided the span started at `event.seq` (or is active at `event.seq`).
- A client syncing a window that includes both a `join` and a subsequent `scope` (leave) must receive the pre-existing group rows as `put`s so that queries on the replica during the membership window are consistent.
- Regression test covering join followed by leave within the same sync page.

## Implementation locations

- [crates/snapback4-core/src/partition.rs](file:///Users/ccheever/projects/snapback/snapback4/crates/snapback4-core/src/partition.rs#L563-L583) (`expand_joins`)

## Resolution — 2026-09-13

Historical join expansion now uses the row images present at the join commit, including when a later leave closes the interval. Same-commit grant/revoke remains empty, and edits or new rows after leave are excluded. The closed-membership regression passes with page limits 1 and 1000.

Integrated implementation: `4b70bdb6f` and `3d2007794`, plus the HTTP/device follow-ups where applicable. Focused core, simulator and host regressions passed. Full integrated suite and scoped blind review are recorded in the append-only Snapback4 journal before publication.

### Subsequent security integration

The concurrently landed security ruling at `867045564` restricts server catch-up to current readable images. Historical join intervals are still reconstructed even when a later leave closes them, but a revoked viewer cannot newly retrieve the candidate body. Delivered-history preserves rows already acquired on the device. This policy supersedes this ticket's expectation of newly delivering history after revocation; interval reconstruction, live rejoining and pagination remain repaired.
