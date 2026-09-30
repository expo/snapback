I'll review lane NA round 0 against the report and the diff, checking each claim with a concrete reproduction rather than taking the write-up at face value. First I'll read the review workflow and the report so the checks match what was claimed.The request is a claim-by-claim verification of the native-acquisition lane, not a GitHub review. I'll read the report, the lane brief, and the diff range before checking anything.Auto-compacting conversation (80% full)...
Conversation compacted.
The earlier pass matched the report’s numbers to the receipts, but the live checks are still open: row and index equality, a scratch revert of the sort, crash and disk-full behavior, and whether memory stays bounded. I’ll run those next without changing the tree.The baseline replay matches the captured store. Next I’ll time the sorted build and sample its memory and temporary-file peak.**READY.** The speedup is real, the acquired store matches the unsorted baseline, and durability settings still hold. The 10-second target is still missed, as the round says.

I did not change the tree or push. Checks used the preserved binaries and scratch databases under `/tmp`.

## What was compared

The baseline binary `d23ffa1822…` does not contain `_device_index_load`. The final library `bf9eb9db4c…` does. Both replayed the same captured heavy account (1,000 memberships, 105,034 rows, 1,874,664 index entries).

| | Baseline, no sort | Sorted final C ABI | Author's receipt |
|---|---:|---:|---:|
| Apply | 36.692 s | 8.933 s | 38.071 s with strace / 8.968 s |
| Wall | 37.675 s | 9.645 s | 39.12 s / 9.693 s |
| Peak RSS | 50,424 KiB | 62,108 KiB (`ru_maxrss`); sampler 67,672 KiB | 50,028 / 61,284 KiB |
| Final page | 34.764 s, the only publish | 7.198 s, the only publish | 39.809 s process IPC / 8.968 s apply |

Rows, index tuples, cap counts, residency counters, and every meta value except per-database `store_id` hash-match across this baseline replay, this sorted replay, and the author's final database. Integrity checks passed. Journal mode is WAL and `synchronous` is FULL (`2`); cache is −2000, mmap is 0, `temp_store` is 0. Sorted packing is 91,189 pages versus 91,604 unsorted.

## Claims

**1. Attribution — confirmed.** On the baseline process trace, exclusive spans sum to 42.125 s against 42.195 s of apply IPC. The difference is 70.7 ms. Index SQL is 33.369 s and 1,151,258 calls, and all of it is on the empty final page (seq 59, 39.809 s). The eleven earlier pages are 75–296 ms. Page 55 has `more: false` but `stage_snapshot: true`, so it only stages (74.6 ms, no index work). Commit is 2.246 s, row SQL 1.321 s, staged puts 1.006 s, word keys 0.497 s, ordinary keys 0.401 s, delivery 0.654 s, history coverage 0.140 s, boundary save 0.000548 s, decode/dispatch 0.430 s. The live untraced baseline replay landed in the same band as the straced 38.071 s figure.

**2. The sort is a large win, and 10 s is still missed — confirmed.** Direct apply fell from 36.7 s to 8.9 s on this host. The witness medians in `measurements.json` match the report exactly: unconfined heavy 42.352 s (41.494–42.698) to 12.895 s (12.760–13.025); loaded 54.542 s to 14.654 s; small account 1.306 s to 1.056 s unconfined and 1.508 s to 1.042 s loaded. That is 69.6% and 73.1%. The unconfined gap to 10 s is 2.895 s. I re-ran the device apply, not the three-run witness or the CPU-burner series.

**3. Durability — confirmed, including the new load.** Pragmas are unchanged. Re-running the crash binary matched the final log: 12 SQLite kills at 1,503 and 1,610 VM cuts, and 12 memory-image kills at 1,228 and 1,775, in 5.3 s. The memory cases are an atomic file rename, not a browser kill; the report says that. A `SIGKILL` once the heavy sort held about 204 MiB of temp files rolled back to a staged, unpublished store: integrity ok, 0 rows, 0 index entries, 0 caps, 0 residency, `acquired` absent, all 105,034 staged rows kept, 16,234 pages (the same shape as the author's staged capture). WAL and FULL synchronous mode were still set. Replaying the old page bytes after that kill is refused with `E_GENERATION` (send-revision and restore-cursor echoes). That is the existing restart fence, not a torn publish. Filling the temp file to 180 MiB on the final page returned retryable `E_STORE` / disk I/O error; the same connection then published, and the result matched the good sorted store on rows, indexes, caps, residency, and meta.

**4. Wasm size and the suite — consistent with the receipts, not re-executed.** The wasm blob is 1,978,828 bytes, gzip −9 is 593,233, sha256 `e0652576…`, and it does not contain `_device_index_load`. SQLite publication is behind `feature = "native"`; `memory.rs` is not in the diff. `full-suite.exit` is 0 and the log ends with `== 0 failure(s) in 1380 s`. I did not rebuild wasm or rerun the suite.

## What the acquired device holds

Nothing logical changed. The identical index includes 905,414 word-index entries (`messages` word indexes are 450,699 each, plus 4,016 profile word entries), the unique and ordinary indexes, and 183,000 expiry-index entries. All 90,500 messages have a non-null `expiresAt`. Cap rows are 2,000 reaction groups, each with count 1. Horizon state is 1,005 `device:acquisition-boundaries` values (1,001 `whole`, 4 narrower) and is copied from staged server meta after the index is installed, not recomputed from sort order. Post-acquire `query`, `delivery`, `witness_coverage`, and `residency` in the capture all succeeded. There is no incremental `apply` after publication in that capture. Ordinary writes still go through `Tx::put`, not the temp heap. The bulk test, re-run here, checks sorted replacement against ordinary inserts, loader failure, duplicate-index failure, rollback, and a later delete plus put.

## Residuals, by severity

**Medium — scratch disk grows with the index; RAM does not.** Bundled SQLite is `TEMP_STORE=1` and the product leaves `temp_store` at default, so temp files are on disk. The sorter cap is `max(250 pages, 2 MiB cache)` with worker threads defaulting to 0, so the in-memory run is about 2 MiB. RSS stayed about 62–68 MiB while unlinked temp files grew to 699,438,280 bytes. The high-water mark at one sample was those temp files plus a 304 MB WAL plus the 64 MB staged database, about 1.07 GB, for a final database of 373.5 MB. That space is released when the connection closes, including on `SIGKILL`. It is not bounded by the 2 MiB sorter cap. A device that can hold the finished store can still fail mid-publish; the failure path above was clean.

**Low — 10 s is still open.** On the instrumented candidate, the final page was 9.07 s: sort/install 2.858 s, temp index inserts 1.448 s (still 1,151,258 calls), row SQL 1.384 s, commit 0.981 s, delivery 0.620 s, word keys 0.379 s, ordinary keys 0.317 s. The final binary's direct apply is 8.93 s; statement reuse and the one-shot residency scan account for the drop from the candidate's 10.25 s. The next device win is to stop writing the index twice (temp heap, then ordered install). Those two steps are about 4.3 s of the profiled page. Commit is not fsync-bound: the whole baseline and candidate replays were 141 fsyncs and about 0.24 s. Server sync, about 2.6 s unconfined, sits in the 12.9 s witness and outside this apply.

**Low — crash sampling is not every instruction of the heavy sort.** The model takes 12 cuts out of about 1,500 SQLite VM points on a small fixture. One heavy kill and one disk-full failure cover the new transaction, and that transaction does not commit until rows, the sorted index, residency, boundaries, expiry, delivery, predictions, and `acquired` are all written.
