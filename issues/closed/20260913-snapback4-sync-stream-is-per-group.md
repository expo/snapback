# Snapback 4: `/sync` still materializes under the engine write lock, O(groups)

Status: Closed
Priority: P2
Date: 2026-09-13
Systems: partition stream, HTTP `/sync`, store transactions, maintain loop
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)
Related: [LLP 3000.002](../../llp/3000.002-end-to-end-resource-bounds.research.md); overlaps [per-group log reads](20260913-snapback4-stream-poll-query-amplification.md) and [unbounded threads](20260913-snapback4-unbounded-http-threads-and-timeouts.md)

## Problem and reproduction

Closed R18 released the engine lock before socket writes. Computation is still exclusive:

- `Store::transaction` is always `BEGIN IMMEDIATE`, including every query and every native local read (which then `rollback`s).
- `GET /sync` runs `snapshot_page` / `stream` + `acknowledged` entirely under `engine.lock()`. `stream` reads `limit+1` log events from the principal partition, `public`, **and every currently held group**. Clique `u0001` is ~1000 memberships → ~1000 log range scans per page. Join expansion then materializes a group’s horizon rows into that commit.
- `GET /schema` builds a full `serde_json::Value` of schema+programs while holding `bound`.
- The maintain tick can run 500 job chunks per second in a tight loop, each taking the same mutex. Comment says the engine is free between chunks; there is no yield/sleep.
- `rebuild_maintain` during activation still loads the whole source with `usize::MAX` inside `BEGIN IMMEDIATE` (row projection already pages 500). Horizonless `group_rows` uses `u32::MAX` the same way.

tiny_http `incoming_requests` is `recv().ok()`: any accept error ends `serve()` with `Ok(())` and exit 0. Request lines and headers are still unbounded (R18 bounded bodies only). Thread-per-request plus no socket deadline means a cancelled `/changes` keeps its thread until the wait ends.

## Implementation locations

- [snapback4/crates/snapback4-core/src/partition.rs](../../snapback4/crates/snapback4-core/src/partition.rs) (`stream`, `expand_joins`)
- [snapback4/crates/snapback4-core/src/store.rs](../../snapback4/crates/snapback4-core/src/store.rs) (`transaction`)
- [snapback4/crates/snapback4/src/serve.rs](../../snapback4/crates/snapback4/src/serve.rs) (`/sync`, `maintain`, `incoming_requests`)
- [snapback4/vendor/tiny_http/src/client.rs](../../snapback4/vendor/tiny_http/src/client.rs) (`read_next_line`)

## Suggestion

Use a deferred/read transaction for queries. Merge-iterate log partitions instead of one `read_log` per group, or index `_log` by seq across partitions. Bound request-line/header size. Iterate `recv()` and exit 1 on accept errors. Cap handler threads or set socket deadlines. Sleep or yield in the job-chunk burst.

## Resolution — 2026-09-13

Queries, change reads and sync use detached read engines and deferred transactions; native device queries also use deferred transactions. Log spans merge in one SQLite statement independent of held-group count. Schema JSON encoding releases the compiled-backend lock first. Aggregate rebuild source/target buffers and horizon reads page internally. Existing bounded workers/socket deadlines are retained; headers are bounded, accept errors surface and job bursts yield. Snapshot reconstruction and aggregate state still scale with actual result/group size; this does not claim constant work or a new resource ceiling.

Integrated implementation: `4b70bdb6f` and `3d2007794`, plus the HTTP/device follow-ups where applicable. Focused core, simulator and host regressions passed. Full integrated suite and scoped blind review are recorded in the append-only Snapback4 journal before publication.
