# Pin head-bound storage reads to one snapshot

**Status:** Closed
**Severity:** P1
**Systems:** Storage, Queries, Membership, Live queries, OCC
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0003; LLP 0007; LLP 0032; LLP 0056
**Marker:** sqlite, snapshot, version, query, membership, occ

Several direct/local storage reads sampled the global head in one SQLite
autocommit transaction and fetched their row, query, scan, or authorization
facts in another. A sibling commit between those statements could pair a V0
head with a V1 row, falsely report storage corruption, or attach a later table
cursor to rows that never observed the corresponding change. Query handlers
could also assemble their primary result and membership dependencies across
different snapshots on the live/in-memory lane.

**Done when:**

- Every head-bound composite read uses one SQLite snapshot, reusing an existing
  transaction when the caller already owns one.
- A whole query invocation, including membership dependencies, uses one pinned
  read view on direct, live-subscription, and in-memory paths.
- Query and live dependencies carry a cursor inseparable from the rows or
  commit frame they describe, rather than a later sampled table head.
- Startup validation, auth-mode fresh-seed emptiness checks, scans,
  retained-result reads, room permission reads, and membership planners/logs
  cannot assemble split-version facts.
- A deterministic sibling-writer regression proves point, query, and scan
  surfaces keep their sampled head and rows together.

## Resolution

`with_pinned_read_snapshot` now gives every logical composite read a short
deferred transaction while transparently reusing the WAL read lane or an
existing commit transaction. The direct/live query entry point pins the full
handler invocation, so its result and membership witnesses share one view.
Captured query dependencies use the exact query output head, and delta fanout
advances dependencies to the exact applied commit frame.

The deterministic regression pauses after the reader establishes its snapshot,
commits a sibling patch, and proves get/query/scan still return the predecessor
row and version before observing the new head on a later read.
