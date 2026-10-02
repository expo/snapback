# Round-3 active-maintenance read comparison

Same corrected round-2 mixed fixture, 125 s per cell. All successful reads; nearest-rank percentiles.

| Busy | Demoted p50 / p95 ms | Ordinary p50 / p95 ms | Split p50 / p95 ms | Split vs demoted p95 | Split vs ordinary p95 |
|---:|---:|---:|---:|---:|---:|
| 0 | 0.592 / 0.718 | 0.617 / 0.726 | 0.618 / 0.726 | +1.1% | -0.1% |
| 48 | 0.357 / 0.467 | 0.352 / 0.476 | 0.355 / 0.471 | +0.9% | -1.0% |
| 96 | 0.495 / 1.151 | 0.500 / 2.655 | 0.497 / 1.232 | +7.1% | -53.6% |
| 144 | 0.538 / 4.287 | 0.540 / 4.268 | 0.519 / 4.188 | -2.3% | -1.9% |

## Corrected mixed outcomes

| Design | Busy | Reads | Lease max ms | Expiry max ms | Schedule delay ms | Job elapsed ms | Effects / retries | Deadline outcomes |
|---|---:|---:|---:|---:|---|---|---|---|
| demoted | 0 | 228,507 | 5193 | 1084 | 662, 802, 972 | 1, 0, 2 | 508 / 106 | E_EFFECT_DEADLINE |
| demoted | 48 | 319,504 | 3853 | 1236 | 986, 587 | 1, 1 | 508 / 106 | E_EFFECT_DEADLINE |
| demoted | 96 | 185,874 | 4674 | 1126 | 833, 999, 322 | 0, 1, 1 | 508 / 106 | E_EFFECT_DEADLINE |
| demoted | 144 | 100,253 | 4914 | 1689 | 47, 847, 63 | 9, 0, 1 | 508 / 106 | E_EFFECT_DEADLINE |
| ordinary | 0 | 195,732 | 4696 | 1076 | 126, 18 | 0, 0 | 508 / 106 | E_EFFECT_DEADLINE |
| ordinary | 48 | 329,800 | 3436 | 1086 | 1006, 939 | 1, 0 | 508 / 106 | E_EFFECT_DEADLINE |
| ordinary | 96 | 160,092 | 4985 | 1143 | 964, 194 | 0, 0 | 508 / 106 | E_EFFECT_DEADLINE |
| ordinary | 144 | 100,077 | 5009 | 2701 | 905, 185 | 2, 7 | 508 / 106 | E_EFFECT_DEADLINE |
| split | 0 | 196,714 | 2742 | 1060 | 366, 667 | 1, 1 | 508 / 106 | E_EFFECT_DEADLINE |
| split | 48 | 321,033 | 1490 | 1035 | 317, 478, 662 | 93, 1, 1 | 508 / 106 | E_EFFECT_DEADLINE |
| split | 96 | 183,115 | 4927 | 1721 | 23, 570 | 0, 1 | 508 / 106 | E_EFFECT_DEADLINE |
| split | 144 | 104,260 | 1695 | 1062 | 279, 248 | 1, 0 | 508 / 106 | E_EFFECT_DEADLINE |

## Split with Following in the same mixed workload

100 followers, 1,000 actual queued event deliveries. Completion is polled; the tail stays loaded.

| Busy | Read p50 / p95 ms | Lease max ms | Expiry max ms | Schedule delay ms | Following pending after enqueue | Drain after enqueue ms |
|---:|---:|---:|---:|---|---:|---:|
| 0 | 0.493 / 0.739 | 4758 | 1096 | 25, 215, 426 | 1000 | 52438 |
| 48 | 0.361 / 0.531 | 3931 | 1123 | 477, 1003 | 1000 | 80313 |
| 96 | 0.481 / 3.361 | 5293 | 1139 | 457, 1087, 121, 331, 517 | 1000 | 277007 |
| 144 | 0.543 / 5.582 | 5239 | 1375 | 536, 983, 928, 773, 266, 465, 698 | 1000 | 428446 |

| Busy | Reads | Abandoned / recovered | Unexpected lease changes | Job elapsed ms | Effects / retries | Deadline outcomes |
|---:|---:|---:|---:|---|---|---|
| 0 | 217,464 | 6 / 6 | 0 | 0, 0, 2 | 508 / 106 | E_EFFECT_DEADLINE |
| 48 | 278,640 | 6 / 6 | 0 | 1, 0 | 508 / 106 | E_EFFECT_DEADLINE |
| 96 | 149,696 | 6 / 6 | 0 | 20, 3, 0, 3, 15 | 508 / 106 | E_EFFECT_DEADLINE |
| 144 | 80,952 | 6 / 6 | 0 | 8, 2, 0, 0, 1, 0, 0 | 508 / 106 | E_EFFECT_DEADLINE |
