# AP: populated-store atomic adoption

Date: 2026-10-04. Host: eb1000 only (AMD EPYC 9454, 48 cores / 96 threads). Baseline: `2154dc163dc42e1808f12ef32e9468b2889407a3`.

**Round-0 result: 17.108 s → 6.942 s median, 2.46× faster. The requested 5× target
is not met.** On this baseline it requires ≤3.422 s. The improvement removes
59% of the pause without introducing an online protocol. Atomic publication,
crash rollback, predecessor readers, logical meters, sparse images and derived
results are preserved. The optimized web artifact is byte-identical to baseline.

**Round 1:** 17.871 s → 7.914 s median (2.26×); the 96 MiB address-space probe
now succeeds with identical derived state. **Full-suite qualification remains red:**
two completed runs failed different client cases; affected tests pass. See the [round-1 record](#round-1--refusal-order-memory-and-complete-pause-advice).

**Round 2:** surviving-table cleanup/rewrite advice is complete; all 419 affected
tests pass. See the [round-2 audit and verification](#round-2--retirement-and-rewrites-inside-surviving-tables).

All measurements and changes belong
to `lane-ap`; no other lane, host or process was changed. Nothing was pushed.

## Reproduction and limits of the retained evidence

The evidence copy was never opened with a writable SQLite connection. Its main
database and WAL were copied into `.ap-scratch`, and only that private copy was
checkpointed. No token, owner, lock or SHM file was copied. The retained
`_generations` rows contain complete generation-1 and generation-2 schemas and
programs (respectively 108,834/112,945 and 129,228/131,719 serialized bytes).

The baseline helper opens the copy through `Engine::open_at`, then invokes the
supported `Engine::adopt_at` with the persisted generation-1 definitions. Opening
upgrades the older retained schema representation to generation 3; semantic
rollback becomes generation 4. Generation-2 adoption becomes generation 5.
No catalog, active-generation pointer, raw source population, or derived value
was manually forged. This is a generation-1 *semantic* store, not a claim that
the file has been restored byte-for-byte to its historical generation-1 instant.

The original adoption committed at sequence 206,208 and time
`1791050894344`. The final evidence contains 2,529 later Following-delivery jobs
and four `delivered` operations. Those change delivery/receipt state; they do
not add posts, messages, likes or reposts. The rollback retains that later state
and the historical log. The benchmark pins activation time to `1791050894344`
for both paths. The starting store has 208,741 commits. This precise limitation
is preferable to guessing an earlier schema or claiming the retained log can
reconstruct every historical private image.

Physical source populations are:

| Source | Rows |
|---|---:|
| messages | 100,015 |
| posts | 50,228 |
| likes | 5,008 |
| reposts | 1,004 |
| members | 2,053 |
| follows | 5,921 |

The 227,989 reported for `unread` is **source visits**, not 227,989 distinct
message rows. Members repeatedly scan their conversation's sources. The schema
adds nine indexes on existing tables, including five message indexes, seven
public derived tables, and private unread basis/recount tables. It fills
`likes.postId.authorId`, `posts.parentId.authorId` and `reposts.postId.authorId`.

The unmodified main CLI was also run with `dev --port 0 --no-watch --replay`
against a separate source/store copy. Its startup log rebuilds the same seven
views with exactly the same visit counts; see [cli-before.txt](cli-before.txt).
Its ordinary current clock is not the pinned-time equivalence oracle. The
microbenchmark uses the CLI's public engine activation API, removing compiler,
listener startup, and background maintenance from the timed interval.

### Commands and reusable harness

Use `crates/snapback4-core/examples/adoption_pause.rs`. Build the same helper
against the baseline archive and candidate with:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=6 \
  cargo build --profile production -p snapback4-core --example adoption_pause
```

The production profile is the shipping optimization profile. When copying the
helper into the baseline source, remove the one JSON `"details"` line: that
report field did not exist there. This changes only emitted benchmark metadata.
The earlier release-profile explorations used the same SQLite publication flag.
No SQLite durability pragma was weakened.

```sh
python3 reproduce.py /absolute/evidence/store.sqlite \
  /absolute/baseline/adoption_pause /absolute/candidate/adoption_pause \
  87 /absolute/new-results-directory
```

[reproduce.py](reproduce.py) copies and restores the store, runs three sequential
before/after pairs, compares complete derived state with [compare.py](compare.py),
and removes its temporary stores on exit. Run with the evidence immutable and
CPU 87 and its SMT sibling 39 idle; another idle physical pair is equally valid.
The actual run used the same sequence and retained its outputs in
[timings.jsonl](timings.jsonl). Compilation was confined to other CPU pairs.
Per-process user/system time corroborates that the measured runs were not
starved: baseline medians 9.614/6.763 s, candidate 5.781/1.135 s. Stores were
copied sequentially and the page cache was warm; this is not a cold-disk claim.

Initial exploratory runs with overlapping profiling or changing host load were
discarded, not averaged into the comparison. The calibration builder's 69.027 s
cannot be divided directly by this host's optimized time: main's code, the host,
and the retained source state differ. The controlled main baseline sets the bar. The prior three production pairs, before
tightening cursor-growth workspace reservation, measured 16.322 → 6.762 s
(2.41×); [their raw data](timings-before-cursor-reservation.jsonl) is retained
separately. The final table below uses three new pairs after that correction.
Subsequent repairs to public diagnostic labels and unchanged-startup reporting
do not change the measured derived work.

## Timing and attribution

| Pair | Main baseline | Candidate | Speedup |
|---|---:|---:|---:|
| 1 | 17.357 s | 7.511 s | 2.31× |
| 2 | 17.108 s | 6.901 s | 2.48× |
| 3 | 16.406 s | 6.942 s | 2.36× |
| Median | **17.108 s** | **6.942 s** | **2.46×** |

Median phase measurements (milliseconds; independently computed phase medians
need not sum to the median total):

| Phase | Before | After |
|---|---:|---:|
| Read-only count/admission advice | included in residual | 77.6 |
| Key validation / writer entry | 0.03 | 0.04 |
| Preflight / successor assessment | 1,744.5 | 847.5 |
| Sparse projection, index evaluation and insertion | 10,605.2 | 2,255.0 |
| Cap counts | 0.00 | 0.00 |
| Captures and maintained rebuilds | 4,058.4 | 3,086.2 |
| Final invariant/asset/unique/cap validation | 295.1 | 238.7 |
| Metadata | 1.7 | 1.8 |
| Commit, including automatic WAL checkpoint work | 335.1 | 423.5 |
| Per-run residual outside phase brackets | 3.4–3.6 | 5.3–5.9 |

The old report listed capture time both separately and inside `derived rebuild`.
It must not be added twice. Captures are now a nested detail, as are per-table
projection/index passes, ordered insertion, retirement and successor assessment.
Successful dev/startup/deploy lines print these phases and details, using public
parent-field labels for maintained columns, followed by
individual view builds labelled **source visits**. Failed candidates publish no successful report.

The dominant previously unattributed cost is index B-tree churn: row-order
insertion repeatedly evicts and rewrites index pages through the small default
SQLite cache. Existing activation meters localize it to `project and index`.
A baseline `gprofng collect app -p hi -F off` sample of the unstripped release
helper puts 31.3% of samples in `pwrite`, 13.0% in `pread`, and 61.7% inclusive
in SQLite's VM. B-tree seeks are 36.1% inclusive. See
[profile-before.txt](profile-before.txt). These are sampled proportions, not
precise exclusive wall durations; the profiler's reported total CPU seconds
undercount elapsed CPU and must not be used as the timing denominator. `perf`
is unavailable and `perf_event_paranoid=4` on this host. The stripped production
candidate profile cannot attribute Rust symbols; [profile-after.txt](profile-after.txt)
records that limitation instead of inventing fine-grained timings.

An independent low-overhead libc I/O counter around the **whole helper**, including
open and the final explicit checkpoint, confirms the mechanism:

| Native I/O | Before | After |
|---|---:|---:|
| positioned reads | 1,762,522 | 330,371 |
| bytes read | 7,219,961,382 | 1,353,858,912 |
| positioned writes | 4,385,073 | 242,690 |
| bytes written | 10,510,838,948 | 612,315,589 |
| sync calls | 5 | 5 |

Per-file classification attributes the writes more precisely:

| Written bytes by file kind | Before | After |
|---|---:|---:|
| Main database | 119,316,544 | 118,861,888 |
| WAL | 3,164,374,504 | 120,299,800 |
| SQLite temporary files | 7,227,147,900 | 373,153,901 |

The unchanged volume of final main-database writes contrasts with the eliminated
WAL/temp churn. Temporary writes on the slow path, without corresponding temp
reads, are consistent with statement-journal/spill work; the filename counter
does not distinguish temporary journal roles from sort roles. These are
whole-helper counts, not exclusively bytes written during the final commit. [io-profile.c](io-profile.c) and [io.txt](io.txt) preserve the method and
its separate syscall timings. Profiling runs are excluded from the speed table.
The separately timed `wal_checkpoint(TRUNCATE)` is about 21 ms in ordinary runs
and occurs **after** the reported activation time; durability/automatic
checkpoint work performed by commit stays in the commit phase. No checkpoint
was moved out of adoption by this patch.

### Captures, materialization and metering

In the candidate, message projection/key evaluation/staging is about 0.96 s,
post projection/key staging 0.25 s, and the final ordered insertion 0.95 s.
Capture fills total about 0.57 s: likes 0.074 s, posts 0.48 s, reposts 0.013 s.
The capture algorithm and its historical null/deletion semantics are unchanged.

Sparse interpretation and metering are nested work, not additional passes to
add to those durations. The baseline sample attributes 3.9% exclusive to the
stored-row heap-price scanner and 3.9% inclusive to optional-field
materialization; typed JSON/B-tree decoding is another visible cost (10.4%
inclusive in one map decoder). A no-contribution activation page no longer
constructs a second typed Value merely to discover zero contribution scratch.
It retains all decoder admission and examination charges. Projection no longer
copies a row's shared map when there are no removed fields. Materialized defaults
and optionals still remain an interpretation, never unsolicited persisted bytes.
Exact per-row wall times for these inline operations are not claimed.

### Why unread was expensive

| Maintained view | Visits | Before ms | After ms |
|---|---:|---:|---:|
| dailyLikes | 5,008 | 30.7 | 31.9 |
| dailyPosts | 50,228 | 170.2 | 171.7 |
| originalPostCounts | 50,228 | 163.8 | 163.4 |
| receivedLikes | 5,008 | 28.2 | 28.6 |
| receivedReplies | 50,228 | 149.2 | 148.6 |
| receivedReposts | 1,004 | 14.0 | 14.4 |
| unread | 227,989 | **2,902.1** | **1,941.7** |

`unread` is a row-keyed live count, not one SQL `GROUP BY`: each of 2,053 members
runs the existing bounded predicate/range decision, with small-range key probes,
expiry checks, predicate evaluation, exact heap admission and possible pending
recount state. Its 227,989 logical visits previously performed a length query,
payload query, B-tree positioning and typed decode one row at a time. This
explains its disproportionate cost relative to grouped post counts. The new
activation-only raw read-ahead amortizes SQLite positioning across up to 32
serialized rows. Logical one-row reads still perform the same authorization,
decode charges, expiry, predicates and cut decisions. It decodes no future Value.
The identical result has 2,053 unread rows, 2,003 basis rows and **50 pending
recount work rows**. A set-based count that silently settles those members would
change the activation contract and is not used as a shortcut. The original builder's 10.7 s is not this host's 2.90 s.

## Implementation and guarantees

- Evaluate and admit every new index key with the existing code, stage keys in
  SQLite's temporary heap, then insert ordered by `(ti,k)` in the same transaction.
  All candidate indexes exist before captures and derived readers use them.
- Temporarily borrow a 64 MiB main SQLite page cache for server activation;
  restore the caller's setting on success or failure, preserving larger settings.
  This is bounded storage-engine workspace, not an increased interpreter ceiling.
- Bound raw read-ahead to 32 rows and 128 KiB with its own reservation meter;
  reserve lengths before copying and fall back on too-wide rows. Preserve every
  consumer meter charge. Writes, raw connection access and savepoint rollback
  invalidate it. Ordinary/device transactions do not enable it.
- For count preflight, a source population below `I53_MAX` proves every possible
  count group fits. Validate its interpreted/captured source once across counts
  sharing that table. Sums keep their wide per-group cancellation calculation.
- Keep one `BEGIN IMMEDIATE` through schema/catalog/rows/indexes/metadata commit.
  No work becomes visible early; existing WAL readers retain their predecessor.

The explicit cache allowance is a page-cache target, not a whole-process RSS
limit. A separate `/usr/bin/time` measurement ([rss.txt](rss.txt)) observed
**28.5 MiB before / 147 MiB after** for the whole helper. Larger cache and
sorter workspace trade memory for the avoided spill churn; this is a material
cost of the speedup. Existing SQLite sorter/temp behavior remains spillable; no unbounded Rust
map of index keys or decoded source rows is introduced. No logical meter ceiling,
recount boundary, admission requirement or device implementation was relaxed.

## Equivalence and refusal evidence

[compare.py](compare.py) compares every stored byte/value in ordered `r`, `i`,
`_catalog`, `_log` and `_commits`, plus every table and physical index separately
and the three captures by id. [equivalence.json](equivalence.json) contains all
digests. Before and after are identical:

| Object | Entries | SHA-256 |
|---|---:|---|
| r | 392,348 | `56d6f58e764a22afade48b0582b14e3c562eb870ee2267d5a4fda77b4bb8b31f` |
| i | 3,441,029 | `2a1f4e71f00ff3ea24c5ed2f501ebd5e31ce94ed29f72213828a28953629fc0f` |
| _catalog | 141 | `a86feeff5ff1aa87754ef76efb224a013ce403d47c99406c9eec683621b84330` |
| _log | 528,066 | `842d8e884021079883ccee5013990b10eadc94d2ae480d0c0f155474f16338d0` |
| _commits | 208,742 | `da4de43d2d843dd9f404a8b2e40fa0015d0fb5c4a4e935e9ed914846446ce1b7` |

This compares raw JSON strings, so equal materialized answers alone cannot hide
a sparse-byte change. `_generations.at` is wall-clock publication metadata and
is intentionally not treated as derived state. Both paths publish generation 5
from the same persisted definitions.

New generated tests compare the optimized path to the existing full-adoption
oracle on 12 seeds with counts, captures, large signed cancelling sums, varied group
keys and physically absent optional fields. The entire row/index/log/commit
images match, and absent parent fields remain absent. Separate tests compare
all logical read charges and cursors, including a 150 KiB source forcing the
read-ahead fallback; verify invalidation; and veto commit to prove rows, indexes,
commits and generation roll back, temporary staging disappears, and cache size
is restored. Existing process-crash, maintained-column, capture, aggregate,
activation, reader-isolation and device tests remain part of the full suite.

## Builder advice and online recommendation

`check` emits `N_ADOPTION_PAUSE` without mutating the store; the actual corpus
output is [check-advice.json](check-advice.json). Dev and deploy print
the same population advice before the writer transaction. It reports physical
source counts and anticipated projections, index row builds, capture fills,
aggregate visits and member recount work, calibrated to measured eb1000 release
rates. This corpus reports **3.94–26.30 s**, including up to 2,235,717 row-view
visits allowed by population/fanout and the existing per-member bound; it actually
uses 227,989. The deliberately broad range does not pretend source counts reveal
predicate selectivity. Token fanout, payload width, group distribution, cache,
WAL/storage and host load remain explicit qualifications, not an SLO. The preview
test compares database and WAL bytes, treating absent and empty WAL equivalently:
SQLite may create an empty sidecar on a read-only open, but writes no frames. Feed
launches retain their separate `N_TIMELINE_ADOPT` estimate/admission.

Recommend a separate snapshot/catch-up implementation: six to seven seconds is
still a material pause on a busy store. LLP 3000.026 §8.6 records the necessary
complete change journal, shadow source images/catalog, activation-time capture
semantics, time/expiry handling, bounded catch-up debt, crash recovery and one
brief publication switch. The audience partition log alone is insufficient.
No online adoption is implemented here. Nor is 5× claimed: reaching that bar now
requires a further design that shares or specializes interpreted source work
across phases while preserving the existing meters and pending-count contract.
The [existing adoption-pause ticket](../../../issues/20260926-snapback4-adoption-stalls-reads.md)
remains open with this measured shortfall.

## Verification

Verification results are recorded in [verification.txt](verification.txt).
The final `bash snapback4/scripts/test.sh` run **passed with zero failures in
1,991 s**; [the stage summary](full-suite-summary.txt) preserves the command and
result. It includes 299 Rust test binaries / 1,012 executions and doctests,
311 client files (6,187 passed tests, 11 existing skips), 79 serial model tests,
nine fixture tests, and all build/typecheck/docs/release-guard stages.

An earlier complete run exposed two reporting defects: private maintained-column
names in phase details and a spurious adoption announcement on unchanged startup.
Both were fixed; their 13 focused tests passed, and both files passed again in
the final complete run. No earlier failed run is counted as a pass. The final
reference audit has zero errors and zero unchecked references.

Wasm before and after: **2,116,457 B raw, 639,750 B gzip**, SHA-256
`de4877c28435db4e5ba9e501399eee2af6e8b02b97d1252b7932a103ae5effc1`.
`metrics/wasm-budget.json` stays at **639,887 B**, including its unchanged
**130 B macOS allowance**. No macOS execution is claimed. `build-wasm.sh` passes.
The supplemental `measure-wasm.sh` stops at the existing i64
`serde_json::value::ser::Serializer` family census failure, already documented by
RPF in JOURNAL; the baseline and candidate optimized artifacts are identical.

All private databases, tokens, profiler working directories and baseline build
copies are removed before commit. Peak lane scratch/build use stayed below
60 GB. Only sources, documentation, reproducible counters and non-secret
measurement summaries are retained.

## Round 1 — refusal order, memory and complete pause advice

The round-0 Astra and Grok reviews were READY WITH CHANGES. This revision starts
at `547c9eaa0b` and addresses all four required findings plus the advice wording.
The reviews and their private evidence remain under `~/sb4-intent/reviews/`;
no other lane was modified. The sections above are the original round-0 record.

### Changes and regression evidence

- **Uniqueness at staging.** `_adoption_index` now has `(ti,k)` as its primary
  key in a `WITHOUT ROWID` table. A duplicate fails on the original walk step;
  the native constraint error is translated to the exact predecessor public
  message, `E_STORE: UNIQUE constraint failed: i.ti, i.k`. The clustered key
  also supplies final insertion order without another sorter. The regression
  injects a duplicate physical key before a later invalid source row, compares
  the direct and staged walks' exact refusal and accumulated charges, and proves
  the invalid row was never visited. This exercises defensive physical-key
  uniqueness; ordinary key generation appends row IDs and deduplicates word
  tokens. Application unique-prefix validation retains its existing final pass.
- **Controlled workspace and recovery.** `SNAPBACK4_ADOPTION_CACHE_MIB` accepts
  integers 0–512, default 64. Zero retains both caller cache settings. Otherwise
  main and temp each receive half the combined target, preserving larger caller
  settings; callers already providing the target keep both settings. On Linux,
  readable procfs limits the target to one quarter of both the finite soft
  address-space limit and its remaining mapped-address headroom. This heuristic
  is not a cgroup/physical-memory bound; other platforms and missing procfs use
  the explicit setting. A typed SQLite `NOMEM` after enlargement rolls back,
  releases cached workspace, restores both settings, verifies autocommit and the
  persisted predecessor identity, and retries once. All other errors retain
  their original refusal. A successful retry reports failed-attempt time as a
  separate phase. One-shot device preparation is never replayed.
- **Proven rollback before retry.** The injected `NOMEM` occurs after actual
  activation index work and a builder row/commit write. Before retry, the test
  compares rows, indexes, log and commits to the predecessor, checks generation
  and absence of the temp table, and verifies both original cache settings.
  Successful output equals an uninterrupted control. Policy tests cover the
  opt-out, larger caller settings, alternate budgets, repeated `NOMEM`, and
  no retry for `SQLITE_FULL`, with both settings restored in each case. A failure
  restoring a SQLite hint is diagnosed and never turns a committed success into
  a reported activation failure; an unrestored connection is not retried.
- **Retirement is visible.** Advice uses activation's own active catalog set
  to count removed stored rows and index entries. A retirement-only change
  emits an explicit unestimated write-pause warning; a mixed change appends that
  warning to its modeled build work. Core and real `check --json` regressions
  cover deleting a 1,000-row table with 2,000 keys and dropping a 1,000-key index;
  core tests also cover retirement mixed with a new aggregate. Check remains
  read-only.
- **Raw-write invalidation.** Activation's projection, staging and bookkeeping
  SQL now obtain the invalidating connection accessor at each write. Other
  store write entry points do likewise (bulk put already clears at entry).
  A regression buffers a changed raw row after a savepoint, calls `rollback_to`,
  and proves the buffer is discarded and the next read returns the old image.
- **Honest advice.** The former range is described as modeled work “up to” the
  high value on a host like measured eb1000, with no host/load SLO. The subtotal
  excludes row-view visits and explicitly is not a floor. No new per-member
  inspection was added to tighten this advisory number. `N_ADOPTION_PAUSE`, dev,
  deploy and `guide maintains` name the cache control, historical 147 MiB RSS,
  and the distinction between a workspace target and process memory.

### Repeated corpus pair

[round1/reproduce.py](round1/reproduce.py) repeats the same supported semantic
rollback and pinned-time generation-2 adoption described above. It copies only
the evidence database/WAL and deletes private databases on exit, including errors.
The baseline is unmodified `2154dc163d` core code with the measurement helper;
its helper omits the candidate-only nested detail field. All three binaries use
`--profile production` and `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`.
[Binary hashes](round1/artifacts.json) bind the evidence to those artifacts.

The accepted pairs use CPU 95, sibling 47. Both were at least 95% idle for the
one-second sample immediately before each run (actual samples 98–100%). An
initial attempt on CPU 87 was rejected before collecting a sample because its
sibling stayed busy. This is a shared host, not a claim of whole-machine
isolation; tests/builds from this lane used separate CPUs. The first candidate
commit took 1.701 s versus 0.423/0.426 s on the next two. All three samples are
retained, including that outlier; the median is not a latency guarantee.

| Pair | Baseline seconds | Round 1 seconds | Speedup |
|---|---:|---:|---:|
| 1 | 17.871 | 10.197 | 1.75× |
| 2 | 19.130 | 7.908 | 2.42× |
| 3 | 17.140 | 7.914 | 2.17× |
| Median | **17.871** | **7.914** | **2.26×** |

The measured improvement survives immediate uniqueness checking and memory
controls: **56% less pause**, still below the original **5×** objective. It does
not assert that round 1 is faster than round 0's different shared-host slice.
Raw samples, disjoint phases, nested captures and every view are in
[round1/results/timings.jsonl](round1/results/timings.jsonl). Candidate phase
medians are: advice 56 ms, key validation <1 ms, preflight 889 ms, projection and
indexes 3,155 ms, derived rebuild 3,187 ms, final validation 238 ms, metadata 2 ms,
and commit 426 ms. Medians of phases need not sum to the median total. `unread`
still visits 227,989 rows and takes 2,013 ms median; its original settled/pending
contract is unchanged.

[The complete equivalence comparison](round1/results/equivalence.json) again
matches every rebuilt table/index/capture and all five full digests in the table
above: 392,348 row images, 3,441,029 index entries, 141 catalog entries,
528,066 log entries and 208,742 commits. The generated slow-path oracle also
passed on all 12 seeds, including sparse images and signed sum cancellation.

### Actual constrained-address-space probe

The first round-1 implementation kept a 64 MiB main cache and the small caller
temp cache. Immediate unique staging cost a median 9.481 s in that exploratory
slice, and under a 96 MiB `RLIMIT_AS` Rust aborted before SQLite could return
`NOMEM`. Merely retrying SQLite errors was therefore insufficient. These failed
exploratory results are retained in [round1/initial-probe](round1/initial-probe).
Splitting the target across main/temp improves staging without raising the
combined target; the address-space headroom check prevents that observed abort.

The final **96 MiB address-space** run succeeds without opting out. Complete
results and stderr are in [round1/results/memory.json](round1/results/memory.json).
These are memory/recovery probes, not additional quiet-slice timing samples.

| Binary / setting | Outcome | Adoption seconds | Peak RSS MiB |
|---|---|---:|---:|
| Baseline | Success, all digests equal | 18.055 | 27.75 |
| Round 0 | `SQLITE_NOMEM`, complete rollback | — | 90.75 |
| Round 1, configured 64 MiB | Success, all digests equal | 11.333 | 47.54 |
| Round 1, explicit 0 | Success, all digests equal | 11.895 | 30.83 |

The default's effective combined target was reduced to **20,519 KiB**. In the
unlimited quiet-slice runs the 64 MiB combined target used **93.11 MiB RSS** peak.
The 147 MiB round-0 observation remains documented because sorter RAM tracks
SQLite's borrowed cache threshold, not just its page count. A process limit can
also terminate Rust before a recoverable SQLite error; neither the heuristic
nor the fallback claims immunity to arbitrary OS/cgroup kills or allocator
aborts. Embeddings with large caller caches or `temp_store=MEMORY` retain those
choices and their memory responsibility.

The round-0 failure's predecessor comparison includes `r`, `i`, `_catalog`,
`_log`, `_commits`, `_meta` and `_generations`. Every successful constrained run
also repeats the complete table/index/capture comparison against the baseline;
those separate digest files are beside `memory.json`. The deterministic retry
regression establishes the retry path independently of the Linux clamp.

### Round-1 verification and disposition

Affected tests passed (325 selected tests, plus the nested allocation probe;
one existing ignored test), covering core adoption/captures/generated oracles,
maintained columns, expiring adoption, aggregates, simulator atomic narrowing,
device activation and real CLI advice/watch recovery. Their commands and results
are in [round1/affected-tests.txt](round1/affected-tests.txt).

The first full-suite attempt caught a stale `N_ADOPTION_PAUSE` guide definition
and action wording. It was stopped after that failure; it is not counted as a
complete pass. The diagnostic registry, guide text and hand-reviewed definition
pin were aligned with the new advice, and all **112 guide tests** passed before
restarting the full suite. [The failure record](round1/initial-suite-failure.txt)
is retained. This text correction does not change the timed adoption path.

The next complete attempt finished in 2,038 s with one client failure: worker
fixture readiness reported `fetch failed` before the symlink test's assertions.
The fixture diagnostic showed the host/worker running and startup adoption
finishing in under a millisecond. The exact case then passed in 2.572 s, and
all 61 tests in that file passed in 444.360 s, with no product or test changes.
All other 310 client files, all Rust/fixture stages and all 79 serial model tests
passed in that attempt. Its [failure](round1/worker-readiness-failure.txt) and
[scoped reruns](round1/worker-readiness-reruns.txt) are retained; the cause remains
unclassified in [a follow-up ticket](../../../issues/20261004-snapback4-intermittent-client-suite-failures.md).
That attempt is not described as a green full suite.

The online recommendation in LLP 3000.026 §8.6 is unchanged: an eight-second
pause still warrants separate snapshot/catch-up work. This revision implements
no online protocol and does not close the original 5× performance shortfall.

The second complete attempt exited **1 after 2,049 s**, again in the client stage.
It passed all 299 Rust binaries / 1,012 executions and doctests, nine fixtures,
all 79 serial model tests, and every build/typecheck/docs/release stage. Across
311 client files, 6,180 tests passed, seven failed and 11 were skipped. Five were
transport failures (one explicitly `UND_ERR_CONNECT_TIMEOUT`); two were distinct
assertions: shifted-page retained ordering A,B,C instead of A,C,B, and a parked
action journal containing attempt 3 instead of stopping at [1,2]. The
[seven complete failure blocks](round1/second-suite-failures.txt) and
[both complete stage summaries](round1/full-suite-summary.txt) are retained.
Every newly failing file passed the preceding complete run on the same candidate.
No client test retries or product workaround were added. These observations do
not establish an environmental cause, and neither complete run is green.

The final optimized wasm is byte-identical to the retained before artifact:
**2,116,457 B raw / 639,750 B gzip**, SHA-256
`de4877c28435db4e5ba9e501399eee2af6e8b02b97d1252b7932a103ae5effc1`.
The 639,887-byte budget and recorded 130-byte macOS allowance are unchanged.
No macOS execution is claimed.

The seven failing files were then run through the normal file runner on CPUs
88–95, first against the retained pre-AP `2154dc163d` release CLI, then against
the current candidate debug CLI. **Both controls passed all 89 tests**, including
300 process and 300 wasm ordinary-search seeds each. These are correctness
controls, not performance comparisons across build profiles. A temporary fetch
probe only logged origin/path and the underlying error cause, then rethrew the
same error; it did not retry or change requests. No failing transport was
reproduced (only ordinary aborts were logged). [The command, cases, oracle
summaries and probe observations](round1/client-controls.txt),
[probe source](round1/fetch-cause.mjs) and [binary hashes](round1/artifacts.json)
are retained. The cause of the complete-run failures remains unclassified;
passing focused controls do not replace a green full suite. See the
[verification record](round1/verification.txt) and the linked follow-up ticket.

Final `ref-check --verbose` passes with zero errors and zero unchecked references.
Private corpus stores and all remaining scratch artifacts were removed; lane disk
use is 40.06 GiB, below 50 GiB. No store, token or binary is committed.

## Round 2 — retirement and rewrites inside surviving tables

Base: `311c4d59fc`. Both reviews found that catalog-name retirement alone missed
work within retained tables. This change is confined to estimation, advice,
tests and documentation. No activation, successor, timeline, read-through,
rebuild, memory, isolation or device execution path changed. The existing
measured rates are unchanged; no new corpus timing or full-suite result is
claimed for this round.

The audit followed `store/activation.rs`, `store/successor.rs`, `successor.rs`,
`store/timeline_launch.rs` and their called retirement/rebuild paths. LLP
3000.000's atomic publication, LLP 3000.007 §20.9.4's backfill ownership, LLP
3000.007.001 §3.11's mirror order, LLP 3000.014 §7's predecessor-expiry barrier
and LLP 3000.026 §4's launch admission remain the governing constraints.

| Activation work | Preview coverage after round 2 |
|---|---|
| Removed tables/indexes, durable-to-ephemeral transitions | Existing catalog counts retained. |
| Timeline retirement with reused names and transitive maintain targets | Reuse `retired_timeline_tables`; count stored rows and old index entries even when names survive. |
| Changed aggregate predicate, key, kind, source or dependency interpretation | Reuse `maintain_rebuild_needed`; count the retained target cleared before folding, even with an empty source. Fold visits retain their existing model. |
| Row-keyed rebuild | Count target, recount work and live-basis rows/indexes cleared by `rebuild_row_view`; preserve modeled member/source visits. |
| Read-through additions/removals and expiry/default changes | Reuse `Retirement::affects`; warn of an unestimated write pause with the affected stored population. No expiry evaluation or source-image decode in preview. |
| Unchanged read-through children during another schema change | Warn: activation still rewrites them to recompute deadlines. |
| Destructive projection, index replacement, recorded capture fills | Existing projection/build/capture populations remain modeled; also count old replaced index entries as unpriced cleanup. |
| Maintained-column private rebuild and parent mirror | Count private cleanup; warn of unpriced parent mirror work, including parent lifetime changes without a private rebuild. Other parent-definition changes conservatively receive the same warning. |
| First-use Following construction and event-slot fill | Existing `N_TIMELINE_ADOPT` source/event/copy model and general source-projection counts cover these writes; retirement excluded from copy counts still warns separately. |
| Cap occupancy reset/rebuild | Warn with existing ledger entries and source populations, including legacy metadata repair with unchanged schema. |
| Asset-home release | Count unreleased ledger rows by home and warn for homes absent from the candidate, even when application rows are gone. |
| Legacy live-sum repair | Include retained targets and source visits even when the schema is unchanged. |

Predecessor populations selected for unconditional clearing are deduplicated by
catalog name across retirement, rebuild and index replacement. They do not
count intermediate rows created and cleared again during activation. Conditional
retirement/recapture and bookkeeping use an explicit **unestimated write pause**
warning. Named populations are not promises that all those rows are deleted;
they may overlap modeled visits and do not supply additional seconds to add.
The additional queries read scalar counts and grouped home metadata only, with
no writer transaction, temporary work table or row-image scan. Validation and
successor assessment remain read-only; ordinary expiry changes without a
read-through barrier do not themselves delete source rows.

Regression coverage includes Astra's 1,000-child/default-50→200 case at time 100,
read-through addition/removal and unchanged-child rewrites, filter and key
changes, a retained target with an empty source, row-view basis/recount cleanup,
parent mirrors, index replacement/projection/capture counts, cap and asset
bookkeeping, legacy repairs, and quiet unchanged/empty controls. Grok's existing
timeline test now checks counts both with and without the dependent maintain,
and rejects double counting when a target is both retired and rebuilt. CLI
checks verify the new warning in plain/JSON output and preserve database/WAL
bytes with a held writer transaction and with a stopped store; the existing
Following expiry matrix checks the warning alongside admission/copy results.

Round-2 verification: **419 affected tests passed**, plus the nested allocation
probe, with one existing ignored test. This includes 242 core library tests,
112 guide tests, seven CLI adoption checks, the existing live/stopped-store
read-only check, 15 timeline tests and 42 simulator adoption/maintain tests.
All 13 new core cases passed. Docs-budget passes (maintains remains 879/879
lines); `ref-check --verbose` reports zero errors and zero unchecked references.
[Commands and results](round2/verification.txt) bind the scope. Activation code
is unchanged, so the full suite was not repeated as directed. The prior full-suite
failures remain historical evidence; this is not a new green full-suite claim.

Round-2 scratch was removed; no evidence-store copies were needed. Lane disk use
is 40.51 GiB, below 50 GiB. Nothing was pushed.

## Round 3 — distinguish deadline rewrites from retirement

Base: `e08d9c355a`. Grok's remaining Low was operator wording: an unchanged
read-through table warned about time-dependent deletion even though activation
only recomputes its deadlines. The preview now says **“read-through children
rewrites 3 stored rows to recompute deadlines”** and counts those rows separately
as `deadline_rewrite_rows`. This work retains an explicitly unestimated pause;
it does not borrow the measured projection rate. Tables selected by
`Retirement::affects`, including inherited-expiry default changes, retain the
deletion-subset wording. Activation is unchanged, matching the existing claims
in LLP 3000.000 and LLP 3000.019 §3.6.

All **110 affected tests passed**: 23 core adoption tests and all 87 CLI `check`
tests. The unchanged-child regression adopts at both time 10 and time 100 with
deadline 50: all three stored rows survive, rewrite count is three, retirement
counts are zero. Separate cases retain the deletion warning for adding/removing
read-through and the 1,000-child inherited-expiry case. Plain and JSON checks
cover all three advice shapes while preserving database/WAL bytes with a held
writer transaction and a stopped store. Commands ran on eb1000, CPUs 80–87,
from `snapback4/`, with `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`,
`CARGO_BUILD_JOBS=4`, `CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`:

```sh
cargo test -p snapback4-core --lib store::adoption_tests
cargo test -p snapback4 --test check
```

`ref-check --verbose` passes with zero errors and unchecked references;
`git diff --check` passes. No full-suite, corpus timing or wasm remeasurement
was needed for this advice-only correction. No corpus stores were copied.
Round-3 scratch was removed; lane disk use is 40.54 GiB. Nothing was pushed.
