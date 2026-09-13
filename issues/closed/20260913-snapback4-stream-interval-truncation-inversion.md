# Snapback 4: Partition stream interval parity inverts on truncated log

Status: Closed
Priority: P1
Observed: 2026-09-13
Review finding: C01
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [LLP 3000.001](../../llp/3000.001-durable-replica-and-write-lifecycle.research.md), [partition.rs](../../snapback4/crates/snapback4-core/src/partition.rs)

## Problem and reproduction

In `snapback4-core/src/partition.rs`, the helper `intervals()` attempts to reconstruct group membership at a given `watermark` using parity between the current table state and transition events in the viewer's `own` partition:

```rust
// partition.rs:457
let held_at_watermark = now.contains(&key) == (steps.len() % 2 == 0);
```

However, `intervals()` is invoked from `stream()` passing `&own`:

```rust
// partition.rs:483
let own = tx.read_log(&own_partition, watermark, limit + 1)?;
// partition.rs:485
let held = intervals(tx, schema, principal, watermark, &own)?;
```

The `own` log read is bounded to at most `limit + 1` entries starting from `watermark`. Conversely, `now` evaluates membership at the current head of the database (`tx.next_seq() - 1`), which can be arbitrarily far ahead of `watermark + limit + 1`.

If membership in a group changed after the highest sequence in `own`:
1. `steps` contains only the transitions up to `watermark + limit + 1` (e.g. 0 transitions for this group).
2. `steps.len() % 2 == 0` evaluates to `true`.
3. If the principal is a member of the group `now` (e.g. they joined later at sequence 500), `held_at_watermark` evaluates to `true == true`, which is `true`.
4. The principal was **not** a member at `watermark` (sequence 100), yet the code infers they were, and initializes `open = Some(watermark + 1)`.
5. The interval covers events starting at `watermark + 1`, and `stream()` serves the private group log events to this principal for a period when they were not a member!

Conversely, if a member was in the group at `watermark`, had 0 transitions in the first `limit` log events, but subsequently left the group, `steps.len()` is 0 (even), `now.contains(&key)` is `false`, and `held_at_watermark` evaluates to `false == true` (`false`). The member's legitimate historical events during that period are skipped.

The assumption that `steps` contains every transition between `watermark` and `now` is violated whenever the log page is bounded or does not reach `now`.

## Acceptance

- `intervals()` must either read transitions all the way up to `now`, or reconstruct membership at `watermark` through an explicit membership log / snapshot without relying on unbounded future parity across a truncated event slice.
- When `own` is truncated by `limit`, intervals must not extrapolate past the highest sequence read in `own`.
- A test verifying that joining a group far after `watermark` does not leak historical group messages prior to the join when the log query is paged.

## Implementation locations

- [crates/snapback4-core/src/partition.rs](file:///Users/ccheever/projects/snapback/snapback4/crates/snapback4-core/src/partition.rs#L430-L478) (`intervals`)
- [crates/snapback4-core/src/partition.rs](file:///Users/ccheever/projects/snapback/snapback4/crates/snapback4-core/src/partition.rs#L481-L541) (`stream`)

## Resolution — 2026-09-13

Authority is reconstructed from the complete membership ledger through the transaction head rather than the truncated content page. Authorized group spans are merged before page limits; whole commits remain indivisible. The truncated-own-page regression cannot grant a later membership early, and closed joins preserve only their authorized historical images.

Integrated implementation: `4b70bdb6f` and `3d2007794`, plus the HTTP/device follow-ups where applicable. Focused core, simulator and host regressions passed. Full integrated suite and scoped blind review are recorded in the append-only Snapback4 journal before publication.
