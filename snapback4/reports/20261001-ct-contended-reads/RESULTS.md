# First before/after series

Host affinity: CPUs 0–9 (ten available CPUs); busy processes: 0, 5, 10, 15. Five independent 23-call cohorts per cell, first three discarded. Values below pool the 100 measured samples per cell; exact rank-19 cohort p95s remain in each `summary.json`. Milliseconds. This series has unequal ambient host load; see REPORT.md and the alternating controls.

| Endpoint | Busy processes | Before p50 | Before p95 | After p50 | After p95 |
|---|---:|---:|---:|---:|---:|
| following500 | 0 | 2.436 | 4.586 | 3.121 | 5.471 |
| following5 | 0 | 2.362 | 3.563 | 2.969 | 5.349 |
| celebrityFollowing | 0 | 2.896 | 4.108 | 3.085 | 5.656 |
| globalSearch | 0 | 3.563 | 4.813 | 3.916 | 7.558 |
| insights | 0 | 0.895 | 1.937 | 1.439 | 2.040 |
| trending | 0 | 1.312 | 2.874 | 2.191 | 2.832 |
| busyPage1 | 0 | 1.104 | 2.279 | 1.508 | 2.164 |
| busyPage50 | 0 | 1.047 | 2.099 | 1.208 | 2.250 |
| following500 | 5 | 2.172 | 2.647 | 3.756 | 5.119 |
| following5 | 5 | 2.131 | 2.189 | 3.590 | 5.069 |
| celebrityFollowing | 5 | 2.170 | 2.337 | 3.803 | 5.076 |
| globalSearch | 5 | 2.796 | 4.307 | 4.487 | 6.567 |
| insights | 5 | 0.779 | 0.910 | 1.152 | 1.482 |
| trending | 5 | 1.223 | 1.356 | 1.785 | 2.410 |
| busyPage1 | 5 | 0.955 | 1.125 | 1.494 | 1.949 |
| busyPage50 | 5 | 0.979 | 1.435 | 1.506 | 2.084 |
| following500 | 10 | 3.708 | 7.094 | 3.372 | 5.580 |
| following5 | 10 | 4.258 | 7.238 | 3.273 | 6.687 |
| celebrityFollowing | 10 | 4.405 | 7.124 | 3.201 | 4.887 |
| globalSearch | 10 | 4.894 | 8.825 | 4.091 | 7.281 |
| insights | 10 | 1.053 | 4.576 | 1.100 | 3.464 |
| trending | 10 | 2.846 | 5.063 | 1.720 | 3.659 |
| busyPage1 | 10 | 1.996 | 4.385 | 1.370 | 3.016 |
| busyPage50 | 10 | 2.431 | 4.923 | 1.326 | 3.492 |
| following500 | 15 | 3.753 | 7.115 | 3.307 | 8.741 |
| following5 | 15 | 4.756 | 7.159 | 3.124 | 5.995 |
| celebrityFollowing | 15 | 4.716 | 7.127 | 3.158 | 6.101 |
| globalSearch | 15 | 4.105 | 9.065 | 4.243 | 6.594 |
| insights | 15 | 0.896 | 5.071 | 0.980 | 3.583 |
| trending | 15 | 1.462 | 5.093 | 1.596 | 3.923 |
| busyPage1 | 15 | 2.900 | 6.915 | 1.383 | 3.797 |
| busyPage50 | 15 | 1.161 | 5.374 | 1.415 | 4.085 |
