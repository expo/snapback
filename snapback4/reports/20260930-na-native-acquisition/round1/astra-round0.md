**READY WITH CHANGES.** The speedup and transactional behavior check out. One memory claim needs narrowing; I found no new runtime correctness defect.

**P2 — Whole-device memory is not independent of partition size.** [REPORT.md:89](/home/ccheever/sb4-intent/review-na-r0-astra/snapback4/reports/20260930-na-native-acquisition/REPORT.md:89) overstates the guarantee. Publication retains per-row [delivery candidates](/home/ccheever/sb4-intent/review-na-r0-astra/snapback4/crates/snapback4-device/src/device/delivery.rs:13). In a synthetic larger-partition replay, increasing rows from **105,034 to 195,534** increased final-page Rust peak allocations from **21.48 to 37.99 MB**, and process RSS from **50,084 to 88,736 KiB**. This is inherited behavior, not a sorting regression. Narrow the claim to the sorter’s spilling behavior and measured memory results.

The four claims checked as follows:

| Claim | Concrete result |
|---|---|
| **Attribution** | Recomputed the recorded spans: **33.369 s** index insertion, **39.809 s** final page, **70.658 ms** apply IPC remainder. Reverting all four runtime files in scratch reproduced **36.93 s** typed apply, including **29.99 s** index work. This supports the reported 38.1 s direct replay and dominant bottleneck. |
| **Speedup** | Fresh process witnesses reproduced **41.81 → 13.21 s** heavy acquisition and **1.03 s** small acquisition. A clean three-run loaded series produced a **14.05 s** heavy median. The report’s medians recompute correctly. **The 10 s target remains unmet.** |
| **Durability** | Verified WAL and `synchronous=FULL` on the executing connection. Reran all **48 kills**—24 SQLite, 24 memory-save model—and the bulk regression. Injected `SQLITE_FULL` during temporary loading and final index installation, plus OS `ENOSPC` during sorter spill. Each preserved the previous published state; retry succeeded with identical final physical hashes. |
| **Wasm and suite** | Wasm matches BN byte-for-byte: **1,978,828 raw / 593,233 gzip bytes**. Verified the full-suite log’s **0 failures in 1380 s**, artifact hashes, and unchanged source manifests. I reran affected tests, not the entire suite. |

Additional checks:

- **Rows, indexes and coverage:** reverted and optimized replays produced identical hashes for all **105,034 rows**, **1,874,664 index entries**, residency counters and final sync state. Bulk and affected tests passed for words, unique/cap behavior, expiry, horizons, retained history, prediction and incremental updates.
- **Sorting memory:** increasing word-index entries to **7.67 million at the same row count** left final-page Rust peak essentially unchanged; SQLite peak rose from **9.19 to 11.18 MB**. Spill files were observed. This supports the optimization’s memory behavior, without establishing a phone-wide memory bound.
- **Web:** the changed executable paths are SQLite-specific; the shared trait changes are documentation. The wasm artifact is unchanged.
- **Crash limits:** the successful tests cover sampled process kills and targeted storage failures, not exhaustive instruction-level or physical power-loss testing.

The next bottleneck is **bulk sort/install: 2.85 s**, followed by **commits/checkpoint work: 1.68 s** and temporary index insertion: **1.09 s**. Server sync adds roughly **2.7 s**. Further gains should target index construction and temporary I/O; transport is too small to explain the remaining gap.

[Reverted replay evidence](/tmp/na-review-astra-BFa1ry/reverted.jsonl), [sorter ENOSPC evidence](/tmp/na-review-astra-BFa1ry/full-sorter.jsonl), [larger-partition memory probe](/tmp/na-review-astra-BFa1ry/rows2.jsonl).

The checkout is unchanged. Nothing was pushed.