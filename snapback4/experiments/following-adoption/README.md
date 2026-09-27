# Following adoption research (lane FA)

Proposal: [LLP 3000.026](../../../llp/3000.026-following-over-a-populated-store.rfc.md).
Base: `f39598de7febb1f3ddea45ae350b79e0bec50104`, branch
`sb4-intent/fa-following-adoption`, Snapback 4 version 0.4.4. No production
adoption path is enabled. No production source, version, authority, meter,
client or device format changes are included.

## What this prototype answers

The [Rust probe](../../crates/snapback4-lang/tests/following_adoption_research.rs)
and [Quarry fixture](./probe.q) establish:

- Identical current sources can imply 1,001 early-follow copies or 1,000
  late-follow copies. Historical reconstruction is underdetermined.
- Identical visible repost rows can have different engine event ids. Current
  declaration-specific engine slots retain those ids, contrary to an unqualified
  reading of the diagnostic; a new declaration has no such slot.
- A retained repost survives its original's removal, but replaying the ordinary
  repost operation after removal refuses. An adopter must initialize that event
  directly, after checking the retained card.
- The planned query in the fixture works on populated sources. With one wanted
  old event behind 9,000 unrelated newer events it is unavailable, with
  `complete=false`, `next=null`, and a heap cut after 5,764 examinations and
  2,882 rule probes. The meter charged 16,778,202 heap bytes against 16,777,216.
  The test asserts this is not a complete empty feed. Raising the meter is not
  proposed.
- A device that missed retirement can preserve a same-named feed beside an
  unrelated literal-default addition: the actual image-preservation predicate
  returns true. A fresh Following namespace adds new slots and returns false.
- Real metered engine writes plus the durable delivery worker can construct
  fresh-follow contents from a frozen source set while detached readers run.
  Candidate read completeness is held false by the **test facade**, including
  before any backfill work for that reader exists.
- The source batch and private progress row commit in one engine mutation. A
  child process calls `process::exit(73)` after a committed two-post batch,
  without dropping the engine or connection. The parent reopens and verifies
  both events and cursor, then writes the next batch without duplicates. The
  benchmark additionally closes/reopens once after 1,000 input batches.

The probe is about 700 lines including formatting, timing, allocation accounting,
fixtures and assertions. It does not add a product API. The benchmark is
explicitly ignored in ordinary test runs; the crash child is invoked only by
its parent test.

## Measurement method and limits

Host: expo-build-1000, Linux x86_64, shared 96-core machine. Rust/Cargo 1.97.0.
Final measurements use the repository's `release` profile, opt-level 3, without
production LTO or the publication-specific `LIBSQLITE3_FLAGS` override.
Only one measurement ran at a time. Brief compilations and counterexample
runs overlapped the 10× run on this shared host. The measured executable SHA-256 was
`efbc0dde4f27b9e5f4c3c12a3933fcbe489af2f40f02a353392ce46f21736a5d`.
Host load varied during the work; these
are single samples, not an isolated-host percentile qualification.

1. Seed a real retained-source SQLite store **without** Following in batches of
   256 rows. This setup is outside the construction timer. No application writes
   change it afterward.
2. Create a separate candidate store with the Following declaration. Replay
   frozen source rows, originals then reposts then follows, through actual
   `Engine::mutate` calls under system authority in this test fixture. Source
   input fetches use a bounded 32-row SQL cursor; this fetch is not an implemented
   metered adoption scanner. All candidate transitions keep the ordinary
   mutation meter. Public/owner rules in the fixture remain unchanged.
3. Copy original batches of at most 32 with equal actor/time, each with its
   checkpoint; copy each repost/follow with its checkpoint. Repost event ids
   hash `(Following name, adoption id, role, source id)` using the existing
   framed `owned_id` primitive. A separate private progress table is the probe's
   checkpoint, not an application-authoring recommendation.
4. Run `Engine::run_timeline_chunk` with its normal job ceilings and 1 ms
   cooperative slice until no pending or parked work remains. This includes
   redundant delivery walks that discover all these follows are newer than the
   imported births; a dedicated adopter could initialize those birth records
   directly as `done`.
5. During construction, a reader thread repeatedly runs the same useful 32-row source
   export and a 20-row candidate Following query, using detached connections,
   then sleeps 10 ms. Source reads assert 32 available rows. Candidate reads
   include the progress check used to force `complete=false`. Their latency
   includes the core query and that check, not HTTP, authentication, queued
   writers or device acquisition. The candidate connection reads the same WAL
   database the worker writes; the source read uses the separate predecessor.
6. Measure wall time from start of replay to durable completion; sum reported
   `Metered.rows_written` for construction and work; track live/peak Rust
   allocation sizes with a counting global allocator; collect process peak RSS
   with `/usr/bin/time -v`. Rust heap includes the timing vectors and reader
   allocations, but **excludes SQLite's C allocator**. The reported maximum
   chunk heap is the returned `Metered.heap_bytes`, not an instrumented
   `Meter.heap_peak`. RSS includes source seeding. SQLite file/index/log sizes
   are queried after the timer.

The fixture contains exactly 48,000 original posts, 1,000 reposts, 6,000 follows
and 1,008 distinct principals, with 200-byte bodies. 10× multiplies **all four**
counts, including principals; it is not 10× events on the same graph. Posts and
follows are spread nearly uniformly; posts of an actor tie in time. Profiles,
replies, removals, assets, unrelated app tables and concurrent writes are absent.
Every actor has fewer than 1,000 events. The cutoff is exercised separately by
the 1,001-event test. Expected final copy totals are independently calculated
from the seed arithmetic and asserted, as are event/edge counts and zero work
remaining. This is not calibration #22's complete fixture or hot-author skew.

The proposed staged catalog swap, persistent application-writer admission
fence, special retained-removed-original importer, metered source scanner,
HTTP pending names, identity/presence turns, early publication, the shared
frozen launch roster and its worker, and device publication are **not**
implemented here. The proposal releases its writer fence after initialization
and fills foreign copies afterward. The probe freezes sources through all
copies and uses ordinary follow previews; its full time is **not** the proposed
initialization write pause. Staging sources in a second store also copies source data and
logs more than the proposed private staging catalog would. Consequently these
numbers are neither an upper nor a lower bound for fully integrated adoption.
They measure its dominant existing copy machinery and demonstrate overlapping
reads, not the whole availability claim.

Two recorder corrections were made after the samples started, without changing
source replay or delivery: realloc now adjusts the allocation counter with one
atomic delta, and the facade samples the monotone completion state **before**
its page so a later completion cannot certify an earlier page. The checked-in
Rust heap figures are therefore **observed estimates**: the earlier counter
could miss transient overlap during concurrent realloc. RSS, row counts and
elapsed times do not depend on that counter. `pending_samples` is observational,
not a proof of atomic publication. The corrected facade has a separate test
for a reader whose edge has not yet been discovered. No integrated pending-query
protocol is claimed by either version.

## Results

Exact results: [1× JSON](./release-1x.json), [10× JSON](./release-10x.json),
with independent process accounting in [1× time](./release-1x-time.txt) and
[10× time](./release-10x-time.txt).

| Measurement | 1× | 10× |
|---|---:|---:|
| Construction wall time, s | 127.834833 | 1,699.415901 |
| Post / repost / follow / delivery phases, s | 29.268 / 1.262 / 73.319 / 23.885 | 305.307 / 12.370 / 1,111.576 / 269.179 |
| Logical rows written | 557,886 | 5,579,689 |
| Final events / edges / retained birth records | 49,000 / 6,000 / 49,000 | 490,000 / 60,000 / 490,000 |
| Final inbox copies | 340,697 | 3,407,033 |
| Observed Rust peak, bytes (estimate) | 1,369,135 | 5,011,816 |
| Process peak RSS, KiB | 17,664 | 21,504 |
| Max returned chunk `heap_bytes` | 1,266,958 | 1,266,958 |
| Candidate reads, n | 11,182 | 145,210 |
| Candidate p50 / p95 / max, ms | 0.919 / 1.783 / 13.787 | 1.158 / 1.953 / 19.494 |
| Source p95 before / during, ms | 0.147 / 0.460 | 0.088 / 0.488 |
| Source max during, ms | 3.370 | 8.510 |
| Reopen, ms | 1.671 | 1.575 |
| Candidate SQLite file, bytes | 1,153,806,336 | 11,537,776,640 |

Heap includes growing timing vectors, explaining part of the 10× increase; it
is not all worker state. The full processes took 135.66 and 1,856.17 seconds,
including seeding and post-timer size queries. Construction excludes those
stages. At 10× the file holds about 5.098 GB of indexes and 2.200 GB of partition
logs; these are measurements of this replay implementation, not a proposed
storage entitlement. Reclaiming completed private staging data remains necessary.

The four research tests passed; the default invocation deliberately ignores
the child-process entry and expensive benchmark. The parent executed the child;
both benchmark sizes were run separately. See [counterexamples](./counterexamples.log).
The existing `timeline_background` (17 tests) and
`timeline_epoch_counterexample` (one test) also pass in release mode; see
[baseline validation](./baseline-following.log). No full suite was run.

The earlier exploratory test-profile 1× sample took 200.466 s, made 340,697
copies and wrote 557,892 logical rows. Its old-source read was intentionally
sparse and unavailable (p95 53.418 ms); it therefore does not establish useful
source-read availability. The final probe replaces that sensor with the
asserted 32-row export above. The earlier candidate p95 was 1.742 ms. Chunk
counts vary with cooperative time cuts; this accounts for extra cursor writes.
This preliminary sample is retained in `exploratory-test-profile.json`.

## Reproduce

From `snapback4/`, with the lane toolchain on PATH:

```sh
cargo test --release -p snapback4-lang --test following_adoption_research -- --nocapture
FA_SCALE=1 FA_DIR="$PWD/target/fa-research/new-1x" cargo test --release -p snapback4-lang --test following_adoption_research staged_replay_measurement -- --ignored --nocapture
FA_SCALE=10 FA_DIR="$PWD/target/fa-research/new-10x" cargo test --release -p snapback4-lang --test following_adoption_research staged_replay_measurement -- --ignored --nocapture
```

Use fresh `FA_DIR` paths; the probe refuses existing stores. To obtain RSS without
counting a compiler process, first compile with `--no-run`, then run the printed
test executable under `/usr/bin/time -v` with the same environment and test name.
The recorded executions used
`target/release/deps/following_adoption_research-cb50c8b5224247bc --exact staged_replay_measurement --ignored --nocapture`.
Database files and raw logs are ignored under `snapback4/target/fa-research/`.
No Bun/JavaScript tests or full Cargo suite were run for this isolated Rust probe.

Development-only setup errors were corrected before the final runs: an initial
command ran from the repository root (missing Ibex; no test executed); a method
name was corrected from `row_count` to `count`; using `probe.q` introduced an
operation namespace, so compilation now uses `schema.q`; `after` was a reserved
column spelling and became `lastKey`; the sparse-read assertion now accepts the
actual withheld `Null` result instead of assuming an empty array. None was an
engine behavior change. The setup logs remain in the ignored output directory.

## Orientation and evidence

The scoped `llp-orient` pack is LLP 3000 (root/current), LLP 3000.013 §4
(delivery/current), LLP 3000.014 §7 (implemented capture barrier), LLP 3000.016
§§2.1a–3 (device slots, acquisition and fixed history window), and LLP 3000.019
§3.6 (read availability/current). The proposal does not change the latter's
known `/changes` limitation by assertion. Likely implementation-time updates:
Following activation, the feeds card and `why` messages, plus the owner LLPs;
review handoff belongs to the supervisor.

Calibration #23 evidence was read from `/home/ccheever/sb4-intent/fa-evidence/`:

| File | SHA-256 |
|---|---|
| `schema.q` | `48539ea060d2700c28eb04da84e42cb7267e663ea3cd627308d84c347c6874f0` |
| `diary.md` | `67c886f40eec9dd4a084f4fbcfa5e933bfb23fcc67f9b838e5394a177b25192f` |
| `run-log.md` | `1a7675b3fe2ac3cfbb639a61ec3567ace52160adb75b4f591f332ebda0bf9a86` |

The builder's decision is at schema lines 90–98, diary line 13 and the M2
adoption entry at run-log line 22. The feeds card says declare first at lines
34 and 222, names the planned alternative without its program at 230 and 248,
and sends sparse reads back to Following at 255. The diagnostic string is in
`crates/snapback4-lang/src/guide/codes.rs:65`.
