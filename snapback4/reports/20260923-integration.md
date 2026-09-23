# Clique 0.3 integration — review round 1

2026-09-23 · `sb4-03/integration`, changes above `53950e084`, uncommitted.

The strengthened reduced fixture and the single full fixture pass. Every result
below is derived from asserted checks or measured values in the linked
[evidence](./20260923-integration-r1/full.log). The report replaces the original
first-page device claims and hand-built response byte totals. These are local
engine/SQLite measurements, not HTTP/TLS, fsync, browser, or publication throughput.
No absolute-latency envelope against the historical recipe is claimed.

## Review disposition

1. **Production bytes — done.** Both acquisitions and contribution streams use
   the production `SnapshotReply`/`StreamReply` encoders. The snapshot type moved
   unchanged from `serve.rs` into `sync_wire.rs`; the CLI and test share that file.
   Production sequence, acknowledgement and store identity fields are included;
   serde controls omitted empty fields. Request-only metadata is attached only
   after measuring the response. Both existing wire encoding regressions pass.
2. **Restart/adoption — done.** All device cursor pages are compared to the server
   and independent model for Following, Trending and the thread. Each durable
   record matches its admit's id, operation, viewer, arguments, clock, order and
   prediction eligibility. Settlement consumes those durable records. Reply
   47 is explicitly read, as are the settled like and
   `sp0001.likeCount` (3). Complete id→value maps
   validate every post and received-like aggregate in both stores. Unknown ids,
   missing parents and missing nonzero fields fail. The documented implicit-zero
   representation is accepted only for model-zero parents; absent nonzero groups
   are never filled in.
3. **Census — done.** Recurses through every `.q` file, tokenizes strings and
   comments safely, inventories declarations and columns independent of whitespace,
   and rejects any declaration outside the complete allowlist. The complete
   timeline and both daily maintains are pinned, alongside every query and mutation.
   All 15 negative fixtures are rejected, including a nested
   projection file, copied fields, verification, repair/backfill, helper calls,
   helper declarations, schedules, altered timeline, post-day grouping and zero fill.
4. **Celebrity write — done.** Acknowledged posts by `u0900` and `alice` use
   the same 3 warmups and 20 samples
   as reads. Their actual follower counts are asserted; nearest-rank p95 and all
   reader/write scaling bounds are checked against RFC §8's 3× limit.
5. **Removal/unlike/unrepost — done.** Each unlike checks the source-like,
   maintained-column and received-like models against storage. Following is checked
   after unrepost and after cleanup. Removal and unrepost must produce their
   tombstones before the timeline's own schedule fires; its queued job runs to
   Done and the recorded ids must disappear. Printed flags use those check results.
6. **App corrections — done.** Trending excludes removed posts. Like and repost
   first require an existing card, then refuse removal with `FEED_POST_REMOVED`;
   missing cards use `FEED_APP_NOT_FOUND`. Existing delivered reposts remain readable.
   The independent model has the same admission rules. Both daily maintains use
   **arrival day**, spelled `day(.at)` in the admitted Quarry grammar, replacing
   post-day grouping. A later-day like and reply on `rank-001` are checked across
   the seven-day window, post days, and the empty following day.
7. **Serial reruns/report — done.** Load-gated reduced and full runs completed,
   with one full invocation. Source, checks and results are retained below.

## App and independent oracle

The [app](../examples/clique-03/snapback/schema.q) has
137 physical and 122
nonblank/noncomment lines. SHA-256:
`b28b819006b872aa2415342332192c3853849da774d2b3544d396f9bae68d7d5`.

`receivedLikes` now inherits public sync from likes so the requested adoption
comparison can inspect actual device aggregates. Other received/daily insights
remain online-only. This adds a received-like row to each measured contribution
stream and its nonzero groups to acquisition. Arrival-day grouping also removes
the need to record the post's time on those source rows. The byte changes therefore
include these deliberate schema corrections as well as the encoder correction.

| Census | Checked count |
|---|---:|
| Quarry files | 1 |
| Source tables | 6 |
| Columns | 20 |
| Maintains | 5 |
| Queries | 4 |
| Mutations | 10 |
| Helpers | 0 |
| Jobs | 0 |
| Schedules | 0 |
| Application projection tables | 0 |
| Copied attribution fields | 0 |
| Verification clauses | 0 |
| Repair/backfill declarations | 0 |
| Feed helper calls | 0 |
| Zero-like fills | 0 |

The fixture version and scale-log digest remain verified against the committed
social-messenger pack. Social operations use the application mutations and fixture
principals/ids. Synthetic arrival time advances in replay order. The fixture's
social cardinalities, named sparse/dense readers, promoted author and repost count
are asserted before adding targeted cases. Messaging, media and profile editing
remain outside this backend's scope. Expected counts and event membership come
from the independent source model, not engine projections.

| Initial Following reader | Checked events | Actual cursor pages |
|---|---:|---:|
| u0005 | 261 | 14 |
| u0500 | 24,555 | 1,228 |
| u0901 | 433 | 22 |

Initial Trending checks 24,130 rows across
2,413 pages. Initial insights compare
32,256 values across 1,008
authors and 8 days. Adoption visits
48,256 posts and
996 received-like groups in
both stores. Thread continuation reaches 47
rows across 3 device pages after settlement.
Final model totals, including the targeted arrivals and acknowledged-write samples:
48,303 posts, 5,030 likes, 2,051 replies and
5,921 edges; final Trending has 24,176 rows.

The two checked tombstone ids are
`308bcca67216f03541c58e8c45c5bd92a67ca45686b2043412673297c0833c3b` and
`3deba77150e460cc1520c13d993c84f32fbae7015604372339f5b06e059a1aa3`. `feedPurgeRemovedEvery` fires and its job
finishes in 2 chunks before both ids are confirmed absent.

## Updated measurement table

Cargo's repository test profile, in-memory SQLite, serial operations. Seeding
includes compilation, parsing, mutations and model construction; Cargo build time
is excluded. Snapshot byte counts sum compact production JSON envelopes over
1,000-row pages. Acquisition times exclude the subsequent oracle comparisons.
Store allocation includes indexes, partition logs, commits and recorded attribution.

| Measure | Full-fixture result |
|---|---:|
| Seeding and model construction | 314.956 s |
| Entire serial full fixture | 484.496 s |
| SQLite allocated bytes / physical rows after adoption | 730,181,632 B / 420,764 |
| Prior snapshot: rows / production JSON bytes / acquisition | 114,993 / 19,539,296 B / 4.623 s |
| Complete-app snapshot: rows / production JSON bytes / acquisition | 114,993 / 20,268,151 B / 4.793 s |
| Populated activation / row events | 29.411 s / 0 |
| Following sparse: examined / p95 | 102 / 0.510416 ms |
| Following dense: examined / p95 | 102 / 0.724708 ms |
| Following celebrity reader: examined / p95 | 145 / 0.657291 ms |
| Dense/sparse read p95 ratio | 1.420× (asserted ≤ 3×) |
| Celebrity/sparse read p95 ratio | 1.288× (asserted ≤ 3×) |
| Post acknowledgement p95: alice, 5 followers | 5.666334 ms |
| Post acknowledgement p95: u0900, 900 followers | 4.813000 ms |
| Celebrity/ordinary write p95 ratio | 0.849× (asserted ≤ 3×) |
| 500-byte parent: column / separate stream | 1,111 / 611 B (1.818×) |
| 500-byte parent: column / separate aggregate event | 647 / 147 B |
| 4,000-byte parent: column / separate stream | 4,611 / 611 B (7.547×) |
| 4,000-byte parent: column / separate aggregate event | 4,147 / 147 B |

Every measured contribution has 3 events: the like,
received-like aggregate, and parent mirror or separate count. Checks require exactly
one relevant aggregate event and no timeline event. The byte ratio is computed
from the encoded totals. This app's three card joins differ from the historical
raw-event recipe; the read tests assert examinations within its recorded envelope,
while the table reports the directly measured scaling ratios.

The [historical raw-event recipe](./20260922-f3a-timeline.md) had fewer joins and
different shared-host load. Its absolute p95 comparisons remain visible below;
they are computed from that report, not treated as a matched-load regression or
as a passing absolute-latency gate. This full run began at one-minute load
54.00.

| Reader | Historical recipe p95 ms | This app p95 ms | App / recipe |
|---|---:|---:|---:|
| u0005 | 0.0852 | 0.510416 | 5.991× |
| u0500 | 0.0822 | 0.724708 | 8.816× |
| u0901 | 0.2204 | 0.657291 | 2.982× |

The retained original WASM artifacts were re-read and recompressed with Apple
`gzip -n -9`; their byte counts and SHA-256 hashes still match the original report.
These are historical builds, not new builds of this revision. Full hashes are in
[the checked artifact record](./20260923-integration-r1/historical-wasm.json).

| Historical artifact | Raw B | Gzip B | Integration delta raw / gzip B |
|---|---:|---:|---:|
| Published 0.2.33 | 1,599,837 | 443,422 | +107,753 / +29,669 |
| Pre-program c842dbaa5 | 1,599,837 | 443,526 | +107,753 / +29,565 |
| Original integration build dced7a791 | 1,707,590 | 473,091 | — |

Whole-artifact deltas do not independently attribute feature costs.

## Load and verification

[Reduced load samples](./20260923-integration-r1/reduced-load.json) and
[full load samples](./20260923-integration-r1/full-load.json) record every waiting
sample, start and end. Each run started below one-minute load 12 or after at least
30 minutes; no other lane-owned test/build ran during either fixture invocation.

| Fixture | Wait began | Wait | Start load 1/5/15 | End load 1/5/15 |
|---|---|---:|---|---|
| Reduced | 2026-09-23 12:44:57 -0700 | 1800.474 s | 20.92 / 20.39 / 21.07 | 19.73 / 20.15 / 20.98 |
| Full | 2026-09-23 13:15:02 -0700 | 1800.493 s | 54.00 / 59.65 / 41.27 | 13.59 / 35.78 / 39.77 |

| Check | Result | Evidence |
|---|---|---|
| App admission | 1 passed | [admission.log](./20260923-integration-r1/admission.log) |
| CLI app check | ok=true | [check.log](./20260923-integration-r1/check.log) |
| Focused lifecycle regression | 1 passed | [probe.log](./20260923-integration-r1/probe.log) |
| Affected engine/compiler tests | 63 passed | [affected.log](./20260923-integration-r1/affected.log) |
| Production wire encoding regressions | 2 passed | [wire.log](./20260923-integration-r1/wire.log) |
| Census and negative fixtures | 3 passed | [census.log](./20260923-integration-r1/census.log) |
| Published native/WASM refusal | 1 passed | [fence.log](./20260923-integration-r1/fence.log) |
| Reduced fixture | 1 passed | [reduced.log](./20260923-integration-r1/reduced.log) |
| Full fixture, one invocation | 1 passed | [full.log](./20260923-integration-r1/full.log) |

The report and its separate measurement table are generated from these logs by
`python3 examples/clique-03/report.py`. Its `--check` mode recomputes the ratios,
requires passing outcomes and compares both rendered files byte for byte; edited
or stale printed values fail. The census also binds the current schema digest.
The reduced fixture completes in 0.559 s.
Node 24.18.0 and Rust 1.97.0 were used. No engine counterexample was found by these
strengthened checks. The original cross-form admission blocker was already resolved
by `dced7a791`; this revision changes no engine semantics.

No commit, push, stash, LLP edit or `scripts/test.sh` invocation was made.
