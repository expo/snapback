# HV round 1 — wasm reductions and apply attribution

The fixed **593,719 B gzip cap is not met**. The smallest tested production
candidate is **602,389 B gzip / 2,033,735 B raw**, saving 5,233 B gzip from round 0
but retaining an **8,670 B overrun**. The budget remains fixed; the declined
608,622 B ratchet is withdrawn. This is not a publication-qualified artifact.

Word indexes account for about **18–19% of heavy apply**, ordinary indexes about
**21%**, and row decoding/staging/publication about **60%**. Deferring words is
worth roughly 1.5–1.8 s of foreground work on this host, not the entire remaining
heavy-account gap. LLP 3000.007 §20.4.1 contains a proposal for review; no deferral
is implemented. Word indexes remain complete before publication in this commit.

## Integration and implementation

Merged origin/main first, in 30c3a13804, retaining EA's identity wait, KR's test
fix and the Worker snapshot macOS fix. The only conflicts were the LLP revision
header and append-only journal; both sides remain. The delivery await inventory
was regenerated through awaitBoundary(). Round-0 review findings are for the
later commissioned round; this work did not wait for or implement those reviews.

Four source reductions keep the row/image representation and every index:

1. Use a sorted vector for the index-page directory. Lookups binary-search the
   directory; ordinary updates move at most 256 entries inside a page. A split
   shifts page descriptors, so this is not a constant-size directory-update claim.
2. Keep unsorted acquisition entries in the same index container used after
   publication, eliminating the second B-tree family for bulk buffers. Finish
   every index before leaving replacement; rollback still restores the old image.
3. Have the legacy full drain join the bounded drain's encoded arrays, removing
   its second owned Change vector and serialization route. Both exports remain.
4. Store confirmed prediction bases as encoded images in the same concrete map
   type as rows. Validate/normalize their unchanged Option<String> JSON on load;
   decode at the base API. No durable format changes in this round.

The existing optional Binaryen build stage also tries narrowly scoped branch-tail
folding, duplicate-function elimination, dead-code elimination and vacuum, choosing
it only when gzip is smaller. Full -Os/-Oz optimization increases gzip here.
Comparisons now exclude the temporary filename in gzip headers. Final verification
uses Binaryen 132 on PATH; Rust 1.97.0 and wasm-bindgen 0.2.127 remain unchanged.

## Measured size ladder

Every source row is a successive build of this worktree, not an estimate from
symbol counts. Raw/gzip counts include wasm-bindgen; gzip uses the production
artifact filename and level 9. Whole-artifact gzip deltas are not additive
per-function costs.

| Build | Raw B | Gzip B | Saved from previous B |
| --- | ---: | ---: | ---: |
| Round 0 recorded | 2,082,607 | 607,622 | — |
| After main merge, rebuilt | 2,082,609 | 607,617 | 5 |
| Sorted page directory | 2,073,706 | 606,453 | 1,164 |
| Shared bulk/index container | 2,075,216 | 606,298 | 155 |
| One drain codec | 2,073,566 | 605,929 | 369 |
| Shared base-image map | 2,065,820 | 605,301 | 628 |
| Canonical base normalization and final source comments | 2,065,891 | 605,308 | −7 |
| Narrow Binaryen folding | 2,033,735 | 602,389 | 2,919 |

Final normalization retains canonical base-image bytes; the intermediate map
trial retained the valid input spelling. Without Binaryen, final source weighs
605,308 B gzip. With the selected pass it weighs 602,389 B. The final rebuild
reproduces the exact measured browser artifact.

Rejected Binaryen experiments on the fourth source rung: full -Os 687,965 B,
full -Oz 692,001 B, and merge-similar-functions/dce/vacuum 609,702 B gzip using
their temporary filenames (respectively 17, 17 and 14 bytes shorter than the
production gzip header). They are larger and not selected. Narrow folding was
602,296 B using a 12-byte-shorter header on that intermediate source.
No throughput profile, server-only substitution, reduced horizon, dropped word
index or weakened diagnostic/admission contract buys the remaining bytes.

## Exclusive apply attribution

Three fresh Chromium 151 contexts per account and device, eb1000 / EPYC 9454,
96 logical CPUs. The real SDK, copied full fixture, real password login, sync
server and strict IndexedDB path run normally. A temporary wasm patch surrounds
nested phases with performance.now() guards; nested time is subtracted from its
parent. Both account/device collections verify every stored row and a complete
offline inbox. There are no lane builds during these samples. Heavy load-1 ranges
23.14–64.35; small 15.33–17.21. These are **instrumented diagnostic times**, not
substitutes for the canonical paired acquisition measurements.

| Exclusive phase, ms (median) | u0001 default | u0001 Worker | u0500 default | u0500 Worker |
| --- | ---: | ---: | ---: | ---: |
| Word key validation/encoding | 745.4 | 744.1 | 9.9 | 9.2 |
| Word bulk-buffer insertion | 259.7 | 262.8 | 2.8 | 2.8 |
| Word sorting/index pages | 761.6 | 819.0 | 2.6 | 2.7 |
| Ordinary key validation/encoding | 724.5 | 741.8 | 40.0 | 42.7 |
| Ordinary bulk-buffer insertion | 597.3 | 595.7 | 31.6 | 34.1 |
| Ordinary sorting/index pages | 700.7 | 763.5 | 11.2 | 11.2 |
| Snapshot row staging | 890.8 | 972.6 | 79.7 | 82.5 |
| Replacement row traversal/bookkeeping | 1,758.0 | 1,825.8 | 117.1 | 118.2 |
| Delivery publication | 1,367.0 | 1,357.1 | 15.4 | 15.9 |
| Durable change construction (commit) | 490.3 | 519.1 | 38.2 | 40.9 |
| Remaining apply and JSON decode | 1,221.2 | 1,263.7 | 68.3 | 71.9 |
| Whole apply | 9,516.7 | 9,983.0 | 416.4 | 434.1 |

Column medians need not sum. Per-sample grouped totals give word indexes
1,774.5 / 1,845.4 ms (18.7 / 18.4%), ordinary indexes 2,020.2 / 2,118.9 ms
(21.3 / 21.2%), and rows/publication including remaining decode 5,722.3 /
6,001.3 ms (60.0 / 60.2%). On u0500, words cost 15.6 / 14.8 ms (3.7 / 3.4%),
ordinary indexes 83.7 / 88.4 ms (20.1 / 20.3%), and rows/publication 317.7 /
330.7 ms (76.2% in both modes). Retained phase samples and calls are in
phase-summary.json and browser-profile-u*.json.gz; summarize-phases.py reproduces
these aggregates. Timer-boundary overhead is included, not guessed away.

All 1,874,664 heavy physical index entries remain. Words contribute 905,414:
the two message indexes have 450,699 each and profiles has 4,016. That is 48.3%
of entries but only 18–19% of elapsed apply; entry counts alone would overstate
the gain. The other 969,250 entries and their key validation remain foreground.

The initial captured-command-only replay intentionally retained as apply-profile
is not used for this table: the old capture omitted SDK delivery initialization,
so its delivery publication was empty. The full-client run fixes that observation
gap. profile.patch.gz is diagnostic only; no counters or profiling dependency remain
in production source. The ordinary acquisition instrumentation changes JS timing
collection; only the attribution run adds the Rust phase timers.

## Proposed next step

LLP 3000.007 §20.4.1 keeps rows, ordinary indexes and coverage atomic, then
builds word indexes in bounded owner-scheduled chunks. Pending-index reads get
complete: false before empty-index/page early exits; ordinary online search can
use its existing server path, while mixed retained search cannot pretend server
rows cover unfinished Left history. Incomplete traversals cannot issue unsafe
continuations or prove absence. Word-dependent predictions wait for authority. Required key-byte/label admission
stays before row publication. A conservatively proved ASCII length bound is a
proposed way to avoid tokenization when it fits; every other case keeps exact
foreground validation. Without that proof, only buffering/sorting can move and
background regeneration adds work. The 1.5–1.8 s forecast is therefore an upper
foreground opportunity, not an unconditional saving.

The same section specifies concurrent edits on both sides of the build cursor,
revocation/expiry/adoption, generation/incarnation fences, strict pending-job
publication, browser rebuild-from-start after process loss, atomic native
key/checkpoint commits and an older-native-reader format fence. No durable
ready flag alone proves a new browser VM has indexes. Completion invalidates
search watches. Failures retain incomplete state.

This is a proposal, with scheduling overhead and busy-stream fairness still to
measure. It moves foreground readiness; fully search-ready time must still pay
all word construction. A second measurement-led step should reduce the 60%
row/publication share: profile stage encoding, staged-row decoding, row/dirty-map
insertion and delivery's reread separately, then share a validated bounded row
image with delivery only when its final row version is unchanged. A changed
version must take the ordinary final-image reread. This is a candidate to measure,
not a claim that all 60% is redundant or can be removed.


## Canonical before/after and retained gains

Five alternating AB/BA repetitions per account/device, with a fresh Chromium
context each time. Small uninstrumented timing and a separate phase series,
plus heavy phase series, give 60 samples in total. The control is the preserved
round-0 SDK; the candidate includes the required main integration as well as
these device reductions. Both use the same unchanged round-0 production server
and private fixture copy. No build overlaps the measurements. Loads are recorded
per sample: 3.98–12.87 heavy, 6.48–10.56 small timing. All 60 samples compare
every stored row/value to the delivered pages and pass complete offline inbox
checks. Heavy remains 105,034 rows, 12 responses; small remains 11,612 rows.

| Account/mode | Round-0 control, s | Candidate, s | Candidate first answer, s | Candidate wasm high-water B |
| --- | ---: | ---: | ---: | ---: |
| u0500 default | 1.879 | 1.895 | 0.381 | 28,311,552 |
| u0500 Worker | 1.976 | 2.099 | 0.484 | 28,311,552 |
| u0001 default | 18.549 | 18.396 | 0.405 | 307,691,520 |
| u0001 Worker | 19.186 | 19.165 | 0.496 | 307,625,984 |

The small Worker is 123 ms (6.2%) slower than this run's control, with the main
identity-wait integration included. Its range is 1.989–2.141 s; every sample is
below the approximately 2.2 s requirement, and its median is near round 0's
original 2.076 s. The default is 16 ms slower. These five-run results do not
establish zero regression. Heavy remains near round 0's 18.609 / 19.522 s and
far below AQ's roughly 24.5 / 25.6 s; memory remains about 308 MB rather than
769 MB. The requested sub-8 s total and 256 MB heap remain unmet.

Heavy apply is 8,491.9 → 8,394.6 ms default and 8,492.4 → 8,548.8 ms Worker.
Strict persistence is 4,457.9 → 4,483.9 and 3,340.5 → 3,437.0 ms. Server
production is 2,498.9 → 2,491.5 and 2,562.8 → 2,524.0 ms. None is a claimed
material improvement this round; the established gains survive the size work.
The sync guide now records the final candidate's measured expectation.

Using the diagnostic shares as estimates, the deferred-word proposal forecasts
row-ready time around **16.8–17.5 s default / 17.6–18.3 s Worker** before new
scheduler overhead. The optimistic end needs the reviewed admission bound;
keeping exact foreground key validation gives the conservative end. Fully
search-ready time still pays all work: at least about **18.4 / 19.2 s**, with
roughly 0.6–0.7 s more if background generation repeats foreground validation,
plus scheduling/checkpoint overhead. Nothing has measured those deferred times.


## What remains in the artifact

`production-functions.tsv` gives **every production item and its exact raw
shallow byte count** (8,438 items, exactly 2,033,735 B), including 8,302 code entries by their stripped `code[N]` index.
`retained-functions.tsv.gz` gives every surviving named function in a separately
built symbol-bearing counterpart. The code section is 1,925,951 B in production;
adding symbols at build time changes it by 1,305 B, so those binaries are **not
claimed byte-identical**. `artifact-sections.json` retains both hashes and section
sizes. The selected large functions below have the listed size in both tables;
names orient the corresponding production size entries, rather than inventing
independent gzip prices.

| Retained function | Production size entry | Raw entry B | Why it stays |
| --- | --- | ---: | --- |
| Runner statements closure | code[0] | 27,310 | Shared mutation interpreter |
| Runner row_changed | code[1] | 24,012 | Shared write/invariant maintenance |
| Runner insert_attempt | code[2] | 17,455 | Predictive insert behavior |
| Device call dispatcher | code[3] | 15,587 | Existing device operations |
| Runner merge_with_words | code[5] | 12,549 | Required device search |
| Device apply_publication_inner | code[8] | 9,699 | Atomic acquisition/coverage/publication |
| MemoryStore install | code[25] | 5,286 | Schema adoption and offline restore |
| Snapshot stage | code[45] | 4,017 | Private paged acquisition |
| Delivery publish | code[64] | 2,853 | Final-image delivery qualification |
| MemoryTx replace_rows | code[89] | 2,192 | Atomic old/new row-index boundary |
| MemoryTx put_image | code[164] | 1,458 | Compact validated row/index writes |
| MemoryTx unwind | code[182] | 1,344 | Transaction/savepoint rollback |
| MemoryTx commit | code[202] | 1,272 | Host persistence changes |

The named counterpart additionally retains Index::finish (486 B), Index::insert
(649 B), bounded drain_chunk (480 B) and their generic sort/container/codec
callees; the complete named table accounts for those separately. Inlining puts
some helpers inside their callers. Removing a named entry would not save its
raw size in gzip, and shared callees do not belong exclusively to one feature.
The per-change build ladder is the measured compressed attribution. The source
changes and narrow folding are the smallest tested artifact this round can
defend; recovering the remaining 8,670 B needs further representation/codec
work, not deleting any of these contracts. The full size cap remains a red.

## Reproduction and evidence

Run builds and tests from `snapback4/`. The selected artifact uses Binaryen 132
on PATH, `bash scripts/build-wasm.sh`, and the unchanged production gzip naming
convention. That command correctly exits 1 at the cap. `artifacts.json` binds the
actual wasm, server, paired control and private captured commands by SHA-256;
`artifact-sections.json` distinguishes production from the symbol counterpart.
All measurement SDK copies and the private fixture stay under ignored `target/`.

The paired command was the existing round-0 `tools/measure.py`, with both server
URLs `http://127.0.0.1:49762`, output this round's `paired/`, control
`target/hv/after-sdk`, and candidate `target/hv/round1-after-sdk` (SDK arguments
were absolute paths). It owns the five alternating repetitions and reverses
device order. To reproduce attribution, decompress and apply `profile.patch.gz` in a disposable
checkout, build/copy its diagnostic SDK, and run this directory's `browser.mjs`
with `AQ_DIAGNOSTIC=1 AQ_MODES=default,worker`, `AQ_ACCOUNT=u0001` and then
`u0500`, the diagnostic SDK path, and `3` as the final repetition argument.
Run `summarize-phases.py` against those outputs. Restore the patch before any
production qualification. The retained `.json.gz` and `.log.gz` files are ordinary
gzip archives; phase summarization reads them directly. No captured row payload
or login credential is included in this report tree.

## Validation

Affected device tests (`cargo test -p snapback4-device --lib --tests`) passed
**1,389**, with five declared ignores and no failures. This includes the new
bulk-directory boundary regression and the unchanged generated acquisition,
rollback, restore, coverage and disclosure tests. Focused browser durability,
format-3 upgrade, navigation and review checks passed **59/59**. The regenerated
delivery await inventory passed its detecting test **1/1**. The whole guide
passed **99/99**. Codec-family and server-only-symbol absence checks passed on
the disclosed named counterpart. `git diff --check` passed. Final
`./ref-check --verbose` passed: 524 LLP documents, 9,934 references, zero errors
and zero unchecked references. The diagnostic patch still applies cleanly.

Rust qualification used `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`,
`CARGO_BUILD_JOBS=8` and `RUST_TEST_THREADS=8`. The affected Rust run and the
required full suite overlapped; none of the browser performance samples did.
The full suite's Rust stage passed **4,348** tests, with 33 declared ignores.

Ran `scripts/test.sh` **exactly once**, with Binaryen 132 on PATH and the same
Rust environment above. It exited **1** with the exact final summary:

```text
== 1 failure(s) in 1248 s
   wasm build
```

Every failed full-suite stage is listed here: **wasm build — ours**, retained
round-0 size debt after this round's reductions, **602,389 > 593,719 B gzip**.
Baseline failures: **0**. Environmental test failures: **0**. Client tests passed
**5,186**, with ten existing skips and no cancellations; serial models passed
**79/79**, including 10,000 session and 3,000 online-client sequences. Fixture
wrappers passed **9/9**. Cargo build, docs budget, release guard, package build
and typecheck, chat check/typecheck and Expo typecheck all passed. The inherited
nominal 60-second suite budget remains missed; no count, timeout or budget was
relaxed. Setup errors and excluded experiments are enumerated in `FAILURES.md`.

## Native memory and generated regression

After both lane test processes finished, ran the existing Rust heavy-acquisition
test executable with `HV_NATIVE_ONLY=1`, `HV_CAPTURE` naming the hash-bound
private capture, `--nocapture`, and `/usr/bin/time -v`. All 12 heavy apply pages
and the final acquired-state assertion passed. Apply totaled **38,941.2 ms**;
process peak RSS was **96,000 KiB**. Gross tracked Rust peak was 66,786,030 B,
including 42,226,937 B of captured input/harness: **24,559,093 B incremental
peak**, with 27,110 B remaining after the final phase. SQLite/libc allocations
are counted by RSS, not by the Rust allocator. Host load-1 was 10.36 before /
10.18 after, with no lane builds or tests overlapping this replay.

This is a test-profile, allocator-instrumented Rust entry-point replay, not a
production native distribution or an iOS claim. It has the same delivery-setup
limitation as the captured-command control described above; full delivery cost
comes from the complete SDK attribution, not this replay. Native SQLite keeps
its existing representation. Against round 0's 38,882.5 ms / 96,000 KiB, this
does not claim a native speed or memory improvement.

The generated 6,000-row proportional regression also passed with stdout
retained: **20,551,766 B peak / 15,029,122 B retained**, versus **37,727,851 B**
for the old retained representation of the same rows and keys (peak **54.5%**).
The largest drain string remains **302,739 B**. It checks bounded bridge output,
row count, complete acquisition and complete offline restore, with the unchanged
90% proportional threshold; it does not assert wall-clock speed. The original
round-0 peak was 20,554,286 B. `native-final.log.gz`, `native-host.json`,
`native-summary.json` and `generated-final.log.gz` retain this round's evidence.
