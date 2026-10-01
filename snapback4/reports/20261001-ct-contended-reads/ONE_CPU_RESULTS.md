# One-CPU idle placement controls

Milliseconds. Each side pools two runs of five cohorts unless stated otherwise. Each cohort retains 23 calls, drops three, and uses rank 19/20 for p95. Raw summaries retain every cohort; pooling uses nearest rank. This is an alternating before/after/after/before experiment, not a confidence interval.

| Busy / available CPUs | Endpoint | Before p50 / p95 | After p50 / p95 | After/before p50 / p95 |
|---|---|---:|---:|---:|
| 0 | following500 | 2.478 / 4.146 | 2.442 / 4.473 | 0.99 / 1.08 |
| 0 | following5 | 2.433 / 4.108 | 2.309 / 3.221 | 0.95 / 0.78 |
| 0 | celebrityFollowing | 2.392 / 4.006 | 2.324 / 4.847 | 0.97 / 1.21 |
| 0 | globalSearch | 3.098 / 4.769 | 3.001 / 5.349 | 0.97 / 1.12 |
| 0 | insights | 0.997 / 1.324 | 0.887 / 1.659 | 0.89 / 1.25 |
| 0 | trending | 1.458 / 2.019 | 1.341 / 1.933 | 0.92 / 0.96 |
| 0 | busyPage1 | 1.194 / 2.274 | 1.093 / 1.981 | 0.92 / 0.87 |
| 0 | busyPage50 | 1.232 / 1.950 | 1.188 / 2.043 | 0.96 / 1.05 |
