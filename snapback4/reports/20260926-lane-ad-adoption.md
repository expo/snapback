# Lane AD: atomic view adoption with independent query readers

## Result and limits

On the corrected calibration #22 source populations, M7→M8 adoption falls from
**167,083 ms to 9,601 ms** (17.4×) in round 0. Its detached-query timer reported
less than 1 ms but did not prove the read overlapped the transaction. Round 1
measures **6,884 ms adoption and a 531 µs query inside the held transaction**.
Every physical row/index, log image and commit record compares exactly. The
approximately one-second end-to-end target is **not met**.

Query and sync readers use independent WAL connections while the existing atomic
writer builds the successor. They read the old program. Newly introduced queries
answer `loading: true, complete: false, data: null`. Generation guards remain in
force. Writes wait and execute once after publication; this is not an interleaved
chunked rebuild. `/changes` still waits because admitting a connection records a
durable presence reconnect. The full brief's all-reads availability claim is
therefore **not complete**. No authorization, disclosure, meter, log or durability
rule was relaxed to make it appear complete.

## Governing context

LLP 3000.019 §3.6 owns P10. LLP 3000.015 §3 owns pending row-view recounts.
LLP 3000.000#implementation-follow-up owns atomic candidate activation and
persisted identity guards. LLP 3000.007.003#3.2 owns historical captures: an
existing recorded path must never be re-resolved. LLP 3000.007#20.24.1 owns
metered stored-row admission; LLP 3000.015 §1–§2 own disclosure and bounded
authorization. The maintains guide is the current authoring surface.

The initial code already folds aggregates into a map and writes each group once.
The profile directs optimization at whole-store index replacement and validation,
not at replacing that fold or its event/sequence behavior.

## Reproduction and measurement conditions

From `snapback4/`, with Cargo on PATH:

```sh
CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 \
  SNAPBACK4_ADOPTION_SCALE=1 SNAPBACK4_ADOPTION_DETACHED=1 \
  cargo test -p snapback4-core --test adoption_scale -- --ignored --nocapture
```

Omit `SNAPBACK4_ADOPTION_DETACHED` to measure a read behind the engine mutex.
The ignored fixture compiles calibration #22's actual schema and windows module.
Its M7 removes only the six M8 views and `insights`, retaining trending and digest.
It builds 1,008 profiles, 5,921 follows, 48,224 originals, 2,004 replies, 5,008 likes,
1,004 reposts, 1,002 chats with two members each, and 99,105 messages. Twenty-three
followers of one prolific author reproduce Following materialization. Mapped rows
use real mutations; ordinary tables use engine seeds. All delivery work settles.
The result has **1,447,960 physical rows and 9,077,125 indexes** before M8.

This is a synthetic distribution at the requested populations, not the unavailable
original replay. It omits delivery receipts and unrelated identity/effect history.
The actual host reports `expose-builder-pixel`, 96 logical CPUs. Rust 1.97.0,
opt-level 1 tests, eight Cargo jobs, dev/test debug information disabled. `perf`
is absent. Timers include metering. Measured adoption reopens with the standard
SQLite cache and FULL durability. Fixture preparation alone uses a 128 MiB cache
and longer delivery slices with unchanged job meters. Seeding is intentionally
outside the timed adoption and can take substantial time.

The reusable fixture lives at `crates/snapback4-core/target/adoption-scale/`;
`SNAPBACK4_ADOPTION_DIR` overrides it. A ready marker follows the checkpoint.
`SNAPBACK4_RESUME_SEED=1` is only for a completed source import whose delivery
settling was interrupted. Never use it for a partly imported source population.

Legacy measurements used the instrumented pre-optimization core at `5563a56c8`
with the corrected fixture. A separately copied test executable was built from
that source, after which the optimized working sources were restored. Both runs
copy the same prepared M7 database. To compare preserved M8 copies:

```sh
python3 scripts/compare-adoption.py legacy-m8.db optimized-m8.db
```

The ordinary unit oracle also forces the full predecessor-free activation path
against the same in-memory fixtures; it does not depend on a historical checkout.

## Corrected measurements

| Cost | Legacy ms | Optimized ms |
|---|---:|---:|
| Preflight: identity, successor, old-key validation | 2,958.055 | 3,008.926 |
| Projection/index rebuild | 141,201.322 | 476.216 |
| Derived work, including capture | 2,873.073 | 2,801.141 |
| Reference capture, included above | 2,186.869 | 2,120.956 |
| Final validation | 12,880.452 | 473.078 |
| Generation metadata | see raw log | 1.761 |
| Commit/checkpoint | 7,166.407 | 2,837.892 |
| Whole adoption | 167,083 | 9,601 |
| Concurrent read (round-0 overlap unasserted) | 167,084 | <1 |

| Rebuilt view | Source rows visited | Optimized ms |
|---|---:|---:|
| dailyLikes | 5,008 | 12.640 |
| dailyPosts | 50,228 | 224.124 |
| originalTotals | 50,228 | 218.796 |
| receivedLikes | 5,008 | 12.151 |
| receivedReplies | 50,228 | 208.973 |
| receivedReposts | 1,004 | 2.807 |

Per-row expression evaluation, selection and meter charges are included in those
fold times: roughly 679 ms together. Reference hops are captured separately once
per source/path, preserving historical facts. SQLite index deletion/reinsertion
and statement preparation dominate the legacy run. The fix avoids unrelated
entries and caches insert statements. Final view rows and log images were already
written once per group, with one activation commit and no per-increment commit.
This timer profile does not claim instruction-level metering costs or an exact
SQLite statement count. Capture/preflight/durable publication remain the next
performance costs, rather than aggregate arithmetic.

An initial measurement accidentally removed unrelated trending/digest operations
from M7 too. It had 8,863,718 indexes, triggered an additional unread rebuild, and
measured 171,946 ms legacy / 13,091 ms optimized. Its logs remain explicitly marked
`initial` (the original `baseline.log` also belongs to it). That measurement was
recorded in the journal before optimization. The corrected measurements above
supersede it for the requested delta; neither the error nor old record was erased.

## File-by-file implementation

Core paths below are relative to `crates/snapback4-core/`:

- `src/store/adoption_report.rs`: completed activation phase and per-view timers.
- `src/store.rs`: retained successful report, activation plan and test modules;
  test-only full-path oracle switch, initialized on every Store construction.
- `src/store/activation.rs`: predecessor-aware projection/index/validation work,
  cached SQLite inserts, unchanged atomic publication and invariant checks.
- `src/store/activation_plan.rs`: reuse only equal table interpretations and
  unchanged index dependencies, including defaults, recorded/maintained fields,
  calendar/word/contribution keys and through lifetimes. Device install stays on
  the existing full path.
- `src/engine/runner.rs`: SQLite-only source-row instrumentation.
- `src/engine/maintains.rs`: report wrapper around the original rebuild; counts
  scanned source visits without extra queries or meter charges.
- `src/engine/row_views.rs`: counts actual row-keyed source visits for reporting.
- `src/engine/mod.rs`: activation and capture timer plumbing.
- `src/engine/recorded.rs`: report propagation through recorded-fact rebuilds.
- `src/engine/column_activation.rs`: report private maintained column rebuilds.
- `src/store/adoption_tests.rs`: full-path equivalence and index preservation tests.
- `tests/adoption_scale.rs`: opt-in M7/M8 scale fixture and concurrent-read timer.

CLI paths below are relative to `crates/snapback4/`:

- `src/serve_readers.rs`: independent reader factory, native/generation epochs,
  candidate query pending state, private temporary WAL store guard.
- `src/serve.rs`: detached authentication/query/head reads, new-query pending
  responses, startup report, fresh-store construction/banner.
- `src/serve_adoption.rs`: candidate begin/finish/publication, per-view adopted line.
- `src/serve_sync.rs`: snapshot and stream checkout without the writer mutex.
- `src/serve_lock.rs`: test-only queued-writer witness.
- `src/serve_tests.rs`: file-backed test hosts initialize the independent factory.
- `tests/serve_adoption/mod.rs`: includes the new regressions.
- `tests/serve_adoption/reads.rs`: held-adoption read/write/sync and crash tests.
- `tests/replay.rs`: updates the deliberate `--fresh` banner change.
- `tests/serve_sync/mod.rs`: manual test adoption now publishes the reader factory
  as production adoption does; all generation/error expectations stay unchanged.

Other paths:

- `crates/snapback4-lang/src/guide/maintains.md`: describes old-generation reads,
  pending new queries and queued writes; lead paragraph and syntax unchanged.
- `packages/snapback4/CLIENT-AND-OPERATIONS.md`: documents temporary WAL fresh mode.
- `scripts/compare-adoption.py`: streaming, exact full-store comparison.
- `../llp/3000.019-what-the-builder-still-wrote.rfc.md`: P10 design, measurement,
  correction, evidence and limitations at §3.6; §3.5 remains reserved.
- `../llp/3000.015-shared-baseline-for-snapback5.spec.md`: retains atomic adoption,
  clarifies independent old-generation reads, updates Revised.
- `../issues/20260926-snapback4-adoption-stalls-reads.md`: supplied ticket, first commit.
- `JOURNAL.md`: one appended dated entry, extended with final evidence.
- `reports/20260926-lane-ad-adoption.md`: this report. Raw measurement/check outputs
  are now under ignored `target/lane-ad-evidence/` (round 1 cleanup).

## Forms that compile and run

No syntax or lowering changed. The scale fixture compiles and adopts all six:

```quarry
view originalTotals: count posts where .parent = null by .author
view receivedLikes: count likes by .post.author
view receivedReposts: count reposts by .post.author
view receivedReplies: count posts where .parent != null by .parent.author
view dailyPosts: count posts where .parent = null by .author, day(.at)
view dailyLikes: count likes by .post.author, day(.at)
```

The HTTP witness adds `view totals: count items by .owner` and
`query total(): return totals[viewer]` (with an indented return in source): it is
pending during adoption, complete afterward, and equals two after a queued write.
The same request id returns the same sequence and leaves the total at two.

## Tests and equivalence

- `optimized_activation_equals_full_rows_indexes_log_images_and_sequence`:
  compares every `r`, `i`, `_log`, `_commits` entry and sequence for added/redefined
  views/indexes, calendar grouping, signed sums, null/dangling references, and
  source/target changes retaining historical captures.
- `an_added_view_does_not_touch_an_unrelated_index`: SQLite triggers abort on
  unrelated index modification; adoption succeeds without touching it.
- `changed_defaults_rebuild_unique_and_word_keys_from_legacy_absent_fields`:
  legacy missing fields adopt new literal defaults, preserving full-path unique
  and word index behavior, including querying the new word.
- `adoption_keeps_queries_and_sync_readable_and_serializes_writes_once`: blocks a
  real SQLite activation insert while holding the writer. In dev and release,
  bearer-authenticated unrelated/point queries and authorized sync finish in
  under two seconds; another owner's row stays hidden. New total is pending.
  A queued-write witness proves its request is waiting before build release;
  queries still finish, and the write/replay contributes exactly once.
- `process_exit_during_build_retains_the_old_generation_and_restart_rebuilds`:
  child exits 77 inside activation. Reopen retains old generation/sequence and
  no partial new view. Adopting again produces the complete correct total.
- `crash_during_adoption_child`: ignored subprocess helper for the preceding test.
- `a_write_queued_behind_adoption_does_not_keep_expired_authority`: expires a
  bearer session while its write waits behind the writer; the request returns
  E_AUTH and writes no row. Only read endpoints use detached authentication.
- `fresh_storage_has_independent_readers_and_is_removed_by_its_owner`: fresh
  storage supports another reader and its owner removes the temporary file.
- `m7_to_m8`: ignored scale fixture; runtime timings and per-view rows above.

Corrected scale comparison: 1,447,966 rows, 9,077,137 index entries, 1,973,177 log
entries, 316,734 commit records, **all exact**. See
`target/lane-ad-evidence/20260926-lane-ad-equivalence-repro.log` and the
reproducible comparator output. Generation timestamps are intentionally outside
that physical/log comparison; device-visible sequence and all images are inside.

## Decisions, deviations and open reproductions

1. **Nine-second adoption:** run the opt-in fixture above. The roughly one-second
   target remains unmet, despite sub-second grouped folds. No certificate claim
   or cap/budget increase is made.
2. **WAL readers instead of chunks:** the brief permits old-program reads. This
   approach preserves exact existing images and sequence in one durable commit.
   Writes queue rather than commit during build. There is no partial maintained
   table on a server/device; existing row-keyed recount logic remains unchanged.
3. **`/changes` still waits:** hold adoption using the SQLite authorizer hook in
   the HTTP regression, then issue authenticated `GET /changes?since=0&wait=0`.
   It waits at `presence_reconnected`. I stopped short of acknowledging that
   durable write asynchronously: with a pending presence-loss effect, a reconnect
   acknowledged only in memory followed by a crash can leave the old durable loss
   candidate eligible and send a notification despite the acknowledged reconnect.
   Durable-write endpoints still serialize. The all-read endpoint claim needs
   further design/work; this is not a claim that correct chunking is impossible.
4. **Fresh storage:** `--fresh`/`--memory` still start empty and never reopen a
   prior run, but now use a private disposable WAL file to support readers. The
   banner and its pinned test deliberately change. Orderly exit removes it;
   force-kill can leave its private directory for OS cleanup. Reproduce with
   `snapback4 dev --fresh`, locate its `snapback4-fresh-*` temp directory, then
   SIGKILL. No automatic cleanup of other processes' directories is attempted.
5. **Environment/fixture differences:** actual host name and synthetic distribution
   are stated above. Timers substitute for unavailable perf. The initial M7
   extraction error was corrected and both paths rerun.
6. **Wasm budget:** pristine lane base is 2,025,652 B raw / 582,552 B gzip;
   the full suite built 582,553 B gzip; after final source instrumentation fixes,
   the rebuilt artifact is 2,025,652 B raw / **582,551 B gzip**, **−1 B**, **457 B over**
   the unchanged 582,094 B budget. The inherited excess is 458 B. Reproduce with
   `bash scripts/build-wasm.sh` under Rust 1.97.0 / wasm-bindgen 0.2.127, no wasm-opt.
   Baseline source was temporarily restored for an actual build, then restored
   to the implementation. No budget increase or wasm-size pass is claimed.

## Validation record

Before the full run: core activation tests 3/3; HTTP adoption module 9 passed,
1 ignored; whole guide 86/86. Package installation used the frozen lockfile.
Reference check: `ref-check: ok — 513 LLP docs, 9495 refs in 26963 files, 0 errors,
0 unchecked` (final audit scans 26,965 files with the same reference counts).
No diagnostic added, so no new CODES/why entry is needed.

The full run's Rust group reports 3,665 passed, 3 failed, 21 ignored. All three
failures are **mine**, corrected afterward:

- `serve::tests::sync_generation_tests::failed_materialization_is_not_counted_and_unreadable_head_fails_discovery`:
  the new identity lookup masked the original storage error. It now returns that
  actual error, retaining the expected `no such table: _commits` detail.
- `serve::tests::sync_generation_tests::stale_generation_reader_snapshot` and
  `stale_generation_reader_stream`: their manual engine adoption bypassed the
  reader-factory publication performed by the real watcher. The fixture now
  performs that publication; no generation/authorization assertions changed.

Post-fix CLI unit tests: **116 passed, 0 failed, 1 ignored**, including the new
expired-authority queued-write test. Core equivalence **3/3**; row-view accounting,
legacy and witness targets **10/10**; replay integration **15/15**. The latter
updates only the deliberately changed fresh-mode banner expectation. Final wasm
was rebuilt after the instrumentation cleanup: its remaining overrun is inherited.
The only full suite was not rerun after these scoped corrections.

Required `scripts/test.sh`, run once unmodified with eight Cargo jobs and
dev/test debug information disabled, ends exactly:

```text
== 2 failure(s) in 1389 s
   wasm build
   cargo test
```

Exit status **1**. Failure classification:

- **Baseline — wasm build:** that full run measured 582,553 B gzip / 459 B over;
  pristine baseline is already 582,552 B / 458 B over. Final rebuilt source is
  582,551 B / 457 B over. The budget remains 582,094 B; this gate is still red.
- **Mine, fixed — cargo test:** exactly the three sync regressions named above;
  all pass in the final CLI run (116 passed, 1 ignored).
- **Environmental:** no failure classified as environmental.

Client main batch: **2,377 passed, 10 skipped**; all seven separate client shards
passed. Client models: **78/78**. Whole guide: **86/86**. Cargo build, docs budget,
release guard, package typecheck/build, chat check/typecheck, Expo typecheck and
fixture wrapper tests passed. Final production binary build and package build
also passed after the scoped corrections. No changed source exceeds 1,500 lines
(the largest is serve_tests.rs at 1,497); `git diff --check` passes.
Full output (line endings/trailing whitespace normalized):
`target/lane-ad-evidence/20260926-lane-ad-test-sh.log`. All raw logs cited
above are now under `target/lane-ad-evidence/` with the same filenames;
unprefixed names use `20260926-lane-ad-` there. The suite result is retained as red; the scoped reruns do not turn it
into a claimed clean full-suite run.

Implementation commits: `5429a3d1f` (ticket), `5563a56c8` (baseline instrumentation),
`2e00cef93` (physical reuse), `46bf41d23` (read availability). The final evidence
commit adds this report, logs and the completed journal entry. All carry the
requested Co-Authored-By trailer.
No push, publication or external message. No subagent or review approval claimed.

## Round 1 — 2026-09-26

Read the lane prompt, this round-0 report, and both complete blind reviews.
All changes below answer the eight round-1 findings. No push or publication.
Raw logs, including all 18 former `reports/20260926-lane-ad-*.log` files, now live
in ignored `snapback4/target/lane-ad-evidence/`; paths below are relative to it.
The report retains the measurements, commands and failure classifications.

### 1. Detached sync and the native Following failure

Located `packages/snapback4/test/following-unfollow.test.mjs`, specifically
`Following unfollow/repost repeats in one native session`. Eight concurrent
Node/server/native-device test processes reproduced the unfixed comparison in
**51/64 runs**, in 31.63 seconds (host load 12.18 at completion). The failure
is an unequal-cut comparison, not a skipped row or an advanced sync cursor.

Thirteen of sixteen instrumented runs reproduced it. In the `random-25` trace,
the device watermark was **70**, the completed page's watermark and `images_at`
were **70**, and the online query was at **71**. The sync request began four
milliseconds before the explicit `client.sync()` call. That call joined the
already-running round (`src/local.ts::syncOnce`); a subsequent sync returned the
missing row. Every instrumented failed comparison matched after that subsequent
sync. Some traces include a newer background response still being applied;
none shows the device passing the missing delivery's sequence.

Code evidence: `Store::read_transaction` pins identity before page reads;
`Engine::{snapshot_acquisition_page_at,stream_at}` supplies one transaction to
`partition::{snapshot_page,stream}`. First-page watermark, stream watermark,
`images_at`, membership/log reads and row images use that transaction. Snapshot
continuations retain the first watermark so subsequent streaming catches
inserts that sort before the cursor. `/sync`'s earlier `read_head()` contributes
only store identity, not the delivered position. Later acknowledgment lookups
are bounded by the page's watermark/image head. No production sync change was
necessary.

- `tests/serve_sync/concurrent.rs`: 16 snapshot and 16 stream cases hold an
  actual WAL snapshot with a SQLite authorizer, commit a row through HTTP,
  then prove the old response retains its earlier position and acknowledges
  no later write. Snapshot pages continue across the concurrent insertion;
  the next stream contains the row and its acknowledgment.
- `tests/serve_sync/mod.rs`: includes that regression.
- `packages/snapback4/test/following-unfollow.test.mjs`: waits for the online
  query's sequence before comparing replica rows; still fails if a row is
  absent at that position. Also forces a sync response captured before a
  concurrent remote post and its delivery.
- **64/64 revised runs on both hosts = 128 passed cases**, eight processes
  concurrently, 87.64 seconds (host load 19.02 at completion). These stress
  runs used the round-0 production executable, isolating the harness fix.
  The final full suite uses the rebuilt round-1 executable.
- All **7 sync tests passed**. Replacing a snapshot response's watermark with
  `reader.seq()` after materialization makes the concurrent regression fail
  immediately (reports 3 while its snapshot was at 2).

Evidence: `r1-following-before-*.log`, `r1-following-trace-*.log`,
`following-trace.mjs.txt` (temporary instrumentation retained as text),
`r1-following-after-*.log`, `r1-sync-all.log`, `r1-sync-watermark-mutant.log`.
Reproduce the client case with
`node --test packages/snapback4/test/following-unfollow.test.mjs`; the recorded
stress runs invoked it 64 times with eight concurrent subprocesses.

### 2–6. Validation, admission, transaction timing, authority and cleanup

- `core/src/store/activation.rs`: rebuilt maintained targets run unchanged
  uniqueness and cap validations as well as row validation.
  `core/src/store/adoption_tests.rs` pairs optimized and full paths for both
  an unchanged unique `value` index and a cap of one row per `value`. The
  review's predicate removal would produce 2 and 2; both paths reject and
  retain totals 1 and 2, generation, sequence, every row/index/log/commit and
  generation record. Removing either validation fails its paired test.
- `snapback4/src/serve.rs`: the supervisor's `d15d5110a` supersedes the lane's
  initial split: writer requests have a separate 32 slots and short requests
  retain 32. `saturation.rs` submits 32 mutations while the writer is held,
  proves excess mutations are bounded,
  and obtains real query and sync responses within two seconds while the
  admitted mutations still wait. Routing mutations back into `Short` makes
  the query get EOF and fails the regression.
- `core/tests/adoption_scale.rs`: signals from the SQLite authorizer after
  `BEGIN IMMEDIATE`, holds that callback until the detached query finishes,
  asserts it remains inside adoption and takes less than two seconds, and
  reports microseconds plus the injected hold. `core/Cargo.toml` enables
  SQLite authorizer hooks for tests only. The former 0 ms measurement had no
  such proof; the corrected measurements are below.
- `snapback4/src/serve.rs`: resolves the bearer on the executing store under
  **both** locks, before replay and before mutation, returning HTTP 401 / E_AUTH
  if expired or revoked. `authority.rs` drives requests past successful initial
  authentication, holds the later lock through adoption, and expires/revokes
  the session there. Six cases cover replay, idless execution, and fresh-id
  execution after replay misses. Removing either check fails the regression.
  `serve_tests.rs` supplies its test-only lock-gap hook.
- `tests/serve_adoption/failure.rs`: publishes a candidate, holds and then denies
  an activation index write, checks pending and old-generation reads while held,
  then verifies rollback, an old query, E_OP rather than indefinite pending for
  the rejected name, and a successful later adoption. Deleting
  `finish_adoption`'s `candidate_queries.clear()` now fails. Shipping cleanup
  was already correct; no production cleanup change was needed.
- `tests/serve_adoption/mod.rs` wires the regressions; `reads.rs` exposes its two
  existing fixture strings to them. No source exceeds 1,500 lines.

Targeted results: core adoption **5/5**, canonical CLI **120 passed, 2 ignored**,
legacy-key/row tests **8/8**, device legacy-key upgrade **5/5**, whole
compiled guide **86/86**. See `r1-core-final.log`, `r1-http-canonical.log`,
`r1-legacy-keys.log`, `r1-device-keys.log`, `r1-guide.log` and the six
`r1-mutant-*.log` files. Mutants were restored before qualification.

A preliminary CLI run at Cargo's default 96-thread parallelism had five
**environmental** failures: saturation, foreign-origin/rebound-host rejection,
route dev exception, saturated legacy waits, and maximum route names. Its
1,024-descriptor soft limit was exhausted (`EMFILE` in tiny_http); resulting
socket resets/EOF/timeouts caused the assertions. The canonical runner already
uses one CLI test thread. That exact concurrency passed all 120 tests without
raising an engine budget. The two ignored cases are the crash subprocess helper
and opt-in HTTP scale witness; both were exercised separately. The full suite
result below remains independent of these preliminary checks.

### 7. Adoption cost and the remaining /changes wait

Schema equality alone cannot prove legacy physical keys satisfy today's bound.
`store/activation.rs` now persists a successful key validation bound against the
activation hash, checks **every** newly generated key, and reuses the matching
predecessor proof. Missing/stale proof still scans; device installs always scan.
The proof and all changes commit together. Tests deny any index read during a
program-only adoption, reject newly built oversized ordinary keys, and inject
legacy keys with absent and obsolete proofs to verify refusal and rollback.
This also closes the prerequisite hole where ordinary activation keys were
unchecked even though contribution keys were checked.

`engine/recorded.rs` still captures each new path once per source and persists
nulls. It computes old/new keys only for indexes depending on newly captured
fields. Existing captures are never re-resolved; source visits, validation,
metering, log images and commit order remain intact. Capture falls by about
1.43 seconds. Mandatory new historical facts are still stored atomically.

Corrected fixture: **1,447,960 rows / 9,077,125 index entries** before adoption.
All measurements use test-profile opt-level 1, eight Cargo jobs, dev/test debug
information disabled, standard SQLite cache and FULL durability. Same host and
synthetic population limitations as round 0. The preflight phase was broader
than just the old-key scan; approximately 1.76 seconds of other preflight work
remains after eliminating that scan.

| Cost | Before round-1 optimization | Final round-1 run |
|---|---:|---:|
| Key check + remaining preflight | 3,023.356 ms | 0.095 + 1,762.355 ms |
| Projection/index work | 484.386 ms | 462.765 ms |
| Capture | 2,195.651 ms | 762.264 ms |
| Derived, including capture | 2,891.503 ms | 1,430.361 ms |
| Final validation | 475.201 ms | 459.450 ms |
| Metadata | 2.790 ms | 1.844 ms |
| Commit/checkpoint | 2,360.001 ms | 2,765.481 ms |
| Adoption | **9,239 ms** | **6,884 ms** |
| Query, proved inside transaction | **502 µs** | **531 µs** |
| Injected authorizer hold | 525 µs | 574 µs |

An earlier optimized run was **6,377 ms / 510 µs**. Final folds: dailyLikes
12.436 ms / 5,008 visits; dailyPosts 220.259 ms / 50,228; originalTotals
215.310 ms / 50,228; receivedLikes 11.866 ms / 5,008; receivedReplies
204.718 ms / 50,228; receivedReposts 2.802 ms / 1,004. A writer-locked control
waited **6,735.460 ms** for a **6,737 ms** adoption. The one-second adoption
target remains unmet; these measurements do not establish a constant bound.

The opt-in real HTTP witness (`tests/serve_adoption/scale.rs`) measured:

| HTTP measurement | Optimizations disabled | Round 1 |
|---|---:|---:|
| Adoption | 9,709 ms | 6,299 ms |
| Signed-in `/changes?since=0&wait=0` | **9,710 ms** | **6,302 ms** |
| Query while adoption held | 4.344 ms | 5.607 ms |
| Sync while adoption held | 10.685 ms | 9.573 ms |

LLP 3000.019 §3.6, the maintains guide and `CLIENT-AND-OPERATIONS.md` now limit
availability to query/sync snapshot reads and explicitly state `/changes`'s
whole-adoption wait. `issues/20260926-snapback4-changes-waits-for-adoption.md`
tracks bounded durable writer access, with the reproduction and crash constraint:
acknowledging only in memory could leave an old presence-loss notification
eligible after a crash. No such acknowledgment or chunked rebuild was added.

The updated scale store still equals the retained legacy store exactly:
**1,447,966 rows, 9,077,137 indexes, 1,973,177 log entries, 316,734 commits**.
`r1-scale-equivalence.log` records all four matching SHA-256 digests.

Reproduce from `snapback4/`, with `$HOME/.local/bin` and `$HOME/.cargo/bin` on PATH:

```sh
CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 \
  SNAPBACK4_ADOPTION_SCALE=1 SNAPBACK4_ADOPTION_DETACHED=1 \
  cargo test -p snapback4-core --test adoption_scale -- --ignored --nocapture

CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 \
  SNAPBACK4_ADOPTION_HTTP_DB="$PWD/crates/snapback4-core/target/adoption-scale/m7.db" \
  cargo test -p snapback4 --bin snapback4 scale_changes_waits -- --ignored --nocapture

python3 scripts/compare-adoption.py \
  crates/snapback4-core/target/adoption-scale/baseline-corrected-m8.db \
  crates/snapback4-core/target/adoption-scale/adopt.db
```

No Quarry syntax changed. All six view forms listed in the round-0 section
still compile and run; `view totals: count items by .owner` and `query total()`
reading `totals[viewer]` remain the HTTP availability example. No meter,
wasm-size budget, authorization or durability rule was relaxed.

### Round-1 full-suite result

Ran **once**, after the implementation commits, from `snapback4/`:

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
bash scripts/test.sh > target/lane-ad-evidence/r1-test-sh.log 2>&1
```

Exact summary, **exit status 1**:

```text
== 1 failure(s) in 988 s
   wasm build
```

The sole failure is **baseline — wasm build**: **2,025,652 B raw / 582,551 B
gzip**, against the unchanged **582,094 B** budget (**457 B over**). This is
identical to round 0's final artifact (**round-1 delta: 0 B**), and one gzip byte
smaller than the pristine lane baseline measured in round 0. Reproduce with
`bash scripts/build-wasm.sh`. No budget increase or clean full-suite claim.
There are **no introduced or environmental failures in this final run**.

- Rust workspace tests and doctests: **3,675 passed, 0 failed, 22 ignored**;
  cargo-test phase **501 s**. CLI **120 passed, 2 ignored**; whole guide **86/86**.
- Client main batch: **2,377 passed, 10 skipped**. Seven separate client shards:
  **56 passed**. Client phase **194 s**.
- Seeded client models: **78/78**, **254 s**, including both 5,000-sequence
  session models. Fixture wrapper tests: **9/9**.
- Cargo build, docs budget, release guard, package typecheck/build, chat check
  and typecheck, and Expo typecheck all passed.
- **No sync or Following failure.** The concurrent detached-sync regression
  and both generation cases pass. The native and wasm unfollow/repost cases
  pass against the rebuilt round-1 server (3,030 ms and 4,215 ms respectively).
  The separately reproduced round-0 Following comparison remains attributed
  to joining an older sync round and comparing it with a newer server sequence,
  as traced above; no row was skipped past a reported device watermark.

Raw output and exit status are retained in ignored
`target/lane-ad-evidence/r1-test-sh.log` and `r1-test-sh.exit`. The final reference
audit reports **513 LLP docs, 9,500 refs in 26,971 files, 0 errors, 0 unchecked**
(`r1-ref-check-final.log`). `git diff --check` passes; no changed source exceeds
1,500 lines. The fixture-generated, unrelated native Cargo.lock version change
was restored after the run.

Round-1 implementation commits: `695f22867` (snapshot proof and Following
comparison), `9c6cc53c1` (validation and performance), `1e90a1179` (admission,
authority and HTTP regressions), `98f3c9fd2` (documentation and raw-log removal).
The final evidence commit completes this report and the same dated journal
entry. Every commit carries the requested Co-Authored-By trailer. No push or
publication.
