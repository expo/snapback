# Clique 0.3 integration — final review round

`sb4-03/integration` rebased onto `a63c37f7b`. Current correctness evidence is
[the reduced fixture](./20260923-integration-r2/reduced.log). Full-fixture timings
below are retained from [round 1](./20260923-integration-r1/full.log); the full
fixture was not rerun. This round changes verification, with no changes to the
Quarry application or timed operations. New checks at full scale remain unrun.

## Checked observations

- The recursive source census finds 6 application tables,
  5 maintains, 4 queries and 10
  mutations. All 33 negative fixtures fail, including every
  one of the parser's 18 declaration kinds inserted before `maintain feed`.
  Every table block is pinned. Projection tables, copied fields, verification,
  repair/backfill declarations, feed helpers, zero-like fill and projection writes
  all count zero. The census binds every current Quarry file by digest.
- Before write timing, the engine's complete stored follows set equals the model:
  159 edges. Stored rows give `u0900` 62 followers
  and `alice` 5. Full mode requires 900 and 5 from
  storage, but that new full-mode check has not run. Round 1's 900/5 labels were
  model-derived and are not presented as new stored-row evidence.
- Activation advances generation 1 → 2
  with 0 row events. Engine and device maps agree on
  381 posts and
  8 received-like groups.
  Complete device Following, Trending and thread pages equal the engine and model.
- All 5 admitted intents match their durable records across a
  process exit. Posting predicts, follow/unfollow queue, and settlement empties
  the outbox. The settled reply is at position 47;
  the device's stored `sp0001.likeCount` is 3.
  Engine and device rows are checked against the model. The equal-time cursor
  check compares all 45 engine reply ids/timestamps and spans at least three pages.
- Duplicate reposts leave the source and timeline event rows equal. Removing the
  original preserves the delivered repost and excludes the original from Trending.
  Like/repost return `FEED_POST_REMOVED` on the removed card. Unlike
  reaches stored count zero; Following equals the model after unrepost and purge.
- `feedRemovedEvents` contains 2 recorded tombstone ids
  for `lifecycle-repost-event` and `rank-003` before firing.
  `feedPurgeRemovedEvery` creates job `01KE0D72RTYFT5GJSCHG9XKV92`, absent from the earlier job
  ids, targeting `feedPurgeRemoved`. That exact job executes 2
  chunks, reaches Done, and both stored tombstones are absent afterward.
- Engine daily counters for `alice` on `rank-001` are shown below.
  Each pair is **[received likes, received replies]**. Both contributions arrive
  on day 20455; the old post-day counters remain equal.

| Engine bucket | Before | After |
|---|---|---|
| Post day 20454 | [2, 1] | [2, 1] |
| Arrival day 20455 | [21, 46] | [22, 47] |

Final stored source counts match the model: 428 posts,
31 likes, 51 replies and 159 follows.

## Retained full-fixture measurements

These local engine/SQLite measurements include production sync JSON encoding.
They exclude HTTP/TLS and browser throughput. Ratios are recomputed from the
retained samples and checked against 3×. No new full-scale validation or
matched-load comparison is inferred from them. Original historical WASM byte
records remain in [round-1 evidence](./20260923-integration-r1/historical-wasm.json);
this report makes no claim about a current WASM build.

| Measure | Round-1 full-fixture measurement |
|---|---:|
| Full fixture elapsed | 484.496 s |
| Following u0005: examined / p95 | 102 / 0.510416 ms |
| Following u0500: examined / p95 | 102 / 0.724708 ms |
| Following u0901: examined / p95 | 145 / 0.657291 ms |
| Post acknowledgement alice p95 | 5.666334 ms |
| Post acknowledgement u0900 p95 | 4.813000 ms |
| Dense / sparse read p95 | 1.420× |
| Celebrity-reader / sparse p95 | 1.288× |
| Celebrity / ordinary post p95 | 0.849× |
| 500-byte parent: column / separate stream | 1,111 / 611 B |
| 4,000-byte parent: column / separate stream | 4,611 / 611 B |
| Prior snapshot: rows / production JSON bytes | 114,993 / 19,539,296 B |
| Complete-app snapshot: rows / production JSON bytes | 114,993 / 20,268,151 B |

## Current verification

| Check | Result | Evidence |
|---|---:|---|
| reduced | 1 passed | [reduced.log](./20260923-integration-r2/reduced.log) |
| probe | 2 passed | [probe.log](./20260923-integration-r2/probe.log) |
| affected | 65 passed | [affected.log](./20260923-integration-r2/affected.log) |
| wire | 8 passed | [wire.log](./20260923-integration-r2/wire.log) |
| census | 3 passed | [census.log](./20260923-integration-r2/census.log) |
| fence | 1 passed | [fence.log](./20260923-integration-r2/fence.log) |

The reduced fixture completes in 3.632 s. Its recorded one-minute
load is 35.54 at launch and 30.91 at exit;
it is a correctness rerun on the shared host, using `--test-threads=4`.
`report.py --check`
requires passing logs, validates the current booleans, compares daily deltas,
new-job identity, follower evidence and schema digests, recomputes timing ratios,
and compares the rendered report and measurement table byte for byte.

Printed claims changed: `CLIQUE_FOLLOWERS` (new stored-set comparison),
`CLIQUE_WRITE.followers`, `CLIQUE_WRITE_RATIO` follower counts,
`CLIQUE_TRANSITIONS` tombstone presence/new-job/chunk evidence,
`CLIQUE_ARRIVAL_DAYS` engine counts/deltas/timestamps,
`CLIQUE_RESTART.settled_post_like_count`, `CLIQUE_CORRECT.equal_timestamp_cursor`,
`CLIQUE_SEED.stored` and `CLIQUE_OK` source counts. The report now separates
current checks from historical timings and removes unverified process and
current-artifact assertions.
