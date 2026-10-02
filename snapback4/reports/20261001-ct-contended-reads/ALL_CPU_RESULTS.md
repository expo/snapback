# All 96 logical CPUs: 0 / 48 / 96 / 144 busy children

Milliseconds. Each side pools two runs of five cohorts unless stated otherwise. Each cohort retains 23 calls, drops three, and uses rank 19/20 for p95. Raw summaries retain every cohort; pooling uses nearest rank. This is an alternating before/after/after/before experiment, not a confidence interval.

| Busy / available CPUs | Endpoint | Before p50 / p95 | After p50 / p95 | After/before p50 / p95 |
|---|---|---:|---:|---:|
| 0 | following500 | 2.789 / 3.877 | 2.691 / 5.538 | 0.96 / 1.43 |
| 0 | following5 | 2.828 / 3.873 | 2.645 / 5.198 | 0.94 / 1.34 |
| 0 | celebrityFollowing | 2.575 / 3.458 | 2.629 / 5.041 | 1.02 / 1.46 |
| 0 | globalSearch | 3.199 / 4.735 | 3.525 / 7.158 | 1.10 / 1.51 |
| 0 | insights | 1.019 / 1.704 | 1.080 / 1.597 | 1.06 / 0.94 |
| 0 | trending | 1.500 / 2.126 | 1.610 / 2.417 | 1.07 / 1.14 |
| 0 | busyPage1 | 1.274 / 1.835 | 1.288 / 1.980 | 1.01 / 1.08 |
| 0 | busyPage50 | 1.324 / 2.031 | 1.231 / 1.996 | 0.93 / 0.98 |
| 0.5 | following500 | 3.280 / 4.800 | 3.139 / 4.174 | 0.96 / 0.87 |
| 0.5 | following5 | 3.164 / 4.447 | 3.075 / 3.819 | 0.97 / 0.86 |
| 0.5 | celebrityFollowing | 3.135 / 4.951 | 3.183 / 4.186 | 1.02 / 0.85 |
| 0.5 | globalSearch | 4.148 / 5.340 | 4.224 / 5.578 | 1.02 / 1.04 |
| 0.5 | insights | 1.042 / 1.467 | 1.028 / 1.608 | 0.99 / 1.10 |
| 0.5 | trending | 1.669 / 2.396 | 1.791 / 2.405 | 1.07 / 1.00 |
| 0.5 | busyPage1 | 1.396 / 1.825 | 1.369 / 2.210 | 0.98 / 1.21 |
| 0.5 | busyPage50 | 1.411 / 1.803 | 1.368 / 1.851 | 0.97 / 1.03 |
| 1 | following500 | 7.608 / 13.903 | 4.038 / 9.741 | 0.53 / 0.70 |
| 1 | following5 | 6.844 / 11.471 | 3.305 / 9.590 | 0.48 / 0.84 |
| 1 | celebrityFollowing | 6.345 / 13.734 | 3.322 / 9.792 | 0.52 / 0.71 |
| 1 | globalSearch | 9.511 / 14.249 | 4.388 / 10.781 | 0.46 / 0.76 |
| 1 | insights | 3.051 / 6.936 | 1.091 / 3.386 | 0.36 / 0.49 |
| 1 | trending | 3.883 / 7.048 | 1.831 / 4.746 | 0.47 / 0.67 |
| 1 | busyPage1 | 3.356 / 6.878 | 1.459 / 4.499 | 0.43 / 0.65 |
| 1 | busyPage50 | 3.095 / 6.752 | 1.543 / 6.340 | 0.50 / 0.94 |
| 1.5 | following500 | 7.328 / 13.804 | 5.117 / 13.661 | 0.70 / 0.99 |
| 1.5 | following5 | 7.755 / 15.404 | 3.743 / 10.641 | 0.48 / 0.69 |
| 1.5 | celebrityFollowing | 7.257 / 15.603 | 3.804 / 12.103 | 0.52 / 0.78 |
| 1.5 | globalSearch | 10.061 / 19.520 | 7.633 / 15.889 | 0.76 / 0.81 |
| 1.5 | insights | 3.798 / 7.331 | 1.390 / 12.291 | 0.37 / 1.68 |
| 1.5 | trending | 4.739 / 8.668 | 2.098 / 9.136 | 0.44 / 1.05 |
| 1.5 | busyPage1 | 3.962 / 10.571 | 1.849 / 10.871 | 0.47 / 1.03 |
| 1.5 | busyPage50 | 3.827 / 7.577 | 1.636 / 7.957 | 0.43 / 1.05 |

After full contention relative to its own idle:

| Endpoint | Median ratio (target ≤1.25) | p95 ratio (target ≤1.50) |
|---|---:|---:|
| following500 | 1.500 | 1.759 |
| following5 | 1.250 | 1.845 |
| celebrityFollowing | 1.263 | 1.942 |
| globalSearch | 1.245 | 1.506 |
| insights | 1.010 | 2.120 |
| trending | 1.137 | 1.963 |
| busyPage1 | 1.132 | 2.272 |
| busyPage50 | 1.253 | 3.175 |
