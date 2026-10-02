# Ten-CPU idle controls

Milliseconds. Each side pools two runs of five cohorts unless stated otherwise. Each cohort retains 23 calls, drops three, and uses rank 19/20 for p95. Raw summaries retain every cohort; pooling uses nearest rank. This is an alternating before/after/after/before experiment, not a confidence interval.

| Busy / available CPUs | Endpoint | Before p50 / p95 | After p50 / p95 | After/before p50 / p95 |
|---|---|---:|---:|---:|
| 0 | following500 | 2.499 / 3.978 | 4.106 / 5.962 | 1.64 / 1.50 |
| 0 | following5 | 2.368 / 3.929 | 3.691 / 4.786 | 1.56 / 1.22 |
| 0 | celebrityFollowing | 2.277 / 3.905 | 2.826 / 4.424 | 1.24 / 1.13 |
| 0 | globalSearch | 3.302 / 5.000 | 3.389 / 5.496 | 1.03 / 1.10 |
| 0 | insights | 1.182 / 2.067 | 1.200 / 1.883 | 1.01 / 0.91 |
| 0 | trending | 1.550 / 2.533 | 1.651 / 2.704 | 1.07 / 1.07 |
| 0 | busyPage1 | 1.197 / 2.018 | 1.637 / 2.721 | 1.37 / 1.35 |
| 0 | busyPage50 | 1.167 / 2.047 | 1.780 / 2.710 | 1.52 / 1.32 |
