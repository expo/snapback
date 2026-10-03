# Round-4 mixed-load cells

Fresh split and paced runs, unchanged corrected fixture, 125-second read windows. Nearest-rank percentiles recomputed from every successful read. Ordinary/demoted historical small-fixture controls remain in round3/MIXED.md.

| Busy | Split p50 / p95 ms | Paced p50 / p95 ms | Paced vs split p95 |
|---:|---:|---:|---:|
| 0 | 0.618 / 0.716 | 0.612 / 0.716 | -0.0% |
| 48 | 0.461 / 1.983 | 0.445 / 1.481 | -25.3% |
| 96 | 0.473 / 3.326 | 0.478 / 3.354 | +0.8% |
| 144 | 0.478 / 0.917 | 0.488 / 3.633 | +296.1% |

| Design | Busy | Reads | Lease max ms | Expiry max ms | Schedule delay ms | Job elapsed ms | Effects / retries | Deadline outcomes |
|---|---:|---:|---:|---:|---|---|---|---|
| split | 0 | 200,932 | 2608 | 1035 | 860, 73 | 4, 2 | 508 / 106 | E_EFFECT_DEADLINE |
| split | 48 | 192,468 | 1204 | 1056 | 413, 699, 3 | 45, 1, 2 | 508 / 106 | E_EFFECT_DEADLINE |
| split | 96 | 160,931 | 3364 | 1065 | 168, 873 | 2, 2 | 508 / 106 | E_EFFECT_DEADLINE |
| split | 144 | 190,193 | 4639 | 1038 | 703, 62 | 1, 0 | 508 / 106 | E_EFFECT_DEADLINE |
| paced | 0 | 200,383 | 2519 | 1046 | 198, 356 | 0, 2 | 508 / 106 | E_EFFECT_DEADLINE |
| paced | 48 | 214,827 | 1606 | 1047 | 489, 758 | 1, 2 | 508 / 106 | E_EFFECT_DEADLINE |
| paced | 96 | 159,087 | 3386 | 1684 | 920, 480 | 19, 1 | 508 / 106 | E_EFFECT_DEADLINE |
| paced | 144 | 141,737 | 5041 | 1065 | 476, 505, 250 | 78, 6, 19 | 508 / 106 | E_EFFECT_DEADLINE |

## Paced with 1,000 Following tasks

100 followers, 1,000 actual delivery tasks, under the same mixed workload. Busy processes and observation continue through the drain tail; reads stop after 125 seconds. During-drain reads end before the final positive delivery observation.

| Busy | Read p50 / p95 ms, full window | Read p50 / p95 ms, during drain (n) | Lease max ms | Expiry max ms | Schedule delay ms | Initial pending | Drain s |
|---:|---:|---:|---:|---:|---|---:|---:|
| 0 | 0.478 / 0.751 | 0.478 / 0.751 (216913) | 2773 | 1747 | 949, 232, 686 | 1000 | 143.037 |
| 48 | 0.474 / 1.369 | 0.474 / 1.348 (200404) | 4328 | 1048 | 53, 374, 542, 106 | 1000 | 220.737 |
| 96 | 0.499 / 3.044 | 0.499 / 3.041 (156702) | 5034 | 1613 | 475, 953, 183, 331, 578, 300, 85, 937, 873, 500, 185 | 1000 | 693.048 |
| 144 | 0.526 / 5.325 | 0.525 / 5.318 (81008) | 3304 | 1755 | 954, 170, 125, 175, 767, 1007, 306, 487, 767, 980, 196, 387, 591, 796, 6, 184, 466, 642, 780, 35 | 1000 | 1177.746 |

| Busy | Reads | Abandoned / recovered | Unexpected lease changes | Job elapsed ms | Effects / retries | Deadline outcomes |
|---:|---:|---:|---:|---|---|---|
| 0 | 217,495 | 6 / 6 | 0 | 9, 6, 20 | 508 / 106 | E_EFFECT_DEADLINE |
| 48 | 201,024 | 6 / 6 | 0 | 9, 6, 0, 68 | 508 / 106 | E_EFFECT_DEADLINE |
| 96 | 157,294 | 6 / 6 | 0 | 11, 2, 6, 6, 23, 2, 4, 34, 54, 6, 5 | 508 / 106 | E_EFFECT_DEADLINE |
| 144 | 81,548 | 6 / 6 | 0 | 12, 4, 29, 7, 6, 4, 6, 3, 5, 6, 5, 7, 4, 5, 45, 3, 4, 5, 46, 6 | 508 / 106 | E_EFFECT_DEADLINE |

Small-fixture reads: 1,460,558. Following-fixture reads: 657,361. Every cell satisfies all original lease, expiry, schedule, retry, deadline and drain assertions.
