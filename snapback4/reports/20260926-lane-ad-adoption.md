# Lane AD: atomic view adoption with independent query readers

## Result and limits

On the corrected calibration #22 source populations, M7→M8 adoption falls from
**167,083 ms to 9,601 ms** (17.4×) in round 0. Its detached-query timer reported
less than 1 ms but did not prove the read overlapped the transaction. Round 1
measures **6,884 ms adoption and a 531 µs query inside the held transaction**.
Round 2 measures **6,433 ms adoption and a 511 µs query inside the transaction**.
Every physical row/index, log image and commit record compares exactly. The
approximately one-second end-to-end target is **not met**.

Query and sync readers use independent WAL connections while the existing atomic
writer builds the successor. They read the old program. Newly introduced queries
answer `loading: true, complete: false, data: null`. Generation guards remain in
force. Writes wait and execute once after publication; this is not an interleaved
chunked rebuild. `/changes` still waits because admitting a connection records a
durable presence reconnect. The full brief's all-reads availability claim is
therefore **not complete**. The round-2 supervisor ruling accepts this documented,
ticketed `/changes` limitation for 0.4.4 and leaves bounded adoption to follow-up.
No authorization, disclosure, meter, log or durability rule was relaxed.

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


## Round 2 — 2026-09-26 (final round)

Read the lane prompt and both full round-1 reviews. Implemented only the five
requested corrections. The governing context remains LLP 3000.019 §3.6 (P10),
LLP 3000.000's atomic activation, LLP 3000.015's authorization and pending-read
constraints, and LLP 3000.017's ephemeral mutation envelope. The supervisor
accepts `/changes` waiting out adoption for 0.4.4; §3.6 now records that ruling
in one sentence and retains the existing follow-up ticket. No chunking, new
syntax, raised budget, push or publication.

### Files and behavior

Paths below are relative to `snapback4/`, except the LLP.

- `crates/snapback4/src/serve.rs`: admission defaults to the separate 32-slot
  writer class; only detached reads, metadata handlers and OPTIONS use the
  32-slot short class. The same `detached_request` predicate selects bearer
  authentication's reader, avoiding a list of writer routes to maintain. This
  covers all listed auth, effect settlement, upload and seed handlers, plus
  writer-dependent asset/effect GETs. Existing Wait/Route/Registry/Verifier
  budgets remain separate. The supervisor's 32 + 32 replaces the historical
  journal's 16 + 16; the report and LLP now give the actual budgets.
- `crates/snapback4/tests/serve_adoption/saturation.rs`: queues 32 requests and
  four overflow attempts separately for `/m/noop`, `/auth/guest`, effect done,
  failed, and step done. Each case proves admitted requests remain blocked on
  the writer while query/sync answer within two seconds. Overflow attempts
  get EOF; admitted requests finish after release. Effect cases use a live
  service credential and a nonexistent effect, then receive `E_EFFECT_UNKNOWN`
  after the writer resumes, proving they reached settlement's engine access.
- `crates/snapback4-core/src/store/activation.rs`: SQLite AFTER INSERT and
  AFTER UPDATE OF k triggers delete `index_keys_validated` if a physical key
  exceeds 2,048 bytes. Direct SQL cannot preserve the proof across such edits.
  Missing either guard invalidates the predecessor proof, installs guards,
  and requires the exhaustive scan in the activation transaction. Ordinary
  valid inserts only evaluate the trigger predicate; no metadata write.
- `crates/snapback4-core/src/store/adoption_tests.rs`: a regression leaves
  the matching proof untouched while inserting/updating a 3,000-byte key.
  Adoption refuses `E_INDEX_KEY_BYTES` and preserves rows, indexes, log,
  commits, generation and sequence. Four cases cover INSERT/UPDATE with
  guards and a legacy store missing both guards. Existing stale-proof and
  full-path equivalence tests remain intact.
- `crates/snapback4-core/tests/adoption_scale.rs`: opt-in trigger-cost
  instrumentation captures the keys actually inserted by the fixture's M8
  rebuild, then replays them with identical prepared INSERTs and alternating
  trigger-on/off samples, rolling back each sample. Normal scale runs do not
  enable the capture trigger or replay.
- `crates/snapback4/src/serve_adoption.rs`: extracted `adopt_candidate` from
  the watcher, preserving adoption, generation-reopen and rejection handling.
  `tests/serve_adoption/failure.rs` invokes that production path. It never
  calls `finish_adoption`; a rejected candidate must return `E_OP` instead
  of remaining pending, retain the old generation, and allow later adoption.
- `crates/snapback4/src/serve_ephemeral.rs`: re-resolves mutation authority
  under checkout's writer guard before `mutate_ephemeral`; its in-memory
  fallback also rechecks. `tests/serve_adoption/authority.rs` adds expiry
  and revocation for ephemeral writes beside the six durable cases, asserting
  the existing failed/E_AUTH envelope, unchanged ephemeral version, no new
  durable commit and no new durable row.
- `crates/snapback4/tests/serve_sync/concurrent.rs`: the 32 cases now alternate
  `aa-concurrent` and `zz-concurrent`, assert the first snapshot row actually
  is `z-before`, and prove continuation omits the insertion before that
  cursor while catch-up delivers it. The concrete fixture traverses byId
  descending: `zz` is before its cursor, `aa` after. This is now asserted,
  rather than inferred from the former comment.
- `../llp/3000.019-what-the-builder-still-wrote.rfc.md`: records the supervisor
  ruling, actual budgets, trigger invalidation and production failure/authority
  corrections; Revised updated. `JOURNAL.md`: one appended dated round-2 entry.
  This report records implementation and final evidence; raw logs remain ignored.

### Forms and regressions

No new Quarry form or diagnostic. The six view forms above still compile and
run. For example, `view originalTotals: count posts where .parent = null by
.author` adopts at scale. The HTTP fixture's `view totals: count items by .owner`
and query returning `totals[viewer]` remain pending during adoption, complete
once published. The ephemeral fixture runs `mutation typeNow(id: id)` with
`upsert typing[owner = viewer] {}` against a four-second ephemeral table; a
bearer expired/revoked while queued now receives `state: failed`, `why.code:
E_AUTH`. Saturated `POST /auth/guest` or `POST /effects/missing/done` leaves
`POST /q/who` and `POST /sync` available.

Affected verification, before the full suite:

- Core adoption **6/6**, including the four physical-edit subcases and
  full-path row/index/log/sequence equivalence.
- Canonical CLI **120 passed, 2 intentional ignores**. Final adoption subset
  **13 passed, 2 ignored**, after restoring mutation experiments; the ignored
  scale helper was run explicitly and the crash child is exercised by its test.
- Detached concurrent sync **32/32 inner cases**. Core rows/legacy keys **8/8**;
  device key-bound **3/3**; device legacy upgrade **5/5**; whole guide **86/86**.
- Removing production `finish_adoption()` makes the rejected-query assertion
  fail with `loading: true` instead of `E_OP` (`r2-failure-cleanup-mutant.log`).
  Removing the ephemeral checkout recheck makes the expired request return
  `state: sent` and mutate typing (`r2-ephemeral-authority-mutant.log`). Both
  deliberate mutants were restored before final verification.
- Two preliminary test-authoring failures were mine and fixed: the guest
  saturation fixture initially omitted `use identity`, and the new cursor
  assertion initially treated ascending order as the snapshot traversal.
  The fixture now enables identity and asserts the actual descending cursor.
  Neither was a product failure. No affected check has an unresolved failure.
- Frozen Bun installation passed on Node 24.13.1 / Bun 1.3.14. Rust/Cargo 1.97.0;
  eight build jobs, dev/test debug information disabled, opt-level 1 tests.
- Reference audit: **513 LLP docs, 9,503 refs, 0 errors, 0 unchecked** before
  the report/journal additions. No changed source exceeds 1,500 lines.

### Measurements

Same prepared M7 fixture: **1,447,960 rows / 9,077,125 indexes**. The ordinary
scale run has no trigger-cost capture instrumentation:

| Phase | Round-2 time |
|---|---:|
| Key proof/guard check | 0.126 ms |
| Remaining preflight | 1,815.659 ms |
| Projection/index work | 477.635 ms |
| Capture (included in derived work) | 780.767 ms |
| Derived work | 1,491.457 ms |
| Validation | 481.631 ms |
| Metadata | 1.798 ms |
| Commit/checkpoint | 2,163.745 ms |
| Whole adoption | **6,433 ms** |
| Detached query, proved inside transaction | **511 µs** |
| Injected transaction hold | 536 µs |

Per-view folds: dailyLikes 13.557 ms / 5,008 visits; dailyPosts 234.179 ms /
50,228; originalTotals 228.116 ms / 50,228; receivedLikes 13.039 ms / 5,008;
receivedReplies 218.062 ms / 50,228; receivedReposts 3.042 ms / 1,004.

The actual HTTP witness reports **6,653 ms adoption / 6,655 ms `/changes` wait**,
with query **4.512 ms** and sync **8.641 ms** while adoption is held. The
approximately one-second target remains unmet. No constant adoption bound is
claimed. The existing `/changes` ticket retains its crash/durability constraint.

**Trigger cost:** M8 inserts twelve index keys (the optimization preserves
unrelated indexes). Replaying those twelve keys 1,000 times per sample, with
identical deletion work in both variants and six alternating samples each,
gives medians **18.529296 ms off / 24.527470 ms on per 12,000 inserts**:
**499.8 ns extra per insert**, approximately **6.0 µs** for this rebuild's
actual twelve inserts. This isolates trigger cost; it is not a second
end-to-end adoption timing or a claim about every workload.

Streaming comparison to the retained legacy M8 store still matches every
**1,447,966 rows, 9,077,137 indexes, 1,973,177 log entries, and 316,734 commits**,
with the same four digests as round 1 (`r2-scale-equivalence.log`).

Reproduce the normal scale and HTTP witness with the round-1 commands above.
Add `SNAPBACK4_ADOPTION_KEY_GUARD_COST=1` only for the trigger-cost run. Raw
round-2 evidence is under `target/lane-ad-evidence/r2-*.log` (CLI, core,
rows, device keys/upgrade, guide, two mutants, scale, scale HTTP, scale
comparison and trigger cost).

### Deviations and open reproductions

No deviation from the round-2 scope. SQLite triggers implement option (a);
no chunking was added. Writer-dependent long polls retain their dedicated
Wait/Route/Registry/Verifier classes so they cannot occupy detached-read slots.

The two known release qualifications remain: adoption exceeds the one-second
target (run the scale command), and `/changes` waits for durable reconnect
admission (run the HTTP scale command). The latter ships under the supervisor's
explicit ruling and existing ticket. Historical `--fresh` force-kill cleanup
and synthetic-fixture limits above remain unchanged. The final suite below
records the wasm budget status and any new failure separately.

Implementation commits: `39b76c1b6` (writer admission), `888931efb` (physical
key proof and measurement), `bb9b8bce5` (failure cleanup, ephemeral authority,
explicit cursor coverage). Each carries `Co-Authored-By: GPT-6 Astra
<noreply@openai.com>`. Documentation/evidence is committed separately.


### Round-2 final full-suite result

Ran `scripts/test.sh` exactly once after the fixes, affected checks, restored
mutation experiments and scale runs. From `snapback4/`:

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
bash scripts/test.sh > target/lane-ad-evidence/r2-test-sh.log 2>&1
```

Exact final summary, **exit status 1**:

```text
== 1 failure(s) in 972 s
   wasm build
```

Every full-suite failure: **baseline — wasm build**, and no others. Artifact:
**2,025,652 B raw / 582,551 B gzip**, against the unchanged **582,094 B** cap,
**457 B over**. This is byte-for-byte the round-1 size (**round-2 delta: 0 B**).
Reproduce with `bash scripts/build-wasm.sh` on the stated toolchain. No budget
increase or clean-full-suite claim. **No introduced or environmental failure.**

- Rust workspace tests/doctests: **3,676 passed, 0 failed, 22 ignored**; **510 s**.
  CLI **120 passed, 2 ignored**. Whole guide **86/86**.
- Client main batch: **2,377 passed, 10 skipped**; seven shards **56 passed**;
  **195 s** total. Native and wasm unfollow/repost cases both passed against
  the rebuilt server (3,196.712 ms and 5,173.587 ms respectively).
- Client models: **78/78**, **254 s**, including both 5,000-sequence session
  models. Fixture wrapper tests **9/9**.
- Cargo build, docs budget, release guard, package typecheck/build, chat
  check/typecheck and Expo typecheck all passed.

The final reference audit reports **513 LLP docs, 9,503 refs in 26,971 files,
0 errors, 0 unchecked** (`r2-ref-check-final.log`). `git diff --check` passes;
the largest changed source is `serve.rs`, **1,345 lines**. The suite-generated
native fixture Cargo.lock version change was restored. Only the report and one
appended journal entry accompany the three implementation commits; all commits
carry the requested co-author trailer. Full log and exit status remain in
ignored `target/lane-ad-evidence/r2-test-sh.log` and `r2-test-sh.exit`.
No push or publication.

## Round 3 — 2026-09-27 (final review round)

Read the lane prompt, this report, and both round-2 reviews. Addressed only the
five requested findings. The `/changes` ruling stands. No push, publication,
new syntax, new diagnostic, budget increase, or adoption/chunking redesign.

Orientation used the existing LLP 3000.019 §3.6 query/sync design and LLP
3000.007 §9.2 / LLP 3000.009 §5.3 worker ownership. The lane's `llp-orient`
symlink is broken; read the same skill from the sibling lane-z vendor checkout.
The maintained-view guide still describes the adopted behavior. Durable session
revocation, atomic adoption, generation checks and existing meters remain in
force; no LLP decision changed and no new LLP was needed.

### Changes, file by file

Paths are relative to `snapback4/`.

- `crates/snapback4/src/dev_worker.rs`: `Supervisor` owns a background thread,
  the optional `DevWorker`, revision-triggered discovery and ticking. Its drop
  signals and joins that thread. `DevWorker` still owns durable session-family
  revocation, status persistence, child termination and reaping. Those actions
  can wait for adoption without preventing HTTP admission.
- `crates/snapback4/src/serve.rs`: production `serve_requests` checks supervisor
  health and accepts HTTP without calling `tick`. Bearer resolution and query
  execution only use the writer fallback for an explicitly identified memory
  store. Retryable authentication/storage errors retain retryable HTTP status.
  The poison-test fixture initializes the reader policy from its actual store.
- `crates/snapback4/src/serve_readers.rs`: cache whether the store is in memory
  when installing its factory. A missing file-reader factory refuses without
  taking the writer; opening another reader also propagates its failure.
  `read_head` only falls back for memory. A test-only fault counter selects the
  reader-open failure site without exhausting the test process's descriptors.
- `crates/snapback4/src/serve_sync.rs`: snapshot and stream checkout failures
  return retryable `E_STORE`/503 for file-backed stores. Memory still uses its
  writer. Bearer failures preserve retryability.
- `crates/snapback4/tests/serve_adoption/worker.rs`: runs the production accept
  loop and supervisor with a real Node child. An authorizer holds SQLite inside
  adoption; the child exits, and supervision queues for the writer. Query and
  sync must return correct responses within two seconds before release. After
  release it proves revocation of the exited child's family, restart, and joined
  shutdown with no session marker or live owned child.
- `crates/snapback4/tests/serve_adoption/reader_failure.rs`: seven fault cases
  cover bearer resolution, query evaluation, pending-query head, sync head,
  snapshot checkout, stream checkout, and an absent factory. With the writer
  held, each returns 503 with retryable `E_STORE`, within two seconds, without
  even queuing for the writer. Restoring the factory permits successful retry.
- `crates/snapback4/src/serve_ephemeral.rs`: adds a test hook in the gap before
  memory fallback's second writer acquisition; production authority is unchanged.
- `crates/snapback4/tests/serve_adoption/authority.rs`: adds both expiry and
  revocation against `Store::memory()`, specifically in that second-lock gap.
  The request must fail `E_AUTH`, with no ephemeral change or durable commit.
- `crates/snapback4-core/src/store/adoption_tests.rs`: six physical-corruption
  cases now cover both guards present, both absent, and only the corrupting
  operation's guard absent, for INSERT and UPDATE separately. Each requires
  `E_INDEX_KEY_BYTES` and unchanged generation, sequence, rows, indexes, logs,
  commits, proof and trigger definitions after rollback.
- `crates/snapback4/src/serve_adoption.rs`: successful `adopt_candidate` owns
  status recovery alongside its existing refusal handler; the watcher no longer
  duplicates recovery. `tests/serve_adoption/failure.rs` checks `/dev/status`
  equals the actual rejection (`E_STORE: not authorized`) and clears after a
  successful attempt through the same production function.
- `crates/snapback4/src/serve_tests.rs`,
  `crates/snapback4/tests/serve_adoption/mod.rs`, and
  `crates/snapback4/tests/serve_ephemeral/mod.rs`: manual adoption/native handoffs
  now install the reader factory as production does instead of relying on an
  implicit read-side writer repair. Existing assertions remain. The adoption
  module registers the two new regressions. Largest changed source: 1,499 lines.
- `JOURNAL.md`: one appended dated round-3 entry. This report gains this section;
  earlier rounds and their measurements are retained.

### Forms and outcomes

No language change. Existing examples exercised in this round:

- `view originalTotals: count posts where .parent = null by .author` and the
  other five M8 views still compile and adopt at scale.
- `view totals: count items by .owner` plus a query returning `totals[viewer]`
  remains pending until adoption publishes; `POST /q/who` and `POST /sync`
  answer while an exited worker waits for that same adoption.
- `mutation typeNow(id: id)` with `upsert typing[owner = viewer] {}` against
  the four-second ephemeral table now has memory-fallback expiry/revocation
  coverage: the wire result is `state: failed`, `why.code: E_AUTH`.
- An injected file-reader failure yields HTTP 503 and
  `{"denied":{"code":"E_STORE","retryable":true,...}}` without writer access.
  `/dev/status` reports `adoption: "E_STORE: not authorized"` after the injected
  rejection and `adoption: null` after success.

### Affected verification and mutation experiments

After restoring every deliberate mutation: CLI **122 passed, 2 intentional
ignores**; core adoption **6/6**; lifecycle integration **20/20**; scale engine
and HTTP witnesses **1/1 each**. The crash helper is exercised by its parent
regression and the ignored HTTP scale test was run explicitly.

Every experiment below compiled, ran its regression, and exited **101 with
`test result: FAILED`**. All source was restored before the final affected
checks and the full suite. Detailed logs and the exact mutation script are
retained under ignored `target/lane-ad-evidence/r3-*`.

| Deliberate mutation | Failing regression / observed failure |
|---|---|
| Put `worker.tick()` back on the production accept loop, with inline worker ownership | `production_accept_loop_reads_while_exited_worker_waits_for_adoption`: HTTP read times out while adoption remains held |
| Restore writer repair when the reader factory is absent | `failed_file_reader_refuses_without_waiting_for_the_writer`: HTTP read times out |
| Remove the memory-only restriction from bearer fallback | Same regression: bearer read times out |
| Remove the memory-only restriction from `read_head` | Same regression: pending-query head times out |
| Remove the query reader-error refusal | Same regression: query times out |
| Remove the snapshot reader-error refusal | Same regression: snapshot checkout times out |
| Remove the stream reader-error refusal | Same regression: stream checkout times out |
| Delete only memory fallback's `mutation_authority` | `bearer_is_checked_after_durable_and_ephemeral_mutation_lock_gaps`: `sent` instead of `failed` |
| Change `installed != 2` to `installed == 0` | `physical_key_edits_invalidate_a_matching_proof`: adoption succeeds as generation 2 instead of refusing |
| Delete `refused()` in `adopt_candidate` | `failed_candidate_clears_pending_names_and_allows_a_later_adoption`: status is null instead of `E_STORE: not authorized` |
| Delete successful status recovery | Same regression: status remains non-null after successful adoption |

Two preliminary authoring failures were mine and fixed before final verification:
adding a rollback assertion to the wrong fixture caused a compile error, and
an early authentication response initially mapped retryable reader errors to
401 instead of 503. A broad CLI run at the inherited **1,024-descriptor soft
limit** hit `Too many open files` and caused five HTTP tests to fail. That run
is environmental, retained as `r3-cli.log`. Repeating with **65,536 descriptors**
passed all 122 tests (`r3-cli-final.log`, then `r3-cli-restored.log`). No product
limits changed; the same shell limit is used for the final suite. Bun frozen
installation passed without changes, Node 24.13.1 / Bun 1.3.14 / Rust 1.97.0.

### Scale measurement

Same prepared M7 fixture: **1,447,960 rows / 9,077,125 indexes**, test-profile
opt-level 1, eight Cargo jobs, dev/test debug information disabled, standard
SQLite cache and FULL durability. Distribution and synthetic-fixture limits
remain those documented above.

| Measurement | Round 3 |
|---|---:|
| Key proof/guard check | 0.125 ms |
| Remaining preflight | 1,807.968 ms |
| Projection/index work | 474.954 ms |
| Capture, included in derived work | 770.057 ms |
| Derived work | 1,455.168 ms |
| Validation | 474.121 ms |
| Metadata | 1.793 ms |
| Commit/checkpoint | 2,329.793 ms |
| Whole engine adoption | **6,545 ms** |
| Detached query proved inside transaction | **525 µs** |
| Injected transaction hold | 562 µs |
| HTTP witness adoption | **6,521 ms** |
| HTTP `/changes` wait | **6,523 ms** |
| HTTP query while adoption held | **5.991 ms** |
| HTTP sync while adoption held | **8.270 ms** |

Per-view folds: dailyLikes **13.040 ms / 5,008 visits**; dailyPosts **226.457 ms /
50,228**; originalTotals **219.848 ms / 50,228**; receivedLikes **12.401 ms /
5,008**; receivedReplies **209.751 ms / 50,228**; receivedReposts **2.914 ms /
1,004**. No adoption performance change was attempted in this round.

Reproduce with the round-1 scale and HTTP commands above. New focused tests:

```sh
cargo test -p snapback4 --bin snapback4 adoption_tests
cargo test -p snapback4-core --lib store::adoption_tests
cargo test -p snapback4 --test lifecycle
```

### Scope, commits and open reproductions

No deviation from the five-finding scope. The production-loop regression
injects its adoption hold in-process and runs a real supervised Node child;
it does not depend on scale timings or replace the loop with Host's dispatcher.
Worker cleanup remains allowed to wait for the writer during shutdown.
A file-backed reader failure refuses instead of falling back; after a missing
factory, a writer-owned factory installation restores it, while ordinary failed
reader opens retry from the existing factory. Reads never repair it through the
writer.

The one-second adoption target remains unmet (run `m7_to_m8` with the opt-in
scale environment). `/changes` still waits for durable reconnect admission
(run `scale_changes_waits` with `SNAPBACK4_ADOPTION_HTTP_DB`); the supervisor's
0.4.4 ruling and existing follow-up ticket are unchanged. No new unresolved
failure was found in affected verification. The final suite result follows.

Implementation commits, all with `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`:
`caa0f52c9` (one missing guard), `9eb386f41` (authority/status coverage),
`94a837d44` (worker supervision), `a5b9b7105` (reader refusals).

### Round-3 final full-suite result

Ran `scripts/test.sh` **exactly once**, after the affected tests, all restored
mutation experiments and both scale runs. From `snapback4/`:

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
ulimit -n 65536
bash scripts/test.sh > target/lane-ad-evidence/r3-test-sh.log 2>&1
```

Exact summary, **exit status 1**:

```text
== 1 failure(s) in 967 s
   wasm build
```

Every full-suite failure: **baseline — wasm build**, and no others.
**2,025,652 B raw / 582,551 B gzip**, against the unchanged **582,094 B** budget:
**457 B over**, with **round-3 size delta 0 B**. Reproduce with
`bash scripts/build-wasm.sh`. This is the same artifact size as rounds 1–2;
no budget increase or clean-full-suite claim. **No introduced or environmental
failure in this final run.**

- Rust workspace tests/doctests: **3,678 passed, 0 failed, 22 ignored**;
  cargo-test phase **502 s**. CLI **122 passed, 2 ignored**; lifecycle **20/20**;
  whole guide **86/86**.
- Client main batch: **2,377 passed, 10 skipped**; seven separate shards:
  **56 passed**; client phase **194 s**.
- Seeded client models: **78/78**, **256 s**. Fixture wrapper tests: **9/9**.
- Cargo build, docs budget, release guard, package typecheck/build, chat
  check/typecheck and Expo typecheck all passed.

The reference audit reports **513 LLP docs, 9,504 refs in 26,973 files,
0 errors, 0 unchecked** (`r3-ref-check.log`). `git diff --check` passes, and no
changed Rust source exceeds 1,500 lines. Restored the suite-generated native
fixture Cargo.lock version update. Full log and exact exit status remain in
ignored `target/lane-ad-evidence/r3-test-sh.log` and `r3-test-sh.exit`.
Only this report and the one appended journal entry accompany the four scoped
implementation commits. No push or publication.

## Integration merge — 2026-09-27

Ran the requested `git merge sb4-intent/integration-044` into
`sb4-intent/ad-adoption`. The initial ref check returned the prompt's
`2ddaf680253b4189cce703118bb52d3483e95a04`, but the named branch advanced during
orientation, before the merge command. Git selected the actual second parent
`6749988868c29f4c64dde79d354c1b52d7bd789b`: that commit plus main's image-list
placement fix and its documentation. Retained this named-branch merge and
qualified the resulting tree; no later integration commits were included.
This is the one input-revision deviation from the prompt. The initial progress
message claiming an exact `2ddaf6802` merge parent was corrected after checking
`MERGE_HEAD` explicitly.
This is integration only: no new Quarry form, adoption redesign, budget increase,
push or publication. The one-second adoption target and documented `/changes`
wait remain unchanged; the scale fixture was not rerun for this merge.

### Conflict resolutions

- `../llp/3000.019-what-the-builder-still-wrote.rfc.md`: retained both Revised
  histories, AD §3.6 and LT §3.7, plus the integration's other additions.
- `JOURNAL.md`: retained both sides' entries verbatim and in their original
  relative order; appended one new dated merge entry after qualification.
- `crates/snapback4-core/src/engine/row_views.rs`: retained P5's expired or
  unreadable candidate handling, current-row/provisional checks and range
  certification. Added AD's source-visit counter only to an admitted stored
  row, under `cfg(feature = "sqlite")`. Kept the diet's server-only gates and
  the explicitly qualified shared `crate::value::object` use.
- `crates/snapback4-core/src/store.rs`: every constructor initializes AD's
  adoption report/full-path oracle and R's ownership/file identity fields.
  Detached readers clone the ownership handle and verify the database identity;
  SQLite still drops before its raw ownership descriptor.
- `crates/snapback4/src/serve.rs`: retained AD's disposable WAL fresh store,
  detached reader factory, separate 32-slot writer/read admission, owned and
  joined supervision thread, reader refusal policy and re-authentication.
  Persisted dev/release opens now use R's `store_owner`; `announce` writes the
  server address through its acquired `serve.lock` handle. LT's sample starts
  before admission and wraps each request thread; response completion hooks,
  `/dev/status` project/temporary fields and doctor URL support are retained.
  Dev latency inspection/reset uses read admission, so saturated writers do not
  make it unavailable; production service inspection retains writer admission.
- `crates/snapback4/src/serve_adoption.rs`: kept AD's production
  `adopt_candidate`, pending-name cleanup, recovered status, reader replacement
  and per-view report. Generation-refusal reopening uses the retained R owner,
  and successful publication updates LT's operation registry.
- `crates/snapback4/src/serve_tests.rs`: kept both test-module additions and
  initialized reader, ownership and latency fields together. Compacted imports
  and module spacing to retain the 1,500-line ceiling (1,499 lines).

### Required integration corrections and regression coverage

`serve_readers.rs` stamps LT's first engine acquisition on successful detached
checkout, including bearer authentication; a failed checkout does not stamp it.
Writer/fallback acquisitions continue through LT's existing FairMutex hook.
Completion/refusal classification remains on the common response paths. The
supervision thread has no request-local sample to contaminate.

Two tests added in `tests/latency/serve.rs` prove that detached checkout includes
pre-acquisition request work in wait but excludes later query work (both bearer
and persona), and that a saturated writer budget records exactly one refusal
while query and dev latency inspection/reset still work. Existing seven
reader-failure scenarios now assert exactly one latency refusal and zero wait
unless an earlier checkout succeeded. The production supervisor/adoption test
now asserts query/sync timing while supervision waits and unchanged request
counts after the supervisor resumes.

P5's existing `tests/unread_range/counted.rs` did not compile against the
integration's image-placement `Rows::release_asset` signature (E0050/E0061).
This exact old signature exists in the actual merge parent. Updated the test
wrapper to forward table, row id and column along with id/time. No assertion,
product behavior or native/web feature boundary was weakened. Its rerun passes.

The single full suite also exposed R's
`sync_and_changes_keep_the_owned_database_after_its_path_is_replaced` expectation
that failed detached sync must fall back to the writer. That conflicts with AD's
already accepted file-reader refusal policy. Updated
`tests/run_admission/identity.rs` to inspect HTTP status and require retryable
`E_STORE`/503 for both snapshot and stream after replacing the inode, with no
events or store identity in the refusal. The unchanged `/changes` assertions
still require the original store identity and sequence. Renamed the regression
`sync_refuses_replaced_path_while_changes_keeps_the_owned_database`.
This reconciles the test with the merged behavior; no product code or ownership
check was relaxed. The full-suite cargo failure is retained in its exact result;
the focused post-fix result is recorded separately below.

### Affected checks

Commands run from `snapback4/` with Node 24.13.1, Bun 1.3.14, Rust 1.97.0,
Cargo jobs 8, dev/test debug information disabled, and shell file limit 65,536.
Frozen Bun installation passed. Evidence is in ignored
`target/lane-ad-evidence/merge-*`; each test/build command has its log there.

| Check | Result |
|---|---|
| `cargo build -p snapback4` | Pass |
| `bash scripts/build-wasm.sh` | Artifact built; inherited size gate fails (measurement below) |
| `bun run build` in `packages/snapback4` | Pass |
| `cargo test -p snapback4 --bin snapback4 -- --test-threads=1` | 149 passed, 4 intentional ignores |
| `cargo test -p snapback4 --test latency -- --test-threads=1` | 9 passed |
| `cargo test -p snapback4-core --lib store::adoption_tests` | 6 passed |
| Core `row_view_accounting`, `row_view_legacy`, `row_view_witness` | 6 + 1 + 3 passed |
| CLI `lifecycle`, `replay` | 20 + 15 passed |
| `node --test packages/snapback4/test/native-opening.test.mjs` | 6 passed; includes E_STORE_BUSY naming the server |
| `cargo test -p snapback4-device --test unread_range` | Initial inherited wrapper compile failure; corrected rerun 7 passed |
| `cargo test -p snapback4-lang --test guide` | Whole guide: 86 passed |
| Post-suite-failure `cargo test -p snapback4 --test run_admission -- --test-threads=1` | 23 passed; corrected identity/refusal expectation |

Reference audit: 515 LLP docs / 9,552 refs / zero errors or unchecked. Changed
source files fit 1,500 lines. Conflict resolutions pass whitespace checks;
two trailing blank lines are inherited unchanged from integration in LLP
3000.021 and `tests/check_adoption/mod.rs`.

### Full suite and wasm

Ran `scripts/test.sh` exactly once, from `snapback4/`:

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
ulimit -n 65536
bash scripts/test.sh > target/lane-ad-evidence/merge-test-sh.log 2>&1
```

Exact summary, **exit status 1**:

```text
== 3 failure(s) in 1322 s
   wasm build
   cargo test
   client tests
```

Every failure and its disposition:

1. **Inherited budget failure, with a measured size delta — wasm build.**
   The initial build and full suite both produce **1,980,253 B raw / 571,841 B
   gzip**, **875 B over** the unchanged actual merge-parent cap of **570,966 B**.
   This is **+2 B gzip versus the prompt's supplied 571,839 B integration
   measurement**. The intervening main image-placement merge had already
   ratcheted the cap from the prompt's 570,967 B to 570,966 B; this merge does
   not edit the budget. The comparison includes that intervening main merge;
   no separate rebuild or per-component attribution of the older revision is
   claimed. Toolchain: Rust 1.97.0, wasm-bindgen 0.2.127, no wasm-opt installed.
   The web artifact compiles with `--no-default-features --features web`;
   server-only adoption/counters remain behind `sqlite`.
2. **Integration expectation mismatch, corrected — cargo test.** The only
   failing Rust test was
   `identity::sync_and_changes_keep_the_owned_database_after_its_path_is_replaced`
   in `snapback4::run_admission`. Its curl expected success but received 503,
   because AD refuses a failed file reader instead of falling back to the
   writer. The reconciled test described above passes with the complete target:
   **23 passed / 0 failed** (`merge-run-admission-final.log`). The production
   behavior and R's inode/ownership checks were not changed to satisfy it.
3. **Environmental/intermittent timing failure — client tests.**
   `invocation lifetime releases provider and private-core fetch and body stalls
   without late identity effects`, `packages/snapback4/test/identity.test.mjs:904`,
   asserted `entered.value === true`, but saw false: the test's 100-ms
   cancellation status timer won before the mocked private-core request entered.
   The identity test, identity implementation and worker sources are unchanged
   from both merge inputs. An unchanged focused rerun passes **1/1**
   (`merge-identity-rerun.log`), and an unchanged whole-file rerun passes
   **18/18** (`merge-identity-file-rerun.log`). This timing classification is
   based on the failed entry assertion, timer, unchanged inputs and green
   reruns; the full-run failure is not erased or relabeled as a pass.

Full-run Rust tests/doctests: **3,779 passed / 1 failed / 24 ignored** (835 s).
Client main batch: **2,458 passed / 1 failed / 10 skipped**; seven shards:
**56 passed** (client phase 195 s). Seeded models: **78/78** (256 s).
Fixture wrappers: **9/9**. Native build, docs budget, release guard, package
build/typecheck, chat check/typecheck and Expo typecheck all pass. The full
suite was not rerun. Its log and exit status are preserved in
`target/lane-ad-evidence/merge-test-sh.log` and `merge-test-sh.exit`.

No production code changed after that full run started. The only post-failure
source correction is the ownership test's reconciliation; its full target was
rerun successfully. No remaining introduced affected-test failure was found.
The inherited wasm gate remains red. No push or publication.
