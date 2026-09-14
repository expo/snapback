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
