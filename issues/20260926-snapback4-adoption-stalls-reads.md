# Snapback 4: adopting new maintained views over a large store stalls reads for over a minute

- **Opened:** 2026-09-26, from calibration #22 (0.4.3), milestone M8 on the scale
  database.
- **Area:** schema adoption (`crates/snapback4-core/src/store/activation.rs` and
  the view rebuild it runs), the dev server's request path while adoption holds
  the engine.
- **Severity:** Medium. Availability and scale, not correctness: the answer was
  complete when it came.

## What happened

The builder's scale replay had settled 167,157 actions across 1,002
conversations. At M8 the builder added maintained views to the running program:

- `originalTotals`, `receivedLikes`, `receivedReposts` and `receivedReplies`,
  counts through a reference (`.post.author`, `.parent.author`);
- `dailyPosts`, a count by `.author, day(.at)`.

The dev server adopted the new schema. The first `insights` read, from actor
`u0005`, waited **74,978 ms** and then returned a complete answer. The next,
from `u0500`, took 3 ms. The builder recorded it as `ambiguous` and did not
charge it. The scorer's `scale_and_limits` note names it, and the final report
keeps it as "an operational limitation".

Evidence is in the calibration #22 packet on the black M5:
`~/clique-sb4-20260926-astra-cal22/lanes/astra-snapback4/evidence/scale-m8-during-adoption.json`,
`scale-m8-probes.json`, `scale-health.txt`.

## What should happen

Adoption should not hold every read for the whole view backfill. Either:

- the backfill runs in bounded chunks, with the engine released between them,
  as LLP 3000.015's recounts do; a read of a view not yet built answers
  pending, never queues; or
- the backfill is fast enough at this size (seconds, not a minute) that holding
  reads is acceptable.

## To find out first

- Where the 75 s goes: one view at a time, or all of them? Per-row engine
  overhead (authorization, reference resolution for `.post.author`), or index
  builds?
- Whether the dev server holds the engine lock for the whole adoption.
- What `check` and the scale certificate say about adoption cost. Today they
  say nothing.

## 2026-09-26 lane AD implementation and remaining work

The corrected synthetic calibration-scale fixture measured 167,083 ms before
optimization and 9,601 ms afterward; the six grouped folds already take under a
second. Most original time was unrelated index replacement, now avoided when
its complete interpretation is unchanged. Query/sync readers use independent WAL
connections during atomic adoption: the concurrent fixture query drops from
167,084 ms to less than 1 ms. Newly added queries return pending until publication.
Queued writes execute once afterward. Full row/index/log/commit equality and
crash-restart witnesses are in
[the lane report](../snapback4/reports/20260926-lane-ad-adoption.md).

Keep this ticket open: the approximately one-second adoption target is not met,
and `/changes` still waits for its durable presence-reconnect write. The report
contains a held-adoption reproduction and explains why acknowledging reconnects
before their durable write would be incorrect across a crash. No blanket
nonblocking-read or nonblocking-write capability is claimed.
