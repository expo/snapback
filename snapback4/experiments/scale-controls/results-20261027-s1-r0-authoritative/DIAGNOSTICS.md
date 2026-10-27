# W4/A R0 diagnostics

Native sent means and CPU/WAL belong to the qualifying native repetition. Prefix/loan values are from its separately labeled, fresh-service diagnostic companion; they are not asserted to describe the identical native window. Means are milliseconds unless labeled otherwise. `p99` for wait/custody uses 50 µs histogram upper bounds. Occupancy is time weighted over the companion’s 20 s measured window at millisecond timestamp resolution; peaks include all recorded events, including duplicate timestamps. Available data width is **29**, total product cap **32**.

| Rate /s | Rep | Native sent mean upper ms | Native app / PG CPU ms/ACK | Native WAL B/ACK / syncs/ACK | Companion resolved−W mean / p99 / peak | Companion commit-confirm→ACK-release mean / p99 ms | Companion loans mean / p99 / peak | Pool wait mean / p99 ms | Loan custody mean / p99 / max ms | Companion clean? |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| 2,690 | 1 | 5.8866 | 0.3247 / 0.5380 | 2028.1 / 0.13047 | 0.89 / 9 / 24 | 0.442 / 2.100 | 14.09 / 26 / 29 | 0.007 / 0.050 | 5.367 / 8.950 / 29.050 | clean PASS |
| 2,690 | 2 | 5.8750 | 0.3257 / 0.5473 | 1181.4 / 0.13157 | 0.85 / 8 / 20 | 0.424 / 1.950 | 13.63 / 21 / 29 | 0.004 / 0.050 | 5.302 / 8.250 / 17.450 | clean PASS |
| 2,690 | 3 | 5.9582 | 0.3244 / 0.5420 | 949.1 / 0.13013 | 0.85 / 8 / 21 | 0.407 / 1.900 | 13.56 / 20 / 29 | 0.003 / 0.050 | 5.284 / 8.150 / 20.000 | clean PASS |
| 2,690 | 4 | 5.6605 | 0.3256 / 0.5419 | 918.8 / 0.13221 | 0.88 / 8 / 21 | 0.425 / 1.900 | 13.77 / 22 / 29 | 0.005 / 0.050 | 5.340 / 8.450 / 18.050 | clean PASS |
| 2,690 | 5 | 5.7147 | 0.3236 / 0.5381 | 937.5 / 0.13293 | N/A (incomplete series) | 0.055 / 0.100 | N/A (incomplete series) | 0.003 / 0.050 | 3.117 / 5.750 / 5.750 | clean FAIL |
| 3,200 | 1 | 5.8915 | 0.3259 / 0.5292 | 1097.1 / 0.11205 | 1.33 / 11 / 22 | 0.580 / 2.200 | 16.79 / 25 / 29 | 0.006 / 0.050 | 5.400 / 8.250 / 24.100 | clean PASS |
| 3,200 | 2 | 5.7860 | 0.3245 / 0.5271 | 988.0 / 0.11205 | 1.33 / 11 / 26 | 0.569 / 2.200 | 16.80 / 26 / 29 | 0.007 / 0.050 | 5.398 / 8.450 / 25.150 | clean PASS |
| 3,200 | 3 | 5.7866 | 0.3263 / 0.5294 | 883.1 / 0.11217 | 1.32 / 11 / 21 | 0.593 / 2.200 | 16.96 / 25 / 29 | 0.006 / 0.050 | 5.442 / 8.250 / 27.500 | clean PASS |
| 3,200 | 4 | 6.1627 | 0.3281 / 0.5267 | 884.3 / 0.10901 | 1.31 / 11 / 20 | 0.566 / 2.100 | 17.10 / 26 / 29 | 0.007 / 0.050 | 5.489 / 8.450 / 22.200 | clean PASS |
| 3,200 | 5 | 6.0205 | 0.3285 / 0.5256 | 915.3 / 0.11179 | 1.40 / 12 / 22 | 0.602 / 2.450 | 17.42 / 29 / 29 | 0.016 / 0.350 | 5.572 / 9.500 / 37.450 | clean PASS |
| 3,805 | 1 | 5.8931 | 0.3354 / 0.4877 | 925.5 / 0.09489 | 1.97 / 13 / 21 | 1.372 / 2.750 | 20.37 / 29 / 29 | 0.018 / 0.500 | 5.462 / 8.700 / 29.300 | clean FAIL |
| 3,805 | 2 | 6.0872 | 0.3330 / 0.4915 | 870.9 / 0.09207 | 2.01 / 13 / 22 | 1.366 / 2.750 | 20.54 / 29 / 29 | 0.019 / 0.500 | 5.467 / 8.500 / 46.350 | clean FAIL |
| 3,805 | 3 | 6.1165 | 0.3350 / 0.4898 | 964.5 / 0.09128 | 2.01 / 13 / 24 | 1.369 / 2.800 | 20.41 / 29 / 29 | 0.017 / 0.450 | 5.450 / 8.400 / 30.050 | clean FAIL |
| 3,805 | 4 | 6.1078 | 0.3342 / 0.4891 | 846.9 / 0.09287 | 2.02 / 13 / 21 | 1.315 / 2.800 | 20.72 / 29 / 29 | 0.025 / 0.750 | 5.554 / 9.100 / 39.550 | clean FAIL |
| 3,805 | 5 | 5.8397 | 0.3333 / 0.4901 | 966.2 / 0.09457 | 2.02 / 13 / 22 | 1.339 / 2.700 | 20.61 / 29 / 29 | 0.019 / 0.600 | 5.474 / 8.250 / 37.200 | clean FAIL |
| 4,525 | 1 | 7.0712 | 0.3501 / 0.4248 | 959.2 / 0.08002 | 2.01 / 13 / 23 | 1.391 / 2.800 | 19.99 / 29 / 29 | 0.016 / 0.500 | 5.409 / 8.250 / 32.300 | clean FAIL |
| 4,525 | 2 | 7.1316 | 0.3453 / 0.4145 | 868.6 / 0.08016 | 2.09 / 13 / 28 | 1.403 / 2.850 | 19.79 / 29 / 29 | 0.013 / 0.400 | 5.393 / 8.250 / 16.450 | clean FAIL |
| 4,525 | 3 | 7.0267 | 0.3508 / 0.4196 | 840.2 / 0.08130 | 2.05 / 13 / 26 | 1.397 / 2.850 | 19.79 / 29 / 29 | 0.014 / 0.450 | 5.387 / 8.200 / 30.950 | clean FAIL |
| 4,525 | 4 | 7.0112 | 0.3513 / 0.4120 | 878.4 / 0.08152 | 2.03 / 13 / 23 | 1.404 / 2.850 | 19.77 / 29 / 29 | 0.018 / 0.550 | 5.422 / 8.900 / 24.750 | clean FAIL |
| 4,525 | 5 | 7.0289 | 0.3515 / 0.4240 | 918.0 / 0.08186 | 2.03 / 13 / 24 | 1.410 / 2.850 | 19.82 / 29 / 29 | 0.013 / 0.450 | 5.391 / 8.250 / 31.300 | clean FAIL |

Commit confirmation to ACK release includes post-confirmation owner scheduling and prefix wait, and excludes subsequent HTTP transmission. These nested waits must not be added twice. Physical loan return and through-W result/footprint holds are distinct. The JSON retains both confirmed-count and highest-confirmed-revision gaps, allocated gaps and retained-result/footprint occupancy. Reader/control shares are described there; no mixed-reader progress qualification is claimed.

CPU uses the frozen runner’s controller launch anchor plus its 100 ms scheduler lead and 10 s warmup, interpolating 100 ms tick samples; this has launch/tick uncertainty and includes drain completions in the measured ACK divisor. WAL and syncs span the complete warmup/measurement/drain snapshot interval and include ordinary product maintenance and PG statistics reporting lag. The conservative sent mean uses the HDR service sum divided by **sent** requests; unsent expiry timings can only increase this upper bound.

Companion profiling writes numeric clocks and a CSV series, which costs work. It is diagnostic evidence and never substitutes for the native S1 or ≤6.0 ms gate. No PG-marker SQL or altered product transaction is enabled.

Incomplete measured-window series are retained as **N/A**, with observed coverage in JSON; no terminal value is extrapolated. 2,690/s rep 5: 0.0/20,000 ms covered, companion FAIL, 53,800 measured errors. Phase deltas still report the available warmup/measurement/drain clocks and counts; for an owner that pauses during warmup they do not represent successful measured traffic.
