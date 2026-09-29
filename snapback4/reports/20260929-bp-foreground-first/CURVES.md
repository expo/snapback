
immediate: p95 milliseconds
| Probe | 10% | 50% | Full | Full / small |
| --- | ---: | ---: | ---: | ---: |
| busyHistory | 2.472 | 2.958 | 2.191 | 0.887 |
| following500 | 4.340 | 4.572 | 3.934 | 0.906 |
| following5 | 2.631 | 3.201 | 4.229 | 1.607 |
| celebrityFollower | 2.919 | 2.566 | 4.755 | 1.629 |
| search100 | 4.887 | 4.703 | 7.235 | 1.480 |
| insights | 1.208 | 1.281 | 2.096 | 1.735 |
| trending | 3.530 | 1.560 | 3.059 | 0.866 |

| Probe | 10% p50 / p95 / max | 50% p50 / p95 / max | Full p50 / p95 / max |
| --- | ---: | ---: | ---: |
| busyHistory | 1.076 / 2.472 / 2.472 | 1.155 / 2.958 / 2.958 | 0.965 / 2.191 / 2.191 |
| following500 | 2.511 / 4.340 / 4.340 | 2.733 / 4.572 / 4.572 | 2.476 / 3.934 / 3.934 |
| following5 | 1.707 / 2.631 / 2.631 | 2.503 / 3.201 / 3.201 | 2.560 / 4.229 / 4.229 |
| celebrityFollower | 1.883 / 2.919 / 2.919 | 2.414 / 2.566 / 2.566 | 2.453 / 4.755 / 4.755 |
| search100 | 3.427 / 4.887 / 4.887 | 3.413 / 4.703 / 4.703 | 3.736 / 7.235 / 7.235 |
| insights | 0.867 / 1.208 / 1.208 | 0.845 / 1.281 / 1.281 | 0.815 / 2.096 / 2.096 |
| trending | 1.466 / 3.530 / 3.530 | 1.488 / 1.560 / 1.560 | 1.812 / 3.059 / 3.059 |

| Frozen rule | Measured | Ceiling | Margin | Result |
| --- | ---: | ---: | ---: | --- |
| search100FullSmall | 1.480 | 3.000 | +1.520 | PASS |
| search100MidCurve | 4.703 | 5.931 | +1.227 | PASS |
| insightsFullSmall | 1.735 | 3.000 | +1.265 | PASS |
| insightsMidCurve | 1.281 | 1.603 | +0.322 | PASS |
| trendingFullSmall | 0.866 | 3.000 | +2.134 | PASS |
| trendingMidCurve | 1.560 | 3.321 | +1.761 | PASS |
| following500 | 0.930 | 3.000 | +2.070 | PASS |
| celebrityRead | 1.124 | 3.000 | +1.876 | PASS |

warm: p95 milliseconds
| Probe | 10% | 50% | Full | Full / small |
| --- | ---: | ---: | ---: | ---: |
| busyHistory | 2.365 | 2.207 | 2.501 | 1.057 |
| following500 | 3.691 | 4.001 | 3.744 | 1.014 |
| following5 | 2.577 | 4.254 | 4.141 | 1.607 |
| celebrityFollower | 2.668 | 4.188 | 4.946 | 1.854 |
| search100 | 4.863 | 5.632 | 5.507 | 1.132 |
| insights | 1.489 | 1.717 | 2.371 | 1.592 |
| trending | 2.246 | 3.039 | 2.880 | 1.282 |

| Probe | 10% p50 / p95 / max | 50% p50 / p95 / max | Full p50 / p95 / max |
| --- | ---: | ---: | ---: |
| busyHistory | 1.277 / 2.365 / 2.750 | 1.445 / 2.207 / 4.908 | 1.446 / 2.501 / 3.426 |
| following500 | 2.773 / 3.691 / 4.651 | 2.764 / 4.001 / 5.206 | 2.767 / 3.744 / 5.266 |
| following5 | 1.953 / 2.577 / 3.360 | 2.955 / 4.254 / 5.939 | 2.874 / 4.141 / 7.907 |
| celebrityFollower | 2.200 / 2.668 / 4.239 | 2.765 / 4.188 / 5.591 | 3.316 / 4.946 / 5.701 |
| search100 | 3.476 / 4.863 / 5.343 | 3.909 / 5.632 / 7.273 | 3.789 / 5.507 / 6.649 |
| insights | 1.017 / 1.489 / 2.170 | 1.107 / 1.717 / 2.421 | 1.469 / 2.371 / 6.303 |
| trending | 1.553 / 2.246 / 8.140 | 1.710 / 3.039 / 6.444 | 1.744 / 2.880 / 6.495 |

| Frozen rule | Measured | Ceiling | Margin | Result |
| --- | ---: | ---: | ---: | --- |
| search100FullSmall | 1.132 | 3.000 | +1.868 | PASS |
| search100MidCurve | 5.632 | 5.149 | -0.482 | FAIL |
| insightsFullSmall | 1.592 | 3.000 | +1.408 | PASS |
| insightsMidCurve | 1.717 | 1.881 | +0.164 | PASS |
| trendingFullSmall | 1.282 | 3.000 | +1.718 | PASS |
| trendingMidCurve | 3.039 | 2.527 | -0.511 | FAIL |
| following500 | 0.904 | 3.000 | +2.096 | PASS |
| celebrityRead | 1.194 | 3.000 | +1.806 | PASS |

All nine batches, rule pass counts:
- search100FullSmall: 9/9
- search100MidCurve: 2/9
- insightsFullSmall: 7/9
- insightsMidCurve: 6/9
- trendingFullSmall: 9/9
- trendingMidCurve: 4/9
- following500: 9/9
- celebrityRead: 9/9

Deep paging is not sampled by SQ’s live protocol; no inferred pass.
The write rule and correctness proofs are in live/evidence/replay/.
Frozen celebrity write ratio: 1.050549 <= 3; margin +1.949451; n=200 / 8096.
Final drain observation: 168.269 s; three empty samples: True.
