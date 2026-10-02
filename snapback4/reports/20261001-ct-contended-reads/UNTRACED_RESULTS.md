# Tracing disabled, all 96 logical CPUs: 0 / 48 / 96 / 144 busy children

Milliseconds. Each side pools two runs of five cohorts unless stated otherwise. Each cohort retains 23 calls, drops three, and uses rank 19/20 for p95. Raw summaries retain every cohort; pooling uses nearest rank. This is an alternating before/after/after/before experiment, not a confidence interval.

| Busy / available CPUs | Endpoint | Before p50 / p95 | After p50 / p95 | After/before p50 / p95 |
|---|---|---:|---:|---:|
| 0 | following500 | 2.966 / 4.301 | 4.034 / 5.657 | 1.36 / 1.32 |
| 0 | following5 | 2.964 / 4.108 | 3.824 / 5.588 | 1.29 / 1.36 |
| 0 | celebrityFollowing | 2.887 / 4.117 | 2.457 / 5.548 | 0.85 / 1.35 |
| 0 | globalSearch | 3.636 / 5.017 | 3.049 / 5.826 | 0.84 / 1.16 |
| 0 | insights | 1.394 / 2.062 | 0.965 / 1.824 | 0.69 / 0.88 |
| 0 | trending | 1.808 / 2.801 | 1.433 / 3.145 | 0.79 / 1.12 |
| 0 | busyPage1 | 1.648 / 2.584 | 1.272 / 2.652 | 0.77 / 1.03 |
| 0 | busyPage50 | 1.736 / 2.062 | 1.706 / 2.635 | 0.98 / 1.28 |
| 0.5 | following500 | 3.263 / 3.972 | 2.755 / 2.917 | 0.84 / 0.73 |
| 0.5 | following5 | 3.159 / 3.638 | 2.726 / 2.880 | 0.86 / 0.79 |
| 0.5 | celebrityFollowing | 3.168 / 3.705 | 2.728 / 2.864 | 0.86 / 0.77 |
| 0.5 | globalSearch | 4.100 / 4.470 | 3.777 / 3.920 | 0.92 / 0.88 |
| 0.5 | insights | 0.989 / 1.187 | 0.768 / 0.875 | 0.78 / 0.74 |
| 0.5 | trending | 1.678 / 1.911 | 1.395 / 1.534 | 0.83 / 0.80 |
| 0.5 | busyPage1 | 1.407 / 1.623 | 1.069 / 1.259 | 0.76 / 0.78 |
| 0.5 | busyPage50 | 1.423 / 1.681 | 1.078 / 1.224 | 0.76 / 0.73 |
| 1 | following500 | 6.284 / 11.205 | 3.078 / 9.280 | 0.49 / 0.83 |
| 1 | following5 | 5.498 / 9.335 | 3.017 / 9.105 | 0.55 / 0.98 |
| 1 | celebrityFollowing | 5.133 / 9.444 | 2.980 / 10.927 | 0.58 / 1.16 |
| 1 | globalSearch | 8.626 / 12.782 | 6.425 / 9.672 | 0.74 / 0.76 |
| 1 | insights | 2.030 / 5.315 | 0.893 / 3.512 | 0.44 / 0.66 |
| 1 | trending | 3.071 / 6.846 | 1.555 / 4.591 | 0.51 / 0.67 |
| 1 | busyPage1 | 3.145 / 5.934 | 1.226 / 4.398 | 0.39 / 0.74 |
| 1 | busyPage50 | 3.078 / 6.023 | 1.234 / 4.269 | 0.40 / 0.71 |
| 1.5 | following500 | 7.733 / 13.302 | 3.265 / 9.955 | 0.42 / 0.75 |
| 1.5 | following5 | 6.484 / 11.099 | 3.285 / 8.697 | 0.51 / 0.78 |
| 1.5 | celebrityFollowing | 7.206 / 13.523 | 3.858 / 10.439 | 0.54 / 0.77 |
| 1.5 | globalSearch | 9.872 / 13.257 | 4.359 / 9.659 | 0.44 / 0.73 |
| 1.5 | insights | 3.539 / 6.429 | 1.059 / 3.234 | 0.30 / 0.50 |
| 1.5 | trending | 4.027 / 7.066 | 1.746 / 5.130 | 0.43 / 0.73 |
| 1.5 | busyPage1 | 3.862 / 7.139 | 1.422 / 4.745 | 0.37 / 0.66 |
| 1.5 | busyPage50 | 3.867 / 6.893 | 1.432 / 4.481 | 0.37 / 0.65 |

After full contention relative to its own idle:

| Endpoint | Median ratio (target ≤1.25) | p95 ratio (target ≤1.50) |
|---|---:|---:|
| following500 | 0.763 | 1.640 |
| following5 | 0.789 | 1.630 |
| celebrityFollowing | 1.213 | 1.970 |
| globalSearch | 2.107 | 1.660 |
| insights | 0.925 | 1.926 |
| trending | 1.085 | 1.460 |
| busyPage1 | 0.964 | 1.658 |
| busyPage50 | 0.724 | 1.620 |
