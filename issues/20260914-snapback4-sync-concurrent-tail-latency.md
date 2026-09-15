# Snapback 4: concurrent sync tail latency remains a performance target

Status: Open — periphery performance follow-up
Owner: Snapback 4 performance lane
Date: 2026-09-14

The isolated native Linux sync serialization experiment improves all eight
case-median p50/p95 values and throughput, with the strongest latency gains
at concurrency one. Three median tail comparisons regress:

| Warm loopback case | Metric | Baseline → candidate |
|---|---|---:|
| 64-event first snapshot, C8 | Maximum | 18.490 → 20.308 ms (+9.83%) |
| Stream requested at 4,000 events, C8 | p99 | 163.665 → 180.840 ms (+10.49%) |
| Same stream case, C8 | Maximum | 176.624 → 194.659 ms (+10.21%) |

The stream actually returns 3,584 events at the fixture's commit boundaries.
The 4,000-event first snapshot C8 p50 is effectively flat (59.138 → 59.100
ms). Eleven correlated same-trial metric losses remain in the evidence;
case medians do not erase them.

Evidence: the [benchmark record](../benchmarks/runs/snapback4-public-catalog-20260913/README.md),
storage workload `sync-wire-0212-perf-v2-formal`, fixed source `206650f29`
(0.2.12) plus the two host serialization files. Independent summary
`b0c99e32…`, review `aa0b1d09…`, and reconciliation `08196368…` are retained
under `.llp/ship-runs/sb4-performance-20260913/`. All 9,600 timed calls and
the full ordinary-auth/page checks passed. These are source-built local
results, not device, hosted, cold-cache or matched-durability measurements.

Next: use the existing fixed workload to distinguish server response work,
connection scheduling and client-side JSON/hash work under concurrency.
The latency timer ends after HTTP/text/JSON parsing; full-response hashing
is outside that timer but inside case elapsed time and can delay overlapping
callbacks. The present evidence does not identify which component caused
the tails. Preserve all results and lifecycle bounds when changing the
instrument. Keep auth, held/joined groups, exact cursor/event bytes and
the response ceiling unchanged; no result or authority cache.

Close after a reviewed follow-up produces repeated, complete comparable
results resolving these tails, or records an explicit measured disposition
with the remaining limitation. Do not count lower medians alone as closure.


## 2026-09-15 — all-sync reader reuse remains experimental

The fixed 788c21d6 / 0.2.22 candidate improves small/empty sync, but does
not close this ticket. Large next-snapshot C8 p95 rises 77.745 → 84.177 ms
(+8.27%) and throughput falls 1.82%; large-stream C8 p95 rises
101.467 → 123.693 ms (+21.90%) and throughput falls 2.03%. Every median
metric for the large next-snapshot C8 case worsens. Across all ten cases,
10 median and 34 same-trial metric losses remain, with elapsed/rate counted
separately. The six-run experiment passes all 12,000 timed requests and
1,200 warmups, full authorized walks and original cleanup checks.

Process RSS after cases has medians 104,748 → 194,760 KiB (+90,012 KiB),
and lifetime HWM 129,488 → 204,416 KiB. Both increase in every pair. These
are two untimed observations per process, not isolated cache allocation or
a continuous peak measurement. The candidate was restored without landing.

Next: measure retained SQLite connection state separately from process
allocator retention and overlapping owned response buffers. Keep the
complete ten-case workload, all regressions, fresh authorization/transactions,
watermark-bound acknowledgements and native-epoch invalidation. The full
record is storage workload `sync-reader-reuse-0222-v1-perf-formal`; exact
source and original evidence live in the existing benchmark record and
`.llp/ship-runs/sb4-performance-20260913/`.


## 2026-09-15 — cache cleanup does not resolve pooling tradeoffs

The second fixed 788c21d6 / 0.2.22 variant flushes statements and releases
SQLite caches before pooling successful sync readers. It passes 12,000
timed requests, full auth/walk checks and original cleanup. Both frozen
calculations and the independent review pass, retaining nine median and
27 paired metric losses. The candidate is not adopted.

Empty-stream C8 p50 improves 4.060 → 1.365 ms, but large next-snapshot C8
p50/p95/maximum and large-stream C8 p50/p95/p99/rate regress. After-case
RSS medians rise 83,064 → 150,112 KiB; two paired RSS observations rise
and one falls. Reported VmHWM medians rise 123,560 → 181,180 KiB. These
are process points, not causal allocation or validated continuous peaks;
the native diagnostic's same-process VmHWM decreases qualify earlier
lifetime-HWM wording. Separate batches cannot establish that cache cleanup
caused an improvement relative to the first rejected variant.

Evidence is storage workload `sync-reader-reuse-0222-v3-perf-formal` and
the existing benchmark record. The tracked runtime never changed. One
optimization round remains: investigate already-caught-up empty polls
without pooling large sync responses. Any promising shared-pool candidate
still needs a mixed query/sync check before adoption.
