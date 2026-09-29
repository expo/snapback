# HV round 0 — heavy acquisition

Five alternating before/after runs reduce heavy acquisition by about 24% and
wasm high-water memory by 60%. **The requested heavy-account targets remain
unmet.** The small account improves. All rows and offline completeness survive;
format-3 stores upgrade locally without a redownload.

## What the baseline was spending

AQ's final implementation is the control (aedd35615ad54901a481a01481e5d8f6110c69b4).
u0001 has 1,000 memberships, 90,500 messages and 105,034 total acquired rows;
12 responses transfer 39,759,320 B. Logical residency is 46,208,785 B. These
are the same account, rows and horizons before and after.

The diagnostic default-device baseline reached 769,064,960 B of wasm linear
memory. Pages 1–11 applied in roughly 200–230 ms each (the small last page
54 ms), with the heap below 98 MB. Terminal publication took 7,249.5 ms and
grew memory to 651,427,840 B; draining added 526.3 ms and raised the high-water
mark to 769,064,960 B. This was principally publication and export, not retained
wire bytes. Linear memory does not shrink after those transients disappear.

A native allocator replay of the same commands separates retained data from
that high-water mark. The baseline's incremental peak was 795,018,108 B and
retention after drain was 593,147,053 B, excluding 42,226,811 B of captured
input/harness. This is Rust allocation on a 64-bit host, not wasm RSS. The
terminal call cumulatively allocated about 2.27 GB. Its old representation had:

- 215,667,483 B of dynamic row-field trees;
- 1,874,664 physical index entries, with 158,847,322 logical key bytes in
  199,082,184 B of Vec capacity;
- another 48,912,526 B of repeated row-id strings, before tree nodes and
  descriptors. The two message word indexes alone have 450,699 keys each.

Chrome sampling attributes 5,349.7 ms inclusively to replacement, 4,663.2 ms
to row puts, 2,461.5 ms to index insertion, and 1,585.9 ms to key construction/
validation. These stack totals overlap. The exclusive categories in
`evidence/cpu-summary.json` put only 19.1 ms in coverage, versus 2,928.5 ms
in row/index construction, 2,422.3 ms in other publication work and 937.3 ms
in commit encoding. Coverage is not a useful place to discard work.

Format 3 repeatedly rewrote growing staging buckets. Across the large saves,
staged bucket strings grew from 6.45 MB written on the first page through
63.37 MB on a later page, then 53.43 MB at publication. The terminal delta
contained 214,009 changes. Bucket rebuilding and overflow requests explain
most persistence CPU: sampled `writeBucket` includes 3,547.2 ms; JS JSON
work includes about 3,059.8 ms. Both are inclusive sampled costs.

Read-only server attribution identified live `unread` certification as the
largest production cost: 3,738.2 of 4,943.3 ms in the allocator-instrumented
Rust test, compared with 1,037.4 ms for messages. These are attribution runs,
not production HTTP measurements. Bounded source scans reduce `unread` to
1,856.8 ms and total instrumented production to 2,971.2 ms. Every source row
still receives its ordinary expiry, row-rule and field-disclosure verdict.

## Implementation and contracts

The memory store retains tagged JSON row images and decodes bounded read pages.
Canonical stages share their row substring with the published row and pending
change; noncanonical stages take the compatible decoder path. Metered reads
reserve decoder and result memory before allocating. Compact keys share encoded
row-id suffixes and row-id handles while preserving every key byte. Replacement
bulk-sorts keys into index pages. One old row/index image supports rollback;
indexes are complete before prediction replay or coverage becomes visible.

The bridge emits at most 512 changes and approximately 256 KiB per string,
allowing one indivisible oversized record. JS collects the entire vector and
commits it once. This bounds wasm drain scratch; it is not a claim that the JS
host never holds a full publication batch.

Built-in default and Worker devices use format 4: bounded structured-clone row
pages and one key-directory record per page. A strict transaction updates row
pages, directory, metadata, outbox and revision together. A complete page of
staging deletions can be discarded without fetching its payload. Cached directory
revisions are checked in the write transaction; the cache changes only after
completion. Conditional authority checking and explicit commit share one callback
turn. A failed save still discards the uncommitted VM.

Existing format-3 stores upgrade locally in one strict transaction, preserving
all logical rows, stage state, prediction bases, outbox and metadata. There is
no redownload. Migration is linear in the existing store and temporarily holds
its images in JS. Its aborted transaction leaves format 3 intact; the upgraded
client can retry. Physical database version 3 fences actual old clients at
version 2. Updated page/Worker bundles must be available for offline opening.
The public persistence adapter still creates format 3 and understands both;
custom providers receive the unchanged `Change[]` contract.

Cold server snapshots skip the optional per-member small-range probe and fetch
certification candidates in pages of 32 under declared decoder reservations.
When a decoder page would exceed the remaining heap allowance, certification
uses the original one-candidate path. Ordinary queries, writers and streams
keep their previous procedure. No cached count substitutes for the live basis. No row, index, horizon, coverage marker,
strict commit, restore fence or logical runtime ceiling was removed.

## Final paired results

Five AB/BA repetitions per account/device/build, fresh Chromium 151.0.7922.34
on eb1000 (AMD EPYC 9454, 96 logical CPUs), loopback transport. No sample overlaps
our builds. Heavy samples have one-minute loads 3.24–10.71; small samples
9.55–26.87. Raw loads, CPU pressure and browser version accompany every sample.
Column medians are independent statistics, not an additive critical-path trace.

| Account / mode | Before acquisition | After acquisition | After first inbox | After wasm heap |
| --- | ---: | ---: | ---: | ---: |
| u0500 / default | 2.199 s | 1.945 s | 0.416 s | 28,311,552 B |
| u0500 / worker | 2.298 s | 2.076 s | 0.499 s | 28,311,552 B |
| u0001 / default | 24.517 s | 18.609 s | 0.441 s | 307,625,984 B |
| u0001 / worker | 25.597 s | 19.522 s | 0.520 s | 307,691,520 B |

u0500 uses uninstrumented timings comparable to AQ’s ~2.2 s. u0001 uses the
same phase instrumentation on both sides. The heavy default after range is
18.582–18.775 s; Worker 19.366–20.042 s. Before ranges are 23.804–26.008 s
and 25.406–25.746 s respectively. All 60 samples verify their acquired rows and
complete offline inbox. Both heavy builds transfer 39,759,324 B in 12 responses
and retain 105,034 rows; the four-byte difference from AQ’s earlier capture is
recorded rather than silently normalized. Logical residency remains 46.21 MB.

| Heavy phase, ms | Default before | Default after | Worker before | Worker after |
| --- | ---: | ---: | ---: | ---: |
| Server production | 2,939.3 | 2,509.8 | 2,955.4 | 2,557.0 |
| Header wait | 2,979.8 | 2,555.1 | 3,035.1 | 2,604.2 |
| Body consumption | 363.4 | 399.4 | 381.7 | 456.3 |
| Outer JSON decode | 88.1 | 98.9 | 100.2 | 117.2 |
| Wasm apply | 9,357.7 | 8,401.2 | 9,397.0 | 8,474.0 |
| Drain | 885.4 | 673.7 | 891.9 | 675.7 |
| Other wasm | 695.7 | 696.0 | 786.9 | 772.5 |
| Strict persistence | 8,826.0 | 4,555.9 | 8,346.9 | 3,566.0 |
| First inbox answer | 415.1 | 440.5 | 481.2 | 520.1 |

The default page still has a 6,718 ms longest task (before 7,827 ms); the
Worker keeps that work off the page (no observed page task over 50 ms). Its
responsive inbox refreshes also run more often: 57 completed screen requests
by acquisition versus 16 on the default. This contributes to the different totals.

Persistence keeps **12 large strict transactions** on both builds. On those
large saves, reads fall from 3,137 to 22 and puts from 16,411 to 5,044, including
502 row-page and 502 directory-page puts. Format 3 writes 439,948,091 bucket
characters; format 4 writes 102,277,276 row-key/value characters (different
physical encodings, not a claim about exact disk bytes). Total Worker strict
transactions are 50 before / 51 after; default 65 / 62. Metadata saves remain
strict. No transaction count was reduced by skipping publication or custody.

Against the requested Worker targets: total 19.52 > 8 s; apply 8.47 > 3 s;
persistence 3.57 > 2.5 s; server 2.56 > 1.5 s; heap 307,691,520 > 256,000,000 B
(also above 256 MiB). The default misses the same targets. This is an
improvement with an explicit remaining performance gap, not heavy-account
qualification for phones or Macs. The remaining work is tracked in
[the repository ticket](../../../issues/20260929-snapback4-heavy-acquisition-remaining-budget.md).
See the attribution and remaining limits below.

## Native memory and remaining limits

The final replay uses the exact 12 browser apply pages through Rust `call_text`.
The MemoryStore allocator records 42,236,367 B of input/harness, gross peak
357,172,013 B and gross post-drain retention 263,016,144 B: **314,935,646 B
incremental peak / 220,779,777 B retained**, versus 795,018,108 / 593,147,053
before. Apply is 4,535.2 ms and bounded drain 324.0 ms in this diagnostic native
replay (before 5,779.4 / 340.9 ms). These are attribution runs, not five-run
production-native latency distributions.

The actual native SQLite device uses the shared apply state machine and keeps
its original SQLite representation. Its isolated replay passes all commands and
acquired-state assertions: **38,882.5 ms apply, 96,000 KiB process peak RSS**.
Rust allocator peak above the captured input is 24,559,093 B, with 27,110 B
remaining at the final phase; SQLite/libc allocation is included only by RSS.
The process includes the 42.23 MB captured input. Test-profile compilation and
allocator instrumentation make this neither an iOS timing claim nor a native
throughput improvement claim. The first native-only attempt overlapped the end
of the combined replay; it is retained as an excluded setup sample and was
rerun alone. `native-host.json` records load during the isolated replay.

A final symbol-bearing Chrome profile independently locates the remaining CPU:
replacement 4,411.2 ms, staged row puts 2,329.1 ms, bulk index construction
1,406.2 ms, index-key validation/encoding 1,379.4 ms, delivery publication
1,363.9 ms and bridge drain 667.5 ms, inclusively. These stack totals overlap;
coverage remains only 22.4 ms. JS key-directory key encoding samples 676.5 ms.
The profile has its own recorded load (3.53) and is excluded from the paired
medians; symbol-bearing wasm is not the shipped artifact. See `cpu-functions.json`
and `cpu-summary.json` under evidence.

Remaining costs are concrete. The final terminal apply alone allocates a
cumulative 2,164,576,026 B; all apply pages allocate 3,360,169,183 B, close to
baseline’s 3.41 GB despite the smaller retained representation. Tagged row
parsing, key encoding/validation, 1,874,664 ordered index entries and publication
bookkeeping remain. Compact storage removes copies and retained field trees;
it does not remove those computations. Atomic publication still completes all
indexes before exposing coverage. Bounded wasm draining still hands JS a full
214,009-change publication vector, so strict persistence must clone substantial
row payloads even after eliminating growing bucket rewrites. Server production
still certifies the live unread basis and emits almost 40 MB; final HTTP engine
time is about 2.1 s plus 0.43 s preparation. The requested 1.5 s production goal
would require further work on that path. No discarded index, stale count,
smaller horizon or weaker durability is offered as a solution.

The proportional generated regression uses 6,000 rows and both word-search
shapes. It compares the new apply peak with the old representation of those
same rows and keys, bounds drain strings, and restores a complete offline
partition. Final generated peak is 20,554,286 B versus 37,727,851 B for the old retained
representation (54.5%); retained is 15,043,002 B and largest bridge string
302,739 B. Its 90% threshold is independent of host scheduling. It does not
pretend to enforce a stable absolute millisecond deadline under shared load.

## Validation, artifact size and disposition

The required single `scripts/test.sh` invocation ended
**`== 1 failure(s) in 1493 s`**, exit 1. All Rust targets passed; browser/client totals were 5,123
passed / 1 failed / 10 skipped, and the final seeded models passed 79/79.
The sole failure was ours: `every delivery await is explicitly classified`,
a stale hash inventory. Its refreshed classification passes the focused recheck;
no fault recipe or existing test assertion changed. No baseline or environmental
product failure was observed. The initial affected-browser run found two own
failures (metadata-only save and an incorrectly named new test query); the
corrected navigation/upgrade recheck passed all 29 tests. See FAILURES.md.

Final affected browser checks pass **59/59** on the canonical artifact. The
whole guide passes **99/99** after the measured sync-card update. Both final
cold-basis regressions pass, including fallback to single-row admission when
a 32-row reservation would exceed available heap. `ref-check --verbose` reports
524 LLP docs / 9,928 refs, zero errors and zero unchecked references. The final
server fallback was added after the paired run; it leaves this fixture’s 32-row
branch unchanged and has its own admission regression. The canonical wasm is
byte-size identical after that server-only correction.

Final canonical wasm: **2,082,607 B raw / 607,622 B gzip**, versus the rebuilt
baseline 2,040,529 / 592,975 (+42,078 raw / +14,647 gzip). It exceeds the original
593,719 B cap by **13,903 B**. The documented ratchet is **608,622 B**, measured
plus 1,000. Compact rows, shared keys, paged bulk indexes and bounded draining
account for this whole-artifact change; TypeScript persistence and server
batching are outside the wasm. No per-component size attribution is claimed.
All exploratory failures and their corrections are in FAILURES.md.

The throughput compiler experiments were rejected: whole-profile opt-level 2
weighed 978,231 B gzip, and device-only opt-level 3 weighed 967,439 B. The latter
trial applied the heavy account in about 6.22 seconds, but still missed the goal
and cost about 370 KB over the original cap. The shipped profile remains size-first.

No push, package publication or deployment was performed.
