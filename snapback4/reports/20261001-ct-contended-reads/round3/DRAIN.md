# Real calibration backlog while builder probes run

Two trials/design/load, reversed order. Every trial restores the identical stopped 50%-scale checkpoint. All responses ending before the final positive backlog observation are retained as during-drain; the first three calls of each 23-call cohort are excluded from ranks. Raw samples and individual trial/cohort results accompany the pooled distributions.

| Busy | Endpoint | Demoted p50 / p95 ms (n) | Ordinary p50 / p95 ms (n) | Split p50 / p95 ms (n) |
|---:|---|---:|---:|---:|
| 0 | following500 | 2.801 / 5.040 (2860) | 2.617 / 4.937 (3103) | 2.744 / 4.825 (3260) |
| 0 | following5 | 2.656 / 4.733 (2860) | 2.477 / 4.156 (3080) | 2.598 / 4.749 (3260) |
| 0 | celebrityFollowing | 2.647 / 4.619 (2860) | 2.460 / 3.875 (3080) | 2.592 / 4.401 (3260) |
| 0 | globalSearch | 3.514 / 3.900 (2852) | 3.380 / 3.937 (3080) | 3.497 / 4.106 (3260) |
| 0 | insights | 0.860 / 1.086 (2840) | 0.834 / 1.070 (3080) | 0.844 / 1.126 (3242) |
| 0 | trending | 1.357 / 1.828 (2840) | 1.316 / 1.830 (3080) | 1.327 / 1.768 (3240) |
| 0 | busyPage1 | 1.130 / 1.765 (2826) | 1.090 / 1.474 (3080) | 1.100 / 1.553 (3236) |
| 0 | busyPage50 | 1.145 / 1.942 (2820) | 1.104 / 1.885 (3080) | 1.102 / 1.877 (3220) |
| 96 | following500 | 3.683 / 11.132 (12480) | 4.533 / 12.897 (4580) | 3.567 / 9.738 (8725) |
| 96 | following5 | 3.459 / 10.203 (12480) | 3.803 / 11.717 (4580) | 3.359 / 9.582 (8710) |
| 96 | celebrityFollowing | 3.415 / 10.237 (12468) | 3.938 / 11.112 (4580) | 3.319 / 9.220 (8700) |
| 96 | globalSearch | 5.488 / 12.750 (12448) | 6.973 / 14.763 (4580) | 5.009 / 11.399 (8700) |
| 96 | insights | 0.867 / 3.941 (12440) | 0.909 / 4.228 (4580) | 0.868 / 3.925 (8700) |
| 96 | trending | 1.582 / 5.527 (12440) | 1.801 / 6.115 (4576) | 1.579 / 5.353 (8700) |
| 96 | busyPage1 | 1.216 / 4.819 (12440) | 1.346 / 4.988 (4560) | 1.211 / 4.622 (8700) |
| 96 | busyPage50 | 1.235 / 4.873 (12440) | 1.382 / 5.088 (4545) | 1.234 / 4.721 (8700) |

## Drain completion per trial

Times are from server spawn, including startup; the final positive/first-empty polling interval is uncertainty, not service time. Host load is the one-minute load average, includes other tenants, and decays across cells; it is not an instantaneous count of our busy children.

| Busy | Design | Trial | Initial tasks | Completion s | Ready-to-empty s | Poll interval ms | Host load start / end |
|---:|---|---:|---:|---:|---:|---:|---:|
| 0 | demoted | 1 | 6507 | 29.291 | 29.206 | 145 | 143.42 / 90.57 |
| 0 | demoted | 2 | 6507 | 34.135 | 34.039 | 145 | 41.76 / 30.39 |
| 0 | ordinary | 1 | 6507 | 31.302 | 31.199 | 145 | 83.88 / 50.83 |
| 0 | ordinary | 2 | 6507 | 34.258 | 34.154 | 145 | 61.19 / 44.62 |
| 0 | split | 1 | 6507 | 32.577 | 32.472 | 146 | 47.24 / 29.68 |
| 0 | split | 2 | 6507 | 37.699 | 37.619 | 156 | 114.45 / 69.40 |
| 96 | demoted | 1 | 6507 | 260.588 | 260.404 | 248 | 122.44 / 122.76 |
| 96 | demoted | 2 | 6507 | 185.044 | 184.899 | 205 | 34.58 / 113.05 |
| 96 | ordinary | 1 | 6507 | 87.176 | 86.947 | 251 | 99.03 / 118.29 |
| 96 | ordinary | 2 | 6507 | 100.813 | 100.551 | 241 | 103.16 / 115.88 |
| 96 | split | 1 | 6507 | 124.531 | 124.350 | 238 | 33.64 / 103.94 |
| 96 | split | 2 | 6507 | 167.005 | 166.830 | 236 | 107.91 / 109.37 |

All 323,472 successful sampled answers are retained. The eight settled endpoint hashes agree across every design, load and trial. The pristine database and committed WAL sizes/SHA-256 values agree across all trials. During-drain Following answers legitimately evolve; these are not treated as answer-stability failures.
