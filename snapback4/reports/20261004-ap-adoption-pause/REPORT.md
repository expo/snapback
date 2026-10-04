# AP: populated-store atomic adoption

Date: 2026-10-04. Host: eb1000 only (AMD EPYC 9454, 48 cores / 96 threads). Baseline: `2154dc163dc42e1808f12ef32e9468b2889407a3`.

**Result: 17.108 s → 6.942 s median, 2.46× faster. The requested 5× target
is not met.** On this baseline it requires ≤3.422 s. The improvement removes
59% of the pause without introducing an online protocol. Atomic publication,
crash rollback, predecessor readers, logical meters, sparse images and derived
results are preserved. The optimized web artifact is byte-identical to baseline.

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
