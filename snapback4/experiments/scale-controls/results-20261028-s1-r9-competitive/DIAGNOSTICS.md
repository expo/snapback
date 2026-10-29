# SPR9 diagnostic companions

One companion per qualifying/first-failing write rung, after the native campaign. Inconclusive cells receive explicitly labelled informational reference/challenge companions instead; they cannot repair a missing native result. Product PROFILE/STATS/SERIES and the SQL/wait observer are enabled only here. No companion is used for native SLO qualification. Means are milliseconds unless stated. Phase clocks use before/after product snapshots and include warm-up and drain; their p99s are histogram upper bounds. Occupancy is time weighted over the estimated measured 20 s, using the historical resource-sampler start + 100 ms launch allowance + 10 s warm-up anchor, as in the CPU ledger. Event timestamps are milliseconds; peaks include duplicate-timestamp events. Missing coverage is N/A, with no terminal extrapolation.

| Cell | Rate /s | Companion p/f | Sent mean upper ms | Loans mean / p99 / peak | Resolved−W mean / p99 / peak | Outcome-confirm→prefix release mean / p99 ms | Direct dispatch→owner/lane mean / p99 ms | Pool wait mean ms | Loan custody mean / p99 ms |
|---|---:|---|---:|---|---|---|---|---:|---|
| W4-disjoint-A | 3200 | PASS | 6.1065 | 16.34 / 27.00 / 29.00 | 1.41 / 12.00 / 22.00 | 0.324 / 1.950 | 0.070 / 0.900 | 0.001965 | 5.165 / 8.400 |
| W4-disjoint-A | 3805 | PASS | 7.1046 | 20.57 / 28.00 / 29.00 | 2.76 / 17.00 / 28.00 | 0.487 / 3.000 | 0.285 / 2.500 | 0.004640 | 5.391 / 9.550 |
| W4-disjoint-B | 4525 | FAIL | 8.4338 | 22.41 / 28.00 / 29.00 | 3.24 / 18.00 / 28.00 | 0.568 / 3.150 | 0.586 / 2.950 | 0.011734 | 6.163 / 10.150 |
| W5-hot1-A | 3200 | PASS | 6.2422 | 16.50 / 27.00 / 29.00 | 1.53 / 13.00 / 24.00 | 0.363 / 2.100 | 0.093 / 1.200 | 0.002406 | 5.235 / 9.300 |
| W5-hot1-A | 3805 | FAIL | 8.7250 | 19.47 / 28.00 / 29.00 | 3.52 / 18.00 / 32.00 | 0.613 / 3.200 | 1.068 / 21.550 | 0.005783 | 5.437 / 9.050 |
| W5-hot1-B | 3200 | PASS | 6.8754 | 18.38 / 28.00 / 29.00 | 1.67 / 13.00 / 29.00 | 0.394 / 2.700 | 0.102 / 1.200 | 0.002987 | 5.847 / 9.900 |
| W5-hot1-B | 4525 | FAIL | 8.4486 | 22.30 / 28.00 / 29.00 | 3.36 / 18.00 / 29.00 | 0.600 / 3.150 | 0.692 / 3.300 | 0.011249 | 6.064 / 9.250 |
| W5-same-A | 1600 | PASS | 10.7347 | N/A | N/A | 0.132 / 0.200 | 37.790 / 52.600 | 0.003891 | 4.119 / 13.800 |
| W5-same-A | 2262 | PASS | 11.6683 | N/A | N/A | 4.190 / 12.400 | 40.677 / 54.350 | 0.003936 | 4.135 / 13.700 |
| W5-same-B | 1131 | PASS | 12.7111 | N/A | N/A | 0.112 / 0.150 | 31.268 / 48.150 | 0.002855 | 3.423 / 6.950 |
| W5-same-B | 1600 | PASS | 13.6729 | N/A | N/A | 0.104 / 0.150 | 52.664 / 71.950 | 0.002671 | 5.026 / 14.750 |
| W4-disjoint-B | 3200 | PASS | 6.9193 | 18.69 / 28.00 / 29.00 | 1.59 / 13.00 / 26.00 | 0.353 / 2.550 | 0.086 / 1.000 | 0.002347 | 5.838 / 9.400 |

The product pool has 29 data loans and 32 total sessions. Catch-up borrows data loans; owner/lease/control retain their budget. Footprint/result holds through W are distinct from physical loan custody. Prefix release clocks include failed/void outcomes and exclude later HTTP transmission. Direct dispatch measures submission through entry to the owner closure and lane lock, without identifying which mutex waited. Nested clocks are not additive. There are no application readers in these write-only cohorts, so this is not a mixed-reader progress witness.

Companions: 12; incomplete series: 4.

**W4-disjoint-B at 3200/s:** Informational native reference/challenge for an inconclusive cell; not a qualifying or first-failing ceiling and not a replacement native repetition.
