# Received second core review — Sol

Reviewer: Codex gpt-5.6-sol, xhigh; independent CLI session, 2026-09-13.
Reviewed immutable `65e2ad752` against `cca6a2d0b`. Mutually blind with the Grok review. Static review only; no repository edits or tests. The full received final text follows. Raw events, stderr and timing are retained in the run ledger's ignored `reviews/second-core/` archive.

## Received review

Review of `65e2ad752` against `cca6a2d0b`; line numbers refer to the reviewed SHA.

- **P1 — A post-expiry rejoin is ignored until the old grant is physically swept.** [partition.rs](/Users/ccheever/projects/snapback-worktrees/sb4-36-delivery/snapback4/crates/snapback4-core/src/partition.rs:463) accepts `join` only when `open` is `None`. An expired-but-unswept interval remains open, so a later valid join for the same principal/group is discarded. Reproduction: grant group `g` until `10`; without sweeping, insert a replacement grant until `100` at time `20`; write group content at `21`; stream from before both joins at `22`. The content is filtered using the first grant’s deadline and a scope is emitted, despite the replacement grant being live. This violates LLP 3000 §7’s requirement that lifetime renewal create a new interval.

- **P1 — Logical expiry cannot materialize a maintained sum whose stored total was zero.** [read.rs](/Users/ccheever/projects/snapback-worktrees/sb4-36-delivery/snapback4/crates/snapback4-core/src/engine/read.rs:83) can recompute only an existing aggregate row, while a missing lookup bypasses it at [read.rs](/Users/ccheever/projects/snapback-worktrees/sb4-36-delivery/snapback4/crates/snapback4-core/src/engine/read.rs:207). Reproduction: maintain `sum items of amount by group`; insert live `+5` and `-5` expiring at `2000`. The stored aggregate is absent because its physical sum is zero. At time `3000`, the expired `-5` must be logically absent, so the sum should be `5`, but the query remains `null` until the sweep physically deletes that source.

- **P1 — A meter cut inside aggregate recomputation can terminate a nonempty page without a continuation.** At [read.rs](/Users/ccheever/projects/snapback-worktrees/sb4-36-delivery/snapback4/crates/snapback4-core/src/engine/read.rs:479), `None` from `live_aggregate` is treated as an absent aggregate without checking whether it set `meter.capped_at`; consequently the local `capped` flag used at [read.rs](/Users/ccheever/projects/snapback-worktrees/sb4-36-delivery/snapback4/crates/snapback4-core/src/engine/read.rs:516) remains false. Reproduction: scan two maintained count groups with an opaque cursor and an examined ceiling of three. Group A is returned; recomputing group B crosses the ceiling. The outcome is capped and nonempty but has `next: None`, contrary to the required “continue from the last visible row” behavior.

- **P2 — Visible point reads on an expiring table are charged twice.** `live_lookup` charges the live candidate at [read.rs](/Users/ccheever/projects/snapback-worktrees/sb4-36-delivery/snapback4/crates/snapback4-core/src/engine/read.rs:72), then `get` charges the same lookup again at [read.rs](/Users/ccheever/projects/snapback-worktrees/sb4-36-delivery/snapback4/crates/snapback4-core/src/engine/read.rs:204). Reproduction: one unexpired row in a table declaring `expire at`, queried by ID with `examined = 1`. The single-row read returns `null` and capped instead of the row; under default ceilings, equivalent point-read workloads exhaust the examined budget at roughly half the documented capacity.

Static review only; no repository edits or test execution.

## Lead disposition

All four findings reproduced against old code and are corrected. Each replacement join opens its own lifetime; sweeping a predecessor checks for a live replacement. Zero-valued expiring sums retain candidates while source rows remain, including a one-time logged repair when an old server store opens. Scan cuts during live aggregate recomputation retain continuation after the last visible row. An expiring point candidate is charged once. Regression coverage includes rejoin through sweep and drained catch-up, zero sums on both device stores, legacy repair idempotence and deletion of the final source, and the meter boundaries. A narrow independent delta review follows these corrections.
